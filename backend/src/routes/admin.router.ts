import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID, randomInt } from 'crypto';
import { Types } from 'mongoose';
import rateLimit from 'express-rate-limit';
import sanitizeHtml from 'sanitize-html';
import multer from 'multer';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { User, IUser } from '../db/models/user.model';
import { OnboardingAuth, IOnboardingAuth, OfficeLocation, Company, Department, OnboardingExpiryReason } from '../db/models/onboarding-auth.model';
import { OnboardingData } from '../db/models/onboarding-data.model';
import { Doc } from '../db/models/doc.model';
import { AdminLoginOtp } from '../db/models/admin-login-otp.model';
import { Permission, PermissionGroup, IPermissionGroup } from '../db/models/permission-group.model';
import { MessageTemplate } from '../db/models/message-template.model';
import { ScheduledEmail, ScheduledEmailStatus, CombinedAddressing } from '../db/models/scheduled-email.model';
import { UserGroup, IUserGroup } from '../db/models/user-group.model';
import { SheetConfig } from '../db/models/sheet-config.model';
import { DriveConfig, IDriveConfig } from '../db/models/drive-config.model';
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
import { appendOnboardingToSheet } from '../services/onboarding-sheet.service';
import { AdminAttachment } from '../db/models/admin-attachment.model';
import {
  createScheduledEmail,
  createScheduledEmails,
  deliverScheduledEmail,
  deliverScheduledEmails,
  notLockedFilter,
} from '../services/scheduled-email.service';
import {
  EMAIL_PLACEHOLDERS,
  fillHtml,
  fillText,
  findKnownPlaceholders,
  findUnknownPlaceholders,
  placeholderValues,
} from '../lib/email-placeholders';
import { sendReminderFor } from '../services/onboarding-reminder.service';
import { isGoogleSheetsConfigured, parseSpreadsheetId, getSpreadsheetInfo } from '../lib/google-sheets';
import { parseFolderId, checkFolder, testFolderUpload, driveAccountEmail } from '../lib/google-drive';
import { isDriveConfigured, isDriveUserConfigured } from '../lib/google-auth';
import { DRIVE_DOCUMENTS, planOnboardingDrive, pushOnboardingToDrive } from '../services/onboarding-drive.service';
import { buildCc, defaultOnboardingCc } from '../lib/email-recipients';
import { normalizeExtraFields, ExtraFieldDef, ExtraFieldType } from '../lib/extra-fields';
import {
  uploadAdminAttachment,
  deleteAdminAttachment,
  resolveAdminAttachments,
  MAX_ADMIN_ATTACHMENT_BYTES,
  MAX_ADMIN_ATTACHMENTS_PER_EMAIL,
} from '../services/admin-attachment.service';
import { notifyOnboardingRegistered, sendSlackTest } from '../services/slack-notify.service';
import { SlackConfig, ISlackConfig, SlackEvent, SLACK_EVENT_LABELS } from '../db/models/slack-config.model';
import { recordNotification } from '../services/notification.service';
import { Notification } from '../db/models/notification.model';
import { isBotToken, hasDefaultBot, defaultBotToken, describeBot } from '../lib/slack';
import { targetOf } from '../services/slack-notify.service';

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
  'orgs.relievingLetterDoc',
  'panDoc', 'passportDoc', 'idDoc', 'addressDoc', 'photoDoc',
  'higherSecondaryDoc', 'highestDegreeDoc',
  'resumeDoc', 'offerLetterDoc', 'lastIncrementDoc',
  'salarySlipDoc', 'bonusLetterDoc', 'experienceLetterDoc', 'relievingLetterDoc',
  'bankDoc',
];

type OnboardingStatus = 'pending' | 'completed' | 'expired';
const ONBOARDING_STATUS_ORDER: Record<OnboardingStatus, number> = { pending: 0, expired: 1, completed: 2 };

function unknownPlaceholderMessage(names: string[]): string {
  const listed = names.map((name) => `{{${name}}}`).join(', ');
  const allowed = EMAIL_PLACEHOLDERS.map((name) => `{{${name}}}`).join(', ');
  return `${listed} ${names.length === 1 ? 'is not a placeholder' : 'are not placeholders'}. Use ${allowed}.`;
}

const MAX_BULK_EMAIL_RECIPIENTS = 300;

const BULK_SEND_BUDGET_MS = 15_000;

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

