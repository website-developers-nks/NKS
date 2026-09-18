import { Types } from 'mongoose';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { r2, R2_BUCKET } from '../lib/r2';
import { OnboardingAuth, IOnboardingAuth } from '../db/models/onboarding-auth.model';
import { OnboardingData, IOnboardingData } from '../db/models/onboarding-data.model';
import { IUser } from '../db/models/user.model';
import { Doc, IDoc } from '../db/models/doc.model';
import { DriveConfig, IDriveConfig } from '../db/models/drive-config.model';
import { uploadFile, updateFile } from '../lib/google-drive';
import { ExtraFieldDef, ExtraFieldType } from '../lib/extra-fields';
import { isGoogleConfigured } from '../lib/google-auth';

export interface DriveDocument {
  key: string;
  label: string;
  doc: IDoc;
}

const DOC_FIELDS: Array<{ key: string; field: keyof IOnboardingData; label: string }> = [
  { key: 'photo_doc', field: 'photoDoc', label: 'Personal photo' },
  { key: 'id_doc', field: 'idDoc', label: 'ID proof (Aadhar / Passport)' },
  { key: 'pan_doc', field: 'panDoc', label: 'PAN card' },
  { key: 'passport_doc', field: 'passportDoc', label: 'Passport' },
  { key: 'address_doc', field: 'addressDoc', label: 'Address proof' },
  { key: 'resume_doc', field: 'resumeDoc', label: 'Resume' },
  { key: 'highest_degree_doc', field: 'highestDegreeDoc', label: 'Highest degree certificate' },
  { key: 'higher_secondary_doc', field: 'higherSecondaryDoc', label: 'Higher secondary marksheet' },
  { key: 'bank_doc', field: 'bankDoc', label: 'Bank proof' },
  { key: 'offer_letter_doc', field: 'offerLetterDoc', label: 'Offer letter' },
  { key: 'last_increment_doc', field: 'lastIncrementDoc', label: 'Last increment letter' },
  { key: 'salary_slip_doc', field: 'salarySlipDoc', label: 'Salary slip' },
  { key: 'bonus_letter_doc', field: 'bonusLetterDoc', label: 'Bonus letter' },
  { key: 'experience_letter_doc', field: 'experienceLetterDoc', label: 'Experience letter' },
  { key: 'relieving_letter_doc', field: 'relievingLetterDoc', label: 'Relieving letter (legacy)' },
];

export const ORG_RELIEVING_KEY = 'org_relieving_letters';
export const EXTRA_DOCS_KEY = 'extra_field_docs';

export const DRIVE_DOCUMENTS: Array<{ key: string; label: string }> = [
  ...DOC_FIELDS.map((d) => ({ key: d.key, label: d.label })),
  { key: ORG_RELIEVING_KEY, label: 'Relieving letters (per organization)' },
  { key: EXTRA_DOCS_KEY, label: 'Extra info field uploads' },
];

const POPULATE = [...DOC_FIELDS.map((d) => d.field as string), 'orgs.relievingLetterDoc'];

function isDoc(value: unknown): value is IDoc {
  return !!value && typeof value === 'object' && 'path' in (value as object);
}

function extension(doc: IDoc): string {
  const match = /\.[a-z0-9]{1,8}$/i.exec(doc.originalName ?? '');
  return match ? match[0] : '';
}


function fileNameFor(person: string, label: string, doc: IDoc, onboardingKey: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  const tag = (onboardingKey ?? '').split('-')[0] || 'unknown';
  return `${clean(person || 'Onboarding')} - ${clean(label)} [${tag}]${extension(doc)}`;
}

async function collectDocuments(
  auth: IOnboardingAuth,
  data: IOnboardingData,
): Promise<DriveDocument[]> {
  const out: DriveDocument[] = [];

  for (const { key, field, label } of DOC_FIELDS) {
    const value = (data as unknown as Record<string, unknown>)[field as string];
    if (isDoc(value)) out.push({ key, label, doc: value });
  }

  (data.orgs ?? []).forEach((org, index) => {
    if (isDoc(org.relievingLetterDoc)) {
      out.push({
        key: ORG_RELIEVING_KEY,
        label: `Relieving letter ${index + 1} - ${org.name}`,
        doc: org.relievingLetterDoc,
      });
    }
  });

  const defs = (auth.extraFields ?? []) as ExtraFieldDef[];
  const stored = data.extraFields;
  const ids: Types.ObjectId[] = [];
  const labelById = new Map<string, string>();

  for (const def of defs) {
    if (def.type !== ExtraFieldType.Document) continue;
    const raw = stored instanceof Map ? stored.get(def.key) : (stored as Record<string, unknown> | undefined)?.[def.key];
    if (raw && Types.ObjectId.isValid(String(raw))) {
      ids.push(new Types.ObjectId(String(raw)));
      labelById.set(String(raw), def.label);
    }
  }

  if (ids.length) {
    const docs = await Doc.find({ _id: { $in: ids } });
    for (const doc of docs) {
      out.push({ key: EXTRA_DOCS_KEY, label: labelById.get(String(doc._id)) ?? 'Extra document', doc });
    }
  }

  return out;
}

