import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { Icon, IconButton, Textarea } from '@pantheon-systems/pds-toolkit-react';
import { useP1Puck, useP1Auth } from '@pantheon-systems/puck-css';
import { useAgentChat } from '../../hooks/useAgentChat.js';
import { normalizeDocumentPath } from '../../lib/session/chatState.js';
import { useDraftRequest } from '../../hooks/useDraftRequest.js';
import { useSelectedBlock } from '../../hooks/useSelectedBlock.js';
import { toolCallLabel } from '../../lib/transcript/toolLabels.js';
import { activeStep } from '../../lib/transcript/messageParts.js';
import { AttachmentTray } from '../attachments/AttachmentTray.js';
import { AttachButton } from '../attachments/AttachButton.js';
import { DropOverlay } from '../attachments/DropOverlay.js';
import { AttachmentModal } from '../attachments/AttachmentModal.js';
import { clipboardFiles } from '../../lib/attachments/clipboardFiles.js';
import { attachmentBlocker, toAttachedFile } from '../../lib/attachments/pendingAttachments.js';
import { downscaleImage } from '../../lib/attachments/downscaleImage.js';
import { ChatMessage } from '../transcript/ChatMessage.js';
import { visuallyHidden } from '../../lib/a11y.js';
import type { AIChatPluginOptions, AttachedFile, DraftRequest } from '../../types.js';
import { ChatPanelHeader } from './ChatPanelHeader.js';

interface Props {
  options: AIChatPluginOptions;
}

/**
 * How close to the bottom we keep while autoscrolling. The slack absorbs sub-pixel rounding
 * and the growth of the line currently streaming in.
 */
const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

/**
 * A transcript with nothing in it: still loading, or genuinely new. `messages` alone can't tell
 * them apart, and showing the prompt too early flashed it on every open of a full conversation.
 */
function EmptyTranscript({ historyLoaded }: { historyLoaded: boolean }): React.ReactElement {
  return (
    <div style={{
      textAlign: 'center',
      color: 'var(--pds-color-foreground-default-secondary)',
      fontSize: 13,
      paddingTop: 32,
    }}>
      {historyLoaded ? (
        <>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
            <Icon iconName="sparkles" size="xl" />
          </div>
          I can generate or restructure the page, rewrite copy, suggest layouts, or create
          imagery. Tell me what to change here.
        </>
      ) : (
        'Loading conversation…'
      )}
    </div>
  );
}