async function extraFieldsForAdmin(auth: IOnboardingAuth, data: { extraFields?: unknown }) {
  const defs = (auth.extraFields ?? []) as ExtraFieldDef[];
  if (!defs.length) return [];

  const stored = data.extraFields as Map<string, unknown> | Record<string, unknown> | undefined;
  const read = (key: string) =>
    stored instanceof Map ? stored.get(key) : (stored as Record<string, unknown> | undefined)?.[key];

  const ids: Types.ObjectId[] = [];
  const keyById = new Map<string, string>();

  for (const def of defs) {
    if (def.type !== ExtraFieldType.Document) continue;
    const raw = read(def.key);
    if (raw && Types.ObjectId.isValid(String(raw))) {
      ids.push(new Types.ObjectId(String(raw)));
      keyById.set(String(raw), def.key);
    }
  }

  const docsByKey = new Map<string, { id: string; name: string; mimeType: string }>();
  if (ids.length) {
    const docs = await Doc.find({ _id: { $in: ids } }, { _id: 1, originalName: 1, mimeType: 1 }).lean();
    for (const doc of docs) {
      const key = keyById.get(String(doc._id));
      if (key) docsByKey.set(key, { id: String(doc._id), name: doc.originalName, mimeType: doc.mimeType });
    }
  }

  return defs.map((def) => ({
    key: def.key,
    label: def.label,
    type: def.type,
    required: def.required,
    value: def.type === ExtraFieldType.Document ? null : (read(def.key) ?? null),
    doc: def.type === ExtraFieldType.Document ? (docsByKey.get(def.key) ?? null) : null,
  }));
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
  const { userId, ttl, location, department, company, cc, bcc, extraContent, extraContentMarkdown, expirationDate, attachmentIds, sheetId, driveId, extraFields, title } = req.body as {
    userId?: string;
    ttl?: number;
    location?: string;
    department?: string;
    company?: string;
    cc?: string | string[];
    bcc?: string | string[];
    extraContent?: string;
    extraContentMarkdown?: string;
    expirationDate?: string;
    attachmentIds?: string[];
    sheetId?: string;
    driveId?: string;
    extraFields?: unknown;
    title?: string;
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

  const validDepartments = Object.values(Department);
  if (!department || !validDepartments.includes(department as Department)) {
    res.status(400).json({ error: 'department is required.', validDepartments });
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

  let normalizedExtraFields;
  try {
    normalizedExtraFields = normalizeExtraFields(extraFields);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
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
  if (driveId) {
    if (!Types.ObjectId.isValid(driveId)) {
      res.status(400).json({ error: 'Invalid Drive sync.' });
      return;
    }
    if (!(await DriveConfig.exists({ _id: driveId }))) {
      res.status(404).json({ error: 'That Drive sync is no longer set up.' });
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
      department: department as Department,
      company: company as Company,
      expirationDate: parsedExpirationDate,
      cc: toArray(cc),
      bcc: toArray(bcc),
      extraContent: extraContentMarkdown,
      sheetConfig: sheetId || undefined,
      driveConfig: driveId || undefined,
      extraFields: normalizedExtraFields.length ? normalizedExtraFields : undefined,
      title: title?.trim() || undefined,
      attachmentIds: attachmentIds?.length ? attachmentIds : undefined,
    });

    const baseUrl = company == Company.NKSRT ? (process.env.ONBOARDING_BASE_URL_DUBAI??"https://nksresearchtech.com")  : (process.env.ONBOARDING_BASE_URL ?? 'https://nksecurities.com');
    const onboardingUrl = `${baseUrl}/verify-onboarding.html?id=${onboardingKey}`;

    const toAddr = (v: string) => ({ address: v });
    const normalizeAddr = (v: string | string[] | undefined) =>
      v ? (Array.isArray(v) ? v.map(toAddr) : toAddr(v)) : undefined;

    const sender = getSenderByCompany(auth.company);
    const invitee = `${user.firstName} ${user.lastName}`.trim();
    const customTitle = title?.trim();
    const inviteSubject = customTitle
      ? `${invitee} | ${customTitle}`
      : `${invitee} | Complete your onboarding - ${getCompanyName(auth.company)}`;

    let invite;
    try {
      invite = await getEmailEngineByCompany(auth.company).send(
        new OnboardingInviteEmail(
          { name: `${user.firstName} ${user.lastName}`, address: user.email },
          {
            firstName: user.firstName,
            onboardingUrl,
            extraContent: extraContent ? sanitizeHtml(extraContent, EXTRA_CONTENT_SANITIZE_OPTIONS) : undefined,
          },
          {
            from: sender,
            cc: buildCc([cc, defaultOnboardingCc()], user.email),
            bcc: normalizeAddr(bcc),
            subject: inviteSubject,
            attachments,
          },
        ),
      );
    } catch (sendErr) {
      await OnboardingAuth.deleteOne({ _id: auth._id }).catch(() => undefined);
      await recordNotification({
        type: 'invite_failed',
        severity: 'error',
        title: 'Onboarding invite could not be sent',
        message: `The invite to ${invitee} (${user.email}) failed to send, so no onboarding was created. ${(sendErr as Error).message}`,
        user: user._id as Types.ObjectId,
      });
      console.error('[admin/register-onboarding] invite send failed, rolled back', sendErr);
      res.status(502).json({ error: 'The invite email could not be sent, so the onboarding was not created. Please try again.' });
      return;
    }

    await notifyOnboardingRegistered(auth._id as Types.ObjectId);

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

function driveConfigJson(config: IDriveConfig) {
  const mapping = config.mapping instanceof Map
    ? Object.fromEntries(config.mapping)
    : ((config.mapping ?? {}) as Record<string, unknown>);

  return {
    id: (config._id as object).toString(),
    name: config.name,
    mapping,
    mappedCount: Object.values(mapping).filter((t) => (t as { folderId?: string })?.folderId).length,
    defaultFolderId: config.defaultFolderId ?? null,
    defaultFolderName: config.defaultFolderName ?? null,
    fileCount: config.fileCount ?? 0,
    lastSyncAt: config.lastSyncAt ?? null,
    lastError: config.lastError ?? null,
    createdAt: config.createdAt,
  };
}

async function testDriveFolders(keysByFolder: Map<string, string[]>) {
  const results = await Promise.all(
    [...keysByFolder.entries()].map(async ([folderId, keys]) => {
      try {
        await testFolderUpload(folderId);
        return null;
      } catch (err) {
        return { folderId, keys, error: (err as Error).message };
      }
    }),
  );
  return results.filter((r) => r !== null);
}

router.get(
  '/drive',
  requireAdminAuth,
  requirePermission(Permission.ManageDrive, Permission.ManageOnboardings),
  async (_req: Request, res: Response) => {
    try {
      const configs = await DriveConfig.find().sort({ name: 1 });
      res.json({
        configured: isDriveConfigured(),
        serviceAccount: isDriveConfigured() ? await driveAccountEmail() : null,
        documents: DRIVE_DOCUMENTS,
        configs: configs.map(driveConfigJson),
      });
    } catch (err) {
      console.error('[admin/drive]', err);
      res.status(500).json({ error: 'Failed to fetch Drive configurations.' });
    }
  },
);

router.post(
  '/drive',
  requireAdminAuth,
  requirePermission(Permission.ManageDrive),
  async (req: Request, res: Response) => {
    const { name, defaultFolder } = req.body as { name?: string; defaultFolder?: string };

    if (!name?.trim()) {
      res.status(400).json({ error: 'A name is required.' });
      return;
    }
    if (!isDriveConfigured()) {
      res.status(503).json({ error: 'Google credentials are not configured on the server.' });
      return;
    }

    let defaultFolderId: string | undefined;
    let defaultFolderName: string | undefined;

    if (defaultFolder?.trim()) {
      const folderId = parseFolderId(defaultFolder);
      if (!folderId) {
        res.status(400).json({ error: "That doesn't look like a Google Drive folder link or ID." });
        return;
      }
      try {
        const folder = await checkFolder(folderId);
        defaultFolderId = folder.id;
        defaultFolderName = folder.name;
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
    }

    try {
      const config = await DriveConfig.create({
        name: name.trim(),
        mapping: new Map(),
        defaultFolderId,
        defaultFolderName,
        createdBy: req.admin!._id as Types.ObjectId,
      });
      res.status(201).json(driveConfigJson(config));
    } catch (err) {
      console.error('[admin/drive] create', err);
      res.status(500).json({ error: 'Failed to save the Drive configuration.' });
    }
  },
);

router.post(
  '/drive/check-folder',
  requireAdminAuth,
  requirePermission(Permission.ManageDrive),
  async (req: Request, res: Response) => {
    const { folder } = req.body as { folder?: string };
    const folderId = parseFolderId(folder ?? '');

    if (!folderId) {
      res.status(400).json({ error: "That doesn't look like a Google Drive folder link or ID." });
      return;
    }

    try {
      const info = await checkFolder(folderId);
      res.json({
        ...info,
        warning: info.inSharedDrive || isDriveUserConfigured()
          ? null
          : 'This folder is in a personal My Drive. A service account has no storage of its own, so uploads there usually fail on quota - a Shared Drive folder is recommended.',
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  },
);

router.patch(
  '/drive/:id',
  requireAdminAuth,
  requirePermission(Permission.ManageDrive),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid configuration id.' });
      return;
    }

    const { name, mapping, defaultFolderId, defaultFolderName } = req.body as {
      name?: string;
      mapping?: Record<string, { folderId?: string; folderName?: string }>;
      defaultFolderId?: string;
      defaultFolderName?: string;
    };

    const update: Record<string, unknown> = {};
    if (name?.trim()) update.name = name.trim();
    if (defaultFolderId !== undefined) update.defaultFolderId = defaultFolderId?.trim() || undefined;
    if (defaultFolderName !== undefined) update.defaultFolderName = defaultFolderName?.trim() || undefined;

    if (mapping) {
      const known = new Set(DRIVE_DOCUMENTS.map((d) => d.key));
      const clean: Record<string, { folderId: string; folderName?: string }> = {};
      for (const [key, value] of Object.entries(mapping)) {
        if (!known.has(key)) continue;
        const folderId = String(value?.folderId ?? '').trim();
        if (!folderId) continue;
        clean[key] = { folderId, folderName: value?.folderName?.trim() || undefined };
      }

      const keysByFolder = new Map<string, string[]>();
      for (const [key, value] of Object.entries(clean)) {
        keysByFolder.set(value.folderId, [...(keysByFolder.get(value.folderId) ?? []), key]);
      }

      if (keysByFolder.size && !isDriveConfigured()) {
        res.status(503).json({ error: 'Google credentials are not configured on the server.' });
        return;
      }

      const failures = await testDriveFolders(keysByFolder);

      if (failures.length) {
        res.status(400).json({
          error: `${failures.length} of ${keysByFolder.size} folder${keysByFolder.size === 1 ? '' : 's'} rejected a test upload, so nothing was saved.`,
          reason: 'test_upload_failed',
          failures,
        });
        return;
      }

      update.mapping = clean;
    }

    if (!Object.keys(update).length) {
      res.status(400).json({ error: 'Nothing to update.' });
      return;
    }

    try {
      const config = await DriveConfig.findByIdAndUpdate(id, update, { returnDocument: 'after' });
      if (!config) {
        res.status(404).json({ error: 'Configuration not found.' });
        return;
      }
      res.json(driveConfigJson(config));
    } catch (err) {
      console.error('[admin/drive/:id] update', err);
      res.status(500).json({ error: 'Failed to update the Drive configuration.' });
    }
  },
);

router.post(
  '/drive/:id/test',
  requireAdminAuth,
  requirePermission(Permission.ManageDrive),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid configuration id.' });
      return;
    }
    if (!isDriveConfigured()) {
      res.status(503).json({ error: 'Google credentials are not configured on the server.' });
      return;
    }

    try {
      const config = await DriveConfig.findById(id);
      if (!config) {
        res.status(404).json({ error: 'Configuration not found.' });
        return;
      }

      const keysByFolder = new Map<string, string[]>();
      const add = (folderId: string | undefined, key: string) => {
        if (!folderId) return;
        keysByFolder.set(folderId, [...(keysByFolder.get(folderId) ?? []), key]);
      };
      add(config.defaultFolderId, 'default');
      const mapping = driveConfigJson(config).mapping as Record<string, { folderId?: string }>;
      for (const [key, value] of Object.entries(mapping)) add(value?.folderId, key);

      if (!keysByFolder.size) {
        res.status(400).json({ error: 'This Drive sync has no folders to test.' });
        return;
      }

      const failures = await testDriveFolders(keysByFolder);
      res.json({ tested: keysByFolder.size, passed: keysByFolder.size - failures.length, failures });
    } catch (err) {
      console.error('[admin/drive/:id/test]', err);
      res.status(500).json({ error: 'Failed to test the Drive folders.' });
    }
  },
);

router.delete(
  '/drive/:id',
  requireAdminAuth,
  requirePermission(Permission.ManageDrive),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid configuration id.' });
      return;
    }

    try {
      const inUse = await OnboardingAuth.countDocuments({ driveConfig: id, completed: false });
      if (inUse && req.query.force !== 'true') {
        res.status(409).json({
          error: `${inUse} onboarding${inUse === 1 ? '' : 's'} still point at this Drive sync and their documents would stop being filed.`,
          reason: 'in_use',
          onboardings: inUse,
        });
        return;
      }

      const config = await DriveConfig.findByIdAndDelete(id);
      if (!config) {
        res.status(404).json({ error: 'Configuration not found.' });
        return;
      }

      await OnboardingAuth.updateMany({ driveConfig: id }, { $unset: { driveConfig: 1 } });
      res.json({ id, deleted: true });
    } catch (err) {
      console.error('[admin/drive/:id] delete', err);
      res.status(500).json({ error: 'Failed to remove the Drive configuration.' });
    }
  },
);

router.post(
  '/onboardings/:id/drive-link',
  requireAdminAuth,
  requirePermission(Permission.ManageDrive),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { driveId } = (req.body ?? {}) as { driveId?: string };

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid onboarding id.' });
      return;
    }
    if (!driveId || !Types.ObjectId.isValid(driveId)) {
      res.status(400).json({ error: 'Choose a Drive sync.' });
      return;
    }
    if (!isDriveConfigured()) {
      res.status(503).json({ error: 'Google credentials are not configured on the server.' });
      return;
    }

    try {
      const [auth, config] = await Promise.all([
        OnboardingAuth.findById(id, { completed: 1, driveConfig: 1 }),
        DriveConfig.findById(driveId),
      ]);

      if (!auth) {
        res.status(404).json({ error: 'Onboarding not found.' });
        return;
      }
      if (!auth.completed) {
        res.status(400).json({ error: 'Only completed onboardings can be filed to Drive.' });
        return;
      }
      if (!config) {
        res.status(404).json({ error: 'That Drive sync no longer exists.' });
        return;
      }

      if (String(auth.driveConfig ?? '') !== driveId) {
        await OnboardingAuth.updateOne(
          { _id: auth._id },
          { $set: { driveConfig: config._id }, $unset: { driveFiles: 1, driveSyncedAt: 1, driveError: 1 } },
        );
      }

      const plan = await planOnboardingDrive(id);
      if (!plan.planned) {
        const messages: Record<string, string> = {
          not_configured: 'This onboarding is not linked to a Drive sync.',
          no_data: 'This onboarding has no submitted data yet.',
          failed: plan.error ?? 'Could not read the documents for this onboarding.',
        };
        res.status(400).json({ id, reason: plan.reason, error: messages[plan.reason] });
        return;
      }

      res.json({ id, driveId, documents: plan.documents });
    } catch (err) {
      console.error('[admin/onboardings/:id/drive-link]', err);
      res.status(500).json({ error: 'Could not link this onboarding to Drive.' });
    }
  },
);

