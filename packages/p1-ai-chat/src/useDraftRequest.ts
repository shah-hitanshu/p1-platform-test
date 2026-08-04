import { useEffect, useRef } from 'react';
import type { DraftRequest, DraftRequestChannel } from './types.js';
import { isDevBuild } from './devBuild.js';

/**
 * Compare document paths tolerantly. The publisher (the Create Page modal) and the
 * consumer (`useP1Puck().currentDocument.path`) derive this string independently, so a
 * cosmetic difference must not decide whether the brief is delivered. Case is left
 * alone deliberately: slugs are lowercased at creation, and folding case here could
 * match two genuinely distinct documents.
 */
function normalizePath(p: string | undefined): string {
  return (p ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * How long a request may sit unmatched before we assume the gate will never open and
 * say so. Long enough to cover a slow page hydration, short enough to still be on
 * screen while the user is wondering why nothing happened.
 */
const UNMATCHED_WARN_MS = 10_000;

function warnUnmatched(request: DraftRequest, currentPath: string | undefined): void {
  // A mismatch here is silent by nature: the gate simply never opens, so the brief never
  // sends and the UI is indistinguishable from a slow agent. Naming both paths is the
  // difference between a five-minute fix and a bug report saying "AI does nothing".
  if (!isDevBuild()) return;
  console.warn(
    `[p1-ai-chat] A request for "${request.documentPath}" has gone unconsumed for ` +
      `${UNMATCHED_WARN_MS / 1000}s. The sidebar's current document is ` +
      `"${currentPath ?? '(none)'}". These must match after normalization for the ` +
      `brief to send.`,
  );
}

/** Gate conditions under which a request may be sent. */
export interface DraftRequestGate {
  /** The sidebar's current document path — the request fires only when it matches the target. */
  documentPath: string | undefined;
  /** Whether the sidebar's socket is open — the request fires only on a stable connection. */
  ready: boolean;
}

/**
 * Deliver a {@link DraftRequest} to the chat sidebar exactly once, and only once the
 * request's target matches the sidebar's current document and the socket is open.
 */
export function useDraftRequest(
  channel: DraftRequestChannel | undefined,
  gate: DraftRequestGate,
  onRequest: (request: DraftRequest) => void,
): void {
  const onRequestRef = useRef(onRequest);
  onRequestRef.current = onRequest;
  const consumedRef = useRef<DraftRequest | null>(null);
  const { documentPath, ready } = gate;

  useEffect(() => {
    if (!channel || !ready) return;
    let warnTimer: ReturnType<typeof setTimeout> | null = null;

    const tryConsume = (request: DraftRequest | null): void => {
      if (!request || request === consumedRef.current) return;
      const target = normalizePath(request.documentPath);
      // A target that normalizes to empty would match a sidebar with no document loaded
      // yet, since `undefined` normalizes to empty too, and the brief would fire against
      // no document at all. The modal always supplies a slug, so empty means malformed.
      if (!target || target !== normalizePath(documentPath)) {
        // Not ours (yet). Arm the diagnostic rather than returning silently.
        if (!warnTimer) {
          warnTimer = setTimeout(() => {
            // Re-check on fire: another panel may have consumed this request, or the channel
            // may have expired it, and warning about it then would be a false alarm.
            if (channel.getLatest() === request) warnUnmatched(request, documentPath);
          }, UNMATCHED_WARN_MS);
        }
        return;
      }
      if (warnTimer) {
        clearTimeout(warnTimer);
        warnTimer = null;
      }
      consumedRef.current = request;
      // Sending is single-flight per conversation: `sendMessage` bails synchronously when
      // the session is already loading, which is what keeps a second mounted panel from
      // submitting the same brief twice. Do not "simplify" that early return away.
      onRequestRef.current(request);
      channel.clearLatest();
    };

    // Re-runs when `ready` flips true or the scope changes, so a request published
    // during the navigation transition is picked up once the target page settles.
    tryConsume(channel.getLatest());
    const unsubscribe = channel.subscribe(tryConsume);
    return () => {
      if (warnTimer) clearTimeout(warnTimer);
      unsubscribe();
    };
  }, [channel, ready, documentPath]);
}
