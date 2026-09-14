/**
 * SlideOverDrawer
 *
 * A panel that enters from the right over the editor. Closing is animated, so
 * it outlives `open` by one transition and then retires itself; focus moves in
 * on open and returns to whatever opened it, and is not contained while there.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SlideOverDrawer } from '../../editor/components/SlideOverDrawer.js';

/** The drawer as a consumer holds it: a trigger owning the open state. */
function Harness({ footer }: { footer?: React.ReactNode } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      <SlideOverDrawer
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Locale diff"
        testId="drawer"
        eyebrow="Locale diff"
        title="pages/home.ja-JP"
        meta={<span data-testid="meta">Canonical · v12</span>}
        footer={footer}
      >
        <p data-testid="content">Body</p>
      </SlideOverDrawer>
    </>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('SlideOverDrawer', () => {
  it('stays unmounted until it is opened', () => {
    render(<Harness />);

    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('shows its title, kicker, particulars, and body when opened', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));

    const drawer = await screen.findByTestId('drawer');
    expect(drawer).toHaveTextContent('Locale diff');
    expect(drawer).toHaveTextContent('pages/home.ja-JP');
    expect(screen.getByTestId('meta')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('announces itself as a dialog, without claiming the page behind it is inert', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Locale diff');
    // Tab is not contained, so a screen reader is not told to ignore the editor.
    expect(dialog).not.toHaveAttribute('aria-modal');
  });

  it('takes focus on open, so the keyboard lands inside it', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
  });

  it('returns focus to whatever opened it', async () => {
    render(<Harness />);
    const trigger = screen.getByTestId('trigger');
    // A real click focuses the button it lands on; fireEvent does not, and the
    // drawer restores whatever held focus when it opened.
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByTestId('drawer');

    fireEvent.click(screen.getByTestId('drawer-close'));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes on its close control', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.click(await screen.findByTestId('drawer-close'));

    await waitFor(() => expect(screen.queryByTestId('drawer')).not.toBeInTheDocument());
  });

  it('closes on Escape', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    await screen.findByTestId('drawer');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('drawer')).not.toBeInTheDocument());
  });

  it('closes on the scrim', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    const scrim = await screen.findByTestId('drawer');

    fireEvent.mouseDown(scrim);

    await waitFor(() => expect(screen.queryByTestId('drawer')).not.toBeInTheDocument());
  });

  it('stays open when the panel itself is clicked', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    await screen.findByTestId('drawer');

    fireEvent.mouseDown(screen.getByRole('dialog'));

    // Closing is animated, so the drawer is still mounted the instant after a
    // real close too. Outlast the transition before believing it stayed.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.getByTestId('drawer')).toBeInTheDocument();
  });

  it('retires itself where no animation runs, rather than trapping focus', async () => {
    // jsdom fires no animationend, which is the case this has to survive: a
    // drawer that cannot unmount holds the keyboard.
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.click(await screen.findByTestId('drawer-close'));

    await waitFor(() => expect(screen.queryByTestId('drawer')).not.toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it('reopens after closing', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.click(await screen.findByTestId('drawer-close'));
    await waitFor(() => expect(screen.queryByTestId('drawer')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('trigger'));

    expect(await screen.findByTestId('drawer')).toBeInTheDocument();
  });

  it('leaves out the footer rail when there is nothing to put in it', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    await screen.findByTestId('drawer');

    expect(screen.queryByTestId('drawer-footer-content')).not.toBeInTheDocument();
  });

  it('shows a footer when given one', async () => {
    render(<Harness footer={<span data-testid="drawer-footer-content">3 reconciled</span>} />);
    fireEvent.click(screen.getByTestId('trigger'));
    await screen.findByTestId('drawer');

    expect(screen.getByTestId('drawer-footer-content')).toBeInTheDocument();
  });

  it('renders outside the trigger, so a toolbar cannot clip it', async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    await screen.findByTestId('drawer');

    expect(container.querySelector('[data-testid="drawer"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="drawer"]')).not.toBeNull();
  });
});