router.post(
  '/onboardings/:id/drive-sync',
  requireAdminAuth,
  requirePermission(Permission.ManageDrive, Permission.ManageOnboardings),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid onboarding id.' });
      return;
    }

    const { only } = (req.body ?? {}) as { only?: unknown };
    const onlyKeys = Array.isArray(only) ? only.filter((k): k is string => typeof k === 'string') : undefined;

    const result = await pushOnboardingToDrive(id, onlyKeys);
    if (result.synced) {
      res.json({
        id,
        synced: true,
        uploaded: result.uploaded,
        skipped: result.skipped,
        failed: result.failed,
        error: result.error ?? null,
      });
      return;
    }

    const messages: Record<string, string> = {
      not_configured: 'This onboarding is not linked to a Drive sync.',
      no_data: 'This onboarding has no submitted data yet.',
      nothing_mapped: 'No document type on that Drive configuration has a folder, so there was nothing to file.',
      failed: result.error ?? 'The upload to Drive failed.',
    };
    res.status(400).json({ id, synced: false, reason: result.reason, error: messages[result.reason] });
  },
);

router.post(
  '/onboardings/:id/sheet-sync',
  requireAdminAuth,
  requirePermission(Permission.ManageSheets, Permission.ManageOnboardings),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid onboarding id.' });
      return;
    }

    const result = await appendOnboardingToSheet(id);
    if (result.appended) {
      await OnboardingAuth.updateOne(
        { _id: id },
        { $set: { sheetSyncedAt: new Date() }, $unset: { sheetError: 1, syncQueuedAt: 1, syncAttempts: 1 } },
      );
      res.json({ id, synced: true });
      return;
    }

    const messages: Record<string, string> = {
      not_configured: 'This onboarding is not linked to a Google Sheet.',
      no_data: 'This onboarding has no submitted data yet.',
      failed: result.error ?? 'The append to the sheet failed.',
    };
    res.status(400).json({ id, synced: false, reason: result.reason, error: messages[result.reason] });
  },
);

