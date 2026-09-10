export enum ExtraFieldType {
  Text = 'text',
  Textarea = 'textarea',
  Number = 'number',
  Date = 'date',
  Select = 'select',
  Checkbox = 'checkbox',
  Document = 'document',
}

export interface ExtraFieldDef {
  key: string;
  label: string;
  type: ExtraFieldType;
  required: boolean;
  help?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: string[];
}

export const MAX_EXTRA_FIELDS = 15;
const MAX_LABEL_LENGTH = 120;
const DEFAULT_TEXT_MAX = 500;
const ABSOLUTE_TEXT_MAX = 5000;

export const extraFieldName = (key: string) => `extra_${key}`;

export const EXTRA_DOC_TYPE_PREFIX = 'extra_';
export const isExtraDocType = (docType: string) => docType.startsWith(EXTRA_DOC_TYPE_PREFIX);
export const extraDocKey = (docType: string) => docType.slice(EXTRA_DOC_TYPE_PREFIX.length);

export function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export class ExtraFieldError extends Error {}

export function normalizeExtraFields(input: unknown): ExtraFieldDef[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new ExtraFieldError('extraFields must be a list.');
  if (input.length > MAX_EXTRA_FIELDS) {
    throw new ExtraFieldError(`At most ${MAX_EXTRA_FIELDS} extra fields are allowed.`);
  }

  const seen = new Set<string>();
  const out: ExtraFieldDef[] = [];

  for (const raw of input) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const label = String(item.label ?? '').trim();

    if (!label) throw new ExtraFieldError('Every extra field needs a name.');
    if (label.length > MAX_LABEL_LENGTH) {
      throw new ExtraFieldError(`"${label.slice(0, 30)}…" is too long for a field name.`);
    }

    const type = String(item.type ?? '') as ExtraFieldType;
    if (!Object.values(ExtraFieldType).includes(type)) {
      throw new ExtraFieldError(`"${label}" has an unknown field type.`);
    }

    let key = slugifyKey(label);
    if (!key) throw new ExtraFieldError(`"${label}" doesn't contain any usable characters.`);
    let suffix = 2;
    while (seen.has(key)) key = `${slugifyKey(label)}_${suffix++}`;
    seen.add(key);

    const def: ExtraFieldDef = {
      key,
      label,
      type,
      required: item.required === true,
      help: item.help ? String(item.help).trim().slice(0, 200) : undefined,
    };

    if (type === ExtraFieldType.Text || type === ExtraFieldType.Textarea) {
      const maxLength = Number(item.maxLength);
      def.maxLength = Number.isFinite(maxLength) && maxLength > 0
        ? Math.min(Math.floor(maxLength), ABSOLUTE_TEXT_MAX)
        : DEFAULT_TEXT_MAX;
    }

    if (type === ExtraFieldType.Number) {
      if (item.min !== undefined && item.min !== null && item.min !== '') {
        const min = Number(item.min);
        if (!Number.isFinite(min)) throw new ExtraFieldError(`"${label}" has an invalid minimum.`);
        def.min = min;
      }
      if (item.max !== undefined && item.max !== null && item.max !== '') {
        const max = Number(item.max);
        if (!Number.isFinite(max)) throw new ExtraFieldError(`"${label}" has an invalid maximum.`);
        def.max = max;
      }
      if (def.min !== undefined && def.max !== undefined && def.min > def.max) {
        throw new ExtraFieldError(`"${label}" has a minimum above its maximum.`);
      }
    }

    if (type === ExtraFieldType.Select) {
      const options = Array.isArray(item.options)
        ? item.options.map((o) => String(o).trim()).filter(Boolean)
        : String(item.options ?? '').split('\n').map((o) => o.trim()).filter(Boolean);
      if (options.length < 2) throw new ExtraFieldError(`"${label}" needs at least two choices.`);
      def.options = Array.from(new Set(options)).slice(0, 50);
    }

    out.push(def);
  }

  return out;
}

export type ExtraValidation = { ok: true; value: unknown } | { ok: false; error: string };


export function validateExtraValue(def: ExtraFieldDef, value: unknown): ExtraValidation {
  const empty = value === undefined || value === null || value === '';

  if (def.type === ExtraFieldType.Document) {
    if (empty) {
      return def.required
        ? { ok: false, error: 'This document is required' }
        : { ok: true, value: undefined };
    }
    return { ok: false, error: 'Upload this document instead of typing a value' };
  }

  if (def.type === ExtraFieldType.Checkbox) {
    const checked = value === true || value === 'true';
    if (def.required && !checked) return { ok: false, error: 'This must be ticked' };
    return { ok: true, value: checked };
  }

  if (empty) {
    if (def.required) return { ok: false, error: 'Cannot be empty' };
    return { ok: true, value: undefined };
  }

  switch (def.type) {
    case ExtraFieldType.Text:
    case ExtraFieldType.Textarea: {
      if (typeof value !== 'string') return { ok: false, error: 'Must be text' };
      const trimmed = value.trim();
      const max = def.maxLength ?? DEFAULT_TEXT_MAX;
      if (trimmed.length > max) return { ok: false, error: `Max ${max} characters` };
      return { ok: true, value: trimmed };
    }

    case ExtraFieldType.Number: {
      const num = Number(value);
      if (!Number.isFinite(num)) return { ok: false, error: 'Must be a number' };
      if (def.min !== undefined && num < def.min) return { ok: false, error: `Must be at least ${def.min}` };
      if (def.max !== undefined && num > def.max) return { ok: false, error: `Must be at most ${def.max}` };
      return { ok: true, value: num };
    }

    case ExtraFieldType.Date: {
      const text = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
        return { ok: false, error: 'Must be a valid date' };
      }
      return { ok: true, value: text };
    }

    case ExtraFieldType.Select: {
      const text = String(value).trim();
      if (!def.options?.includes(text)) return { ok: false, error: 'Not one of the choices' };
      return { ok: true, value: text };
    }

    default:
      return { ok: false, error: 'Unsupported field type' };
  }
}
