/**
 * Tests for <PublishControl />.
 *
 * PublishControl is a compound component that owns DocStateBadge internally.
 * It uses PDS SplitButton for actionable states and renders badge-only for
 * states with no publish action.
 *
 * States: 'modified' | 'unpublished' | 'live' | 'liveOnly'
 * Context: 'branch' | 'main'
 *
 * The badge is always present. The SplitButton appears only when there is
 * a publish action available. The dropdown menu renders only when it has items.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { PublishControl } from './PublishControl.js';
import { __toastCalls } from '@pantheon-systems/pds-toolkit-react';

beforeEach(() => {
  __toastCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Badge is always rendered
// ---------------------------------------------------------------------------

describe('PublishControl — badge always present', () => {
  it('renders DocStateBadge for modified state', () => {
    render(<PublishControl docState="modified" context="branch" />);
    expect(screen.getByText('Modified')).toBeTruthy();
  });

  it('renders DocStateBadge for unpublished state', () => {
    render(<PublishControl docState="unpublished" context="main" />);
    expect(screen.getByText('Unpublished')).toBeTruthy();
  });

  it('renders DocStateBadge for live state on main', () => {
    render(<PublishControl docState="live" context="main" />);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('renders DocStateBadge for live state on branch', () => {
    render(<PublishControl docState="live" context="branch" />);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('renders DocStateBadge for liveOnly state', () => {
    render(<PublishControl docState="liveOnly" context="branch" />);
    expect(screen.getByText('Live only')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Primary button presence and label
// ---------------------------------------------------------------------------

describe('PublishControl — primary button label', () => {
  it('shows "Publish to live" for modified without drift', () => {
    render(<PublishControl docState="modified" context="branch" onPublish={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Publish to live' })).toBeTruthy();
  });

  it('shows "Review & publish" for modified with drift', () => {
    render(
      <PublishControl
        docState="modified"
        hasDrift={true}
        context="branch"
        onReviewAndPublish={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Review & publish' })).toBeTruthy();
  });

  it('shows "Publish" for unpublished on main', () => {
    render(<PublishControl docState="unpublished" context="main" onPublish={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
  });

  it('does not render a primary button for live on main', () => {
    render(<PublishControl docState="live" context="main" />);
    const buttons = screen.queryAllByRole('button');
    const publishButtons = buttons.filter(
      (btn) =>
        btn.textContent?.includes('Publish') ||
        btn.textContent?.includes('Review'),
    );
    expect(publishButtons.length).toBe(0);
  });

  it('does not render a primary button for live on branch', () => {
    render(<PublishControl docState="live" context="branch" />);
    const buttons = screen.queryAllByRole('button');
    const publishButtons = buttons.filter(
      (btn) =>
        btn.textContent?.includes('Publish') ||
        btn.textContent?.includes('Review'),
    );
    expect(publishButtons.length).toBe(0);
  });

  it('does not render a primary button for liveOnly', () => {
    render(<PublishControl docState="liveOnly" context="branch" />);
    const buttons = screen.queryAllByRole('button');
    const publishButtons = buttons.filter(
      (btn) =>
        btn.textContent?.includes('Publish') ||
        btn.textContent?.includes('Review'),
    );
    expect(publishButtons.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Primary button callbacks
// ---------------------------------------------------------------------------

describe('PublishControl — primary button callbacks', () => {
  it('does not call onPublish immediately when "Publish to live" is clicked (toast confirmation required)', () => {
    const onPublish = vi.fn();
    render(<PublishControl docState="modified" context="branch" onPublish={onPublish} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to live' }));
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('calls onReviewAndPublish directly when "Review & publish" is clicked (no confirmation)', () => {
    const onReviewAndPublish = vi.fn();
    render(
      <PublishControl
        docState="modified"
        hasDrift={true}
        context="branch"
        onReviewAndPublish={onReviewAndPublish}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }));
    expect(onReviewAndPublish).toHaveBeenCalledTimes(1);
  });

  it('does not call onPublish immediately when "Publish" is clicked for unpublished on main', () => {
    const onPublish = vi.fn();
    render(<PublishControl docState="unpublished" context="main" onPublish={onPublish} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onPublish).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Confirmation via Toaster
// ---------------------------------------------------------------------------

describe('PublishControl — confirmation toast', () => {
  it('triggers a warning toast when "Publish to live" is clicked', () => {
    render(<PublishControl docState="modified" context="branch" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to live' }));
    expect(__toastCalls).toHaveLength(1);
    expect(__toastCalls[0].type).toBe('warning');
  });

  it('triggers a warning toast when "Publish" is clicked for unpublished on main', () => {
    render(<PublishControl docState="unpublished" context="main" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(__toastCalls).toHaveLength(1);
    expect(__toastCalls[0].type).toBe('warning');
  });

  it('toast content includes "Publish directly to live site?" text', () => {
    render(<PublishControl docState="modified" context="branch" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to live' }));
    const { getByText } = render(__toastCalls[0].content as React.ReactElement);
    expect(getByText('Publish directly to live site?')).toBeTruthy();
  });

  it('toast content Confirm button calls onPublish', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);
    render(<PublishControl docState="modified" context="branch" onPublish={onPublish} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to live' }));
    const { getByRole } = render(__toastCalls[0].content as React.ReactElement);
    fireEvent.click(getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
  });

  it('SplitButton remains visible after publish is requested (toast is separate)', () => {
    render(<PublishControl docState="modified" context="branch" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to live' }));
    expect(screen.getByRole('button', { name: 'Publish to live' })).toBeTruthy();
  });

  it('does not trigger a toast for "Review & publish"', () => {
    render(
      <PublishControl
        docState="modified"
        hasDrift={true}
        context="branch"
        onReviewAndPublish={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }));
    expect(__toastCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dropdown menu — modified on branch
// ---------------------------------------------------------------------------

describe('PublishControl — dropdown: modified on branch', () => {
  it('renders the SplitButton more-actions trigger for modified on branch', () => {
    render(<PublishControl docState="modified" context="branch" onPublish={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
  });

  it('shows "Schedule publish" (disabled) in the dropdown', async () => {
    render(<PublishControl docState="modified" context="branch" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => {
      const item = screen.getByText('Schedule publish');
      expect(item).toBeTruthy();
      expect(item.closest('button')?.disabled).toBe(true);
    });
  });

  it('does not show "Create a new workstream" for modified on branch', async () => {
    render(<PublishControl docState="modified" context="branch" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => {
      expect(screen.queryByText('Create a new workstream')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Dropdown menu — unpublished on main
// ---------------------------------------------------------------------------

describe('PublishControl — dropdown: unpublished on main', () => {
  it('renders the SplitButton more-actions trigger for unpublished on main', () => {
    render(<PublishControl docState="unpublished" context="main" onPublish={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
  });

  it('shows "Create a new workstream" in the dropdown', async () => {
    const onCreateWorkstream = vi.fn();
    render(
      <PublishControl
        docState="unpublished"
        context="main"
        onPublish={vi.fn()}
        onCreateWorkstream={onCreateWorkstream}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => {
      expect(screen.getByText('Create a new workstream')).toBeTruthy();
    });
  });

  it('calls onCreateWorkstream when "Create a new workstream" is clicked', async () => {
    const onCreateWorkstream = vi.fn();
    render(
      <PublishControl
        docState="unpublished"
        context="main"
        onPublish={vi.fn()}
        onCreateWorkstream={onCreateWorkstream}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => {
      expect(screen.getByText('Create a new workstream')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Create a new workstream'));
    expect(onCreateWorkstream).toHaveBeenCalledTimes(1);
  });

  it('shows "Schedule publish" (disabled) in the dropdown', async () => {
    render(<PublishControl docState="unpublished" context="main" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => {
      const item = screen.getByText('Schedule publish');
      expect(item).toBeTruthy();
      expect(item.closest('button')?.disabled).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// No SplitButton for states with no actions
// ---------------------------------------------------------------------------

describe('PublishControl — no SplitButton', () => {
  it('does not render SplitButton for live on main', () => {
    render(<PublishControl docState="live" context="main" />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('does not render SplitButton for live on branch', () => {
    render(<PublishControl docState="live" context="branch" />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('does not render SplitButton for liveOnly on branch', () => {
    render(<PublishControl docState="liveOnly" context="branch" />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasDrift forwarded to badge
// ---------------------------------------------------------------------------

describe('PublishControl — drift forwarded to badge', () => {
  it('renders drift warning in badge when modified + hasDrift', () => {
    render(
      <PublishControl docState="modified" hasDrift={true} context="branch" onReviewAndPublish={vi.fn()} />,
    );
    expect(screen.getByTestId('drift-warning')).toBeTruthy();
  });

  it('renders drift warning in badge when liveOnly + hasDrift', () => {
    render(
      <PublishControl docState="liveOnly" hasDrift={true} context="branch" />,
    );
    expect(screen.getByTestId('drift-warning')).toBeTruthy();
  });

  it('does not render drift warning in badge when modified without drift', () => {
    render(
      <PublishControl docState="modified" context="branch" onPublish={vi.fn()} />,
    );
    expect(screen.queryByTestId('drift-warning')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Compound component — no external DocStateBadge needed
// ---------------------------------------------------------------------------

describe('PublishControl — compound component structure', () => {
  it('wraps everything in a single container with data-testid', () => {
    render(<PublishControl docState="modified" context="branch" onPublish={vi.fn()} />);
    const container = screen.getByTestId('publish-control');
    expect(container).toBeTruthy();
    expect(container.querySelector('.pds-status-indicator')).toBeTruthy();
  });

  it('badge and SplitButton coexist inside the container for modified', () => {
    render(<PublishControl docState="modified" context="branch" onPublish={vi.fn()} />);
    const container = screen.getByTestId('publish-control');
    expect(container.querySelector('.pds-status-indicator')).toBeTruthy();
    expect(container.querySelector('.pds-split-button')).toBeTruthy();
  });

  it('only badge is inside the container for live on branch (no SplitButton)', () => {
    render(<PublishControl docState="live" context="branch" />);
    const container = screen.getByTestId('publish-control');
    expect(container.querySelector('.pds-status-indicator')).toBeTruthy();
    expect(container.querySelector('.pds-split-button')).toBeNull();
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });
});
