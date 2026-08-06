import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { Button, Icon, Textarea, UtilityButton } from '@pantheon-systems/pds-toolkit-react';
import { useP1Puck, useP1Auth } from '@pantheon-systems/puck-css';
import { useGetPuck } from '@puckeditor/core';
import { useAgentChat } from './useAgentChat.js';
import { useDraftRequest } from './useDraftRequest.js';
import { toolCallLabel } from './toolLabels.js';
import { activeStep } from './messageParts.js';
import { ChatMessage } from './ChatMessage.js';
import { visuallyHidden } from './a11y.js';
import type { AIChatPluginOptions, DraftRequest } from './types.js';

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
          {"Describe the page you want, and I'll build it."}
          <div style={{ marginTop: 8, fontSize: 12 }}>
            {'Try "add a pricing section with three tiers" or "write an FAQ about shipping".'}
          </div>
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
  // Non-subscribing accessor to Puck's store, used to open this panel on a request.
  const getPuck = useGetPuck();

  // Stable refs so getAgentId/getContext don't change on every render
  const cssRef = useRef(css);
  cssRef.current = css;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // Reactive scope key: recomputed when the user/site/branch/document changes so
  // the hook reconnects and loads that conversation's history. History is
  // persisted per-document, so switching documents shows that document's chat.
  const { userId, siteId, branchId, currentDocument } = css;
  // `currentDocument` is nullable and the id then falls back to `root`, which is also the home
  // page's own conversation — so a turn sent before it resolves commits to the wrong one.
  const documentReady = currentDocument !== null || options.getAgentId !== undefined;
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

  const {
    messages, input, setInput, submit, sendMessage, isLoading, ready,
    reconnecting, historyLoaded, canRetry, clearMessages, stop, retry,
  } = useAgentChat({
    agentUrl: options.agentUrl,
    agentId,
    getContext,
  });

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
        try {
          getPuck().dispatch({
            type: 'setUi',
            ui: { plugin: { current: 'ai-chat' }, leftSideBarVisible: true },
          });
        } catch {
          // Puck store unreachable outside the editor; opening the panel is best-effort.
        }
        // A seeded draft should stream into view, not behind the user's scroll position.
        stickToBottomRef.current = true;
        void sendMessage(request.brief, {
          documentPath: request.documentPath,
          newPage: request.newPage,
        });
      },
      [getPuck, sendMessage],
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
    if (!input.trim() || !documentReady) return;
    stickToBottomRef.current = true;
    // Only a send typed here earns the focus back when the turn ends (see below).
    awaitingOwnReplyRef.current = true;
    void submit();
  }, [input, submit, documentReady]);

  // Return focus to the composer when a turn the user started here finishes, so they can
  // keep typing. Gated on having sent from this box: the effect also runs on mount and
  // after a seeded turn, and unconditionally focusing snatched the caret out of the canvas
  // or a sidebar field the moment the agent finished.
  useEffect(() => {
    if (isLoading || !awaitingOwnReplyRef.current) return;
    awaitingOwnReplyRef.current = false;
    textareaRef.current?.focus();
  }, [isLoading]);

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
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      // Containing block for the visually-hidden status region below.
      position: 'relative',
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
        {/* minWidth:0 lets this block shrink instead of forcing the row wider than the
            panel, which wrapped the title onto two lines and the subtitle onto three. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon iconName="sparkles" size="m" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pds-color-foreground-default)' }}>
              AI Page Builder
            </div>
            <div style={{ fontSize: 11, color: 'var(--pds-color-foreground-default-secondary)', marginTop: 2 }}>
              Describe what you want to build or change
            </div>
          </div>
        </div>
        {/* One action only: the header has room for a single labelled button at this width. */}
        {messages.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <UtilityButton label="Clear" iconName="trash" isCritical onClick={handleClear} />
          </div>
        )}
      </div>

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
          // Deliberately NOT disabled while streaming: a reply takes tens of seconds, and
          // locking the box means composing the follow-up has to wait for the agent. Only
          // sending is blocked until the turn ends.
          rows={3}
          isResizable
          ref={textareaRef}
        />
        {/* Hint and action share a row: the button had one to itself directly above this
            line, spending ~40px of a narrow panel to hold a single control. `wrap` is the
            fallback for a panel too narrow to seat both. */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 8,
        }}>
          <div style={{ fontSize: 11, color: 'var(--pds-color-foreground-default-secondary)', minWidth: 0 }}>
            {!documentReady
              ? 'Opening the page…'
              : reconnecting ? 'Reconnecting…' : 'Enter to send · Shift+Enter for newline'}
          </div>
          {isLoading ? (
            // Stop, not a spinning Send. A turn edits the live page, so being able to call
            // it off matters more than being told it is busy — which the status line and
            // the transcript's own in-flight step already say.
            <Button
              label="Stop"
              variant="secondary"
              size="s"
              displayType="icon-end"
              iconName="circleXmark"
              onClick={stop}
            />
          ) : (
            <Button
              label="Send"
              variant="secondary"
              size="s"
              displayType="icon-end"
              iconName="paperPlane"
              onClick={submitAndStick}
              disabled={!input.trim() || !documentReady}
            />
          )}
        </div>
      </div>
    </div>
  );
}
