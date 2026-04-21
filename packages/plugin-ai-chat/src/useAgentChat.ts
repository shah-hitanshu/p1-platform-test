import { useState, useRef, useCallback, useEffect } from 'react';
import type { ChatMessage, ToolCallStatus, ServerMessage, ChatContext } from './types.js';

function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export interface UseAgentChatOptions {
  agentUrl: string;
  getAgentId: () => string;
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

export function useAgentChat({ agentUrl, getAgentId, getContext }: UseAgentChatOptions): UseAgentChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);

  const getOrCreateWs = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        resolve(wsRef.current);
        return;
      }

      const agentId = encodeURIComponent(getAgentId());
      const wsUrl = `${agentUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/agents/chat-agent/${agentId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => resolve(ws);
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
  }, [agentUrl, getAgentId]);

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

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, input, setInput, submit, isLoading, clearMessages };
}
