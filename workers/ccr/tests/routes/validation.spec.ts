/**
 * Tests for API Route Validation Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validatePagination,
  validateJsonSize,
  estimateJsonSize,
  validateAllowedOriginPatterns,
  PAGINATION,
  SIZE_LIMITS,
  MAX_ALLOWED_ORIGINS,
} from '../../src/routes/validation';

describe('API Route Validation', () => {
  describe('validatePagination', () => {
    it('should accept valid limit and offset', () => {
      const result = validatePagination('10', '20');
      expect(result.valid).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });

    it('should accept null parameters', () => {
      const result = validatePagination(null, null);
      expect(result.valid).toBe(true);
      expect(result.limit).toBeUndefined();
      expect(result.offset).toBeUndefined();
    });

    it('should accept only limit', () => {
      const result = validatePagination('50', null);
      expect(result.valid).toBe(true);
      expect(result.limit).toBe(50);
      expect(result.offset).toBeUndefined();
    });

    it('should accept only offset', () => {
      const result = validatePagination(null, '100');
      expect(result.valid).toBe(true);
      expect(result.limit).toBeUndefined();
      expect(result.offset).toBe(100);
    });

    it('should reject non-numeric limit', () => {
      const result = validatePagination('abc', null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('limit must be a valid number');
    });

    it('should reject non-numeric offset', () => {
      const result = validatePagination(null, 'xyz');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('offset must be a valid number');
    });

    it('should reject limit below minimum', () => {
      const result = validatePagination('0', null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('limit must be at least');
    });

    it('should reject limit exceeding MAX_LIMIT', () => {
      const result = validatePagination('500', null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('limit cannot exceed');
    });

    it('should reject limit at MAX_LIMIT+1', () => {
      const result = validatePagination('101', null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('limit cannot exceed');
    });

    it('should reject negative offset', () => {
      const result = validatePagination(null, '-1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('offset must be at least');
    });

    it('should accept limit at maximum boundary', () => {
      const result = validatePagination(String(PAGINATION.MAX_LIMIT), null);
      expect(result.valid).toBe(true);
      expect(result.limit).toBe(PAGINATION.MAX_LIMIT);
    });

    it('should accept limit at minimum boundary', () => {
      const result = validatePagination(String(PAGINATION.MIN_LIMIT), null);
      expect(result.valid).toBe(true);
      expect(result.limit).toBe(PAGINATION.MIN_LIMIT);
    });

    it('should accept offset at zero', () => {
      const result = validatePagination(null, '0');
      expect(result.valid).toBe(true);
      expect(result.offset).toBe(0);
    });
  });

  describe('estimateJsonSize', () => {
    it('should calculate size of simple object', () => {
      const obj = { key: 'value' };
      const size = estimateJsonSize(obj);
      expect(size).toBe(JSON.stringify(obj).length);
    });

    it('should calculate size of empty object', () => {
      const size = estimateJsonSize({});
      expect(size).toBe(2); // '{}'
    });

    it('should calculate size of nested object', () => {
      const obj = { a: { b: { c: 'deep' } } };
      const size = estimateJsonSize(obj);
      expect(size).toBe(JSON.stringify(obj).length);
    });

    it('should calculate size of array', () => {
      const arr = [1, 2, 3];
      const size = estimateJsonSize(arr);
      expect(size).toBe(JSON.stringify(arr).length);
    });
  });

  describe('validateJsonSize', () => {
    it('should accept object within size limit', () => {
      const obj = { key: 'value' };
      const result = validateJsonSize(obj, 1000, 'testField');
      expect(result).toBeUndefined();
    });

    it('should accept null object', () => {
      const result = validateJsonSize(null, 1000, 'testField');
      expect(result).toBeUndefined();
    });

    it('should accept undefined object', () => {
      const result = validateJsonSize(undefined, 1000, 'testField');
      expect(result).toBeUndefined();
    });

    it('should reject object exceeding size limit', () => {
      // Create object that exceeds 100 bytes
      const obj = { data: 'x'.repeat(200) };
      const result = validateJsonSize(obj, 100, 'testField');
      expect(result).toBeDefined();
      expect(result).toContain('testField');
      expect(result).toContain('exceeds maximum size');
    });

    it('should include field name in error message', () => {
      const obj = { data: 'x'.repeat(200) };
      const result = validateJsonSize(obj, 100, 'myCustomField');
      expect(result).toContain('myCustomField');
    });

    it('should work with schema size limit', () => {
      // Schema under limit should pass
      const smallSchema = { type: 'object', properties: {} };
      const result = validateJsonSize(
        smallSchema,
        SIZE_LIMITS.MAX_SCHEMA_SIZE_BYTES,
        'schema',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('PAGINATION constants', () => {
    it('should have expected max limit', () => {
      expect(PAGINATION.MAX_LIMIT).toBe(100);
    });

    it('should have expected min limit', () => {
      expect(PAGINATION.MIN_LIMIT).toBe(1);
    });

    it('should have expected min offset', () => {
      expect(PAGINATION.MIN_OFFSET).toBe(0);
    });

    it('should have expected default limit', () => {
      expect(PAGINATION.DEFAULT_LIMIT).toBe(20);
    });
  });

  describe('SIZE_LIMITS constants', () => {
    it('should have expected schema size limit', () => {
      expect(SIZE_LIMITS.MAX_SCHEMA_SIZE_BYTES).toBe(64 * 1024);
    });

    it('should have expected metadata size limit', () => {
      expect(SIZE_LIMITS.MAX_METADATA_SIZE_BYTES).toBe(64 * 1024);
    });
  });

  // PCC-3531: these patterns gate CORS today and are intended to gate redirect
  // URIs. A silently-dropped entry is worse than a rejection — the site looks
  // configured and is not.
  describe('validateAllowedOriginPatterns', () => {
    describe('accepts valid patterns', () => {
      it('accepts an exact https origin', () => {
        expect(validateAllowedOriginPatterns(['https://example.com'])).toBeUndefined();
      });

      it('accepts an http origin with a port (local development)', () => {
        expect(validateAllowedOriginPatterns(['http://localhost:3000'])).toBeUndefined();
      });

      // The Pantheon branch-URL case this whole feature exists to serve: one
      // pattern covering live/dev/test and every future multidev.
      it('accepts a wildcard label prefix on a Pantheon branch host', () => {
        expect(
          validateAllowedOriginPatterns(['https://*-mysite.pantheonsite.io']),
        ).toBeUndefined();
      });

      it('accepts a wildcard occupying an entire subdomain label', () => {
        expect(validateAllowedOriginPatterns(['https://*.example.com'])).toBeUndefined();
      });

      it('accepts multiple valid entries together', () => {
        expect(
          validateAllowedOriginPatterns([
            'https://www.example.com',
            'https://*-mysite.pantheonsite.io',
          ]),
        ).toBeUndefined();
      });

      it('accepts an empty list (clearing all origins)', () => {
        expect(validateAllowedOriginPatterns([])).toBeUndefined();
      });
    });

    describe('rejects patterns that parseOriginPatterns would silently drop', () => {
      // The form migration 031's comment and the retired SPA placeholder taught.
      it('rejects a protocol-less pattern and names the offending entry', () => {
        const error = validateAllowedOriginPatterns(['*-mysite.pantheonsite.io']);
        expect(error).toBeDefined();
        expect(error).toContain('*-mysite.pantheonsite.io');
        expect(error).toContain('https://');
      });

      it('rejects a protocol-less exact host', () => {
        expect(validateAllowedOriginPatterns(['example.com'])).toBeDefined();
      });

      it('rejects a non-http protocol', () => {
        expect(validateAllowedOriginPatterns(['ftp://example.com'])).toBeDefined();
      });

      it('rejects more than one wildcard', () => {
        expect(validateAllowedOriginPatterns(['https://*.*.example.com'])).toBeDefined();
      });
    });

    describe('rejects over-broad patterns', () => {
      // Compiles to ^https://[a-zA-Z0-9-]+\.com$ — matches https://evil.com.
      it('rejects a wildcard in the public-suffix position', () => {
        const error = validateAllowedOriginPatterns(['https://*.com']);
        expect(error).toBeDefined();
        expect(error).toContain('https://*.com');
      });

      it('rejects a bare wildcard that would allow every origin', () => {
        expect(validateAllowedOriginPatterns(['*'])).toBeDefined();
      });

      it('rejects a wildcard that is not in the leftmost label', () => {
        expect(validateAllowedOriginPatterns(['https://foo.*.example.com'])).toBeDefined();
      });
    });

    describe('rejects entries that can never match an Origin header', () => {
      // An Origin header never has a path, so these are dead rows.
      it('rejects an entry with a path', () => {
        expect(validateAllowedOriginPatterns(['https://example.com/callback'])).toBeDefined();
      });

      it('rejects an entry with a trailing slash', () => {
        expect(validateAllowedOriginPatterns(['https://example.com/'])).toBeDefined();
      });

      it('rejects an entry with a query string', () => {
        expect(validateAllowedOriginPatterns(['https://example.com?a=b'])).toBeDefined();
      });

      it('rejects an empty-string entry', () => {
        expect(validateAllowedOriginPatterns([''])).toBeDefined();
      });
    });

    // Readers join the array with commas before parsing. Rejected outright as a
    // security-review follow-up (e63a0d67): the exploitable form was blocked
    // only incidentally by the no-path rule, and there is no legitimate use case
    // for a comma inside a single entry — each origin is its own array entry.
    // Splitting a comma-joined entry instead of rejecting it would let one API
    // call smuggle several origins in behind what looks like one entry, so this
    // stays a hard rejection even though the dashboard now splits a pasted list
    // client-side before it ever reaches this function (see
    // pantheon-content-cloud's allowed-origins-section.tsx addOrigin).
    describe('rejects commas, which are a pattern separator downstream', () => {
      it('rejects an entry containing a comma', () => {
        const error = validateAllowedOriginPatterns(['https://a.example,https://b.example']);
        expect(error).toBeDefined();
        expect(error).toContain('comma');
      });

      it('rejects a comma even when the second half is not a usable pattern', () => {
        expect(validateAllowedOriginPatterns(['https://a.example,b.example'])).toBeDefined();
      });

      it('rejects a trailing comma', () => {
        expect(validateAllowedOriginPatterns(['https://a.example,'])).toBeDefined();
      });

      it('still accepts the same origins as separate entries', () => {
        expect(
          validateAllowedOriginPatterns(['https://a.example', 'https://b.example']),
        ).toBeUndefined();
      });

      // A legacy comma row stays editable.
      it('tolerates a stored entry that already contains a comma', () => {
        const legacy = ['https://a.example,https://b.example'];
        expect(validateAllowedOriginPatterns(legacy, legacy)).toBeUndefined();
      });
    });

    // Nick's review feedback on #232: surface every problem at once rather than
    // making the caller fix one issue, resubmit, and discover the next.
    describe('accumulates every validation failure into one message', () => {
      it('reports every applicable reason for a single entry, not just the first', () => {
        // Carries a path AND sits on the public suffix: two independent problems.
        const error = validateAllowedOriginPatterns(['https://*.com/callback']);
        expect(error).toBeDefined();
        expect(error).toContain('must be an origin only');
        expect(error).toContain('too broad');
      });

      it('reports failures for every invalid entry, not just the first', () => {
        const error = validateAllowedOriginPatterns(['bad-one.example', 'https://*.com']);
        expect(error).toBeDefined();
        expect(error).toContain('bad-one.example');
        expect(error).toContain('https://*.com');
      });
    });

    describe('enforces the pattern cap', () => {
      it('accepts exactly MAX_ALLOWED_ORIGINS entries', () => {
        const entries = Array.from(
          { length: MAX_ALLOWED_ORIGINS },
          (_unused, i) => 'https://site' + String(i) + '.example.com',
        );
        expect(validateAllowedOriginPatterns(entries)).toBeUndefined();
      });

      it('rejects one entry beyond the cap', () => {
        const entries = Array.from(
          { length: MAX_ALLOWED_ORIGINS + 1 },
          (_unused, i) => 'https://site' + String(i) + '.example.com',
        );
        expect(validateAllowedOriginPatterns(entries)).toBeDefined();
      });
    });

    // Callers resend the whole array on every change, so validating all of it
    // would leave a site holding a legacy invalid row unable to remove it.
    describe('diff-scoping against already-stored origins', () => {
      const legacy = ['*-mysite.pantheonsite.io', 'https://*.com'];

      it('accepts an unchanged resend of stored invalid entries', () => {
        expect(validateAllowedOriginPatterns(legacy, legacy)).toBeUndefined();
      });

      it('accepts removing an entry from a list of stored invalid entries', () => {
        expect(
          validateAllowedOriginPatterns(['*-mysite.pantheonsite.io'], legacy),
        ).toBeUndefined();
      });

      it('accepts adding a valid entry alongside stored invalid entries', () => {
        expect(
          validateAllowedOriginPatterns([...legacy, 'https://new.example.com'], legacy),
        ).toBeUndefined();
      });

      it('rejects a newly added invalid entry, naming only the new one', () => {
        const error = validateAllowedOriginPatterns([...legacy, 'bad.example.com'], legacy);
        expect(error).toBeDefined();
        expect(error).toContain('bad.example.com');
        expect(error).not.toContain('*-mysite.pantheonsite.io');
      });

      it('validates every entry when nothing is stored yet', () => {
        expect(validateAllowedOriginPatterns(legacy, [])).toBeDefined();
      });

      it('treats an undefined stored list as nothing stored', () => {
        expect(validateAllowedOriginPatterns(legacy, undefined)).toBeDefined();
      });
    });
  });
});
