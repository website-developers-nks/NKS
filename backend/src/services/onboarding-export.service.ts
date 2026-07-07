import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { r2, R2_BUCKET } from '../lib/r2';
import { OnboardingAuth } from '../db/models/onboarding-auth.model';
import { OnboardingData } from '../db/models/onboarding-data.model';
import { IDoc } from '../db/models/doc.model';
import { IUser } from '../db/models/user.model';

const DOC_FIELDS = [
  'panDoc', 'idDoc', 'addressDoc', 'photoDoc',
  'higherSecondaryDoc', 'highestDegreeDoc',
  'resumeDoc', 'offerLetterDoc', 'lastIncrementDoc',
  'salarySlipDoc', 'bonusLetterDoc', 'experienceLetterDoc', 'relievingLetterDoc',
  'bankDoc',
];

const DOC_LABELS: Record<string, string> = {
  panDoc: 'PAN Card',
  idDoc: 'ID Proof',
  addressDoc: 'Address Proof',
  photoDoc: 'Personal Photo',
  higherSecondaryDoc: 'Higher Secondary Marksheet',
  highestDegreeDoc: 'Highest Degree Certificate',
  resumeDoc: 'Resume',
  offerLetterDoc: 'Offer Letter',
  lastIncrementDoc: 'Last Increment Letter',
  salarySlipDoc: 'Salary Slip',
  bonusLetterDoc: 'Bonus Letter',
  experienceLetterDoc: 'Experience Letter',
  relievingLetterDoc: 'Relieving Letter',
  bankDoc: 'Bank Document',
};

const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full Name',
  preferredName: 'Preferred Name',
  personalEmail: 'Personal Email',
  mobile: 'Mobile',
  dob: 'Date of Birth',
  nationality: 'Nationality',
  maritalStatus: 'Marital Status',
  bloodGroup: 'Blood Group',
  emergencyContactName: 'Emergency Contact Name',
  emergencyContactNumber: 'Emergency Contact Number',
  passportNumber: 'Passport / Aadhar Number',
  ssn: 'SSN',
  fathersName: "Father's Name",
  fathersDob: "Father's DOB",
  mothersName: "Mother's Name",
  mothersDob: "Mother's DOB",
  spouseName: 'Spouse Name',
  spouseDob: 'Spouse DOB',
  insuranceCoverage: 'Insurance Coverage',
  campusName: 'Campus Name',
  bankName: 'Bank Name',
  accountHolder: 'Account Holder',
  accountNumber: 'Account Number',
  ifsc: 'IFSC',
  introLine: 'Intro Line',
  birthdayPref: 'Birthday Preference',
  mealPreference: 'Meal Preference',
  hobbies: 'Hobbies',
  funFact: 'Fun Fact',
  experienceRating: 'Experience Rating (out of 5)',
  experienceFeedback: 'Feedback',
};

const BOOLEAN_LABELS: Record<string, string> = {
  welcomeAck: 'Welcome Acknowledged',
  declaration: 'Declaration',
  consent: 'Consent',
};

const DATE_FIELDS = new Set(['dob', 'fathersDob', 'mothersDob', 'spouseDob']);

