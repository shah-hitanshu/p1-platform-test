/**
 * Tests for <LoadingOverlay />.
 *
 * The overlay covers a wait that happens on top of content the user can still
 * see, so unlike <LoadingMessage /> it must not take the view over — and it
 * still has to announce the wait to assistive tech.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { LoadingOverlay } from './LoadingOverlay.js';

afterEach(() => {
  cleanup();
});

describe('LoadingOverlay', () => {
  it('renders the message it is given', () => {
    render(<LoadingOverlay message="Switching workstream…" />);
    expect(screen.getByText('Switching workstream…')).toBeTruthy();
  });

  it('announces itself as a live status region', () => {
    render(<LoadingOverlay message="Loading page…" />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Loading page…');
  });

  it('hides the decorative indicator from assistive tech', () => {
    const { container } = render(<LoadingOverlay message="Loading page…" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('accepts a test id so callers can assert on a specific wait', () => {
    render(<LoadingOverlay message="Loading page…" data-testid="editor-reloading" />);
    expect(screen.getByTestId('editor-reloading')).toBeTruthy();
  });
});
