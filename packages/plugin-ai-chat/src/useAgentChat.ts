import { useState, useRef, useCallback, useEffect } from 'react';
import type { ChatMessage, ToolCallStatus, ServerMessage, ChatContext, RestoredMessage } from './types.js';

function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Map a replayed turn into the UI message shape. Restored tool calls are always
 * terminal — they already ran — so their status is 'done'.
 */
function restoredToChatMessage(m: RestoredMessage): ChatMessage {
  const toolCalls: ToolCallStatus[] | undefined =
    m.toolCalls && m.toolCalls.length > 0
      ? m.toolCalls.map(tc => ({ name: tc.name, input: tc.input, result: tc.result, status: 'done' as const }))
      : undefined;
  return {
    id: makeId(),
    role: m.role,
    content: m.content,
    ...(toolCalls ? { toolCalls } : {}),
  };
}

export interface UseAgentChatOptions {
  agentUrl: string;
  /** Durable Object key. Scopes persisted history; changing it switches conversations. */
  agentId: string;
  getContext: () => ChatContext;
}

export interface UseAgentChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  submit: () => void;
  isLoading: boolean;
  clearMessages: () => void;
}

export function useAgentChat({ agentUrl, agentId, getContext }: UseAgentChatOptions): UseAgentChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);
  // Read lazily inside getOrCreateWs so the connection always targets the latest scope.
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const getOrCreateWs = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        resolve(wsRef.current);
        return;
      }

      const encodedAgentId = encodeURIComponent(agentIdRef.current);
      const wsUrl = `${agentUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/agents/chat-agent/${encodedAgentId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Ask the agent for any persisted history so a page reload restores the chat.
        // The token authorizes the read (the agent scopes history to its owner); the
        // response is applied only when the local view is empty (see 'history'), so
        // this never clobbers an in-progress conversation.
        ws.send(JSON.stringify({ type: 'get_history', token: getContext().token }));
        resolve(ws);
      };
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
      ws.onclose = () => {
        wsRef.current = null;
        // If a response was in-flight when the connection dropped, surface the error
        const id = currentAssistantIdRef.current;
        if (id) {
          setMessages(prev =>
            prev.map(m =>
              m.id === id ? { ...m, error: 'Connection lost', isStreaming: false } : m,
            ),
          );
          currentAssistantIdRef.current = null;
          setIsLoading(false);
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'history':
            // Rehydrate only when the view is empty — on fresh mount or after a
            // scope switch (which clears messages first). Never overwrite an
            // active conversation on a mid-session reconnect.
            setMessages(prev => (prev.length === 0 ? msg.history.map(restoredToChatMessage) : prev));
            break;

          case 'token':
            setMessages(prev => {
              const id = currentAssistantIdRef.current;
              if (!id) return prev;
              return prev.map(m =>
                m.id === id
                  ? { ...m, content: m.content + msg.content, isStreaming: true }
                  : m,
              );
            });
            break;

          case 'done':
            setMessages(prev => {
              const id = currentAssistantIdRef.current;
              if (!id) return prev;
              return prev.map(m => m.id === id ? { ...m, isStreaming: false } : m);
            });
            currentAssistantIdRef.current = null;
            setIsLoading(false);
            break;

          case 'error':
            setMessages(prev => {
              const id = currentAssistantIdRef.current;
              if (!id) return prev;
              return prev.map(m =>
                m.id === id ? { ...m, error: msg.error, isStreaming: false } : m,
              );
            });
            currentAssistantIdRef.current = null;
            setIsLoading(false);
            break;

          case 'tool_start':
            setMessages(prev => {
              const id = currentAssistantIdRef.current;
              if (!id) return prev;
              return prev.map(m => {
                if (m.id !== id) return m;
                const toolCall: ToolCallStatus = { name: msg.toolName, input: msg.toolInput, status: 'running' };
                return { ...m, toolCalls: [...(m.toolCalls ?? []), toolCall] };
              });
            });
            break;

          case 'tool_end':
            setMessages(prev => {
              const id = currentAssistantIdRef.current;
              if (!id) return prev;
              return prev.map(m => {
                if (m.id !== id) return m;
                const toolCalls = (m.toolCalls ?? []).map(tc =>
                  tc.name === msg.toolName && tc.status === 'running'
                    ? { ...tc, result: msg.toolResult, status: 'done' as const }
                    : tc,
                );
                return { ...m, toolCalls };
              });
            });
            break;
        }
      };
    });
  }, [agentUrl, getContext]);

  // Connect on mount and whenever the conversation scope changes. A scope change
  // (different user/site/branch/document) is a different conversation, so clear
  // the view and let the fresh connection replay that scope's history.
  useEffect(() => {
    if (!agentId) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setMessages([]);
    currentAssistantIdRef.current = null;
    getOrCreateWs().catch(() => {
      // A failed eager connect is non-fatal; submit() retries and surfaces errors.
    });
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [agentId, getOrCreateWs]);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput('');
    setIsLoading(true);

    // Add user message
    const userMsg: ChatMessage = { id: makeId(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    // Add placeholder assistant message
    const assistantId = makeId();
    currentAssistantIdRef.current = assistantId;
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', isStreaming: true }]);

    try {
      const ws = await getOrCreateWs();
      ws.send(JSON.stringify({
        type: 'chat',
        message: text,
        context: getContext(),
      }));
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId ? { ...m, error: 'Connection failed', isStreaming: false } : m,
        ),
      );
      currentAssistantIdRef.current = null;
      setIsLoading(false);
    }
  }, [input, isLoading, getContext, getOrCreateWs]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'clear', token: getContext().token }));
    }
  }, [getContext]);

  return { messages, input, setInput, submit, isLoading, clearMessages };
}
