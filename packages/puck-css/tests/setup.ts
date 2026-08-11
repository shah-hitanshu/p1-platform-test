// Test setup
import '@testing-library/jest-dom/vitest';

// Polyfill ResizeObserver for jsdom (required by @dnd-kit used in Puck)
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof globalThis.ResizeObserver;

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
