import { BaseEmail, BaseEmailInit, EmailAddress } from '../base.email';
import { ctaButton, emailLayout } from '../layout';

export interface WelcomeEmailData {
  firstName: string;
  loginUrl: string;
}

export class WelcomeEmail extends BaseEmail {
  readonly type = 'welcome' as const;

  private readonly data: WelcomeEmailData;

  constructor(to: EmailAddress, data: WelcomeEmailData, overrides?: Partial<BaseEmailInit>) {
    super({
      to,
      subject: `Welcome to NK Securities, ${data.firstName}`,
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(): string {
    const content = `
      <h2 style="margin:0 0 8px;font-size:24px;color:#0a0a0a;">Welcome aboard, ${this.data.firstName}.</h2>
      <p style="margin:0 0 16px;color:#555;">
        Your NK Securities account is ready. We're glad to have you.
      </p>
      <p style="margin:0 0 24px;color:#555;">
        You can log in at any time to access your account, track your portfolio,
        and explore everything we offer.
      </p>
      ${ctaButton('Access Your Account', this.data.loginUrl)}
      <p style="margin:32px 0 0;font-size:13px;color:#888;">
        If you didn't create this account, please ignore this email or
        <a href="mailto:support@nksecurities.com">contact support</a>.
      </p>
    `;
    return emailLayout(content, { preheader: `Welcome, ${this.data.firstName}! Your account is ready.` });
  }
}
