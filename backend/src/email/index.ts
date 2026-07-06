export { BaseEmail, getSenderByLocation } from './base.email';
export type { EmailAddress, BaseEmailInit } from './base.email';

export { emailEngine, emailEngineIndia, emailEngineDubai, getEmailEngineByLocation, EmailEngine } from './email.engine';
export type { SendResult, EmailPreview, EmailRegion } from './email.engine';

export { WelcomeEmail } from './emails/welcome.email';
export type { WelcomeEmailData } from './emails/welcome.email';

export { ContactEmail } from './emails/contact.email';
export type { ContactEmailData } from './emails/contact.email';

export { OtpEmail } from './emails/otp.email';
export type { OtpEmailData, OtpPurpose } from './emails/otp.email';
