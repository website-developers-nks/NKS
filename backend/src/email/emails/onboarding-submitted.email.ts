import { BaseEmail, BaseEmailInit, EmailAddress } from '../base.email';
import { divider, emailLayout } from '../layout';

export interface OnboardingSubmittedEmailData {
  firstName: string;
}

export class OnboardingSubmittedEmail extends BaseEmail {
  readonly type = 'onboarding-submitted' as const;

  private readonly data: OnboardingSubmittedEmailData;

  constructor(to: EmailAddress, data: OnboardingSubmittedEmailData, overrides?: Partial<BaseEmailInit>) {
    super({
      to,
      subject: 'Onboarding complete — we have everything we need',
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(region?:string): string {
    const content = `
      <h2 style="margin:0 0 8px;font-size:24px;color:#0a0a0a;">You're all set, ${this.data.firstName}.</h2>
      <p style="margin:0 0 16px;color:#555;">
        Your onboarding form has been submitted successfully.
        Our team will review everything and reach out if anything is needed.
      </p>
    `;
    return emailLayout(content, {
      preheader: `Your onboarding is complete, ${this.data.firstName}. We have everything we need.`,
      region:region
    });
  }
}
