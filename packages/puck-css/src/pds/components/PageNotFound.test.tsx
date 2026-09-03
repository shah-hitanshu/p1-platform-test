/**
 * Tests for <PageNotFound />.
 *
 * The panel shown when an editor path has no page behind it. Only users who
 * may create pages are offered "Create page"; everyone gets the way home.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { PageNotFound } from './PageNotFound.js';

afterEach(() => {
  cleanup();
});

describe('PageNotFound', () => {
  it('asks whether to create the page, and tags both actions for e2e', () => {
    render(<PageNotFound canCreate onCreate={vi.fn()} onOpenHome={vi.fn()} />);

    expect(screen.getByText("This page doesn't exist")).toBeInTheDocument();
    expect(screen.getByText('Do you want to create it?')).toBeInTheDocument();
    expect(screen.getByTestId('editor-page-not-found-create')).toBeInTheDocument();
    expect(screen.getByTestId('editor-page-not-found-home')).toBeInTheDocument();
  });

  // Someone who cannot create the page should not be asked whether to.
  it('drops the question when the user cannot create the page', () => {
    render(<PageNotFound onCreate={vi.fn()} onOpenHome={vi.fn()} />);

    expect(screen.getByText("This page doesn't exist")).toBeInTheDocument();
    expect(screen.queryByText('Do you want to create it?')).not.toBeInTheDocument();
  });

  it('offers "Create page" only when the user may create one', () => {
    const { rerender } = render(
      <PageNotFound onOpenHome={vi.fn()} onCreate={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Create page' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open home page' })).toBeInTheDocument();

    rerender(
      <PageNotFound canCreate onOpenHome={vi.fn()} onCreate={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Create page' })).toBeInTheDocument();
  });

  it('creates the page and reports failures in place', async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error('Branch is read-only'));

    render(<PageNotFound canCreate onCreate={onCreate} onOpenHome={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create page' }));

    expect(onCreate).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Branch is read-only'));
    // The failure leaves the action usable rather than stuck mid-create.
    expect(screen.getByRole('button', { name: 'Create page' })).toBeEnabled();
  });

  it('navigates home', async () => {
    const onOpenHome = vi.fn();

    render(<PageNotFound onOpenHome={onOpenHome} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open home page' }));

    expect(onOpenHome).toHaveBeenCalledOnce();
  });
});
