import { Company } from "../db/models/onboarding-auth.model";

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface BaseEmailInit {
  to: EmailAddress | EmailAddress[];
  subject: string;
  from?: EmailAddress;
  replyTo?: EmailAddress;
  cc?: EmailAddress | EmailAddress[];
  bcc?: EmailAddress | EmailAddress[];
  attachments?: EmailAttachment[];
}


export function getCompanyName(company?:Company):string{
  if(company && company===Company.NKSRT){
    return "NKS Research & Technology"
  }
  return "NK Securities Research"
}


export function getSupportEmail(company?:Company):string{
  if(company && company===Company.NKSRT){
    return process.env.SUPPORT_EMAIL_DUBAI ?? "-"
  }
  return process.env.SUPPORT_EMAIL_INDIA ?? "-"
}



export function getSenderByCompany(company?:Company): EmailAddress {
  if (company === Company.NKSRT) {
    return {
      name: process.env.SMTP_DUBAI_FROM_NAME ?? 'NKS Research & Technology',
      address: process.env.SMTP_DUBAI_FROM_ADDRESS ?? 'no-reply@nksecurities.ae',
    };
  }
  return {
    name: process.env.SMTP_INDIA_FROM_NAME ?? 'NK Securities Research',
    address: process.env.SMTP_INDIA_FROM_ADDRESS ?? 'no-reply@nksecurities.com',
  };
}

function defaultSender(): EmailAddress {
  return getSenderByCompany(Company.NKSR);
}

export abstract class BaseEmail {
  abstract readonly type: string;

  readonly to: EmailAddress | EmailAddress[];
  readonly from: EmailAddress;
  readonly subject: string;
  readonly replyTo?: EmailAddress;
  readonly cc?: EmailAddress | EmailAddress[];
  readonly bcc?: EmailAddress | EmailAddress[];
  readonly attachments?: EmailAttachment[];

  constructor({ to, subject, from, replyTo, cc, bcc, attachments }: BaseEmailInit) {
    this.to = to;
    this.from = from ?? defaultSender();
    this.subject = subject;
    this.replyTo = replyTo;
    this.cc = cc;
    this.bcc = bcc;
    this.attachments = attachments;
  }

  abstract buildHtml(region?:string): string;

  buildText(region?:string): string {
    return this.buildHtml(region)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}
