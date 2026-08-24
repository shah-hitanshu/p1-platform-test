import { describe, it, expect } from 'vitest';
import { loadCatalog } from './registry';

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
