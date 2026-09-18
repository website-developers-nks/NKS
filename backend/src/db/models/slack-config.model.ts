import { Schema, model, Document, Types } from 'mongoose';

export enum SlackEvent {
  OnboardingRegistered = 'onboarding_registered',
  OnboardingOpened = 'onboarding_opened',
  OnboardingCompleted = 'onboarding_completed',
  OnboardingExpired = 'onboarding_expired',
  ReminderSent = 'reminder_sent',
  SyncFailed = 'sync_failed',
}

export const SLACK_EVENT_LABELS: Record<SlackEvent, { label: string; hint: string }> = {
  [SlackEvent.OnboardingRegistered]: {
    label: 'Onboarding registered',
    hint: 'An invite was sent to a new joiner.',
  },
  [SlackEvent.OnboardingOpened]: {
    label: 'Onboarding opened',
    hint: 'They verified their identity and started filling the form.',
  },
  [SlackEvent.OnboardingCompleted]: {
    label: 'Onboarding completed',
    hint: 'They submitted everything.',
  },
  [SlackEvent.OnboardingExpired]: {
    label: 'Onboarding expired',
    hint: 'A link expired, was used up, or was killed by an admin.',
  },
  [SlackEvent.ReminderSent]: {
    label: 'Reminder sent',
    hint: 'A nudge went out to someone who has gone quiet.',
  },
  [SlackEvent.SyncFailed]: {
    label: 'Integration failure',
    hint: 'A sheet row or Drive upload did not go through - otherwise this fails silently.',
  },
};

export interface ISlackConfig extends Document {
  name: string;
  webhookUrl: string;
  channelLabel?: string;
  events: SlackEvent[];
  enabled: boolean;
  createdBy?: Types.ObjectId;
  lastNotifiedAt?: Date;
  lastError?: string;
  notifyCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const SlackConfigSchema = new Schema<ISlackConfig>(
  {
    name: { type: String, required: true, trim: true },
    webhookUrl: { type: String, required: true, trim: true },
    channelLabel: { type: String, trim: true },
    events: { type: [{ type: String, enum: Object.values(SlackEvent) }], default: [] },
    enabled: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastNotifiedAt: { type: Date },
    lastError: { type: String },
    notifyCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const SlackConfig = model<ISlackConfig>('SlackConfig', SlackConfigSchema);
