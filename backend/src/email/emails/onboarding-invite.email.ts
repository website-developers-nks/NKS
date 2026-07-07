import { Company } from '../../db/models/onboarding-auth.model';
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
      subject: `${to.name} | Complete your onboarding — NK Securities`,
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(company?:Company): string {
    const supportEmail = getSupportEmail(company)
    const content = `
      <h2 style="margin:0 0 8px;font-size:24px;color:#0a0a0a;">Hi ${this.data.firstName}, you're almost in.</h2>
      <p style="margin:0 0 16px;color:#555;">
        We're excited to have you join us and look forward to welcoming you to the team.
        This onboarding journey has been designed to help you complete the official
        documentation required before your joining date. The information you provide
        will be used for your employment records, payroll processing, statutory
        compliance, and integration with our internal systems. Please ensure that all
        information submitted is accurate, complete, and matches your supporting
        documents. Providing the correct details will help us process your onboarding
        smoothly and ensure everything is ready for your first day.
      </p>
      <p style="margin:0 0 24px;color:#555;">
        In addition, we've included key details about your first day and other joining
        instructions in the email accompanying this link. We recommend referring to
        both the email and this portal as you complete your onboarding.
      </p>
      <p style="margin:0 0 24px;color:#555;">
        Thank you, and we look forward to welcoming you soon!
      </p>
      ${this.data.extraContent ? `${divider()}<div style="color:#555;">${this.data.extraContent}</div>` : ''}
      ${ctaButton('Begin Onboarding', this.data.onboardingUrl)}
      ${divider()}
      <p style="margin:0;font-size:13px;color:#888;">
        This link is personal - please don't share it. If you weren't expecting this email,
        please <a href="mailto:${supportEmail}" style="color:#888;">contact us</a>.
      </p>
    `;
    return emailLayout(content, {
      preheader: `Hi ${this.data.firstName}, your onboarding is ready to complete.`,
      company
    });
  }
}
