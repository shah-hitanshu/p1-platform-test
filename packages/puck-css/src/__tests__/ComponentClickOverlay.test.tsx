/**
 * ComponentClickOverlay Tests
 *
 * Tests for the transparent overlay that positions click targets
 * over rendered Puck components.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentClickOverlay } from '../components/merge-resolution/ComponentClickOverlay.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Creates a container with fake data-component-id elements.
 * We need to mock getBoundingClientRect since jsdom doesn't layout.
 */
function createContainerWithComponents(componentIds: string[]): HTMLDivElement {
  const container = document.createElement('div');
  // Mock getBoundingClientRect on container
  container.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    width: 400,
    height: 600,
    right: 400,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  componentIds.forEach((id, index) => {
    const el = document.createElement('div');
    el.setAttribute('data-component-id', id);
    el.getBoundingClientRect = () => ({
      top: index * 100,
      left: 0,
      width: 400,
      height: 80,
      right: 400,
      bottom: (index + 1) * 100 - 20,
      x: 0,
      y: index * 100,
      toJSON: () => ({}),
    });
    container.appendChild(el);
  });

  return container;
}

describe('ComponentClickOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders click targets for components with data-component-id', () => {
    const container = createContainerWithComponents(['h1', 't1']);
    document.body.appendChild(container);

    const ref = { current: container };

    render(
      <ComponentClickOverlay
        containerRef={ref}
        selections={{ h1: 'none', t1: 'none' }}
        onComponentClick={vi.fn()}
        interactive={true}
        branchLabel="Draft"
      />
    );

    expect(screen.getByTestId('component-overlay-h1')).toBeDefined();
    expect(screen.getByTestId('component-overlay-t1')).toBeDefined();

    document.body.removeChild(container);
  });

  it('fires onComponentClick with correct componentId when clicked', () => {
    const container = createContainerWithComponents(['h1']);
    document.body.appendChild(container);
    const ref = { current: container };
    const onComponentClick = vi.fn();

    render(
      <ComponentClickOverlay
        containerRef={ref}
        selections={{ h1: 'none' }}
        onComponentClick={onComponentClick}
        interactive={true}
        branchLabel="Draft"
      />
    );

    fireEvent.click(screen.getByTestId('component-overlay-h1'));
    expect(onComponentClick).toHaveBeenCalledWith('h1');

    document.body.removeChild(container);
  });

  it('shows selection indicators based on selections prop', () => {
    const container = createContainerWithComponents(['h1', 't1']);
    document.body.appendChild(container);
    const ref = { current: container };

    const { container: renderContainer } = render(
      <ComponentClickOverlay
        containerRef={ref}
        selections={{ h1: 'source', t1: 'target' }}
        onComponentClick={vi.fn()}
        interactive={true}
        branchLabel="Draft"
      />
    );

    // Source selected (h1) should have green border (jsdom normalizes hex to rgb)
    const h1Overlay = screen.getByTestId('component-overlay-h1');
    expect(h1Overlay.style.borderColor).toBe('rgb(34, 197, 94)');

    // Target selected (t1) should have blue border
    const t1Overlay = screen.getByTestId('component-overlay-t1');
    expect(t1Overlay.style.borderColor).toBe('rgb(59, 130, 246)');

    // Both should have check indicators
    const indicators = renderContainer.querySelectorAll('.component-click-overlay__indicator');
    expect(indicators.length).toBe(2);

    document.body.removeChild(container);
  });

  it('does not fire clicks when interactive is false', () => {
    const container = createContainerWithComponents(['h1']);
    document.body.appendChild(container);
    const ref = { current: container };
    const onComponentClick = vi.fn();

    render(
      <ComponentClickOverlay
        containerRef={ref}
        selections={{ h1: 'none' }}
        onComponentClick={onComponentClick}
        interactive={false}
        branchLabel="Draft"
      />
    );

    const overlay = screen.getByTestId('component-overlay-h1');
    fireEvent.click(overlay);
    expect(onComponentClick).not.toHaveBeenCalled();

    // Should not have pointer cursor
    expect(overlay.style.cursor).toBe('default');

    document.body.removeChild(container);
  });

  it('renders nothing when container has no data-component-id elements', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({
      top: 0, left: 0, width: 400, height: 600,
      right: 400, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    });
    document.body.appendChild(container);
    const ref = { current: container };

    const { container: renderContainer } = render(
      <ComponentClickOverlay
        containerRef={ref}
        selections={{}}
        onComponentClick={vi.fn()}
        interactive={true}
        branchLabel="Draft"
      />
    );

    // Should render nothing (returns null)
    expect(renderContainer.querySelector('.component-click-overlay')).toBeNull();

    document.body.removeChild(container);
  });

  it('has cursor: pointer when interactive', () => {
    const container = createContainerWithComponents(['h1']);
    document.body.appendChild(container);
    const ref = { current: container };

    render(
      <ComponentClickOverlay
        containerRef={ref}
        selections={{ h1: 'none' }}
        onComponentClick={vi.fn()}
        interactive={true}
        branchLabel="Draft"
      />
    );

    const overlay = screen.getByTestId('component-overlay-h1');
    expect(overlay.style.cursor).toBe('pointer');

    document.body.removeChild(container);
  });
});
