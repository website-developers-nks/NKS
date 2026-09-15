import { Types } from 'mongoose';
import { OnboardingData, BirthdayPref, MealPreference, MaritalStatus, BloodGroup, InsuranceCoverage, IOrg, IChildInfo } from '../db/models/onboarding-data.model';
import { OnboardingAuth, OnboardingExpiryReason } from '../db/models/onboarding-auth.model';
import { Doc } from '../db/models/doc.model';
import { Limits } from '../lib/limits';
import { extraFieldName, validateExtraValue } from '../lib/extra-fields';
import { ORG_ID_PATTERN } from '../lib/org-docs';

export type FieldResult =
  | { field_name: string; saved: true }
  | { field_name: string; saved: false; error: string };

type ValidateOk = { ok: true; coerced: unknown };
type ValidateFail = { ok: false; error: string };
type Validator = (value: unknown) => ValidateOk | ValidateFail;

interface FieldDef {
  modelField: string;
  validate: Validator;
}

// `required` mirrors whether GET /submit-data treats this field as
// mandatory - fields that aren't required there must accept an empty value
// at sync time too (coerced: undefined tells syncFormFields to $unset the
// field rather than reject the sync).
function stringValidator(maxLen: number, required = true): Validator {
  return (v) => {
    if (v === undefined || v === null) {
      return required ? { ok: false, error: 'Cannot be empty' } : { ok: true, coerced: undefined };
    }
    if (typeof v !== 'string') return { ok: false, error: 'Must be a string' };
    const trimmed = v.trim();
    if (trimmed.length === 0) {
      return required ? { ok: false, error: 'Cannot be empty' } : { ok: true, coerced: undefined };
    }
    if (trimmed.length > maxLen) return { ok: false, error: `Max ${maxLen} characters` };
    return { ok: true, coerced: trimmed };
  };
}

function intRangeValidator(min: number, max: number, required = true): Validator {
  return (v) => {
    if (v === undefined || v === null || v === '') {
      return required ? { ok: false, error: 'Cannot be empty' } : { ok: true, coerced: undefined };
    }
    const num = typeof v === 'string' ? Number(v) : v;
    if (typeof num !== 'number' || !Number.isInteger(num)) return { ok: false, error: 'Must be a whole number' };
    if (num < min || num > max) return { ok: false, error: `Must be between ${min} and ${max}` };
    return { ok: true, coerced: num };
  };
}

function boolValidator(): Validator {
  return (v) => {
    if (typeof v !== 'boolean') return { ok: false, error: 'Must be a boolean' };
    return { ok: true, coerced: v };
  };
}

function emailValidator(): Validator {
  return (v) => {
    if (typeof v !== 'string') return { ok: false, error: 'Must be a string' };
    const trimmed = v.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { ok: false, error: 'Invalid email format' };
    return { ok: true, coerced: trimmed };
  };
}

function dobValidator(): Validator {
  return (v) => {
    if (typeof v !== 'string') return { ok: false, error: 'Must be a string' };
    const d = new Date(v);
    if (isNaN(d.getTime())) return { ok: false, error: 'Invalid date' };
    if (d >= new Date()) return { ok: false, error: 'Date of birth must be in the past' };
    return { ok: true, coerced: d };
  };
}

function ifscValidator(required = true): Validator {
  return (v) => {
    if (v === undefined || v === null || v === '') {
      return required ? { ok: false, error: 'Cannot be empty' } : { ok: true, coerced: undefined };
    }
    if (typeof v !== 'string') return { ok: false, error: 'Must be a string' };
    const upper = v.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(upper)) return { ok: false, error: 'Invalid IFSC format' };
    return { ok: true, coerced: upper };
  };
}

function enumValidator(values: string[], label: string, required = true): Validator {
  const valid = new Set(values);
  return (v) => {
    if (v === undefined || v === null || v === '') {
      return required ? { ok: false, error: `Invalid ${label}` } : { ok: true, coerced: undefined };
    }
    if (typeof v !== 'string') return { ok: false, error: 'Must be a string' };
    if (!valid.has(v)) return { ok: false, error: `Invalid ${label}` };
    return { ok: true, coerced: v };
  };
}

