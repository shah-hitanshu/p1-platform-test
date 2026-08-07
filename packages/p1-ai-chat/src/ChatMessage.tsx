import React from 'react';
import { Badge, Icon, UtilityButton } from '@pantheon-systems/pds-toolkit-react';
import { visuallyHidden } from './a11y.js';
import type { ChatMessage as ChatMessageType } from './types.js';
import { messageParts, turnBlocks, isAwaitingModel, type TurnBlock } from './messageParts.js';
import { ToolGroup, ThinkingLine } from './ToolGroup.js';
import { MarkdownText } from './MarkdownText.js';
import { repairMarkdown } from './streamedMarkdown.js';

interface Props {
  message: ChatMessageType;
  /**
   * Offer to resend this turn. Passed only for a turn that failed and is the newest, so
   * retrying can't fork the conversation from the middle.
   */
  onRetry?: () => void;
}

/**
 * One turn of the conversation. Memoized because rendering a turn re-parses its markdown,
 * and the panel re-renders on every streamed token and every keystroke.
 */
function UnmemoizedChatMessage({ message, onRetry }: Props): React.ReactElement {
  const isUser = message.role === 'user';
  const blocks = turnBlocks(messageParts(message));

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      // Containing block for the visually-hidden label below, which is absolutely positioned
      // and would otherwise escape the transcript's clip.
      position: 'relative',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      gap: 6,
      marginBottom: 14,
      minWidth: 0,
      width: '100%',
    }}>
      {/* Who spoke. Sighted users get this from alignment and the user turn's bubble, neither
          of which reaches assistive tech, so the transcript would otherwise be an
          undifferentiated stream of alternating text. */}
      <span style={visuallyHidden}>{isUser ? 'You said' : 'AI said'}</span>

      {/* Prose and step runs in the order they happened, so a call renders where it was made
          instead of moving once it finishes. */}
      {blocks.map((block, i) => (
        <TurnBlockView
          key={block.id}
          block={block}
          isUser={isUser}
          isStreamingTail={Boolean(message.isStreaming) && i === blocks.length - 1}
        />
      ))}

      {!isUser && message.isStreaming && isAwaitingModel(blocks) && <ThinkingLine />}

      {message.stopped && !message.error && <StoppedNote />}

      {message.error && <ChatMessageError error={message.error} onRetry={onRetry} />}
    </div>
  );
}

export const ChatMessage = React.memo(UnmemoizedChatMessage);

/** One block of a turn: a prose run, or the run of tool calls that followed it. */
function TurnBlockView({
  block,
  isUser,
  isStreamingTail,
}: {
  block: TurnBlock;
  isUser: boolean;
  isStreamingTail: boolean;
}): React.ReactElement {
  if (block.type === 'tools') return <ToolGroup tools={block.tools} />;
  return <TextBubble text={isStreamingTail ? repairMarkdown(block.text) : block.text} isUser={isUser} />;
}

/** The user stopped this turn. Nothing failed, so it gets none of the error treatment below. */
function StoppedNote(): React.ReactElement {
  return (
    <div style={{ fontSize: 11, color: 'var(--pds-color-foreground-default-secondary)', fontStyle: 'italic' }}>
      Stopped
    </div>
  );
}

/**
 * A turn-level failure, e.g. the connection dropped. The message sits beside the badge rather
 * than inside it: a fixed-width pill can't wrap, and widening it widens the panel.
 */
function ChatMessageError({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, maxWidth: '100%', minWidth: 0 }}>
      <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
        <Badge
          color="critical"
          label={
            <>
              <Icon iconName="circleExclamation" size="s" verticalAlign="-0.1em" style={{ width: '0.625rem', height: '0.625rem' }} />
              {' '}Something went wrong
            </>
          }
          size="xs"
        />
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--pds-color-foreground-default-secondary)', paddingLeft: 2, overflowWrap: 'anywhere' }}>
        {error}
      </div>
      {/* Sending clears the composer, so without this the brief has to be retyped. */}
      {onRetry && <UtilityButton label="Try again" iconName="rotateRight" onClick={onRetry} />}
    </div>
  );
}

/**
 * One paragraph-run of the conversation. Only the user's turn gets a bubble: the padding costs
 * ~24px of a ~300px column, which the assistant's prose needs more than the attribution does.
 */
function TextBubble({ text, isUser }: { text: string; isUser: boolean }): React.ReactElement {
  return (
    <div style={{
      maxWidth: isUser ? '90%' : '100%',
      width: isUser ? undefined : '100%',
      padding: isUser ? '8px 12px' : 0,
      // Tail on the sender's side.
      borderRadius: isUser ? '12px 12px 4px 12px' : undefined,
      // Not `brand-default`, which is the yellow rather than the blue the design uses.
      backgroundColor: isUser ? 'var(--pds-color-interactive-background-current)' : undefined,
      color: isUser
        ? 'var(--pds-color-interactive-background-current-foreground)'
        : 'var(--pds-color-foreground-default)',
      fontSize: 13,
      lineHeight: 1.5,
      // `anywhere` rather than `break-word`: only `anywhere` counts break opportunities
      // toward min-content width, so a long unbroken path can't widen the whole panel.
      overflowWrap: 'anywhere',
      minWidth: 0,
    }}>
      {isUser ? text : <MarkdownText text={text} />}
    </div>
  );
}
