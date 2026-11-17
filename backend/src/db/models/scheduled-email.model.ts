import { Schema, model, Document, Types } from 'mongoose';
import { IUser } from './user.model';

export enum ScheduledEmailStatus {
  Pending = 'pending',
  Sent = 'sent',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export enum CombinedAddressing {
  To = 'to',
  Bcc = 'bcc',
}

export interface IScheduledEmail extends Document {
  user?: Types.ObjectId | IUser;
  recipients?: Array<Types.ObjectId | IUser>;
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
  scheduledAt: Date;
  status: ScheduledEmailStatus;
  attempts: number;
  sentAt?: Date;
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  lastError?: string;
  batchId?: Types.ObjectId;
  lockedUntil?: Date;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduledEmailSchema = new Schema<IScheduledEmail>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    recipients: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: undefined, index: true },
    addressing: { type: String, enum: Object.values(CombinedAddressing) },
    userGroup: { type: Schema.Types.ObjectId, ref: 'UserGroup', index: true },
    batchTitle: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    subject: { type: String, trim: true },
    subtitle: { type: String, trim: true },
    contentHtml: { type: String, required: true },
    contentMarkdown: { type: String },
    cc: { type: [String] },
    bcc: { type: [String] },
    onboardingAuth: { type: Schema.Types.ObjectId, ref: 'OnboardingAuth' },
    inReplyTo: { type: String },
    references: { type: [String] },
    scheduledAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(ScheduledEmailStatus),
      default: ScheduledEmailStatus.Pending,
      required: true,
      index: true,
    },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastError: { type: String },
    batchId: { type: Schema.Types.ObjectId, index: true },
    lockedUntil: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const ScheduledEmail = model<IScheduledEmail>('ScheduledEmail', ScheduledEmailSchema);
