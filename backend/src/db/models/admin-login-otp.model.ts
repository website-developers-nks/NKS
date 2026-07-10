import { Schema, model, Document, Types } from 'mongoose';

// One-time codes for the admin login 2FA step - emailed to ADMIN_OTP_EMAIL
// (not the admin's own address) after a correct username/password.
export interface IAdminLoginOtp extends Document {
  userId: Types.ObjectId;
  otp: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminLoginOtpSchema = new Schema<IAdminLoginOtp>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    otp: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

AdminLoginOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminLoginOtp = model<IAdminLoginOtp>('AdminLoginOtp', AdminLoginOtpSchema);
