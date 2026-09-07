/**
 * Locale Rows for the open document
 *
 * The switcher's data: the site's markets joined to the variants its canonical
 * holds. A translation resolves up to its canonical first, so the list is the
 * same wherever in a page's locale set the editor is standing.
 */

import { useQuery } from '@tanstack/react-query';
import type { Document } from '@pantheon-systems/css-client';
import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { useP1SdkQueryClient } from '../../data/query-provider.js';
import { buildLocaleRows, type LocaleRow } from './locale-rows.js';
import { useSiteMarkets } from './useSiteMarkets.js';

export const LOCALE_VARIANTS_KEY = 'p1-locale-variants';

export interface LocaleRowsData {
  rows: LocaleRow[];
  /** The site's configured markets, which is not every locale the rows cover. */
  markets: string[];
  /** The markets or the variants have yet to arrive. */
  loading: boolean;
  /** A request behind the rows could not be read, so the list is unknown rather than empty. */
  failed: boolean;
  /** The canonical every row is measured against, once known. */
  canonical: Document | null;
  /** The canonical and its variants, for resolving a row's document to its path. */
  documents: Document[];
  /** Re-read the variants after one is created. */
  refresh: () => void;
  /** Ask for the markets and the variants again. */
  retry: () => void;
}

const NO_ROWS: LocaleRow[] = [];
const NO_DOCUMENTS: Document[] = [];

export function useLocaleRows(): LocaleRowsData {
  const css = useP1PuckOptional();
  const client = css?.client;
  const siteId = css?.siteId;
  const branchId = css?.branchId;
  const currentDocument = css?.currentDocument;
  const queryClient = useP1SdkQueryClient();

  // A translation's siblings hang off its canonical, so that is what both
  // queries are keyed and asked by.
  const canonicalId = currentDocument
    ? (currentDocument.localizedFromId ?? currentDocument.id)
    : null;

  const addressable = Boolean(client && siteId && branchId && canonicalId);

  const {
    markets,
    loaded: marketsLoaded,
    failed: marketsFailed,
    retry: retryMarkets,
  } = useSiteMarkets({ enabled: addressable });

  const variantsQuery = useQuery({
    queryKey: [LOCALE_VARIANTS_KEY, siteId, branchId, canonicalId],
    queryFn: async () => {
      if (!client || !siteId || !branchId || !canonicalId) return null;
      return client.translations.listVariants(siteId, branchId, canonicalId);
    },
    enabled: addressable,
  }, queryClient);

  const variantsResult = variantsQuery.data ?? null;
  const variantsSettled = variantsQuery.isSuccess || variantsQuery.isError;
  const loading = addressable && !(marketsLoaded && variantsSettled);
  const failed = marketsFailed || variantsQuery.isError;
  const refresh = (): void => {
    void variantsQuery.refetch();
  };
  const retry = (): void => {
    retryMarkets();
    refresh();
  };

  if (loading || !variantsResult || !currentDocument) {
    return {
      rows: NO_ROWS,
      markets,
      loading,
      failed,
      canonical: variantsResult?.canonical ?? null,
      documents: NO_DOCUMENTS,
      refresh,
      retry,
    };
  }

  const variants = variantsResult.variants.map((v) => v.document);

  return {
    rows: buildLocaleRows({
      markets,
      canonical: variantsResult.canonical,
      variants,
      currentDocumentId: currentDocument.id,
    }),
    markets,
    loading: false,
    failed,
    canonical: variantsResult.canonical,
    documents: [variantsResult.canonical, ...variants],
    refresh,
    retry,
  };
}
