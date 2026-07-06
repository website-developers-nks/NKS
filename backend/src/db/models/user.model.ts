import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  firstName: string;
  lastName: string;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
  profile?: string;
  authKey?: string;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    isAdmin: { type: Boolean, default:false, required: true },
    authKey: { type:String }
  },
  { timestamps: true },
);

export const User = model<IUser>('User', UserSchema);
