/**
 * ComponentClickOverlay Component
 *
 * Transparent overlay that positions click targets over rendered Puck
 * components. Used by CherryPickVisualPanel to enable component-level
 * selection without modifying Puck configs.
 *
 * All visual styling uses inline React styles.
 */

import React, { useState, useEffect, useCallback } from 'react';

/**
 * Props for the ComponentClickOverlay component.
 */
export interface ComponentClickOverlayProps {
  /** Ref to the container element wrapping the <Render> output */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Map of componentId -> selection state */
  selections: Record<string, 'source' | 'target' | 'none'>;
  /** Callback when a component region is clicked */
  onComponentClick: (componentId: string) => void;
  /** Whether click interaction is enabled */
  interactive: boolean;
  /** Label to show for the branch this overlay represents (e.g., "Draft" or "Live") */
  branchLabel: string;
}

interface ComponentPosition {
  componentId: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

// =============================================================================
// Inline Style Constants
// =============================================================================

const overlayContainerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};

const selectionColors: Record<string, React.CSSProperties> = {
  source: {
    borderColor: '#22c55e',
    background: 'rgba(34, 197, 94, 0.1)',
  },
  target: {
    borderColor: '#3b82f6',
    background: 'rgba(59, 130, 246, 0.1)',
  },
  none: {
    borderColor: 'transparent',
    background: 'transparent',
  },
};

const selectionIndicatorColors: Record<string, string> = {
  source: '#22c55e',
  target: '#3b82f6',
};

// =============================================================================
// Component
// =============================================================================

/**
 * Renders absolutely-positioned click targets over each component that has
 * a `data-component-id` attribute in the container.
 *
 * @param props - {@link ComponentClickOverlayProps}
 * @returns A React element with overlay click targets, or null if no components found.
 */
export function ComponentClickOverlay({
  containerRef,
  selections,
  onComponentClick,
  interactive,
  branchLabel,
}: ComponentClickOverlayProps): React.ReactElement | null {
  const [positions, setPositions] = useState<ComponentPosition[]>([]);

  const updatePositions = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setPositions([]);
      return;
    }

    const elements = container.querySelectorAll('[data-component-id]');
    if (elements.length === 0) {
      setPositions([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const newPositions: ComponentPosition[] = [];

    elements.forEach((el) => {
      const componentId = el.getAttribute('data-component-id');
      if (!componentId) return;

      const rect = el.getBoundingClientRect();
      newPositions.push({
        componentId,
        top: rect.top - containerRect.top,
        left: rect.left - containerRect.left,
        width: rect.width,
        height: rect.height,
      });
    });

    setPositions(newPositions);
  }, [containerRef]);

  useEffect(() => {
    updatePositions();

    const container = containerRef.current;
    if (!container) return;

    // Use ResizeObserver to track position changes
    const observer = new ResizeObserver(() => {
      updatePositions();
    });
    observer.observe(container);

    // Also listen for window resize
    const handleResize = () => updatePositions();
    window.addEventListener('resize', handleResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [containerRef, updatePositions]);

  if (positions.length === 0) {
    return null;
  }

  return (
    <div
      className="component-click-overlay"
      style={overlayContainerStyle}
      aria-label={`${branchLabel} component overlay`}
    >
      {positions.map((pos) => {
        const selection = selections[pos.componentId] || 'none';
        const colorStyle = selectionColors[selection] ?? selectionColors['none'] ?? {};
        const indicatorColor = selectionIndicatorColors[selection];

        return (
          <div
            key={pos.componentId}
            data-testid={`component-overlay-${pos.componentId}`}
            style={{
              position: 'absolute',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              height: pos.height,
              cursor: interactive ? 'pointer' : 'default',
              pointerEvents: interactive ? 'auto' : 'none',
              border: `2px solid ${colorStyle.borderColor}`,
              borderRadius: '4px',
              background: colorStyle.background,
              transition: 'border-color 0.15s, background 0.15s',
              boxSizing: 'border-box',
            }}
            onClick={
              interactive
                ? (e) => {
                    e.stopPropagation();
                    onComponentClick(pos.componentId);
                  }
                : undefined
            }
          >
            {/* Selection indicator badge */}
            {indicatorColor && (
              <div
                className="component-click-overlay__indicator"
                style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '-6px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: indicatorColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: '#fff',
                  fontWeight: 700,
                }}
              >
                {'\u2713'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
