import { describe, it, expect } from 'vitest';
import { resolveTranslatable, resolveSlotAuthority } from '../src/index.js';
import type { Authority } from '../src/index.js';

// Per-prop translatable — resolved from the canonical page snapshot

function snapshotWithTranslatable(
  map: Record<string, Record<string, boolean>>,
): Record<string, unknown> {
  return {
    content: [],
    root: { props: { _localeTranslatable: map } },
    zones: {},
  };
}

describe('resolveTranslatable', () => {
  it('defaults to true for a prop with no stored entry', () => {
    const snapshot = snapshotWithTranslatable({ 'Hero-1': { sku: false } });
    expect(resolveTranslatable(snapshot, 'Hero-1', 'title')).toBe(true);
  });

  it('returns false only when the prop is explicitly stored as false', () => {
    const snapshot = snapshotWithTranslatable({ 'Hero-1': { publishedAt: false } });
    expect(resolveTranslatable(snapshot, 'Hero-1', 'publishedAt')).toBe(false);
  });

  it('treats an explicitly stored true the same as the default', () => {
    const snapshot = snapshotWithTranslatable({ 'Hero-1': { title: true } });
    expect(resolveTranslatable(snapshot, 'Hero-1', 'title')).toBe(true);
  });

  it('keeps translatable state independent per slot and per prop', () => {
    const snapshot = snapshotWithTranslatable({
      'Hero-1': { sku: false, title: true },
      'Card-1': { price: false },
    });
    expect(resolveTranslatable(snapshot, 'Hero-1', 'sku')).toBe(false);
    expect(resolveTranslatable(snapshot, 'Hero-1', 'title')).toBe(true);
    expect(resolveTranslatable(snapshot, 'Hero-1', 'price')).toBe(true);
    expect(resolveTranslatable(snapshot, 'Card-1', 'price')).toBe(false);
    expect(resolveTranslatable(snapshot, 'Card-1', 'sku')).toBe(true);
  });

  it('defaults to true when the snapshot declares no translatable map', () => {
    const snapshot = { content: [], root: { props: {} }, zones: {} };
    expect(resolveTranslatable(snapshot, 'Hero-1', 'title')).toBe(true);
  });

  it('defaults to true for malformed snapshots', () => {
    expect(resolveTranslatable(null, 'Hero-1', 'title')).toBe(true);
    expect(resolveTranslatable({}, 'Hero-1', 'title')).toBe(true);
    expect(resolveTranslatable({ root: null }, 'Hero-1', 'title')).toBe(true);
    expect(resolveTranslatable({ root: { props: null } }, 'Hero-1', 'title')).toBe(true);
    expect(
      resolveTranslatable({ root: { props: { _localeTranslatable: null } } }, 'Hero-1', 'title'),
    ).toBe(true);
  });

  it('defaults to true when a non-boolean value is stored for the prop', () => {
    const snapshot = snapshotWithTranslatable({
      'Hero-1': { title: 'no' as unknown as boolean },
    });
    expect(resolveTranslatable(snapshot, 'Hero-1', 'title')).toBe(true);
  });
});

// Per-slot authority default — resolved from the template snapshot

function templateWithAuthority(
  map: Record<string, Authority>,
): Record<string, unknown> {
  return {
    content: [],
    root: { props: { _pinMap: {}, _localeAuthority: map } },
    zones: {},
  };
}

describe('resolveSlotAuthority', () => {
  it('returns the per-slot default declared on the template', () => {
    const template = templateWithAuthority({
      'Hero-1': 'locale',
      'Image-1': 'canonical',
    });
    expect(resolveSlotAuthority(template, 'Hero-1')).toBe('locale');
    expect(resolveSlotAuthority(template, 'Image-1')).toBe('canonical');
  });

  it('defaults to canonical for a slot with no declared authority', () => {
    const template = templateWithAuthority({ 'Hero-1': 'locale' });
    expect(resolveSlotAuthority(template, 'Missing-1')).toBe('canonical');
  });

  it('defaults to canonical when the template declares no authority map', () => {
    const template = { content: [], root: { props: { _pinMap: {} } }, zones: {} };
    expect(resolveSlotAuthority(template, 'Hero-1')).toBe('canonical');
  });

  it('defaults to canonical for malformed template snapshots', () => {
    expect(resolveSlotAuthority(null, 'Hero-1')).toBe('canonical');
    expect(resolveSlotAuthority({}, 'Hero-1')).toBe('canonical');
    expect(resolveSlotAuthority({ root: null }, 'Hero-1')).toBe('canonical');
    expect(resolveSlotAuthority({ root: { props: null } }, 'Hero-1')).toBe('canonical');
  });

  it('defaults to canonical when a slot stores an unrecognized authority value', () => {
    const template = templateWithAuthority({
      'Hero-1': 'garbage' as Authority,
    });
    expect(resolveSlotAuthority(template, 'Hero-1')).toBe('canonical');
  });
});
