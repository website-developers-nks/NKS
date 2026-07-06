import { randomBytes, randomInt, randomUUID } from 'crypto';
import { OnboardingAuth } from '../db/models/onboarding-auth.model';
import { Otp, OtpType } from '../db/models/otp.model';
import { IUser } from '../db/models/user.model';
import { getEmailEngineByCompany, getSenderByCompany } from '../email';
import { OtpEmail } from '../email/emails/otp.email';

const OTP_TTL_SECONDS = Number(process.env.OTP_TTL ?? 600);
const RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN ?? 60);
const MAX_RESENDS = Number(process.env.OTP_MAX_RESENDS ?? 5);
const MAX_OTP_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  profile?: string;
}

export interface VerifyResult {
  auth: true;
  newKey: string;
  authId: string;
  onboardingDataId?: string;
  user: UserProfile;
}

export interface VerifyFailure {
  auth: false;
  reason: 'no_cookie' | 'not_found' | 'ttl_expired' | 'expired' | 'key_mismatch' | 'unverified' | 'completed';
}

export type OnboardingVerifyOutcome = VerifyResult | VerifyFailure;

export type SendOtpResult =
  | { sent: true; resendCount: number; nextResendAt: string }
  | { sent: false; reason: 'too_soon'; nextResendAt: string; resendCount: number }
  | { sent: false; reason: 'max_resends'; resendCount: number }
  | { sent: false; reason: 'expired' }
  | { sent: false; reason: 'completed' };

export async function verifyOnboardingAuth(
  cookieKey: string | undefined,
  id: string,
): Promise<OnboardingVerifyOutcome> {
  if (!cookieKey) return { auth: false, reason: 'no_cookie' };

  const record = await OnboardingAuth.findOne({ authKey: cookieKey }).populate<{ user: IUser }>('user');
  
  if (!record) return { auth: false, reason: 'not_found' };
  if (record.onboardingKey !== id) return { auth: false, reason: 'key_mismatch' };
  if (record.expired) return { auth: false, reason: 'expired' };
  if (record.expirationDate && record.expirationDate.getTime() < Date.now()) {
    await OnboardingAuth.updateOne({ _id: record._id }, { expired: true });
    return { auth: false, reason: 'expired' };
  }
  if (!record.lastVerified) return { auth: false, reason: 'unverified' };
  const elapsedSeconds = (Date.now() - record.lastVerified.getTime()) / 1000;
  if (elapsedSeconds > record.ttl) return { auth: false, reason: 'ttl_expired' };
  if (record.completed) return { auth: false, reason: 'completed' };
  

  const newKey = randomBytes(32).toString('hex');
  await OnboardingAuth.updateOne({ _id: record._id }, { authKey: newKey });

  const u = record.user as IUser;
  return {
    auth: true,
    newKey,
    authId: (record._id as object).toString(),
    onboardingDataId: record.onboardingDataId?.toString(),
    user: {
      id: (u._id as object).toString(),
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      profile: u.profile,
    },
  };
}

export type VerifyOtpResult =
  | { verified: true; authKey: string }
  | { verified: false; reason: 'not_found' | 'completed' | 'link_expired' | 'expired' | 'max_attempts' | 'invalid_otp' };

