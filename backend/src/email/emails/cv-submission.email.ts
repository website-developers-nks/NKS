import { BaseEmail, BaseEmailInit, EmailAddress, EmailAttachment } from '../base.email';
import { divider, emailLayout, escapeHtml } from '../layout';

export interface CvSubmissionEmailData {
  candidateName: string;
  candidateEmail: string;
  phone?: string;
  role?: string;
  college: string;
  cgpa: string;
  linkedin?: string;
  message?: string;
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

export class CvSubmissionEmail extends BaseEmail {
  readonly type = 'cv-submission' as const;

  private readonly data: CvSubmissionEmailData;

  constructor(
    recruitmentInbox: EmailAddress,
    data: CvSubmissionEmailData,
    cv: EmailAttachment,
    overrides?: Partial<BaseEmailInit>,
  ) {
    super({
      to: recruitmentInbox,
      subject: `[Careers] CV from ${data.candidateName}${data.role ? ` - ${data.role}` : ''}`,
      replyTo: { name: data.candidateName, address: data.candidateEmail },
      attachments: [cv],
      ...overrides,
    });
    this.data = data;
  }

  buildHtml(): string {
    const name = escapeHtml(this.data.candidateName);
    const email = escapeHtml(this.data.candidateEmail);
    const linkedin = this.data.linkedin ? escapeHtml(this.data.linkedin) : '';
    const content = `
      <h2 style="margin:0 0 4px;font-size:20px;color:#0a0a0a;">New CV Submission</h2>
      <p style="margin:0 0 24px;font-size:13px;color:#888;">
        Submitted via <strong>Don't see your role?</strong> on the Open Positions page. The CV is attached.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0"
             style="width:100%;border-collapse:collapse;border:1px solid #ebebeb;border-radius:6px;overflow:hidden;">
        ${row('Name', name)}
        ${row('Email', `<a href="mailto:${email}">${email}</a>`)}
        ${this.data.phone ? row('Phone', escapeHtml(this.data.phone)) : ''}
        ${this.data.role ? row('Interested in', escapeHtml(this.data.role)) : ''}
        ${row('College', escapeHtml(this.data.college))}
        ${row('CGPA', `${escapeHtml(this.data.cgpa)} / 10`)}
        ${linkedin ? row('LinkedIn', `<a href="${linkedin}">${linkedin}</a>`) : ''}
      </table>

      ${this.data.message ? `
        ${divider()}
        <p style="margin:0 0 8px;font-weight:700;color:#444;font-size:13px;text-transform:uppercase;letter-spacing:1px;">
          Message
        </p>
        <div style="background:#f9f9f9;border:1px solid #ebebeb;border-radius:6px;padding:20px;
                    white-space:pre-wrap;font-size:14px;color:#333;line-height:1.7;">
          ${escapeHtml(this.data.message)}
        </div>
      ` : ''}

      <p style="margin:24px 0 0;font-size:13px;color:#888;">
        Hit <strong>Reply</strong> to respond directly to ${name}.
      </p>
    `;
    return emailLayout(content, {
      preheader: `${name} submitted a CV${this.data.role ? ` for ${escapeHtml(this.data.role)}` : ''}.`,
    });
  }
}
