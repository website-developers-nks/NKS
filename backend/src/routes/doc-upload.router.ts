import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Types } from 'mongoose';
import { r2, R2_BUCKET } from '../lib/r2';
import { Limits } from '../lib/limits';
import { requireOnboardingAuth } from '../middleware/onboarding-auth.middleware';
import { uploadDoc, DOC_TYPE_CONFIG } from '../services/doc-upload.service';
import { Doc, DocType } from '../db/models/doc.model';
import { OnboardingData } from '../db/models/onboarding-data.model';
import { OnboardingAuth } from '../db/models/onboarding-auth.model';

const router = Router();

const ABSOLUTE_MAX_BYTES = 15 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ABSOLUTE_MAX_BYTES },
});

function parseSingle(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

const VALID_DOC_TYPES = Object.values(DocType) as string[];

const STATUS_MAP: Record<string, number> = {
  file_too_large: 413,
  file_too_small: 400,
  filename_too_long: 400,
  invalid_type: 415,
  invalid_extension: 415,
};

// Maps DocType → OnboardingData field name
const DOC_TYPE_FIELD: Record<DocType, string> = {
  [DocType.PanCard]: 'panDoc',
  [DocType.AadharCard]: 'idDoc',
  [DocType.AddressProof]: 'addressDoc',
  [DocType.ProfilePhoto]: 'photoDoc',
  [DocType.HigherSecondaryMarksheet]: 'higherSecondaryDoc',
  [DocType.HighestDegreeCertificate]: 'highestDegreeDoc',
  [DocType.Resume]: 'resumeDoc',
  [DocType.OfferLetterCurrentOrg]: 'offerLetterDoc',
  [DocType.LastIncrementLetter]: 'lastIncrementDoc',
  [DocType.SalarySlip]: 'salarySlipDoc',
  [DocType.BonusLetter]: 'bonusLetterDoc',
  [DocType.ExperienceLetter]: 'experienceLetterDoc',
  [DocType.RelievingLetter]: 'relievingLetterDoc',
  [DocType.BankProof]: 'bankDoc',
};

// Upload a document to R2
router.post(
  '/upload',
  requireOnboardingAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await parseSingle(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ uploaded: false, reason: 'file_too_large' });
        return;
      }
      next(err);
      return;
    }

    const { docType } = req.body as { docType?: string };

    if (!docType || !VALID_DOC_TYPES.includes(docType)) {
      res.status(400).json({ uploaded: false, reason: 'invalid_doc_type', validTypes: VALID_DOC_TYPES });
      return;
    }

    if (!req.file) {
      res.status(400).json({ uploaded: false, reason: 'no_file' });
      return;
    }

    const config = DOC_TYPE_CONFIG[docType as DocType];
    if (req.file.size > config.maxSizeBytes) {
      res.status(413).json({ uploaded: false, reason: 'file_too_large', maxSizeBytes: config.maxSizeBytes });
      return;
    }

    const auth = req.onboarding!;
    const userId = auth.user._id as unknown as Types.ObjectId;
    const authId = auth.auth._id as unknown as Types.ObjectId;

    if (auth.auth.expired) {
      res.status(403).json({ uploaded: false, reason: 'onboarding_expired', message: 'Document upload limit exceeded' });
      return;
    }

    const field = DOC_TYPE_FIELD[docType as DocType];
    const existingData = await OnboardingData.findOne({ onboardingAuthId: authId }, { [field]: 1 });
    if (existingData && existingData[field as keyof typeof existingData]) {
      res.status(409).json({ uploaded: false, reason: 'doc_already_exists' });
      return;
    }

    try {
      const result = await uploadDoc(req.file, docType as DocType, userId, auth.auth.onboardingKey);

      if (!result.uploaded) {
        res.status(STATUS_MAP[result.reason] ?? 400).json({ uploaded: false, reason: result.reason, config });
        return;
      }

      await OnboardingData.updateOne({ onboardingAuthId: authId }, { $set: { [field]: new Types.ObjectId(result.docId) } });

      const updated = await OnboardingAuth.findByIdAndUpdate(
        authId,
        { $inc: { docCount: 1 } },
        { returnDocument: 'after' }
      );
      if (updated && updated.docCount >= Limits.MAX_DOC_UPLOADS) {
        await OnboardingAuth.updateOne({ _id: authId }, { $set: { expired: true } });
      }

      res.status(201).json(result);
    } catch (err) {
      console.error('[docs/upload]', err);
      res.status(500).json({ error: 'Upload failed.' });
    }
  },
);

router.post(
  '/remove_doc',
  requireOnboardingAuth,
  async (req: Request, res: Response) => {
    const { docType } = req.body as { docType?: string };

    if (!docType || !VALID_DOC_TYPES.includes(docType)) {
      res.status(400).json({ removed: false, reason: 'invalid_doc_type', validTypes: VALID_DOC_TYPES });
      return;
    }

    const auth = req.onboarding!;
    const { onboardingKey } = auth.auth;
    const authId = auth.auth._id as unknown as Types.ObjectId;

    try {
      const doc = await Doc.findOneAndDelete({ onboardingKey, docType: docType as DocType });

      if (!doc) {
        res.status(404).json({ removed: false, reason: 'not_found' });
        return;
      }

      await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.path })).catch(() => undefined);

      const field = DOC_TYPE_FIELD[docType as DocType];
      await OnboardingData.updateOne({ onboardingAuthId: authId }, { $unset: { [field]: 1 } });

      res.json({ removed: true, docType });
    } catch (err) {
      console.error('[docs/remove_doc]', err);
      res.status(500).json({ error: 'Remove failed.' });
    }
  },
);

router.get(
  '/presign',
  requireOnboardingAuth,
  async (req: Request, res: Response) => {
    const { docType } = req.query as { docType?: string };

    if (!docType || !VALID_DOC_TYPES.includes(docType)) {
      res.status(400).json({ error: 'Valid docType query param is required.', validTypes: VALID_DOC_TYPES });
      return;
    }

    const auth = req.onboarding!;
    const { onboardingKey } = auth.auth;
    const authId = auth.auth._id as unknown as Types.ObjectId;

    try {
      const doc = await Doc.findOneAndUpdate(
        { onboardingKey, docType: docType as DocType },
        { $inc: { presignUrlCount: 1 } },
        { returnDocument: 'after' },
      );

      if (!doc) {
        res.status(404).json({ error: 'Document not found.' });
        return;
      }

      // Check if presign limit exceeded and mark onboarding as expired
      if (doc.presignUrlCount >= Limits.MAX_PRESIGN_PER_DOC) {
        await OnboardingAuth.updateOne({ _id: authId }, { $set: { expired: true } });
      }

      const url = await getSignedUrl(
        r2,
        new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: doc.path,
          ResponseContentDisposition: `attachment; filename="${doc.originalName}"`,
        }),
        { expiresIn: 300 },
      );

      res.json({ url, expiresIn: 300, originalName: doc.originalName, mimeType: doc.mimeType });
    } catch (err) {
      console.error('[docs/presign]', err);
      res.status(500).json({ error: 'Failed to generate download link.' });
    }
  },
);

export default router;
