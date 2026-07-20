import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { Button, Icon, Textarea, UtilityButton } from '@pantheon-systems/pds-toolkit-react';
import { useP1Puck, useP1Auth } from '@pantheon-systems/puck-css';
import { useAgentChat } from './useAgentChat.js';
import { ChatMessage } from './ChatMessage.js';
import type { AIChatPluginOptions } from './types.js';

interface Props {
  options: AIChatPluginOptions;
}

export function ChatPanel({ options }: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const css = useP1Puck();
  const { getToken } = useP1Auth();

  // Stable refs so getAgentId/getContext don't change on every render
  const cssRef = useRef(css);
  cssRef.current = css;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // Reactive scope key: recomputed when the user/site/branch/document changes so
  // the hook reconnects and loads that conversation's history. History is
  // persisted per-document, so switching documents shows that document's chat.
  const { userId, siteId, branchId, currentDocument } = css;
  const agentId = useMemo(() => {
    if (options.getAgentId) return options.getAgentId();
    const docSlug = (currentDocument?.path ?? '').replace(/^\//, '').replace(/\//g, '-') || 'root';
    return `${userId}-${siteId}-${branchId}-${docSlug}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.getAgentId, userId, siteId, branchId, currentDocument?.path]);

  // Fetches a fresh token rather than reading React state directly — auth
  // loads asynchronously on mount, so a state snapshot can still be null the
  // moment a user submits their first message.
  const getContext = useCallback(async () => ({
    siteId: cssRef.current.siteId,
    branchId: cssRef.current.branchId,
    documentPath: cssRef.current.currentDocument?.path ?? '',
    documentId: cssRef.current.currentDocument?.id ?? '',
    token: (await getTokenRef.current()) ?? '',
  }), []);

  const { messages, input, setInput, submit, isLoading, clearMessages } = useAgentChat({
    agentUrl: options.agentUrl,
    agentId,
    getContext,
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
      textareaRef.current?.focus();
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
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--pds-color-border-separator)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon iconName="sparkles" iconSize="m" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pds-color-fg-default)' }}>
              AI Page Builder
            </div>
            <div style={{ fontSize: 11, color: 'var(--pds-color-fg-default-secondary)', marginTop: 2 }}>
              Describe what you want to build or change
            </div>
          </div>
        </div>
        {messages.length > 0 && (
          <UtilityButton
            label="Clear"
            iconName="trash"
            isCritical
            onClick={() => void clearMessages()}
          />
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
            color: 'var(--pds-color-fg-default-secondary)',
            fontSize: 13,
            paddingTop: 32,
          }}>
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
              <Icon iconName="sparkles" iconSize="xl" />
            </div>
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
        borderTop: '1px solid var(--pds-color-border-separator)',
        flexShrink: 0,
      }}>
        <Textarea
          id="ai-chat-input"
          label="Message"
          showLabel={false}
          placeholder="Describe what you want to build or change…"
          value={input}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
          textareaProps={{ onKeyDown: handleKeyDown }}
          disabled={isLoading}
          rows={2}
          isResizable={false}
          ref={textareaRef}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button
            label="Send"
            variant="secondary"
            size="s"
            displayType="icon-end"
            iconName="paperPlane"
            onClick={() => void submit()}
            disabled={!input.trim()}
            isWorking={isLoading}
            tooltipText={isLoading ? 'Sending…' : undefined}
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--pds-color-fg-default-secondary)', marginTop: 6 }}>
          Enter to send · Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}
