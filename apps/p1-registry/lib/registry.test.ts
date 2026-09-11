import { describe, it, expect } from 'vitest';
import { loadCatalog } from './registry';
import { registrationSnippet } from './registration-snippet';

describe('catalog data', () => {
  const catalog = loadCatalog();

  it('reads every item from the built index', () => {
    expect(catalog.items.length).toBeGreaterThan(30);
  });

  it('lists only installable items, not the base', () => {
    // The base is an install target, not a catalog card.
    expect(catalog.items.map((i) => i.name)).not.toContain('base');
  });

  it('gives every card an add command that matches its item name', () => {
    for (const item of catalog.items) {
      expect(item.addCommand).toBe(`pnpm dlx shadcn@latest add @p1/${item.name}`);
    }
  });

  it('groups items by category', () => {
    expect(Object.keys(catalog.byCategory).length).toBeGreaterThan(3);
    const flat = Object.values(catalog.byCategory).flat();
    expect(flat).toHaveLength(catalog.items.length);
  });

  it('fails loudly if the registry has not been built', () => {
    expect(() => loadCatalog('/nonexistent/r')).toThrow(/registry:build/);
  });
});

// The card's copy button pastes this straight into the barrel, and the text it
// parses is generated — so a change to the generator's wording would otherwise
// turn the button into a copy of nothing, with no test failing anywhere.
describe('registrationSnippet', () => {
  const catalog = loadCatalog();

  it('yields the registration lines for every item the registry serves', () => {
    expect(catalog.items.length).toBeGreaterThan(30);

    for (const item of catalog.items) {
      const snippet = registrationSnippet(item.docs);

      expect(snippet, item.name).toContain(`from "./${item.name}/`);
      expect(snippet, item.name).toContain('// in p1Blocks');
      expect(snippet, item.name).toContain('// in p1Categories');
    }
  });

  it('drops the header sentence and the trailing edit paragraph', () => {
    for (const item of catalog.items) {
      const snippet = registrationSnippet(item.docs);

      // Both are prose the dialog already says in its own label. The barrel
      // path only ever appears in that header, so its absence is the check
      // that the header is gone.
      expect(snippet, item.name).not.toContain('components/puck/blocks/index.ts');
      expect(snippet, item.name).not.toContain('Then edit');
    }
  });

  it('returns an empty string rather than throwing when docs are absent', () => {
    // The card renders the section only on a truthy snippet, so empty is what
    // hides it; undefined would have to be handled at every call site instead.
    expect(registrationSnippet(undefined)).toBe('');
    expect(registrationSnippet('')).toBe('');
    expect(registrationSnippet('One paragraph only, no code.')).toBe('');
  });
});
