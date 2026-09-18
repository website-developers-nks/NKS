import { Types } from 'mongoose';
import { SlackConfig, SlackEvent } from '../db/models/slack-config.model';
import { OnboardingAuth, IOnboardingAuth, OnboardingExpiryReason } from '../db/models/onboarding-auth.model';
import { IUser } from '../db/models/user.model';
import { postToSlack, SlackMessage } from '../lib/slack';

async function notify(event: SlackEvent, build: () => SlackMessage): Promise<void> {
  try {
    const configs = await SlackConfig.find({ enabled: true, events: event }).lean();
    if (!configs.length) return;

    const message = build();

    await Promise.all(configs.map(async (config) => {
      try {
        await postToSlack(config.webhookUrl, message);
        await SlackConfig.updateOne(
          { _id: config._id },
          { lastNotifiedAt: new Date(), $inc: { notifyCount: 1 }, $unset: { lastError: 1 } },
        );
      } catch (err) {
        console.error('[slack-notify]', event, (err as Error).message);
        await SlackConfig.updateOne({ _id: config._id }, { lastError: (err as Error).message });
      }
    }));
  } catch (err) {
    console.error('[slack-notify] fan-out failed', err);
  }
}

const LOCATION_LABELS: Record<string, string> = {
  gurugram: 'Gurugram',
  gift_city: 'GIFT City',
  dubai: 'Dubai',
};

const EXPIRY_REASONS: Record<string, string> = {
  [OnboardingExpiryReason.TooManyDocUploads]: 'too many document uploads',
  [OnboardingExpiryReason.TooManyPresignRequests]: 'a document was opened too many times',
  [OnboardingExpiryReason.TooManySyncRequests]: 'too many save requests',
  [OnboardingExpiryReason.TooManyFieldEdits]: 'one field was edited too many times',
  [OnboardingExpiryReason.TooManySubmitAttempts]: 'too many submission attempts',
  [OnboardingExpiryReason.LinkExpirationDatePassed]: 'the expiration date passed',
  [OnboardingExpiryReason.AdminExpired]: 'an administrator ended it',
};

function personOf(auth: IOnboardingAuth): { name: string; email: string } {
  const user = auth.user as IUser | undefined;
  const name = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';
  return { name: name || 'Unknown', email: user?.email ?? '' };
}

function baseFields(auth: IOnboardingAuth) {
  const person = personOf(auth);
  return [
    { label: 'Who', value: person.email ? `${person.name} (${person.email})` : person.name },
    { label: 'Location', value: LOCATION_LABELS[auth.location] ?? auth.location },
  ];
}

async function withUser(onboardingAuthId: Types.ObjectId | string): Promise<IOnboardingAuth | null> {
  return OnboardingAuth.findById(onboardingAuthId)
    .populate<{ user: IUser }>('user', 'firstName lastName email');
}

export async function notifyOnboardingRegistered(onboardingAuthId: Types.ObjectId | string): Promise<void> {
  const auth = await withUser(onboardingAuthId);
  if (!auth) return;

  await notify(SlackEvent.OnboardingRegistered, () => ({
    emoji: ':envelope_with_arrow:',
    text: `Onboarding sent to ${personOf(auth).name}`,
    fields: [
      ...baseFields(auth),
      { label: 'Expires', value: auth.expirationDate ? auth.expirationDate.toISOString().slice(0, 10) : 'no date set' },
    ],
  }));
}

export async function notifyOnboardingOpened(onboardingAuthId: Types.ObjectId | string): Promise<void> {
  const auth = await withUser(onboardingAuthId);
  if (!auth) return;

  await notify(SlackEvent.OnboardingOpened, () => ({
    emoji: ':eyes:',
    text: `${personOf(auth).name} started their onboarding`,
    fields: baseFields(auth),
  }));
}

export async function notifyOnboardingCompleted(onboardingAuthId: Types.ObjectId | string): Promise<void> {
  const auth = await withUser(onboardingAuthId);
  if (!auth) return;

  await notify(SlackEvent.OnboardingCompleted, () => ({
    emoji: ':white_check_mark:',
    text: `${personOf(auth).name} completed their onboarding`,
    fields: [
      ...baseFields(auth),
      { label: 'Documents', value: String(auth.docCount ?? 0) },
    ],
    context: 'Their answers and documents are filed by the next sync run.',
  }));
}

export async function notifyOnboardingExpired(
  onboardingAuthId: Types.ObjectId | string,
  reason?: string,
): Promise<void> {
  const auth = await withUser(onboardingAuthId);
  if (!auth) return;

  const why = EXPIRY_REASONS[reason ?? ''] ?? 'the link is no longer usable';

  await notify(SlackEvent.OnboardingExpired, () => ({
    emoji: ':no_entry:',
    text: `${personOf(auth).name}'s onboarding expired`,
    fields: [
      ...baseFields(auth),
      { label: 'Why', value: why },
      { label: 'Completed first', value: auth.completed ? 'yes' : 'no' },
    ],
    context: auth.completed ? undefined : 'They will need a fresh link to finish.',
  }));
}

export async function notifyReminderSent(
  onboardingAuthId: Types.ObjectId | string,
  reminderCount: number,
): Promise<void> {
  const auth = await withUser(onboardingAuthId);
  if (!auth) return;

  await notify(SlackEvent.ReminderSent, () => ({
    emoji: ':bell:',
    text: `Reminder sent to ${personOf(auth).name}`,
    fields: [
      ...baseFields(auth),
      { label: 'Reminders so far', value: String(reminderCount) },
    ],
  }));
}

export async function notifySyncFailed(
  onboardingAuthId: Types.ObjectId | string,
  integration: string,
  error: string,
): Promise<void> {
  const auth = await withUser(onboardingAuthId);
  if (!auth) return;

  await notify(SlackEvent.SyncFailed, () => ({
    emoji: ':warning:',
    text: `${integration} sync failed for ${personOf(auth).name}`,
    fields: [
      ...baseFields(auth),
      { label: 'Error', value: error.slice(0, 300) },
    ],
    context: 'Retry it from View Onboardings once the cause is fixed.',
  }));
}

export async function sendSlackTest(webhookUrl: string): Promise<void> {
  await postToSlack(webhookUrl, {
    emoji: ':satellite_antenna:',
    text: 'Onboarding portal connected',
    context: 'If you can read this, notifications will arrive here.',
  });
}
