import { describe, it, expect } from 'vitest';
import {
  validateMetadata,
  MAX_METADATA_FIELD_BYTES,
  MAX_METADATA_FIELDS,
} from '../schema';

// validateMetadata is the write-path guard: it is the ONLY thing standing between
// an untrusted PATCH/upload body and the store. Its job is R13 (only advertised
// fields) and R6 (bounded per-field bytes + field count). Each test encodes which
// invariant it protects, not just the boolean it returns.

describe('validateMetadata', () => {
  it('accepts the advertised string fields', () => {
    expect(
      validateMetadata({ alt: 'a photo', caption: 'nice', credit: 'me', byline: 'staff' }),
    ).toEqual({ ok: true });
  });

  it('rejects an unknown field name so callers cannot smuggle arbitrary keys into storage (R13)', () => {
    const result = validateMetadata({ notAField: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown metadata field');
  });

  it('rejects a value larger than the per-field byte cap (R6)', () => {
    const result = validateMetadata({ alt: 'a'.repeat(MAX_METADATA_FIELD_BYTES + 1) });
    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(MAX_METADATA_FIELD_BYTES));
  });

  it('accepts a value exactly at the byte cap (boundary is inclusive)', () => {
    expect(validateMetadata({ alt: 'a'.repeat(MAX_METADATA_FIELD_BYTES) })).toEqual({ ok: true });
  });

  it('measures the cap in BYTES not characters, so multi-byte input under the char count still fails (R6)', () => {
    // '€' is 3 UTF-8 bytes. 1000 chars = 3000 bytes > 2000, even though 1000 < 2000 chars.
    const result = validateMetadata({ alt: '€'.repeat(1000) });
    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(MAX_METADATA_FIELD_BYTES));
  });

  it('rejects more than the max number of fields (R6)', () => {
    const tooMany: Record<string, string> = {};
    for (let i = 0; i <= MAX_METADATA_FIELDS; i++) tooMany[`field${i}`] = 'v';
    const result = validateMetadata(tooMany);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Too many metadata fields');
  });

  it('ignores null values — null is a clear, not a violation', () => {
    expect(validateMetadata({ alt: null })).toEqual({ ok: true });
    expect(validateMetadata({ alt: null, caption: 'kept' })).toEqual({ ok: true });
  });

  it('rejects a non-string, non-null value', () => {
    const result = validateMetadata({ alt: 123 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('must be a string');
  });
});
