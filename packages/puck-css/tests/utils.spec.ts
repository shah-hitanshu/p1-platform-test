/**
 * Utils Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../src/utils/debounce.js';
import { withRetry } from '../src/utils/retry.js';
import { diffPuckData, getChangedComponents, countChanges } from '../src/utils/diff.js';
import type { PuckData } from '@pantheon/css-client';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delay function execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should reset timer on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should cancel pending execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced.cancel();
    vi.advanceTimersByTime(100);

    expect(fn).not.toHaveBeenCalled();
  });

  it('should flush pending execution immediately', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.flush();

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withRetry', () => {
  it('should return result on success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, { maxAttempts: 3 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10, // Use small delays for faster tests
      maxDelayMs: 50,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after max attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 10,
      })
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should respect shouldRetry predicate', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('validation error'));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 10,
        shouldRetry: (error) => !error.message.includes('validation'),
      })
    ).rejects.toThrow('validation error');

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('diffPuckData', () => {
  const createPuckData = (content: Array<{ type: string; id: string }>): PuckData => ({
    content: content.map((c) => ({
      type: c.type,
      props: { id: c.id },
    })),
    root: { props: {} },
  });

  it('should detect added components', () => {
    const before = createPuckData([{ type: 'Text', id: 't1' }]);
    const after = createPuckData([
      { type: 'Text', id: 't1' },
      { type: 'Image', id: 'i1' },
    ]);

    const diffs = diffPuckData(before, after);
    const added = diffs.filter((d) => d.type === 'added');

    expect(added).toHaveLength(1);
    expect(added[0].componentId).toBe('i1');
    expect(added[0].componentType).toBe('Image');
  });

  it('should detect removed components', () => {
    const before = createPuckData([
      { type: 'Text', id: 't1' },
      { type: 'Image', id: 'i1' },
    ]);
    const after = createPuckData([{ type: 'Text', id: 't1' }]);

    const diffs = diffPuckData(before, after);
    const removed = diffs.filter((d) => d.type === 'removed');

    expect(removed).toHaveLength(1);
    expect(removed[0].componentId).toBe('i1');
  });

  it('should detect modified components', () => {
    const before: PuckData = {
      content: [{ type: 'Text', props: { id: 't1', text: 'Hello' } }],
      root: { props: {} },
    };
    const after: PuckData = {
      content: [{ type: 'Text', props: { id: 't1', text: 'World' } }],
      root: { props: {} },
    };

    const diffs = diffPuckData(before, after);
    const modified = diffs.filter((d) => d.type === 'modified');

    expect(modified).toHaveLength(1);
    expect(modified[0].componentId).toBe('t1');
  });

  it('should detect unchanged components', () => {
    const data = createPuckData([{ type: 'Text', id: 't1' }]);

    const diffs = diffPuckData(data, data);
    const unchanged = diffs.filter((d) => d.type === 'unchanged');

    expect(unchanged).toHaveLength(1);
  });
});

describe('getChangedComponents', () => {
  it('should filter out unchanged components', () => {
    const before: PuckData = {
      content: [
        { type: 'Text', props: { id: 't1', text: 'Same' } },
        { type: 'Text', props: { id: 't2', text: 'Changed' } },
      ],
      root: { props: {} },
    };
    const after: PuckData = {
      content: [
        { type: 'Text', props: { id: 't1', text: 'Same' } },
        { type: 'Text', props: { id: 't2', text: 'Modified' } },
      ],
      root: { props: {} },
    };

    const diffs = diffPuckData(before, after);
    const changed = getChangedComponents(diffs);

    expect(changed).toHaveLength(1);
    expect(changed[0].componentId).toBe('t2');
  });
});

describe('countChanges', () => {
  it('should count changes by type', () => {
    const before: PuckData = {
      content: [
        { type: 'Text', props: { id: 't1' } },
        { type: 'Text', props: { id: 't2', text: 'old' } },
      ],
      root: { props: {} },
    };
    const after: PuckData = {
      content: [
        { type: 'Text', props: { id: 't2', text: 'new' } },
        { type: 'Image', props: { id: 'i1' } },
      ],
      root: { props: {} },
    };

    const diffs = diffPuckData(before, after);
    const counts = countChanges(diffs);

    expect(counts.added).toBe(1);
    expect(counts.removed).toBe(1);
    expect(counts.modified).toBe(1);
    expect(counts.unchanged).toBe(0);
  });
});
