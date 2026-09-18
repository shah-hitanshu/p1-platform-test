/**
 * While the rollout flag is off none of threads should be reachable, so the
 * block overlay is where that has to hold — including for an answer that only arrives
 * after the overlay has mounted.
 *
 * The overlay is also where a trigger has to name the right block: Puck draws one for
 * a hovered block as well as for the selected one, and both can be on screen at once.
 * The overlay is drawn outside the block, so the trigger has to hand the block the
 * hover a pointer on it would otherwise take away.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@puckeditor/core', () => ({
  ActionBar: ({ children }: any) => <div data-testid="action-bar">{children}</div>,
  FieldLabel: ({ children }: any) => <label>{children}</label>,
  createUsePuck: () => (selector: (s: any) => unknown) =>
    selector({ selectedItem: null, appState: { data: { content: [], root: { props: {} } } } }),
}));

vi.mock('@pantheon-systems/pds-toolkit-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Icon: ({ iconName, ...props }: any) => <span data-testid={`icon-${iconName}`} {...props} />,
}));

vi.mock('../../features/content-type-templates/ui/ActionBarPinButton.js', () => ({
  ActionBarPinButton: () => null,
}));

import { createP1Overrides } from '../../editor/plugin/createP1Overrides.js';
import type { P1OverridesOptions } from '../../editor/plugin/createP1Overrides.js';

type ActionBarOverride = React.ComponentType<{ label?: string; children: React.ReactNode }>;
type OverlayOverride = React.ComponentType<{
  children: React.ReactNode;
  componentId: string;
  componentType: string;
  hover: boolean;
  isSelected: boolean;
}>;

interface BlockState {
  id: string;
  hover?: boolean;
  isSelected?: boolean;
}

/** One block as Puck lays it out: the block element itself, and the overlay Puck
 * portals out of it as a sibling holding the action bar and the component overlay. */
function BlockOverlay({
  overrides,
  block,
}: {
  overrides: ReturnType<typeof createP1Overrides>;
  block: BlockState;
}): React.ReactElement {
  const Bar = overrides.actionBar as ActionBarOverride;
  const Overlay = overrides.componentOverlay as OverlayOverride;

  return (
    <>
      <div data-puck-component={block.id} data-testid={`block-${block.id}`} />
      <div data-puck-overlay data-testid={`overlay-${block.id}`}>
        <Bar label="Heading">{null}</Bar>
        <Overlay
          componentId={block.id}
          componentType="Heading"
          hover={block.hover ?? false}
          isSelected={block.isSelected ?? false}
        >
          <div />
        </Overlay>
      </div>
    </>
  );
}

function renderBlocks(options: P1OverridesOptions, blocks: BlockState[] = [{ id: 'comp-1' }]) {
  const overrides = createP1Overrides(options);
  return render(
    <>
      {blocks.map((block) => (
        <BlockOverlay key={block.id} overrides={overrides} block={block} />
      ))}
    </>,
  );
}

function triggerIn(blockId: string): HTMLElement | null {
  return within(screen.getByTestId(`overlay-${blockId}`)).queryByTestId('comment-trigger');
}

