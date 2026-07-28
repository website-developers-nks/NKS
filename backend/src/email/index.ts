export { BaseEmail, getSenderByCompany } from './base.email';
export type { EmailAddress, BaseEmailInit } from './base.email';

export { emailEngine, emailEngineNKSR,emailEngineNKSRT, getEmailEngineByCompany, EmailEngine } from './email.engine';
export type { SendResult, EmailPreview } from './email.engine';

export { WelcomeEmail } from './emails/welcome.email';
export type { WelcomeEmailData } from './emails/welcome.email';

export { ContactEmail } from './emails/contact.email';
export type { ContactEmailData } from './emails/contact.email';

export { OtpEmail } from './emails/otp.email';
export type { OtpEmailData, OtpPurpose } from './emails/otp.email';

export { AdminCredentialsEmail } from './emails/admin-credentials.email';
export type { AdminCredentialsEmailData } from './emails/admin-credentials.email';
