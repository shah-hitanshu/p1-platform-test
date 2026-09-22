import React from 'react';
import { ActionBar, createUsePuck } from '@puckeditor/core';
import { ActionBarPinButton } from '../../features/content-type-templates/ui/ActionBarPinButton.js';
import { useAgentHeldBlocks } from '../../collaboration/useAgentHeldBlocks.js';

const usePuckState = createUsePuck();

/**
 * Withheld on a block an agent holds: the agent's banner covers that corner,
 * and would leave Delete reachable underneath it.
 */
export function P1ActionBar({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const selectedId = usePuckState(
    (s) => (s as { selectedItem: { props: { id: string } } | null }).selectedItem?.props.id,
  ) as string | undefined;
  const heldByAgent = useAgentHeldBlocks();

  if (selectedId !== undefined && heldByAgent.has(selectedId)) {
    return null;
  }

  return (
    <ActionBar label={label}>
      {children}
      <ActionBarPinButton />
    </ActionBar>
  );
}
