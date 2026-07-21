import React from 'react';
import { ChatPanel } from './ChatPanel.js';
import type { AIChatPluginOptions } from './types.js';

export type { AIChatPluginOptions, ChatMessage, ChatContext, ToolCallStatus } from './types.js';

// Puck plugin shape (matches @puckeditor/core Plugin interface)
export interface PuckPlugin {
  name: string;
  label?: string;
  icon?: React.ReactNode;
  render: () => React.ReactElement;
  mobilePanelHeight?: 'toggle' | 'full';
}

export function createAIChatPlugin(options: AIChatPluginOptions): PuckPlugin {
  return {
    name: 'ai-chat',
    label: 'AI Builder',
    icon: React.createElement('span', { style: { fontSize: 16 } }, '✨'),
    render: () => React.createElement(ChatPanel, { options }),
    mobilePanelHeight: 'toggle',
  };
}
