import { BaseEmail, BaseEmailInit, EmailAddress, getSupportEmail } from '../base.email';
import { ctaButton, divider, emailLayout } from '../layout';

export interface OnboardingInviteEmailData {
  firstName: string;
  onboardingUrl: string;
  extraContent?: string;
}

export class OnboardingInviteEmail extends BaseEmail {
  readonly type = 'onboarding-invite' as const;

  private readonly data: OnboardingInviteEmailData;

  constructor(to: EmailAddress, data: OnboardingInviteEmailData, overrides?: Partial<BaseEmailInit>) {
    super({
      to,
      subject: `Complete your onboarding — NK Securities`,
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(region?:string): string {
    const supportEmail = getSupportEmail(region)
    const content = `
      <h2 style="margin:0 0 8px;font-size:24px;color:#0a0a0a;">Hi ${this.data.firstName}, you're almost in.</h2>
      <p style="margin:0 0 16px;color:#555;">
        We've set up your onboarding portal. Complete the short journey below — it takes about 10 minutes.
      </p>
      <p style="margin:0 0 24px;color:#555;">
        You'll be asked to verify your identity, upload a few documents,
        and share your payroll details so we can get everything ready for day one.
      </p>
      ${ctaButton('Begin Onboarding', this.data.onboardingUrl)}
      ${this.data.extraContent ? `${divider()}<div style="color:#555;">${this.data.extraContent}</div>` : ''}
      ${divider()}
      <p style="margin:0;font-size:13px;color:#888;">
        This link is personal — please don't share it. If you weren't expecting
        this email, you can safely ignore it or
        <a href="mailto:${supportEmail}" style="color:#888;">contact us</a>.
      </p>
    `;
    return emailLayout(content, {
      preheader: `Hi ${this.data.firstName}, your onboarding is ready to complete.`,
      region:region
    });
  }
}
