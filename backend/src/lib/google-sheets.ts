import { getAccessToken, isGoogleConfigured, SHEETS_SCOPE, GoogleNotConfiguredError } from './google-auth';

export class SheetFormula {
  constructor(public readonly text: string) {}
}

export type SheetCell = string | number | null | SheetFormula;

function sanitizeCell(value: SheetCell): string | number | null {
  if (value instanceof SheetFormula) return value.text;
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class GoogleSheetsNotConfiguredError extends GoogleNotConfiguredError {
  constructor() {
    super('Google Sheets');
    this.name = 'GoogleSheetsNotConfiguredError';
  }
}

export function isGoogleSheetsConfigured(): boolean {
  return isGoogleConfigured();
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken(SHEETS_SCOPE);
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

function columnLetter(indexZeroBased: number): string {
  let n = indexZeroBased + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

async function findRowByKey(
  spreadsheetId: string,
  tab: string,
  keyColumnLetter: string,
  key: string,
): Promise<number | null> {
  const range = `${tab}!${keyColumnLetter}2:${keyColumnLetter}`;
  const body = await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  const values = (body?.values ?? []) as string[][];
  for (let i = 0; i < values.length; i += 1) {
    if ((values[i]?.[0] ?? '') === key) return i + 2;
  }
  return null;
}

export async function appendRecord(
  spreadsheetId: string,
  tab: string,
  record: Array<{ header: string; value: SheetCell }>,
  keyHeader?: string,
): Promise<void> {
  const existingHeader = await getFirstRow(spreadsheetId, tab);
  const wanted = record.map((c) => c.header);

  let header = existingHeader.length ? existingHeader.slice() : wanted.slice();

  if (existingHeader.length) {
    const missing = wanted.filter((h) => !header.includes(h));
    if (missing.length) header = header.concat(missing);
  }

  if (!existingHeader.length || header.length !== existingHeader.length) {
    await sheetsFetch(
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [header] }) },
    );
  }

  const byHeader = new Map<string, SheetCell>(record.map((c) => [c.header, c.value]));
  const row = header.map((h) => (byHeader.has(h) ? sanitizeCell(byHeader.get(h) ?? '') : ''));

  let existingRow: number | null = null;
  if (keyHeader) {
    const keyIndex = header.indexOf(keyHeader);
    const keyValue = byHeader.get(keyHeader);
    if (keyIndex !== -1 && typeof keyValue === 'string' && keyValue) {
      existingRow = await findRowByKey(spreadsheetId, tab, columnLetter(keyIndex), keyValue);
    }
  }

  if (existingRow) {
    await sheetsFetch(
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!A${existingRow}`)}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ values: [row] }) },
    );
    return;
  }

  await sheetsFetch(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) },
  );
}
