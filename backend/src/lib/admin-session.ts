import { Response } from 'express';
import { User, IUser } from '../db/models/user.model';

export const ADMIN_COOKIE = 'admin-auth';

const DEFAULT_ADMIN_SESSION_HOURS = 24*7;

function resolveSessionHours(): number {
  const raw = Number(process.env.ADMIN_SESSION_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ADMIN_SESSION_HOURS;
}

export const ADMIN_SESSION_MS = resolveSessionHours() * 60 * 60 * 1000;

export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: (process.env.COOKIE_SAME_SITE_NONE === 'true' ? 'none' : 'strict') as ('none' | 'strict'),
  path: '/',
  maxAge: ADMIN_SESSION_MS,
};

export function isAdminSessionExpired(user: IUser): boolean {
  if (!user.lastLoginAt) return true;
  return Date.now() - new Date(user.lastLoginAt).getTime() > ADMIN_SESSION_MS;
}

export function clearAdminCookie(res: Response): void {
  const { maxAge, ...clearOptions } = ADMIN_COOKIE_OPTIONS;
  void maxAge;
  res.clearCookie(ADMIN_COOKIE, clearOptions);
}

export async function endAdminSession(res: Response, user: IUser): Promise<void> {
  await User.updateOne({ _id: user._id }, { $unset: { authKey: 1 } });
  clearAdminCookie(res);
}
