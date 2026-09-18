import { getAccessToken, DRIVE_SCOPE, serviceAccountEmail } from './google-auth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveFolder {
  id: string;
  name: string;
  driveId?: string;
  inSharedDrive: boolean;
  webViewLink?: string;
}

export function parseFolderId(input: string): string | null {
  const value = (input ?? '').trim();
  if (!value) return null;

  const fromPath = value.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (fromPath) return fromPath[1];

  const fromQuery = value.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (fromQuery) return fromQuery[1];

  if (/^[a-zA-Z0-9_-]{10,}$/.test(value)) return value;
  return null;
}

async function driveFetch(path: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken(DRIVE_SCOPE);
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });

  const body = await res.json().catch(() => ({})) as any;
  if (!res.ok) {
    const message = body?.error?.message || `Google Drive API error ${res.status}`;
    if (res.status === 403 || res.status === 404) {
      throw new Error(`${message} - check the folder is shared with ${serviceAccountEmail()} as a Content manager or Editor.`);
    }
    throw new Error(message);
  }
  return body;
}

export async function checkFolder(folderId: string): Promise<DriveFolder> {
  const body = await driveFetch(
    `/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,driveId,webViewLink&supportsAllDrives=true`,
  );

  if (body.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('That link points at a file, not a folder.');
  }

  return {
    id: body.id,
    name: body.name,
    driveId: body.driveId,
    inSharedDrive: !!body.driveId,
    webViewLink: body.webViewLink,
  };
}

export interface UploadedFile {
  id: string;
  name: string;
  webViewLink?: string;
}

function multipartBody(metadata: object, mimeType: string, contents: Buffer) {
  const boundary = `nks${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    contents,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { boundary, body };
}

export async function uploadFile(
  folderId: string,
  name: string,
  mimeType: string,
  contents: Buffer,
): Promise<UploadedFile> {
  const token = await getAccessToken(DRIVE_SCOPE);
  const { boundary, body } = multipartBody({ name, parents: [folderId] }, mimeType, contents);

  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  );

  const payload = await res.json().catch(() => ({})) as any;
  if (!res.ok) {
    const message = payload?.error?.message || `Google Drive upload failed (${res.status})`;
    if (/storage quota/i.test(message)) {
      throw new Error(
        'Google refused the upload: a service account has no Drive storage of its own, so the folder has to live in a Shared Drive rather than a personal My Drive.',
      );
    }
    throw new Error(message);
  }

  return { id: payload.id, name: payload.name, webViewLink: payload.webViewLink };
}

export async function updateFile(
  fileId: string,
  name: string,
  mimeType: string,
  contents: Buffer,
): Promise<UploadedFile> {
  const token = await getAccessToken(DRIVE_SCOPE);
  const { boundary, body } = multipartBody({ name }, mimeType, contents);

  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  );

  const payload = await res.json().catch(() => ({})) as any;
  if (!res.ok) throw new Error(payload?.error?.message || `Google Drive update failed (${res.status})`);
  return { id: payload.id, name: payload.name, webViewLink: payload.webViewLink };
}
