import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID, randomInt } from 'crypto';
import { Types } from 'mongoose';
import rateLimit from 'express-rate-limit';
import sanitizeHtml from 'sanitize-html';
import multer from 'multer';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { User, IUser } from '../db/models/user.model';
import { OnboardingAuth, IOnboardingAuth, OfficeLocation, Company, OnboardingExpiryReason } from '../db/models/onboarding-auth.model';
import { OnboardingData } from '../db/models/onboarding-data.model';
import { Doc } from '../db/models/doc.model';
import { AdminLoginOtp } from '../db/models/admin-login-otp.model';
import { Permission, PermissionGroup, IPermissionGroup } from '../db/models/permission-group.model';
import { MessageTemplate } from '../db/models/message-template.model';
import { ScheduledEmail, ScheduledEmailStatus } from '../db/models/scheduled-email.model';
import { SheetConfig } from '../db/models/sheet-config.model';
import { requireAdminAuth, requirePermission } from '../middleware/admin-auth.middleware';
import { ADMIN_COOKIE, ADMIN_COOKIE_OPTIONS, isAdminSessionExpired, endAdminSession, clearAdminCookie } from '../lib/admin-session';
import { emailEngine, getEmailEngineByCompany, getSenderByCompany } from '../email';
import { OnboardingInviteEmail } from '../email/emails/onboarding-invite.email';
import { OtpEmail } from '../email/emails/otp.email';
import { AdminCredentialsEmail } from '../email/emails/admin-credentials.email';
import { generatePassword, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../lib/password';
import { getCompanyName } from '../email/base.email';
import { r2, R2_BUCKET } from '../lib/r2';
import { buildOnboardingExportHtml } from '../services/onboarding-export.service';
import { createScheduledEmail, deliverScheduledEmail } from '../services/scheduled-email.service';
import { sendReminderFor } from '../services/onboarding-reminder.service';
import { isGoogleSheetsConfigured, parseSpreadsheetId, getSpreadsheetInfo } from '../lib/google-sheets';
import {
  uploadAdminAttachment,
  deleteAdminAttachment,
  resolveAdminAttachments,
  MAX_ADMIN_ATTACHMENT_BYTES,
  MAX_ADMIN_ATTACHMENTS_PER_EMAIL,
} from '../services/admin-attachment.service';

const router = Router();

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ADMIN_ATTACHMENT_BYTES },
});

function parseSingleAttachment(req: Request, res: Response, next: NextFunction) {
  attachmentUpload.single('file')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: `File must be ${MAX_ADMIN_ATTACHMENT_BYTES / (1024 * 1024)}MB or smaller.` });
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

const ONBOARDING_DOC_FIELDS = [
  'panDoc', 'idDoc', 'addressDoc', 'photoDoc',
  'higherSecondaryDoc', 'highestDegreeDoc',
  'resumeDoc', 'offerLetterDoc', 'lastIncrementDoc',
  'salarySlipDoc', 'bonusLetterDoc', 'experienceLetterDoc', 'relievingLetterDoc',
  'bankDoc',
];

type OnboardingStatus = 'pending' | 'completed' | 'expired';
const ONBOARDING_STATUS_ORDER: Record<OnboardingStatus, number> = { pending: 0, expired: 1, completed: 2 };

const EXTRA_CONTENT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'del', 'code', 'pre',
    'ul', 'ol', 'li', 'blockquote',
    'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'style'],
    '*': ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-fA-F]{3,6}$/],
      'background-color': [/^#[0-9a-fA-F]{3,6}$/],
      background: [/^none$/, /^#[0-9a-fA-F]{3,6}$/],
      'font-family': [/^[a-zA-Z, ]+$/],
      'font-size': [/^\d+(?:px|em)$/],
      margin: [/^[\d\s.]+(?:px|em)?$/],
      padding: [/^\d+px$/],
      'padding-left': [/^\d+px$/],
      border: [/^none$/, /^.+$/],
      'border-top': [/^.+$/],
      'border-left': [/^.+$/],
      'border-collapse': [/^collapse$/],
      'border-radius': [/^\d+px$/],
      'overflow-x': [/^auto$/],
      width: [/^100%$/],
      'text-align': [/^left$/],
    },
  },
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

async function checkAdminPassword(user: IUser, password: string): Promise<boolean> {
  if (user.passwordHash) return verifyPassword(password, user.passwordHash);

  return false;
}

async function serializeAdminSession(user: IUser) {
  const group = user.permissionGroup
    ? await PermissionGroup.findById(user.permissionGroup).lean()
    : null;

  return {
    id: (user._id as object).toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isAdmin: user.isAdmin,
    permissions: group?.permissions ?? [],
    permissionGroup: group ? { id: group._id.toString(), name: group.name } : null,
    mustChangePassword: user.mustChangePassword === true,
  };
}

router.post('/create-user', requireAdminAuth, requirePermission(Permission.ManageUsers), async (req: Request, res: Response) => {
  const { email, firstName, lastName, isAdmin, permissionGroupId } = req.body as {
    email?: string;
    firstName?: string;
    lastName?: string;
    isAdmin?: boolean;
    permissionGroupId?: string;
  };

  if (!email || !firstName || !lastName) {
    res.status(400).json({ error: 'email, firstName and lastName are required.' });
    return;
  }

  const makeAdmin = isAdmin === true;

  if (makeAdmin && !permissionGroupId) {
    res.status(400).json({ error: 'A permission group is required for admin users.' });
    return;
  }

  if (makeAdmin && !Types.ObjectId.isValid(permissionGroupId!)) {
    res.status(400).json({ error: 'Invalid permission group.' });
    return;
  }

  if (makeAdmin) {
    const group = await PermissionGroup.findById(permissionGroupId);
    if (!group) {
      res.status(404).json({ error: 'Permission group not found.' });
      return;
    }
  }

  const password = makeAdmin ? generatePassword() : null;

  let user;
  try {
    user = await User.create({
      email,
      firstName,
      lastName,
      isAdmin: makeAdmin,
      permissionGroup: makeAdmin ? permissionGroupId : undefined,
      passwordHash: password ? await hashPassword(password) : undefined,
      mustChangePassword: makeAdmin,
    });
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 11000) {
      res.status(409).json({ error: 'A user with this email already exists.' });
      return;
    }
    console.error('[admin/create-user]', err);
    res.status(500).json({ error: 'Failed to create user.' });
    return;
  }

  if (password) {
    try {
      await emailEngine.send(
        new AdminCredentialsEmail(
          { name: `${user.firstName} ${user.lastName}`, address: user.email },
          {
            firstName: user.firstName,
            email: user.email,
            password,
            adminUrl: process.env.ADMIN_BASE_URL ? `${process.env.ADMIN_BASE_URL}/administrator.html` : undefined,
          },
          { from: getSenderByCompany(Company.NKSR) },
        ),
      );
    } catch (err) {
      console.error('[admin/create-user] credentials email failed, rolling back', err);
      await User.deleteOne({ _id: user._id });
      res.status(502).json({ error: "The user was not created: their password email couldn't be sent." });
      return;
    }
  }

  res.status(201).json({
    id: (user._id as object).toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isAdmin: user.isAdmin,
  });
});

