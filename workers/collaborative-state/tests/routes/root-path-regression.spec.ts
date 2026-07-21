/**
 * Regression Tests for Root Path "/" Handling
 *
 * Tests that document path "/" (root/home page) is properly handled
 * throughout the routing, normalization, and storage layers.
 *
 * Regression for: PCC-3269 - Managing the root home page "/" in CSS
 */

import { describe, it, expect } from 'vitest';
import { normalizePath, validatePath } from '../../src/services/document-types';
import { parseRoute } from '../../src/routes/route-parser';

describe('Root Path "/" Handling', () => {
  describe('Path Normalization', () => {
    it('should normalize "/" to "/"', () => {
      const normalized = normalizePath('/');
      expect(normalized).toBe('/');
    });

    it('should normalize empty string to "/"', () => {
      const normalized = normalizePath('');
      expect(normalized).toBe('/');
    });

    it('should normalize "//" to "/"', () => {
      const normalized = normalizePath('//');
      expect(normalized).toBe('/');
    });

    it('should normalize "///" to "/"', () => {
      const normalized = normalizePath('///');
      expect(normalized).toBe('/');
    });

    it('should normalize regular paths correctly', () => {
      expect(normalizePath('/about')).toBe('about');
      expect(normalizePath('about/')).toBe('about');
      expect(normalizePath('/about/')).toBe('about');
      expect(normalizePath('products/item')).toBe('products/item');
    });
  });

  describe('Path Validation', () => {
    it('should accept "/" as valid', () => {
      expect(() => { validatePath('/'); }).not.toThrow();
    });

    it('should accept regular paths as valid', () => {
      expect(() => { validatePath('about'); }).not.toThrow();
      expect(() => { validatePath('products/item'); }).not.toThrow();
    });

    it('should reject paths with traversal sequences', () => {
      expect(() => { validatePath('../etc'); }).toThrow();
      expect(() => { validatePath('products/../etc'); }).toThrow();
    });
  });

  describe('Route Parsing - by-path endpoint', () => {
    const siteId = '550e8400-e29b-41d4-a716-446655440000';

    it('should parse /documents/by-path/ as root path "/"', () => {
      const route = parseRoute(`/api/sites/${siteId}/documents/by-path/`);
      expect(route).not.toBeNull();
      expect(route?.handler).toBe('documents');
      expect(route?.params.siteId).toBe(siteId);
      expect(route?.params.documentPath).toBe('/');
    });

    it('should parse /documents/by-path/about as "about"', () => {
      const route = parseRoute(`/api/sites/${siteId}/documents/by-path/about`);
      expect(route).not.toBeNull();
      expect(route?.handler).toBe('documents');
      expect(route?.params.documentPath).toBe('about');
    });

    it('should parse /documents/by-path/products%2Fitem with URL encoding', () => {
      const route = parseRoute(`/api/sites/${siteId}/documents/by-path/products%2Fitem`);
      expect(route).not.toBeNull();
      expect(route?.handler).toBe('documents');
      expect(route?.params.documentPath).toBe('products/item');
    });

    it('should NOT match /documents/by-path without trailing slash to generic document route', () => {
      // This would be malformed - by-path requires the trailing slash or path segment
      const route = parseRoute(`/api/sites/${siteId}/documents/by-path`);
      // Should match a different route or return null
      if (route !== null) {
        // If it matches, it should NOT have documentPath set to "by-path"
        expect(route.params.documentId).not.toBe('by-path');
      }
    });
  });

  describe('Route Parsing - POST /documents (create)', () => {
    const siteId = '550e8400-e29b-41d4-a716-446655440000';
    const branchId = '660e8400-e29b-41d4-a716-446655440000';

    it('should parse POST /branches/{branchId}/documents correctly', () => {
      const route = parseRoute(`/api/sites/${siteId}/branches/${branchId}/documents`);
      expect(route).not.toBeNull();
      expect(route?.handler).toBe('documents');
      expect(route?.params.siteId).toBe(siteId);
      expect(route?.params.branchId).toBe(branchId);
      expect(route?.params.documentId).toBeUndefined();
    });
  });

  describe('Route Parsing - content delivery endpoint', () => {
    const siteId = '550e8400-e29b-41d4-a716-446655440000';

    it('should parse /content/ (trailing slash) as root path "/"', () => {
      const route = parseRoute(`/api/sites/${siteId}/content/`);
      expect(route).not.toBeNull();
      expect(route?.handler).toBe('content');
      expect(route?.params.siteId).toBe(siteId);
      expect(route?.params.documentPath).toBe('/');
      expect(route?.params.action).toBe('content');
    });

    it('should parse /content (no trailing slash, no path) as root path "/"', () => {
      const route = parseRoute(`/api/sites/${siteId}/content`);
      expect(route).not.toBeNull();
      expect(route?.handler).toBe('content');
      expect(route?.params.documentPath).toBe('/');
      expect(route?.params.action).toBe('content');
    });

    it('should parse /content/about as "about"', () => {
      const route = parseRoute(`/api/sites/${siteId}/content/about`);
      expect(route).not.toBeNull();
      expect(route?.handler).toBe('content');
      expect(route?.params.documentPath).toBe('about');
      expect(route?.params.action).toBe('content');
    });

    it('should parse /content/products/landing as nested path', () => {
      const route = parseRoute(`/api/sites/${siteId}/content/products/landing`);
      expect(route).not.toBeNull();
      expect(route?.handler).toBe('content');
      expect(route?.params.documentPath).toBe('products/landing');
      expect(route?.params.action).toBe('content');
    });

    it('should NOT intercept /content-pages (route ordering guard)', () => {
      const route = parseRoute(`/api/sites/${siteId}/content-pages`);
      expect(route).not.toBeNull();
      expect(route?.handler).toBe('content');
      expect(route?.params.action).toBe('content-pages');
      expect(route?.params.documentPath).toBeUndefined();
    });
  });

  describe('End-to-End Path Flow', () => {
    it('should handle full create-and-fetch flow for root path', () => {
      // 1. User sends {"path": "/"}
      const userPath = '/';

      // 2. normalizePath converts "/" to "/"
      const normalized = normalizePath(userPath);
      expect(normalized).toBe('/');

      // 3. validatePath accepts "/"
      expect(() => { validatePath(normalized); }).not.toThrow();

      // 4. Document is stored in DB with path "/"
      const storedPath = normalized;
      expect(storedPath).toBe('/');

      // 5. User fetches via GET /documents/by-path/
      const fetchRoute = parseRoute(`/api/sites/${siteId}/documents/by-path/`);
      expect(fetchRoute?.params.documentPath).toBe('/');

      // 6. normalizePath keeps "/" as-is
      const fetchNormalized = normalizePath(fetchRoute?.params.documentPath ?? '/');
      expect(fetchNormalized).toBe('/');

      // 7. Query matches: WHERE path = '/'
      expect(storedPath).toBe(fetchNormalized);
    });

    it('should handle create-and-delivery flow for root path via content API', () => {
      const userPath = '/';
      const normalized = normalizePath(userPath);
      expect(normalized).toBe('/');

      const storedPath = normalized;

      // Client fetches via GET /content/ (content delivery API)
      const deliveryRoute = parseRoute(`/api/sites/${siteId}/content/`);
      expect(deliveryRoute?.handler).toBe('content');
      expect(deliveryRoute?.params.documentPath).toBe('/');

      // The stored path and the delivery path must agree
      expect(storedPath).toBe(deliveryRoute?.params.documentPath);
    });

    it('should handle full create-and-fetch flow for regular path', () => {
      const userPath = '/products/item';
      const normalized = normalizePath(userPath);
      expect(normalized).toBe('products/item');

      validatePath(normalized);
      const storedPath = normalized;

      const fetchRoute = parseRoute(`/api/sites/${siteId}/documents/by-path/products%2Fitem`);
      const fetchNormalized = normalizePath(fetchRoute?.params.documentPath ?? '/');
      expect(fetchNormalized).toBe('products/item');
      expect(storedPath).toBe(fetchNormalized);
    });

    const siteId = '550e8400-e29b-41d4-a716-446655440000';
  });
});