async function fetchFromR2(doc: IDoc): Promise<Buffer> {
  const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.path }));
  if (!object.Body) throw new Error('empty object');

  const chunks: Buffer[] = [];
  for await (const chunk of object.Body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function folderFor(config: IDriveConfig, key: string): string | null {
  const mapping = config.mapping instanceof Map
    ? config.mapping
    : new Map(Object.entries((config.mapping ?? {}) as Record<string, { folderId?: string }>));

  const target = mapping.get(key) as { folderId?: string } | undefined;
  return target?.folderId || config.defaultFolderId || null;
}

export type DriveSyncResult =
  | { synced: true; uploaded: number; skipped: number; failed: number }
  | { synced: false; reason: 'not_configured' | 'no_data' | 'nothing_mapped' | 'failed'; error?: string };


export async function pushOnboardingToDrive(
  onboardingAuthId: Types.ObjectId | string,
): Promise<DriveSyncResult> {
  try {
    const auth = await OnboardingAuth.findById(onboardingAuthId)
      .populate<{ user: IUser }>('user', 'firstName lastName email');

    if (!auth?.driveConfig) return { synced: false, reason: 'not_configured' };
    if (!isGoogleConfigured()) {
      return { synced: false, reason: 'failed', error: 'Google credentials are not configured on the server.' };
    }

    const config = await DriveConfig.findById(auth.driveConfig);
    if (!config) return { synced: false, reason: 'not_configured' };

    const data = await OnboardingData.findOne({ onboardingAuthId: auth._id }).populate(POPULATE);
    if (!data) return { synced: false, reason: 'no_data' };

    const documents = await collectDocuments(auth, data);
    const person = data.fullName
      || [ (auth.user as IUser | undefined)?.firstName, (auth.user as IUser | undefined)?.lastName ]
        .filter(Boolean).join(' ');

    const existing = auth.driveFiles instanceof Map ? new Map(auth.driveFiles) : new Map<string, string>();
    let uploaded = 0, skipped = 0, failed = 0;
    let lastError: string | undefined;

    for (const entry of documents) {
      const folderId = folderFor(config, entry.key);
      if (!folderId) { skipped += 1; continue; }

      try {
        const contents = await fetchFromR2(entry.doc);
        const mimeType = entry.doc.mimeType || 'application/octet-stream';
        const name = fileNameFor(person, entry.label, entry.doc, auth.onboardingKey);

        const trackKey = `${entry.key}:${String(entry.doc._id)}`;
        const previous = existing.get(trackKey);

        const file = previous
          ? await updateFile(previous, name, mimeType, contents)
              .catch(() => uploadFile(folderId, name, mimeType, contents))
          : await uploadFile(folderId, name, mimeType, contents);

        existing.set(trackKey, file.id);
        uploaded += 1;
      } catch (err) {
        failed += 1;
        lastError = (err as Error).message;
        console.error('[onboarding-drive]', entry.key, lastError);
      }
    }

    if (!uploaded && !failed && skipped === documents.length) {
      return { synced: false, reason: 'nothing_mapped' };
    }

    await OnboardingAuth.updateOne(
      { _id: auth._id },
      failed
        ? { $set: { driveFiles: existing, driveError: lastError } }
        : { $set: { driveSyncedAt: new Date(), driveFiles: existing }, $unset: { driveError: 1 } },
    );

    await DriveConfig.updateOne(
      { _id: config._id },
      failed
        ? { lastError }
        : { lastSyncAt: new Date(), $inc: { fileCount: uploaded }, $unset: { lastError: 1 } },
    );

    if (failed && !uploaded) return { synced: false, reason: 'failed', error: lastError };
    return { synced: true, uploaded, skipped, failed };
  } catch (err) {
    console.error('[onboarding-drive] unexpected failure', err);
    return { synced: false, reason: 'failed', error: (err as Error).message };
  }
}