router.post('/register-onboarding', requireAdminAuth, requirePermission(Permission.ManageOnboardings), async (req: Request, res: Response) => {
  const { userId, ttl, location, company, cc, bcc, extraContent, extraContentMarkdown, expirationDate, attachmentIds, sheetId } = req.body as {
    userId?: string;
    ttl?: number;
    location?: string;
    company?: string;
    cc?: string | string[];
    bcc?: string | string[];
    extraContent?: string;
    extraContentMarkdown?: string;
    expirationDate?: string;
    attachmentIds?: string[];
    sheetId?: string;
  };

  const validLocations = Object.values(OfficeLocation);
  const validCompanies = Object.values(Company);

  if (!userId || !ttl || typeof ttl !== 'number' || ttl <= 0) {
    res.status(400).json({ error: 'userId and a positive numeric ttl are required.' });
    return;
  }

  if (attachmentIds !== undefined && (!Array.isArray(attachmentIds) || attachmentIds.length > MAX_ADMIN_ATTACHMENTS_PER_EMAIL)) {
    res.status(400).json({ error: `attachmentIds must be an array of at most ${MAX_ADMIN_ATTACHMENTS_PER_EMAIL} ids.` });
    return;
  }

  if (!company || !validCompanies.includes(company as Company)) {
    res.status(400).json({ error: 'company is required.', validCompanies });
    return;
  }

  if (!location || !validLocations.includes(location as OfficeLocation)) {
    res.status(400).json({ error: 'location is required.', validLocations });
    return;
  }

  if (!expirationDate || Number.isNaN(Date.parse(expirationDate))) {
    res.status(400).json({ error: 'A valid expirationDate is required.' });
    return;
  }

  const parsedExpirationDate = new Date(expirationDate);
  if (parsedExpirationDate.getTime() <= Date.now()) {
    res.status(400).json({ error: 'expirationDate must be in the future.' });
    return;
  }

  if (!Types.ObjectId.isValid(userId)) {
    res.status(400).json({ error: 'Invalid userId format.' });
    return;
  }

  const user = await User.findById(userId);
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  if (sheetId) {
    if (!Types.ObjectId.isValid(sheetId)) {
      res.status(400).json({ error: 'Invalid sheet.' });
      return;
    }
    if (!(await SheetConfig.exists({ _id: sheetId }))) {
      res.status(404).json({ error: 'That Google Sheet is no longer set up.' });
      return;
    }
  }
  let attachments;
  if (attachmentIds?.length) {
    try {
      attachments = await resolveAdminAttachments(attachmentIds, req.admin!._id as Types.ObjectId);
    } catch (err) {
      console.error('[admin/register-onboarding] attachment resolution failed', err);
      res.status(400).json({ error: 'One or more attachments could not be found. Please re-attach and try again.' });
      return;
    }
  }

  try {
    const onboardingKey = randomUUID();
    const toArray = (v: string | string[] | undefined) => (v ? (Array.isArray(v) ? v : [v]) : undefined);

    const auth = await OnboardingAuth.create({
      onboardingKey,
      user: user._id,
      ttl,
      location: location as OfficeLocation,
      company: company as Company,
      expirationDate: parsedExpirationDate,
      cc: toArray(cc),
      bcc: toArray(bcc),
      extraContent: extraContentMarkdown,
      sheetConfig: sheetId || undefined,
    });

    const baseUrl = company == Company.NKSRT ? (process.env.ONBOARDING_BASE_URL_DUBAI??"https://nksresearchtech.com")  : (process.env.ONBOARDING_BASE_URL ?? 'https://nksecurities.com');
    const onboardingUrl = `${baseUrl}/verify-onboarding.html?id=${onboardingKey}`;

    const toAddr = (v: string) => ({ address: v });
    const normalizeAddr = (v: string | string[] | undefined) =>
      v ? (Array.isArray(v) ? v.map(toAddr) : toAddr(v)) : undefined;

    const sender = getSenderByCompany(auth.company);
    const inviteSubject = `${user.firstName} ${user.lastName} | Complete your onboarding - ${getCompanyName(auth.company)}`;

    const invite = await getEmailEngineByCompany(auth.company).send(
      new OnboardingInviteEmail(
        { name: `${user.firstName} ${user.lastName}`, address: user.email },
        {
          firstName: user.firstName,
          onboardingUrl,
          extraContent: extraContent ? sanitizeHtml(extraContent, EXTRA_CONTENT_SANITIZE_OPTIONS) : undefined,
        },
        {
          from: sender,
          cc: normalizeAddr(cc),
          bcc: normalizeAddr(bcc),
          subject: inviteSubject,
          attachments,
        },
      ),
    );

    if (invite?.messageId) {
      await OnboardingAuth.updateOne(
        { _id: auth._id },
        { inviteMessageId: invite.messageId, inviteSubject },
      ).catch((err) => console.error('[admin/register-onboarding] could not store invite message id', err));
    }

    res.status(201).json({
      id: (auth._id as object).toString(),
      onboardingKey: auth.onboardingKey,
      userId: (user._id as object).toString(),
      ttl: auth.ttl,
      location: auth.location,
      company: auth.company,
      expirationDate: auth.expirationDate,
    });
  } catch (err: unknown) {
    console.error('[admin/register-onboarding]', err);
    res.status(500).json({ error: 'Failed to register onboarding.' });
  }
});

router.post('/attachments', requireAdminAuth, requirePermission(Permission.ManageOnboardings), parseSingleAttachment, async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'file is required.' });
    return;
  }

  try {
    const result = await uploadAdminAttachment(req.file, req.admin!._id as Types.ObjectId);
    res.status(201).json(result);
  } catch (err) {
    console.error('[admin/attachments]', err);
    res.status(500).json({ error: 'Failed to upload attachment.' });
  }
});

router.delete('/attachments/:id', requireAdminAuth, requirePermission(Permission.ManageOnboardings), async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  try {
    const deleted = await deleteAdminAttachment(id, req.admin!._id as Types.ObjectId);
    if (!deleted) {
      res.status(404).json({ error: 'Attachment not found.' });
      return;
    }
    res.json({ id, deleted: true });
  } catch (err) {
    console.error('[admin/attachments/:id]', err);
    res.status(500).json({ error: 'Failed to delete attachment.' });
  }
});

router.get(
  '/sheets',
  requireAdminAuth,
  requirePermission(Permission.ManageSheets, Permission.ManageOnboardings),
  async (_req: Request, res: Response) => {
    try {
      const sheets = await SheetConfig.find().sort({ name: 1 }).lean();

      res.json({
        configured: isGoogleSheetsConfigured(),
        serviceAccount: process.env.GOOGLE_SA_EMAIL ?? null,
        sheets: sheets.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          spreadsheetId: s.spreadsheetId,
          spreadsheetTitle: s.spreadsheetTitle ?? null,
          tabName: s.tabName,
          url: `https://docs.google.com/spreadsheets/d/${s.spreadsheetId}`,
          appendCount: s.appendCount ?? 0,
          lastAppendAt: s.lastAppendAt ?? null,
          lastError: s.lastError ?? null,
          createdAt: s.createdAt,
        })),
      });
    } catch (err) {
      console.error('[admin/sheets]', err);
      res.status(500).json({ error: 'Failed to fetch sheets.' });
    }
  },
);

