import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';

describe('parseRoute - copy route', () => {
  it('parses the document copy route', () => {
    const parsed = parseRoute('/api/sites/site-1/branches/branch-1/documents/doc-1/copy');

    expect(parsed).toEqual({
      handler: 'documents',
      params: {
        siteId: 'site-1',
        branchId: 'branch-1',
        documentId: 'doc-1',
        action: 'copy',
      },
    });
  });
});
