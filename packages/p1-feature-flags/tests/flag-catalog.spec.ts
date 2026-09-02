/**
 * The flag catalog.
 *
 * Resolution itself is covered in `flags.spec.ts`. What is worth pinning here is what the
 * machinery cannot know: the key that must match the LaunchDarkly dashboard, the fallback that
 * decides what an unanswered gate serves, and the context each flag ramps on.
 */

import { describe, expect, it } from 'vitest';

import { P1_FEATURE_FLAG_CONFIGURATIONS } from '../src/p1-feature-flags.js';

const configurations = Object.values(P1_FEATURE_FLAG_CONFIGURATIONS);

describe('the catalog', () => {
  it('declares each key once, so two entries cannot disagree about one flag', () => {
    const keys = configurations.map((flag) => flag.key);
    expect(new Set(keys).size).toBe(keys.length);
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