router.post(
  '/sheets',
  requireAdminAuth,
  requirePermission(Permission.ManageSheets),
  async (req: Request, res: Response) => {
    const { name, spreadsheet, tabName } = req.body as { name?: string; spreadsheet?: string; tabName?: string };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'A name is required.' });
      return;
    }

    if (!isGoogleSheetsConfigured()) {
      res.status(503).json({ error: 'Google Sheets is not configured on the server.' });
      return;
    }

    const spreadsheetId = parseSpreadsheetId(spreadsheet ?? '');
    if (!spreadsheetId) {
      res.status(400).json({ error: "That doesn't look like a Google Sheets link or ID." });
      return;
    }

    let info;
    try {
      info = await getSpreadsheetInfo(spreadsheetId);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const tab = (tabName ?? '').trim() || info.tabs[0] || 'Sheet1';
    if (info.tabs.length && !info.tabs.includes(tab)) {
      res.status(400).json({ error: `That spreadsheet has no tab called "${tab}".`, tabs: info.tabs });
      return;
    }

    try {
      const sheet = await SheetConfig.create({
        name: name.trim(),
        spreadsheetId,
        tabName: tab,
        spreadsheetTitle: info.title,
        createdBy: req.admin!._id as Types.ObjectId,
      });

      res.status(201).json({
        id: (sheet._id as object).toString(),
        name: sheet.name,
        spreadsheetId: sheet.spreadsheetId,
        spreadsheetTitle: sheet.spreadsheetTitle,
        tabName: sheet.tabName,
        url: `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}`,
      });
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        res.status(409).json({ error: 'That spreadsheet and tab are already set up.' });
        return;
      }
      console.error('[admin/sheets] create', err);
      res.status(500).json({ error: 'Failed to add the sheet.' });
    }
  },
);

router.delete(
  '/sheets/:id',
  requireAdminAuth,
  requirePermission(Permission.ManageSheets),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid sheet id.' });
      return;
    }

    try {
      const inUse = await OnboardingAuth.countDocuments({ sheetConfig: id, completed: false });
      if (inUse && req.query.force !== 'true') {
        res.status(409).json({
          error: `${inUse} onboarding${inUse === 1 ? '' : 's'} still point at this sheet and would stop being recorded.`,
          reason: 'in_use',
          onboardings: inUse,
        });
        return;
      }

      const sheet = await SheetConfig.findByIdAndDelete(id);
      if (!sheet) {
        res.status(404).json({ error: 'Sheet not found.' });
        return;
      }

      await OnboardingAuth.updateMany({ sheetConfig: id }, { $unset: { sheetConfig: 1 } });
      res.json({ id, deleted: true });
    } catch (err) {
      console.error('[admin/sheets/:id] delete', err);
      res.status(500).json({ error: 'Failed to remove the sheet.' });
    }
  },
);

const MAX_TEMPLATE_CONTENT_LENGTH = 20000;

router.get(
  '/message-templates',
  requireAdminAuth,
  requirePermission(Permission.ManageOnboardings, Permission.ManageUsers, Permission.EmailUsers),
  async (_req: Request, res: Response) => {
    try {
      const templates = await MessageTemplate.find().sort({ name: 1 }).lean();
      res.json(templates.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        content: t.content,
        createdAt: t.createdAt,
      })));
    } catch (err) {
      console.error('[admin/message-templates]', err);
      res.status(500).json({ error: 'Failed to fetch templates.' });
    }
  },
);

router.post(
  '/message-templates',
  requireAdminAuth,
  requirePermission(Permission.ManageOnboardings, Permission.ManageUsers, Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { name, content } = req.body as { name?: string; content?: string };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'A template name is required.' });
      return;
    }

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'There is nothing to save - write a message first.' });
      return;
    }

    if (content.length > MAX_TEMPLATE_CONTENT_LENGTH) {
      res.status(400).json({ error: `A template can be at most ${MAX_TEMPLATE_CONTENT_LENGTH} characters.` });
      return;
    }

    try {
      const template = await MessageTemplate.create({
        name: name.trim(),
        content,
        createdBy: req.admin!._id as Types.ObjectId,
      });

      res.status(201).json({
        id: (template._id as object).toString(),
        name: template.name,
        content: template.content,
        createdAt: template.createdAt,
      });
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        res.status(409).json({ error: 'A template with this name already exists.' });
        return;
      }
      console.error('[admin/message-templates] create', err);
      res.status(500).json({ error: 'Failed to save the template.' });
    }
  },
);

router.get('/get-user-list', requireAdminAuth, requirePermission(Permission.ManageOnboardings), async (_req: Request, res: Response) => {
  try {
    const users = await User.find({ isAdmin: false }, { _id: 1, email: 1, firstName: 1, lastName: 1, createdAt: 1 }).lean();
    res.json(users.map((u) => ({
      id: u._id.toString(),
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      createdAt: u.createdAt,
    })));
  } catch (err) {
    console.error('[admin/get-user-list]', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

router.get(
  '/users',
  requireAdminAuth,
  requirePermission(Permission.ManageUsers, Permission.ManagePermissions),
  async (_req: Request, res: Response) => {
    try {
      const users = await User.find(
        {},
        { _id: 1, email: 1, firstName: 1, lastName: 1, isAdmin: 1, permissionGroup: 1, createdAt: 1 },
      )
        .populate<{ permissionGroup: IPermissionGroup }>('permissionGroup', 'name')
        .sort({ createdAt: -1 })
        .lean();

      res.json(users.map((u) => {
        const group = u.permissionGroup as IPermissionGroup | undefined;
        return {
          id: u._id.toString(),
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          isAdmin: !!u.isAdmin,
          permissionGroup: group ? { id: (group._id as object).toString(), name: group.name } : null,
          createdAt: u.createdAt,
        };
      }));
    } catch (err) {
      console.error('[admin/users]', err);
      res.status(500).json({ error: 'Failed to fetch users.' });
    }
  },
);

router.delete(
  '/users/:id',
  requireAdminAuth,
  requirePermission(Permission.DeleteUsers),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const force = req.query.force === 'true' || (req.body as { force?: boolean })?.force === true;

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    if (String(req.admin!._id) === id) {
      res.status(400).json({ error: 'You cannot delete your own account.' });
      return;
    }

    try {
      const user = await User.findById(id);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const auths = await OnboardingAuth.find({ user: user._id }, { _id: 1, onboardingKey: 1 }).lean();
      const onboardingKeys = auths.map((a) => a.onboardingKey);
      const docs = onboardingKeys.length
        ? await Doc.find({ onboardingKey: { $in: onboardingKeys } }, { _id: 1, path: 1 }).lean()
        : [];
      const queuedEmails = await ScheduledEmail.countDocuments({
        user: user._id,
        status: ScheduledEmailStatus.Pending,
      });

      if (!force && (auths.length || docs.length || queuedEmails)) {
        res.status(409).json({
          error: 'This user has data attached. Confirm to delete it along with the account.',
          reason: 'has_related_data',
          onboardings: auths.length,
          documents: docs.length,
          queuedEmails,
        });
        return;
      }

      for (const doc of docs) {
        try {
          await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.path }));
        } catch (err) {
          console.error('[admin/users/:id delete] R2 delete failed for', doc.path, err);
        }
      }

      const authIds = auths.map((a) => a._id);
      if (authIds.length) {
        await OnboardingData.deleteMany({ onboardingAuthId: { $in: authIds } });
        await Doc.deleteMany({ onboardingKey: { $in: onboardingKeys } });
        await OnboardingAuth.deleteMany({ _id: { $in: authIds } });
      }
      await ScheduledEmail.deleteMany({ user: user._id });
      await User.deleteOne({ _id: user._id });

      console.log('[admin/users/:id delete]', {
        deletedBy: String(req.admin!._id),
        user: user.email,
        onboardings: auths.length,
        documents: docs.length,
      });

      res.json({ id, deleted: true, onboardings: auths.length, documents: docs.length, queuedEmails });
    } catch (err) {
      console.error('[admin/users/:id delete]', err);
      res.status(500).json({ error: 'Failed to delete the user.' });
    }
  },
);

