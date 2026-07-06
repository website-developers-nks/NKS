import { Request, Response, NextFunction } from 'express';
import { User, IUser } from '../db/models/user.model';

declare global {
  namespace Express {
    interface Request {
      admin?: IUser;
    }
  }
}

const ADMIN_COOKIE = 'admin-auth';

export async function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cookieKey = req.cookies?.[ADMIN_COOKIE];

  if (!cookieKey) {
    res.status(401).json({ error: 'Unauthorized.', reason: 'no_cookie' });
    return;
  }

  const user = await User.findOne({ authKey: cookieKey });

  if (!user) {
    res.status(401).json({ error: 'Unauthorized.', reason: 'not_found' });
    return;
  }

  if (!user.isAdmin) {
    res.status(403).json({ error: 'Forbidden.', reason: 'not_admin' });
    return;
  }

  req.admin = user;
  next();
}
