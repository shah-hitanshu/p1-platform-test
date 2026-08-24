import React from 'react';
import { useAIPanelOpen } from '@pantheon-systems/puck-css';
import type { AIChatPluginOptions } from '../../types.js';
import { ChatPanel } from './ChatPanel.js';

/**
 * Puts the chat panel in the right-hand inspector rail. `children` is the inspector this
 * override wraps, so passing it through unchanged is what "panel closed" means.
 */
export function AIFieldsOverride({
  children,
  options,
}: {
  children?: React.ReactNode;
  options: AIChatPluginOptions;
}): React.ReactElement {
  const open = useAIPanelOpen();
  if (!open) return <>{children}</>;
  // puck-css's editor theme keys the rail-height rules off this attribute.
  return (
    <div data-p1-ai-panel style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ChatPanel options={options} />
    </div>
  );
}
