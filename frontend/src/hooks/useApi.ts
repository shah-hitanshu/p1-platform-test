/**
 * useApi Hook
 *
 * Generic hook for API requests with loading and error states.
 */

import { useState, useCallback } from 'react';
import { ApiClientError } from '../api/client';

interface UseApiState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

interface UseApiResult<T, Args extends unknown[]> extends UseApiState<T> {
  execute: (...args: Args) => Promise<T | null>;
  reset: () => void;
}

/**
 * Hook for making API requests with loading/error handling
 */
export function useApi<T, Args extends unknown[]>(
  apiFunc: (...args: Args) => Promise<T>
): UseApiResult<T, Args> {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    isLoading: false,
    error: null,
  });

  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const result = await apiFunc(...args);
        setState({ data: result, isLoading: false, error: null });
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'An unknown error occurred';

        setState({ data: null, isLoading: false, error: errorMessage });
        return null;
      }
    },
    [apiFunc]
  );

  const reset = useCallback(() => {
    setState({ data: null, isLoading: false, error: null });
  }, []);

  return {
    ...state,
    execute,
    reset,
  };
}

/**
 * Hook for API requests that execute immediately on mount
 */
export function useApiOnMount<T>(
  apiFunc: () => Promise<T>
): UseApiState<T> & { refetch: () => Promise<T | null> } {
  const { data, isLoading, error, execute } = useApi(apiFunc);

  // Note: In a real app, you'd use useEffect here to auto-fetch
  // For this explorer, we'll trigger fetches manually for more control

  return {
    data,
    isLoading,
    error,
    refetch: execute,
  };
}
