import { Router, Request, Response } from 'express';
import {
  emailEngine,
  ContactEmail,
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

router.post('/contact', async (req: Request, res: Response) => {
  const { senderName, senderEmail, phone, subject, message, source } = req.body as {
    senderName: string;
    senderEmail: string;
    phone?: string;
    subject: string;
    message: string;
    source?: string;
  };

  if (!senderName || !senderEmail || !subject || !message) {
    res.status(400).json({ error: 'senderName, senderEmail, subject and message are required.' });
    return;
  }

  const email = new ContactEmail(
    { name: 'NK Securities', address: process.env.CONTACT_INBOX ?? 'team@nksecurities.com' },
    { senderName, senderEmail, phone, subject, message, source },
  );

  try {
    const result = await emailEngine.send(email);
    res.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error('[email/contact]', err);
    res.status(502).json({ error: 'Failed to send email.' });
  }
});

export default router;
