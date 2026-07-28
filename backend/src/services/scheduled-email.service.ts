import { Types } from 'mongoose';
import { ScheduledEmail, IScheduledEmail, ScheduledEmailStatus } from '../db/models/scheduled-email.model';
import { IUser } from '../db/models/user.model';
import { Company } from '../db/models/onboarding-auth.model';
import { emailEngine, getSenderByCompany } from '../email';
import { AdminMessageEmail } from '../email/emails/admin-message.email';

export const SCHEDULED_EMAIL_BATCH_SIZE = 20;

export const SCHEDULED_EMAIL_MAX_ATTEMPTS = 3;

export interface ScheduledEmailRunResult {
  candidates: number;
  sent: number;
  failed: number;
  errors: string[];
}

const toAddresses = (list?: string[]) => (list?.length ? list.map((address) => ({ address })) : undefined);

export async function deliverScheduledEmail(record: IScheduledEmail): Promise<boolean> {
  const user = record.user as IUser | undefined;

  if (!user?.email) {
    await ScheduledEmail.updateOne(
      { _id: record._id },
      {
        status: ScheduledEmailStatus.Failed,
        lastError: 'The recipient no longer exists.',
        $inc: { attempts: 1 },
      },
    );
    return false;
  }

  try {
    await emailEngine.send(
      new AdminMessageEmail(
        { name: `${user.firstName} ${user.lastName}`, address: user.email },
        {
          title: record.title,
          subtitle: record.subtitle,
          contentHtml: record.contentHtml,
        },
        {
          from: getSenderByCompany(Company.NKSR),
          subject: record.subject || record.title,
          cc: toAddresses(record.cc),
          bcc: toAddresses(record.bcc),
          inReplyTo: record.inReplyTo,
          references: record.references?.length ? record.references : undefined,
        },
      ),
    );

    await ScheduledEmail.updateOne(
      { _id: record._id },
      {
        status: ScheduledEmailStatus.Sent,
        sentAt: new Date(),
        $inc: { attempts: 1 },
        $unset: { lastError: 1 },
      },
    );
    return true;
  } catch (err) {
    const attempts = (record.attempts ?? 0) + 1;
    const giveUp = attempts >= SCHEDULED_EMAIL_MAX_ATTEMPTS;

    await ScheduledEmail.updateOne(
      { _id: record._id },
      {
        status: giveUp ? ScheduledEmailStatus.Failed : ScheduledEmailStatus.Pending,
        lastError: (err as Error).message,
        attempts,
      },
    );

    console.error('[scheduled-email] send failed', String(record._id), err);
    return false;
  }
}

export async function sendDueScheduledEmails(now: Date = new Date()): Promise<ScheduledEmailRunResult> {
  const due = await ScheduledEmail.find({
    status: ScheduledEmailStatus.Pending,
    scheduledAt: { $lte: now },
    attempts: { $lt: SCHEDULED_EMAIL_MAX_ATTEMPTS },
  })
    .sort({ scheduledAt: 1 })
    .limit(SCHEDULED_EMAIL_BATCH_SIZE)
    .populate<{ user: IUser }>('user', 'firstName lastName email');

  const result: ScheduledEmailRunResult = { candidates: due.length, sent: 0, failed: 0, errors: [] };

  for (const record of due) {
    const ok = await deliverScheduledEmail(record);
    if (ok) {
      result.sent += 1;
    } else {
      result.failed += 1;
      result.errors.push(String(record._id));
    }
  }

  return result;
}

export interface CreateScheduledEmailInput {
  userId: Types.ObjectId;
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
  createdBy?: Types.ObjectId;
}

export async function createScheduledEmail(input: CreateScheduledEmailInput): Promise<IScheduledEmail> {
  return ScheduledEmail.create({
    user: input.userId,
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
    createdBy: input.createdBy,
  });
}
