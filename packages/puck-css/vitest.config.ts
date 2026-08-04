import { defineConfig } from 'vitest/config';

/**
 * Two projects, because they need different module resolution: the unit project
 * aliases `@puckeditor/core` to a stub, while `tests-puck` needs the real thing.
 * Running them as projects rather than chained commands means one `vitest run`
 * reports both, and a failure in either is a failure.
 */
export default defineConfig({
  test: {
    projects: ['vitest.config.unit.ts', 'tests-puck/vitest.config.ts'],
  },
});
