import { EmailAddress } from '../email/base.email';

export function defaultOnboardingCc(): string[] {
  return splitAddresses(process.env.ONBOARDING_DEFAULT_CC);
}

export function splitAddresses(value?: string | string[] | null): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(/[,;]+/);
  return list.map((v) => String(v).trim()).filter(Boolean);
}

export function buildCc(
  lists: Array<string | string[] | undefined | null>,
  exclude?: string,
): EmailAddress[] | undefined {
  const seen = new Set<string>();
  if (exclude) seen.add(exclude.trim().toLowerCase());

  const out: EmailAddress[] = [];
  for (const list of lists) {
    for (const address of splitAddresses(list)) {
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ address });
    }
  }

  return out.length ? out : undefined;
}
