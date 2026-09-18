import { Types } from 'mongoose';
import { SlackConfig, ISlackConfig, SlackEvent } from '../db/models/slack-config.model';
import { OnboardingAuth, IOnboardingAuth, OnboardingExpiryReason } from '../db/models/onboarding-auth.model';
import { IUser } from '../db/models/user.model';
import { postToSlack, SlackMessage, SlackTarget, defaultBotToken } from '../lib/slack';

const LOCATION_LABELS: Record<string, string> = {
  gurugram: 'Gurugram',
  gift_city: 'GIFT City',
  dubai: 'Dubai',
};

const COMPANY_LABELS: Record<string, string> = {
  nksecurities: 'NK Securities Research',
  'nk securities research & tech': 'NKS Research & Technology',
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

export function targetOf(config: ISlackConfig): SlackTarget {
  const token = config.botToken || defaultBotToken();
  if (!token) {
    throw new Error('No Slack bot token: set DEFAULT_BOT_TOKEN, or give this channel its own token.');
  }
  return { botToken: token, channelId: config.channelId };
}

function personOf(auth: IOnboardingAuth): { name: string; email: string } {
  const user = auth.user as IUser | undefined;
  const name = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';
  return { name: name || 'Unknown', email: user?.email ?? '' };
}

function footer(auth: IOnboardingAuth): string {
  const company = COMPANY_LABELS[auth.company] ?? auth.company;
  const key = (auth.onboardingKey ?? '').split('-')[0];
  return `${company}  ·  ${LOCATION_LABELS[auth.location] ?? auth.location}  ·  \`${key}\``;
}

function rootMessage(auth: IOnboardingAuth): SlackMessage {
  return { title: `${personOf(auth).name} Onboarding` };
}

function errorRootMessage(integration: string): SlackMessage {
  return { title: `${integration} Sync Errors` };
}

async function onboardingThread(
  config: ISlackConfig,
  auth: IOnboardingAuth,
  target: SlackTarget,
): Promise<{ ts?: string; created: boolean }> {
  const key = String(config._id);
  const existing = auth.slackThreads instanceof Map ? auth.slackThreads.get(key) : undefined;
  if (existing) return { ts: existing, created: false };

  const root = await postToSlack(target, rootMessage(auth));
  if (!root.ts) return { created: false };

  const threads = auth.slackThreads instanceof Map ? new Map(auth.slackThreads) : new Map<string, string>();
  threads.set(key, root.ts);
  auth.slackThreads = threads as Map<string, string>;
  await OnboardingAuth.updateOne({ _id: auth._id }, { $set: { slackThreads: threads } });

  return { ts: root.ts, created: true };
}

async function errorThread(
  config: ISlackConfig,
  integration: string,
  target: SlackTarget,
): Promise<string | undefined> {
  const existing = config.errorThreads instanceof Map ? config.errorThreads.get(integration) : undefined;
  if (existing) return existing;

  const root = await postToSlack(target, errorRootMessage(integration));
  if (!root.ts) return undefined;

  const threads = config.errorThreads instanceof Map ? new Map(config.errorThreads) : new Map<string, string>();
  threads.set(integration, root.ts);
  await SlackConfig.updateOne({ _id: config._id }, { $set: { errorThreads: threads } });

  return root.ts;
}

async function markSent(config: ISlackConfig): Promise<void> {
  await SlackConfig.updateOne(
    { _id: config._id },
    { lastNotifiedAt: new Date(), $inc: { notifyCount: 1 }, $unset: { lastError: 1 } },
  );
}

async function deliver(
  event: SlackEvent,
  auth: IOnboardingAuth,
  message: SlackMessage,
): Promise<void> {
  try {
    const configs = await SlackConfig.find({ enabled: true, events: event });
    if (!configs.length) return;

    await Promise.all(configs.map(async (config) => {
      const target = targetOf(config);
      try {
        const thread = await onboardingThread(config, auth, target);
        await postToSlack(target, message, thread.ts);
        await markSent(config);
      } catch (err) {
        console.error('[slack-notify]', event, (err as Error).message);
        await SlackConfig.updateOne({ _id: config._id }, { lastError: (err as Error).message });
      }
    }));
  } catch (err) {
    console.error('[slack-notify] fan-out failed', err);
  }
}

async function load(onboardingAuthId: Types.ObjectId | string): Promise<IOnboardingAuth | null> {
  return OnboardingAuth.findById(onboardingAuthId)
    .populate<{ user: IUser }>('user', 'firstName lastName email');
}

export async function notifyOnboardingRegistered(onboardingAuthId: Types.ObjectId | string): Promise<void> {
  const auth = await load(onboardingAuthId);
  if (!auth) return;

  await deliver(SlackEvent.OnboardingRegistered, auth, {
    compact: true,
    emoji: ':envelope_with_arrow:',
    title: '*Invite sent*',
    fields: [
      { label: 'Expires', value: auth.expirationDate ? auth.expirationDate.toISOString().slice(0, 10) : 'no date set' },
      { label: 'Session length', value: `${Math.round((auth.ttl ?? 0) / 3600)}h` },
    ],
    context: footer(auth),
  });
}

export async function notifyOnboardingOpened(onboardingAuthId: Types.ObjectId | string): Promise<void> {
  const auth = await load(onboardingAuthId);
  if (!auth) return;

  await deliver(SlackEvent.OnboardingOpened, auth, {
    compact: true,
    emoji: ':eyes:',
    title: '*Started filling the form*',
    context: footer(auth),
  });
}

export async function notifyOnboardingCompleted(onboardingAuthId: Types.ObjectId | string): Promise<void> {
  const auth = await load(onboardingAuthId);
  if (!auth) return;

  await deliver(SlackEvent.OnboardingCompleted, auth, {
    compact: true,
    emoji: ':white_check_mark:',
    title: '*Completed* — everything submitted',
    fields: [{ label: 'Documents', value: String(auth.docCount ?? 0) }],
    context: footer(auth),
  });
}

export async function notifyOnboardingExpired(
  onboardingAuthId: Types.ObjectId | string,
  reason?: string,
): Promise<void> {
  const auth = await load(onboardingAuthId);
  if (!auth) return;
  const why = EXPIRY_REASONS[reason ?? ''] ?? 'the link is no longer usable';

  await deliver(SlackEvent.OnboardingExpired, auth, {
    compact: true,
    emoji: ':no_entry:',
    title: `*Expired* — ${why}`,
    context: auth.completed ? footer(auth) : `They need a fresh link to finish.  ·  ${footer(auth)}`,
  });
}

export async function notifyReminderSent(
  onboardingAuthId: Types.ObjectId | string,
  reminderCount: number,
): Promise<void> {
  const auth = await load(onboardingAuthId);
  if (!auth) return;

  await deliver(SlackEvent.ReminderSent, auth, {
    compact: true,
    emoji: ':bell:',
    title: `*Reminder sent* — nudge ${reminderCount}`,
    context: footer(auth),
  });
}

export async function notifySyncFailed(
  onboardingAuthId: Types.ObjectId | string,
  integration: string,
  error: string,
): Promise<void> {
  const auth = await load(onboardingAuthId);
  if (!auth) return;
  const person = personOf(auth);

  const message: SlackMessage = {
    compact: true,
    emoji: ':warning:',
    title: `*${person.name}* — ${integration} sync failed`,
    fields: [{ label: 'Error', value: error.slice(0, 300) }],
    context: `Retry from View Onboardings once it is fixed.  ·  ${footer(auth)}`,
  };

  try {
    const configs = await SlackConfig.find({ enabled: true, events: SlackEvent.SyncFailed });
    if (!configs.length) return;

    await Promise.all(configs.map(async (config) => {
      const target = targetOf(config);
      try {
        const ts = await errorThread(config, integration, target);
        await postToSlack(target, message, ts);
        await markSent(config);
      } catch (err) {
        console.error('[slack-notify] sync_failed', (err as Error).message);
        await SlackConfig.updateOne({ _id: config._id }, { lastError: (err as Error).message });
      }
    }));
  } catch (err) {
    console.error('[slack-notify] fan-out failed', err);
  }
}

export async function sendSlackTest(target: SlackTarget): Promise<void> {
  await postToSlack(target, {
    emoji: ':satellite_antenna:',
    title: 'Onboarding portal connected',
    summary: 'Each person gets one thread here, and every update replies inside it.',
  });
}
