import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Types } from 'mongoose';
import { verifyOnboardingAuth, sendOnboardingOtp, verifyOnboardingOtp, checkOtpStatus } from '../services/onboarding.service';
import { syncFormFields } from '../services/sync-form.service';
import { OnboardingAuth, IOnboardingAuth, OfficeLocation, Department, OnboardingExpiryReason } from '../db/models/onboarding-auth.model';
import { OnboardingData, Accommodation } from '../db/models/onboarding-data.model';
import { requireOnboardingAuth } from '../middleware/onboarding-auth.middleware';
import { EmailAddress, getEmailEngineByCompany, getSenderByCompany } from '../email';
import { OnboardingSubmittedEmail } from '../email/emails/onboarding-submitted.email';
import { IUser } from '../db/models/user.model';
import { Limits } from '../lib/limits';
import { queueOnboardingSync } from '../services/onboarding-sync.service';
import { buildCc, defaultOnboardingCc } from '../lib/email-recipients';
import { Doc } from '../db/models/doc.model';
import { orgDocType } from '../lib/org-docs';
import { extraFieldName, validateExtraValue, ExtraFieldType } from '../lib/extra-fields';
import { expireOnboarding } from '../services/onboarding-expiry.service';
import { notifyOnboardingCompleted } from '../services/slack-notify.service';

const router = Router();

function extraValuesFor(auth: IOnboardingAuth, stored?: Map<string, unknown> | Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (!auth.extraFields?.length || !stored) return out;

  const read = (key: string) =>
    stored instanceof Map ? stored.get(key) : (stored as Record<string, unknown>)[key];

  for (const def of auth.extraFields) {
    if (def.type === ExtraFieldType.Document) continue;
    const value = read(def.key);
    if (value !== undefined) out[extraFieldName(def.key)] = value;
  }
  return out;
}

async function extraDocsFor(
  auth: IOnboardingAuth,
  stored?: Map<string, unknown> | Record<string, unknown>,
): Promise<Record<string, { id: string; name: string }>> {
  const out: Record<string, { id: string; name: string }> = {};
  if (!auth.extraFields?.length || !stored) return out;

  const read = (key: string) =>
    stored instanceof Map ? stored.get(key) : (stored as Record<string, unknown>)[key];

  const byId = new Map<string, string>();
  const ids: Types.ObjectId[] = [];

  for (const def of auth.extraFields) {
    if (def.type !== ExtraFieldType.Document) continue;
    const ref = read(def.key);
    if (ref && Types.ObjectId.isValid(String(ref))) {
      ids.push(new Types.ObjectId(String(ref)));
      byId.set(String(ref), extraFieldName(def.key));
    }
  }

  if (!ids.length) return out;

  const docs = await Doc.find({ _id: { $in: ids } }, { _id: 1, originalName: 1 }).lean();
  for (const doc of docs) {
    const fieldName = byId.get(String(doc._id));
    if (fieldName) out[fieldName] = { id: String(doc._id), name: doc.originalName };
  }
  return out;
}

const COOKIE_NAME = 'onboarding-auth';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: (process.env.COOKIE_SAME_SITE_NONE==='true' ? 'none' : 'strict') as ('none' | 'strict'),
  path: '/',
};

const otpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
});

