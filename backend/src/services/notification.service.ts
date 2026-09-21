import { Types } from 'mongoose';
import { Notification, NotificationType, NotificationSeverity } from '../db/models/notification.model';
import { SlackConfig, SlackEvent } from '../db/models/slack-config.model';
import { postToSlack } from '../lib/slack';
import { targetOf } from './slack-notify.service';

interface NotificationInput {
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  onboardingAuth?: Types.ObjectId;
  user?: Types.ObjectId;
  meta?: Record<string, unknown>;
}

const SLACK_EMOJI: Record<NotificationSeverity, string> = {
  info: ':information_source:',
  warning: ':warning:',
  error: ':rotating_light:',
};

export async function recordNotification(input: NotificationInput): Promise<void> {
  const severity = input.severity ?? 'warning';

  try {
    await Notification.create({
      type: input.type,
      severity,
      title: input.title,
      message: input.message,
      onboardingAuth: input.onboardingAuth,
      user: input.user,
      meta: input.meta,
    });
  } catch (err) {
    console.error('[notification] persist failed', err);
  }

  try {
    const configs = await SlackConfig.find({ enabled: true, events: SlackEvent.SyncFailed });
    if (!configs.length) return;

    await Promise.all(configs.map(async (config) => {
      try {
        await postToSlack(targetOf(config), {
          compact: true,
          emoji: SLACK_EMOJI[severity],
          title: `*${input.title}*`,
          context: input.message.slice(0, 300),
        });
      } catch (err) {
        console.error('[notification] slack broadcast failed', (err as Error).message);
      }
    }));
  } catch (err) {
    console.error('[notification] slack fan-out failed', err);
  }
}
