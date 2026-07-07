import { Schema, model, Document, Types } from 'mongoose';
import { IUser } from './user.model';

export interface IAdminAttachment extends Document {
  uploadedBy: Types.ObjectId | IUser;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
  createdAt: Date;
  updatedAt: Date;
}

const AdminAttachmentSchema = new Schema<IAdminAttachment>(
  {
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    path: { type: String, required: true },
  },
  { timestamps: true },
);

export const AdminAttachment = model<IAdminAttachment>('AdminAttachment', AdminAttachmentSchema);
