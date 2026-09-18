/**
 * The flag catalog.
 *
 * Resolution itself is covered in `flags.spec.ts`. What is worth pinning here is what the
 * machinery cannot know: the key that must match the LaunchDarkly dashboard, the fallback that
 * decides what an unanswered gate serves, and the context each flag ramps on.
 */

import { describe, expect, it } from 'vitest';

import { P1_FEATURE_FLAG_CONFIGURATIONS, P1_FLAG_KEYS } from '../src/p1-feature-flags.js';

const configurations = Object.values(P1_FEATURE_FLAG_CONFIGURATIONS);

describe('the catalog', () => {
  it('declares each key once, so two entries cannot disagree about one flag', () => {
    const keys = configurations.map((flag) => flag.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the shared vocabulary', () => {
  it('spells each key once, so two consumers cannot gate on different spellings', () => {
    expect(new Set(P1_FLAG_KEYS).size).toBe(P1_FLAG_KEYS.length);
  });

  it('carries every key this service resolves', () => {
    for (const flag of configurations) {
      expect(P1_FLAG_KEYS).toContain(flag.key);
    }
  });

  // Keys gated in the browser are checked against this list by `pnpm check:flag-keys`,
  // which is the only thing that can: that catalog ships in a published package and
  // cannot import this one.
  it('is wider than what this service resolves', () => {
    expect(P1_FLAG_KEYS.length).toBeGreaterThan(configurations.length);
  });
});

describe('mergeJobRunner', () => {
  const flag = P1_FEATURE_FLAG_CONFIGURATIONS.mergeJobRunner;

  it('is the key the LaunchDarkly dashboard carries', () => {
    expect(flag.key).toBe('p1-merge-job-runner');
  });

  it('falls back to off, so an unanswered gate serves the legacy inline path', () => {
    expect(flag.fallback).toBe(false);
  });

  it('ramps per site, which is what the gate has in hand', () => {
    expect(flag.contextKind).toBe('site');
  });
});
