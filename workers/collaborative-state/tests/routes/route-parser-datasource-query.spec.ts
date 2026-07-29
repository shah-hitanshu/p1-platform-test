/**
 * Route Parser Tests for Datasource and Query Routes
 *
 * Tests that the route parser correctly matches datasource
 * and query URL patterns.
 */

import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';

describe('parseRoute: datasource routes', () => {
  it('should match list datasources route', () => {
    const result = parseRoute('/api/sites/s1/branches/b1/datasources');
    expect(result).toEqual({
      handler: 'datasources',
      params: {
        siteId: 's1',
        branchId: 'b1',
        datasourceName: undefined,
      },
    });
  });

  it('should match get datasource by name route', () => {
    const result = parseRoute('/api/sites/s1/branches/b1/datasources/blog');
    expect(result).toEqual({
      handler: 'datasources',
      params: {
        siteId: 's1',
        branchId: 'b1',
        datasourceName: 'blog',
      },
    });
  });

  it('should handle trailing slash', () => {
    const result = parseRoute('/api/sites/s1/branches/b1/datasources/');
    expect(result).not.toBeNull();
    expect(result?.handler).toBe('datasources');
  });
});

describe('parseRoute: query routes', () => {
  it('should match list queries route', () => {
    const result = parseRoute('/api/sites/s1/branches/b1/queries');
    expect(result).toEqual({
      handler: 'queries',
      params: {
        siteId: 's1',
        branchId: 'b1',
        queryName: undefined,
        action: undefined,
      },
    });
  });

  it('should match get query by name route', () => {
    const result = parseRoute('/api/sites/s1/branches/b1/queries/recent-posts');
    expect(result).toEqual({
      handler: 'queries',
      params: {
        siteId: 's1',
        branchId: 'b1',
        queryName: 'recent-posts',
        action: undefined,
      },
    });
  });

  it('should match query results route', () => {
    const result = parseRoute('/api/sites/s1/branches/b1/queries/recent-posts/results');
    expect(result).toEqual({
      handler: 'queries',
      params: {
        siteId: 's1',
        branchId: 'b1',
        queryName: 'recent-posts',
        action: 'results',
      },
    });
  });
});
