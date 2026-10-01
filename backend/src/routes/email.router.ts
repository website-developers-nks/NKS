import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import rateLimit, { RateLimitInfo } from 'express-rate-limit';
import { verifyRecaptcha } from '../lib/recaptcha';
import { MongoRateLimitStore } from '../lib/mongo-rate-limit-store';
import {
  emailEngine,
  ContactEmail,
  CvSubmissionEmail,
  OtpEmail,
  WelcomeEmail,
} from '../email';

const router = Router();

router.post('/preview', (req: Request, res: Response) => {
  const { type, data } = req.body as { type: string; data: Record<string, unknown> };
  const to = { address: 'preview@example.com' };

  try {
    let email;

    if (type === 'welcome') {
      email = new WelcomeEmail(to, {
        firstName: (data.firstName as string) ?? 'User',
        loginUrl: (data.loginUrl as string) ?? 'https://nksecurities.com/login',
      });
    } else if (type === 'otp') {
      email = new OtpEmail(to, {
        otp: (data.otp as string) ?? '000000',
        expiresInMinutes: (data.expiresInMinutes as number) ?? 10,
        purpose: (data.purpose as string) ?? 'login',
      });
    } else if (type === 'contact') {
      email = new ContactEmail(
        { name: 'NK Securities', address: 'team@nksecurities.com' },
        {
          senderName: (data.senderName as string) ?? 'John Doe',
          senderEmail: (data.senderEmail as string) ?? 'john@example.com',
          subject: (data.subject as string) ?? 'Hello',
          message: (data.message as string) ?? 'Test message',
          source: (data.source as string) ?? 'contact',
        },
      );
    } else {
      res.status(400).json({ error: `Unknown email type: ${type}` });
      return;
    }

    res.json(emailEngine.preview(email));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_MIN_CGPA = 7.5;
const CV_TYPES: Record<string, { mimeTypes: string[]; signature: number[] }> = {
  pdf: { mimeTypes: ['application/pdf'], signature: [0x25, 0x50, 0x44, 0x46] },
  doc: { mimeTypes: ['application/msword'], signature: [0xd0, 0xcf, 0x11, 0xe0] },
  docx: {
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    signature: [0x50, 0x4b, 0x03, 0x04],
  },
};

function submissionLimiter(name: string, max: number, windowMinutes: number) {
  return rateLimit({
    store: new MongoRateLimitStore(`form:${name}`),
    passOnStoreError: true,
    windowMs: windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      const resetTime = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
      const retryAfterSeconds = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : windowMinutes * 60;
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many submissions from this network. Please try again later.',
        reason: 'rate_limited',
        retryAfterSeconds,
      });
    },
  });
}

const contactLimiter = submissionLimiter('contact', 5, 15);
const cvLimiter = submissionLimiter('cv', 5, 60);

const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CV_MAX_BYTES, files: 1, fields: 10, fieldSize: 10_000 },
});

function parseCv(req: Request, res: Response, next: NextFunction) {
  cvUpload.single('cv')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? 'Your CV must be 5MB or smaller.' : 'The upload could not be read. Please attach a single CV file.',
      });
      return;
    }
    next(err);
  });
}

function text(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function cvExtension(file: Express.Multer.File): string | null {
  const dot = file.originalname.lastIndexOf('.');
  const ext = dot === -1 ? '' : file.originalname.slice(dot + 1).toLowerCase();
  const type = CV_TYPES[ext];
  if (!type) return null;
  if (!type.mimeTypes.includes(file.mimetype) && file.mimetype !== 'application/octet-stream') return null;
  if (!type.signature.every((byte, i) => file.buffer[i] === byte)) return null;
  return ext;
}

function safeFilename(name: string, ext: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return `CV_${base || 'candidate'}.${ext}`;
}

router.post('/contact', contactLimiter, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const senderName = text(body.senderName, 120);
  const senderEmail = text(body.senderEmail, 200);
  const phone = text(body.phone, 40);
  const subject = text(body.subject, 200);
  const message = text(body.message, 5000);

  if (!senderName || !senderEmail || !subject || !message) {
    res.status(400).json({ error: 'Name, email, subject and message are required.' });
    return;
  }
  if (!EMAIL_PATTERN.test(senderEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (!(await verifyRecaptcha(text(body.recaptchaToken, 4000), req.ip))) {
    res.status(400).json({ error: 'The CAPTCHA check failed. Please try again.', reason: 'captcha_failed' });
    return;
  }

  const email = new ContactEmail(
    { name: 'NK Securities', address: process.env.CONTACT_INBOX ?? 'team@nksecurities.com' },
    { senderName, senderEmail, phone: phone || undefined, subject, message, source: text(body.source, 40) || 'contact' },
  );

  try {
    const result = await emailEngine.send(email);
    res.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error('[email/contact]', err);
    res.status(502).json({ error: 'Failed to send email.' });
  }
});

router.post('/cv', cvLimiter, parseCv, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const candidateName = text(body.name, 120);
  const candidateEmail = text(body.email, 200);
  const phone = text(body.phone, 40);
  const role = text(body.role, 120);
  const college = text(body.college, 200);
  const cgpaInput = text(body.cgpa, 10);
  const cgpa = Number(cgpaInput);
  const linkedin = text(body.linkedin, 300);
  const message = text(body.message, 3000);
  const file = req.file;

  if (!candidateName || !candidateEmail) {
    res.status(400).json({ error: 'Name and email are required.' });
    return;
  }
  if (!EMAIL_PATTERN.test(candidateEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (!college) {
    res.status(400).json({ error: 'Please enter your college.' });
    return;
  }
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(cgpaInput) || cgpa < 0 || cgpa > 10) {
    res.status(400).json({ error: 'Please enter your CGPA on a 10-point scale, e.g. 8.25.' });
    return;
  }
  if (linkedin && !/^https?:\/\/\S+$/i.test(linkedin)) {
    res.status(400).json({ error: 'Please enter a full LinkedIn URL starting with https://.' });
    return;
  }
  if (!file) {
    res.status(400).json({ error: 'Please attach your CV.' });
    return;
  }

  const ext = cvExtension(file);
  if (!ext) {
    res.status(415).json({ error: 'Your CV must be a PDF, DOC or DOCX file.' });
    return;
  }

  if (!(await verifyRecaptcha(text(body.recaptchaToken, 4000), req.ip))) {
    res.status(400).json({ error: 'The CAPTCHA check failed. Please try again.', reason: 'captcha_failed' });
    return;
  }

  if (cgpa < CV_MIN_CGPA) {
    res.json({ ok: true });
    return;
  }

  const inbox = process.env.RECRUITMENT_INBOX;
  if (!inbox) {
    console.error('[email/cv] RECRUITMENT_INBOX is not set');
    res.status(503).json({ error: 'CV submissions are temporarily unavailable. Please try again later.' });
    return;
  }

  const email = new CvSubmissionEmail(
    { name: 'NK Securities Recruitment', address: inbox },
    {
      candidateName,
      candidateEmail,
      phone: phone || undefined,
      role: role || undefined,
      college,
      cgpa: cgpaInput,
      linkedin: linkedin || undefined,
      message: message || undefined,
    },
    { filename: safeFilename(candidateName, ext), content: file.buffer, contentType: CV_TYPES[ext].mimeTypes[0] },
  );

  try {
    await emailEngine.send(email);
    res.json({ ok: true });
  } catch (err) {
    console.error('[email/cv]', err);
    res.status(502).json({ error: 'Failed to send your CV.' });
  }
});

export default router;
