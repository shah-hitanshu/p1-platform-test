import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PreviewPanelOverlay } from '../../editor/components/PreviewPanelOverlay';

describe('PreviewPanelOverlay — not previewing', () => {
  it('renders children when not previewing', () => {
    render(
      <PreviewPanelOverlay isViewingHistoricalVersion={false}>
        <div>panel content</div>
      </PreviewPanelOverlay>,
    );
    expect(screen.getByText('panel content')).toBeInTheDocument();
  });

  it('does not show overlay when not previewing', () => {
    render(
      <PreviewPanelOverlay isViewingHistoricalVersion={false}>
        <div>panel content</div>
      </PreviewPanelOverlay>,
    );
    expect(screen.queryByText(/back to current version/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you're viewing/i)).not.toBeInTheDocument();
  });

  it('does not show overlay when isViewingHistoricalVersion is omitted', () => {
    render(
      <PreviewPanelOverlay>
        <div>panel content</div>
      </PreviewPanelOverlay>,
    );
    expect(screen.queryByText(/back to current version/i)).not.toBeInTheDocument();
  });
});

describe('PreviewPanelOverlay — previewing', () => {
  it('shows overlay when isViewingHistoricalVersion is true', () => {
    render(
      <PreviewPanelOverlay isViewingHistoricalVersion={true} versionNumber={3}>
        <div>panel content</div>
      </PreviewPanelOverlay>,
    );
    expect(screen.getByText(/you're viewing/i)).toBeInTheDocument();
  });

  it('displays the version number in the overlay', () => {
    render(
      <PreviewPanelOverlay isViewingHistoricalVersion={true} versionNumber={7}>
        <div>panel content</div>
      </PreviewPanelOverlay>,
    );
    expect(screen.getByText(/v7/i)).toBeInTheDocument();
  });

  it('shows "Back to current version" button', () => {
    render(
      <PreviewPanelOverlay isViewingHistoricalVersion={true} versionNumber={2}>
        <div>panel content</div>
      </PreviewPanelOverlay>,
    );
    expect(screen.getByRole('button', { name: /back to current version/i })).toBeInTheDocument();
  });

  it('calls onExitPreview when "Back to current version" is clicked', () => {
    const onExitPreview = vi.fn();
    render(
      <PreviewPanelOverlay
        isViewingHistoricalVersion={true}
        versionNumber={2}
        onExitPreview={onExitPreview}
      >
        <div>panel content</div>
      </PreviewPanelOverlay>,
    );
    fireEvent.click(screen.getByRole('button', { name: /back to current version/i }));
    expect(onExitPreview).toHaveBeenCalledTimes(1);
  });

  it('still renders children beneath the overlay while previewing', () => {
    render(
      <PreviewPanelOverlay isViewingHistoricalVersion={true} versionNumber={3}>
        <div>panel content</div>
      </PreviewPanelOverlay>,
    );
    expect(screen.getByText('panel content')).toBeInTheDocument();
  });

  it('overlay wrapper has position relative to contain the absolute overlay', () => {
    const { container } = render(
      <PreviewPanelOverlay isViewingHistoricalVersion={true} versionNumber={2}>
        <div>content</div>
      </PreviewPanelOverlay>,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('css-preview-panel-overlay__wrapper');
  });

  it('overlay element has correct CSS class', () => {
    render(
      <PreviewPanelOverlay isViewingHistoricalVersion={true} versionNumber={2}>
        <div>content</div>
      </PreviewPanelOverlay>,
    );
    const overlay = document.querySelector('.css-preview-panel-overlay');
    expect(overlay).toBeInTheDocument();
  });
});
