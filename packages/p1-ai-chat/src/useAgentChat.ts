import { useState, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ChatMessage, ChatContext } from './types.js';
import { acquireChatSession, type SendMessageOptions } from './chatSession.js';

export interface UseAgentChatOptions {
  agentUrl: string;
  /** Durable Object key. Scopes persisted history; changing it switches conversations. */
  agentId: string;
  getContext: () => ChatContext | Promise<ChatContext>;
}

export interface UseAgentChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  submit: () => void;
  /**
   * Send a chat turn programmatically (without the input box). Optionally override
   * the target `documentPath`. Shares the same send path as {@link submit}.
   */
  sendMessage: (text: string, opts?: SendMessageOptions) => Promise<void>;
  isLoading: boolean;
  /** True while the WebSocket for the current scope is open and usable. */
  ready: boolean;
  clearMessages: () => void;
}

/**
 * Thin view over the module-level {@link acquireChatSession session store}. The
 * socket and messages live in the store keyed by `agentId`, so the conversation and
 * an in-progress stream survive this component remounting (Puck remounts plugin
 * panels while a new page hydrates). Switching `agentId` attaches to a different
 * conversation; the previous one lingers briefly then is reaped.
 */
export function useAgentChat({ agentUrl, agentId, getContext }: UseAgentChatOptions): UseAgentChatReturn {
  const [input, setInput] = useState('');

  // Auth and ids get a new closure identity every render, but the conversation they
  // describe doesn't — read them through a ref so the session isn't re-acquired.
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;

  // One handle per conversation scope. Memoizing it keeps subscribe/getState
  // referentially stable, which is what stops useSyncExternalStore resubscribing
  // (and tearing down the socket) on every render.
  const session = useMemo(
    () => acquireChatSession(agentId, agentUrl, () => getContextRef.current()),
    [agentId, agentUrl],
  );

  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || state.isLoading) return;
    setInput('');
    await session.sendMessage(text);
  }, [input, state.isLoading, session]);

  const clearMessages = useCallback(() => {
    void session.clearMessages();
  }, [session]);

  return {
    messages: state.messages,
    input,
    setInput,
    submit,
    sendMessage: session.sendMessage,
    isLoading: state.isLoading,
    ready: state.ready,
    clearMessages,
  };
}