router.get(
  '/users/:id/emails',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    try {
      const emails = await ScheduledEmail.find({ user: id })
        .sort({ scheduledAt: -1 })
        .limit(100)
        .lean();

      res.json(emails.map((email) => ({
        id: email._id.toString(),
        title: email.title,
        subject: email.subject ?? null,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt ?? null,
        cancelledAt: email.cancelledAt ?? null,
        cc: email.cc ?? [],
        bcc: email.bcc ?? [],
        threaded: !!email.onboardingAuth,
        attempts: email.attempts ?? 0,
        lastError: email.lastError ?? null,
        createdAt: email.createdAt,
      })));
    } catch (err) {
      console.error('[admin/users/:id/emails]', err);
      res.status(500).json({ error: 'Failed to fetch emails.' });
    }
  },
);

router.get(
  '/users/:id/emails/:emailId',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { id, emailId } = req.params as { id: string; emailId: string };

    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(emailId)) {
      res.status(400).json({ error: 'Invalid id.' });
      return;
    }

    try {
      const email = await ScheduledEmail.findOne({ _id: emailId, user: id })
        .populate<{ user: IUser }>('user', 'firstName lastName email')
        .populate<{ createdBy: IUser }>('createdBy', 'firstName lastName email')
        .populate<{ cancelledBy: IUser }>('cancelledBy', 'firstName lastName email')
        .populate<{ onboardingAuth: IOnboardingAuth }>('onboardingAuth', 'company location inviteSubject')
        .lean();

      if (!email) {
        res.status(404).json({ error: 'Email not found.' });
        return;
      }

      const person = (value: unknown) => {
        const u = value as IUser | undefined;
        if (!u?.email) return null;
        return { name: `${u.firstName} ${u.lastName}`.trim(), email: u.email };
      };

      const thread = email.onboardingAuth as IOnboardingAuth | undefined;

      res.json({
        id: email._id.toString(),
        title: email.title,
        subject: email.subject ?? email.title,
        subtitle: email.subtitle ?? null,
        contentHtml: email.contentHtml,
        contentMarkdown: email.contentMarkdown ?? null,
        status: email.status,
        to: person(email.user),
        cc: email.cc ?? [],
        bcc: email.bcc ?? [],
        sentBy: person(email.createdBy),
        cancelledBy: person(email.cancelledBy),
        thread: thread
          ? {
              id: (thread._id as object).toString(),
              company: thread.company,
              location: thread.location,
              subject: thread.inviteSubject ?? null,
            }
          : null,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt ?? null,
        cancelledAt: email.cancelledAt ?? null,
        createdAt: email.createdAt,
        attempts: email.attempts ?? 0,
        lastError: email.lastError ?? null,
      });
    } catch (err) {
      console.error('[admin/users/:id/emails/:emailId]', err);
      res.status(500).json({ error: 'Failed to fetch the email.' });
    }
  },
);

router.post(
  '/users/:id/emails/:emailId/cancel',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { id, emailId } = req.params as { id: string; emailId: string };

    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(emailId)) {
      res.status(400).json({ error: 'Invalid id.' });
      return;
    }

    try {
      const email = await ScheduledEmail.findOne({ _id: emailId, user: id });
      if (!email) {
        res.status(404).json({ error: 'Email not found.' });
        return;
      }

      if (email.status !== ScheduledEmailStatus.Pending) {
        res.status(409).json({
          error: email.status === ScheduledEmailStatus.Sent
            ? 'That email has already been sent.'
            : `That email is ${email.status} and cannot be cancelled.`,
        });
        return;
      }

      const updated = await ScheduledEmail.updateOne(
        { _id: email._id, status: ScheduledEmailStatus.Pending },
        {
          status: ScheduledEmailStatus.Cancelled,
          cancelledAt: new Date(),
          cancelledBy: req.admin!._id as Types.ObjectId,
        },
      );

      if (!updated.modifiedCount) {
        res.status(409).json({ error: 'That email was just sent and can no longer be cancelled.' });
        return;
      }

      res.json({ id: emailId, cancelled: true });
    } catch (err) {
      console.error('[admin/users/:id/emails/:emailId/cancel]', err);
      res.status(500).json({ error: 'Failed to cancel the email.' });
    }
  },
);

router.get(
  '/users/:id/threads',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    try {
      const auths = await OnboardingAuth.find(
        { user: id },
        { _id: 1, company: 1, location: 1, createdAt: 1, inviteMessageId: 1, inviteSubject: 1 },
      )
        .sort({ createdAt: -1 })
        .lean();

      res.json(auths.map((auth) => ({
        id: auth._id.toString(),
        company: auth.company,
        location: auth.location,
        subject: auth.inviteSubject ?? null,
        createdAt: auth.createdAt,
        canReply: !!auth.inviteMessageId,
      })));
    } catch (err) {
      console.error('[admin/users/:id/threads]', err);
      res.status(500).json({ error: 'Failed to fetch onboarding threads.' });
    }
  },
);

