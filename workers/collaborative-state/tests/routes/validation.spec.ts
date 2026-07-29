/**
 * Tests for API Route Validation Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validatePagination,
  validateJsonSize,
  estimateJsonSize,
  PAGINATION,
  SIZE_LIMITS,
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
});
