import { defineConfig } from 'vitest/config';

const isCI = Boolean(process.env.CI);

/**
 * Two projects, because they need different module resolution: the unit project
 * aliases `@puckeditor/core` to a stub, while `tests-puck` needs the real thing.
 * Running them as projects rather than chained commands means one `vitest run`
 * reports both, and a failure in either is a failure.
 */
export default defineConfig({
  test: {
    projects: ['vitest.config.unit.ts', 'tests-puck/vitest.config.ts'],
    /**
     * Vitest sizes its pool at `cores - 1`, assuming it owns the machine. In CI
     * turbo runs four packages at once on a 4-vCPU runner, so four such pools
     * oversubscribe it badly and every worker slows down. Capping trades local
     * speed away only under CI, where the cores are not there to use.
     */
    maxWorkers: isCI ? 2 : undefined,
  },
});
