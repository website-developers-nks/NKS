import { Schema, model, Document, Types } from 'mongoose';

export interface IUserGroup extends Document {
  name: string;
  description?: string;
  members: Types.ObjectId[];
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const UserGroupSchema = new Schema<IUserGroup>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true },
    members: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [], index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const UserGroup = model<IUserGroup>('UserGroup', UserGroupSchema);
