// Test setup

// Polyfill ResizeObserver for jsdom (required by @dnd-kit used in Puck)
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof globalThis.ResizeObserver;