router.get(
  '/notifications',
  requireAdminAuth,
  requirePermission(Permission.ViewNotifications),
  async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(String((req.query as { limit?: string }).limit ?? ''), 10) || 50, 1), 200);
      const [items, unread] = await Promise.all([
        Notification.find()
          .populate<{ user: IUser }>('user', 'firstName lastName email')
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean(),
        Notification.countDocuments({ read: false }),
      ]);

      res.json({
        unread,
        notifications: items.map((n) => {
          const user = n.user as unknown as IUser | undefined;
          return {
            id: (n._id as object).toString(),
            type: n.type,
            severity: n.severity,
            title: n.title,
            message: n.message,
            read: n.read,
            createdAt: n.createdAt,
            person: user ? { name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(), email: user.email } : null,
            onboardingId: n.onboardingAuth ? (n.onboardingAuth as object).toString() : null,
          };
        }),
      });
    } catch (err) {
      console.error('[admin/notifications]', err);
      res.status(500).json({ error: 'Failed to fetch notifications.' });
    }
  },
);

router.post(
  '/notifications/mark-read',
  requireAdminAuth,
  requirePermission(Permission.ViewNotifications),
  async (req: Request, res: Response) => {
    const { ids } = req.body as { ids?: string[] };

    try {
      if (Array.isArray(ids) && ids.length) {
        const valid = ids.filter((id) => Types.ObjectId.isValid(id));
        await Notification.updateMany({ _id: { $in: valid } }, { read: true });
      } else {
        await Notification.updateMany({ read: false }, { read: true });
      }
      const unread = await Notification.countDocuments({ read: false });
      res.json({ unread });
    } catch (err) {
      console.error('[admin/notifications/mark-read]', err);
      res.status(500).json({ error: 'Failed to update notifications.' });
    }
  },
);

function slackConfigJson(config: ISlackConfig) {
  return {
    id: (config._id as object).toString(),
    name: config.name,
    channelId: config.channelId ?? null,
    usesDefaultBot: !config.botToken,
    channelLabel: config.channelLabel ?? null,
    events: config.events ?? [],
    enabled: config.enabled !== false,
    notifyCount: config.notifyCount ?? 0,
    lastNotifiedAt: config.lastNotifiedAt ?? null,
    lastError: config.lastError ?? null,
    createdAt: config.createdAt,
  };
}

router.get(
  '/slack',
  requireAdminAuth,
  requirePermission(Permission.ManageSlack),
  async (_req: Request, res: Response) => {
    try {
      const configs = await SlackConfig.find().sort({ name: 1 });

      let defaultBot: { configured: boolean; name?: string; team?: string; error?: string } = {
        configured: hasDefaultBot(),
      };
      if (defaultBot.configured) {
        try {
          defaultBot = { configured: true, ...(await describeBot(defaultBotToken()!)) };
        } catch (err) {
          defaultBot = { configured: true, error: (err as Error).message };
        }
      }

      res.json({
        defaultBot,
        events: Object.values(SlackEvent).map((key) => ({ key, ...SLACK_EVENT_LABELS[key] })),
        configs: configs.map(slackConfigJson),
      });
    } catch (err) {
      console.error('[admin/slack]', err);
      res.status(500).json({ error: 'Failed to fetch Slack configurations.' });
    }
  },
);

router.post(
  '/slack',
  requireAdminAuth,
  requirePermission(Permission.ManageSlack),
  async (req: Request, res: Response) => {
    const { name, botToken, channelId, channelLabel, events } = req.body as {
      name?: string; botToken?: string; channelId?: string; channelLabel?: string; events?: string[];
    };

    if (!name?.trim()) {
      res.status(400).json({ error: 'A name is required.' });
      return;
    }
    const ownToken = botToken?.trim();
    if (ownToken && !isBotToken(ownToken)) {
      res.status(400).json({ error: 'That is not a Slack bot token (xoxb-...).' });
      return;
    }
    if (!ownToken && !hasDefaultBot()) {
      res.status(400).json({
        error: 'No default bot on the server. Set DEFAULT_BOT_TOKEN, or give this channel its own token.',
      });
      return;
    }
    if (!channelId?.trim()) {
      res.status(400).json({ error: 'A channel ID is required.' });
      return;
    }

    const target = { botToken: ownToken || defaultBotToken()!, channelId: channelId.trim() };

    try {
      await sendSlackTest(target);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const known = new Set(Object.values(SlackEvent) as string[]);
    const chosen = (events ?? []).filter((e) => known.has(e)) as SlackEvent[];

    try {
      const config = await SlackConfig.create({
        name: name.trim(),
        botToken: ownToken || undefined,
        channelId: target.channelId,
        channelLabel: channelLabel?.trim() || undefined,
        events: chosen,
        createdBy: req.admin!._id as Types.ObjectId,
      });
      res.status(201).json(slackConfigJson(config));
    } catch (err) {
      console.error('[admin/slack] create', err);
      res.status(500).json({ error: 'Failed to save the Slack configuration.' });
    }
  },
);

router.patch(
  '/slack/:id',
  requireAdminAuth,
  requirePermission(Permission.ManageSlack),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid configuration id.' });
      return;
    }

    const { name, channelLabel, events, enabled, botToken, channelId } = req.body as {
      name?: string; channelLabel?: string; events?: string[]; enabled?: boolean;
      botToken?: string; channelId?: string;
    };

    const update: Record<string, unknown> = {};
    if (name?.trim()) update.name = name.trim();
    if (channelLabel !== undefined) update.channelLabel = channelLabel?.trim() || undefined;
    if (typeof enabled === 'boolean') update.enabled = enabled;

    if (botToken?.trim()) {
      if (!isBotToken(botToken)) {
        res.status(400).json({ error: 'That is not a Slack bot token (xoxb-...).' });
        return;
      }
      update.botToken = botToken.trim();
    }

    if (channelId?.trim()) update.channelId = channelId.trim();

    if (events) {
      const known = new Set(Object.values(SlackEvent) as string[]);
      update.events = events.filter((e) => known.has(e));
    }

    if (!Object.keys(update).length) {
      res.status(400).json({ error: 'Nothing to update.' });
      return;
    }

    try {
      const config = await SlackConfig.findByIdAndUpdate(id, update, { returnDocument: 'after' });
      if (!config) {
        res.status(404).json({ error: 'Configuration not found.' });
        return;
      }
      res.json(slackConfigJson(config));
    } catch (err) {
      console.error('[admin/slack/:id] update', err);
      res.status(500).json({ error: 'Failed to update the Slack configuration.' });
    }
  },
);

