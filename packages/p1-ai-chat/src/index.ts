import React from 'react';
import type { Plugin } from '@puckeditor/core';
import { AIFieldsOverride } from './AIFieldsOverride.js';
import type { AIChatPluginOptions } from './types.js';

export type {
  AIChatPluginOptions,
  ChatMessage,
  // Part of ChatMessage's public shape, so consumers reading `parts` can name the type,
  // and narrow it to the prose variant.
  MessagePart,
  TextPart,
  ChatContext,
  ToolCallStatus,
  DraftRequest,
  DraftRequestChannel,
} from './types.js';
export { createDraftRequestChannel } from './draftRequestChannel.js';

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
