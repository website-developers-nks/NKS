import { Router, Request, Response } from 'express';
import { randomUUID, timingSafeEqual } from 'crypto';
import { Types } from 'mongoose';
import rateLimit from 'express-rate-limit';
import sanitizeHtml from 'sanitize-html';
import { User, IUser } from '../db/models/user.model';
import { OnboardingAuth, OfficeLocation, Company, OnboardingExpiryReason } from '../db/models/onboarding-auth.model';
import { OnboardingData } from '../db/models/onboarding-data.model';
import { requireAdminAuth } from '../middleware/admin-auth.middleware';
import { getEmailEngineByCompany, getSenderByCompany } from '../email';
import { OnboardingInviteEmail } from '../email/emails/onboarding-invite.email';
import { getCompanyName } from '../email/base.email';

const router = Router();

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

router.post('/create-user', requireAdminAuth, async (req: Request, res: Response) => {
  const { email, firstName, lastName } = req.body as {
    email?: string;
    firstName?: string;
    lastName?: string;
  };

  if (!email || !firstName || !lastName) {
    res.status(400).json({ error: 'email, firstName and lastName are required.' });
    return;
  }

  try {
    const user = await User.create({ email, firstName, lastName });
    res.status(201).json({
      id: (user._id as object).toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 11000) {
      res.status(409).json({ error: 'A user with this email already exists.' });
      return;
    }
    console.error('[admin/create-user]', err);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

router.post('/register-onboarding', requireAdminAuth, async (req: Request, res: Response) => {
  const { userId, ttl, location, company, cc, bcc, extraContent, extraContentMarkdown, expirationDate } = req.body as {
    userId?: string;
    ttl?: number;
    location?: string;
    company?: string;
    cc?: string | string[];
    bcc?: string | string[];
    extraContent?: string;
    extraContentMarkdown?: string;
    expirationDate?: string;
  };

  const validLocations = Object.values(OfficeLocation);
  const validCompanies = Object.values(Company);

  if (!userId || !ttl || typeof ttl !== 'number' || ttl <= 0) {
    res.status(400).json({ error: 'userId and a positive numeric ttl are required.' });
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
    });

    const baseUrl = company == Company.NKSRT ? (process.env.ONBOARDING_BASE_URL_DUBAI??"https://nksresearchtech.com")  : (process.env.ONBOARDING_BASE_URL ?? 'https://nksecurities.com');
    const onboardingUrl = `${baseUrl}/verify-onboarding.html?id=${onboardingKey}`;

    const toAddr = (v: string) => ({ address: v });
    const normalizeAddr = (v: string | string[] | undefined) =>
      v ? (Array.isArray(v) ? v.map(toAddr) : toAddr(v)) : undefined;

    const sender = getSenderByCompany(auth.company);
    await getEmailEngineByCompany(auth.company).send(
      new OnboardingInviteEmail(
        { name: `${user.firstName} ${user.lastName}`, address: user.email },
        {
          firstName: user.firstName,
          onboardingUrl,
          extraContent: extraContent ? sanitizeHtml(extraContent, EXTRA_CONTENT_SANITIZE_OPTIONS) : undefined,
        },
        { from: sender, cc: normalizeAddr(cc), bcc: normalizeAddr(bcc), subject:`${user.firstName} | Complete your onboarding - ${getCompanyName(auth.company)}` },
      ),
    );

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

router.get('/get-user-list', requireAdminAuth, async (_req: Request, res: Response) => {
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

const ADMIN_COOKIE = 'admin-auth';
const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: (process.env.COOKIE_SAME_SITE_NONE==='true' ? 'none' : 'strict') as ('none' | 'strict'),
  path: '/',
  maxAge: 8 * 60 * 60 * 1000,
};

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required.' });
    return;
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(503).json({ error: 'Admin auth is not configured.' });
    return;
  }

  try {
    const user = await User.findOne({ email: username.toLowerCase().trim(), isAdmin: true });

    const passA = Buffer.from(password);
    const passB = Buffer.from(adminPassword);
    const passwordMatch = passA.length === passB.length && timingSafeEqual(passA, passB);

    if (!user || !passwordMatch) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const authKey = randomUUID();
    await User.updateOne({ _id: user._id }, { authKey });

    res.cookie(ADMIN_COOKIE, authKey, ADMIN_COOKIE_OPTIONS);
    res.json({
      auth: true,
      user: {
        id: (user._id as object).toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (err) {
    console.error('[admin/login]', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.get('/onboardings', requireAdminAuth, async (req: Request, res: Response) => {
  const { search, status } = req.query as { search?: string; status?: string };

  try {
    const auths = await OnboardingAuth.find()
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

router.get('/onboardings/:id/data', requireAdminAuth, async (req: Request, res: Response) => {
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
      .populate(ONBOARDING_DOC_FIELDS, '_id originalName')
      .lean();

    if (!data) {
      res.status(404).json({ error: 'No onboarding data found.' });
      return;
    }

    const formatDate = (d: Date | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);

    const docEntry = (ref: unknown): { id: string; name: string } | null => {
      if (ref && typeof ref === 'object' && 'originalName' in (ref as object)) {
        const d = ref as { _id: object; originalName: string };
        return { id: d._id.toString(), name: d.originalName };
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

router.get('/onboardings/:id/register-data', requireAdminAuth, async (req: Request, res: Response) => {
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

router.patch('/onboardings/:id/expire', requireAdminAuth, async (req: Request, res: Response) => {
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
    await auth.save();

    res.json({ id: (auth._id as object).toString(), expired: true, expiredReason: auth.expiredReason });
  } catch (err) {
    console.error('[admin/onboardings/:id/expire]', err);
    res.status(500).json({ error: 'Failed to expire onboarding.' });
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

    res.json({
      auth: true,
      user: {
        id: (user._id as object).toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (err) {
    console.error('[admin/auth]', err);
    res.status(500).json({ error: 'Auth check failed.' });
  }
});

export default router;