router.post(
  '/slack/:id/test',
  requireAdminAuth,
  requirePermission(Permission.ManageSlack),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid configuration id.' });
      return;
    }

    try {
      const config = await SlackConfig.findById(id);
      if (!config) {
        res.status(404).json({ error: 'Configuration not found.' });
        return;
      }
      await sendSlackTest(targetOf(config));
      await SlackConfig.updateOne({ _id: config._id }, { $unset: { lastError: 1 } });
      res.json({ id, sent: true });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  },
);

router.delete(
  '/slack/:id',
  requireAdminAuth,
  requirePermission(Permission.ManageSlack),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid configuration id.' });
      return;
    }

    try {
      const config = await SlackConfig.findByIdAndDelete(id);
      if (!config) {
        res.status(404).json({ error: 'Configuration not found.' });
        return;
      }
      res.json({ id, deleted: true });
    } catch (err) {
      console.error('[admin/slack/:id] delete', err);
      res.status(500).json({ error: 'Failed to remove the Slack configuration.' });
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
      await ScheduledEmail.updateMany({ recipients: user._id }, { $pull: { recipients: user._id } });
      await UserGroup.updateMany({ members: user._id }, { $pull: { members: user._id } });
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
      const emails = await ScheduledEmail.find({ $or: [{ user: id }, { recipients: id }] })
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
        batchId: email.batchId ? email.batchId.toString() : null,
        combined: Array.isArray(email.recipients),
        recipientCount: Array.isArray(email.recipients) ? email.recipients.length : 1,
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
      const email = await ScheduledEmail.findOne({ _id: emailId, $or: [{ user: id }, { recipients: id }] })
        .populate<{ user: IUser }>('user', 'firstName lastName email')
        .populate<{ recipients: IUser[] }>('recipients', 'firstName lastName email')
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

      let batch: { id: string; total: number; pending: number } | null = null;
      if (email.batchId) {
        const [total, pending] = await Promise.all([
          ScheduledEmail.countDocuments({ batchId: email.batchId }),
          ScheduledEmail.countDocuments({ batchId: email.batchId, status: ScheduledEmailStatus.Pending }),
        ]);
        batch = { id: email.batchId.toString(), total, pending };
      }

      res.json({
        id: email._id.toString(),
        title: email.title,
        subject: email.subject ?? email.title,
        subtitle: email.subtitle ?? null,
        contentHtml: email.contentHtml,
        contentMarkdown: email.contentMarkdown ?? null,
        status: email.status,
        to: person(email.user),
        combined: Array.isArray(email.recipients),
        addressing: email.addressing ?? null,
        recipients: Array.isArray(email.recipients) ? email.recipients.map(person).filter(Boolean) : null,
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
        batch,
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
        const combined = await ScheduledEmail.exists({ _id: emailId, recipients: id });
        res.status(combined ? 409 : 404).json({
          error: combined
            ? "This email goes to a whole group in one message. Cancel it from the group's page."
            : 'Email not found.',
        });
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
        { _id: email._id, status: ScheduledEmailStatus.Pending, ...notLockedFilter(new Date()) },
        {
          status: ScheduledEmailStatus.Cancelled,
          cancelledAt: new Date(),
          cancelledBy: req.admin!._id as Types.ObjectId,
        },
      );

      if (!updated.modifiedCount) {
        res.status(409).json({ error: 'That email is being sent right now and can no longer be cancelled.' });
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

    const unknownPlaceholders = findUnknownPlaceholders(title, subtitle, content, contentMarkdown);
    if (unknownPlaceholders.length) {
      res.status(400).json({ error: unknownPlaceholderMessage(unknownPlaceholders), reason: 'unknown_placeholder' });
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
      const values = placeholderValues(user);

      const record = await createScheduledEmail({
        userId: user._id as Types.ObjectId,
        title: fillText(title.trim(), values),
        subject: thread?.subject,
        subtitle: subtitle?.trim() ? fillText(subtitle.trim(), values) : undefined,
        contentHtml: fillHtml(sanitizeHtml(content, EXTRA_CONTENT_SANITIZE_OPTIONS), values),
        contentMarkdown: contentMarkdown ? fillText(contentMarkdown, values) : contentMarkdown,
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

      const outcome = await deliverScheduledEmail(record);

      if (outcome === 'failed') {
        const saved = await ScheduledEmail.findById(record._id);
        res.status(502).json({ error: saved?.lastError || "The email couldn't be sent." });
        return;
      }

      res.status(201).json({ id: (record._id as object).toString(), scheduled: false, sent: outcome === 'sent', queued: outcome === 'skipped' });
    } catch (err) {
      console.error('[admin/users/:id/send-email]', err);
      res.status(500).json({ error: 'Failed to send the email.' });
    }
  },
);

interface ComposeInput {
  title: string;
  subtitle?: string;
  contentHtml: string;
  contentMarkdown?: string;
  cc?: string[];
  bcc?: string[];
  when?: Date;
}

type ComposeResult = { input: ComposeInput } | { error: string; reason?: string };

function parseCompose(body: Record<string, unknown>, personalized: boolean): ComposeResult {
  const { title, subtitle, content, contentMarkdown, cc, bcc, scheduledAt } = body as {
    title?: string;
    subtitle?: string;
    content?: string;
    contentMarkdown?: string;
    cc?: string | string[];
    bcc?: string | string[];
    scheduledAt?: string;
  };

  if (!title || typeof title !== 'string' || !title.trim()) return { error: 'A title is required.' };
  if (!content || typeof content !== 'string' || !content.trim()) return { error: 'A message is required.' };

  const unknownPlaceholders = findUnknownPlaceholders(title, subtitle, content, contentMarkdown);
  if (unknownPlaceholders.length) {
    return { error: unknownPlaceholderMessage(unknownPlaceholders), reason: 'unknown_placeholder' };
  }

  if (!personalized && findKnownPlaceholders(title, subtitle, content, contentMarkdown).length) {
    return {
      error: 'Placeholders like {{firstName}} only work when each member gets a separate email.',
      reason: 'placeholder_in_combined',
    };
  }

  let when: Date | undefined;
  if (scheduledAt) {
    if (Number.isNaN(Date.parse(scheduledAt))) return { error: 'Invalid schedule date.' };
    when = new Date(scheduledAt);
    if (when.getTime() <= Date.now()) return { error: 'The scheduled time must be in the future.' };
  }

  const toArray = (v: string | string[] | undefined) => (v ? (Array.isArray(v) ? v : [v]) : undefined);

  return {
    input: {
      title: title.trim(),
      subtitle: subtitle?.trim() || undefined,
      contentHtml: sanitizeHtml(content, EXTRA_CONTENT_SANITIZE_OPTIONS),
      contentMarkdown,
      cc: toArray(cc),
      bcc: toArray(bcc),
      when,
    },
  };
}

type Recipient = { _id: unknown; firstName?: string; lastName?: string; email?: string };

async function sendSeparately(
  users: Recipient[],
  input: ComposeInput,
  adminId: Types.ObjectId,
  startedAt: number,
  userGroup?: Types.ObjectId,
) {
  const batchId = new Types.ObjectId();

  const records = await createScheduledEmails(users.map((user) => {
    const values = placeholderValues(user);
    return {
      userId: user._id as Types.ObjectId,
      title: fillText(input.title, values),
      subtitle: input.subtitle ? fillText(input.subtitle, values) : undefined,
      contentHtml: fillHtml(input.contentHtml, values),
      contentMarkdown: input.contentMarkdown ? fillText(input.contentMarkdown, values) : input.contentMarkdown,
      cc: input.cc,
      bcc: input.bcc,
      scheduledAt: input.when,
      batchId,
      batchTitle: input.title,
      userGroup,
      createdBy: adminId,
    };
  }));

  if (input.when) {
    return { batchId: batchId.toString(), total: records.length, scheduled: true, scheduledAt: input.when };
  }

  const result = await deliverScheduledEmails(records, startedAt + BULK_SEND_BUDGET_MS);
  const failed = await ScheduledEmail.countDocuments({ batchId, status: ScheduledEmailStatus.Failed });

  return {
    batchId: batchId.toString(),
    total: records.length,
    scheduled: false,
    sent: result.sent,
    failed,
    queued: records.length - result.sent - failed,
  };
}

router.post(
  '/users/bulk-send-email',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const { userIds } = req.body as { userIds?: unknown };

    if (!Array.isArray(userIds) || !userIds.length) {
      res.status(400).json({ error: 'Choose at least one recipient.' });
      return;
    }

    const ids = [...new Set(userIds.map(String))];

    if (ids.some((id) => !Types.ObjectId.isValid(id))) {
      res.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    if (ids.length > MAX_BULK_EMAIL_RECIPIENTS) {
      res.status(400).json({ error: `A group email can go to at most ${MAX_BULK_EMAIL_RECIPIENTS} people at once.` });
      return;
    }

    const parsed = parseCompose(req.body, true);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, reason: parsed.reason });
      return;
    }

    try {
      const users = await User.find({ _id: { $in: ids } }, { firstName: 1, lastName: 1, email: 1 }).lean();

      if (users.length !== ids.length) {
        res.status(404).json({ error: 'Some of the selected users no longer exist. Reload the list and try again.' });
        return;
      }

      const byId = new Map(users.map((user) => [String(user._id), user]));
      const ordered = ids.map((id) => byId.get(id)!);

      res.status(201).json(await sendSeparately(ordered, parsed.input, req.admin!._id as Types.ObjectId, startedAt));
    } catch (err) {
      console.error('[admin/users/bulk-send-email]', err);
      res.status(500).json({ error: 'Failed to send the group email.' });
    }
  },
);

