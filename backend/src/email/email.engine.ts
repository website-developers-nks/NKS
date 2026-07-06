import nodemailer, { Transporter, SentMessageInfo } from 'nodemailer';
import { BaseEmail } from './base.email';
import { OfficeLocation } from '../db/models/onboarding-auth.model';

export type EmailRegion = 'india' | 'dubai';

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export interface EmailPreview {
  type: string;
  from: unknown;
  to: unknown;
  subject: string;
  html: string;
  text: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromAddress: string;
}

function getSmtpConfig(region: EmailRegion): SmtpConfig {
  if (region === 'dubai') {
    return {
      host: process.env.SMTP_DUBAI_HOST ?? '',
      port: Number(process.env.SMTP_DUBAI_PORT ?? 587),
      secure: process.env.SMTP_DUBAI_SECURE === 'true',
      user: process.env.SMTP_DUBAI_USER ?? '',
      pass: process.env.SMTP_DUBAI_PASS ?? '',
      fromName: process.env.SMTP_DUBAI_FROM_NAME ?? 'NKS Research & Technology',
      fromAddress: process.env.SMTP_DUBAI_FROM_ADDRESS ?? 'no-reply@nksecurities.ae',
    };
  }
  return {
    host: process.env.SMTP_INDIA_HOST ?? '',
    port: Number(process.env.SMTP_INDIA_PORT ?? 587),
    secure: process.env.SMTP_INDIA_SECURE === 'true',
    user: process.env.SMTP_INDIA_USER ?? '',
    pass: process.env.SMTP_INDIA_PASS ?? '',
    fromName: process.env.SMTP_INDIA_FROM_NAME ?? 'NK Securities Research',
    fromAddress: process.env.SMTP_INDIA_FROM_ADDRESS ?? 'no-reply@nksecurities.com',
  };
}

function buildTransport(region: EmailRegion): Transporter {
  const isDev = process.env.NODE_ENV !== 'production';
  const config = getSmtpConfig(region);

  if (isDev && !config.host) {
    // Ethereal test account — logs preview URL to console in development
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: process.env.ETHEREAL_USER ?? '',
        pass: process.env.ETHEREAL_PASS ?? '',
      },
    });
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

export class EmailEngine {
  private readonly transporter: Transporter;
  public readonly region: EmailRegion;

  constructor(region: EmailRegion = 'india') {
    this.region = region;
    this.transporter = buildTransport(region);
    const config = getSmtpConfig(region);
  }

  /**
   * Send an email. Resolves with delivery info; throws on failure.
   */
  async send(email: BaseEmail): Promise<SendResult> {
    const info: SentMessageInfo = await this.transporter.sendMail({
      from: email.from,
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      replyTo: email.replyTo,
      subject: email.subject,
      html: email.buildHtml(this.region),
      text: email.buildText(this.region),
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[EmailEngine:${this.region}] Preview: ${previewUrl}`);
    }

    return {
      messageId: info.messageId as string,
      accepted: info.accepted as string[],
      rejected: info.rejected as string[],
    };
  }

  /**
   * Build and return the email without sending — useful for dev/testing.
   */
  preview(email: BaseEmail): EmailPreview {
    return {
      type: email.type,
      from: email.from,
      to: email.to,
      subject: email.subject,
      html: email.buildHtml(),
      text: email.buildText(),
    };
  }

  /** Verify SMTP connectivity. */
  async verify(): Promise<void> {
    await this.transporter.verify();
  }
}

// Singleton instances for each region
export const emailEngineIndia = new EmailEngine('india');
export const emailEngineDubai = new EmailEngine('dubai');

// Default export (India) for backward compatibility
export const emailEngine = emailEngineIndia;

/**
 * Get the appropriate email engine based on location.
 * @param location - Office location string (gurugram, gift_city, dubai)
 * @returns The email engine for the corresponding region
 */
export function getEmailEngineByLocation(location: OfficeLocation): EmailEngine {
  if (location === OfficeLocation.Dubai) {
    return emailEngineDubai;
  }
  // Gurugram, Gift City, or any other location defaults to India
  return emailEngineIndia;
}
