import { OnboardingAuth, Company, IOnboardingAuth } from '../db/models/onboarding-auth.model';
import { IUser } from '../db/models/user.model';
import { getEmailEngineByCompany, getSenderByCompany } from '../email';
import { OnboardingReminderEmail } from '../email/emails/onboarding-reminder.email';
import { getCompanyName } from '../email/base.email';

const DAY_MS = 24 * 60 * 60 * 1000;

export const REMINDER_IDLE_MS = DAY_MS;

export const REMINDER_COOLDOWN_MS = DAY_MS;

export const REMINDER_BATCH_SIZE = 25;

export interface ReminderRunResult {
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
}

const toAddresses = (list?: string[]) =>
  (list?.length ? list.filter(Boolean).map((address) => ({ address })) : undefined);

function onboardingBaseUrl(company: Company): string {
  return company === Company.NKSRT
    ? (process.env.ONBOARDING_BASE_URL_DUBAI ?? 'https://nksresearchtech.com')
    : (process.env.ONBOARDING_BASE_URL ?? 'https://nksecurities.com');
}

function formatExpiryDate(date?: Date): string | undefined {
  if (!date) return undefined;
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function buildReminderFilter(now: Date) {
  const idleBefore = new Date(now.getTime() - REMINDER_IDLE_MS);
  const cooldownBefore = new Date(now.getTime() - REMINDER_COOLDOWN_MS);

  return {
    completed: false,
    expired: false,
    expirationDate: { $gt: now },
    $and: [
      {
        $or: [
          { lastActivityAt: { $lte: idleBefore } },
          { lastActivityAt: { $exists: false }, createdAt: { $lte: idleBefore } },
          { lastActivityAt: null, createdAt: { $lte: idleBefore } },
        ],
      },
      {
        $or: [
          { lastReminderAt: { $lte: cooldownBefore } },
          { lastReminderAt: { $exists: false } },
          { lastReminderAt: null },
        ],
      },
    ],
  };
}

export async function sendReminderFor(auth: IOnboardingAuth, now: Date = new Date()): Promise<void> {
  const user = auth.user as IUser | undefined;

  if (!user?.email) {
    throw new Error('The user for this onboarding no longer exists.');
  }

  const url = `${onboardingBaseUrl(auth.company)}/verify-onboarding.html?id=${auth.onboardingKey}`;

  const inviteMessageId = auth.inviteMessageId;
  const subject = inviteMessageId && auth.inviteSubject
    ? (/^re:/i.test(auth.inviteSubject) ? auth.inviteSubject : `Re: ${auth.inviteSubject}`)
    : `${user.firstName}, your onboarding is still pending - ${getCompanyName(auth.company)}`;

  await getEmailEngineByCompany(auth.company).send(
    new OnboardingReminderEmail(
      { name: `${user.firstName} ${user.lastName}`, address: user.email },
      {
        firstName: user.firstName,
        onboardingUrl: url,
        expiresOn: formatExpiryDate(auth.expirationDate),
        started: !!auth.lastActivityAt,
      },
      {
        from: getSenderByCompany(auth.company),
        subject,
        cc: toAddresses(auth.cc),
        bcc: toAddresses(auth.bcc),
        inReplyTo: inviteMessageId,
        references: inviteMessageId ? [inviteMessageId] : undefined,
      },
    ),
  );

  await markReminded(auth, now, true);
}

export async function sendOnboardingReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const candidates = await OnboardingAuth.find(buildReminderFilter(now))
    .sort({ expirationDate: 1 })
    .limit(REMINDER_BATCH_SIZE)
    .populate<{ user: IUser }>('user', 'firstName lastName email');

  const result: ReminderRunResult = {
    candidates: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const auth of candidates) {
    const user = auth.user as IUser | undefined;

    if (!user?.email) {
      result.skipped += 1;
      await markReminded(auth, now, false);
      continue;
    }

    try {
      await sendReminderFor(auth, now);
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(`${auth.onboardingKey}: ${(err as Error).message}`);
      console.error('[cron/onboarding-reminders] send failed', auth.onboardingKey, err);
    }
  }

  return result;
}

async function markReminded(auth: IOnboardingAuth, now: Date, counted: boolean): Promise<void> {
  await OnboardingAuth.updateOne(
    { _id: auth._id },
    counted
      ? { lastReminderAt: now, $inc: { reminderCount: 1 } }
      : { lastReminderAt: now },
  );
}
