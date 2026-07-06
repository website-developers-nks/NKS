import { BaseEmail, BaseEmailInit, EmailAddress } from '../base.email';
import { divider, emailLayout } from '../layout';

export interface ContactEmailData {
  senderName: string;
  senderEmail: string;
  phone?: string;
  subject: string;
  message: string;
  /** Page the form was submitted from, e.g. "contact", "campus", "open-positions" */
  source?: string;
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 16px;font-weight:700;color:#444;white-space:nowrap;vertical-align:top;
                 width:120px;font-size:13px;">${label}</td>
      <td style="padding:10px 16px;color:#1a1a1a;font-size:14px;word-break:break-word;">${value}</td>
    </tr>
  `;
}

export class ContactEmail extends BaseEmail {
  readonly type = 'contact' as const;

  private readonly data: ContactEmailData;

  /**
   * @param internalRecipient  - the NK Securities inbox that receives the enquiry
   * @param data               - form submission data
   */
  constructor(
    internalRecipient: EmailAddress,
    data: ContactEmailData,
    overrides?: Partial<BaseEmailInit>,
  ) {
    super({
      to: internalRecipient,
      subject: `[${data.source ?? 'Contact'}] ${data.subject}`,
      replyTo: { name: data.senderName, address: data.senderEmail },
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(): string {
    const content = `
      <h2 style="margin:0 0 4px;font-size:20px;color:#0a0a0a;">New Enquiry</h2>
      <p style="margin:0 0 24px;font-size:13px;color:#888;">
        Submitted via the <strong>${this.data.source ?? 'website'}</strong> contact form.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0"
             style="width:100%;border-collapse:collapse;border:1px solid #ebebeb;border-radius:6px;overflow:hidden;">
        ${row('Name', this.data.senderName)}
        ${row('Email', `<a href="mailto:${this.data.senderEmail}">${this.data.senderEmail}</a>`)}
        ${this.data.phone ? row('Phone', this.data.phone) : ''}
        ${row('Subject', this.data.subject)}
      </table>

      ${divider()}

      <p style="margin:0 0 8px;font-weight:700;color:#444;font-size:13px;text-transform:uppercase;letter-spacing:1px;">
        Message
      </p>
      <div style="background:#f9f9f9;border:1px solid #ebebeb;border-radius:6px;padding:20px;
                  white-space:pre-wrap;font-size:14px;color:#333;line-height:1.7;">
        ${this.data.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
      </div>

      <p style="margin:24px 0 0;font-size:13px;color:#888;">
        Hit <strong>Reply</strong> to respond directly to ${this.data.senderName}.
      </p>
    `;
    return emailLayout(content, {
      preheader: `${this.data.senderName} sent a message via the ${this.data.source ?? 'website'}.`,
    });
  }
}
