/**
 * Throttle Utility Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { throttle } from '../src/utils/throttle.js';

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute immediately on first call (leading edge)', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should suppress calls within the interval', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);

    throttled();
    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should fire after interval with latest args (trailing edge)', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    expect(fn).toHaveBeenCalledWith('first');

    throttled('second');
    throttled('third');

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('third');
  });

  it('should not fire trailing call if no intermediate calls occurred', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should fire next leading call after interval expires', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    throttled('b');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('b');
  });

  it('should coalesce rapid burst to 2 calls (leading + trailing)', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    // Rapid burst
    throttled('a');
    throttled('b');
    throttled('c');
    throttled('d');
    throttled('e');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('e');
  });

  it('should prevent pending trailing call when cancel() is called', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    throttled('second');

    throttled.cancel();
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('first');
  });

  it('should be a no-op when cancel() is called with nothing pending', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    // cancel with nothing pending should not throw
    expect(() => throttled.cancel()).not.toThrow();

    throttled('a');
    vi.advanceTimersByTime(100);

    // cancel after trailing already fired
    expect(() => throttled.cancel()).not.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should execute pending trailing immediately when flush() is called', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    throttled('second');

    throttled.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('second');

    // Should not fire again when timer expires
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should be a no-op when flush() is called with nothing pending', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    expect(() => throttled.flush()).not.toThrow();
    expect(fn).not.toHaveBeenCalled();

    // Also no-op after leading call with no trailing args
    throttled('a');
    expect(fn).toHaveBeenCalledTimes(1);

    throttled.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should return correct isPending() state', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    expect(throttled.isPending()).toBe(false);

    throttled('a');
    // After leading call with no trailing args queued, timer is running but no args stored
    // isPending reflects whether there are stored args waiting
    throttled('b');
    expect(throttled.isPending()).toBe(true);

    vi.advanceTimersByTime(100);
    expect(throttled.isPending()).toBe(false);
  });

  it('should pass multiple arguments through correctly', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('arg1', 42, { key: 'value' });
    expect(fn).toHaveBeenCalledWith('arg1', 42, { key: 'value' });

    throttled('arg2', 99, { key: 'other' });
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenLastCalledWith('arg2', 99, { key: 'other' });
  });
});
