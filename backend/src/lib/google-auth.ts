import { createSign } from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

export class GoogleNotConfiguredError extends Error {
  constructor(what = 'Google') {
    super(`${what} is not configured: set GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY.`);
    this.name = 'GoogleNotConfiguredError';
  }
}

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY);
}

export function serviceAccountEmail(): string | null {
  return process.env.GOOGLE_SA_EMAIL ?? null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function privateKey(): string {
  return (process.env.GOOGLE_SA_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}

const tokenCache = new Map<string, { value: string; expiresAt: number }>();

export async function getAccessToken(scope: string): Promise<string> {
  if (!isGoogleConfigured()) throw new GoogleNotConfiguredError();

  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: process.env.GOOGLE_SA_EMAIL,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(signer.sign(privateKey()))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const body = await res.json().catch(() => ({})) as {
    access_token?: string; expires_in?: number; error_description?: string; error?: string;
  };

  if (!res.ok || !body.access_token) {
    throw new Error(`Google auth failed: ${body.error_description || body.error || res.status}`);
  }

  tokenCache.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}