function pastDateValidator(label: string, required = true): Validator {
  return (v) => {
    if (v === undefined || v === null || v === '') {
      return required ? { ok: false, error: 'Invalid date' } : { ok: true, coerced: undefined };
    }
    if (typeof v !== 'string') return { ok: false, error: 'Must be a string' };
    const d = new Date(v);
    if (isNaN(d.getTime())) return { ok: false, error: 'Invalid date' };
    if (d >= new Date()) return { ok: false, error: `${label} must be in the past` };
    return { ok: true, coerced: d };
  };
}

function orgsValidator(): Validator {
  return (v) => {
    if (!Array.isArray(v)) return { ok: false, error: 'Must be an array' };
    const coerced: IOrg[] = [];
    for (const [i, org] of v.entries()) {
      if (typeof org !== 'object' || org === null) return { ok: false, error: `Item ${i}: must be an object` };
      if (typeof org.name !== 'string' || !org.name.trim()) return { ok: false, error: `Item ${i}: name is required` };
      if (typeof org.duration !== 'string' || !org.duration.trim()) return { ok: false, error: `Item ${i}: duration is required` };
      if (typeof org.current !== 'boolean') return { ok: false, error: `Item ${i}: current must be a boolean` };
      if (org.role !== undefined && typeof org.role !== 'string') return { ok: false, error: `Item ${i}: role must be a string` };
      if (org.info !== undefined && typeof org.info !== 'string') return { ok: false, error: `Item ${i}: info must be a string` };

      // The form mints orgId and addresses that org's relieving letter with it.
      // Both are optional so an older client, or an org saved before letters
      // were per-org, still syncs.
      if (org.orgId !== undefined && (typeof org.orgId !== 'string' || !ORG_ID_PATTERN.test(org.orgId))) {
        return { ok: false, error: `Item ${i}: invalid organization id` };
      }
      if (org.relievingLetterDocId !== undefined
          && (typeof org.relievingLetterDocId !== 'string' || !Types.ObjectId.isValid(org.relievingLetterDocId))) {
        return { ok: false, error: `Item ${i}: invalid relieving letter` };
      }

      coerced.push({
        name: org.name.trim(),
        duration: org.duration.trim(),
        current: org.current,
        ...(org.orgId ? { orgId: org.orgId } : {}),
        ...(org.role ? { role: org.role.trim() } : {}),
        ...(org.info ? { info: org.info.trim() } : {}),
        ...(org.relievingLetterDocId
          ? { relievingLetterDoc: new Types.ObjectId(org.relievingLetterDocId as string) }
          : {}),
      });
    }
    return { ok: true, coerced };
  };
}

function addressValidator(requireAll: boolean): Validator {
  return (v) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, error: 'Must be an object' };
    const src = v as Record<string, unknown>;
    const keys = ['address', 'city', 'country', 'pincode'] as const;
    const coerced: Record<string, string> = {};
    for (const key of keys) {
      const val = src[key];
      if (val !== undefined && typeof val !== 'string') return { ok: false, error: `${key} must be a string` };
      const trimmed = typeof val === 'string' ? val.trim() : '';
      if (requireAll && !trimmed) return { ok: false, error: `${key} is required` };
      coerced[key] = trimmed;
    }
    return { ok: true, coerced };
  };
}

function childsInfoValidator(): Validator {
  return (v) => {
    if (!Array.isArray(v)) return { ok: false, error: 'Must be an array' };
    const coerced: IChildInfo[] = [];
    for (const [i, child] of v.entries()) {
      if (typeof child !== 'object' || child === null) return { ok: false, error: `Item ${i}: must be an object` };
      if (typeof child.name !== 'string' || !child.name.trim()) return { ok: false, error: `Item ${i}: name is required` };
      const d = new Date(child.dob);
      if (isNaN(d.getTime())) return { ok: false, error: `Item ${i}: valid dob is required` };
      coerced.push({ name: child.name.trim(), dob: d });
    }
    return { ok: true, coerced };
  };
}

