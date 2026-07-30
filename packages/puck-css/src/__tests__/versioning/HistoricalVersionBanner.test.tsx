/**
 * Unit tests for HistoricalVersionBanner.
 *
 * Covers: version label rendering, date formatting, exit-preview and
 * revert button rendering/interaction, reverting loading state,
 * and the actions-group wrapper that replaced the flex-spacer layout.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';
import { HistoricalVersionBanner } from '../../versioning/components/HistoricalVersionBanner.js';

afterEach(() => {
  cleanup();
});

const baseVersion: DocumentVersion = {
  id: 'v-42',
  documentId: 'doc-1',
  branchId: 'branch-1',
  versionNumber: 42,
  createdAt: '2024-06-15T14:30:00Z',
  snapshot: {},
  crdtState: null,
  source: 'edit',
  createdById: 'user-1',
  createdByType: 'user',
};

describe('HistoricalVersionBanner — version label and date', () => {
  it('renders "Previewing v{N}" with the correct version number', () => {
    render(
      <HistoricalVersionBanner version={baseVersion} onReturnToLatest={() => {}} />,
    );
    expect(screen.getByText(/Previewing/)).toBeInTheDocument();
    expect(screen.getByText(/v42/)).toBeInTheDocument();
  });

  it('renders the formatted date from createdAt', () => {
    render(
      <HistoricalVersionBanner version={baseVersion} onReturnToLatest={() => {}} />,
    );
    // Jun 15 is in the formatted date string
    const dateEl = document.querySelector('.historical-version-banner__date');
    expect(dateEl?.textContent).toMatch(/Jun 15/);
  });
});

describe('HistoricalVersionBanner — exit-preview button', () => {
  it('renders an "Exit preview" button with aria-label "Return to current"', () => {
    render(
      <HistoricalVersionBanner version={baseVersion} onReturnToLatest={() => {}} />,
    );
    const btn = screen.getByRole('button', { name: /return to current/i });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain('Exit preview');
  });

  it('calls onReturnToLatest when the exit button is clicked', () => {
    const onReturnToLatest = vi.fn();
    render(
      <HistoricalVersionBanner version={baseVersion} onReturnToLatest={onReturnToLatest} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /return to current/i }));
    expect(onReturnToLatest).toHaveBeenCalledOnce();
  });

  it('exit button has the __exit-btn CSS class', () => {
    render(
      <HistoricalVersionBanner version={baseVersion} onReturnToLatest={() => {}} />,
    );
    const btn = screen.getByRole('button', { name: /return to current/i });
    expect(btn.className).toContain('historical-version-banner__exit-btn');
  });
});

describe('HistoricalVersionBanner — revert button visibility', () => {
  it('does not render a revert button when canRevert is false (default)', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        onRestoreVersion={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Revert to this version/i)).not.toBeInTheDocument();
  });

  it('does not render a revert button when canRevert is true but no handler provided', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
      />,
    );
    expect(screen.queryByText(/Revert to this version/i)).not.toBeInTheDocument();
  });

  it('renders the revert button when canRevert=true and onRestoreVersion is provided', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={vi.fn()}
      />,
    );
    expect(screen.getByText(/Revert to this version/i)).toBeInTheDocument();
  });

  it('revert button has the __revert-btn CSS class', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={vi.fn()}
      />,
    );
    const btns = screen.getAllByRole('button');
    const revertBtn = btns.find((b) => b.textContent?.includes('Revert to this version'));
    expect(revertBtn?.className).toContain('historical-version-banner__revert-btn');
  });
});

describe('HistoricalVersionBanner — revert interaction', () => {
  it('calls onRestoreVersion with the current version when the revert button is clicked', async () => {
    const onRestoreVersion = vi.fn().mockResolvedValue(undefined);
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={onRestoreVersion}
      />,
    );
    fireEvent.click(screen.getByText(/Revert to this version/i));
    await waitFor(() => expect(onRestoreVersion).toHaveBeenCalledWith(baseVersion));
  });

  it('shows "Reverting…" text while onRestoreVersion is in progress', async () => {
    let resolve: () => void = () => {};
    const onRestoreVersion = vi.fn().mockReturnValue(
      new Promise<void>((res) => { resolve = res; }),
    );
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={onRestoreVersion}
      />,
    );
    fireEvent.click(screen.getByText(/Revert to this version/i));
    await waitFor(() => expect(screen.getByText(/Reverting…/)).toBeInTheDocument());
    await act(async () => { resolve(); });
  });

  it('disables both buttons while reverting', async () => {
    let resolve: () => void = () => {};
    const onRestoreVersion = vi.fn().mockReturnValue(
      new Promise<void>((res) => { resolve = res; }),
    );
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={onRestoreVersion}
      />,
    );
    fireEvent.click(screen.getByText(/Revert to this version/i));
    await waitFor(() => {
      const allBtns = screen.getAllByRole('button');
      allBtns.forEach((btn) => expect(btn).toBeDisabled());
    });
    await act(async () => { resolve(); });
  });

  it('restores button state after revert resolves', async () => {
    const onRestoreVersion = vi.fn().mockResolvedValue(undefined);
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={onRestoreVersion}
      />,
    );
    fireEvent.click(screen.getByText(/Revert to this version/i));
    await waitFor(() => expect(screen.queryByText(/Reverting…/)).not.toBeInTheDocument());
    const exitBtn = screen.getByRole('button', { name: /return to current/i });
    expect(exitBtn).not.toBeDisabled();
  });

  it('shows an error alert when onRestoreVersion rejects', async () => {
    const onRestoreVersion = vi.fn().mockRejectedValue(new Error('Network error'));
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={onRestoreVersion}
      />,
    );
    fireEvent.click(screen.getByText(/Revert to this version/i));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toContain('Network error');
  });

  it('shows fallback error message when rejection has no message', async () => {
    const onRestoreVersion = vi.fn().mockRejectedValue('something broke');
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={onRestoreVersion}
      />,
    );
    fireEvent.click(screen.getByText(/Revert to this version/i));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toContain('Revert failed');
  });

  it('clears error message when revert is retried successfully', async () => {
    const onRestoreVersion = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(undefined);
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={onRestoreVersion}
      />,
    );
    fireEvent.click(screen.getByText(/Revert to this version/i));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Revert to this version/i));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('HistoricalVersionBanner — Previous / Next steppers', () => {
  it('renders a Previous button when onPrevious is provided', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        onPrevious={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /previous version/i })).toBeInTheDocument();
  });

  it('renders a Next button when onNext is provided', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /next version/i })).toBeInTheDocument();
  });

  it('Previous button is disabled when hasPrevious is false', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        onPrevious={vi.fn()}
        hasPrevious={false}
      />,
    );
    expect(screen.getByRole('button', { name: /previous version/i })).toBeDisabled();
  });

  it('Next button is disabled when hasNext is false', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        onNext={vi.fn()}
        hasNext={false}
      />,
    );
    expect(screen.getByRole('button', { name: /next version/i })).toBeDisabled();
  });

  it('Previous button is enabled when hasPrevious is true', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        onPrevious={vi.fn()}
        hasPrevious={true}
      />,
    );
    expect(screen.getByRole('button', { name: /previous version/i })).not.toBeDisabled();
  });

  it('Next button is enabled when hasNext is true', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        onNext={vi.fn()}
        hasNext={true}
      />,
    );
    expect(screen.getByRole('button', { name: /next version/i })).not.toBeDisabled();
  });

  it('calls onPrevious when Previous button is clicked', () => {
    const onPrevious = vi.fn();
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        onPrevious={onPrevious}
        hasPrevious={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /previous version/i }));
    expect(onPrevious).toHaveBeenCalledOnce();
  });

  it('calls onNext when Next button is clicked', () => {
    const onNext = vi.fn();
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        onNext={onNext}
        hasNext={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /next version/i }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('does not render steppers when neither onPrevious nor onNext is provided', () => {
    render(
      <HistoricalVersionBanner version={baseVersion} onReturnToLatest={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: /previous version/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next version/i })).not.toBeInTheDocument();
  });

  it('steppers are disabled while reverting', async () => {
    let resolve: () => void = () => {};
    const onRestoreVersion = vi.fn().mockReturnValue(
      new Promise<void>((res) => { resolve = res; }),
    );
    const onPrevious = vi.fn();
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={onRestoreVersion}
        onPrevious={onPrevious}
        hasPrevious={true}
      />,
    );
    fireEvent.click(screen.getByText(/Revert to this version/i));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /previous version/i })).toBeDisabled();
    });
    await act(async () => { resolve(); });
  });
});

describe('HistoricalVersionBanner — actions wrapper', () => {
  it('groups exit and revert buttons inside the __actions div', () => {
    render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        canRevert={true}
        onRestoreVersion={vi.fn()}
      />,
    );
    const actionsDiv = document.querySelector('.historical-version-banner__actions');
    expect(actionsDiv).toBeInTheDocument();
    const btns = actionsDiv?.querySelectorAll('button');
    expect(btns?.length).toBe(2);
  });

  it('applies the correct base CSS class to the banner element', () => {
    const { container } = render(
      <HistoricalVersionBanner version={baseVersion} onReturnToLatest={() => {}} />,
    );
    expect(container.firstChild).toHaveClass('historical-version-banner');
  });

  it('appends an extra className prop to the banner element', () => {
    const { container } = render(
      <HistoricalVersionBanner
        version={baseVersion}
        onReturnToLatest={() => {}}
        className="my-custom-class"
      />,
    );
    expect(container.firstChild).toHaveClass('historical-version-banner');
    expect(container.firstChild).toHaveClass('my-custom-class');
  });
});
