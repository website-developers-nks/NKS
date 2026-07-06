import { Request, Response, NextFunction } from 'express';
import { OnboardingAuth, IOnboardingAuth } from '../db/models/onboarding-auth.model';
import { IUser } from '../db/models/user.model';

export interface OnboardingAuthPayload {
  auth: IOnboardingAuth;
  user: IUser;
}

declare global {
  namespace Express {
    interface Request {
      onboarding?: OnboardingAuthPayload;
    }
  }
}

const COOKIE_NAME = 'onboarding-auth';
const SESSION_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function requireOnboardingAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cookieKey = req.cookies?.[COOKIE_NAME];
  const { id } = req.query;
  if (!id){
    res.status(401).json({ error: 'Unauthorized.', reason: 'no_onboarding_key' });
    return;
  }
  if (!cookieKey) {
    res.status(401).json({ error: 'Unauthorized.', reason: 'no_cookie' });
    return;
  }

  const record = await OnboardingAuth.findOne({ authKey: cookieKey }).populate<{ user: IUser }>('user');
  if (!record) {
    res.status(401).json({ error: 'Unauthorized.', reason: 'not_found' });
    return;
  }

  if (record.completed) {
    res.status(401).json({ error: 'Unauthorized.', reason: 'completed' });
    return;
  }

  if (!record.lastVerified) {
    res.status(401).json({ error: 'Unauthorized.', reason: 'unverified' });
    return;
  }

  if (record.onboardingKey !== id) {
    res.status(401).json({ error: 'Unauthorized.', reason: 'key_mismatch' });
    return;
  }

  if(record.expired){
    res.status(401).json({ error: 'Unauthorized.', reason: 'expired' });
    return;
  }

  const elapsedSeconds = (Date.now() - record.lastVerified.getTime()) / 1000;
  if (elapsedSeconds > record.ttl) {
    res.status(401).json({ error: 'Unauthorized.', reason: 'ttl_expired' });
    return;
  }

  if (record.lastActivityAt) {
    const inactiveMs = Date.now() - record.lastActivityAt.getTime();
    if (inactiveMs > SESSION_INACTIVITY_TIMEOUT_MS) {
      await OnboardingAuth.updateOne(
        { _id: record._id },
        { $unset: { authKey: 1, lastVerified: 1, lastActivityAt: 1 } }
      );
      res.clearCookie(COOKIE_NAME, { path: '/' });
      res.status(401).json({ error: 'Session expired due to inactivity.', reason: 'session_inactive' });
      return;
    }
  }

  req.onboarding = { auth: record, user: record.user as IUser };

  OnboardingAuth.updateOne({ _id: record._id }, { $set: { lastActivityAt: new Date() } }).catch(() => {});

  next();
}
