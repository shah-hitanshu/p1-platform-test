import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Badge, Icon, UtilityButton } from '@pantheon-systems/pds-toolkit-react';
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
      {/* AI badge for assistant messages */}
      {!isUser && (message.content || message.isStreaming) && (
        <Badge
          color="discovery"
          label={
            <>
              <Icon iconName="sparkles" iconSize="xs" verticalAlign="-0.1em" />
              {' '}AI
            </>
          }
          size="xs"
        />
      )}

      {/* Tool call badges */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
          {message.toolCalls.map((tc, i) => (
            <Badge
              key={i}
              color={tc.status === 'running' ? 'sky' : 'gaia'}
              label={
                <>
                  <Icon
                    iconName={tc.status === 'running' ? 'circleNotch' : 'circleCheck'}
                    iconSize="xs"
                    verticalAlign="-0.1em"
                  />
                  {' '}{tc.name}
                </>
              }
              size="xs"
            />
          ))}
        </div>
      )}

      {/* Thinking indicator — shown while waiting for first streamed token */}
      {!isUser && message.isStreaming && !message.content && (
        <UtilityButton
          label="Thinking…"
          iconName="sparkles"
          isWorking
        />
      )}

      {/* Message bubble */}
      {message.content && (
        <div style={{
          maxWidth: '90%',
          padding: '8px 12px',
          borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
          backgroundColor: isUser ? 'var(--pds-color-bg-reverse)' : 'var(--pds-color-bg-default-secondary)',
          color: isUser ? 'var(--pds-color-fg-reverse)' : 'var(--pds-color-fg-default)',
          fontSize: 13,
          lineHeight: 1.5,
          wordBreak: 'break-word',
        }}>
          {isUser ? (
            message.content
          ) : (
            <div style={{ marginBottom: -8 }}>
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p style={{ margin: '0 0 8px 0', lineHeight: 1.6 }}>{children}</p>,
                  pre: ({ children }) => <pre style={{ background: 'var(--pds-color-bg-default-secondary)', padding: '8px', borderRadius: 4, overflow: 'auto', fontSize: 12, margin: '0 0 8px 0' }}>{children}</pre>,
                  code: ({ children, className }) => className
                    ? <code className={className}>{children}</code>
                    : <code style={{ background: 'var(--pds-color-bg-default-secondary)', padding: '1px 4px', borderRadius: 3, fontSize: 12, fontFamily: 'monospace' }}>{children}</code>,
                  ul: ({ children }) => <ul style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ul>,
                  ol: ({ children }) => <ol style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ol>,
                  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                  h1: ({ children }) => <h1 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0' }}>{children}</h1>,
                  h2: ({ children }) => <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0' }}>{children}</h2>,
                  h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px 0' }}>{children}</h3>,
                  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--pds-color-border-separator)', paddingLeft: 8, margin: '0 0 8px 0', color: 'var(--pds-color-fg-default-secondary)' }}>{children}</blockquote>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {message.error && (
        <Badge
          color="critical"
          label={`Error: ${message.error}`}
          size="s"
        />
      )}
    </div>
  );
}
