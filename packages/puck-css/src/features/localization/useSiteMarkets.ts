/**
 * Site markets
 *
 * The locales a site publishes into, from its settings. Every locale picker in
 * the editor is bounded to this list, so a locale that isn't configured can't be
 * reached from the UI.
 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { useP1SdkQueryClient } from '../../data/query-provider.js';

export const SITE_MARKETS_KEY = 'p1-site-markets';

const NO_MARKETS: string[] = [];

export interface SiteMarkets {
  /** Empty until the settings arrive, and for a site with no markets. */
  markets: string[];
  /** False while the settings are still in flight, which an empty list alone doesn't tell you. */
  loaded: boolean;
  /** The settings could not be read, so the markets are unknown rather than absent. */
  failed: boolean;
  /** Ask for the settings again. */
  retry: () => void;
}

/**
 * `enabled` false holds the request back where nothing is asking for markets
 * yet, so a surface that needs them can share this query without making every
 * other surface fetch settings it has no use for.
 */
export function useSiteMarkets({ enabled = true }: { enabled?: boolean } = {}): SiteMarkets {
  const css = useP1PuckOptional();
  const client = css?.client;
  const siteId = css?.siteId;
  const queryClient = useP1SdkQueryClient();

  const query = useQuery(
    {
      queryKey: [SITE_MARKETS_KEY, siteId],
      queryFn: async (): Promise<string[]> => {
        if (!client || !siteId) return NO_MARKETS;
        const result = await client.sites.getSettings(siteId);
        return result.settings.locales?.markets ?? NO_MARKETS;
      },
      enabled: enabled && Boolean(client && siteId),
    },
    queryClient,
  );

  const refetch = query.refetch;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    markets: query.data ?? NO_MARKETS,
    loaded: query.isSuccess || query.isError,
    failed: query.isError,
    retry,
  };
}