export function ChatPanel({ options }: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Whether new content should scroll into view. Responses stream in token by token, so
  // scrolling unconditionally would yank anyone reading earlier messages back down on
  // every chunk. Scrolling up releases the lock; returning to the bottom re-engages it.
  const stickToBottomRef = useRef(true);
  // Set when a turn is sent from this composer, so only that turn's completion pulls
  // focus back here.
  const awaitingOwnReplyRef = useRef(false);

  const css = useP1Puck();
  const { getToken, isAuthenticated } = useP1Auth();

  // Stable refs so getAgentId/getContext don't change on every render
  const cssRef = useRef(css);
  cssRef.current = css;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const selectedBlock = useSelectedBlock();
  const selectedBlockRef = useRef(selectedBlock);
  selectedBlockRef.current = selectedBlock;

  // Site-scoped, not per page, so the transcript follows the user around. The turn's own
  // document rides along in `getContext`.
  const { userId, siteId, currentDocument } = css;
  const agentId = useMemo(() => {
    if (options.getAgentId) return options.getAgentId();
    return `${userId}-${siteId}`;
  }, [options, userId, siteId]);

  // Fetches a fresh token rather than reading React state directly — auth
  // loads asynchronously on mount, so a state snapshot can still be null the
  // moment a user submits their first message.
  const getContext = useCallback(async () => ({
    siteId: cssRef.current.siteId,
    branchId: cssRef.current.branchId,
    documentPath: cssRef.current.currentDocument?.path ?? '',
    documentId: cssRef.current.currentDocument?.id ?? '',
    token: (await getTokenRef.current()) ?? '',
    ...(selectedBlockRef.current ? { selectedBlock: selectedBlockRef.current } : {}),
  }), []);

  const {
    messages, input, setInput, submit, sendMessage, isLoading, ready,
    reconnecting, historyLoaded, canRetry, clearMessages, stop, retry, awaitingNewPage,
    writeSet, visitPage, addWritablePage, removeWritablePage,
    scopeExpanded, setScopeExpanded, attachments, attachFiles, removeAttachment,
  } = useAgentChat({
    agentUrl: options.agentUrl,
    agentId,
    getContext,
    onPageCreated: options.onPageCreated,
    prepareImage: downscaleImage,
  });

  // A turn needs somewhere to write. Usually that is the open document, but a conversation
  // waiting on a page it asked for is about to create one — and the answer it is waiting for
  // ("yes, use that template") has to be typeable with nothing open.
  const canSend = currentDocument !== null || awaitingNewPage;
  // Sending over a file still arriving, or one refused, delivers a message the user believes
  // carries their brief.
  const attachmentHold = attachmentBlocker(attachments);

  const currentPath = currentDocument?.path ?? null;

  // Keyed on whether the set exists, not on the set: removing a chip must not re-add the page.
  const unseeded = writeSet === null;
  useEffect(() => {
    if (currentPath !== null) visitPage(currentPath);
  }, [currentPath, unseeded, visitPage]);

  // `_registry/...` holds component and template definitions: documents to the API, but not pages.
  const sitePages = useMemo(
    () => css.documents
      .filter(doc => !doc.archived && !normalizeDocumentPath(doc.path).startsWith('_registry/'))
      .map(doc => normalizeDocumentPath(doc.path))
      .sort((a, b) => a.localeCompare(b)),
    [css.documents],
  );

  // Clear takes effect immediately. It also stops any turn in flight, so it can't leave
  // the agent editing the page for a conversation that no longer exists.
  const handleClear = useCallback(() => {
    clearMessages();
    // The button unmounts with the last message, and focus would otherwise fall to the
    // document body, so hand it to the composer instead.
    textareaRef.current?.focus();
  }, [clearMessages]);

  // Auto-submit a brief handed to us from elsewhere in the editor (Create Page ->
  // "Generate with AI"). Gating on `isAuthenticated` matters: the brief arrives right
  // after a navigation, and sending before auth re-settles makes the agent's CSS tool
  // calls 401.
  useDraftRequest(
    options.draftRequests,
    { documentPath: css.currentDocument?.path, ready: ready && isAuthenticated },
    useCallback(
      (request: DraftRequest) => {
        // No need to open the panel here — the publisher does, and this only mounts once open.
        // A seeded draft should stream into view, not behind the user's scroll position.
        stickToBottomRef.current = true;
        void sendMessage(
          request.brief,
          request.kind === 'create-page'
            ? {
                // The same page twice because the two outlive each other: `pendingPage` is
                // dropped once the page exists, `origin` stays on the turn that asked for it.
                pendingPage: request.page,
                origin: { source: 'create-page', page: request.page },
              }
            : { documentPath: request.documentPath, newPage: request.newPage },
        );
      },
      [sendMessage],
    ),
  );

  // Whether a turn has run while this panel has been open. Gates the "how it ended"
  // announcement below, which must not fire on open for a conversation whose restored
  // history simply happens to end in a reply.
  const turnStartedRef = useRef(false);
  useEffect(() => {
    if (isLoading) turnStartedRef.current = true;
  }, [isLoading]);

  // What the panel's single live region announces. Naming the running step is the
  // useful signal ("Applying changes…"), so this reads it off the turn in flight rather
  // than each ToolGroup announcing separately and competing for the same region. Uses the
  // same helper the transcript renders from, so the two can't name different steps.
  const statusMessage = useMemo(() => {
    if (reconnecting) return 'Reconnecting to the assistant';
    const last = messages[messages.length - 1];
    if (isLoading) {
      const running = last?.role === 'assistant' ? activeStep(last) : undefined;
      return running ? `${toolCallLabel(running)}…` : 'Working on your request';
    }
    // How the turn ended. Without this the region emptied on completion, and an empty
    // polite region announces nothing — so a screen reader heard the work start and was
    // never told it had finished.
    if (!turnStartedRef.current || last?.role !== 'assistant') return '';
    if (last.error) return 'Something went wrong';
    if (last.stopped) return 'Stopped';
    return 'Reply ready';
  }, [isLoading, reconnecting, messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Plugin tabs stay mounted while hidden, where `scrollHeight` is 0 and the pin above does
  // nothing — so re-pin when the box gains a size, which is when this tab is opened.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Sending re-engages the lock unconditionally: if you'd scrolled up to re-read
  // something, your own new message would otherwise land off-screen.
  const submitAndStick = useCallback(() => {
    // `submit()` would bail, leaving the flag latched with no turn to clear it.
    if (!input.trim() || !canSend || attachmentHold !== null) return;
    stickToBottomRef.current = true;
    // Only a send typed here earns the focus back when the turn ends (see below).
    awaitingOwnReplyRef.current = true;
    void submit();
  }, [input, submit, canSend, attachmentHold]);

  // Return focus to the composer when a turn the user started here finishes, so they can
  // keep typing. Gated on having sent from this box: the effect also runs on mount and
  // after a seeded turn, and unconditionally focusing snatched the caret out of the canvas
  // or a sidebar field the moment the agent finished.
  useEffect(() => {
    if (isLoading || !awaitingOwnReplyRef.current) return;
    awaitingOwnReplyRef.current = false;
    textareaRef.current?.focus();
  }, [isLoading]);

  const { isDragging, dropProps } = useFileDrop(attachFiles);
  const [openFile, setOpenFile] = useState<AttachedFile | null>(null);

  const actionsRef = useRef<HTMLDivElement>(null);
  const [actionsWidth, setActionsWidth] = useState(COMPOSER_ACTIONS_WIDTH);
  useEffect(() => {
    const row = actionsRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // A hidden panel measures 0, which would reserve nothing at all.
      if (row.offsetWidth > 0) setActionsWidth(row.offsetWidth);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent): void => {
    const files = clipboardFiles(e.clipboardData);
    if (files.length === 0) return;
    // Only once there is a file to take: a paste carrying text as well would otherwise lose it.
    e.preventDefault();
    attachFiles(files);
  }, [attachFiles]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // Swallowed rather than turned into a newline while a turn runs: the box stays open for
    // composing, but Enter must keep meaning "send" so a follow-up isn't silently mangled
    // into the draft. The text is kept, ready to send once the turn ends.
    e.preventDefault();
    if (isLoading) return;
    submitAndStick();
  };

  return (
    <div
      // The whole panel is the target, not just the composer: a file gets aimed at the rail,
      // and a miss navigates the editor away to the dropped file.
      {...dropProps}
      style={{
        display: 'flex',
        flexDirection: 'column',
        // minHeight lets the transcript scroll instead of stretching this past the rail.
        flex: 1,
        minHeight: 0,
        // Containing block for the visually-hidden status region below.
        position: 'relative',
      }}
    >
      {isDragging && <DropOverlay />}
      {openFile !== null && (
        <AttachmentModal file={openFile} onClose={() => setOpenFile(null)} />
      )}
      <ChatPanelHeader
        canClear={messages.length > 0}
        onClear={handleClear}
        writeSet={writeSet}
        sitePages={sitePages}
        onAddPage={addWritablePage}
        onRemovePage={removeWritablePage}
        isExpanded={scopeExpanded}
        onExpandedChange={setScopeExpanded}
      />
      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        // Deliberately NOT a live region. Announcing a whole transcript reads it out as
        // one long string and strips the structure from headings, links and buttons, and
        // a streamed reply would fire on every token. Instead the transcript is ordinary
        // navigable content: `aria-busy` marks it as settling while tokens arrive, and
        // the coarse status line below carries the announcements.
        aria-busy={isLoading}
        // Focusable so keyboard-only users can scroll the transcript. `role` is what makes
        // the label reachable: an aria-label on a role-less element is not required to be
        // exposed, so the region would have been an unnamed tab stop.
        tabIndex={0}
        role="region"
        aria-label="Conversation"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
        }}
      >
        {messages.length === 0 && <EmptyTranscript historyLoaded={historyLoaded} />}
        {messages.map((msg, i) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            // Only the newest turn can be retried, so a resend can't fork the
            // conversation from the middle of the transcript.
            onRetry={canRetry && i === messages.length - 1 ? retry : undefined}
            onOpenFile={setOpenFile}
          />
        ))}
      </div>

      {/* Coarse announcements for assistive tech. This is the ONLY live region in the
          panel: a single status that replaces itself, so a screen reader hears the step in
          flight and then how the turn ended, rather than every streamed token. Always
          rendered, empty when there is nothing to say, because a live region has to exist
          before content lands in it — one created together with its content is widely not
          announced. */}
      <div role="status" aria-live="polite" style={visuallyHidden}>
        {statusMessage}
      </div>

      {/* Input */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--pds-color-border-default)',
          flexShrink: 0,
        }}
        data-testid="chat-composer"
        // Paste bubbles here from the textarea, where it is actually made.
        onPaste={handlePaste}
      >
        <AttachmentTray
          attachments={attachments}
          onRemove={removeAttachment}
          onOpen={attachment => setOpenFile(toAttachedFile(attachment))}
        />
        <div style={{ position: 'relative' }}>
          <Textarea
            id="ai-chat-input"
            label="Message"
            showLabel={false}
            placeholder="Ask Pantheon AI…"
            value={input}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
            textareaProps={{
              onKeyDown: handleKeyDown,
              style: { paddingRight: actionsWidth + COMPOSER_ACTIONS_INSET * 2 },
            }}
            // Deliberately NOT disabled while streaming: a reply takes tens of seconds, and
            // locking the box means composing the follow-up has to wait for the agent. Only
            // sending is blocked until the turn ends.
            rows={3}
            isResizable
            ref={textareaRef}
          />
          <div
            ref={actionsRef}
            data-testid="composer-actions"
            style={{
              position: 'absolute',
              right: COMPOSER_ACTIONS_INSET,
              bottom: COMPOSER_ACTIONS_INSET,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <AttachButton onFiles={attachFiles} />
            <ComposerAction
              isLoading={isLoading}
              canSubmit={Boolean(input.trim()) && canSend && attachmentHold === null}
              onSubmit={submitAndStick}
              onStop={stop}
            />
          </div>
        </div>
        <ComposerHint canSend={canSend} reconnecting={reconnecting} attachmentHold={attachmentHold} />
      </div>
    </div>
  );
}

