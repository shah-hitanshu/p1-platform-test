/**
 * Puck's canvas leaves timers outstanding on unmount, and one that fires after
 * its file's jsdom window is gone throws inside react-dom, where no test is
 * left to catch it. Each test's timers are dropped when it ends.
 */
import { afterEach } from 'vitest';

const outstanding = new Set<ReturnType<typeof globalThis.setTimeout>>();
const schedule = globalThis.setTimeout;

globalThis.setTimeout = ((handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const id = schedule(
    (...called: unknown[]) => {
      outstanding.delete(id);
      handler(...called);
    },
    ms,
    ...args,
  );
  outstanding.add(id);
  return id;
}) as typeof globalThis.setTimeout;

afterEach(() => {
  for (const id of outstanding) clearTimeout(id);
  outstanding.clear();
});
