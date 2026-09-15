// Relieving letters are per previous organization, so one onboarding can hold
// several of them. Docs are keyed by { onboardingKey, docType }, so each org's
// letter needs its own docType: the prefix below plus the org's client-issued
// id. Same shape as the extra-field document types in lib/extra-fields.ts.

export const ORG_DOC_TYPE_PREFIX = 'org_relieving_letter_';

/** Ids are minted by the form, so the only thing worth asserting is the shape. */
export const ORG_ID_PATTERN = /^[a-z0-9]{8,32}$/;

export function isOrgDocType(docType: string): boolean {
  if (!docType.startsWith(ORG_DOC_TYPE_PREFIX)) return false;
  return ORG_ID_PATTERN.test(docType.slice(ORG_DOC_TYPE_PREFIX.length));
}

export function orgDocId(docType: string): string {
  return docType.slice(ORG_DOC_TYPE_PREFIX.length);
}

export function orgDocType(orgId: string): string {
  return ORG_DOC_TYPE_PREFIX + orgId;
}
