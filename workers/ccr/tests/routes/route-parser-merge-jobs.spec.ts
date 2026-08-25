/**
 * Route Parser - Merge Job Routes [PCC-3737]
 *
 * The merge job runner's status/cancel endpoints. The `merge-jobs` prefix is
 * distinct from `merge-requests` and `merge/{op}` — these tests pin that the
 * new pattern neither shadows nor is shadowed by the older merge routes.
 */

import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';

describe('parseRoute - merge job routes', () => {
  it('should parse the merge job status route', () => {
    const result = parseRoute('/api/sites/site-1/merge-jobs/job-1');
    expect(result).toEqual({
      handler: 'merge',
      params: {
        siteId: 'site-1',
        mergeJobId: 'job-1',
        action: 'job',
      },
    });
  });

  it('should parse the merge job cancel route', () => {
    const result = parseRoute('/api/sites/site-1/merge-jobs/job-1/cancel');
    expect(result).toEqual({
      handler: 'merge',
      params: {
        siteId: 'site-1',
        mergeJobId: 'job-1',
        action: 'job-cancel',
      },
    });
  });

  it('does not swallow merge-request routes', () => {
    const execute = parseRoute('/api/sites/site-1/merge-requests/mr-1/execute');
    expect(execute?.params.action).toBe('execute-request');
    expect(execute?.params.mergeJobId).toBeUndefined();

    const requests = parseRoute('/api/sites/site-1/merge-requests/mr-1');
    expect(requests?.params.action).toBe('requests');
    expect(requests?.params.mergeRequestId).toBe('mr-1');
  });
});
