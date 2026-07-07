import { randomUUID } from 'crypto';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Types } from 'mongoose';
import { Readable } from 'stream';
import { r2, R2_BUCKET } from '../lib/r2';
import { AdminAttachment } from '../db/models/admin-attachment.model';
import { EmailAttachment } from '../email/base.email';

export const MAX_ADMIN_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ADMIN_ATTACHMENTS_PER_EMAIL = 10;

export interface AdminAttachmentSummary {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export async function uploadAdminAttachment(
  file: Express.Multer.File,
  uploadedBy: Types.ObjectId,
): Promise<AdminAttachmentSummary> {
  const key = `admin-attachments/${uploadedBy.toString()}/${randomUUID()}-${file.originalname}`;

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  const doc = await AdminAttachment.create({
    uploadedBy,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    path: key,
  });

  return {
    id: (doc._id as object).toString(),
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
  };
}

export async function deleteAdminAttachment(id: string, uploadedBy: Types.ObjectId): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;

  const doc = await AdminAttachment.findOneAndDelete({ _id: id, uploadedBy });
  if (!doc) return false;

  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.path })).catch(() => undefined);
  return true;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function resolveAdminAttachments(
  ids: string[],
  uploadedBy: Types.ObjectId,
): Promise<EmailAttachment[]> {
  if (!ids.length) return [];

  const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
  const docs = await AdminAttachment.find({ _id: { $in: validIds }, uploadedBy });
  const byId = new Map(docs.map((doc) => [(doc._id as object).toString(), doc]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(`Attachment(s) not found: ${missing.join(', ')}`);
  }

  const attachments: EmailAttachment[] = [];
  for (const id of ids) {
    const doc = byId.get(id)!;
    const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.path }));
    const buffer = await streamToBuffer(object.Body as Readable);
    attachments.push({ filename: doc.originalName, content: buffer, contentType: doc.mimeType });
  }
  return attachments;
}
