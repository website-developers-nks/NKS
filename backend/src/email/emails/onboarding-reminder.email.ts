import { Company } from '../../db/models/onboarding-auth.model';
import { BaseEmail, BaseEmailInit, EmailAddress, getSupportEmail } from '../base.email';
import { ctaButton, divider, emailLayout } from '../layout';

export interface OnboardingReminderEmailData {
  firstName: string;
  onboardingUrl: string;
  expiresOn?: string;
  started: boolean;
}

export class OnboardingReminderEmail extends BaseEmail {
  readonly type = 'onboarding-reminder' as const;

  private readonly data: OnboardingReminderEmailData;

  constructor(to: EmailAddress, data: OnboardingReminderEmailData, overrides?: Partial<BaseEmailInit>) {
    super({
      to,
      subject: 'Reminder: complete your onboarding',
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(company?: Company): string {
    const supportEmail = getSupportEmail(company);

    const opening = this.data.started
      ? `You've made a start on your onboarding, but it isn't finished yet.`
      : `We sent you an onboarding link a little while ago, and it's still waiting for you.`;

    const expiryLine = this.data.expiresOn
      ? `<p style="margin:0 0 24px;color:#555;">
           Please complete it before <strong>${this.data.expiresOn}</strong> - the link expires on that
           date, and after that we'll need to issue you a new one.
         </p>`
      : `<p style="margin:0 0 24px;color:#555;">Please complete it as soon as you can.</p>`;

    const content = `
      <h2 style="margin:0 0 8px;font-size:24px;color:#0a0a0a;">Hi ${this.data.firstName}, a quick reminder.</h2>
      <p style="margin:0 0 16px;color:#555;">
        ${opening} Finishing it lets us get your employment records, payroll and
        systems access ready before your first day.
      </p>
      ${expiryLine}
      ${ctaButton(this.data.started ? 'Continue Onboarding' : 'Begin Onboarding', this.data.onboardingUrl)}
      ${divider()}
      <p style="margin:0;font-size:13px;color:#888;">
        This link is personal - please don't share it. Already finished, or need a hand?
        <a href="mailto:${supportEmail}" style="color:#888;">Contact us</a> and we'll sort it out.
      </p>
    `;

    return emailLayout(content, {
      preheader: this.data.expiresOn
        ? `Your onboarding is still pending - it expires on ${this.data.expiresOn}.`
        : 'Your onboarding is still pending.',
      company,
    });
  }
}
