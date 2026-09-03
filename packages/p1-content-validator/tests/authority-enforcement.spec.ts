import { describe, it, expect } from 'vitest';
import { validateTranslationAuthority } from '../src/index.js';
import type {
  Authority,
  AuthorityOverrideMap,
  EditOperation,
} from '../src/index.js';

/**
 * Authority enforcement on a translation write.
 *
 * A write to a prop whose effective authority is `canonical` (owned by the
 * canonical, not the translation) is flagged. Effective authority for a
 * (slotId, propName) is the per-prop override on the localization edge when
 * present, else the slot's template default from `_localeAuthority`, else
 * `canonical`. Diagnostics carry the caller's severity, defaulting to `warning`,
 * and the code `canonical_authority_write`.
 */

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

function template(map: Record<string, Authority>): Record<string, unknown> {
  return { content: [], root: { props: { _pinMap: {}, _localeAuthority: map } }, zones: {} };
}

describe('validateTranslationAuthority', () => {
  it('flags a canonical-authority prop write as a soft warning by default', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'canonical' }),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      opIndex: 0,
      path: 'content.0.props.title',
      code: 'canonical_authority_write',
      severity: 'warning',
      slotId: 'Hero-1',
      propName: 'title',
      authority: 'canonical',
      message: expect.stringContaining('Hero-1'),
    });
  });

  it('does not flag a locale-authority prop write', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'locale' }),
    });

    expect(diagnostics).toEqual([]);
  });

  it('treats a slot with no declared authority as canonical and flags the write', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: template({}),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('canonical_authority_write');
    expect(diagnostics[0].authority).toBe('canonical');
  });

  it('defaults the whole document to canonical when no template is supplied', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: undefined,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].slotId).toBe('Hero-1');
  });

  it('lets a per-prop locale override clear a canonical template default', () => {
    const overrides: AuthorityOverrideMap = { 'Hero-1': { title: 'locale' } };
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'canonical' }),
      authorityOverrides: overrides,
    });

    expect(diagnostics).toEqual([]);
  });

  it('lets a per-prop canonical override reinstate a flag over a locale default', () => {
    const overrides: AuthorityOverrideMap = { 'Hero-1': { title: 'canonical' } };
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'locale' }),
      authorityOverrides: overrides,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].propName).toBe('title');
  });

  it('applies an override only to the prop it names, not its siblings', () => {
    const overrides: AuthorityOverrideMap = { 'Hero-1': { title: 'locale' } };
    const { diagnostics } = validateTranslationAuthority({
      operations: [
        op('replace', 'content.0.props.title', 'Bonjour'),
        op('replace', 'content.0.props.level', 'h2'),
      ],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'canonical' }),
      authorityOverrides: overrides,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].opIndex).toBe(1);
    expect(diagnostics[0].propName).toBe('level');
  });

  it('raises severity to error when the caller tightens the policy', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'canonical' }),
      severity: 'error',
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
  });

  it('resolves authority per slot across a batch of writes', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [
        op('replace', 'content.0.props.title', 'Bonjour'),
        op('replace', 'content.1.props.alt', 'Une image'),
      ],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'locale', 'Image-1': 'canonical' }),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].slotId).toBe('Image-1');
    expect(diagnostics[0].propName).toBe('alt');
  });

  it('ignores structural ops that do not target a prop', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [
        op('add', 'content.2', { type: 'Hero', props: { id: 'Hero-9', title: 'x' } }),
        op('remove', 'content.0'),
        op('reorder', 'content'),
      ],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'canonical' }),
    });

    expect(diagnostics).toEqual([]);
  });

  it('never flags a write to the structural id prop', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.0.props.id', 'Hero-2')],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'canonical' }),
    });

    expect(diagnostics).toEqual([]);
  });

  it('flags each canonical-authority prop in a whole-props replace', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [
        op('replace', 'content.0.props', { id: 'Hero-1', title: 'Bonjour', level: 'h2' }),
      ],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'canonical' }),
    });

    expect(diagnostics.map((d) => d.propName).sort()).toEqual(['level', 'title']);
    expect(diagnostics.every((d) => d.code === 'canonical_authority_write')).toBe(true);
  });

  it('skips a prop write against a component absent from the snapshot', () => {
    const { diagnostics } = validateTranslationAuthority({
      operations: [op('replace', 'content.5.props.title', 'Bonjour')],
      currentSnapshot: snapshot,
      templateSnapshot: template({ 'Hero-1': 'canonical' }),
    });

    expect(diagnostics).toEqual([]);
  });

  describe('a component nested in a slot prop', () => {
    const nested: Record<string, unknown> = {
      content: [
        {
          type: 'Columns',
          props: {
            id: 'Columns-1',
            items: [{ type: 'Hero', props: { id: 'Hero-2', title: 'Inner', level: 'h2' } }],
          },
        },
      ],
      root: { props: {} },
      zones: {},
    };

    it('judges the write against the component holding the prop, not its container', () => {
      const { diagnostics } = validateTranslationAuthority({
        operations: [op('replace', 'content.0.props.items.0.props.title', 'Bonjour')],
        currentSnapshot: nested,
        templateSnapshot: template({ 'Columns-1': 'locale', 'Hero-2': 'canonical' }),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].slotId).toBe('Hero-2');
      expect(diagnostics[0].propName).toBe('title');
    });

    it('leaves a locale-authority prop alone when its container is canonical', () => {
      const { diagnostics } = validateTranslationAuthority({
        operations: [op('replace', 'content.0.props.items.0.props.title', 'Bonjour')],
        currentSnapshot: nested,
        templateSnapshot: template({ 'Columns-1': 'canonical', 'Hero-2': 'locale' }),
      });

      expect(diagnostics).toEqual([]);
    });

    it('flags each canonical-authority prop in a whole-props replace', () => {
      const { diagnostics } = validateTranslationAuthority({
        operations: [
          op('replace', 'content.0.props.items.0.props', {
            id: 'Hero-2',
            title: 'Bonjour',
            level: 'h3',
          }),
        ],
        currentSnapshot: nested,
        templateSnapshot: template({ 'Columns-1': 'locale', 'Hero-2': 'canonical' }),
      });

      expect(diagnostics.map((d) => d.propName).sort()).toEqual(['level', 'title']);
      expect(diagnostics.every((d) => d.slotId === 'Hero-2')).toBe(true);
    });
  });

  describe('a root prop', () => {
    const withRoot: Record<string, unknown> = {
      content: [],
      root: { props: { title: 'Home', description: 'Welcome' } },
      zones: {},
    };

    it('judges the write under the root slot id', () => {
      const { diagnostics } = validateTranslationAuthority({
        operations: [op('replace', 'root.props.title', 'Accueil')],
        currentSnapshot: withRoot,
        templateSnapshot: template({ __root__: 'canonical' }),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].slotId).toBe('__root__');
      expect(diagnostics[0].propName).toBe('title');
      expect(diagnostics[0].path).toBe('root.props.title');
    });

    it('leaves editor bookkeeping on root props unjudged', () => {
      const { diagnostics } = validateTranslationAuthority({
        operations: [
          op('replace', 'root.props._localeTranslatable', { 'Hero-1': { title: false } }),
          op('replace', 'root.props._pinMap', { 'Hero-1': true }),
          op('replace', 'root.props._template', { id: 'tpl-1' }),
        ],
        currentSnapshot: withRoot,
        templateSnapshot: template({ __root__: 'canonical' }),
      });

      expect(diagnostics).toEqual([]);
    });

    it('leaves bookkeeping unjudged when the whole props object is replaced', () => {
      const { diagnostics } = validateTranslationAuthority({
        operations: [
          op('replace', 'root.props', {
            id: 'root',
            title: 'Accueil',
            _localeTranslatable: { 'Hero-1': { title: false } },
            _pinMap: { 'Hero-1': true },
          }),
        ],
        currentSnapshot: withRoot,
        templateSnapshot: template({ __root__: 'canonical' }),
      });

      // Puck replaces the whole object on any root field edit, so only the
      // content prop the author actually changed is reported.
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].propName).toBe('title');
    });

    it('leaves a root prop the template hands to the locale alone', () => {
      const { diagnostics } = validateTranslationAuthority({
        operations: [op('replace', 'root.props.title', 'Accueil')],
        currentSnapshot: withRoot,
        templateSnapshot: template({ __root__: 'locale' }),
      });

      expect(diagnostics).toEqual([]);
    });

    it('lets a per-prop override beat the root slot default', () => {
      const overrides: AuthorityOverrideMap = { __root__: { title: 'locale' } };
      const { diagnostics } = validateTranslationAuthority({
        operations: [
          op('replace', 'root.props.title', 'Accueil'),
          op('replace', 'root.props.description', 'Bienvenue'),
        ],
        currentSnapshot: withRoot,
        templateSnapshot: template({ __root__: 'canonical' }),
        authorityOverrides: overrides,
      });

      expect(diagnostics.map((d) => d.propName)).toEqual(['description']);
    });

    it('flags each canonical-authority prop in a whole-root-props replace', () => {
      const { diagnostics } = validateTranslationAuthority({
        operations: [
          op('replace', 'root.props', { title: 'Accueil', description: 'Bienvenue' }),
        ],
        currentSnapshot: withRoot,
        templateSnapshot: template({ __root__: 'canonical' }),
      });

      expect(diagnostics.map((d) => d.propName).sort()).toEqual(['description', 'title']);
      expect(diagnostics.every((d) => d.slotId === '__root__')).toBe(true);
      expect(diagnostics.map((d) => d.path).sort()).toEqual([
        'root.props.description',
        'root.props.title',
      ]);
    });

    it('judges a component held in a root prop against that component', () => {
      const nestedInRoot: Record<string, unknown> = {
        content: [],
        root: {
          props: {
            items: [{ type: 'Hero', props: { id: 'Hero-3', title: 'Inner' } }],
          },
        },
        zones: {},
      };
      const { diagnostics } = validateTranslationAuthority({
        operations: [op('replace', 'root.props.items.0.props.title', 'Bonjour')],
        currentSnapshot: nestedInRoot,
        templateSnapshot: template({ __root__: 'locale', 'Hero-3': 'canonical' }),
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].slotId).toBe('Hero-3');
    });
  });
});
