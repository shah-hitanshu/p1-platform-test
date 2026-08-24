import { useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  ChatMessage,
  ChatContext,
  PendingAttachment,
  SendMessageOptions,
} from '../types.js';
import { acquireChatSession } from '../lib/session/chatSession.js';
import { AttachmentError, NO_IMAGE_DECODER } from '../lib/attachments/attachmentError.js';
import { attachmentBlocker, readyAttachments } from '../lib/attachments/pendingAttachments.js';

export interface UseAgentChatOptions {
  agentUrl: string;
  /** Durable Object key. Scopes persisted history; changing it switches conversations. */
  agentId: string;
  getContext: () => ChatContext | Promise<ChatContext>;
  /** Called with the path of a page the agent created during a turn. */
  onPageCreated?: (path: string) => void;
  /** Decodes an attached image for sending. Without it, images cannot be attached. */
  prepareImage?: (file: File) => Promise<string>;
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
  /** The pages the agent may change; null means the conversation has not seeded itself yet. */
  writeSet: string[] | null;
  /** Note the page now open in the editor, which the agent may edit while it stays open. */
  visitPage: (path: string) => void;
  /** Whether the scope row lists the pages, or only says how many. */
  scopeExpanded: boolean;
  /** Show the pages in the scope row, or collapse it to a count. */
  setScopeExpanded: (expanded: boolean) => void;
  /** Let the agent change one more page, at the user's request. */
  addWritablePage: (path: string) => void;
  /** Take a page back from the agent. */
  removeWritablePage: (path: string) => void;
  attachments: PendingAttachment[];
  attachFiles: (files: File[]) => void;
  /** Take a file back off the composer, or dismiss one that was refused. */
  removeAttachment: (id: string) => void;
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
  prepareImage,
}: UseAgentChatOptions): UseAgentChatReturn {
  // Auth and ids get a new closure identity every render, but the conversation they
  // describe doesn't — read them through a ref so the session isn't re-acquired.
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;
  const onPageCreatedRef = useRef(onPageCreated);
  onPageCreatedRef.current = onPageCreated;
  const prepareImageRef = useRef(prepareImage);
  prepareImageRef.current = prepareImage;

  // One handle per conversation scope. Memoizing it keeps subscribe/getState
  // referentially stable, which is what stops useSyncExternalStore resubscribing
  // (and tearing down the socket) on every render.
  const session = useMemo(
    () => acquireChatSession(agentId, agentUrl, {
      getContext: () => getContextRef.current(),
      onPageCreated: path => onPageCreatedRef.current?.(path),
      prepareImage: file => {
        const prepare = prepareImageRef.current;
        if (!prepare) throw new AttachmentError(NO_IMAGE_DECODER);
        return prepare(file);
      },
    }),
    [agentId, agentUrl],
  );

  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);

  const submit = useCallback(async () => {
    const text = state.draft.trim();
    if (!text || state.isLoading) return;
    // A file still being read, or one that was refused, holds the turn back here rather than
    // only in the composer: sending would drop it and read as a message that carried it.
    if (attachmentBlocker(state.attachments) !== null) return;
    const attachments = readyAttachments(state.attachments);
    const attachmentIds = state.attachments.map(a => a.id);
    session.setDraft('');
    await session.sendMessage(
      text,
      attachments.length > 0 ? { attachments, attachmentIds } : undefined,
    );
  }, [state.draft, state.isLoading, state.attachments, session]);

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
    writeSet: state.writeSet,
    visitPage: session.visitPage,
    scopeExpanded: state.scopeExpanded,
    setScopeExpanded: session.setScopeExpanded,
    addWritablePage: session.addWritablePage,
    removeWritablePage: session.removeWritablePage,
    attachments: state.attachments,
    attachFiles: session.attachFiles,
    removeAttachment: session.removeAttachment,
    clearMessages,
    stop: session.stop,
    retry,
  };
}
