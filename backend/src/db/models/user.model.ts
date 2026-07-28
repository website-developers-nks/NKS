import { Schema, model, Document, Types } from 'mongoose';
import { IPermissionGroup } from './permission-group.model';

export interface IUser extends Document {
  email: string;
  firstName: string;
  lastName: string;
  isAdmin: boolean;
  permissionGroup?: Types.ObjectId | IPermissionGroup;
  passwordHash?: string;
  passwordChangedAt?: Date;
  mustChangePassword?: boolean;
  lastLoginAt?: Date;
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
    permissionGroup: { type: Schema.Types.ObjectId, ref: 'PermissionGroup' },
    passwordHash: { type: String },
    passwordChangedAt: { type: Date },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    authKey: { type:String }
  },
  { timestamps: true },
);

export const User = model<IUser>('User', UserSchema);
