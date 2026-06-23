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
  it('shows "Publish to live" for modified without drift on main', () => {
    render(<PublishControl docState="modified" context="main" onPublish={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Publish to live' })).toBeTruthy();
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
    render(<PublishControl docState="modified" context="main" onPublish={onPublish} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to live' }));
    expect(onPublish).not.toHaveBeenCalled();
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
    render(<PublishControl docState="modified" context="main" onPublish={vi.fn()} />);
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
    render(<PublishControl docState="modified" context="main" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to live' }));
    const { getByText } = render(__toastCalls[0].content as React.ReactElement);
    expect(getByText('Publish directly to live site?')).toBeTruthy();
  });

  it('toast content Confirm button calls onPublish', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);
    render(<PublishControl docState="modified" context="main" onPublish={onPublish} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to live' }));
    const { getByRole } = render(__toastCalls[0].content as React.ReactElement);
    fireEvent.click(getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
  });

  it('SplitButton remains visible after publish is requested (toast is separate)', () => {
    render(<PublishControl docState="modified" context="main" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish to live' }));
    expect(screen.getByRole('button', { name: 'Publish to live' })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Dropdown menu — modified on branch
// ---------------------------------------------------------------------------

describe('PublishControl — dropdown: modified on main', () => {
  it('renders the SplitButton more-actions trigger for modified on main', () => {
    render(<PublishControl docState="modified" context="main" onPublish={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
  });

  it('shows "Schedule publish" (disabled) in the dropdown', async () => {
    render(<PublishControl docState="modified" context="main" onPublish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => {
      const item = screen.getByText('Schedule publish');
      expect(item).toBeTruthy();
      expect(item.closest('button')?.disabled).toBe(true);
    });
  });

  it('does not show "Create a new workstream" for modified on main', async () => {
    render(<PublishControl docState="modified" context="main" onPublish={vi.fn()} />);
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
      <PublishControl docState="modified" context="main" onPublish={vi.fn()} />,
    );
    expect(screen.queryByTestId('drift-warning')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Branch context behavior
// ---------------------------------------------------------------------------

describe('PublishControl — branch context behavior', () => {
  it('shows "Review" as primary button for modified on branch (no drift)', () => {
    const onReviewWorkstream = vi.fn();
    render(
      <PublishControl
        docState="modified"
        context="branch"
        onReviewWorkstream={onReviewWorkstream}
        onPublish={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
  });

  it('shows "Review" as primary button for modified on branch (with drift)', () => {
    const onReviewWorkstream = vi.fn();
    render(
      <PublishControl
        docState="modified"
        hasDrift={true}
        context="branch"
        onReviewWorkstream={onReviewWorkstream}
        onPublish={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
    // Should NOT show "Review & publish" anymore
    expect(screen.queryByText('Review & publish')).toBeNull();
  });

  it('shows "Publish this page to Live" in dropdown for modified on branch', async () => {
    const onReviewWorkstream = vi.fn();
    const onPublish = vi.fn();
    render(
      <PublishControl
        docState="modified"
        context="branch"
        onReviewWorkstream={onReviewWorkstream}
        onPublish={onPublish}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => {
      expect(screen.getByText('Publish this page to Live')).toBeTruthy();
    });
  });

  it('calls onReviewWorkstream when "Review" is clicked', () => {
    const onReviewWorkstream = vi.fn();
    render(
      <PublishControl
        docState="modified"
        context="branch"
        onReviewWorkstream={onReviewWorkstream}
        onPublish={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onReviewWorkstream).toHaveBeenCalledTimes(1);
  });

  it('keeps "Publish to live" for modified on main (not branch)', () => {
    render(
      <PublishControl
        docState="modified"
        context="main"
        onPublish={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Publish to live' })).toBeTruthy();
    expect(screen.queryByText('Review')).toBeNull();
  });

  it('shows drift warning in "Publish this page to Live" dropdown item when hasDrift is true', async () => {
    const onReviewWorkstream = vi.fn();
    const onPublish = vi.fn();
    render(
      <PublishControl
        docState="modified"
        hasDrift={true}
        context="branch"
        onReviewWorkstream={onReviewWorkstream}
        onPublish={onPublish}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => {
      const publishItem = screen.getByText(/Publish this page to Live/);
      expect(publishItem.textContent).toContain('⚠️ Page changed since you edited');
    });
  });

  it('does NOT show drift warning when hasDrift is false', async () => {
    const onReviewWorkstream = vi.fn();
    const onPublish = vi.fn();
    render(
      <PublishControl
        docState="modified"
        hasDrift={false}
        context="branch"
        onReviewWorkstream={onReviewWorkstream}
        onPublish={onPublish}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => {
      const publishItem = screen.getByText('Publish this page to Live');
      expect(publishItem.textContent).not.toContain('⚠️');
    });
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
    render(<PublishControl docState="modified" context="main" onPublish={vi.fn()} />);
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
