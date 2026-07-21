// Test setup
import '@testing-library/jest-dom/vitest';

// Polyfill ResizeObserver for jsdom (required by @dnd-kit used in Puck)
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof globalThis.ResizeObserver;