export async function verifyOnboardingOtp(
  onboardingKey: string,
  otp: string,
): Promise<VerifyOtpResult> {
  const auth = await OnboardingAuth.findOne({ onboardingKey });
  if (!auth) return { verified: false, reason: 'not_found' };
  if (auth.expired) return { verified: false, reason: 'link_expired' };
  if (auth.completed) return { verified: false, reason: 'completed' };

  const validOtps = await Otp.find({
    onboardingKey,
    verified: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (validOtps.length === 0) return { verified: false, reason: 'expired' };

  if (validOtps[0].attempts >= MAX_OTP_ATTEMPTS) return { verified: false, reason: 'max_attempts' };

  const matched = validOtps.find((o) => o.otp === otp);

  if (!matched) {
    await Otp.updateMany({ onboardingKey, verified: false }, { $inc: { attempts: 1 } });
    return { verified: false, reason: 'invalid_otp' };
  }

  const authKey = randomBytes(32).toString('hex');

  await Promise.all([
    Otp.deleteMany({ onboardingKey }),
    OnboardingAuth.updateOne({ _id: auth._id }, { authKey, lastVerified: new Date(), otpSendCount: 0 }),
  ]);

  return { verified: true, authKey };
}

export type OtpStatusResult =
  | { hasActiveOtp: true; expiresAt: string; resendCount: number; nextResendAt: string | null }
  | { hasActiveOtp: false }
  | { completed: true }
  | { linkExpired: true };

export async function checkOtpStatus(onboardingKey: string): Promise<OtpStatusResult> {
  const auth = await OnboardingAuth.findOne({ onboardingKey });
  if(!auth) return { linkExpired: true };
  if (auth?.expired) return { linkExpired: true };
  if (auth?.completed) return { completed: true };

  const latestOtp = await Otp.findOne({
    onboardingKey,
    verified: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!latestOtp) return { hasActiveOtp: false };

  const resendCount = auth?.otpSendCount ?? 0;

  const resendTime = RESEND_COOLDOWN_SECONDS * resendCount;
  const secondsSinceLast = (Date.now() - latestOtp.createdAt.getTime()) / 1000;
  const nextResendAt = secondsSinceLast < resendTime
    ? new Date(latestOtp.createdAt.getTime() + resendTime * 1000).toISOString()
    : null;

  return {
    hasActiveOtp: true,
    expiresAt: latestOtp.expiresAt.toISOString(),
    resendCount,
    nextResendAt,
  };
}

export async function sendOnboardingOtp(onboardingKey: string): Promise<SendOtpResult> {
  const auth = await OnboardingAuth.findOne({ onboardingKey }).populate<{ user: IUser }>('user');
  if (!auth) throw new Error('Invalid onboarding key.');

  const now = Date.now();

  if (auth.expired) {
    return { sent: false, reason: 'expired' };
  }

  if (auth.completed) {
    return { sent: false, reason: 'completed' };
  }

  const lastVerified = auth.lastVerified?.getTime() ?? 0;
  if (lastVerified){
    const lastAuthSuccess = (now-lastVerified)/1000;
    if(lastAuthSuccess<RESEND_COOLDOWN_SECONDS){
      const nextResendAt = new Date(lastVerified + RESEND_COOLDOWN_SECONDS * 1000).toISOString();
      await OnboardingAuth.updateOne({ _id: auth._id }, { $unset: { authKey: 1 } });
      return { sent: false, reason: 'too_soon', nextResendAt, resendCount: 0 };
    }
  }
  const latestOtp = await Otp.findOne({ onboardingKey }).sort({ createdAt: -1 });
  if (latestOtp) {
    const secondsSinceLast = (now - latestOtp.createdAt.getTime()) / 1000;
    const resendTime = RESEND_COOLDOWN_SECONDS * auth.otpSendCount
    if (secondsSinceLast < resendTime) {
      const nextResendAt = new Date(latestOtp.createdAt.getTime() + resendTime * 1000).toISOString();
      await OnboardingAuth.updateOne({ _id: auth._id }, { $unset: { authKey: 1 } });
      return { sent: false, reason: 'too_soon', nextResendAt, resendCount: auth.otpSendCount };
    }
  }

  if (auth.otpSendCount >= MAX_RESENDS) {
    await OnboardingAuth.updateOne({ _id: auth._id }, { $unset: { authKey: 1 } });
    return { sent: false, reason: 'max_resends', resendCount: auth.otpSendCount };
  }

  const otpCode = randomInt(100000, 999999).toString();
  const expiresAt = new Date(now + OTP_TTL_SECONDS * 1000);
  const newSendCount = auth.otpSendCount + 1;

  await Otp.create({
    type: OtpType.Onboarding,
    key: randomUUID(),
    onboardingKey,
    otp: otpCode,
    ttl: OTP_TTL_SECONDS,
    expiresAt,
    resendCount: auth.otpSendCount,
  });

  await OnboardingAuth.updateOne({ _id: auth._id }, { $set: { otpSendCount: newSendCount }, $unset: { authKey: 1 } });

  const user = auth.user as IUser;
  const sender = getSenderByCompany(auth.company);
  await getEmailEngineByCompany(auth.company).send(
    new OtpEmail(
      { name: `${user.firstName} ${user.lastName}`, address: user.email },
      { otp: otpCode, expiresInMinutes: Math.floor(OTP_TTL_SECONDS / 60), purpose: 'onboarding' },
      { from: sender },
    ),
  );
  const nextResendAt = new Date(now + RESEND_COOLDOWN_SECONDS * 1000).toISOString();
  return { sent: true, resendCount: newSendCount, nextResendAt };
}