// required=false below matches fields GET /submit-data does NOT list in its
// `missing` checks (or, for campus_name, only requires conditionally by
// location) - those must accept an empty value here rather than reject the sync.
const FIELD_DEFS: Record<string, FieldDef> = {
  // Core
  welcome_ack:              { modelField: 'welcomeAck',            validate: boolValidator() },

  // Personal
  full_name:                { modelField: 'fullName',              validate: stringValidator(200) },
  preferred_name:           { modelField: 'preferredName',         validate: stringValidator(100, false) },
  email:                    { modelField: 'personalEmail',         validate: emailValidator() },
  mobile:                   { modelField: 'mobile',                validate: stringValidator(20) },
  dob:                      { modelField: 'dob',                   validate: dobValidator() },
  nationality:              { modelField: 'nationality',           validate: stringValidator(100) },
  marital_status:           { modelField: 'maritalStatus',         validate: enumValidator(Object.values(MaritalStatus), 'marital status') },
  blood_group:              { modelField: 'bloodGroup',            validate: enumValidator(Object.values(BloodGroup), 'blood group', false) },
  emergency_contact_name:   { modelField: 'emergencyContactName',  validate: stringValidator(200) },
  emergency_contact_number: { modelField: 'emergencyContactNumber', validate: stringValidator(20) },
  passport_number:          { modelField: 'passportNumber',        validate: stringValidator(50) },
  pan_number:               { modelField: 'panNumber',             validate: stringValidator(20, false) },
  passport_no:              { modelField: 'passportNo',            validate: stringValidator(30, false) },
  uan_number:               { modelField: 'uanNumber',             validate: stringValidator(20, false) },
  ssn:                      { modelField: 'ssn',                   validate: stringValidator(50) },
  address:                  { modelField: 'address',               validate: addressValidator(true) },
  present_address:          { modelField: 'presentAddress',        validate: addressValidator(false) },

  // Family
  fathers_name:             { modelField: 'fathersName',           validate: stringValidator(200) },
  fathers_dob:              { modelField: 'fathersDob',            validate: pastDateValidator('Date of birth') },
  mothers_name:             { modelField: 'mothersName',           validate: stringValidator(200) },
  mothers_dob:              { modelField: 'mothersDob',            validate: pastDateValidator('Date of birth') },
  spouse_name:              { modelField: 'spouseName',            validate: stringValidator(200, false) },
  spouse_dob:               { modelField: 'spouseDob',             validate: pastDateValidator('Date of birth', false) },
  childs_info:              { modelField: 'childsInfo',            validate: childsInfoValidator() },

  // Insurance
  insurance_coverage:       { modelField: 'insuranceCoverage',     validate: enumValidator(Object.values(InsuranceCoverage), 'insurance coverage') },

  // Education & Employment
  campus_name:              { modelField: 'campusName',            validate: stringValidator(300, false) },
  orgs:                     { modelField: 'orgs',                  validate: orgsValidator() },

  // Bank
  // Not required at sync time - required=false lets Dubai leave these blank;
  // GET /submit-data is the authoritative gate and only requires them for India.
  bank_name:                { modelField: 'bankName',              validate: stringValidator(200, false) },
  account_holder:           { modelField: 'accountHolder',         validate: stringValidator(200, false) },
  account_number:           { modelField: 'accountNumber',         validate: stringValidator(30, false) },
  ifsc:                     { modelField: 'ifsc',                  validate: ifscValidator(false) },

  // About
  intro_line:               { modelField: 'introLine',             validate: stringValidator(300) },
  birthday_pref:            { modelField: 'birthdayPref',          validate: enumValidator(Object.values(BirthdayPref), 'birthday preference', false) },
  meal_preference:          { modelField: 'mealPreference',        validate: enumValidator(Object.values(MealPreference), 'meal preference', false) },
  hobbies:                  { modelField: 'hobbies',               validate: stringValidator(500, false) },
  fun_fact:                 { modelField: 'funFact',               validate: stringValidator(1000, false) },

  // Declaration & Consent
  declaration:              { modelField: 'declaration',           validate: boolValidator() },
  consent:                  { modelField: 'consent',               validate: boolValidator() },

  // Feedback (Closing Bell) - both optional
  experience_rating:        { modelField: 'experienceRating',      validate: intRangeValidator(1, 5, false) },
  experience_feedback:      { modelField: 'experienceFeedback',    validate: stringValidator(1000, false) },
};

export type SyncResult = {
  results: FieldResult[];
  limitExceeded?: 'sync_requests' | 'field_updates';
};

