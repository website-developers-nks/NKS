import { Request, Response, NextFunction } from 'express';
import { User, IUser } from '../db/models/user.model';
import { Permission, PermissionGroup } from '../db/models/permission-group.model';
import { ADMIN_COOKIE, isAdminSessionExpired, endAdminSession } from '../lib/admin-session';

declare global {
  namespace Express {
    interface Request {
      admin?: IUser;
      adminPermissions?: Permission[];
    }
  }
}

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

  if (isAdminSessionExpired(user)) {
    await endAdminSession(res, user);
    res.status(401).json({ error: 'Your session has expired. Please log in again.', reason: 'session_expired' });
    return;
  }

  req.admin = user;
  next();
}

export async function getAdminPermissions(admin: IUser): Promise<Permission[]> {
  if (!admin.permissionGroup) return [];

  const group = await PermissionGroup.findById(admin.permissionGroup).lean();
  return (group?.permissions ?? []) as Permission[];
}

export function requirePermission(...allowed: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const admin = req.admin;

    if (!admin) {
      res.status(401).json({ error: 'Unauthorized.', reason: 'no_cookie' });
      return;
    }

    const permissions = req.adminPermissions ?? (await getAdminPermissions(admin));
    req.adminPermissions = permissions;

    if (!permissions.length) {
      res.status(403).json({
        error: 'No permission group is assigned to your account. Ask another admin to assign one.',
        reason: 'no_permission_group',
      });
      return;
    }

    if (!allowed.some((permission) => permissions.includes(permission))) {
      res.status(403).json({
        error: 'You do not have permission to do this.',
        reason: 'missing_permission',
        required: allowed,
      });
      return;
    }

    next();
  };
}
