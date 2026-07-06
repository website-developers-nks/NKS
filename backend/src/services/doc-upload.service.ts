import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '../lib/r2';
import { Doc, DocType } from '../db/models/doc.model';
import { Types } from 'mongoose';

export interface DocConfig {
  maxSizeBytes: number;
  minSizeBytes: number;
  maxFilenameLength: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
}

export const IMAGE_CONFIG: DocConfig = {
  maxSizeBytes: 5 * 1024 * 1024,
  minSizeBytes: 1 * 1024,
  maxFilenameLength: 200,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
};

export const PDF_CONFIG: DocConfig = {
  maxSizeBytes: 10 * 1024 * 1024,
  minSizeBytes: 1 * 1024,
  maxFilenameLength: 200,
  allowedMimeTypes: ['application/pdf'],
  allowedExtensions: ['pdf'],
};

export const IMAGE_OR_PDF_CONFIG: DocConfig = {
  maxSizeBytes: 10 * 1024 * 1024,
  minSizeBytes: 1 * 1024,
  maxFilenameLength: 200,
  allowedMimeTypes: [...IMAGE_CONFIG.allowedMimeTypes, ...PDF_CONFIG.allowedMimeTypes],
  allowedExtensions: [...IMAGE_CONFIG.allowedExtensions, ...PDF_CONFIG.allowedExtensions],
};

export const DOC_TYPE_CONFIG: Record<DocType, DocConfig> = {
  // Identity & address
  [DocType.AadharCard]: IMAGE_OR_PDF_CONFIG,
  [DocType.PanCard]: IMAGE_OR_PDF_CONFIG,
  [DocType.ProfilePhoto]: IMAGE_CONFIG,
  [DocType.AddressProof]: IMAGE_OR_PDF_CONFIG,
  // Education
  [DocType.HigherSecondaryMarksheet]: IMAGE_OR_PDF_CONFIG,
  [DocType.HighestDegreeCertificate]: IMAGE_OR_PDF_CONFIG,
  // Employment (current org)
  [DocType.Resume]: IMAGE_OR_PDF_CONFIG,
  [DocType.OfferLetterCurrentOrg]: IMAGE_OR_PDF_CONFIG,
  [DocType.LastIncrementLetter]: IMAGE_OR_PDF_CONFIG,
  [DocType.SalarySlip]: IMAGE_OR_PDF_CONFIG,
  [DocType.BonusLetter]: IMAGE_OR_PDF_CONFIG,
  [DocType.ExperienceLetter]: IMAGE_OR_PDF_CONFIG,
  [DocType.RelievingLetter]: IMAGE_OR_PDF_CONFIG,
  // Bank
  [DocType.BankProof]: IMAGE_OR_PDF_CONFIG,
};

type ValidationFailReason =
  | 'file_too_large'
  | 'file_too_small'
  | 'filename_too_long'
  | 'invalid_type'
  | 'invalid_extension';

export type DocUploadResult =
  | { uploaded: true; docId: string; docType: DocType; mimeType: string; sizeBytes: number }
  | { uploaded: false; reason: ValidationFailReason };

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

function buildContentDisposition(filename: string): string {
  const sanitized = filename
    .normalize('NFKD')                          // Normalize Unicode (decompose characters)
    .replace(/[^\x20-\x7E]/g, '')               // Keep only printable ASCII (space to tilde)
    .replace(/[/\\:*?"<>|]/g, '_')              // Replace filesystem-unsafe characters
    .replace(/\s+/g, '_')                       // Replace whitespace with underscores
    .replace(/_+/g, '_')                        // Collapse multiple underscores
    .replace(/^_|_$/g, '');                     // Trim leading/trailing underscores

  const safeName = sanitized || 'document';
  return `attachment; filename="${safeName}"`;
}

function validateDoc(
  file: Express.Multer.File,
  config: DocConfig,
): { valid: true } | { valid: false; reason: ValidationFailReason } {
  if (file.originalname.length > config.maxFilenameLength) {
    return { valid: false, reason: 'filename_too_long' };
  }

  if (!config.allowedMimeTypes.includes(file.mimetype)) {
    return { valid: false, reason: 'invalid_type' };
  }

  const ext = getExtension(file.originalname);
  if (!config.allowedExtensions.includes(ext)) {
    return { valid: false, reason: 'invalid_extension' };
  }

  if (file.size > config.maxSizeBytes) {
    return { valid: false, reason: 'file_too_large' };
  }

  if (file.size < config.minSizeBytes) {
    return { valid: false, reason: 'file_too_small' };
  }

  return { valid: true };
}

export async function uploadDoc(
  file: Express.Multer.File,
  docType: DocType,
  userId: Types.ObjectId,
  onboardingKey: string,
): Promise<DocUploadResult> {
  const config = DOC_TYPE_CONFIG[docType];
  const validation = validateDoc(file, config);

  if (!validation.valid) {
    return { uploaded: false, reason: validation.reason };
  }

  const ext = getExtension(file.originalname);
  const storedName = `${docType}.${ext}`;
  const r2Key = `${onboardingKey}/${storedName}`;

  const existing = await Doc.findOne({ onboardingKey, docType });

  if (existing && existing.path !== r2Key) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: existing.path })).catch(() => undefined);
  }

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ContentDisposition: buildContentDisposition(file.originalname),
  }));

  const doc = await Doc.findOneAndUpdate(
    { onboardingKey, docType },
    {
      userId,
      onboardingKey,
      docType,
      originalName: file.originalname,
      storedName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      path: r2Key,
    },
    { upsert: true, returnDocument: 'after' },
  );

  return {
    uploaded: true,
    docId: (doc!._id as object).toString(),
    docType,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  };
}
