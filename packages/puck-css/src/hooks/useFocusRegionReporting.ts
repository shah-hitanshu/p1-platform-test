/**
 * useFocusRegionReporting Hook
 *
 * Manages debounced reporting of focus regions to the backend.
 * Used to inform the server which components a human has selected in the editor,
 * enabling proactive collision detection before actual edits occur.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePresenceContext } from '../PresenceContext.js';

/**
 * Options for the useFocusRegionReporting hook.
 */
export interface UseFocusRegionReportingOptions {
  /** Whether focus reporting is enabled (default: true) */
  enabled?: boolean;
  /** Debounce delay in ms before sending to server (default: 300) */
  debounceMs?: number;
  /** Heartbeat interval in ms to keep focus alive (default: 15000) */
  heartbeatMs?: number;
  /**
   * Optional function to send focus regions via WebSocket.
   * When provided and returns true, HTTP fallback is skipped.
   * When returns false or not provided, falls back to HTTP.
   * @param regions - Focus regions to send
   * @returns true if sent successfully via WebSocket, false otherwise
   */
  sendViaWebSocket?: (regions: string[]) => boolean;
}

/**
 * Return value for the useFocusRegionReporting hook.
 */
export interface UseFocusRegionReportingReturn {
  /** Current focus regions (local state) */
  focusRegions: string[];
  /** Set the focus regions - triggers debounced report to server */
  setFocusRegions: (regions: string[]) => void;
  /** Clear all focus regions */
  clearFocus: () => void;
  /** Whether a report is currently in flight */
  isReporting: boolean;
}

/**
 * Hook for reporting focus regions to the backend.
 *
 * Manages debounced updates, heartbeat keep-alive, and cleanup on unmount.
 * Focus regions tell the server which components the user has selected,
 * allowing agents to avoid editing those regions proactively.
 *
 * @param options - Configuration options
 * @returns Focus state and operations
 *
 * @example
 * ```tsx
 * function SelectionReporter() {
 *   const { setFocusRegions, clearFocus } = useFocusRegionReporting();
 *
 *   // When Puck selection changes
 *   useEffect(() => {
 *     if (selectedItem) {
 *       setFocusRegions([`/content/${selectedItem.index}`]);
 *     } else {
 *       clearFocus();
 *     }
 *   }, [selectedItem, setFocusRegions, clearFocus]);
 *
 *   return null;
 * }
 * ```
 */
export function useFocusRegionReporting(
  options: UseFocusRegionReportingOptions = {}
): UseFocusRegionReportingReturn {
  const { enabled = true, debounceMs = 300, heartbeatMs = 15000, sendViaWebSocket } = options;
  const { client, siteId, branchId, documentPath, userId } = usePresenceContext();

  // Ref for sendViaWebSocket to avoid callback recreation
  const sendViaWebSocketRef = useRef(sendViaWebSocket);
  useEffect(() => {
    sendViaWebSocketRef.current = sendViaWebSocket;
  }, [sendViaWebSocket]);

  // Local state
  const [focusRegions, setFocusRegionsState] = useState<string[]>([]);
  const [isReporting, setIsReporting] = useState(false);

  // Refs for managing timers and cleanup
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const lastReportedRef = useRef<string | null>(null);
  const focusRegionsRef = useRef<string[]>([]);

  // Keep ref in sync with state
  useEffect(() => {
    focusRegionsRef.current = focusRegions;
  }, [focusRegions]);

  // Ref for reportFocusRegions to avoid restarting heartbeat interval
  const reportFocusRegionsRef = useRef<(regions: string[]) => Promise<void>>(async () => {});

  /**
   * Send focus regions to the server.
   * Tries WebSocket first if available, falls back to HTTP.
   */
  const reportFocusRegions = useCallback(
    async (regions: string[]) => {
      // Deduplicate - don't report if regions haven't changed
      const serialized = JSON.stringify(regions);
      if (serialized === lastReportedRef.current) {
        return;
      }

      // Skip if disabled, unmounted, or no document path
      if (!enabled || !mountedRef.current || !documentPath) {
        return;
      }

      // Try WebSocket first if available
      if (sendViaWebSocketRef.current?.(regions)) {
        lastReportedRef.current = serialized;
        return;
      }

      // Fall back to HTTP
      try {
        setIsReporting(true);
        await client.presence.updateFocusRegions(siteId, branchId, documentPath, userId, regions);
        lastReportedRef.current = serialized;
      } catch {
        // Silently handle errors - focus reporting is not critical
        // Log for debugging if needed
      } finally {
        if (mountedRef.current) {
          setIsReporting(false);
        }
      }
    },
    [client, siteId, branchId, documentPath, userId, enabled]
  );

  // Keep ref in sync with callback
  useEffect(() => {
    reportFocusRegionsRef.current = reportFocusRegions;
  }, [reportFocusRegions]);

  /**
   * Set focus regions with debouncing.
   */
  const setFocusRegions = useCallback(
    (regions: string[]) => {
      // Update local state immediately
      setFocusRegionsState(regions);

      if (!enabled) {
        return;
      }

      // Cancel any pending debounced call
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Schedule debounced report
      debounceTimerRef.current = setTimeout(() => {
        void reportFocusRegions(regions);
      }, debounceMs);
    },
    [enabled, debounceMs, reportFocusRegions]
  );

  /**
   * Clear focus regions.
   */
  const clearFocus = useCallback(() => {
    setFocusRegionsState([]);

    if (!enabled) {
      return;
    }

    // Cancel any pending debounced call
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Schedule debounced report
    debounceTimerRef.current = setTimeout(() => {
      void reportFocusRegions([]);
    }, debounceMs);
  }, [enabled, debounceMs, reportFocusRegions]);

  // Heartbeat to keep focus alive
  useEffect(() => {
    if (!enabled) {
      return;
    }

    heartbeatTimerRef.current = setInterval(() => {
      // Only send heartbeat if we have focus regions
      if (focusRegionsRef.current.length > 0) {
        // Reset lastReported to force the heartbeat through
        const serialized = JSON.stringify(focusRegionsRef.current);
        if (lastReportedRef.current === serialized) {
          // Same regions - force through by clearing last reported temporarily
          lastReportedRef.current = null;
        }
        void reportFocusRegionsRef.current(focusRegionsRef.current);
      }
    }, heartbeatMs);

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };
  }, [enabled, heartbeatMs]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      // Cancel pending debounced call
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // Cancel heartbeat
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }

      // Send final clear (fire-and-forget)
      // Only if we have a document path to clear
      if (enabled && documentPath) {
        // Reset lastReported to ensure the clear goes through
        lastReportedRef.current = null;

        // Try WebSocket first if available
        if (sendViaWebSocketRef.current?.([])) {
          return;
        }

        // Fall back to HTTP
        void client.presence
          .updateFocusRegions(siteId, branchId, documentPath, userId, [])
          .catch(() => {
            // Ignore errors on unmount
          });
      }
    };
  }, [client, siteId, branchId, documentPath, userId, enabled]);

  return {
    focusRegions,
    setFocusRegions,
    clearFocus,
    isReporting,
  };
}