router.post(
  '/email-batches/:batchId/cancel',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { batchId } = req.params as { batchId: string };

    if (!Types.ObjectId.isValid(batchId)) {
      res.status(400).json({ error: 'Invalid group id.' });
      return;
    }

    try {
      const total = await ScheduledEmail.countDocuments({ batchId });
      if (!total) {
        res.status(404).json({ error: 'Group email not found.' });
        return;
      }

      const now = new Date();
      const updated = await ScheduledEmail.updateMany(
        { batchId, status: ScheduledEmailStatus.Pending, ...notLockedFilter(now) },
        {
          status: ScheduledEmailStatus.Cancelled,
          cancelledAt: now,
          cancelledBy: req.admin!._id as Types.ObjectId,
        },
      );

      const remaining = await ScheduledEmail.countDocuments({ batchId, status: ScheduledEmailStatus.Pending });

      res.json({ batchId, total, cancelled: updated.modifiedCount, stillSending: remaining });
    } catch (err) {
      console.error('[admin/email-batches/:batchId/cancel]', err);
      res.status(500).json({ error: 'Failed to cancel the group email.' });
    }
  },
);

const MAX_GROUP_NAME_LENGTH = 80;
const MAX_GROUP_DESCRIPTION_LENGTH = 300;

function serializeUserGroup(group: IUserGroup) {
  return {
    id: (group._id as object).toString(),
    name: group.name,
    description: group.description ?? null,
    memberCount: group.members?.length ?? 0,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

function parseGroupFields(body: { name?: unknown; description?: unknown }, requireName: boolean) {
  const fields: { name?: string; description?: string } = {};

  if (body.name !== undefined || requireName) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: 'A group name is required.' };
    if (name.length > MAX_GROUP_NAME_LENGTH) return { error: `Group names can be at most ${MAX_GROUP_NAME_LENGTH} characters.` };
    fields.name = name;
  }

  if (body.description !== undefined) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > MAX_GROUP_DESCRIPTION_LENGTH) {
      return { error: `Descriptions can be at most ${MAX_GROUP_DESCRIPTION_LENGTH} characters.` };
    }
    fields.description = description;
  }

  return { fields };
}

async function findUsersByIds(raw: unknown): Promise<{ error: string; status: number } | { ids: Types.ObjectId[] }> {
  if (!Array.isArray(raw)) return { error: 'userIds must be a list.', status: 400 };
  const ids = [...new Set(raw.map(String))];
  if (ids.some((id) => !Types.ObjectId.isValid(id))) return { error: 'Invalid user id.', status: 400 };
  const found = await User.find({ _id: { $in: ids } }, { _id: 1 }).lean();
  if (found.length !== ids.length) {
    return { error: 'Some of those users no longer exist. Reload the list and try again.', status: 404 };
  }
  return { ids: ids.map((id) => new Types.ObjectId(id)) };
}

function isDuplicateKey(err: unknown) {
  return (err as { code?: number })?.code === 11000;
}

router.get(
  '/user-groups',
  requireAdminAuth,
  requirePermission(Permission.ManageUsers, Permission.EmailUsers),
  async (_req: Request, res: Response) => {
    try {
      const groups = await UserGroup.find().sort({ name: 1 }).collation({ locale: 'en' });
      res.json(groups.map(serializeUserGroup));
    } catch (err) {
      console.error('[admin/user-groups]', err);
      res.status(500).json({ error: 'Failed to fetch groups.' });
    }
  },
);

router.post(
  '/user-groups',
  requireAdminAuth,
  requirePermission(Permission.ManageUsers),
  async (req: Request, res: Response) => {
    const parsed = parseGroupFields(req.body ?? {}, true);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    try {
      let members: Types.ObjectId[] = [];
      if ((req.body as { memberIds?: unknown }).memberIds !== undefined) {
        const found = await findUsersByIds((req.body as { memberIds?: unknown }).memberIds);
        if ('error' in found) {
          res.status(found.status).json({ error: found.error });
          return;
        }
        members = found.ids;
      }

      const group = await UserGroup.create({
        ...parsed.fields,
        members,
        createdBy: req.admin!._id,
      });
      res.status(201).json(serializeUserGroup(group));
    } catch (err) {
      if (isDuplicateKey(err)) {
        res.status(409).json({ error: 'A group with that name already exists.' });
        return;
      }
      console.error('[admin/user-groups create]', err);
      res.status(500).json({ error: 'Failed to create the group.' });
    }
  },
);