router.get('/verify', async (req: Request, res: Response) => {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'Query param id is required.' });
    return;
  }

  try {
    const result = await verifyOnboardingAuth(req.cookies?.[COOKIE_NAME], id);

    if (result.auth) {
      res.cookie(COOKIE_NAME, result.newKey, COOKIE_OPTIONS);

      if (!result.onboardingDataId) {
        const data = await OnboardingData.create({
          userId: new Types.ObjectId(result.user.id),
          onboardingAuthId: new Types.ObjectId(result.authId),
        });
        await OnboardingAuth.updateOne(
          { _id: new Types.ObjectId(result.authId) },
          { onboardingDataId: data._id },
        );
      }

      res.json({ auth: true, user: result.user });
      return;
    }

    res.json({ auth: false, reason: result.reason, expiredReason: result.expiredReason });
  } catch (err) {
    console.error('[onboarding/verify]', err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

router.post('/send_otp', otpLimiter, async (req: Request, res: Response) => {
  const { onboardingKey } = req.body as { onboardingKey?: string };

  if (!onboardingKey) {
    res.status(400).json({ error: 'onboardingKey is required.' });
    return;
  }

  try {
    const result = await sendOnboardingOtp(onboardingKey);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    const status = message === 'Invalid onboarding key.' ? 404 : 502;
    console.error('[onboarding/send_otp]', err);
    res.status(status).json({ error: message });
  }
});

router.post('/verify_otp', otpLimiter, async (req: Request, res: Response) => {
  const { onboardingKey, otp } = req.body as { onboardingKey?: string; otp?: string };

  if (!onboardingKey || !otp) {
    res.status(400).json({ error: 'onboardingKey and otp are required.' });
    return;
  }

  try {
    const result = await verifyOnboardingOtp(onboardingKey, otp);

    if (result.verified) {
      res.cookie(COOKIE_NAME, result.authKey, COOKIE_OPTIONS);
      res.json({ verified: true });
      return;
    }

    const status = result.reason === 'max_attempts' ? 429 : 400;
    res.status(status).json({ verified: false, reason: result.reason, expiredReason: result.expiredReason });
  } catch (err) {
    console.error('[onboarding/verify_otp]', err);
    res.status(500).json({ error: 'OTP verification failed.' });
  }
});

router.get('/check-otp-status', async (req: Request, res: Response) => {
  const { onboardingKey } = req.query;

  if (!onboardingKey || typeof onboardingKey !== 'string') {
    res.status(400).json({ error: 'Query param onboardingKey is required.' });
    return;
  }

  res.clearCookie(COOKIE_NAME, { path: '/' });

  try {
    const result = await checkOtpStatus(onboardingKey);

    if ('linkExpired' in result && result.linkExpired) {
      res.json({ linkExpired: true, expiredReason: result.expiredReason });
      return;
    }

    if ('hasActiveOtp' in result && result.hasActiveOtp) {
      res.json({
        page: 'enter_otp',
        hasActiveOtp: true,
        expiresAt: result.expiresAt,
        resendCount: result.resendCount,
        nextResendAt: result.nextResendAt,
      });
      return;
    }

    res.json({ page: 'send_otp', hasActiveOtp: false });
  } catch (err) {
    console.error('[onboarding/check-otp-status]', err);
    res.status(500).json({ error: 'Status check failed.' });
  }
});

router.get('/submit-data', requireOnboardingAuth, async (req: Request, res: Response) => {
  const auth = req.onboarding!;
  const authId = auth.auth._id as unknown as Types.ObjectId;

  try {
    const authUpdate = await OnboardingAuth.findByIdAndUpdate(
      authId,
      { $inc: { submitAttempts: 1 } },
      { returnDocument: 'after' },
    );

    if (authUpdate && authUpdate.submitAttempts >= Limits.MAX_SUBMIT_ATTEMPTS) {
      await expireOnboarding(authId, OnboardingExpiryReason.TooManySubmitAttempts);
      res.status(429).json({
        submitted: false,
        error: 'Too many submission attempts.',
        reason: 'expired',
        expiredReason: OnboardingExpiryReason.TooManySubmitAttempts,
      });
      return;
    }

    const data = await OnboardingData.findOne({ onboardingAuthId: authId }).lean();

    if (!data) {
      res.status(404).json({ error: 'No onboarding data found.' });
      return;
    }

    const missing: string[] = [];

    const requireTrue = (val: boolean | undefined, name: string) => {
      if (!val) missing.push(name);
    };
    const requireStr = (val: string | undefined, name: string) => {
      if (!val || val.trim().length === 0) missing.push(name);
    };
    const requireDoc = (val: unknown, name: string) => {
      if (!val) missing.push(name);
    };
    const requireAddress = (val: { address?: string; city?: string; country?: string; pincode?: string } | undefined, name: string) => {
      if (!val || !val.address?.trim() || !val.city?.trim() || !val.country?.trim() || !val.pincode?.trim()) missing.push(name);
    };

    const location = auth.auth.location;
    const isDubai = location === OfficeLocation.Dubai;
    const isIndia = location === OfficeLocation.Gurugram || location === OfficeLocation.GiftCity;

    // Always required
    requireTrue(data.welcomeAck,            'welcome_ack');
    requireStr(data.fullName,               'full_name');
    requireStr(data.personalEmail,          'email');
    requireStr(data.mobile,                 'mobile');
    requireDoc(data.dob,                    'dob');
    requireStr(data.nationality,            'nationality');
    requireStr(data.maritalStatus,            'marital_status');
    requireStr(data.emergencyContactName,   'emergency_contact_name');
    requireStr(data.emergencyContactNumber, 'emergency_contact_number');
    requireStr(data.passportNumber,        'passport_number');
    requireStr(data.gender,                'gender');
    requireStr(data.bloodGroup,            'blood_group');
    requireStr(data.panNumber,             'pan_number');
    requireStr(data.uanNumber,             'uan_number');
    requireStr(data.mealPreference,        'meal_preference');
    requireDoc(data.experienceRating,      'experience_rating');
    requireAddress(data.address,           'address');
    requireAddress(data.presentAddress,    'present_address');
    requireDoc(data.idDoc,                 'id_doc');
    requireDoc(data.photoDoc,              'photo_doc');
    requireDoc(data.highestDegreeDoc,      'highest_degree_doc');
    requireDoc(data.resumeDoc,             'resume_doc');
    requireStr(data.introLine,             'intro_line');
    requireTrue(data.declaration,          'declaration');
    requireTrue(data.consent,              'consent');
    requireStr(data.fathersName,             'fathers_name');
    requireDoc(data.fathersDob,             'fathers_dob');
    requireStr(data.mothersName,             'mothers_name');
    requireDoc(data.mothersDob,             'mothers_dob');
    requireDoc(data.insuranceCoverage,             'insurance_coverage');
    for (const org of data.orgs ?? []) {
      if (org.current || org.relievingLetterDoc) continue;
      missing.push(org.orgId ? orgDocType(org.orgId) : 'orgs');
    }

    // Required for Gurugram / Gift City only - Payroll Ledger (bank details)
    // isn't mandatory in Dubai, since IFSC is an Indian bank code and doesn't apply there.
    if (isIndia) {
      requireDoc(data.higherSecondaryDoc,  'higher_secondary_doc');
      requireDoc(data.panDoc,                'pan_doc');
      requireDoc(data.bankDoc,               'bank_doc');
      requireStr(data.bankName,              'bank_name');
      requireStr(data.accountHolder,         'account_holder');
      requireStr(data.accountNumber,         'account_number');
      requireStr(data.ifsc,                  'ifsc');
    }

    // Required for Dubai only
    if (isDubai) {
      requireDoc(data.offerLetterDoc,      'offer_letter_doc');
      requireDoc(data.lastIncrementDoc,    'last_increment_doc');
      requireDoc(data.salarySlipDoc,       'salary_slip_doc');
      requireDoc(data.bonusLetterDoc,      'bonus_letter_doc');
      requireDoc(data.experienceLetterDoc, 'experience_letter_doc');
      requireStr(data.campusName,          'campus_name');
    }

    const department = auth.auth.department;
    if (department === Department.Tech) {
      requireStr(data.accommodation, 'accommodation');
      if (data.accommodation === Accommodation.Yes && location === OfficeLocation.Gurugram) {
        requireStr(data.stayDates, 'stay_dates');
      }
    }
    if (location === OfficeLocation.Gurugram) {
      requireStr(data.gymMembership, 'gym_membership');
      requireStr(data.tshirtSize, 'tshirt_size');
    }

    for (const def of req.onboarding!.auth.extraFields ?? []) {
      const stored = data.extraFields;
      const value = stored instanceof Map
        ? stored.get(def.key)
        : (stored as Record<string, unknown> | undefined)?.[def.key];

      if (def.type === ExtraFieldType.Document) {
        if (def.required && !value) missing.push(extraFieldName(def.key));
        continue;
      }

      const check = validateExtraValue(def, value);
      if (!check.ok || (def.required && check.value === undefined)) {
        missing.push(extraFieldName(def.key));
      }
    }

    if (missing.length > 0) {
      res.status(422).json({ submitted: false, missing });
      return;
    }

    await Promise.all([
      OnboardingAuth.updateOne({ _id: authId }, { completed: true }),
      OnboardingData.updateOne({ onboardingAuthId: authId }, { submittedAt: new Date() }),
    ]);

    await queueOnboardingSync(authId);
    await notifyOnboardingCompleted(authId);

    const u = req.onboarding!.user as IUser;
    const sender = getSenderByCompany(auth.auth.company);

    const inviteMessageId = auth.auth.inviteMessageId;
    const inviteSubject = inviteMessageId && auth.auth.inviteSubject
      ? (/^re:/i.test(auth.auth.inviteSubject) ? auth.auth.inviteSubject : `Re: ${auth.auth.inviteSubject}`)
      : undefined;
    await getEmailEngineByCompany(auth.auth.company).send(
      new OnboardingSubmittedEmail(
        { name: `${u.firstName} ${u.lastName}`, address: u.email },
        { firstName: u.firstName },
        {
          from: sender,
          cc: buildCc([auth.auth.cc, defaultOnboardingCc()], u.email),
          bcc:auth.auth.bcc?.map(x=>({'name':x,'address':x})),
          ...(inviteSubject ? { subject: inviteSubject } : {}),
          inReplyTo: inviteMessageId,
          references: inviteMessageId ? [inviteMessageId] : undefined,
        },
      ),
    ).catch((err) => console.error('[onboarding/submit-data] email failed:', err));

    res.json({ submitted: true });
  } catch (err) {
    console.error('[onboarding/submit-data]', err);
    res.status(500).json({ error: 'Submission failed.' });
  }
});

router.post('/sync-form', requireOnboardingAuth, async (req: Request, res: Response) => {
  const { fields } = req.body as { fields?: unknown };

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    res.status(400).json({ error: 'fields must be a non-empty object' });
    return;
  }

  const authId = req.onboarding!.auth._id as unknown as Types.ObjectId;

  try {
    const syncResult = await syncFormFields(authId, fields as Record<string, unknown>);

    if (syncResult.limitExceeded) {
      res.status(429).json({
        error: 'Limit exceeded',
        reason: syncResult.limitExceeded,
        results: syncResult.results,
      });
      return;
    }

    res.json(syncResult.results);
  } catch (err) {
    console.error('[onboarding/sync-form]', err);
    res.status(500).json({ error: 'Sync failed.' });
  }
});

router.get('/progress-data', requireOnboardingAuth, async (req: Request, res: Response) => {
  const authId = req.onboarding!.auth._id as unknown as Types.ObjectId;
  const location = req.onboarding!.auth.location
  try {
    const DOC_FIELDS = [
      'orgs.relievingLetterDoc',
      'panDoc', 'passportDoc', 'idDoc', 'addressDoc', 'photoDoc',
      'higherSecondaryDoc', 'highestDegreeDoc',
      'resumeDoc', 'offerLetterDoc', 'lastIncrementDoc',
      'salarySlipDoc', 'bonusLetterDoc', 'experienceLetterDoc', 'relievingLetterDoc',
      'bankDoc',
    ];

    const data = await OnboardingData
      .findOne({ onboardingAuthId: authId })
      .populate(DOC_FIELDS, '_id originalName')
      .lean();

    if (!data) {
      res.json({
        fields: {},
        docs: {},
        info: { location, department: req.onboarding!.auth.department ?? null, extraFields: req.onboarding!.auth.extraFields ?? [] },
        submittedAt: null,
      });
      return;
    }

    const formatDate = (d: Date | undefined): string | null =>
      d ? d.toISOString().slice(0, 10) : null;

    const docEntry = (ref: unknown): { id: string; name: string } | null => {
      if (ref && typeof ref === 'object' && 'originalName' in (ref as object)) {
        const d = ref as { _id: object; originalName: string };
        return { id: d._id.toString(), name: d.originalName };
      }
      return null;
    };

    res.json({
      fields: {
        // Core
        welcome_ack:            data.welcomeAck ?? null,
        // Personal
        full_name:              data.fullName ?? null,
        preferred_name:         data.preferredName ?? null,
        email:                  data.personalEmail ?? null,
        mobile:                 data.mobile ?? null,
        dob:                    formatDate(data.dob),
        preferred_dob:          formatDate(data.preferredDob),
        nationality:            data.nationality ?? null,
        gender:                 data.gender ?? null,
        marital_status:         data.maritalStatus ?? null,
        blood_group:            data.bloodGroup ?? null,
        emergency_contact_name:   data.emergencyContactName ?? null,
        emergency_contact_number: data.emergencyContactNumber ?? null,
        passport_number:        data.passportNumber ?? null,
        pan_number:             data.panNumber ?? null,
        passport_no:            data.passportNo ?? null,
        uan_number:             data.uanNumber ?? null,
        ssn:                    data.ssn ?? null,
        address:                data.address ?? null,
        present_address:        data.presentAddress ?? null,
        // Family
        fathers_name:           data.fathersName ?? null,
        fathers_dob:            formatDate(data.fathersDob),
        mothers_name:           data.mothersName ?? null,
        mothers_dob:            formatDate(data.mothersDob),
        spouse_name:            data.spouseName ?? null,
        spouse_dob:             formatDate(data.spouseDob),
        childs_info:            data.childsInfo?.map(c => ({ name: c.name, dob: formatDate(c.dob) })) ?? null,
        // Insurance
        insurance_coverage:     data.insuranceCoverage ?? null,
        // Education & Employment
        campus_name:            data.campusName ?? null,
        orgs:                   (data.orgs ?? []).map((org) => ({
          orgId: org.orgId ?? null,
          name: org.name,
          duration: org.duration,
          role: org.role ?? null,
          info: org.info ?? null,
          current: org.current,
          relievingLetterDoc: docEntry(org.relievingLetterDoc),
        })),
        // Bank
        bank_name:              data.bankName ?? null,
        account_holder:         data.accountHolder ?? null,
        account_number:         data.accountNumber ?? null,
        ifsc:                   data.ifsc ?? null,
        // About
        intro_line:             data.introLine ?? null,
        meal_preference:        data.mealPreference ?? null,
        accommodation:          data.accommodation ?? null,
        stay_dates:             data.stayDates ?? null,
        gym_membership:         data.gymMembership ?? null,
        tshirt_size:            data.tshirtSize ?? null,
        // Declaration & Consent
        declaration:            data.declaration ?? null,
        consent:                data.consent ?? null,
        // Feedback (Closing Bell)
        experience_rating:      data.experienceRating ?? null,
        experience_feedback:    data.experienceFeedback ?? null,
      },
      docs: {
        pan_doc:               docEntry(data.panDoc),
        passport_doc:          docEntry(data.passportDoc),
        id_doc:                docEntry(data.idDoc),
        address_doc:           docEntry(data.addressDoc),
        photo_doc:             docEntry(data.photoDoc),
        higher_secondary_doc:  docEntry(data.higherSecondaryDoc),
        highest_degree_doc:    docEntry(data.highestDegreeDoc),
        resume_doc:            docEntry(data.resumeDoc),
        offer_letter_doc:      docEntry(data.offerLetterDoc),
        last_increment_doc:    docEntry(data.lastIncrementDoc),
        salary_slip_doc:       docEntry(data.salarySlipDoc),
        bonus_letter_doc:      docEntry(data.bonusLetterDoc),
        experience_letter_doc: docEntry(data.experienceLetterDoc),
        relieving_letter_doc:  docEntry(data.relievingLetterDoc),
        bank_doc:              docEntry(data.bankDoc),
      },
      info:{
        location,
        department: req.onboarding!.auth.department ?? null,
        extraFields: req.onboarding!.auth.extraFields ?? [],
      },
      extraFieldValues: extraValuesFor(req.onboarding!.auth, data.extraFields),
      extraDocs: await extraDocsFor(req.onboarding!.auth, data.extraFields),
      submittedAt: data.submittedAt ?? null,
    });
  } catch (err) {
    console.error('[onboarding/progress-data]', err);
    res.status(500).json({ error: 'Failed to fetch progress data.' });
  }
});

export default router;
