import React from 'react';
import { Badge, Icon, UtilityButton } from '@pantheon-systems/pds-toolkit-react';
import { visuallyHidden } from '../../lib/a11y.js';
import { cardStyle, FileCardFace } from '../attachments/FileCard.js';
import type { AttachedFile, ChatMessage as ChatMessageType, MessageOrigin } from '../../types.js';
import { messageParts, turnBlocks, isAwaitingModel, type TurnBlock } from '../../lib/transcript/messageParts.js';
import { repairMarkdown } from '../../lib/transcript/streamedMarkdown.js';
import { ToolGroup, ThinkingLine } from './ToolGroup.js';
import { MarkdownText } from './MarkdownText.js';

/** Fetches a kept file's bytes, optionally resized server-side. */
type LoadKeptFile = (assetId: string, width?: number) => Promise<Blob>;

interface Props {
  message: ChatMessageType;
  /**
   * Offer to resend this turn. Passed only for a turn that failed and is the newest, so
   * retrying can't fork the conversation from the middle.
   */
  onRetry?: () => void;
  /** Show a file this turn sent. The panel owns the space to show it in. */
  onOpenFile?: (file: AttachedFile) => void;
  /** Fetches a kept file's bytes. Absent when nothing is set up to keep them. */
  loadKept?: LoadKeptFile;
}

/**
 * One turn of the conversation. Memoized because rendering a turn re-parses its markdown,
 * and the panel re-renders on every streamed token and every keystroke.
 */
function UnmemoizedChatMessage({ message, onRetry, onOpenFile, loadKept }: Props): React.ReactElement {
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

      {message.origin && <OriginCaption origin={message.origin} />}

      {message.attachments && message.attachments.length > 0 && (
        <AttachedFiles files={message.attachments} onOpen={onOpenFile} loadKept={loadKept} />
      )}

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

/**
 * What a seeded turn asked for. Names the request rather than the dialog it came from, so it
 * still reads once the page exists — and the title and path appear nowhere else in the
 * transcript until then.
 */
function OriginCaption({ origin }: { origin: MessageOrigin }): React.ReactElement {
  const path = `/${origin.page.path}`;
  return (
    <div
      // Both rows clip, so the full pair lives here.
      title={`${ORIGIN_LABEL} · ${origin.page.title} · ${path}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        fontSize: 11,
        lineHeight: 1.4,
        color: 'var(--pds-color-foreground-default-secondary)',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      <div style={oneLine}>
        <span style={{ fontWeight: 600 }}>{ORIGIN_LABEL}</span> · {origin.page.title}
      </div>
      {/* Clipped at the end, not the start: this says where the page lands, so the leading
          segments matter more than the slug. */}
      <div style={oneLine}>{path}</div>
    </div>
  );
}

interface FileCardProps {
  file: AttachedFile;
  onOpen?: (file: AttachedFile) => void;
  loadKept?: LoadKeptFile;
}

function AttachedFileCard({
  file,
  onOpen,
  loadKept,
}: FileCardProps): React.ReactElement {
  const inMemory = file.dataUrl !== undefined || file.text !== undefined;
  const fetchable = file.assetId !== undefined && loadKept !== undefined;
  if (!inMemory && !fetchable) {
    return (
      <div style={{ ...cardStyle, opacity: 0.75 }} title={`${file.filename} — not kept`}>
        <FileCardFace kind={file.kind} filename={file.filename} />
      </div>
    );
  }
  return <OpenableCard file={file} onOpen={onOpen} loadKept={loadKept} />;
}

function OpenableCard({
  file,
  onOpen,
  loadKept,
}: FileCardProps): React.ReactElement {
  const cardRef = React.useRef<HTMLButtonElement>(null);
  // A restored image has a reference and no bytes, so its thumbnail is fetched.
  const fetchId = file.kind === 'image' && file.dataUrl === undefined && loadKept !== undefined
    ? file.assetId
    : undefined;
  const thumbnail = useKeptThumbnail(cardRef, fetchId, loadKept);

  return (
    <button
      ref={cardRef}
      type="button"
      style={{ ...cardStyle, padding: 0, cursor: 'pointer' }}
      aria-label={`Open ${file.filename}`}
      title={file.filename}
      onClick={() => onOpen?.(file)}
    >
      <FileCardFace
        kind={file.kind}
        filename={file.filename}
        dataUrl={file.dataUrl ?? thumbnail}
      />
    </button>
  );
}

// Twice the 72px card, so it stays sharp on a retina screen without pulling the original.
const THUMBNAIL_WIDTH = 144;

/**
 * The thumbnail for a kept image, fetched only once the card is on screen. Otherwise a long
 * transcript fires one authenticated request per card the moment it loads. Undefined until
 * the image arrives; if it never does, the card keeps showing its filename.
 */
function useKeptThumbnail(
  cardRef: React.RefObject<HTMLElement | null>,
  assetId: string | undefined,
  loadKept?: LoadKeptFile,
): string | undefined {
  const [url, setUrl] = React.useState<string>();
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (assetId === undefined || visible) return undefined;
    const node = cardRef.current;
    // Without IntersectionObserver (happy-dom, older browsers) fetch eagerly, so the image
    // still shows up.
    if (!node || typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setVisible(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cardRef, assetId, visible]);

  React.useEffect(() => {
    if (!visible || assetId === undefined || !loadKept) return undefined;
    let objectUrl: string | null = null;
    let live = true;
    void loadKept(assetId, THUMBNAIL_WIDTH).then(
      blob => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      // Falling back to the filename is what the card did before thumbnails, so a failure
      // here costs nothing that already worked.
      () => undefined,
    );
    return () => {
      live = false;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, assetId, loadKept]);

  return url;
}

/**
 * The files that went with a turn. A brief's text goes to the model, not into the message, so
 * without this a turn shows no sign it carried one.
 */
function AttachedFiles({
  files,
  onOpen,
  loadKept,
}: {
  files: AttachedFile[];
  onOpen?: (file: AttachedFile) => void;
  loadKept?: LoadKeptFile;
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      gap: 6,
      maxWidth: '100%',
    }}>
      {/* Keyed by position: two pasted screenshots can genuinely share a name. */}
      {files.map((file, i) => (
        <AttachedFileCard key={i} file={file} onOpen={onOpen} loadKept={loadKept} />
      ))}
    </div>
  );
}

/** One caption row. Fixed to a single line: wrapping broke paths mid-segment. */
const oneLine = {
  maxWidth: '100%',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const;

/** What a seeded turn is asking for. One label because `MessageOrigin` has one source. */
const ORIGIN_LABEL = 'New page';

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
