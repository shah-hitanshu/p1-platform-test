/**
 * Route Parser - Redirect Route Tests
 *
 * Tests ensuring redirect URLs are correctly parsed.
 */

import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';

describe('parseRoute - redirect routes', () => {
  it('should parse redirects list route', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/redirects');
    expect(result).toEqual({
      handler: 'redirects',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
      },
    });
  });

  it('should parse redirect by ID route', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/redirects/redir-uuid');
    expect(result).toEqual({
      handler: 'redirects',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        redirectId: 'redir-uuid',
      },
    });
  });

  it('should parse redirect with UUID ID', () => {
    const result = parseRoute('/api/sites/site-1/branches/b0000000-0000-0000-0000-000000000001/redirects/a1234567-89ab-cdef-0123-456789abcdef');
    expect(result).toEqual({
      handler: 'redirects',
      params: {
        siteId: 'site-1',
        branchId: 'b0000000-0000-0000-0000-000000000001',
        redirectId: 'a1234567-89ab-cdef-0123-456789abcdef',
      },
    });
  });

  it('should parse content-redirects lookup route', () => {
    const result = parseRoute('/api/sites/site-1/content-redirects/old-page');
    expect(result).toEqual({
      handler: 'content-redirects',
      params: {
        siteId: 'site-1',
        documentPath: 'old-page',
      },
    });
  });

  it('should parse content-redirects with nested path', () => {
    const result = parseRoute('/api/sites/site-1/content-redirects/news/article-1');
    expect(result).toEqual({
      handler: 'content-redirects',
      params: {
        siteId: 'site-1',
        documentPath: 'news/article-1',
      },
    });
  });

  it('should not confuse redirects with other routes', () => {
    const structureResult = parseRoute('/api/sites/site-1/branches/branch-1/structures');
    expect(structureResult?.handler).toBe('structures');

    const templateResult = parseRoute('/api/sites/site-1/branches/branch-1/templates');
    expect(templateResult?.handler).toBe('templates');
  });

  it('should strip trailing slash from redirect routes', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/redirects/');
    expect(result).toEqual({
      handler: 'redirects',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
      },
    });
  });
});
