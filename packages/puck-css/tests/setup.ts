/**
 * Vitest Setup File
 *
 * Configures testing environment with jest-dom matchers.
 */

import '@testing-library/jest-dom/vitest';

// Polyfill ResizeObserver for JSDOM environment
// Required by @puckeditor/core and @dnd-kit
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock;
