import { describe, it, expect } from 'vitest';
import { resolveSlotAuthorityMap, validateTranslationAuthority } from '../src/index.js';
import type { Authority, EditOperation } from '../src/index.js';

/**
 * Per-slot authority defaults, read from a template and consumed without it.
 *
 * `resolveSlotAuthorityMap` reads a template's whole `_localeAuthority` map, so a
 * caller can serve the defaults to a client that never sees the template.
 * `validateTranslationAuthority` accepts that map as `slotAuthority`. Effective
 * authority for a prop is the per-prop override, then the slot default from
 * `slotAuthority`, then the template snapshot, then `canonical`.
 */

function template(map: unknown): Record<string, unknown> {
  return { content: [], root: { props: { _pinMap: {}, _localeAuthority: map } }, zones: {} };
}

describe('resolveSlotAuthorityMap', () => {
  it('returns every slot the template declares', () => {
    const map = resolveSlotAuthorityMap(
      template({ 'Hero-1': 'locale', 'Image-1': 'canonical' }),
    );
    expect(map).toEqual({ 'Hero-1': 'locale', 'Image-1': 'canonical' });
  });

  it('drops a slot whose stored authority is unrecognized', () => {
    const map = resolveSlotAuthorityMap(
      template({ 'Hero-1': 'locale', 'Image-1': 'sideways', 'Cta-1': 42 }),
    );
    expect(map).toEqual({ 'Hero-1': 'locale' });
  });

  it('returns an empty map when the template declares no authority map', () => {
    expect(resolveSlotAuthorityMap({ content: [], root: { props: {} }, zones: {} })).toEqual({});
  });

  it('returns an empty map for a malformed template snapshot', () => {
    expect(resolveSlotAuthorityMap(null)).toEqual({});
    expect(resolveSlotAuthorityMap(undefined)).toEqual({});
    expect(resolveSlotAuthorityMap({})).toEqual({});
    expect(resolveSlotAuthorityMap({ root: null })).toEqual({});
    expect(resolveSlotAuthorityMap({ root: { props: null } })).toEqual({});
    expect(resolveSlotAuthorityMap(template([]))).toEqual({});
    expect(resolveSlotAuthorityMap(template('locale'))).toEqual({});
  });

  it('keeps a slot id that collides with an Object.prototype member', () => {
    const map = resolveSlotAuthorityMap(template({ constructor: 'locale' }));
    expect(Object.keys(map)).toEqual(['constructor']);
    expect(map.constructor).toBe('locale');
  });

  it('reports no slots for a template that declares an empty map', () => {
    expect(Object.keys(resolveSlotAuthorityMap(template({})))).toEqual([]);
  });
});

function op(type: EditOperation['type'], path: string, content?: unknown): EditOperation {
  return { type, path, content };
}

const snapshot: Record<string, unknown> = {
  content: [
    { type: 'Hero', props: { id: 'Hero-1', title: 'Hello', level: 'h1' } },
    { type: 'Image', props: { id: 'Image-1', src: '/a.jpg', alt: 'A' } },
  ],
  root: { props: {} },
  zones: {},
};

describe('validateTranslationAuthority with slotAuthority', () => {
  it('reads a slot default from slotAuthority when no template is supplied', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: undefined,
      slotAuthority: { 'Hero-1': 'locale' },
    });

    expect(diagnostics).toEqual([]);
  });

  it('flags a write to a slot slotAuthority declares canonical', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: undefined,
      slotAuthority: { 'Hero-1': 'canonical' },
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].slotId).toBe('Hero-1');
    expect(diagnostics[0].propName).toBe('title');
  });

  it('falls back to the template snapshot for a slot slotAuthority does not name', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [
        op('replace', 'content.0.props.title', 'Bonjour'),
        op('replace', 'content.1.props.alt', 'Une image'),
      ],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Image-1': 'locale' }),
      slotAuthority: { 'Hero-1': 'canonical' },
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].slotId).toBe('Hero-1');
  });

  it('lets a per-prop override beat the slotAuthority default', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: undefined,
      slotAuthority: { 'Hero-1': 'canonical' },
      authorityOverrides: { 'Hero-1': { title: 'locale' } },
    });

    expect(diagnostics).toEqual([]);
  });

  it('treats an unrecognized slotAuthority value as canonical', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: undefined,
      slotAuthority: { 'Hero-1': 'sideways' as Authority },
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].authority).toBe('canonical');
  });

  it('defaults a slot named like an Object.prototype member to canonical', () => {
    const prototypeNamed: Record<string, unknown> = {
      content: [{ type: 'Hero', props: { id: 'constructor', title: 'Hello' } }],
      root: { props: {} },
      zones: {},
    };

    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: prototypeNamed,
      templateSnapshot: undefined,
      slotAuthority: {},
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].slotId).toBe('constructor');
  });
});
