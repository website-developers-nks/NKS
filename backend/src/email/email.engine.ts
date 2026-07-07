import nodemailer, { Transporter, SentMessageInfo } from 'nodemailer';
import { BaseEmail } from './base.email';
import { Company, OfficeLocation } from '../db/models/onboarding-auth.model';

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

function getSmtpConfig(company: Company): SmtpConfig {
  if (company === Company.NKSRT) {
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

function buildTransport(company: Company): Transporter {
  const isDev = process.env.NODE_ENV !== 'production';
  const config = getSmtpConfig(company);

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
  public readonly company: Company;

  constructor(company: Company = Company.NKSR) {
    this.company = company;
    this.transporter = buildTransport(company);
    const config = getSmtpConfig(company);
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
      html: email.buildHtml(this.company),
      text: email.buildText(this.company),
      attachments: email.attachments,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[EmailEngine:${this.company}] Preview: ${previewUrl}`);
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
export const emailEngineNKSR = new EmailEngine(Company.NKSR);
export const emailEngineNKSRT = new EmailEngine(Company.NKSRT);

// Default export (India) for backward compatibility
export const emailEngine = emailEngineNKSR;

/**
 * Get the appropriate email engine based on location.
 * @param location - Office location string (gurugram, gift_city, dubai)
 * @returns The email engine for the corresponding region
 */
export function getEmailEngineByCompany(company:Company): EmailEngine {
  if (company === Company.NKSRT) {
    return emailEngineNKSRT;
  }
  // Gurugram, Gift City, or any other location defaults to India
  return emailEngineNKSR;
}
