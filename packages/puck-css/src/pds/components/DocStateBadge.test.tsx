/**
 * Tests for <DocStateBadge />.
 *
 * DocStateBadge wraps PDS StatusIndicator, mapping four document states
 * to the appropriate status type and label. It also supports a `hasDrift`
 * boolean for the `modified` and `liveOnly` states, rendering a warning
 * indicator with a tooltip when drift is detected.
 *
 * States:
 *   'modified'    → warning  / "Modified"
 *   'unpublished' → warning  / "Unpublished"
 *   'live'        → success  / "Live"
 *   'liveOnly'    → info     / "Live only"
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { DocStateBadge } from './DocStateBadge.js';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Label text
// ---------------------------------------------------------------------------

describe('DocStateBadge — label text', () => {
  it('renders "Modified" for the modified state', () => {
    render(<DocStateBadge docState="modified" />);
    expect(screen.getByText('Modified')).toBeTruthy();
  });

  it('renders "Unpublished" for the unpublished state', () => {
    render(<DocStateBadge docState="unpublished" />);
    expect(screen.getByText('Unpublished')).toBeTruthy();
  });

  it('renders "Live" for the live state', () => {
    render(<DocStateBadge docState="live" />);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('renders "Live only" for the liveOnly state', () => {
    render(<DocStateBadge docState="liveOnly" />);
    expect(screen.getByText('Live only')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Status type mapping — correct PDS StatusIndicator type class
// ---------------------------------------------------------------------------

describe('DocStateBadge — status type', () => {
  it('maps modified to the warning status type', () => {
    const { container } = render(<DocStateBadge docState="modified" />);
    expect(container.querySelector('.pds-status-indicator--warning')).toBeTruthy();
  });

  it('maps unpublished to the warning status type', () => {
    const { container } = render(<DocStateBadge docState="unpublished" />);
    expect(container.querySelector('.pds-status-indicator--warning')).toBeTruthy();
  });

  it('maps live to the success status type', () => {
    const { container } = render(<DocStateBadge docState="live" />);
    expect(container.querySelector('.pds-status-indicator--success')).toBeTruthy();
  });

  it('maps liveOnly to the info status type', () => {
    const { container } = render(<DocStateBadge docState="liveOnly" />);
    expect(container.querySelector('.pds-status-indicator--info')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Status dot presence
// ---------------------------------------------------------------------------

describe('DocStateBadge — status dot', () => {
  it('renders a status icon element for each state', () => {
    const states = ['modified', 'unpublished', 'live', 'liveOnly'] as const;
    for (const docState of states) {
      const { container, unmount } = render(<DocStateBadge docState={docState} />);
      expect(container.querySelector('.pds-status-indicator__icon')).toBeTruthy();
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// hasDrift indicator
// ---------------------------------------------------------------------------

describe('DocStateBadge — hasDrift', () => {
  it('does not render a drift warning when hasDrift is false for modified', () => {
    render(<DocStateBadge docState="modified" hasDrift={false} />);
    expect(screen.queryByTestId('drift-warning')).toBeNull();
  });

  it('renders a drift warning indicator when hasDrift is true for modified', () => {
    render(<DocStateBadge docState="modified" hasDrift={true} />);
    expect(screen.getByTestId('drift-warning')).toBeTruthy();
  });

  it('renders a drift warning indicator when hasDrift is true for liveOnly', () => {
    render(<DocStateBadge docState="liveOnly" hasDrift={true} />);
    expect(screen.getByTestId('drift-warning')).toBeTruthy();
  });

  it('does not render a drift warning when hasDrift is false for liveOnly', () => {
    render(<DocStateBadge docState="liveOnly" hasDrift={false} />);
    expect(screen.queryByTestId('drift-warning')).toBeNull();
  });

  it('does not render a drift warning for live even if hasDrift is passed', () => {
    render(<DocStateBadge docState="live" hasDrift={true} />);
    expect(screen.queryByTestId('drift-warning')).toBeNull();
  });

  it('does not render a drift warning for unpublished even if hasDrift is passed', () => {
    render(<DocStateBadge docState="unpublished" hasDrift={true} />);
    expect(screen.queryByTestId('drift-warning')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasDrift tooltip text
// ---------------------------------------------------------------------------

describe('DocStateBadge — drift tooltip', () => {
  it('shows correct tooltip for modified + hasDrift', () => {
    render(<DocStateBadge docState="modified" hasDrift={true} />);
    const warning = screen.getByTestId('drift-warning');
    expect(warning.getAttribute('title')).toBe(
      'Live has also changed this page since your branch was created. Compare before publishing.',
    );
  });

  it('shows correct tooltip for liveOnly + hasDrift', () => {
    render(<DocStateBadge docState="liveOnly" hasDrift={true} />);
    const warning = screen.getByTestId('drift-warning');
    expect(warning.getAttribute('title')).toBe(
      'Live has made additional changes since your branch was created. You will get the latest version when you start editing.',
    );
  });
});
