/**
 * Shared vitest setup for every test project in this package (unit,
 * tests-puck, spike). All polyfills are additive — they only fill in what
 * jsdom lacks — so the union is safe to load everywhere.
 *
 * The jest-dom import below also carries the matcher *types*
 * (`toBeInTheDocument`, …) for the whole editor program: its module
 * augmentation applies as long as this file is in tsconfig.json's include.
 * Don't move it into `compilerOptions.types` — `types` replaces default
 * @types resolution instead of adding to it, which strips @types/react from
 * transitively-imported sources and invents ~90 errors in src/.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Polyfill ResizeObserver for jsdom (required by @dnd-kit used in Puck)
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof globalThis.ResizeObserver;

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof globalThis.matchMedia;

// @dnd-kit reads transforms off computed styles when a component is selected.
globalThis.DOMMatrixReadOnly ??= class DOMMatrixReadOnly {
  m41 = 0;
  m42 = 0;
} as unknown as typeof globalThis.DOMMatrixReadOnly;

if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
    configurable: true,
  });
}

// `typeof` guard: a few tests opt into `@vitest-environment node`, where
// Element (and window below) don't exist.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom defaults to 1024px, which is below the editor's all-open panel budget
// (see src/editor/useResponsivePanels.ts), so every test would otherwise start by
// auto-closing the left panel. Pin a desktop width; a test that cares sets
// innerWidth itself.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'innerWidth', {
    value: 1600,
    configurable: true,
    writable: true,
  });
}
