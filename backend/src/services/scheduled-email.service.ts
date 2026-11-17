import { Types } from 'mongoose';
import { ScheduledEmail, IScheduledEmail, ScheduledEmailStatus, CombinedAddressing } from '../db/models/scheduled-email.model';
import { IUser } from '../db/models/user.model';
import { Company } from '../db/models/onboarding-auth.model';
import { emailEngine, getSenderByCompany, EmailAddress } from '../email';
import { AdminMessageEmail } from '../email/emails/admin-message.email';

export const SCHEDULED_EMAIL_BATCH_SIZE = 20;

export const SCHEDULED_EMAIL_MAX_ATTEMPTS = 3;

export const SCHEDULED_EMAIL_CONCURRENCY = 4;

export const SCHEDULED_EMAIL_LOCK_MS = 2 * 60 * 1000;

export const CRON_EMAIL_BUDGET_MS = 12_000;

export type DeliveryOutcome = 'sent' | 'failed' | 'skipped';

export interface ScheduledEmailRunResult {
  candidates: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
}

const toAddresses = (list?: string[]) => (list?.length ? list.map((address) => ({ address })) : undefined);

export function notLockedFilter(now: Date) {
  return { $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lte: now } }] };
}

async function claim(id: Types.ObjectId): Promise<IScheduledEmail | null> {
  const now = new Date();
  const claimed = await ScheduledEmail.findOneAndUpdate(
    { _id: id, status: ScheduledEmailStatus.Pending, ...notLockedFilter(now) },
    { $set: { lockedUntil: new Date(now.getTime() + SCHEDULED_EMAIL_LOCK_MS) } },
    { returnDocument: 'after' },
  );
  if (!claimed) return null;
  await claimed.populate([
    { path: 'user', select: 'firstName lastName email' },
    { path: 'recipients', select: 'firstName lastName email' },
  ]);
  return claimed;
}

export async function deliverScheduledEmail(record: IScheduledEmail): Promise<DeliveryOutcome> {
  const claimed = await claim(record._id as Types.ObjectId);
  if (!claimed) return 'skipped';

  const isCombined = Array.isArray(claimed.recipients);
  const people = (isCombined ? claimed.recipients! : [claimed.user])
    .map((value) => value as IUser | undefined)
    .filter((person): person is IUser => !!person?.email)
    .map((person): EmailAddress => ({ name: `${person.firstName} ${person.lastName}`, address: person.email }));

  if (!people.length) {
    await ScheduledEmail.updateOne(
      { _id: claimed._id },
      {
        status: ScheduledEmailStatus.Failed,
        lastError: isCombined ? 'None of the recipients exist any more.' : 'The recipient no longer exists.',
        $inc: { attempts: 1 },
        $unset: { lockedUntil: 1 },
      },
    );
    return 'failed';
  }

  const sender = getSenderByCompany(Company.NKSR);
  const hidden = isCombined && claimed.addressing === CombinedAddressing.Bcc;
  const extraBcc = toAddresses(claimed.bcc) ?? [];

  try {
    await emailEngine.send(
      new AdminMessageEmail(
        hidden ? sender : (isCombined ? people : people[0]),
        {
          title: claimed.title,
          subtitle: claimed.subtitle,
          contentHtml: claimed.contentHtml,
        },
        {
          from: sender,
          subject: claimed.subject || claimed.title,
          cc: toAddresses(claimed.cc),
          bcc: hidden ? [...people, ...extraBcc] : toAddresses(claimed.bcc),
          inReplyTo: claimed.inReplyTo,
          references: claimed.references?.length ? claimed.references : undefined,
        },
      ),
    );

    await ScheduledEmail.updateOne(
      { _id: claimed._id },
      {
        status: ScheduledEmailStatus.Sent,
        sentAt: new Date(),
        $inc: { attempts: 1 },
        $unset: { lastError: 1, lockedUntil: 1 },
      },
    );
    return 'sent';
  } catch (err) {
    const attempts = (claimed.attempts ?? 0) + 1;
    const giveUp = attempts >= SCHEDULED_EMAIL_MAX_ATTEMPTS;

    await ScheduledEmail.updateOne(
      { _id: claimed._id },
      {
        status: giveUp ? ScheduledEmailStatus.Failed : ScheduledEmailStatus.Pending,
        lastError: (err as Error).message,
        attempts,
        $unset: { lockedUntil: 1 },
      },
    );

    console.error('[scheduled-email] send failed', String(claimed._id), err);
    return 'failed';
  }
}