// A relieving letter reference is only honoured when the document behind it
// belongs to this onboarding - otherwise the id is dropped and the org is
// stored without a letter, which submit-data then reports as missing.
async function keepOwnOrgDocs(orgs: IOrg[], onboardingKey?: string): Promise<IOrg[]> {
  const ids = orgs
    .map((org) => org.relievingLetterDoc)
    .filter((id): id is Types.ObjectId => !!id);

  if (!ids.length) return orgs;
  if (!onboardingKey) return orgs.map(({ relievingLetterDoc, ...rest }) => rest);

  const owned = await Doc.find({ _id: { $in: ids }, onboardingKey }, { _id: 1 }).lean();
  const ownedIds = new Set(owned.map((doc) => String(doc._id)));

  return orgs.map((org) => {
    if (org.relievingLetterDoc && !ownedIds.has(String(org.relievingLetterDoc))) {
      const { relievingLetterDoc, ...rest } = org;
      return rest;
    }
    return org;
  });
}

export async function syncFormFields(
  onboardingAuthId: Types.ObjectId,
  fields: Record<string, unknown>,
): Promise<SyncResult> {
  const authUpdate = await OnboardingAuth.findByIdAndUpdate(
    onboardingAuthId,
    { $inc: { syncRequestCount: 1 } },
    { returnDocument: 'after' },
  );

  if (authUpdate && authUpdate.syncRequestCount >= Limits.MAX_SYNC_REQUESTS) {
    await OnboardingAuth.updateOne(
      { _id: onboardingAuthId },
      { $set: { expired: true, expiredReason: OnboardingExpiryReason.TooManySyncRequests } },
    );
    return { results: [], limitExceeded: 'sync_requests' };
  }

  const results: FieldResult[] = [];
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};
  const fieldIncrements: Record<string, number> = {};

  const extraDefs = new Map(
    (authUpdate?.extraFields ?? []).map((def) => [extraFieldName(def.key), def]),
  );

  for (const [fieldName, value] of Object.entries(fields)) {
    const extraDef = extraDefs.get(fieldName);

    if (extraDef) {
      const extraValidation = validateExtraValue(extraDef, value);
      if (!extraValidation.ok) {
        results.push({ field_name: fieldName, saved: false, error: extraValidation.error });
        continue;
      }

      if (extraValidation.value === undefined) {
        $unset[`extraFields.${extraDef.key}`] = '';
      } else {
        $set[`extraFields.${extraDef.key}`] = extraValidation.value;
      }
      fieldIncrements[`fieldUpdateCounts.${fieldName}`] = 1;
      results.push({ field_name: fieldName, saved: true });
      continue;
    }

    const def = FIELD_DEFS[fieldName];
    if (!def) {
      results.push({ field_name: fieldName, saved: false, error: 'Unknown field' });
      continue;
    }

    const validation = def.validate(value);
    if (!validation.ok) {
      results.push({ field_name: fieldName, saved: false, error: validation.error });
      continue;
    }

    // Optional fields can be cleared - the validator signals that with
    // coerced: undefined, which we turn into $unset instead of $set (setting
    // an enum/Date field to '' would fail Mongoose's own validation).
    if (validation.coerced === undefined) {
      $unset[def.modelField] = '';
    } else {
      $set[def.modelField] = validation.coerced;
    }
    fieldIncrements[`fieldUpdateCounts.${fieldName}`] = 1;
    results.push({ field_name: fieldName, saved: true });
  }

  if ($set.orgs) {
    $set.orgs = await keepOwnOrgDocs($set.orgs as IOrg[], authUpdate?.onboardingKey);
  }

  if (Object.keys($set).length > 0 || Object.keys($unset).length > 0) {
    const update: Record<string, unknown> = { $inc: fieldIncrements };
    if (Object.keys($set).length > 0) update.$set = $set;
    if (Object.keys($unset).length > 0) update.$unset = $unset;

    const updated = await OnboardingData.findOneAndUpdate(
      { onboardingAuthId },
      update,
      { returnDocument: 'after' },
    );

    if (updated?.fieldUpdateCounts) {
      for (const [fieldName] of Object.entries(fieldIncrements)) {
        const field = fieldName.replace('fieldUpdateCounts.', '');
        const count = updated.fieldUpdateCounts.get(field) ?? 0;
        if (count >= Limits.MAX_FIELD_UPDATES) {
          await OnboardingAuth.updateOne(
            { _id: onboardingAuthId },
            { $set: { expired: true, expiredReason: OnboardingExpiryReason.TooManyFieldEdits } },
          );
          return { results, limitExceeded: 'field_updates' };
        }
      }
    }
  }

  return { results };
}
