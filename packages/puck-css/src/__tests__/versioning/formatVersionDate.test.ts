import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatVersionDate, dayLabel } from '../../versioning/utils/formatVersionDate.js';

describe('formatVersionDate', () => {
  it('formats a valid ISO date string', () => {
    const result = formatVersionDate('2024-06-15T14:30:00Z');
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/:/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty string for an invalid date string', () => {
    expect(formatVersionDate('not-a-date')).toBe('');
  });

  it('returns empty string for an empty string', () => {
    expect(formatVersionDate('')).toBe('');
  });

  it('returns empty string for a malformed ISO string', () => {
    expect(formatVersionDate('2024-99-99T99:99:99Z')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// dayLabel
// ---------------------------------------------------------------------------

describe('dayLabel — Today', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-07-15T12:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('returns "Today" when date is the same calendar day as now', () => {
    expect(dayLabel('2024-07-15T08:30:00')).toBe('Today');
  });

  it('returns "Today" for midnight of the same day', () => {
    vi.setSystemTime(new Date('2024-07-15T23:59:59'));
    expect(dayLabel('2024-07-15T00:00:00')).toBe('Today');
  });

  it('returns "Today" for the last moment of the day', () => {
    vi.setSystemTime(new Date('2024-07-15T08:00:00'));
    expect(dayLabel('2024-07-15T23:59:59')).toBe('Today');
  });
});

describe('dayLabel — Yesterday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-07-15T10:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('returns "Yesterday" for one calendar day before now', () => {
    expect(dayLabel('2024-07-14T18:00:00')).toBe('Yesterday');
  });

  it('returns "Yesterday" across a month boundary', () => {
    vi.setSystemTime(new Date('2024-08-01T09:00:00'));
    expect(dayLabel('2024-07-31T22:00:00')).toBe('Yesterday');
  });

  it('returns "Yesterday" across a year boundary', () => {
    vi.setSystemTime(new Date('2025-01-01T09:00:00'));
    expect(dayLabel('2024-12-31T20:00:00')).toBe('Yesterday');
  });
});

describe('dayLabel — older dates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-07-15T10:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('returns a short date string for dates older than yesterday', () => {
    const result = dayLabel('2024-07-13T10:00:00');
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/13/);
  });
});

describe('dayLabel — invalid input', () => {
  it('returns empty string for an invalid ISO string', () => {
    expect(dayLabel('not-a-date')).toBe('');
  });

  it('returns empty string for an empty string', () => {
    expect(dayLabel('')).toBe('');
  });
});
