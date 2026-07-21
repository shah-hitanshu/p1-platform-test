/**
 * Route Parser - Document Presence Route Tests
 *
 * Regression tests ensuring document presence URLs are correctly parsed.
 */

import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';

describe('parseRoute - document presence', () => {
  it('should parse document presence route with simple path', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/documents/home/presence');

    expect(result).not.toBeNull();
    expect(result?.handler).toBe('presence');
    expect(result?.params.siteId).toBe('site-1');
    expect(result?.params.branchId).toBe('branch-1');
    expect(result?.params.documentPath).toBe('home');
  });

  it('should parse document presence route with encoded nested path', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/documents/products%2Fwidgets/presence');

    expect(result).not.toBeNull();
    expect(result?.handler).toBe('presence');
    expect(result?.params.documentPath).toBe('products%2Fwidgets');
  });

  it('should parse document presence route with multi-segment path', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/documents/content/pages/about/presence');

    expect(result).not.toBeNull();
    expect(result?.handler).toBe('presence');
    expect(result?.params.documentPath).toBe('content/pages/about');
  });

  it('should still parse branch presence route correctly', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/presence');

    expect(result).not.toBeNull();
    expect(result?.handler).toBe('presence');
    expect(result?.params.siteId).toBe('site-1');
    expect(result?.params.branchId).toBe('branch-1');
    expect(result?.params.documentPath).toBeUndefined();
  });

  it('should still parse site presence route correctly', () => {
    const result = parseRoute('/api/sites/site-1/presence');

    expect(result).not.toBeNull();
    expect(result?.handler).toBe('presence');
    expect(result?.params.siteId).toBe('site-1');
    expect(result?.params.branchId).toBeUndefined();
  });

  it('should not confuse document presence with realtime actions', () => {
    // 'edits' is a realtime action, not a presence route
    const result = parseRoute('/api/sites/site-1/branches/branch-1/documents/home/edits');

    expect(result).not.toBeNull();
    expect(result?.handler).toBe('realtime');
  });
});
