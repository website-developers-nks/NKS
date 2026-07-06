import { Schema, model, Document } from 'mongoose';

export enum OtpType {
  Onboarding = 'onboarding',
}

export interface IOtp extends Document {
  type: OtpType;
  key: string;
  onboardingKey: string;
  otp: string;
  ttl: number;
  resendCount: number;
  attempts: number;
  verified: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OtpSchema = new Schema<IOtp>(
  {
    type: { type: String, enum: Object.values(OtpType), required: true },
    key: { type: String, required: true, unique: true },
    onboardingKey: { type: String, required: true, index: true },
    otp: { type: String, required: true },
    ttl: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    resendCount: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    verified: { type: Boolean, default: false }
  },
  { timestamps: true },
);

OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Otp = model<IOtp>('Otp', OtpSchema);