router.post(
  '/users/:id/send-email',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { title, subtitle, content, contentMarkdown, cc, bcc, scheduledAt, onboardingId } = req.body as {
      title?: string;
      subtitle?: string;
      content?: string;
      contentMarkdown?: string;
      cc?: string | string[];
      bcc?: string | string[];
      scheduledAt?: string;
      onboardingId?: string;
    };

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'A title is required.' });
      return;
    }

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'A message is required.' });
      return;
    }

    let when: Date | undefined;
    if (scheduledAt) {
      if (Number.isNaN(Date.parse(scheduledAt))) {
        res.status(400).json({ error: 'Invalid schedule date.' });
        return;
      }
      when = new Date(scheduledAt);
      if (when.getTime() <= Date.now()) {
        res.status(400).json({ error: 'The scheduled time must be in the future.' });
        return;
      }
    }

    try {
      const user = await User.findById(id);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      let thread: { auth: IOnboardingAuth; subject: string } | undefined;

      if (onboardingId) {
        if (!Types.ObjectId.isValid(onboardingId)) {
          res.status(400).json({ error: 'Invalid onboarding.' });
          return;
        }

        const auth = await OnboardingAuth.findById(onboardingId);
        if (!auth || String(auth.user) !== String(user._id)) {
          res.status(404).json({ error: 'That onboarding does not belong to this user.' });
          return;
        }

        if (!auth.inviteMessageId) {
          res.status(409).json({
            error: "That onboarding's invite predates email threading, so it can't be replied to. Send it as a separate email instead.",
            reason: 'no_thread',
          });
          return;
        }

        const base = auth.inviteSubject || title.trim();
        thread = { auth, subject: /^re:/i.test(base) ? base : `Re: ${base}` };
      }

      const toArray = (v: string | string[] | undefined) => (v ? (Array.isArray(v) ? v : [v]) : undefined);

      const record = await createScheduledEmail({
        userId: user._id as Types.ObjectId,
        title: title.trim(),
        subject: thread?.subject,
        subtitle: subtitle?.trim() || undefined,
        contentHtml: sanitizeHtml(content, EXTRA_CONTENT_SANITIZE_OPTIONS),
        contentMarkdown,
        cc: toArray(cc),
        bcc: toArray(bcc),
        onboardingAuth: thread ? (thread.auth._id as Types.ObjectId) : undefined,
        inReplyTo: thread?.auth.inviteMessageId,
        references: thread?.auth.inviteMessageId ? [thread.auth.inviteMessageId] : undefined,
        scheduledAt: when,
        createdBy: req.admin!._id as Types.ObjectId,
      });

      if (when) {
        res.status(201).json({
          id: (record._id as object).toString(),
          scheduled: true,
          scheduledAt: record.scheduledAt,
        });
        return;
      }

      record.user = user;
      const sent = await deliverScheduledEmail(record);

      if (!sent) {
        const saved = await ScheduledEmail.findById(record._id);
        res.status(502).json({ error: saved?.lastError || "The email couldn't be sent." });
        return;
      }

      res.status(201).json({ id: (record._id as object).toString(), scheduled: false, sent: true });
    } catch (err) {
      console.error('[admin/users/:id/send-email]', err);
      res.status(500).json({ error: 'Failed to send the email.' });
    }
  },
);

router.patch(
  '/users/:id/permission-group',
  requireAdminAuth,
  requirePermission(Permission.ManagePermissions),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { permissionGroupId } = req.body as { permissionGroupId?: string | null };

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    try {
      const user = await User.findById(id);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      if (!user.isAdmin) {
        res.status(400).json({ error: 'Permission groups only apply to admin users.' });
        return;
      }

      let group: IPermissionGroup | null = null;

      if (permissionGroupId) {
        if (!Types.ObjectId.isValid(permissionGroupId)) {
          res.status(400).json({ error: 'Invalid permission group.' });
          return;
        }

        group = await PermissionGroup.findById(permissionGroupId);
        if (!group) {
          res.status(404).json({ error: 'Permission group not found.' });
          return;
        }
      }

      user.permissionGroup = group ? (group._id as Types.ObjectId) : undefined;
      await user.save();

      res.json({
        id: (user._id as object).toString(),
        permissionGroup: group ? { id: (group._id as object).toString(), name: group.name } : null,
      });
    } catch (err) {
      console.error('[admin/users/:id/permission-group]', err);
      res.status(500).json({ error: 'Failed to update the permission group.' });
    }
  },
);


const VALID_PERMISSIONS = Object.values(Permission);

function parsePermissions(value: unknown): Permission[] | null {
  if (!Array.isArray(value)) return null;
  const unique = Array.from(new Set(value));
  if (unique.some((p) => !VALID_PERMISSIONS.includes(p as Permission))) return null;
  return unique as Permission[];
}

function serializeGroup(group: IPermissionGroup, memberCount?: number) {
  return {
    id: (group._id as object).toString(),
    name: group.name,
    permissions: group.permissions,
    ...(memberCount === undefined ? {} : { memberCount }),
    createdAt: group.createdAt,
  };
}

router.get(
  '/permission-groups',
  requireAdminAuth,
  requirePermission(Permission.ManagePermissions, Permission.ManageUsers),
  async (_req: Request, res: Response) => {
    try {
      const groups = await PermissionGroup.find().sort({ name: 1 });
      const counts = await User.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { permissionGroup: { $ne: null } } },
        { $group: { _id: '$permissionGroup', count: { $sum: 1 } } },
      ]);

      const countByGroup = new Map(counts.map((c) => [c._id.toString(), c.count]));

      res.json({
        permissions: VALID_PERMISSIONS,
        groups: groups.map((g) => serializeGroup(g, countByGroup.get((g._id as object).toString()) ?? 0)),
      });
    } catch (err) {
      console.error('[admin/permission-groups]', err);
      res.status(500).json({ error: 'Failed to fetch permission groups.' });
    }
  },
);

router.post(
  '/permission-groups',
  requireAdminAuth,
  requirePermission(Permission.ManagePermissions),
  async (req: Request, res: Response) => {
    const { name, permissions } = req.body as { name?: string; permissions?: unknown };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'A group name is required.' });
      return;
    }

    const parsed = parsePermissions(permissions);
    if (!parsed) {
      res.status(400).json({ error: 'permissions must be a list of valid permissions.', validPermissions: VALID_PERMISSIONS });
      return;
    }

    try {
      const group = await PermissionGroup.create({ name: name.trim(), permissions: parsed });
      res.status(201).json(serializeGroup(group, 0));
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        res.status(409).json({ error: 'A permission group with this name already exists.' });
        return;
      }
      console.error('[admin/permission-groups] create', err);
      res.status(500).json({ error: 'Failed to create the permission group.' });
    }
  },
);

router.patch(
  '/permission-groups/:id',
  requireAdminAuth,
  requirePermission(Permission.ManagePermissions),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { name, permissions } = req.body as { name?: string; permissions?: unknown };

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid permission group id.' });
      return;
    }

    const parsed = permissions === undefined ? undefined : parsePermissions(permissions);
    if (permissions !== undefined && !parsed) {
      res.status(400).json({ error: 'permissions must be a list of valid permissions.', validPermissions: VALID_PERMISSIONS });
      return;
    }

    if (name !== undefined && !name.trim()) {
      res.status(400).json({ error: 'A group name is required.' });
      return;
    }

    try {
      const group = await PermissionGroup.findById(id);
      if (!group) {
        res.status(404).json({ error: 'Permission group not found.' });
        return;
      }

      if (parsed && group.permissions.includes(Permission.ManagePermissions) && !parsed.includes(Permission.ManagePermissions)) {
        const otherGrantingGroups = await PermissionGroup.countDocuments({
          _id: { $ne: group._id },
          permissions: Permission.ManagePermissions,
        });
        if (!otherGrantingGroups) {
          res.status(409).json({ error: 'This is the only group with Manage Permissions - removing it would lock everyone out.' });
          return;
        }
      }

      if (name !== undefined) group.name = name.trim();
      if (parsed) group.permissions = parsed;
      await group.save();

      const memberCount = await User.countDocuments({ permissionGroup: group._id });
      res.json(serializeGroup(group, memberCount));
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        res.status(409).json({ error: 'A permission group with this name already exists.' });
        return;
      }
      console.error('[admin/permission-groups/:id] update', err);
      res.status(500).json({ error: 'Failed to update the permission group.' });
    }
  },
);

