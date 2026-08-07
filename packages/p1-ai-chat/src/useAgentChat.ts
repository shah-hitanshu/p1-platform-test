import { useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ChatMessage, ChatContext, SendMessageOptions } from './types.js';
import { acquireChatSession } from './chatSession.js';

export interface UseAgentChatOptions {
  agentUrl: string;
  /** Durable Object key. Scopes persisted history; changing it switches conversations. */
  agentId: string;
  getContext: () => ChatContext | Promise<ChatContext>;
  /** Called with the path of a page the agent created during a turn. */
  onPageCreated?: (path: string) => void;
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
  /** True between an unexpected disconnect and the next reconnect attempt. */
  reconnecting: boolean;
  /** False until persisted history has been answered for — distinguishes empty from pending. */
  historyLoaded: boolean;
  /** True when the last turn failed and can be resent. */
  canRetry: boolean;
  /**
   * True while the agent has been asked for a page it has not created yet. Such a turn writes to
   * a page of its own, so it needs no document open in the editor.
   */
  awaitingNewPage: boolean;
  clearMessages: () => void;
  /** Stop the turn in flight, keeping whatever it already streamed. */
  stop: () => void;
  /** Resend the turn that failed. */
  retry: () => void;
}

/**
 * Thin view over the module-level {@link acquireChatSession session store}, so a conversation
 * and an in-progress stream survive this component remounting. Switching `agentId` attaches
 * to a different conversation; the previous one is reaped shortly after.
 */
export function useAgentChat({
  agentUrl,
  agentId,
  getContext,
  onPageCreated,
}: UseAgentChatOptions): UseAgentChatReturn {
  // Auth and ids get a new closure identity every render, but the conversation they
  // describe doesn't — read them through a ref so the session isn't re-acquired.
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;
  const onPageCreatedRef = useRef(onPageCreated);
  onPageCreatedRef.current = onPageCreated;

  // One handle per conversation scope. Memoizing it keeps subscribe/getState
  // referentially stable, which is what stops useSyncExternalStore resubscribing
  // (and tearing down the socket) on every render.
  const session = useMemo(
    () => acquireChatSession(
      agentId,
      agentUrl,
      () => getContextRef.current(),
      path => onPageCreatedRef.current?.(path),
    ),
    [agentId, agentUrl],
  );

  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);

  const submit = useCallback(async () => {
    const text = state.draft.trim();
    if (!text || state.isLoading) return;
    session.setDraft('');
    await session.sendMessage(text);
  }, [state.draft, state.isLoading, session]);

  const clearMessages = useCallback(() => {
    void session.clearMessages();
  }, [session]);

  const retry = useCallback(() => {
    void session.retry();
  }, [session]);

  return {
    messages: state.messages,
    input: state.draft,
    setInput: session.setDraft,
    submit,
    sendMessage: session.sendMessage,
    isLoading: state.isLoading,
    ready: state.ready,
    reconnecting: state.reconnecting,
    historyLoaded: state.historyLoaded,
    canRetry: state.retry !== null,
    awaitingNewPage: state.pendingPage !== null,
    clearMessages,
    stop: session.stop,
    retry,
  };
}
