import { Schema, model, Document, Types } from 'mongoose';

export interface IMessageTemplate extends Document {
  name: string;
  content: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MessageTemplateSchema = new Schema<IMessageTemplate>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    content: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const MessageTemplate = model<IMessageTemplate>('MessageTemplate', MessageTemplateSchema);