router.get(
  '/user-groups/:id',
  requireAdminAuth,
  requirePermission(Permission.ManageUsers, Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid group id.' });
      return;
    }

    try {
      const group = await UserGroup.findById(id);
      if (!group) {
        res.status(404).json({ error: 'Group not found.' });
        return;
      }

      const members = await User.find(
        { _id: { $in: group.members } },
        { email: 1, firstName: 1, lastName: 1, isAdmin: 1, createdAt: 1 },
      )
        .sort({ firstName: 1, lastName: 1 })
        .collation({ locale: 'en' })
        .lean();

      const creator = group.createdBy
        ? await User.findById(group.createdBy, { firstName: 1, lastName: 1, email: 1 }).lean()
        : null;

      res.json({
        ...serializeUserGroup(group),
        memberCount: members.length,
        createdBy: creator?.email ? { name: `${creator.firstName} ${creator.lastName}`.trim(), email: creator.email } : null,
        members: members.map((user) => ({
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt,
        })),
      });
    } catch (err) {
      console.error('[admin/user-groups/:id]', err);
      res.status(500).json({ error: 'Failed to fetch the group.' });
    }
  },
);

router.patch(
  '/user-groups/:id',
  requireAdminAuth,
  requirePermission(Permission.ManageUsers),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid group id.' });
      return;
    }

    const parsed = parseGroupFields(req.body ?? {}, false);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    try {
      const update: Record<string, unknown> = {};
      if (parsed.fields.name !== undefined) update.name = parsed.fields.name;
      if (parsed.fields.description !== undefined) {
        if (parsed.fields.description) update.description = parsed.fields.description;
        else update.$unset = { description: 1 };
      }

      const group = await UserGroup.findByIdAndUpdate(id, update, { returnDocument: 'after', runValidators: true });
      if (!group) {
        res.status(404).json({ error: 'Group not found.' });
        return;
      }
      res.json(serializeUserGroup(group));
    } catch (err) {
      if (isDuplicateKey(err)) {
        res.status(409).json({ error: 'A group with that name already exists.' });
        return;
      }
      console.error('[admin/user-groups/:id update]', err);
      res.status(500).json({ error: 'Failed to update the group.' });
    }
  },
);

router.delete(
  '/user-groups/:id',
  requireAdminAuth,
  requirePermission(Permission.ManageUsers),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid group id.' });
      return;
    }

    try {
      const deleted = await UserGroup.findByIdAndDelete(id);
      if (!deleted) {
        res.status(404).json({ error: 'Group not found.' });
        return;
      }
      res.json({ id, deleted: true });
    } catch (err) {
      console.error('[admin/user-groups/:id delete]', err);
      res.status(500).json({ error: 'Failed to delete the group.' });
    }
  },
);

router.post(
  '/user-groups/:id/members',
  requireAdminAuth,
  requirePermission(Permission.ManageUsers),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid group id.' });
      return;
    }

    try {
      const found = await findUsersByIds((req.body as { userIds?: unknown }).userIds);
      if ('error' in found) {
        res.status(found.status).json({ error: found.error });
        return;
      }
      if (!found.ids.length) {
        res.status(400).json({ error: 'Choose at least one user to add.' });
        return;
      }

      const before = await UserGroup.findById(id, { members: 1 }).lean();
      if (!before) {
        res.status(404).json({ error: 'Group not found.' });
        return;
      }

      const group = await UserGroup.findByIdAndUpdate(
        id,
        { $addToSet: { members: { $each: found.ids } } },
        { returnDocument: 'after' },
      );

      res.json({
        ...serializeUserGroup(group!),
        added: (group!.members.length) - (before.members?.length ?? 0),
      });
    } catch (err) {
      console.error('[admin/user-groups/:id/members add]', err);
      res.status(500).json({ error: 'Failed to add members.' });
    }
  },
);

router.delete(
  '/user-groups/:id/members/:userId',
  requireAdminAuth,
  requirePermission(Permission.ManageUsers),
  async (req: Request, res: Response) => {
    const { id, userId } = req.params as { id: string; userId: string };
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      res.status(400).json({ error: 'Invalid id.' });
      return;
    }

    try {
      const group = await UserGroup.findByIdAndUpdate(
        id,
        { $pull: { members: new Types.ObjectId(userId) } },
        { returnDocument: 'after' },
      );
      if (!group) {
        res.status(404).json({ error: 'Group not found.' });
        return;
      }
      res.json(serializeUserGroup(group));
    } catch (err) {
      console.error('[admin/user-groups/:id/members remove]', err);
      res.status(500).json({ error: 'Failed to remove the member.' });
    }
  },
);

router.post(
  '/user-groups/:id/send-email',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const { id } = req.params as { id: string };
    const { mode, addressing } = req.body as { mode?: string; addressing?: string };

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid group id.' });
      return;
    }

    if (mode !== 'combined' && mode !== 'separate') {
      res.status(400).json({ error: 'Choose whether to send one combined email or separate emails.' });
      return;
    }

    if (mode === 'combined' && addressing !== undefined && addressing !== CombinedAddressing.To && addressing !== CombinedAddressing.Bcc) {
      res.status(400).json({ error: 'Invalid addressing option.' });
      return;
    }

    const parsed = parseCompose(req.body, mode === 'separate');
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error, reason: parsed.reason });
      return;
    }

    try {
      const group = await UserGroup.findById(id);
      if (!group) {
        res.status(404).json({ error: 'Group not found.' });
        return;
      }

      const members = await User.find({ _id: { $in: group.members } }, { firstName: 1, lastName: 1, email: 1 })
        .sort({ firstName: 1, lastName: 1 })
        .collation({ locale: 'en' })
        .lean();

      if (!members.length) {
        res.status(400).json({ error: 'This group has no members yet.' });
        return;
      }

      if (members.length > MAX_BULK_EMAIL_RECIPIENTS) {
        res.status(400).json({ error: `A group email can go to at most ${MAX_BULK_EMAIL_RECIPIENTS} people at once.` });
        return;
      }

      const adminId = req.admin!._id as Types.ObjectId;
      const groupId = group._id as Types.ObjectId;

      if (mode === 'separate') {
        res.status(201).json(await sendSeparately(members, parsed.input, adminId, startedAt, groupId));
        return;
      }

      const input = parsed.input;
      const record = await createScheduledEmail({
        recipients: members.map((member) => member._id as Types.ObjectId),
        addressing: addressing === CombinedAddressing.Bcc ? CombinedAddressing.Bcc : CombinedAddressing.To,
        userGroup: groupId,
        title: input.title,
        subtitle: input.subtitle,
        contentHtml: input.contentHtml,
        contentMarkdown: input.contentMarkdown,
        cc: input.cc,
        bcc: input.bcc,
        scheduledAt: input.when,
        createdBy: adminId,
      });

      if (input.when) {
        res.status(201).json({
          id: (record._id as object).toString(),
          total: members.length,
          scheduled: true,
          scheduledAt: record.scheduledAt,
        });
        return;
      }

      const outcome = await deliverScheduledEmail(record);
      if (outcome === 'failed') {
        const saved = await ScheduledEmail.findById(record._id);
        res.status(502).json({ error: saved?.lastError || "The email couldn't be sent." });
        return;
      }

      res.status(201).json({
        id: (record._id as object).toString(),
        total: members.length,
        scheduled: false,
        sent: outcome === 'sent',
        queued: outcome === 'skipped',
      });
    } catch (err) {
      console.error('[admin/user-groups/:id/send-email]', err);
      res.status(500).json({ error: 'Failed to send the group email.' });
    }
  },
);

