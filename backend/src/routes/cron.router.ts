import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { sendOnboardingReminders } from '../services/onboarding-reminder.service';
import { sendDueScheduledEmails } from '../services/scheduled-email.service';

const router = Router();

function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error('[cron] CRON_SECRET is not configured - refusing to run.');
    res.status(503).json({ error: 'Cron is not configured.' });
    return;
  }

  const provided = req.headers.authorization ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  next();
}

router.get('/onboarding-reminders', requireCronSecret, async (_req: Request, res: Response) => {
  const startedAt = Date.now();

  try {
    const result = await sendOnboardingReminders();
    console.log('[cron/onboarding-reminders]', { ...result, ms: Date.now() - startedAt });
    res.json({ ok: true, ...result, ms: Date.now() - startedAt });
  } catch (err) {
    console.error('[cron/onboarding-reminders]', err);
    res.status(500).json({ ok: false, error: 'Reminder run failed.' });
  }
});

router.get('/scheduled-emails', requireCronSecret, async (_req: Request, res: Response) => {
  const startedAt = Date.now();

  try {
    const result = await sendDueScheduledEmails();
    console.log('[cron/scheduled-emails]', { ...result, ms: Date.now() - startedAt });
    res.json({ ok: true, ...result, ms: Date.now() - startedAt });
  } catch (err) {
    console.error('[cron/scheduled-emails]', err);
    res.status(500).json({ ok: false, error: 'Scheduled email run failed.' });
  }
});

export default router;
