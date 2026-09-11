/**
 * Route parser tests for the site members endpoint.
 *
 * /members sits beside the grant-management /collaborators path on the same
 * site prefix, and the two carry different permissions — so a regression that
 * let one path reach the other handler would widen or narrow access silently.
 */

import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../../src/routes/route-parser';

describe('parseRoute — site members', () => {
  it('parses the site members path', () => {
    expect(parseRoute('/api/sites/site-1/members')).toEqual({
      handler: 'site-members',
      params: { siteId: 'site-1' },
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoute('/api/sites/site-1/members/')?.handler).toBe('site-members');
  });

  it('does not claim a sub-path under members', () => {
    expect(parseRoute('/api/sites/site-1/members/user-1')?.handler).not.toBe('site-members');
  });

  it('leaves the collaborators path on its own handler', () => {
    expect(parseRoute('/api/sites/site-1/collaborators')?.handler).toBe('collaborators');
  });
});
