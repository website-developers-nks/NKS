export interface EmailAddress {
  name?: string;
  address: string;
}

export interface BaseEmailInit {
  to: EmailAddress | EmailAddress[];
  subject: string;
  from?: EmailAddress;
  replyTo?: EmailAddress;
  cc?: EmailAddress | EmailAddress[];
  bcc?: EmailAddress | EmailAddress[];
}


export function getCompanyName(region?:string):string{
  if(region && region=='dubai'){
    return "NKS Research & Technology"
  }
  return "NK Securities"
}


export function getSupportEmail(location?:string):string{
  if(location && location==='dubain'){
    return process.env.SUPPORT_EMAIL_DUBAI ?? "-"
  }
  return process.env.SUPPORT_EMAIL_INDIA ?? "-"
}


/**
 * Get sender address based on region/location.
 * @param location - Office location (gurugram, gift_city, dubai) or region (india, dubai)
 */
export function getSenderByLocation(location?: string): EmailAddress {
  if (location === 'dubai') {
    return {
      name: process.env.SMTP_DUBAI_FROM_NAME ?? 'NKS Research & Technology',
      address: process.env.SMTP_DUBAI_FROM_ADDRESS ?? 'no-reply@nksecurities.ae',
    };
  }
  // Default to India (gurugram, gift_city, or any other)
  return {
    name: process.env.SMTP_INDIA_FROM_NAME ?? 'NK Securities Research',
    address: process.env.SMTP_INDIA_FROM_ADDRESS ?? 'no-reply@nksecurities.com',
  };
}

function defaultSender(): EmailAddress {
  // Default to India sender for backward compatibility
  return getSenderByLocation('india');
}

export abstract class BaseEmail {
  abstract readonly type: string;

  readonly to: EmailAddress | EmailAddress[];
  readonly from: EmailAddress;
  readonly subject: string;
  readonly replyTo?: EmailAddress;
  readonly cc?: EmailAddress | EmailAddress[];
  readonly bcc?: EmailAddress | EmailAddress[];

  constructor({ to, subject, from, replyTo, cc, bcc }: BaseEmailInit) {
    this.to = to;
    this.from = from ?? defaultSender();
    this.subject = subject;
    this.replyTo = replyTo;
    this.cc = cc;
    this.bcc = bcc;
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
