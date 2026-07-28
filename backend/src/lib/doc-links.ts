import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_LENGTH = 32;

export function isDocLinkingConfigured(): boolean {
  return !!process.env.DOC_LINK_SECRET;
}

export function signDocToken(docId: string): string | null {
  const secret = process.env.DOC_LINK_SECRET;
  if (!secret) return null;

  return createHmac('sha256', secret).update(String(docId)).digest('hex').slice(0, TOKEN_LENGTH);
}

export function verifyDocToken(docId: string, token: string): boolean {
  const expected = signDocToken(docId);
  if (!expected || !token) return false;

  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildDocLink(docId: string): string | null {
  const token = signDocToken(docId);
  if (!token) return null;

  const base = (process.env.PUBLIC_BASE_URL ?? process.env.ONBOARDING_BASE_URL ?? 'https://nksecurities.com')
    .replace(/\/+$/, '');

  return `${base}/api/docs/view/${encodeURIComponent(String(docId))}?t=${token}`;
}
