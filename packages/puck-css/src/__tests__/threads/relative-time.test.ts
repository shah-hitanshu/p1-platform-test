import { describe, it, expect } from 'vitest';
import { relativeTime } from '../../features/threads/relative-time.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('relativeTime', () => {
  it('calls anything under a minute old "Just now"', () => {
    expect(relativeTime(ago(0), NOW)).toBe('Just now');
    expect(relativeTime(ago(59_000), NOW)).toBe('Just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(relativeTime(ago(60_000), NOW)).toBe('1m');
    expect(relativeTime(ago(52 * 60_000), NOW)).toBe('52m');
    expect(relativeTime(ago(2 * 3_600_000), NOW)).toBe('2h');
    expect(relativeTime(ago(23 * 3_600_000), NOW)).toBe('23h');
    expect(relativeTime(ago(3 * 86_400_000), NOW)).toBe('3d');
  });

  it('falls back to a date once a week has passed', () => {
    expect(relativeTime(ago(8 * 86_400_000), NOW)).toMatch(/Sep 5/);
    expect(relativeTime('2025-03-02T12:00:00Z', NOW)).toMatch(/2025/);
  });
});