router.delete(
  '/permission-groups/:id',
  requireAdminAuth,
  requirePermission(Permission.ManagePermissions),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid permission group id.' });
      return;
    }

    try {
      const group = await PermissionGroup.findById(id);
      if (!group) {
        res.status(404).json({ error: 'Permission group not found.' });
        return;
      }

      const memberCount = await User.countDocuments({ permissionGroup: group._id });
      if (memberCount) {
        res.status(409).json({
          error: `This group is assigned to ${memberCount} admin${memberCount === 1 ? '' : 's'}. Move them to another group first.`,
        });
        return;
      }

      if (group.permissions.includes(Permission.ManagePermissions)) {
        const otherGrantingGroups = await PermissionGroup.countDocuments({
          _id: { $ne: group._id },
          permissions: Permission.ManagePermissions,
        });
        if (!otherGrantingGroups) {
          res.status(409).json({ error: 'This is the only group with Manage Permissions - deleting it would lock everyone out.' });
          return;
        }
      }

      await group.deleteOne();
      res.json({ id, deleted: true });
    } catch (err) {
      console.error('[admin/permission-groups/:id] delete', err);
      res.status(500).json({ error: 'Failed to delete the permission group.' });
    }
  },
);

const ADMIN_LOGIN_OTP_TTL_SECONDS = 5 * 60;
const ADMIN_LOGIN_OTP_MAX_ATTEMPTS = 5;

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required.' });
    return;
  }

  try {
    const user = await User.findOne({ email: username.toLowerCase().trim(), isAdmin: true });

    const passwordMatch = user ? await checkAdminPassword(user, password) : false;

    if (!user || !passwordMatch) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const userId = (user._id as object).toString();
    const otp = randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + ADMIN_LOGIN_OTP_TTL_SECONDS * 1000);

    await AdminLoginOtp.deleteMany({ userId: user._id });
    await AdminLoginOtp.create({ userId: user._id, otp, expiresAt });
    console.log(otp)
    await emailEngine.send(
      new OtpEmail(
        { address: user.email },
        { otp, expiresInMinutes: Math.floor(ADMIN_LOGIN_OTP_TTL_SECONDS / 60), purpose: 'login' },
        { from: getSenderByCompany(Company.NKSR) },
      ),
    );

    res.json({ auth: false, otpRequired: true, userId });
  } catch (err) {
    console.error('[admin/login]', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/verify-login-otp', loginLimiter, async (req: Request, res: Response) => {
  const { userId, otp } = req.body as { userId?: string; otp?: string };

  if (!userId || !otp) {
    res.status(400).json({ error: 'userId and otp are required.' });
    return;
  }

  if (!Types.ObjectId.isValid(userId)) {
    res.status(400).json({ error: 'Invalid userId format.' });
    return;
  }

  try {
    const user = await User.findOne({ _id: userId, isAdmin: true });
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const record = await AdminLoginOtp.findOne({ userId: user._id }).sort({ createdAt: -1 });
    if (!record || record.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: 'This code has expired. Please log in again.' });
      return;
    }

    if (record.attempts >= ADMIN_LOGIN_OTP_MAX_ATTEMPTS) {
      await AdminLoginOtp.deleteMany({ userId: user._id });
      res.status(429).json({ error: 'Too many incorrect attempts. Please log in again.' });
      return;
    }

    if (record.otp !== otp.trim()) {
      await AdminLoginOtp.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
      res.status(401).json({ error: 'Invalid code.' });
      return;
    }

    await AdminLoginOtp.deleteMany({ userId: user._id });

    const authKey = randomUUID();
    await User.updateOne({ _id: user._id }, { authKey, lastLoginAt: new Date() });

    res.cookie(ADMIN_COOKIE, authKey, ADMIN_COOKIE_OPTIONS);
    res.json({
      auth: true,
      user: await serializeAdminSession(user),
    });
  } catch (err) {
    console.error('[admin/verify-login-otp]', err);
    res.status(500).json({ error: 'OTP verification failed.' });
  }
});


router.post('/change-password', requireAdminAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required.' });
    return;
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    return;
  }

  if (newPassword === currentPassword) {
    res.status(400).json({ error: 'Your new password must be different from the current one.' });
    return;
  }

  try {
    const admin = req.admin!;

    if (!(await checkAdminPassword(admin, currentPassword))) {
      res.status(401).json({ error: 'Your current password is incorrect.' });
      return;
    }

    await User.updateOne(
      { _id: admin._id },
      {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    );

    await endAdminSession(res, admin);

    res.json({ changed: true, signedOut: true });
  } catch (err) {
    console.error('[admin/change-password]', err);
    res.status(500).json({ error: 'Failed to change your password.' });
  }
});

