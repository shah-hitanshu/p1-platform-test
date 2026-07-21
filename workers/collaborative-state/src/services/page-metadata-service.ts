/**
 * Page Metadata Service
 *
 * Builds the SEO metadata delivered on the content payload. Page-level tags
 * (title, description, canonical URL) are derived client-side from the
 * snapshot already on the payload, so this only maps site-level values.
 */

import type { SeoMetadata } from '../types/page-metadata';
import type { Site } from '../types';

/**
 * Builds the SEO metadata for a page from its owning site.
 *
 * @param site - The site the document belongs to, or null when not found
 * @returns The SEO metadata for the content payload
 */
export function buildPageMetadata(site: Site | null): SeoMetadata {
  return site === null ? {} : { siteName: site.name };
}
