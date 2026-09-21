import { Schema, model, Document, Types } from 'mongoose';

export type NotificationType =
  | 'invite_failed'
  | 'sheet_sync_failed'
  | 'drive_sync_failed'
  | 'sync_stranded';

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface INotification extends Document {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  onboardingAuth?: Types.ObjectId;
  user?: Types.ObjectId;
  meta?: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    type: { type: String, required: true },
    severity: { type: String, enum: ['info', 'warning', 'error'], default: 'warning' },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    onboardingAuth: { type: Schema.Types.ObjectId, ref: 'OnboardingAuth' },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    meta: { type: Schema.Types.Mixed },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

NotificationSchema.index({ read: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', NotificationSchema);