router.get('/onboardings', requireAdminAuth, requirePermission(Permission.ViewOnboardingList, Permission.ViewOnboardingResults, Permission.ManageOnboardings), async (req: Request, res: Response) => {
  const { search, status, userId } = req.query as { search?: string; status?: string; userId?: string };

  if (userId && !Types.ObjectId.isValid(userId)) {
    res.status(400).json({ error: 'Invalid userId.' });
    return;
  }

  try {
    const auths = await OnboardingAuth.find(userId ? { user: userId } : {})
      .populate<{ user: IUser }>('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    const now = Date.now();
    const computeStatus = (auth: (typeof auths)[number]): OnboardingStatus => {
      if (auth.completed) return 'completed';
      const isExpired = auth.expired || (!!auth.expirationDate && new Date(auth.expirationDate).getTime() < now);
      return isExpired ? 'expired' : 'pending';
    };

    const searchTerm = search?.trim().toLowerCase();

    const list = auths
      .map((auth) => {
        const user = auth.user as IUser | undefined;
        return {
          id: (auth._id as object).toString(),
          onboardingKey: auth.onboardingKey,
          userId: user ? (user._id as object).toString() : null,
          fullName: user ? `${user.firstName} ${user.lastName}` : null,
          email: user ? user.email : null,
          location: auth.location,
          company: auth.company,
          status: computeStatus(auth),
          expiredReason: auth.expiredReason ?? null,
          ttl: auth.ttl,
          expirationDate: auth.expirationDate,
          lastReminderAt: auth.lastReminderAt ?? null,
          reminderCount: auth.reminderCount ?? 0,
          createdAt: auth.createdAt,
        };
      })
      .filter((item) => {
        if (status && item.status !== status) return false;
        if (searchTerm) {
          const haystack = `${item.fullName ?? ''} ${item.email ?? ''}`.toLowerCase();
          if (!haystack.includes(searchTerm)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const orderDiff = ONBOARDING_STATUS_ORDER[a.status] - ONBOARDING_STATUS_ORDER[b.status];
        if (orderDiff !== 0) return orderDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

    res.json(list);
  } catch (err) {
    console.error('[admin/onboardings]', err);
    res.status(500).json({ error: 'Failed to fetch onboardings.' });
  }
});

router.get('/onboardings/:id/data', requireAdminAuth, requirePermission(Permission.ViewOnboardingResults), async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid onboarding id.' });
    return;
  }

  try {
    const auth = await OnboardingAuth.findById(id).populate<{ user: IUser }>('user', 'firstName lastName email');
    if (!auth) {
      res.status(404).json({ error: 'Onboarding not found.' });
      return;
    }

    const data = await OnboardingData.findOne({ onboardingAuthId: auth._id })
      .populate(ONBOARDING_DOC_FIELDS, '_id originalName mimeType')
      .lean();

    if (!data) {
      res.status(404).json({ error: 'No onboarding data found.' });
      return;
    }

    const formatDate = (d: Date | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);

    const docEntry = (ref: unknown): { id: string; name: string; mimeType: string } | null => {
      if (ref && typeof ref === 'object' && 'originalName' in (ref as object)) {
        const d = ref as { _id: object; originalName: string; mimeType: string };
        return { id: d._id.toString(), name: d.originalName, mimeType: d.mimeType };
      }
      return null;
    };

    const user = auth.user as IUser | undefined;

    res.json({
      user: user
        ? { id: (user._id as object).toString(), fullName: `${user.firstName} ${user.lastName}`, email: user.email }
        : null,
      location: auth.location,
      company: auth.company,
      expired: auth.expired,
      expiredReason: auth.expiredReason ?? null,
      fields: {
        welcome_ack:            data.welcomeAck ?? null,
        full_name:              data.fullName ?? null,
        preferred_name:         data.preferredName ?? null,
        email:                  data.personalEmail ?? null,
        mobile:                 data.mobile ?? null,
        dob:                    formatDate(data.dob),
        nationality:            data.nationality ?? null,
        marital_status:         data.maritalStatus ?? null,
        blood_group:            data.bloodGroup ?? null,
        emergency_contact_name:   data.emergencyContactName ?? null,
        emergency_contact_number: data.emergencyContactNumber ?? null,
        passport_number:        data.passportNumber ?? null,
        ssn:                    data.ssn ?? null,
        address:                data.address ?? null,
        present_address:        data.presentAddress ?? null,
        fathers_name:           data.fathersName ?? null,
        fathers_dob:            formatDate(data.fathersDob),
        mothers_name:           data.mothersName ?? null,
        mothers_dob:            formatDate(data.mothersDob),
        spouse_name:            data.spouseName ?? null,
        spouse_dob:             formatDate(data.spouseDob),
        childs_info:            data.childsInfo?.map(c => ({ name: c.name, dob: formatDate(c.dob) })) ?? null,
        insurance_coverage:     data.insuranceCoverage ?? null,
        campus_name:            data.campusName ?? null,
        orgs:                   data.orgs ?? null,
        bank_name:              data.bankName ?? null,
        account_holder:         data.accountHolder ?? null,
        account_number:         data.accountNumber ?? null,
        ifsc:                   data.ifsc ?? null,
        intro_line:             data.introLine ?? null,
        birthday_pref:          data.birthdayPref ?? null,
        meal_preference:        data.mealPreference ?? null,
        hobbies:                data.hobbies ?? null,
        fun_fact:               data.funFact ?? null,
        declaration:            data.declaration ?? null,
        consent:                data.consent ?? null,
        experience_rating:      data.experienceRating ?? null,
        experience_feedback:    data.experienceFeedback ?? null,
      },
      docs: {
        pan_doc:               docEntry(data.panDoc),
        id_doc:                docEntry(data.idDoc),
        address_doc:           docEntry(data.addressDoc),
        photo_doc:             docEntry(data.photoDoc),
        higher_secondary_doc:  docEntry(data.higherSecondaryDoc),
        highest_degree_doc:    docEntry(data.highestDegreeDoc),
        resume_doc:            docEntry(data.resumeDoc),
        offer_letter_doc:      docEntry(data.offerLetterDoc),
        last_increment_doc:    docEntry(data.lastIncrementDoc),
        salary_slip_doc:       docEntry(data.salarySlipDoc),
        bonus_letter_doc:      docEntry(data.bonusLetterDoc),
        experience_letter_doc: docEntry(data.experienceLetterDoc),
        relieving_letter_doc:  docEntry(data.relievingLetterDoc),
        bank_doc:              docEntry(data.bankDoc),
      },
      submittedAt: data.submittedAt ?? null,
    });
  } catch (err) {
    console.error('[admin/onboardings/:id/data]', err);
    res.status(500).json({ error: 'Failed to fetch onboarding data.' });
  }
});

router.get('/onboardings/:id/progress', requireAdminAuth, requirePermission(Permission.ViewOnboardingList, Permission.ViewOnboardingResults), async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid onboarding id.' });
    return;
  }

  try {
    const auth = await OnboardingAuth.findById(id)
      .populate<{ user: IUser }>('user', 'firstName lastName email')
      .populate<{ expiredBy: IUser }>('expiredBy', 'firstName lastName email');

    if (!auth) {
      res.status(404).json({ error: 'Onboarding not found.' });
      return;
    }

    const data = await OnboardingData.findOne({ onboardingAuthId: auth._id }).lean();
    const IGNORED = new Set([
      '_id', '__v', 'userId', 'onboardingAuthId', 'fieldUpdateCounts',
      'createdAt', 'updatedAt', 'submittedAt',
    ]);

    const hasValue = (value: unknown): boolean => {
      if (value === null || value === undefined || value === '') return false;
      if (Array.isArray(value)) return value.length > 0;
      if (value instanceof Date) return true;
      if (typeof value === 'object') return Object.keys(value as object).length > 0;
      return true;
    };

    const filled: string[] = [];
    const documents: string[] = [];

    if (data) {
      Object.keys(data).forEach((key) => {
        if (IGNORED.has(key)) return;
        const value = (data as unknown as Record<string, unknown>)[key];
        if (!hasValue(value)) return;
        filled.push(key);
        if (key.endsWith('Doc')) documents.push(key);
      });
    }

    const rawCounts = (data?.fieldUpdateCounts ?? {}) as unknown;
    const fieldUpdateCounts = rawCounts instanceof Map
      ? Object.fromEntries(rawCounts)
      : (rawCounts as Record<string, number>);

    const totalEdits = Object.values(fieldUpdateCounts)
      .reduce((sum: number, n) => sum + (Number(n) || 0), 0);

    const now = Date.now();
    const isExpired = auth.expired || (!!auth.expirationDate && new Date(auth.expirationDate).getTime() < now);
    const user = auth.user as IUser | undefined;
    const expiredBy = auth.expiredBy as IUser | undefined;

    res.json({
      id: (auth._id as object).toString(),
      onboardingKey: auth.onboardingKey,
      status: auth.completed ? 'completed' : isExpired ? 'expired' : 'pending',
      user: user ? { fullName: `${user.firstName} ${user.lastName}`, email: user.email } : null,
      company: auth.company,
      location: auth.location,

      opened: !!auth.lastVerified,
      lastVerifiedAt: auth.lastVerified ?? null,
      lastActivityAt: auth.lastActivityAt ?? null,

      registeredAt: auth.createdAt,
      expirationDate: auth.expirationDate ?? null,
      sessionLengthSeconds: auth.ttl,

      expiry: {
        expired: isExpired,
        flagged: auth.expired,
        reason: auth.expiredReason ?? (isExpired && !auth.expired ? 'link_expiration_date_passed' : null),
        at: auth.expiredAt ?? null,
        by: expiredBy ? { name: `${expiredBy.firstName} ${expiredBy.lastName}`.trim(), email: expiredBy.email } : null,
      },

      activity: {
        otpSendCount: auth.otpSendCount ?? 0,
        docCount: auth.docCount ?? 0,
        syncRequestCount: auth.syncRequestCount ?? 0,
        submitAttempts: auth.submitAttempts ?? 0,
        reminderCount: auth.reminderCount ?? 0,
        lastReminderAt: auth.lastReminderAt ?? null,
      },

      progress: {
        started: !!data,
        filledFields: filled.length,
        documentsUploaded: documents.length,
        filled,
        documents,
        fieldUpdateCounts,
        totalFieldEdits: totalEdits,
        lastSavedAt: data?.updatedAt ?? null,
        submittedAt: data?.submittedAt ?? null,
      },
    });
  } catch (err) {
    console.error('[admin/onboardings/:id/progress]', err);
    res.status(500).json({ error: 'Failed to fetch onboarding progress.' });
  }
});

router.get('/onboardings/:id/docs/:docId/download', requireAdminAuth, requirePermission(Permission.ViewOnboardingDocs), async (req: Request, res: Response) => {
  const { id, docId } = req.params as { id: string; docId: string };

  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(docId)) {
    res.status(400).json({ error: 'Invalid id.' });
    return;
  }

  try {
    const auth = await OnboardingAuth.findById(id);
    if (!auth) {
      res.status(404).json({ error: 'Onboarding not found.' });
      return;
    }

    const doc = await Doc.findOne({ _id: docId, onboardingKey: auth.onboardingKey });
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }

    const url = await getSignedUrl(
      r2,
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: doc.path,
        ResponseContentDisposition: `inline; filename="${doc.originalName}"`,
      }),
      { expiresIn: 300 },
    );

    res.json({ url, expiresIn: 300, originalName: doc.originalName, mimeType: doc.mimeType });
  } catch (err) {
    console.error('[admin/onboardings/:id/docs/:docId/download]', err);
    res.status(500).json({ error: 'Failed to generate download link.' });
  }
});

