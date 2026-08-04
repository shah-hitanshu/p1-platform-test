import { describe, it, expect, vi } from 'vitest';
import { createDraftRequestChannel } from '../src/draftRequestChannel.js';
import type { DraftRequest } from '../src/types.js';

const request = (brief: string, documentPath = '/p'): DraftRequest => ({ brief, documentPath });

describe('createDraftRequestChannel', () => {
  it('delivers published requests to subscribers', () => {
    const channel = createDraftRequestChannel();
    const seen: DraftRequest[] = [];
    channel.subscribe((i) => seen.push(i));

    const a = request('a');
    channel.publish(a);

    expect(seen).toEqual([a]);
  });

  it('only fires subscribers for future publishes, not past ones', () => {
    const channel = createDraftRequestChannel();
    channel.publish(request('before'));

    const listener = vi.fn();
    channel.subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it('getLatest returns the most recent request for publish-before-subscribe safety', () => {
    const channel = createDraftRequestChannel();
    expect(channel.getLatest()).toBeNull();

    const a = request('a');
    const b = request('b');
    channel.publish(a);
    channel.publish(b);

    expect(channel.getLatest()).toBe(b);
  });

  it('stops delivering after unsubscribe', () => {
    const channel = createDraftRequestChannel();
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);

    channel.publish(request('one'));
    unsubscribe();
    channel.publish(request('two'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clearLatest drops the retained request', () => {
    const channel = createDraftRequestChannel();
    channel.publish(request('a'));
    expect(channel.getLatest()).not.toBeNull();

    channel.clearLatest();

    expect(channel.getLatest()).toBeNull();
  });

  // Without expiry a request whose navigation failed sits in the channel for the life of the
  // tab, then auto-submits whenever the user next opens that document.
  it('expires a retained request that was never consumed', () => {
    vi.useFakeTimers();
    try {
      const channel = createDraftRequestChannel();
      channel.publish(request('stale'));
      expect(channel.getLatest()).not.toBeNull();

      vi.advanceTimersByTime(120_001);

      expect(channel.getLatest()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still retains a request across the seconds a navigation actually takes', () => {
    vi.useFakeTimers();
    try {
      const channel = createDraftRequestChannel();
      const published = request('fresh');
      channel.publish(published);

      vi.advanceTimersByTime(5_000);

      expect(channel.getLatest()).toBe(published);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a throwing listener does not block delivery to the others', () => {
    const channel = createDraftRequestChannel();
    const good = vi.fn();
    channel.subscribe(() => {
      throw new Error('boom');
    });
    channel.subscribe(good);

    expect(() => channel.publish(request('x'))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
