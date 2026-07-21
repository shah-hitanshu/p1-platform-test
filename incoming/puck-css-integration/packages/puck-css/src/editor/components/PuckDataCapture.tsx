/**
 * PuckDataCapture
 *
 * Captures Puck's actual current data after each React render and writes
 * it to an external ref. This is necessary because Puck's onChange fires
 * with data from the PREVIOUS render cycle (React state lags the DOM),
 * so onChange data is always one keystroke behind.
 *
 * By reading via usePuck after React commits, we get the true current state.
 * The ref is read by the realtime throttle callback at send time.
 *
 * Must be rendered inside the Puck component tree (e.g., via a plugin override).
 */

import { useRef, useEffect } from 'react';
import { createUsePuck } from '@puckeditor/core';
import type { PuckData } from '@pantheon-systems/css-client';

// Selector that reads Puck's current data
const usePuckData = createUsePuck();

export interface PuckDataCaptureProps {
  /** Ref to write the latest Puck data to */
  dataRef: React.MutableRefObject<PuckData | null>;
  /** Optional callback when data changes (for triggering deferred sync) */
  onDataChange?: (data: PuckData) => void;
}

export function PuckDataCapture({ dataRef, onDataChange }: PuckDataCaptureProps): null {
  const data = usePuckData((s) => s.appState.data) as PuckData | undefined;
  const onDataChangeRef = useRef(onDataChange);
  onDataChangeRef.current = onDataChange;

  useEffect(() => {
    if (data) {
      dataRef.current = data;
      onDataChangeRef.current?.(data);
    }
  }, [data, dataRef]);

  return null;
}
