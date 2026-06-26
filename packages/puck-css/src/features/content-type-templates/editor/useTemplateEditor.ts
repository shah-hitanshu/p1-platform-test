/**
 * useTemplateEditor Hook
 *
 * Hook for editing templates.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Template, UpdateTemplateParams } from '../types.js';
import type { TemplateStore } from '../stores/template-store.js';

export interface UseTemplateEditorReturn {
  template: Template | undefined;
  loading: boolean;
  saving: boolean;
  error: Error | null;
  save: (params: UpdateTemplateParams) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Hook for editing a template.
 */
export function useTemplateEditor(
  templateId: string,
  store: TemplateStore
): UseTemplateEditorReturn {
  const [template, setTemplate] = useState<Template | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await store.get(templateId);
      if (!signal?.aborted) {
        setTemplate(loaded);
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
  }, [templateId, store]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const save = useCallback(
    async (params: UpdateTemplateParams) => {
      try {
        setSaving(true);
        const updated = await store.update(templateId, params);
        setTemplate(updated);
        setSaving(false);
      } catch (err) {
        setSaving(false);
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },
    [templateId, store]
  );

  return {
    template,
    loading,
    saving,
    error,
    save,
    reload: load,
  };
}
