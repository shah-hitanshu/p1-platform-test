/**
 * A selected block gets the editor's action bar in the corner the comment trigger uses,
 * so the trigger moves below the bar for that block and only that block.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

vi.mock('@pantheon-systems/pds-toolkit-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Icon: ({ iconName, ...props }: any) => <span data-testid={`icon-${iconName}`} {...props} />,
}));

const puckState = { selectedItem: { type: 'ListBlock', props: { id: 'comp-1' } } };

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => (selector: (state: unknown) => unknown) => selector(puckState),
  useGetPuck: () => () => puckState,
}));

import { BlockCommentTrigger } from '../../features/threads/ui/BlockCommentTrigger.js';

afterEach(cleanup);

function anchorFor(blockId: string): HTMLElement {
  const block = document.createElement('div');
  block.setAttribute('data-puck-component', blockId);
  document.body.append(block);
  const { container } = render(<BlockCommentTrigger blockId={blockId} />);
  block.remove();
  return container.firstElementChild as HTMLElement;
}

describe('BlockCommentTrigger on a selected block', () => {
  it('steps below the action bar of the selected block', () => {
    expect(anchorFor('comp-1').className).toContain('belowActionBar');
  });

  it('stays in the corner of a block that is not selected', () => {
    expect(anchorFor('comp-2').className).not.toContain('belowActionBar');
  });
});
