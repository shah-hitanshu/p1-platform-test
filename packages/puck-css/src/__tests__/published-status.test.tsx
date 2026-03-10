/**
 * Tests for PublishedStatusBadge and VersionPublishedBadge components.
 *
 * Validates:
 * - Badge renders correct PDS status-badge markup and classes
 * - Version badge renders indicator badge with correct styling
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

// Mock css-client
vi.mock('@pantheon/css-client', () => ({
  CSSClient: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

// ============================================================
// PublishedStatusBadge Tests
// ============================================================

import { PublishedStatusBadge } from '../components/PublishedStatusBadge.js';

describe('PublishedStatusBadge', () => {
  it('renders "Published" badge with success status dot when published', () => {
    render(<PublishedStatusBadge status="published" />);

    const badge = screen.getByText('Published').closest('.pds-status-badge');
    expect(badge).toBeTruthy();
    expect(badge!.querySelector('.pds-status-badge__status--success')).toBeTruthy();
  });

  it('renders "Unpublished changes" badge with warning status dot', () => {
    render(<PublishedStatusBadge status="unpublished-changes" />);

    const badge = screen.getByText('Unpublished changes').closest('.pds-status-badge');
    expect(badge).toBeTruthy();
    expect(badge!.querySelector('.pds-status-badge__status--warning')).toBeTruthy();
  });

  it('renders "Draft" badge without status dot when never published', () => {
    render(<PublishedStatusBadge status="draft" />);

    const badge = screen.getByText('Draft').closest('.pds-status-badge');
    expect(badge).toBeTruthy();
    // Draft should not have a status dot
    expect(badge!.querySelector('.pds-status-badge__status')).toBeNull();
  });

  it('applies pds-status-badge--transparent class by default', () => {
    render(<PublishedStatusBadge status="published" />);

    const badge = screen.getByText('Published').closest('.pds-status-badge');
    expect(badge!.className).toContain('pds-status-badge--transparent');
  });

  it('accepts custom className', () => {
    render(<PublishedStatusBadge status="published" className="my-custom" />);

    const badge = screen.getByText('Published').closest('.pds-status-badge');
    expect(badge!.className).toContain('my-custom');
  });

  it('includes accessible status indicator text for screen readers', () => {
    render(<PublishedStatusBadge status="published" />);

    const srText = screen.getByText('Published')
      .closest('.pds-status-badge')!
      .querySelector('.visually-hidden');
    expect(srText).toBeTruthy();
  });
});

// ============================================================
// Version Published Indicator Badge Tests
// ============================================================

import { VersionPublishedBadge } from '../components/VersionPublishedBadge.js';

describe('VersionPublishedBadge', () => {
  it('renders indicator badge with success color and "Published" label', () => {
    render(<VersionPublishedBadge />);

    const badge = screen.getByText('Published').closest('.pds-indicator-badge');
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain('pds-indicator-badge--success');
    expect(badge!.className).toContain('pds-indicator-badge--sm');
  });

  it('renders nothing when isPublished is false', () => {
    const { container } = render(<VersionPublishedBadge isPublished={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders badge when isPublished is true (default)', () => {
    const { container } = render(<VersionPublishedBadge isPublished={true} />);
    expect(container.innerHTML).not.toBe('');
  });
});
