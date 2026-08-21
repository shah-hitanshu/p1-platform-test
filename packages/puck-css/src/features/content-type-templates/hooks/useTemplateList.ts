/**
 * useTemplateList Hook
 *
 * Fetches and manages the list of templates for a site/branch.
 */

import { useState, useEffect, useCallback } from 'react';
import type { P1Client } from '@pantheon-systems/css-client';
import type { TemplateSummary } from '../types.js';

export interface UseTemplateListReturn {
  /** List of templates (metadata summaries; no component data) */
  templates: TemplateSummary[];
  /** Whether templates are currently being fetched */
  loading: boolean;
  /** Error that occurred during fetch, if any */
  error: Error | null;
  /** Manually trigger a refetch of templates */
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and manage template list.
 *
 * @param client - P1Client instance
 * @param siteId - Site ID
 * @param branchId - Branch ID
 * @returns Template list state and refresh function
 *
 * @example
 * ```tsx
 * const { templates, loading, error, refresh } = useTemplateList(client, siteId, branchId);
 *
 * if (loading) return <div>Loading templates...</div>;
 * if (error) return <div>Error: {error.message}</div>;
 *
 * return (
 *   <ul>
 *     {templates.map(t => <li key={t.id}>{t.label}</li>)}
 *   </ul>
 * );
 * ```
 */
export function useTemplateList(
  client: P1Client,
  siteId: string,
  branchId: string
): UseTemplateListReturn {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTemplates = useCallback(async (signal?: AbortSignal) => {
    // No branch resolved yet (the branch list is still in flight, or it failed):
    // calling through would build a URL with an empty branch segment.
    if (!client.templates || !branchId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const result = await client.templates.list(siteId, branchId);
      if (!signal?.aborted) {
        setTemplates(result);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [client, siteId, branchId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTemplates(controller.signal);
    return () => controller.abort();
  }, [fetchTemplates]);

  // Expose refresh function
  const refresh = useCallback(async () => {
    await fetchTemplates();
  }, [fetchTemplates]);

  return {
    templates,
    loading,
    error,
    refresh,
  };
}
