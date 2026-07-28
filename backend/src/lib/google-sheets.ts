import { createSign } from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export class GoogleSheetsNotConfiguredError extends Error {
  constructor() {
    super('Google Sheets is not configured: set GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY.');
    this.name = 'GoogleSheetsNotConfiguredError';
  }
}

export function isGoogleSheetsConfigured(): boolean {
  return !!(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY);
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

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (!isGoogleSheetsConfigured()) throw new GoogleSheetsNotConfiguredError();

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: process.env.GOOGLE_SA_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(privateKey()));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const body = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };

  if (!res.ok || !body.access_token) {
    throw new Error(`Google auth failed: ${body.error_description || body.error || res.status}`);
  }

  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const body = await res.json().catch(() => ({})) as any;

  if (!res.ok) {
    const message = body?.error?.message || `Google Sheets API error ${res.status}`;
    if (res.status === 403 || res.status === 404) {
      throw new Error(`${message} - check the spreadsheet is shared with ${process.env.GOOGLE_SA_EMAIL} as an Editor.`);
    }
    throw new Error(message);
  }

  return body;
}

export function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  if (fromUrl) return fromUrl[1];

  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

export interface SpreadsheetInfo {
  title: string;
  tabs: string[];
}

export async function getSpreadsheetInfo(spreadsheetId: string): Promise<SpreadsheetInfo> {
  const body = await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,
  );

  return {
    title: body?.properties?.title ?? 'Untitled spreadsheet',
    tabs: (body?.sheets ?? []).map((s: any) => s?.properties?.title).filter(Boolean),
  };
}

async function getFirstRow(spreadsheetId: string, tab: string): Promise<string[]> {
  const range = `${tab}!1:1`;
  const body = await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  return (body?.values?.[0] ?? []) as string[];
}

export async function appendRow(
  spreadsheetId: string,
  tab: string,
  headers: string[],
  row: (string | number | null)[],
): Promise<void> {
  const existingHeader = await getFirstRow(spreadsheetId, tab);

  if (!existingHeader.length) {
    await sheetsFetch(
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [headers] }) },
    );
  }

  await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) },
  );
}
