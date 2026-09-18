
export const ORG_DOC_TYPE_PREFIX = 'org_relieving_letter_';

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
