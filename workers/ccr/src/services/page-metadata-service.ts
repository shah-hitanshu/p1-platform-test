/**
 * Page Metadata Service
 *
 * Builds the SEO metadata delivered on the content payload. Page-level tags
 * (title, description, canonical URL) are derived client-side from the
 * snapshot already on the payload, so this only maps site-level values: the
 * site name, plus the site-wide social defaults a page inherits when it leaves
 * a metadata field empty.
 */

import type { SeoMetadata } from '../types/page-metadata';
import type { Site } from '../types';
import type { SiteSettings } from './site-settings-service';

/**
 * Builds the SEO metadata for a page from its owning site.
 *
 * @param site - The site the document belongs to, or null when not found
 * @param settings - The site's settings, carrying the social defaults
 * @returns The SEO metadata for the content payload, absent values omitted
 */
export function buildPageMetadata(
  site: Site | null,
  settings?: SiteSettings | null,
): SeoMetadata {
  const metadata: SeoMetadata = {};

  if (site !== null) {
    metadata.siteName = site.name;
  }
  if (settings?.ogImage !== undefined) {
    metadata.ogImage = settings.ogImage;
  }
  if (settings?.ogLocale !== undefined) {
    metadata.ogLocale = settings.ogLocale;
  }

  return metadata;
}
