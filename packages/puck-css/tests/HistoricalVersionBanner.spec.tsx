/**
 * HistoricalVersionBanner Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoricalVersionBanner } from '../src/versioning/components/HistoricalVersionBanner.js';
import type { DocumentVersion } from '@pantheon-systems/css-client';

describe('HistoricalVersionBanner', () => {
  const mockVersion: DocumentVersion = {
    id: 'v1',
    documentId: 'd1',
    versionNumber: 5,
    snapshot: {},
    createdAt: new Date('2024-01-15T10:30:00Z').toISOString(),
    createdBy: 'user1',
  };

  it('should display the version number', () => {
    const onReturnToLatest = vi.fn();
    render(
      <HistoricalVersionBanner
        version={mockVersion}
        onReturnToLatest={onReturnToLatest}
      />
    );

    expect(screen.getByText(/version 5/i)).toBeInTheDocument();
  });

  it('should display the version date', () => {
    const onReturnToLatest = vi.fn();
    render(
      <HistoricalVersionBanner
        version={mockVersion}
        onReturnToLatest={onReturnToLatest}
      />
    );

    // Should show Jan 15
    expect(screen.getByText(/jan 15/i)).toBeInTheDocument();
  });

  it('should display read-only indicator', () => {
    const onReturnToLatest = vi.fn();
    render(
      <HistoricalVersionBanner
        version={mockVersion}
        onReturnToLatest={onReturnToLatest}
      />
    );

    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it('should display return to current button', () => {
    const onReturnToLatest = vi.fn();
    render(
      <HistoricalVersionBanner
        version={mockVersion}
        onReturnToLatest={onReturnToLatest}
      />
    );

    expect(screen.getByRole('button', { name: /return to current/i })).toBeInTheDocument();
  });

  it('should call onReturnToLatest when button is clicked', () => {
    const onReturnToLatest = vi.fn();
    render(
      <HistoricalVersionBanner
        version={mockVersion}
        onReturnToLatest={onReturnToLatest}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /return to current/i }));
    expect(onReturnToLatest).toHaveBeenCalledTimes(1);
  });

  it('should apply custom className', () => {
    const onReturnToLatest = vi.fn();
    const { container } = render(
      <HistoricalVersionBanner
        version={mockVersion}
        onReturnToLatest={onReturnToLatest}
        className="custom-class"
      />
    );

    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });
});