describe('threads on the block overlay', () => {
  it('is absent when no rollout answer has been passed', () => {
    renderBlocks({} as P1OverridesOptions);

    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('comment-trigger')).not.toBeInTheDocument();
  });

  it('is absent while the feature is off', () => {
    renderBlocks({ threadsEnabled: false } as P1OverridesOptions);

    expect(screen.queryByTestId('comment-trigger')).not.toBeInTheDocument();
  });

  it('offers the trigger for the block once the feature is on', () => {
    renderBlocks({ threadsEnabled: true } as P1OverridesOptions);

    const trigger = screen.getByTestId('comment-trigger');
    expect(trigger).toHaveAttribute('data-context-type', 'block');
    expect(trigger).toHaveAttribute('data-context-id', 'comp-1');
  });

  // Without this the block reads as unhovered the moment the pointer arrives on the
  // trigger, and the overlay closes and reopens as fast as the pointer can be re-read.
  it('keeps the block hovered while the pointer is on the trigger', () => {
    renderBlocks({ threadsEnabled: true } as P1OverridesOptions);

    const block = screen.getByTestId('block-comp-1');
    const seen: string[] = [];
    block.addEventListener('mouseover', () => seen.push('mouseover'));
    block.addEventListener('mouseout', () => seen.push('mouseout'));

    const trigger = triggerIn('comp-1') as HTMLElement;
    fireEvent.mouseOver(trigger);
    expect(seen).toEqual(['mouseover']);

    fireEvent.mouseOut(trigger, { relatedTarget: document.body });
    expect(seen).toEqual(['mouseover', 'mouseout']);
  });

  // The thread is drawn in the overlay, and the editor takes the overlay away as soon
  // as the block stops reading as hovered — so an open thread has to hold the hover.
  it('keeps the block hovered while its thread is open', () => {
    renderBlocks({ threadsEnabled: true } as P1OverridesOptions);

    const block = screen.getByTestId('block-comp-1');
    const seen: string[] = [];
    block.addEventListener('mouseover', () => seen.push('mouseover'));

    fireEvent.click(triggerIn('comp-1') as HTMLElement);
    expect(screen.getByTestId('comment-thread')).toBeInTheDocument();

    fireEvent.mouseOut(block, { relatedTarget: document.body });
    expect(seen).toEqual(['mouseover']);
  });

  // Overlays are siblings with no stacking order of their own, so a thread reaching
  // past its own block would be drawn under the overlay of the block below it.
  it('raises its overlay over the others while the thread is open', () => {
    renderBlocks({ threadsEnabled: true } as P1OverridesOptions, [
      { id: 'comp-1' },
      { id: 'comp-2' },
    ]);

    const overlay = screen.getByTestId('overlay-comp-1');
    expect(overlay.style.zIndex).toBe('');

    fireEvent.click(triggerIn('comp-1') as HTMLElement);
    expect(overlay.style.zIndex).toBe('3');

    fireEvent.click(triggerIn('comp-2') as HTMLElement);
    expect(overlay.style.zIndex).toBe('');
    expect(screen.getByTestId('overlay-comp-2').style.zIndex).toBe('3');
  });

  // Puck mounts the overlay on hover, so the trigger comes with it — a reader can
  // start a thread without first selecting the block.
  it('offers the trigger for a hovered block that is not selected', () => {
    renderBlocks({ threadsEnabled: true } as P1OverridesOptions, [
      { id: 'comp-1', hover: true, isSelected: false },
    ]);

    expect(screen.getByTestId('comment-trigger')).toHaveAttribute('data-context-id', 'comp-1');
  });

  // Hovering one block while another is selected puts two overlays on screen. Each one
  // talks about its own block; reading the editor's selection would point both at the
  // selected one.
  it('names each block when a hovered overlay and a selected one are both up', () => {
    renderBlocks({ threadsEnabled: true } as P1OverridesOptions, [
      { id: 'selected-block', isSelected: true },
      { id: 'hovered-block', hover: true },
    ]);

    expect(triggerIn('selected-block')).toHaveAttribute('data-context-id', 'selected-block');
    expect(triggerIn('hovered-block')).toHaveAttribute('data-context-id', 'hovered-block');
  });

  // The overrides object is built once and outlives any single answer, so the flag is
  // read at render — a rollout that resolves after mount still reaches the overlay.
  it('appears when the rollout answer arrives after the overlay has mounted', () => {
    const options = { threadsEnabled: false } as { threadsEnabled: boolean };
    const overrides = createP1Overrides(
      new Proxy({} as P1OverridesOptions, {
        get: (_t, prop: string) => (options as Record<string, unknown>)[prop],
      }),
    );
    const tree = () => <BlockOverlay overrides={overrides} block={{ id: 'comp-1' }} />;

    const { rerender } = render(tree());
    expect(screen.queryByTestId('comment-trigger')).not.toBeInTheDocument();

    options.threadsEnabled = true;
    rerender(tree());

    expect(screen.getByTestId('comment-trigger')).toBeInTheDocument();
  });
});
