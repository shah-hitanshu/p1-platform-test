/**
 * PuckDataSynchronizer
 *
 * A component that syncs external data changes to Puck's internal state
 * without remounting the Puck component. This preserves UI state like
 * which sidebar tab is active.
 *
 * This component must be rendered inside the Puck component tree
 * (e.g., via a plugin or override) to access the usePuck hook.
 * It safely handles cases where Puck's context isn't available yet.
 */

import React, { Component, useEffect, useState } from 'react';
import { createUsePuck } from '@puckeditor/core';
import type { PuckData } from '@pantheon/css-client';

// Create a usePuck hook with selector to avoid unnecessary re-renders
// We only need dispatch, so we select just that
const usePuckDispatch = createUsePuck();

/**
 * Track the last synced key at module level to survive component remounts.
 * This is necessary because the plugin may be recreated frequently, which would
 * reset any component-level refs and cause repeated syncs.
 *
 * The tracking is done inside useEffect (not during render) to be safe with
 * React's concurrent features and strict mode.
 */
let lastSyncedKeyModule: string | null = null;

/**
 * Reset the module-level sync tracking. This is only for testing purposes.
 * In tests, the module state persists across test cases, which can cause
 * unexpected behavior. Call this in beforeEach to start each test fresh.
 *
 * @internal
 */
export function _resetSyncTracking(): void {
  lastSyncedKeyModule = null;
}

export interface PuckDataSynchronizerProps {
  /**
   * The data to sync to Puck. When this changes, Puck's internal
   * data will be updated via dispatch.
   */
  data: PuckData | null;

  /**
   * A key that changes when we want to force a data sync.
   * This helps distinguish between prop updates that should
   * sync vs. ones that shouldn't (like data from Puck's onChange).
   */
  syncKey: string | null;
}

/**
 * Error boundary to catch usePuck errors gracefully.
 * This is needed for React 19 which is stricter about errors.
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
  syncKey: string | null;
}

interface ErrorBoundaryState {
  hasError: boolean;
  lastSyncKey: string | null;
}

class PuckContextErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, lastSyncKey: props.syncKey };
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState
  ): Partial<ErrorBoundaryState> | null {
    // Reset error state when syncKey changes - allows retry on new sync attempts
    if (props.syncKey !== state.lastSyncKey) {
      return { hasError: false, lastSyncKey: props.syncKey };
    }
    return null;
  }

  componentDidCatch(error: Error): void {
    // Only suppress "usePuck must be used inside <Puck>" errors
    if (!error.message?.includes('usePuck')) {
      // Re-throw other errors
      throw error;
    }
    // Silently ignore usePuck context errors - the sync will work on subsequent renders
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      // Render nothing when there's an error - sync will be retried when syncKey changes
      return null;
    }
    return this.props.children;
  }
}

/**
 * Inner component that uses usePuck (only rendered after mount when context is ready)
 */
function PuckDataSynchronizerInner({
  data,
  syncKey,
}: PuckDataSynchronizerProps): null {
  // Use selector to only subscribe to dispatch, avoiding re-renders on other state changes
  const dispatch = usePuckDispatch((s) => s.dispatch);

  useEffect(() => {
    // Only sync when:
    // 1. syncKey is a non-null value (null means "don't sync")
    // 2. syncKey is different from what we last synced (using module-level tracking)
    // 3. we have data to sync
    //
    // Module-level tracking is critical because:
    // - The plugin may be recreated frequently, causing this component to remount
    // - When remounted, component-level refs reset to null
    // - This would cause duplicate syncs of the same data
    // - Module-level tracking survives remounts and prevents this
    if (syncKey !== null && syncKey !== lastSyncedKeyModule && data !== null) {
      // Update module-level tracking BEFORE dispatching
      // This is safe because we're in useEffect, not during render
      lastSyncedKeyModule = syncKey;

      // Dispatch setData to update Puck's internal state
      dispatch({
        type: 'setData',
        data: data as Parameters<typeof dispatch>[0] extends { data: infer D } ? D : never,
      });
    }
  }, [data, syncKey, dispatch]);

  // This component renders nothing
  return null;
}

/**
 * Syncs external data changes to Puck without remounting.
 *
 * This component renders nothing but uses an effect to dispatch
 * setData actions when the external data changes.
 *
 * It safely handles cases where Puck's context might not be ready yet
 * by deferring the sync until after the first render using setTimeout
 * to ensure Puck's context provider is fully initialized.
 *
 * An error boundary catches any "usePuck must be used inside <Puck>"
 * errors for React 19 compatibility.
 */
export function PuckDataSynchronizer({
  data,
  syncKey,
}: PuckDataSynchronizerProps): React.ReactElement | null {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Use setTimeout to defer to a later tick, ensuring Puck's context is fully set up
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  if (!isReady) {
    return null;
  }

  return (
    <PuckContextErrorBoundary syncKey={syncKey}>
      <PuckDataSynchronizerInner data={data} syncKey={syncKey} />
    </PuckContextErrorBoundary>
  );
}
