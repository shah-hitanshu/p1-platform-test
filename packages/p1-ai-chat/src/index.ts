import React from 'react';
import type { Plugin } from '@puckeditor/core';
import { AIFieldsOverride } from './components/panel/AIFieldsOverride.js';
import type { AIChatPluginOptions } from './types.js';

export type {
  AIChatPluginOptions,
  AttachedFile,
  Attachment,
  ChatMessage,
  MessagePart,
  TextPart,
  MessageOrigin,
  ChatContext,
  SelectedBlock,
  ToolCallStatus,
  DraftRequest,
  FillPageRequest,
  CreatePageRequest,
  PendingPage,
  DraftRequestChannel,
} from './types.js';
export { createDraftRequestChannel } from './lib/draftRequestChannel.js';

// Reuse the real Puck plugin type instead of a hand-maintained local copy, so
// this can never drift from what @puckeditor/core actually consumes (see PCC-3399).
// Kept as a named export for backward compatibility with existing importers.
export type PuckPlugin = Plugin;

/**
 * No `render`/`label`/`icon`: the panel takes over the right-hand rail through the `fields`
 * override, opened from the editor header rather than from Puck's plugin rail.
 */
export function createAIChatPlugin(options: AIChatPluginOptions): Plugin {
  return {
    name: 'ai-chat',
    overrides: {
      fields: ({ children }) => React.createElement(AIFieldsOverride, { options }, children),
    },
  };
}
