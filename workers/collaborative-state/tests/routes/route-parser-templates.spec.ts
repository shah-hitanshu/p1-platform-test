/**
 * Route Parser - Template Route Tests
 *
 * Tests ensuring template URLs are correctly parsed,
 * including the migration-status endpoint.
 */

import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';

describe('parseRoute - template routes', () => {
  it('should parse template migration-status route', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/templates/tmpl-1/migration-status');
    expect(result).toEqual({
      handler: 'templates',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        templateId: 'tmpl-1',
        action: 'migration-status',
      },
    });
  });

  it('should parse template migrate route', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/templates/tmpl-1/migrate');
    expect(result).toEqual({
      handler: 'templates',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        templateId: 'tmpl-1',
        action: 'migrate',
      },
    });
  });

  it('should parse template rollback route', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/templates/tmpl-1/rollback');
    expect(result).toEqual({
      handler: 'templates',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        templateId: 'tmpl-1',
        action: 'rollback',
      },
    });
  });

  it('should parse template by ID route', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/templates/tmpl-1');
    expect(result).toEqual({
      handler: 'templates',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        templateId: 'tmpl-1',
      },
    });
  });

  it('should parse templates list route', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/templates');
    expect(result).toEqual({
      handler: 'templates',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
      },
    });
  });

  it('should parse template migrate preview route', () => {
    const result = parseRoute('/api/sites/site-1/branches/branch-1/templates/tmpl-1/migrate/preview');
    expect(result).toEqual({
      handler: 'templates',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        templateId: 'tmpl-1',
        action: 'migrate-preview',
      },
    });
  });

  it('should not confuse migration-status with migrate', () => {
    const statusResult = parseRoute('/api/sites/s/branches/b/templates/t/migration-status');
    const migrateResult = parseRoute('/api/sites/s/branches/b/templates/t/migrate');

    expect(statusResult?.params.action).toBe('migration-status');
    expect(migrateResult?.params.action).toBe('migrate');
  });
});
