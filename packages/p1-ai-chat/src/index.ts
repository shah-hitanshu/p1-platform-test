import React from 'react';
import type { Plugin } from '@puckeditor/core';
import { AIFieldsOverride } from './components/panel/AIFieldsOverride.js';
import type { AIChatPluginOptions, ResolvedAIChatPluginOptions } from './types.js';
import { resolveAgentUrl } from './constants.js';

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
export { PRODUCTION_AGENT_URL } from './constants.js';

// Reuse the real Puck plugin type instead of a hand-maintained local copy, so
// this can never drift from what @puckeditor/core actually consumes (see PCC-3399).
// Kept as a named export for backward compatibility with existing importers.
export type PuckPlugin = Plugin;

/** Browser-only package with no `@types/node`, so `process` needs a local declaration. */
declare const process: { env: { NEXT_PUBLIC_MEDIA_WORKER_URL?: string } };

/**
 * Written as the literal expression bundlers substitute; reading it off `globalThis` defeats
 * that. Guarded because a bundler that defines no `process` would throw here rather than fall
 * through to "attachments are not kept".
 */
function envMediaWorkerUrl(): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env.NEXT_PUBLIC_MEDIA_WORKER_URL;
}

/**
 * No `render`/`label`/`icon`: the panel takes over the right-hand rail through the `fields`
 * override, opened from the editor header rather than from Puck's plugin rail.
 */
export function createAIChatPlugin(options: AIChatPluginOptions = {}): Plugin {
  const resolvedOptions: ResolvedAIChatPluginOptions = {
    ...options,
    agentUrl: resolveAgentUrl(options.agentUrl),
    // `||`, not `??`: an env file with a bare `NEXT_PUBLIC_MEDIA_WORKER_URL=` inlines to '',
    // and an empty base URL would build requests against the host app's own origin.
    mediaWorkerUrl: options.mediaWorkerUrl || envMediaWorkerUrl() || undefined,
  };
  return {
    name: 'ai-chat',
    overrides: {
      fields: ({ children }) => React.createElement(AIFieldsOverride, { options: resolvedOptions }, children),
    },
  };
}