export async function deliverScheduledEmails(
  records: IScheduledEmail[],
  deadline: number,
  result: ScheduledEmailRunResult = { candidates: 0, sent: 0, failed: 0, skipped: 0, errors: [] },
): Promise<ScheduledEmailRunResult> {
  result.candidates += records.length;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < records.length && Date.now() < deadline) {
      const record = records[next++];
      const outcome = await deliverScheduledEmail(record);
      if (outcome === 'sent') result.sent += 1;
      else if (outcome === 'skipped') result.skipped += 1;
      else {
        result.failed += 1;
        result.errors.push(String(record._id));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SCHEDULED_EMAIL_CONCURRENCY, records.length) }, worker));
  return result;
}

export async function sendDueScheduledEmails(
  now: Date = new Date(),
  budgetMs: number = CRON_EMAIL_BUDGET_MS,
): Promise<ScheduledEmailRunResult> {
  const deadline = Date.now() + budgetMs;
  const result: ScheduledEmailRunResult = { candidates: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
  const seen: Types.ObjectId[] = [];

  while (Date.now() < deadline) {
    const due = await ScheduledEmail.find({
      _id: { $nin: seen },
      status: ScheduledEmailStatus.Pending,
      scheduledAt: { $lte: now },
      attempts: { $lt: SCHEDULED_EMAIL_MAX_ATTEMPTS },
      ...notLockedFilter(new Date()),
    })
      .sort({ scheduledAt: 1 })
      .limit(SCHEDULED_EMAIL_BATCH_SIZE);

    if (!due.length) break;

    due.forEach((record) => seen.push(record._id as Types.ObjectId));
    await deliverScheduledEmails(due, deadline, result);
  }

  return result;
}

export interface CreateScheduledEmailInput {
  userId?: Types.ObjectId;
  recipients?: Types.ObjectId[];
  addressing?: CombinedAddressing;
  userGroup?: Types.ObjectId;
  batchTitle?: string;
  title: string;
  subject?: string;
  subtitle?: string;
  contentHtml: string;
  contentMarkdown?: string;
  cc?: string[];
  bcc?: string[];
  onboardingAuth?: Types.ObjectId;
  inReplyTo?: string;
  references?: string[];
  scheduledAt?: Date;
  batchId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
}

function toDocument(input: CreateScheduledEmailInput) {
  return {
    user: input.userId,
    recipients: input.recipients,
    addressing: input.addressing,
    userGroup: input.userGroup,
    batchTitle: input.batchTitle,
    title: input.title,
    subject: input.subject,
    subtitle: input.subtitle,
    contentHtml: input.contentHtml,
    contentMarkdown: input.contentMarkdown,
    cc: input.cc,
    bcc: input.bcc,
    onboardingAuth: input.onboardingAuth,
    inReplyTo: input.inReplyTo,
    references: input.references,
    scheduledAt: input.scheduledAt ?? new Date(),
    status: ScheduledEmailStatus.Pending,
    batchId: input.batchId,
    createdBy: input.createdBy,
  };
}

export async function createScheduledEmail(input: CreateScheduledEmailInput): Promise<IScheduledEmail> {
  return ScheduledEmail.create(toDocument(input));
}

export async function createScheduledEmails(inputs: CreateScheduledEmailInput[]): Promise<IScheduledEmail[]> {
  return ScheduledEmail.insertMany(inputs.map(toDocument), { ordered: true }) as unknown as Promise<IScheduledEmail[]>;
}
