/**
 * useAutoSave Hook
 *
 * Provides auto-save functionality with debouncing and retry logic.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { PuckData } from '@pantheon-systems/css-client';
import type { P1Client } from '@pantheon-systems/css-client';
import type { SaveStatus, UseAutoSaveOptions, UseAutoSaveReturn } from '../core/types.js';
import { debounce } from '../core/utils/debounce.js';
import { withRetry } from '../core/utils/retry.js';

interface UseAutoSaveParams {
  client: P1Client;
  siteId: string;
  branchId: string;
  documentId: string;
  options?: UseAutoSaveOptions;
}

/**
 * Hook for auto-saving Puck data with debouncing and retry logic.
 *
 * @param params - Configuration for auto-save
 * @returns Auto-save state and controls
 *
 * @example
 * ```tsx
 * const { save, status, lastSaved } = useAutoSave({
 *   client,
 *   siteId,
 *   branchId,
 *   documentId,
 *   options: { debounceMs: 3000 },
 * });
 *
 * // In Puck onChange handler
 * <Puck onChange={(data) => save(data)} />
 * ```
 */
export function useAutoSave({
  client,
  siteId,
  branchId,
  documentId,
  options = {},
}: UseAutoSaveParams): UseAutoSaveReturn {
  const {
    debounceMs = 3000,
    maxRetries = 3,
    onSaveStart,
    onSaveSuccess,
    onSaveError,
  } = options;

  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Store the latest data for saving
  const pendingDataRef = useRef<PuckData | null>(null);
  const isSavingRef = useRef(false);

  // Core save function
  const performSave = useCallback(async () => {
    const dataToSave = pendingDataRef.current;
    if (!dataToSave || isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setStatus('saving');
    setError(null);
    onSaveStart?.();

    try {
      await withRetry(
        async () => {
          await client.versions.create(siteId, {
            documentId,
            branchId,
            snapshot: dataToSave as unknown as Record<string, unknown>,
          });
        },
        {
          maxAttempts: maxRetries,
          baseDelayMs: 1000,
          shouldRetry: (err) => {
            // Don't retry on validation errors
            if ('status' in err && (err as { status: number }).status === 400) {
              return false;
            }
            return true;
          },
        }
      );

      pendingDataRef.current = null;
      setStatus('saved');
      setLastSaved(new Date());
      setIsDirty(false);
      onSaveSuccess?.();
    } catch (err) {
      const saveError = err instanceof Error ? err : new Error(String(err));
      setStatus('error');
      setError(saveError);
      onSaveError?.(saveError);
    } finally {
      isSavingRef.current = false;
    }
  }, [client, siteId, branchId, documentId, maxRetries, onSaveStart, onSaveSuccess, onSaveError]);

  // Create debounced save function
  const debouncedSaveRef = useRef<ReturnType<typeof debounce<() => void>> | null>(null);

  useEffect(() => {
    debouncedSaveRef.current = debounce(() => {
      void performSave();
    }, debounceMs);

    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, [performSave, debounceMs]);

  // Public save function (debounced)
  const save = useCallback((data: PuckData) => {
    pendingDataRef.current = data;
    setIsDirty(true);
    debouncedSaveRef.current?.();
  }, []);

  // Force immediate save
  const saveNow = useCallback(async () => {
    debouncedSaveRef.current?.cancel();
    await performSave();
  }, [performSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, []);

  return {
    save,
    saveNow,
    status,
    lastSaved,
    error,
    isDirty,
  };
}
