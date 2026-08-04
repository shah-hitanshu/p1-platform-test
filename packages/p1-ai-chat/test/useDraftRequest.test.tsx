import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDraftRequest } from '../src/useDraftRequest.js';
import { createDraftRequestChannel } from '../src/draftRequestChannel.js';
import type { DraftRequest } from '../src/types.js';

const request = (brief: string, documentPath = '/target'): DraftRequest => ({ brief, documentPath });

// Default gate: connected, scoped to the request's target page.
const ready = (documentPath = '/target'): { documentPath: string; ready: boolean } => ({
  documentPath,
  ready: true,
});

describe('useDraftRequest', () => {
  it('delivers a request published after mount when ready and in scope', () => {
    const channel = createDraftRequestChannel();
    const onRequest = vi.fn();
    renderHook(() => useDraftRequest(channel, ready(), onRequest));

    const a = request('hello', '/target');
    channel.publish(a);

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith(a);
  });

  it('picks up a request published before mount (publish-before-subscribe)', () => {
    const channel = createDraftRequestChannel();
    const pending = request('early');
    channel.publish(pending);

    const onRequest = vi.fn();
    renderHook(() => useDraftRequest(channel, ready(), onRequest));

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith(pending);
  });

  it('does NOT fire until the socket is ready, then fires once it is', () => {
    const channel = createDraftRequestChannel();
    channel.publish(request('wait-for-ready'));
    const onRequest = vi.fn();

    const { rerender } = renderHook(
      ({ r }) => useDraftRequest(channel, { documentPath: '/target', ready: r }, onRequest),
      { initialProps: { r: false } },
    );
    expect(onRequest).not.toHaveBeenCalled();

    rerender({ r: true });
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when the sidebar is scoped to a different document, then fires when it matches', () => {
    const channel = createDraftRequestChannel();
    channel.publish(request('scoped', '/new-page'));
    const onRequest = vi.fn();

    const { rerender } = renderHook(
      ({ doc }) => useDraftRequest(channel, { documentPath: doc, ready: true }, onRequest),
      { initialProps: { doc: '/old-page' } },
    );
    expect(onRequest).not.toHaveBeenCalled();

    rerender({ doc: '/new-page' });
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('matches document paths regardless of a leading slash', () => {
    const channel = createDraftRequestChannel();
    channel.publish(request('slash', 'new-page')); // no leading slash from the modal
    const onRequest = vi.fn();

    renderHook(() => useDraftRequest(channel, { documentPath: '/new-page', ready: true }, onRequest));

    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  // The publisher and the sidebar derive this path independently, so a cosmetic
  // difference must not decide whether the brief is delivered.
  it('matches document paths regardless of a trailing slash or surrounding space', () => {
    const channel = createDraftRequestChannel();
    channel.publish(request('slash', 'new-page/'));
    const onRequest = vi.fn();

    renderHook(() => useDraftRequest(channel, { documentPath: ' /new-page ', ready: true }, onRequest));

    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  // A mismatch is silent by design: the gate never opens, so the brief never sends and
  // the UI looks identical to a slow agent. The warning is the only way to tell.
  it('warns in dev when a request stays unmatched, naming both paths', () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const channel = createDraftRequestChannel();
      channel.publish(request('never lands', 'wanted-page'));

      renderHook(() => useDraftRequest(channel, { documentPath: 'a-different-page', ready: true }, vi.fn()));
      expect(warn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10_000);

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]?.[0] as string;
      expect(message).toContain('wanted-page');
      expect(message).toContain('a-different-page');
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  // An out-of-scope panel arms the warning, but a panel in scope consumes the request
  // first. Warning then would blame a delivery that actually worked.
  it('does not warn when another panel consumed the request first', () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const channel = createDraftRequestChannel();
      channel.publish(request('lands elsewhere', 'target-page'));

      renderHook(() => useDraftRequest(channel, { documentPath: 'other-page', ready: true }, vi.fn()));
      renderHook(() => useDraftRequest(channel, { documentPath: 'target-page', ready: true }, vi.fn()));

      vi.advanceTimersByTime(10_000);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  // The guard must compile away in a production bundle rather than shipping console
  // noise into a real editor.
  it('stays silent in a production build', () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const channel = createDraftRequestChannel();
      channel.publish(request('never lands', 'wanted-page'));

      renderHook(() => useDraftRequest(channel, { documentPath: 'elsewhere', ready: true }, vi.fn()));
      vi.advanceTimersByTime(10_000);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  it('does not warn once the request has been consumed', () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const channel = createDraftRequestChannel();
      channel.publish(request('lands'));

      renderHook(() => useDraftRequest(channel, ready(), vi.fn()));
      vi.advanceTimersByTime(10_000);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  // `undefined` and '/' both normalize to empty, so without an explicit guard a
  // malformed request would fire against a sidebar that has no document loaded at all.
  it('never fires for a request whose path normalizes to empty', () => {
    const channel = createDraftRequestChannel();
    channel.publish(request('malformed', '/'));
    const onRequest = vi.fn();

    renderHook(() => useDraftRequest(channel, { documentPath: undefined, ready: true }, onRequest));

    expect(onRequest).not.toHaveBeenCalled();
  });

  it('consumes once and clears the retained request so a remount cannot replay it', () => {
    const channel = createDraftRequestChannel();
    const only = request('once');
    channel.publish(only);

    const onRequest = vi.fn();
    const { unmount } = renderHook(() => useDraftRequest(channel, ready(), onRequest));
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(channel.getLatest()).toBeNull(); // cleared on consume

    // A fresh mount (e.g. after navigating back) must not re-fire it.
    unmount();
    const onRequest2 = vi.fn();
    renderHook(() => useDraftRequest(channel, ready(), onRequest2));
    expect(onRequest2).not.toHaveBeenCalled();
  });

  it('is a no-op when no channel is provided', () => {
    const onRequest = vi.fn();
    expect(() => renderHook(() => useDraftRequest(undefined, ready(), onRequest))).not.toThrow();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('does not resubscribe when only the callback changes', () => {
    const channel = createDraftRequestChannel();
    const subscribeSpy = vi.spyOn(channel, 'subscribe');
    const { rerender } = renderHook(({ cb }) => useDraftRequest(channel, ready(), cb), {
      initialProps: { cb: vi.fn() },
    });

    rerender({ cb: vi.fn() });

    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });
});
