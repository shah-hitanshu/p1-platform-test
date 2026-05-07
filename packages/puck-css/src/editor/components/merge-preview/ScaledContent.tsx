/**
 * ScaledContent Component
 *
 * Wraps children with CSS transform scaling and adjusts container height
 * to match the scaled content size. Used to show zoomed-out page previews.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';

const PREVIEW_SCALE = 0.25;

export function ScaledContent({ children }: { children: React.ReactNode }): React.ReactElement {
  const innerRef = useRef<HTMLDivElement>(null);
  const [scaledHeight, setScaledHeight] = useState<number | undefined>(undefined);

  const measure = useCallback(() => {
    if (innerRef.current) {
      setScaledHeight(innerRef.current.scrollHeight * PREVIEW_SCALE);
    }
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (innerRef.current) observer.observe(innerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div style={{ height: scaledHeight, overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{
          transform: `scale(${PREVIEW_SCALE})`,
          transformOrigin: 'top left',
          width: `${100 / PREVIEW_SCALE}%`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
