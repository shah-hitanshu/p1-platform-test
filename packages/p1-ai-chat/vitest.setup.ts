import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Testing Library only auto-registers cleanup when Vitest runs with `globals: true`.
// This suite runs with explicit imports, so without this every rendered tree stays in
// the document and queries start matching elements left behind by earlier tests.
afterEach(() => {
  cleanup();
});
