import { escapeHtml } from '../email/layout';

export const EMAIL_PLACEHOLDERS = ['firstName', 'lastName', 'fullName', 'email'] as const;

export type EmailPlaceholder = (typeof EMAIL_PLACEHOLDERS)[number];

export type PlaceholderValues = Record<EmailPlaceholder, string>;

const PLAIN_PATTERN = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;
const ENCODED_PATTERN = /%7B%7B(?:%20)*([A-Za-z_]+)(?:%20)*%7D%7D/gi;

const BY_LOWERCASE = new Map<string, EmailPlaceholder>(
  EMAIL_PLACEHOLDERS.map((key) => [key.toLowerCase(), key]),
);

function resolve(name: string): EmailPlaceholder | undefined {
  return BY_LOWERCASE.get(name.toLowerCase());
}

export function findUnknownPlaceholders(...texts: Array<string | undefined>): string[] {
  const unknown = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const pattern of [PLAIN_PATTERN, ENCODED_PATTERN]) {
      for (const match of text.matchAll(pattern)) {
        if (!resolve(match[1])) unknown.add(match[1]);
      }
    }
  }
  return [...unknown];
}

export function findKnownPlaceholders(...texts: Array<string | undefined>): EmailPlaceholder[] {
  const known = new Set<EmailPlaceholder>();
  for (const text of texts) {
    if (!text) continue;
    for (const pattern of [PLAIN_PATTERN, ENCODED_PATTERN]) {
      for (const match of text.matchAll(pattern)) {
        const key = resolve(match[1]);
        if (key) known.add(key);
      }
    }
  }
  return [...known];
}

export function placeholderValues(user: { firstName?: string; lastName?: string; email?: string }): PlaceholderValues {
  const firstName = (user.firstName ?? '').trim();
  const lastName = (user.lastName ?? '').trim();
  return {
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(' '),
    email: (user.email ?? '').trim(),
  };
}

export function fillText(text: string, values: PlaceholderValues): string {
  return text.replace(PLAIN_PATTERN, (whole, name: string) => {
    const key = resolve(name);
    return key ? values[key] : whole;
  });
}

export function fillHtml(html: string, values: PlaceholderValues): string {
  return html
    .replace(ENCODED_PATTERN, (whole, name: string) => {
      const key = resolve(name);
      return key ? encodeURIComponent(values[key]) : whole;
    })
    .replace(PLAIN_PATTERN, (whole, name: string) => {
      const key = resolve(name);
      return key ? escapeHtml(values[key]) : whole;
    });
}