router.get(
  '/user-groups/:id/emails',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid group id.' });
      return;
    }

    try {
      const rows = await ScheduledEmail.aggregate([
        { $match: { userGroup: new Types.ObjectId(id) } },
        {
          $group: {
            _id: { $ifNull: ['$batchId', '$_id'] },
            separate: { $max: { $cond: [{ $ifNull: ['$batchId', false] }, true, false] } },
            title: { $first: { $ifNull: ['$batchTitle', '$title'] } },
            addressing: { $first: '$addressing' },
            recipientCount: { $sum: { $cond: [{ $isArray: '$recipients' }, { $size: '$recipients' }, 1] } },
            emails: { $sum: 1 },
            sent: { $sum: { $cond: [{ $eq: ['$status', ScheduledEmailStatus.Sent] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ['$status', ScheduledEmailStatus.Pending] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', ScheduledEmailStatus.Failed] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', ScheduledEmailStatus.Cancelled] }, 1, 0] } },
            scheduledAt: { $min: '$scheduledAt' },
            lastSentAt: { $max: '$sentAt' },
            createdAt: { $min: '$createdAt' },
            createdBy: { $first: '$createdBy' },
            lastError: { $max: '$lastError' },
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: 50 },
      ]);

      const creatorIds = [...new Set(rows.map((row) => row.createdBy && String(row.createdBy)).filter(Boolean))];
      const creators = await User.find({ _id: { $in: creatorIds } }, { firstName: 1, lastName: 1 }).lean();
      const creatorNames = new Map(creators.map((user) => [String(user._id), `${user.firstName} ${user.lastName}`.trim()]));

      res.json(rows.map((row) => ({
        id: String(row._id),
        kind: row.separate ? 'separate' : 'combined',
        title: row.title,
        addressing: row.addressing ?? null,
        recipients: row.recipientCount,
        emails: row.emails,
        sent: row.sent,
        pending: row.pending,
        failed: row.failed,
        cancelled: row.cancelled,
        scheduledAt: row.scheduledAt,
        lastSentAt: row.lastSentAt ?? null,
        createdAt: row.createdAt,
        sentBy: row.createdBy ? creatorNames.get(String(row.createdBy)) ?? null : null,
        lastError: row.lastError ?? null,
      })));
    } catch (err) {
      console.error('[admin/user-groups/:id/emails]', err);
      res.status(500).json({ error: 'Failed to fetch the group emails.' });
    }
  },
);

router.post(
  '/user-groups/:id/emails/:emailId/cancel',
  requireAdminAuth,
  requirePermission(Permission.EmailUsers),
  async (req: Request, res: Response) => {
    const { id, emailId } = req.params as { id: string; emailId: string };
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(emailId)) {
      res.status(400).json({ error: 'Invalid id.' });
      return;
    }

    try {
      const email = await ScheduledEmail.findOne({ _id: emailId, userGroup: id, recipients: { $exists: true } });
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
        { _id: email._id, status: ScheduledEmailStatus.Pending, ...notLockedFilter(new Date()) },
        { status: ScheduledEmailStatus.Cancelled, cancelledAt: new Date(), cancelledBy: req.admin!._id as Types.ObjectId },
      );

      if (!updated.modifiedCount) {
        res.status(409).json({ error: 'That email is being sent right now and can no longer be cancelled.' });
        return;
      }

      res.json({ id: emailId, cancelled: true });
    } catch (err) {
      console.error('[admin/user-groups/:id/emails/:emailId/cancel]', err);
      res.status(500).json({ error: 'Failed to cancel the email.' });
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
          sheetConfigured: !!auth.sheetConfig,
          sheetSyncedAt: auth.sheetSyncedAt ?? null,
          sheetError: auth.sheetError ?? null,
          driveConfigured: !!auth.driveConfig,
          driveId: auth.driveConfig ? (auth.driveConfig as object).toString() : null,
          driveSyncedAt: auth.driveSyncedAt ?? null,
          driveError: auth.driveError ?? null,
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
        preferred_dob:          formatDate(data.preferredDob),
        nationality:            data.nationality ?? null,
        gender:                 data.gender ?? null,
        marital_status:         data.maritalStatus ?? null,
        blood_group:            data.bloodGroup ?? null,
        emergency_contact_name:   data.emergencyContactName ?? null,
        emergency_contact_number: data.emergencyContactNumber ?? null,
        passport_number:        data.passportNumber ?? null,
        pan_number:             data.panNumber ?? null,
        passport_no:            data.passportNo ?? null,
        uan_number:             data.uanNumber ?? null,
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
        orgs:                   (data.orgs ?? []).map((org) => ({
          name: org.name,
          duration: org.duration,
          role: org.role ?? null,
          info: org.info ?? null,
          current: org.current,
          relievingLetterDoc: docEntry(org.relievingLetterDoc),
        })),
        bank_name:              data.bankName ?? null,
        account_holder:         data.accountHolder ?? null,
        account_number:         data.accountNumber ?? null,
        ifsc:                   data.ifsc ?? null,
        intro_line:             data.introLine ?? null,
        meal_preference:        data.mealPreference ?? null,
        declaration:            data.declaration ?? null,
        consent:                data.consent ?? null,
        experience_rating:      data.experienceRating ?? null,
        experience_feedback:    data.experienceFeedback ?? null,
      },
      extraFields: await extraFieldsForAdmin(auth, data),
      docs: {
        pan_doc:               docEntry(data.panDoc),
        passport_doc:          docEntry(data.passportDoc),
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
      'extraFields',
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

    const extraDefs = (auth.extraFields ?? []) as ExtraFieldDef[];
    const extraStored = data?.extraFields as Map<string, unknown> | Record<string, unknown> | undefined;
    const readExtra = (key: string) =>
      extraStored instanceof Map
        ? extraStored.get(key)
        : (extraStored as Record<string, unknown> | undefined)?.[key];

    const extraAnswers = extraDefs.map((def) => ({
      label: def.label,
      type: def.type,
      required: def.required,
      answered: hasValue(readExtra(def.key)),
    }));

    extraAnswers.forEach((entry) => {
      if (entry.answered) filled.push(entry.label);
    });

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
        extraFields: extraAnswers,
        extraFieldsAnswered: extraAnswers.filter((e) => e.answered).length,
        extraFieldsTotal: extraAnswers.length,
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

    const attachmentIds = auth.attachmentIds ?? [];
    const attachments = attachmentIds.length
      ? (await AdminAttachment.find({ _id: { $in: attachmentIds } }, { originalName: 1, sizeBytes: 1 }).lean())
          .map((a) => ({ id: (a._id as object).toString(), originalName: a.originalName, sizeBytes: a.sizeBytes }))
      : [];

    res.json({
      id: (auth._id as object).toString(),
      userId: user ? (user._id as object).toString() : null,
      company: auth.company,
      location: auth.location,
      department: auth.department ?? null,
      ttl: auth.ttl,
      cc: auth.cc ?? null,
      bcc: auth.bcc ?? null,
      extraContent: auth.extraContent ?? null,
      title: auth.title ?? null,
      sheetId: auth.sheetConfig ? (auth.sheetConfig as object).toString() : null,
      driveId: auth.driveConfig ? (auth.driveConfig as object).toString() : null,
      extraFields: auth.extraFields ?? [],
      attachments,
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
    if (typeof cookieKey === 'string') {
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

  if (!cookieKey || typeof cookieKey !== 'string') {
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
