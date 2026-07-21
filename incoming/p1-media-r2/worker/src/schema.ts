// Metadata schema — the single source of truth for which metadata fields exist.
//
// R13: for v1 the schema is Pantheon-defined and global (one set of fields for all
// sites). This is NOT a ceiling baked into the DB — storage is a schemaless JSON blob,
// so customer-defined / per-org schemas remain a later additive change.
// R12: METADATA_SCHEMA_VERSION is stamped onto each asset and copied into each
// placement, so a later field-set change can migrate old placements deterministically.
// R6: per-field length and field-count caps bound what PATCH will accept.

export interface MetadataField {
  name: string;
  label: string;
  type: 'string';
  required?: boolean;
}

// Bump when the field set changes in a way that later migrations must distinguish.
export const METADATA_SCHEMA_VERSION = 1;

// `alt` is served in its own promoted column (indexed search) but is part of the
// advertised schema like any other field.
export const METADATA_SCHEMA: MetadataField[] = [
  { name: 'alt', label: 'Alt text', type: 'string' },
  { name: 'caption', label: 'Caption', type: 'string' },
  { name: 'credit', label: 'Credit', type: 'string' },
  { name: 'byline', label: 'Byline', type: 'string' },
];

// R6 caps.
export const MAX_METADATA_FIELD_BYTES = 2000;
export const MAX_METADATA_FIELDS = 32;

const ALLOWED_FIELDS = new Set(METADATA_SCHEMA.map((f) => f.name));

export interface MetadataValidation {
  ok: boolean;
  error?: string;
}

/**
 * Validates a metadata patch against the schema (R13) and caps (R6).
 * Accepts only advertised string fields within the byte/count limits. `null`
 * clears a field. Returns the first violation rather than collecting all.
 */
export function validateMetadata(input: Record<string, unknown>): MetadataValidation {
  const keys = Object.keys(input);
  if (keys.length > MAX_METADATA_FIELDS) {
    return { ok: false, error: `Too many metadata fields (max ${MAX_METADATA_FIELDS})` };
  }
  for (const key of keys) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: `Unknown metadata field: ${key}` };
    }
    const value = input[key];
    if (value === null || value === undefined) continue; // null clears the field
    if (typeof value !== 'string') {
      return { ok: false, error: `Metadata field "${key}" must be a string` };
    }
    if (new TextEncoder().encode(value).length > MAX_METADATA_FIELD_BYTES) {
      return { ok: false, error: `Metadata field "${key}" exceeds ${MAX_METADATA_FIELD_BYTES} bytes` };
    }
  }
  return { ok: true };
}
