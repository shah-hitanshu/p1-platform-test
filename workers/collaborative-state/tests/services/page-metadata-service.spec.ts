/**
 * Page Metadata Service Tests (PCC-3407)
 *
 * Verifies the SEO metadata built for the content payload:
 *   - siteName ← site name (optional, omitted when the site is not found)
 *
 * Title, description, and canonicalUrl are derived client-side from the
 * snapshot already present on the payload, so they are not built here.
 */

import { describe, it, expect } from 'vitest';
import type { Site } from '../../src/types';
import { buildPageMetadata } from '../../src/services/page-metadata-service';

const mockSite: Site = {
  id: 'site-uuid-123',
  pantheonSiteId: 'pantheon-site-1',
  name: 'Acme Docs',
  url: 'https://content.public.url',
  workflowSettings: {
    mergeApprovalMode: 'optional',
    minApprovers: 1,
    allowSelfApproval: true,
    approverMode: 'both',
  },
  allowedOrigins: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};

describe('buildPageMetadata', () => {
  it('should source siteName from the site name', () => {
    const metadata = buildPageMetadata(mockSite);
    expect(metadata).toEqual({ siteName: 'Acme Docs' });
  });

  it('should omit siteName when the site is not found', () => {
    const metadata = buildPageMetadata(null);
    expect(metadata).toEqual({});
  });
});
