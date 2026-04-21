import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage as ChatMessageType } from './types.js';

interface Props {
  message: ChatMessageType;
}

export function ChatMessage({ message }: Props): React.ReactElement {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      gap: 4,
      marginBottom: 12,
    }}>
      {/* Tool call badges */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
          {message.toolCalls.map((tc, i) => (
            <div
              key={i}
              style={{
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 3,
                backgroundColor: tc.status === 'running' ? '#e8f4fd' : '#f0fdf4',
                color: tc.status === 'running' ? '#1d6fa4' : '#166534',
                border: `1px solid ${tc.status === 'running' ? '#bfdbfe' : '#bbf7d0'}`,
                fontFamily: 'monospace',
              }}
            >
              {tc.status === 'running' ? '⟳' : '✓'} {tc.name}
            </div>
          ))}
        </div>
      )}

      {/* Message bubble */}
      {(message.content || message.isStreaming) && (
        <div style={{
          maxWidth: '90%',
          padding: '8px 12px',
          borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
          backgroundColor: isUser ? '#2563eb' : '#f3f4f6',
          color: isUser ? '#ffffff' : '#111827',
          fontSize: 13,
          lineHeight: 1.5,
          wordBreak: 'break-word',
        }}>
          {isUser ? (
            <>
              {message.content}
              {message.isStreaming && (
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor', marginLeft: 3, opacity: 0.6, animation: 'pulse 1s infinite' }} />
              )}
            </>
          ) : (
            <>
              <div style={{ marginBottom: -8 }}>
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p style={{ margin: '0 0 8px 0', lineHeight: 1.6 }}>{children}</p>,
                  pre: ({ children }) => <pre style={{ background: '#e5e7eb', padding: '8px', borderRadius: 4, overflow: 'auto', fontSize: 12, margin: '0 0 8px 0' }}>{children}</pre>,
                  code: ({ children, className }) => className
                    ? <code className={className}>{children}</code>
                    : <code style={{ background: '#e5e7eb', padding: '1px 4px', borderRadius: 3, fontSize: 12, fontFamily: 'monospace' }}>{children}</code>,
                  ul: ({ children }) => <ul style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ul>,
                  ol: ({ children }) => <ol style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ol>,
                  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                  h1: ({ children }) => <h1 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0' }}>{children}</h1>,
                  h2: ({ children }) => <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0' }}>{children}</h2>,
                  h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px 0' }}>{children}</h3>,
                  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #d1d5db', paddingLeft: 8, margin: '0 0 8px 0', color: '#6b7280' }}>{children}</blockquote>,
                }}
              >
                {message.content}
              </ReactMarkdown>
              </div>
              {message.isStreaming && (
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor', marginLeft: 3, opacity: 0.6, animation: 'pulse 1s infinite' }} />
              )}
            </>
          )}
        </div>
      )}

      {/* Error state */}
      {message.error && (
        <div style={{
          fontSize: 12,
          color: '#dc2626',
          padding: '4px 8px',
          borderRadius: 4,
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
        }}>
          Error: {message.error}
        </div>
      )}
    </div>
  );
}
