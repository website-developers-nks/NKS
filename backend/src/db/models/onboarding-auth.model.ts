import { Schema, model, Document, Types } from 'mongoose';
import { IUser } from './user.model';

export enum OfficeLocation {
  Gurugram = 'gurugram',
  GiftCity = 'gift_city',
  Dubai = 'dubai',
}

export enum Company {
  NKSR = 'nksecurities',
  NKSRT = 'nk securities research & tech',
}

export interface IOnboardingAuth extends Document {
  authKey?: string;
  onboardingKey: string;
  user: Types.ObjectId | IUser;
  ttl: number;
  expirationDate?: Date;
  company: Company;
  lastVerified?: Date;
  otpSendCount: number;
  onboardingDataId?: Types.ObjectId;
  completed: boolean;
  location: OfficeLocation;
  docCount: number;
  expired: boolean;
  syncRequestCount: number;
  submitAttempts: number;
  lastActivityAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OnboardingAuthSchema = new Schema<IOnboardingAuth>(
  {
    authKey: { type: String, unique: true, sparse: true },
    onboardingKey: { type: String, required: true, unique: true, index:true },
    ttl: { type: Number, required: true },
    expirationDate: { type: Date },
    company: { type: String, enum: Object.values(Company), required: true },
    otpSendCount: { type: Number, default: 0 },
    lastVerified: { type: Date },
    onboardingDataId: { type: Schema.Types.ObjectId, ref: 'OnboardingData' },
    completed: { type: Boolean, default: false },
    location: { type: String, enum: Object.values(OfficeLocation), required: true },
    docCount: { type: Number, default: 0 },
    expired: { type: Boolean, default: false },
    syncRequestCount: { type: Number, default: 0 },
    submitAttempts: { type: Number, default: 0 },
    lastActivityAt: { type: Date },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

export const OnboardingAuth = model<IOnboardingAuth>('OnboardingAuth', OnboardingAuthSchema);
