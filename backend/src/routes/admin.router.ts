import { Router, Request, Response } from 'express';
import { randomUUID, timingSafeEqual } from 'crypto';
import { Types } from 'mongoose';
import rateLimit from 'express-rate-limit';
import sanitizeHtml from 'sanitize-html';
import { User } from '../db/models/user.model';
import { OnboardingAuth, OfficeLocation } from '../db/models/onboarding-auth.model';
import { requireAdminAuth } from '../middleware/admin-auth.middleware';
import { getEmailEngineByLocation, getSenderByLocation } from '../email';
import { OnboardingInviteEmail } from '../email/emails/onboarding-invite.email';
import { getCompanyName } from '../email/base.email';

const router = Router();

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
  const { userId, ttl, location, cc, bcc, extraContent } = req.body as {
    userId?: string;
    ttl?: number;
    location?: string;
    cc?: string | string[];
    bcc?: string | string[];
    extraContent?: string;
  };

  const validLocations = Object.values(OfficeLocation);

  if (!userId || !ttl || typeof ttl !== 'number' || ttl <= 0) {
    res.status(400).json({ error: 'userId and a positive numeric ttl are required.' });
    return;
  }

  if (!location || !validLocations.includes(location as OfficeLocation)) {
    res.status(400).json({ error: 'location is required.', validLocations });
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
    const auth = await OnboardingAuth.create({ onboardingKey, user: user._id, ttl, location: location as OfficeLocation });

    const baseUrl = location == OfficeLocation.Dubai ? (process.env.ONBOARDING_BASE_URL_DUBAI??"https://nksresearchtech.com")  : (process.env.ONBOARDING_BASE_URL ?? 'https://nksecurities.com');
    const onboardingUrl = `${baseUrl}/verify-onboarding.html?id=${onboardingKey}`;

    const toAddr = (v: string) => ({ address: v });
    const normalizeAddr = (v: string | string[] | undefined) =>
      v ? (Array.isArray(v) ? v.map(toAddr) : toAddr(v)) : undefined;

    const sender = getSenderByLocation(auth.location);
    await getEmailEngineByLocation(auth.location).send(
      new OnboardingInviteEmail(
        { name: `${user.firstName} ${user.lastName}`, address: user.email },
        {
          firstName: user.firstName,
          onboardingUrl,
          extraContent: extraContent ? sanitizeHtml(extraContent, EXTRA_CONTENT_SANITIZE_OPTIONS) : undefined,
        },
        { from: sender, cc: normalizeAddr(cc), bcc: normalizeAddr(bcc), subject:`Complete your onboarding - ${getCompanyName(auth.location)}` },
      ),
    );

    res.status(201).json({
      id: (auth._id as object).toString(),
      onboardingKey: auth.onboardingKey,
      userId: (user._id as object).toString(),
      ttl: auth.ttl,
      location: auth.location,
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
  sameSite: 'strict' as const,
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
