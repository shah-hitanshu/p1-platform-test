/**
 * Auto-save Pause Tests
 *
 * Tests for pausing and resuming auto-save during checkpoint creation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../src/core/utils/debounce.js';

describe('debounce pause/resume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not execute when paused', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.pause();
    vi.advanceTimersByTime(200);

    expect(fn).not.toHaveBeenCalled();
  });

  it('should execute pending call when resumed', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.pause();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();

    debounced.resume();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should not start new timer when called while paused', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced.pause();
    debounced();
    vi.advanceTimersByTime(200);

    expect(fn).not.toHaveBeenCalled();
  });

  it('should execute with latest args after resume', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('first');
    debounced.pause();
    debounced('second');
    debounced('third');
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();

    debounced.resume();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('third');
  });

  it('should report paused state via isPaused', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    expect(debounced.isPaused()).toBe(false);

    debounced.pause();
    expect(debounced.isPaused()).toBe(true);

    debounced.resume();
    expect(debounced.isPaused()).toBe(false);
  });

  it('should not double-execute if resumed after timer would have fired', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced.pause();
    vi.advanceTimersByTime(100); // Timer would have fired at 100ms
    debounced.resume();
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should cancel pending call even when paused', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.pause();
    debounced.cancel();
    debounced.resume();
    vi.advanceTimersByTime(200);

    expect(fn).not.toHaveBeenCalled();
  });

  it('should flush immediately even when paused', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.pause();
    debounced.flush();

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
