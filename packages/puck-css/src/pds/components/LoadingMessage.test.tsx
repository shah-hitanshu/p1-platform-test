/**
 * Tests for <LoadingMessage />.
 *
 * A full-panel "we're working on it" state: an animated indicator plus caller
 * supplied copy. The message is a prop precisely so the editor can say which
 * wait the user is in — loading a document reads differently from redirecting —
 * without each caller rebuilding the panel.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { LoadingMessage } from './LoadingMessage.js';

afterEach(() => {
  cleanup();
});

describe('LoadingMessage', () => {
  it('renders the message it is given', () => {
    render(<LoadingMessage message="Loading document" />);
    expect(screen.getByText('Loading document')).toBeTruthy();
  });

  it('renders different copy for a different wait', () => {
    render(<LoadingMessage message="Redirecting" />);
    expect(screen.getByText('Redirecting')).toBeTruthy();
  });

  it('announces itself as a live status region', () => {
    render(<LoadingMessage message="Loading document" />);
    const status = screen.getByRole('status');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('Loading document');
  });

  it('hides the decorative indicator from assistive tech', () => {
    const { container } = render(<LoadingMessage message="Loading document" />);
    const indicator = container.querySelector('[aria-hidden="true"]');
    expect(indicator).toBeTruthy();
  });

  it('accepts a test id so callers can assert on a specific wait', () => {
    render(<LoadingMessage message="Loading document" data-testid="document-loading" />);
    expect(screen.getByTestId('document-loading')).toBeTruthy();
  });
});
