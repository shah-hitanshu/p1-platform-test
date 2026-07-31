/**
 * Throttle Utility Tests
 *
 * Tests reflect trailing-only semantics: the first call stores args and starts
 * a timer; the function fires once per interval with the latest stored args.
 * There is no leading-edge fire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { throttle } from '../src/core/utils/throttle.js';

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute after first call\'s interval elapses (trailing only)', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should suppress calls within the interval', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).not.toHaveBeenCalled();

    throttled();
    throttled();
    throttled();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should fire after interval with latest args (trailing edge)', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    throttled('second');
    throttled('third');

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('third');
  });

  it('should fire exactly once and stop when no subsequent calls occur', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    // No second fire after another interval with no calls
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should start a new trailing cycle after the interval expires', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');

    throttled('b');
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('b');
  });

  it('should coalesce rapid burst to 1 call (trailing only)', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    // Rapid burst — all coalesced into one trailing call
    throttled('a');
    throttled('b');
    throttled('c');
    throttled('d');
    throttled('e');

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('e');
  });

  it('should prevent pending trailing call when cancel() is called', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    throttled('second');

    throttled.cancel();
    vi.advanceTimersByTime(100);

    expect(fn).not.toHaveBeenCalled();
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
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('second');

    // Should not fire again when timer expires
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should be a no-op when flush() is called with nothing pending', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    // no-op when nothing queued
    expect(() => throttled.flush()).not.toThrow();
    expect(fn).not.toHaveBeenCalled();

    // After flush drains the pending call, a second flush is a no-op
    throttled('a');
    throttled.flush();
    expect(fn).toHaveBeenCalledTimes(1);

    throttled.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should return correct isPending() state', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    expect(throttled.isPending()).toBe(false);

    throttled('a');
    expect(throttled.isPending()).toBe(true);

    throttled('b');
    expect(throttled.isPending()).toBe(true);

    vi.advanceTimersByTime(100);
    expect(throttled.isPending()).toBe(false);
  });

  it('should pass multiple arguments through correctly', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('arg1', 42, { key: 'value' });
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('arg1', 42, { key: 'value' });

    throttled('arg2', 99, { key: 'other' });
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenLastCalledWith('arg2', 99, { key: 'other' });
  });
});