interface FileDropProps {
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

function useFileDrop(onFiles: (files: File[]) => void): { isDragging: boolean; dropProps: FileDropProps } {
  // Counted, not a flag: dragging over a child fires `dragleave` on the parent, which would
  // clear the highlight the moment the cursor crossed the textarea.
  const depthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const onDragEnter = useCallback((e: React.DragEvent): void => {
    if (!e.dataTransfer.types.includes('Files')) return;
    depthRef.current += 1;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent): void => {
    if (!e.dataTransfer.types.includes('Files')) return;
    // Without this the browser takes the drop itself and opens the file over the editor.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((): void => {
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent): void => {
    // Cleared before the early return: a drag can advertise `Files` and still arrive with an
    // empty list, and that drop would otherwise leave the overlay covering the panel.
    depthRef.current = 0;
    setIsDragging(false);
    // Before the early return: `onDragOver` already marked the panel a valid target, so a drag
    // that promises files and delivers none would otherwise be handed back to the browser.
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    onFiles(files);
  }, [onFiles]);

  return { isDragging, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

const COMPOSER_ACTIONS_INSET = 8;

/** Two icon buttons and the gap between them, until the row reports its real width. */
const COMPOSER_ACTIONS_WIDTH = 60;

/** Stop replaces Send while a turn runs: a turn edits the live page, so calling it off matters. */
function ComposerAction({
  isLoading,
  canSubmit,
  onSubmit,
  onStop,
}: {
  isLoading: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onStop: () => void;
}): React.ReactElement {
  if (isLoading) {
    return (
      <IconButton ariaLabel="Stop" iconName="circleXmark" size="s" hasTooltip={false} onClick={onStop} />
    );
  }
  return (
    <IconButton
      ariaLabel="Send"
      iconName="paperPlane"
      size="s"
      hasTooltip={false}
      onClick={onSubmit}
      disabled={!canSubmit}
    />
  );
}

/** Whichever of the composer's conditions is worth a line, in the order they take priority. */
function hintText(canSend: boolean, attachmentHold: string | null, reconnecting: boolean): string {
  if (!canSend) return 'Open a page to make changes';
  if (attachmentHold !== null) return attachmentHold;
  if (reconnecting) return 'Reconnecting…';
  return 'Enter to send · Shift+Enter for newline';
}

function ComposerHint({
  canSend,
  reconnecting,
  attachmentHold,
}: {
  canSend: boolean;
  reconnecting: boolean;
  attachmentHold: string | null;
}): React.ReactElement {
  const text = hintText(canSend, attachmentHold, reconnecting);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--pds-color-foreground-default-secondary)', minWidth: 0 }}>
        {text}
      </div>
    </div>
  );
}