router.get('/onboardings/:id/export', requireAdminAuth, requirePermission(Permission.ExportOnboardingData), async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid onboarding id.' });
    return;
  }

  try {
    const result = await buildOnboardingExportHtml(id);
    if (!result) {
      res.status(404).json({ error: 'Onboarding not found.' });
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.html);
  } catch (err) {
    console.error('[admin/onboardings/:id/export]', err);
    res.status(500).json({ error: 'Failed to export onboarding response.' });
  }
});

router.get('/onboardings/:id/register-data', requireAdminAuth, requirePermission(Permission.ManageOnboardings), async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid onboarding id.' });
    return;
  }

  try {
    const auth = await OnboardingAuth.findById(id).populate<{ user: IUser }>('user', 'firstName lastName email');
    if (!auth) {
      res.status(404).json({ error: 'Onboarding not found.' });
      return;
    }

    const user = auth.user as IUser | undefined;

    res.json({
      id: (auth._id as object).toString(),
      userId: user ? (user._id as object).toString() : null,
      company: auth.company,
      location: auth.location,
      ttl: auth.ttl,
      cc: auth.cc ?? null,
      bcc: auth.bcc ?? null,
      extraContent: auth.extraContent ?? null,
    });
  } catch (err) {
    console.error('[admin/onboardings/:id/register-data]', err);
    res.status(500).json({ error: 'Failed to fetch onboarding register data.' });
  }
});

router.post('/onboardings/:id/remind', requireAdminAuth, requirePermission(Permission.ManageOnboardings), async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid onboarding id.' });
    return;
  }

  try {
    const auth = await OnboardingAuth.findById(id).populate<{ user: IUser }>('user', 'firstName lastName email');
    if (!auth) {
      res.status(404).json({ error: 'Onboarding not found.' });
      return;
    }

    if (auth.completed) {
      res.status(400).json({ error: 'That onboarding is already complete.' });
      return;
    }

    const isExpired = auth.expired || (!!auth.expirationDate && new Date(auth.expirationDate).getTime() < Date.now());
    if (isExpired) {
      res.status(400).json({ error: 'That onboarding has expired - send a new link instead.' });
      return;
    }

    try {
      await sendReminderFor(auth);
    } catch (err) {
      console.error('[admin/onboardings/:id/remind] send failed', err);
      res.status(502).json({ error: (err as Error).message || "The reminder couldn't be sent." });
      return;
    }

    const updated = await OnboardingAuth.findById(auth._id, { lastReminderAt: 1, reminderCount: 1 }).lean();

    res.json({
      id: (auth._id as object).toString(),
      sent: true,
      lastReminderAt: updated?.lastReminderAt ?? null,
      reminderCount: updated?.reminderCount ?? 0,
    });
  } catch (err) {
    console.error('[admin/onboardings/:id/remind]', err);
    res.status(500).json({ error: 'Failed to send the reminder.' });
  }
});

router.patch('/onboardings/:id/expire', requireAdminAuth, requirePermission(Permission.ExpireOnboardings), async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid onboarding id.' });
    return;
  }

  try {
    const auth = await OnboardingAuth.findById(id);
    if (!auth) {
      res.status(404).json({ error: 'Onboarding not found.' });
      return;
    }

    if (auth.completed) {
      res.status(400).json({ error: 'Cannot expire a completed onboarding.' });
      return;
    }

    auth.expired = true;
    auth.expiredReason = OnboardingExpiryReason.AdminExpired;
    auth.expiredAt = new Date();
    auth.expiredBy = req.admin!._id as Types.ObjectId;
    await auth.save();

    res.json({ id: (auth._id as object).toString(), expired: true, expiredReason: auth.expiredReason });
  } catch (err) {
    console.error('[admin/onboardings/:id/expire]', err);
    res.status(500).json({ error: 'Failed to expire onboarding.' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  const cookieKey = req.cookies?.[ADMIN_COOKIE];

  try {
    if (cookieKey) {
      const user = await User.findOne({ authKey: cookieKey });
      if (user) {
        await endAdminSession(res, user);
        res.json({ loggedOut: true });
        return;
      }
    }

    clearAdminCookie(res);
    res.json({ loggedOut: true });
  } catch (err) {
    console.error('[admin/logout]', err);
    res.status(500).json({ error: 'Logout failed.' });
  }
});

router.get('/auth', async (req: Request, res: Response) => {
  const cookieKey = req.cookies?.[ADMIN_COOKIE];

  if (!cookieKey) {
    res.json({ auth: false, reason: 'no_cookie' });
    return;
  }

  try {
    const user = await User.findOne({ authKey: cookieKey });

    if (!user || !user.isAdmin) {
      res.status(400).json({ auth: false, reason: 'not_found' });
      return;
    }

    if (isAdminSessionExpired(user)) {
      await endAdminSession(res, user);
      res.json({ auth: false, reason: 'session_expired' });
      return;
    }

    res.json({
      auth: true,
      user: await serializeAdminSession(user),
    });
  } catch (err) {
    console.error('[admin/auth]', err);
    res.status(500).json({ error: 'Auth check failed.' });
  }
});

export default router;
