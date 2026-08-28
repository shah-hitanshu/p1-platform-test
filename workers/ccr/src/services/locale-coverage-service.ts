/**
 * Locale Coverage Service
 *
 * A branch-scoped roll-up of which canonical documents hold which locale variants.
 * One query covers the whole branch, so a listing of hundreds of pages costs a
 * single round trip rather than a per-page variant lookup.
 *
 * Visibility follows the branch document listing: a variant the branch holds a live
 * version of, or inherits published from main, counts. Main is a branch like any
 * other here.
 *
 * @see workers/ccr/src/services/create-translation-service.ts (listLocaleVariants,
 *      the per-canonical read)
 */

import type { Branch } from '../types/domain';
import { getMainBranch } from './branch-service';
import { listLocaleVariantsOnBranch } from './relations-service';

/** One locale variant of a canonical document. */
export interface LocaleCoverageVariant {
  locale: string;
  documentId: string;
  path: string;
}

/** A canonical document and the locale variants the branch holds for it. */
export interface LocaleCoverageEntry {
  canonicalDocumentId: string;
  variants: LocaleCoverageVariant[];
}

/**
 * The branch's locale coverage. `locales` is the distinct set across `coverage`,
 * sorted, so a filter built from it offers exactly the locales the branch holds
 * content in rather than every locale the site is configured for.
 */
export interface LocaleCoverage {
  locales: string[];
  coverage: LocaleCoverageEntry[];
}

/**
 * Orders locale tags for both `locales` and each entry's `variants`. One
 * comparator owns the whole response: a filter built from `locales` and the chips
 * built from `variants` would otherwise be free to disagree on where a tag sits,
 * since JavaScript's default sort orders by code unit and Postgres by collation.
 */
function compareLocales(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Returns every canonical document the branch holds at least one locale variant
 * of, each with its variants, plus the distinct locales across them. A canonical
 * with no variants is absent, which a caller reads as zero coverage.
 *
 * Takes the resolved branch rather than an id: the caller has already loaded it to
 * check it belongs to the site, and main is the only other branch this needs.
 */
export async function getBranchLocaleCoverage(branch: Branch): Promise<LocaleCoverage> {
  const mainBranchId = branch.isMain ? undefined : (await getMainBranch(branch.siteId))?.id;
  const rows = await listLocaleVariantsOnBranch(branch.id, mainBranchId);

  const byCanonical = new Map<string, LocaleCoverageVariant[]>();
  const locales = new Set<string>();
  for (const row of rows) {
    let variants = byCanonical.get(row.canonicalDocumentId);
    if (variants === undefined) {
      variants = [];
      byCanonical.set(row.canonicalDocumentId, variants);
    }
    variants.push({ locale: row.locale, documentId: row.documentId, path: row.path });
    locales.add(row.locale);
  }

  for (const variants of byCanonical.values()) {
    variants.sort((a, b) => compareLocales(a.locale, b.locale));
  }

  return {
    locales: [...locales].sort(compareLocales),
    coverage: [...byCanonical].map(([canonicalDocumentId, variants]) => ({
      canonicalDocumentId,
      variants,
    })),
  };
}
