import { Company } from '../../db/models/onboarding-auth.model';
import { BaseEmail, BaseEmailInit, EmailAddress, getSupportEmail } from '../base.email';
import { divider, emailLayout, escapeHtml } from '../layout';

export interface AdminMessageEmailData {
  title: string;
  subtitle?: string;
  contentHtml: string;
}

export class AdminMessageEmail extends BaseEmail {
  readonly type = 'admin-message' as const;

  private readonly data: AdminMessageEmailData;

  constructor(to: EmailAddress | EmailAddress[], data: AdminMessageEmailData, overrides?: Partial<BaseEmailInit>) {
    super({
      to,
      subject: data.title,
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(company?: Company): string {
    const supportEmail = getSupportEmail(company);

    const subtitle = this.data.subtitle
      ? `<p style="margin:0 0 24px;color:#555;font-size:16px;">${escapeHtml(this.data.subtitle)}</p>`
      : '';

    const content = `
      <h2 style="margin:0 0 8px;font-size:24px;color:#0a0a0a;">${escapeHtml(this.data.title)}</h2>
      ${subtitle}
      <div style="color:#555;">${this.data.contentHtml}</div>
      ${divider()}
      <p style="margin:0;font-size:13px;color:#888;">
        Questions? Just reply to this email or
        <a href="mailto:${supportEmail}" style="color:#888;">contact us</a>.
      </p>
    `;

    return emailLayout(content, {
      preheader: escapeHtml(this.data.subtitle || this.data.title),
      company,
    });
  }
}
