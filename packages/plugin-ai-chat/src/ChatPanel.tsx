import React, { useRef, useEffect } from 'react';
import { useAgentChat } from './useAgentChat.js';
import { ChatMessage } from './ChatMessage.js';
import type { AIChatPluginOptions } from './types.js';

interface Props {
  options: AIChatPluginOptions;
}

export function ChatPanel({ options }: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, input, setInput, submit, isLoading, clearMessages } = useAgentChat({
    agentUrl: options.agentUrl,
    getAgentId: options.getAgentId,
    getContext: () => ({
      siteId: options.getSiteId(),
      branchId: options.getBranchId(),
      documentPath: options.getDocumentPath(),
      documentId: options.getDocumentId(),
      token: options.getAuthToken(),
    }),
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Refocus the input after loading completes
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>AI Page Builder</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            Describe what you want to build or change
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearMessages}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9ca3af',
              fontSize: 12,
              padding: '2px 4px',
            }}
            title="Clear conversation"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
        }}
      >
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: 13,
            paddingTop: 32,
          }}>
            <div style={{ marginBottom: 8, fontSize: 24 }}>✨</div>
            Try: "Build me a page about the world's fastest helicopters"
          </div>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid #e5e7eb',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build or change…"
            disabled={isLoading}
            rows={2}
            style={{
              flex: 1,
              resize: 'none',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              backgroundColor: isLoading ? '#f9fafb' : '#ffffff',
            }}
          />
          <button
            onClick={() => void submit()}
            disabled={isLoading || !input.trim()}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: isLoading || !input.trim() ? '#e5e7eb' : '#2563eb',
              color: isLoading || !input.trim() ? '#9ca3af' : '#ffffff',
              cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
              flexShrink: 0,
              transition: 'background-color 0.15s',
            }}
          >
            {isLoading ? '…' : 'Send'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
          Enter to send · Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}
