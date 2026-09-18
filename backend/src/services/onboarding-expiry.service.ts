import { Types } from 'mongoose';
import { OnboardingAuth, OnboardingExpiryReason } from '../db/models/onboarding-auth.model';
import { notifyOnboardingExpired } from './slack-notify.service';

export async function expireOnboarding(
  onboardingAuthId: Types.ObjectId | string,
  reason: OnboardingExpiryReason,
  expiredBy?: Types.ObjectId,
): Promise<boolean> {
  const update = await OnboardingAuth.updateOne(
    { _id: onboardingAuthId, expired: { $ne: true } },
    {
      $set: {
        expired: true,
        expiredReason: reason,
        expiredAt: new Date(),
        ...(expiredBy ? { expiredBy } : {}),
      },
    },
  );

  const transitioned = update.modifiedCount > 0;
  if (transitioned) {
    await notifyOnboardingExpired(onboardingAuthId, reason);
  }
  return transitioned;
}