export interface OnboardingExportResult {
  filename: string;
  html: string;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchDocAsDataUri(doc: IDoc): Promise<string | null> {
  try {
    const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.path }));
    if (!object.Body) return null;
    const buffer = await streamToBuffer(object.Body as Readable);
    return `data:${doc.mimeType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('[onboarding-export] failed to fetch doc', (doc._id as object).toString(), err);
    return null;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value: unknown): string {
  if (!value) return '';
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function formatAddress(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const addr = value as Record<string, string>;
  return [addr.address, addr.city, addr.country, addr.pincode].filter(Boolean).join(', ');
}

function fieldRow(label: string, value: unknown): string {
  const display = value === null || value === undefined || value === '' ? '—' : escapeHtml(value);
  return `<div class="field"><label>${escapeHtml(label)}</label><span>${display}</span></div>`;
}

function docCard(label: string, doc: IDoc, dataUri: string | null): string {
  const isImage = /^image\//.test(doc.mimeType || '');
  const preview = isImage && dataUri ? `<img src="${dataUri}" alt="${escapeHtml(doc.originalName)}">` : '';
  const link = dataUri
    ? `<a href="${dataUri}" download="${escapeHtml(doc.originalName)}">Download ${escapeHtml(doc.originalName)}</a>`
    : `<span class="doc-missing">${escapeHtml(doc.originalName)} (unavailable)</span>`;
  return `<div class="doc"><label>${escapeHtml(label)}</label>${preview}${link}</div>`;
}

function renderHtml(opts: {
  fullName: string;
  email: string;
  location: string;
  company: string;
  submittedAt: string;
  fieldRows: string[];
  docCards: string[];
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Onboarding Response — ${escapeHtml(opts.fullName)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f7f4; color: #0a0a0a; margin: 0; padding: 40px; }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .subtitle { color: #666; margin-bottom: 32px; }
  h2 { font-size: 18px; margin: 32px 0 16px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px 24px; }
  .field label, .doc label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 4px; }
  .field span { font-size: 14px; word-break: break-word; }
  .doc { border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
  .doc img { max-width: 100%; max-height: 160px; display: block; margin-bottom: 8px; border-radius: 4px; object-fit: contain; }
  .doc a { display: inline-block; font-size: 13px; color: #2952e3; text-decoration: none; }
  .doc a:hover { text-decoration: underline; }
  .doc-missing { font-size: 13px; color: #c62828; }
  p.empty { color: #888; font-size: 14px; }
</style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(opts.fullName)}</h1>
    <p class="subtitle">${escapeHtml(opts.email)} · ${escapeHtml(opts.location)} · ${escapeHtml(opts.company)} · Submitted ${escapeHtml(opts.submittedAt)}</p>

    <h2>Details</h2>
    <div class="grid">${opts.fieldRows.join('')}</div>

    <h2>Documents</h2>
    <div class="grid">${opts.docCards.length ? opts.docCards.join('') : '<p class="empty">No documents uploaded.</p>'}</div>
  </div>
</body>
</html>`;
}

export async function buildOnboardingExportHtml(authId: string): Promise<OnboardingExportResult | null> {
  const auth = await OnboardingAuth.findById(authId).populate<{ user: IUser }>('user', 'firstName lastName email');
  if (!auth) return null;

  const data = await OnboardingData.findOne({ onboardingAuthId: auth._id })
    .populate(DOC_FIELDS)
    .lean();

  const record = (data ?? {}) as Record<string, unknown>;
  const user = auth.user as IUser | undefined;
  const fullName = user ? `${user.firstName} ${user.lastName}` : 'Unknown';

  const fieldRows: string[] = [];
  Object.keys(FIELD_LABELS).forEach((key) => {
    const raw = record[key];
    const value = DATE_FIELDS.has(key) ? formatDate(raw) : raw;
    fieldRows.push(fieldRow(FIELD_LABELS[key], value));
  });
  Object.keys(BOOLEAN_LABELS).forEach((key) => {
    const value = record[key];
    fieldRows.push(fieldRow(BOOLEAN_LABELS[key], value === true ? 'Yes' : value === false ? 'No' : ''));
  });
  fieldRows.push(fieldRow('Permanent Address', formatAddress(record.address)));
  fieldRows.push(fieldRow('Present Address', formatAddress(record.presentAddress)));

  if (Array.isArray(record.childsInfo) && record.childsInfo.length) {
    const children = record.childsInfo as { name: string; dob?: string }[];
    fieldRows.push(fieldRow('Children', children.map((c) => `${c.name}${c.dob ? ' (' + formatDate(c.dob) + ')' : ''}`).join(', ')));
  }
  if (Array.isArray(record.orgs) && record.orgs.length) {
    const orgs = record.orgs as { name: string; duration: string; role?: string; info?: string }[];
    fieldRows.push(fieldRow('Employment History', orgs.map((o) => [`${o.name} (${o.duration})`, o.role, o.info].filter(Boolean).join(' — ')).join('; ')));
  }

  const docCards: string[] = [];
  for (const field of DOC_FIELDS) {
    const doc = record[field] as IDoc | undefined;
    if (!doc || !doc.path) continue;
    const dataUri = await fetchDocAsDataUri(doc);
    docCards.push(docCard(DOC_LABELS[field], doc, dataUri));
  }

  const html = renderHtml({
    fullName,
    email: user?.email ?? '',
    location: auth.location,
    company: auth.company,
    submittedAt: record.submittedAt ? new Date(record.submittedAt as string).toLocaleString() : 'Not submitted',
    fieldRows,
    docCards,
  });

  const safeName = fullName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'onboarding';
  const filename = `onboarding-${safeName}-${authId}.html`;

  return { filename, html };
}
