import { Types } from 'mongoose';
import { OnboardingAuth, IOnboardingAuth } from '../db/models/onboarding-auth.model';
import { OnboardingData, IOnboardingData } from '../db/models/onboarding-data.model';
import { IUser } from '../db/models/user.model';
import { Doc, IDoc } from '../db/models/doc.model';
import { SheetConfig } from '../db/models/sheet-config.model';
import { appendRecord, isGoogleSheetsConfigured } from '../lib/google-sheets';
import { buildDocLink } from '../lib/doc-links';
import { ExtraFieldType, ExtraFieldDef } from '../lib/extra-fields';

interface Column {
  header: string;
  value: (ctx: { auth: IOnboardingAuth; data: IOnboardingData; user?: IUser }) => string | number | null;
}

const date = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const yesNo = (v?: boolean | null) => (v === true ? 'Yes' : v === false ? 'No' : '');

const address = (a?: { address?: string; city?: string; country?: string; pincode?: string }) =>
  a ? [a.address, a.city, a.country, a.pincode].filter(Boolean).join(', ') : '';

const docName = (ref: unknown): string => {
  if (!ref) return '';

  if (typeof ref === 'object' && 'originalName' in (ref as object)) {
    const doc = ref as IDoc;
    const link = buildDocLink(String(doc._id));
    if (!link) return doc.originalName;

    const label = doc.originalName.replace(/"/g, '""');
    return `=HYPERLINK("${link}","${label}")`;
  }

  const link = buildDocLink(String(ref));
  return link ? `=HYPERLINK("${link}","Open document")` : 'Uploaded';
};

export const SHEET_COLUMNS: Column[] = [
  { header: 'Submitted At', value: ({ data }) => (data.submittedAt ? new Date(data.submittedAt).toISOString() : '') },
  { header: 'Company', value: ({ auth }) => auth.company },
  { header: 'Location', value: ({ auth }) => auth.location },
  { header: 'Account Email', value: ({ user }) => user?.email ?? '' },

  { header: 'Full Name', value: ({ data }) => data.fullName ?? '' },
  { header: 'Preferred Name', value: ({ data }) => data.preferredName ?? '' },
  { header: 'Personal Email', value: ({ data }) => data.personalEmail ?? '' },
  { header: 'Mobile', value: ({ data }) => data.mobile ?? '' },
  { header: 'Date of Birth', value: ({ data }) => date(data.dob) },
  { header: 'Nationality', value: ({ data }) => data.nationality ?? '' },
  { header: 'Marital Status', value: ({ data }) => data.maritalStatus ?? '' },
  { header: 'Blood Group', value: ({ data }) => data.bloodGroup ?? '' },
  { header: 'Emergency Contact Name and Relationship', value: ({ data }) => data.emergencyContactName ?? '' },
  { header: 'Emergency Contact Number', value: ({ data }) => data.emergencyContactNumber ?? '' },
  { header: 'Passport / Aadhar Number', value: ({ data }) => data.passportNumber ?? '' },
  { header: 'PAN Card Number', value: ({ data }) => data.panNumber ?? '' },
  { header: 'Passport Number', value: ({ data }) => data.passportNo ?? '' },
  { header: 'UAN Number', value: ({ data }) => data.uanNumber ?? '' },
  { header: 'SSN', value: ({ data }) => data.ssn ?? '' },
  { header: 'Permanent Address', value: ({ data }) => address(data.address) },
  { header: 'Present Address', value: ({ data }) => address(data.presentAddress) },

  { header: "Father's Name", value: ({ data }) => data.fathersName ?? '' },
  { header: "Father's DOB", value: ({ data }) => date(data.fathersDob) },
  { header: "Mother's Name", value: ({ data }) => data.mothersName ?? '' },
  { header: "Mother's DOB", value: ({ data }) => date(data.mothersDob) },
  { header: 'Spouse Name', value: ({ data }) => data.spouseName ?? '' },
  { header: 'Spouse DOB', value: ({ data }) => date(data.spouseDob) },
  {
    header: 'Children',
    value: ({ data }) => (data.childsInfo ?? []).map((c) => `${c.name} (${date(c.dob)})`).join('; '),
  },
  { header: 'Insurance Coverage', value: ({ data }) => data.insuranceCoverage ?? '' },

  { header: 'Campus Name', value: ({ data }) => data.campusName ?? '' },
  {
    header: 'Employment History',
    value: ({ data }) => (data.orgs ?? [])
      .map((o) => [o.name, o.duration, o.role, o.info].filter(Boolean).join(' - '))
      .join('; '),
  },

  { header: 'Bank Name', value: ({ data }) => data.bankName ?? '' },
  { header: 'Account Holder', value: ({ data }) => data.accountHolder ?? '' },
  { header: 'Account Number', value: ({ data }) => (data.accountNumber ? `'${data.accountNumber}` : '') },
  { header: 'IFSC', value: ({ data }) => data.ifsc ?? '' },

  { header: 'Intro Line', value: ({ data }) => data.introLine ?? '' },
  { header: 'Birthday Preference', value: ({ data }) => data.birthdayPref ?? '' },
  { header: 'Meal Preference', value: ({ data }) => data.mealPreference ?? '' },
  { header: 'Hobbies', value: ({ data }) => data.hobbies ?? '' },
  { header: 'Fun Fact', value: ({ data }) => data.funFact ?? '' },

  { header: 'Welcome Acknowledged', value: ({ data }) => yesNo(data.welcomeAck) },
  { header: 'Declaration', value: ({ data }) => yesNo(data.declaration) },
  { header: 'Consent', value: ({ data }) => yesNo(data.consent) },
  { header: 'Experience Rating', value: ({ data }) => data.experienceRating ?? '' },
  { header: 'Experience Feedback', value: ({ data }) => data.experienceFeedback ?? '' },

  { header: 'PAN Card', value: ({ data }) => docName(data.panDoc) },
  { header: 'Passport', value: ({ data }) => docName(data.passportDoc) },
  { header: 'ID Proof', value: ({ data }) => docName(data.idDoc) },
  { header: 'Address Proof', value: ({ data }) => docName(data.addressDoc) },
  { header: 'Photo', value: ({ data }) => docName(data.photoDoc) },
  { header: 'Higher Secondary', value: ({ data }) => docName(data.higherSecondaryDoc) },
  { header: 'Highest Degree', value: ({ data }) => docName(data.highestDegreeDoc) },
  { header: 'Resume', value: ({ data }) => docName(data.resumeDoc) },
  { header: 'Offer Letter', value: ({ data }) => docName(data.offerLetterDoc) },
  { header: 'Last Increment Letter', value: ({ data }) => docName(data.lastIncrementDoc) },
  { header: 'Salary Slip', value: ({ data }) => docName(data.salarySlipDoc) },
  { header: 'Bonus Letter', value: ({ data }) => docName(data.bonusLetterDoc) },
  { header: 'Experience Letter', value: ({ data }) => docName(data.experienceLetterDoc) },
  { header: 'Relieving Letter', value: ({ data }) => docName(data.relievingLetterDoc) },
  { header: 'Bank Document', value: ({ data }) => docName(data.bankDoc) },

  { header: 'Onboarding Key', value: ({ auth }) => auth.onboardingKey },
];

export const SHEET_HEADERS = SHEET_COLUMNS.map((c) => c.header);

function extraColumns(
  auth: IOnboardingAuth,
  data: IOnboardingData,
): Array<{ header: string; value: string | number | null }> {
  const defs = (auth.extraFields ?? []) as ExtraFieldDef[];
  if (!defs.length) return [];

  const stored = data.extraFields;
  const read = (key: string) =>
    stored instanceof Map ? stored.get(key) : (stored as Record<string, unknown> | undefined)?.[key];

  const fixed = new Set(SHEET_HEADERS);

  return defs.map((def) => {
    const header = fixed.has(def.label) ? `${def.label} (extra)` : def.label;
    const raw = read(def.key);

    if (def.type === ExtraFieldType.Document) return { header, value: docName(raw) };
    if (def.type === ExtraFieldType.Checkbox) return { header, value: yesNo(raw as boolean) };
    if (raw === undefined || raw === null) return { header, value: '' };
    if (typeof raw === 'number') return { header, value: raw };
    return { header, value: String(raw) };
  });
}

// A relieving letter now belongs to an organization rather than to the
// onboarding, so the sheet grows one column per org that has one. Headings are
// appended as they first appear, the same way extra fields are handled.
function orgLetterColumns(
  data: IOnboardingData,
): Array<{ header: string; value: string | number | null }> {
  return (data.orgs ?? [])
    .map((org, index) => ({ org, index }))
    .filter(({ org }) => !!org.relievingLetterDoc)
    .map(({ org, index }) => ({
      header: `Relieving Letter ${index + 1} (${org.name})`,
      value: docName(org.relievingLetterDoc),
    }));
}

export function buildSheetRecord(
  auth: IOnboardingAuth,
  data: IOnboardingData,
  user?: IUser,
): Array<{ header: string; value: string | number | null }> {
  const fixed = SHEET_COLUMNS.map((column) => {
    let value: string | number | null = '';
    try {
      value = column.value({ auth, data, user });
    } catch {
      value = '';
    }
    return { header: column.header, value };
  });

  return fixed.concat(orgLetterColumns(data)).concat(extraColumns(auth, data));
}


const DOC_FIELDS = [
  'orgs.relievingLetterDoc',
  'panDoc', 'passportDoc', 'idDoc', 'addressDoc', 'photoDoc', 'higherSecondaryDoc', 'highestDegreeDoc',
  'resumeDoc', 'offerLetterDoc', 'lastIncrementDoc', 'salarySlipDoc', 'bonusLetterDoc',
  'experienceLetterDoc', 'relievingLetterDoc', 'bankDoc',
];

async function resolveExtraDocNames(auth: IOnboardingAuth, data: IOnboardingData): Promise<void> {
  const defs = (auth.extraFields ?? []) as ExtraFieldDef[];
  const stored = data.extraFields;
  if (!defs.length || !(stored instanceof Map)) return;

  const ids: Types.ObjectId[] = [];
  const keyById = new Map<string, string>();

  for (const def of defs) {
    if (def.type !== ExtraFieldType.Document) continue;
    const raw = stored.get(def.key);
    if (raw && Types.ObjectId.isValid(String(raw))) {
      ids.push(new Types.ObjectId(String(raw)));
      keyById.set(String(raw), def.key);
    }
  }

  if (!ids.length) return;

  const docs = await Doc.find({ _id: { $in: ids } }, { _id: 1, originalName: 1 }).lean();
  for (const doc of docs) {
    const key = keyById.get(String(doc._id));
    if (key) stored.set(key, { _id: doc._id, originalName: doc.originalName });
  }
}

export async function appendOnboardingToSheet(onboardingAuthId: Types.ObjectId | string): Promise<boolean> {
  try {
    const auth = await OnboardingAuth.findById(onboardingAuthId)
      .populate<{ user: IUser }>('user', 'firstName lastName email');

    if (!auth?.sheetConfig) return false;

    if (!isGoogleSheetsConfigured()) {
      console.warn('[onboarding-sheet] skipped: Google Sheets is not configured.');
      return false;
    }

    const config = await SheetConfig.findById(auth.sheetConfig);
    if (!config) {
      console.warn('[onboarding-sheet] skipped: the configured sheet no longer exists.');
      return false;
    }

    const data = await OnboardingData.findOne({ onboardingAuthId: auth._id })
      .populate(DOC_FIELDS, '_id originalName');

    if (!data) {
      console.warn('[onboarding-sheet] skipped: no submitted data found.');
      return false;
    }

    await resolveExtraDocNames(auth, data);

    const record = buildSheetRecord(auth, data, auth.user as IUser | undefined);

    try {
      await appendRecord(config.spreadsheetId, config.tabName, record);
      await SheetConfig.updateOne(
        { _id: config._id },
        { lastAppendAt: new Date(), $inc: { appendCount: 1 }, $unset: { lastError: 1 } },
      );
      return true;
    } catch (err) {
      console.error('[onboarding-sheet] append failed', err);
      await SheetConfig.updateOne({ _id: config._id }, { lastError: (err as Error).message });
      return false;
    }
  } catch (err) {
    console.error('[onboarding-sheet]', err);
    return false;
  }
}
