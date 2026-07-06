import { Company } from '../../db/models/onboarding-auth.model';
import { BaseEmail, BaseEmailInit, EmailAddress, getSupportEmail } from '../base.email';
import { divider, emailLayout } from '../layout';

export type OtpPurpose = 'login' | 'password-reset' | 'email-verification' | (string & {});

export interface OtpEmailData {
  otp: string;
  expiresInMinutes: number;
  purpose: OtpPurpose;
}

const PURPOSE_LABEL: Record<string, string> = {
  login: 'sign in to your account',
  'password-reset': 'reset your password',
  'email-verification': 'verify your email address',
};

export class OtpEmail extends BaseEmail {
  readonly type = 'otp' as const;

  private readonly data: OtpEmailData;

  constructor(to: EmailAddress, data: OtpEmailData, overrides?: Partial<BaseEmailInit>) {
    const label = PURPOSE_LABEL[data.purpose] ?? data.purpose;
    super({
      to,
      subject: `Your verification code`,
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(company:Company): string {
    const label = PURPOSE_LABEL[this.data.purpose] ?? this.data.purpose;
    const supportEmail = getSupportEmail(company)
    const content = `
      <h2 style="margin:0 0 8px;font-size:22px;color:#0a0a0a;">Verification Code</h2>
      <p style="margin:0 0 32px;color:#555;">
        Use the code below to ${label}. It expires in
        <strong>${this.data.expiresInMinutes} minute${this.data.expiresInMinutes !== 1 ? 's' : ''}</strong>.
      </p>

      <!-- OTP code card -->
      <table role="presentation" cellpadding="0" cellspacing="0"
             style="width:100%;border-collapse:collapse;">
        <tr>
          <td align="center">
            <div style="display:inline-block;background:#0a0a0a;border-radius:8px;
                        padding:20px 48px;margin:0 auto;">
              <span style="font-family:'Courier New',Courier,monospace;font-size:36px;
                           font-weight:700;letter-spacing:12px;color:#e2b94b;">
                ${this.data.otp}
              </span>
            </div>
          </td>
        </tr>
      </table>

      ${divider()}

      <p style="margin:0;font-size:13px;color:#888;line-height:1.7;">
        <strong>Did not request this?</strong><br />
        Ignore this email — your account remains secure. No code has been applied.
        If you're concerned, <a href="mailto:${supportEmail}">contact support</a>.
      </p>
    `;

    return emailLayout(content, {
      preheader: `Your one-time verification code: ${this.data.otp}`,
      company
    });
  }
}
