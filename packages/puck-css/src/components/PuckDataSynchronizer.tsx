/**
 * PuckDataSynchronizer
 *
 * A component that syncs external data changes to Puck's internal state
 * without remounting the Puck component. This preserves UI state like
 * which sidebar tab is active.
 *
 * This component must be rendered inside the Puck component tree
 * (e.g., via an override) to access the usePuck hook.
 */

import { useEffect, useRef } from 'react';
import { usePuck } from '@puckeditor/core';
import type { PuckData } from '@pantheon/css-client';

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
 * Syncs external data changes to Puck without remounting.
 *
 * This component renders nothing but uses an effect to dispatch
 * setData actions when the external data changes.
 */
export function PuckDataSynchronizer({
  data,
  syncKey,
}: PuckDataSynchronizerProps): null {
  const { dispatch } = usePuck();
  const lastSyncKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Only sync when:
    // 1. syncKey is a non-null value (null means "don't sync")
    // 2. syncKey is different from what we last synced
    // 3. we have data to sync
    if (syncKey !== null && syncKey !== lastSyncKeyRef.current && data !== null) {
      lastSyncKeyRef.current = syncKey;

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
