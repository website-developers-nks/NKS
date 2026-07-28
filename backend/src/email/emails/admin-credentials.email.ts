import { Company } from '../../db/models/onboarding-auth.model';
import { BaseEmail, BaseEmailInit, EmailAddress, getCompanyName, getSupportEmail } from '../base.email';
import { divider, emailLayout } from '../layout';

export interface AdminCredentialsEmailData {
  firstName: string;
  email: string;
  password: string;
  adminUrl?: string;
}

export class AdminCredentialsEmail extends BaseEmail {
  readonly type = 'admin-credentials' as const;

  private readonly data: AdminCredentialsEmailData;

  constructor(to: EmailAddress, data: AdminCredentialsEmailData, overrides?: Partial<BaseEmailInit>) {
    super({
      to,
      subject: 'Your admin account details',
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(company: Company): string {
    const supportEmail = getSupportEmail(company);
    const signInLine = this.data.adminUrl
      ? `<p style="margin:0 0 32px;color:#555;">Sign in at <a href="${this.data.adminUrl}">${this.data.adminUrl}</a>.</p>`
      : '';

    const content = `
      <h2 style="margin:0 0 8px;font-size:22px;color:#0a0a0a;">Admin Access</h2>
      <p style="margin:0 0 24px;color:#555;">
        Hi ${this.data.firstName}, an admin account has been created for you on the
        ${getCompanyName(company)} portal. Use the password below the first time you sign in.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td align="center">
            <div style="display:inline-block;background:#0a0a0a;border-radius:8px;padding:20px 40px;margin:0 auto;">
              <div style="font-size:12px;letter-spacing:2px;color:#999;margin:0 0 8px;">PASSWORD</div>
              <span style="font-family:'Courier New',Courier,monospace;font-size:26px;
                           font-weight:700;letter-spacing:4px;color:#e2b94b;">
                ${this.data.password}
              </span>
            </div>
          </td>
        </tr>
      </table>

      <p style="margin:24px 0 8px;color:#555;">
        Your username is <strong>${this.data.email}</strong>. Signing in also sends a
        one-time code to this address, so you'll need both.
      </p>
      ${signInLine}

      ${divider()}

      <p style="margin:0;font-size:13px;color:#888;line-height:1.7;">
        <strong>Change this password.</strong><br />
        After signing in, use "Change password" on the dashboard to replace it with one only you know.
        Never share it. If you weren't expecting this email,
        <a href="mailto:${supportEmail}">contact support</a>.
      </p>
    `;

    return emailLayout(content, {
      preheader: 'Your admin account has been created - password inside.',
      company,
    });
  }
}
