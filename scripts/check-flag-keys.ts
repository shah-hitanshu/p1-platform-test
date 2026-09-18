#!/usr/bin/env tsx
/**
 * Fails if a flag key gated in the browser is not in the platform's shared vocabulary.
 *
 * Flag keys have to be spelled the same everywhere, but the two catalogs cannot import each
 * other: `p1-feature-flags` is private and built on LaunchDarkly's Cloudflare SDK, while
 * `p1-next-sdk` is published and evaluates in the browser, so the key ends up written twice.
 * A misspelling matches nothing in LaunchDarkly and resolves to off, which looks exactly like
 * a feature that has not been rolled out yet — nothing fails, and the flag silently never
 * turns on.
 *
 * Deliberately one-directional. The vocabulary is wider than what the browser gates: a worker
 * flag has no business appearing in the browser catalog.
 */
import { P1_FLAG_KEYS } from '../packages/p1-feature-flags/src/p1-feature-flags.js';
import { P1_EXPERIMENTAL_FEATURE_FLAGS } from '../packages/p1-next-sdk/src/experimental-features/features.js';

const VOCABULARY = 'packages/p1-feature-flags/src/p1-feature-flags.ts';
const BROWSER_CATALOG = 'packages/p1-next-sdk/src/experimental-features/features.ts';

function main(): void {
  const vocabulary = new Set<string>(P1_FLAG_KEYS);
  const gated = Object.entries(P1_EXPERIMENTAL_FEATURE_FLAGS);

  const unknown = gated.filter(([, key]) => !vocabulary.has(key));
  const duplicated = gated.filter(
    ([feature, key]) => gated.some(([other, otherKey]) => other !== feature && otherKey === key),
  );

  for (const [feature, key] of unknown) {
    process.stderr.write(
      `${BROWSER_CATALOG}: "${feature}" gates "${key}", which is not in P1_FLAG_KEYS.\n` +
        `  Add it to ${VOCABULARY}, or fix the spelling to match the LaunchDarkly dashboard.\n`,
    );
  }

  for (const [feature, key] of duplicated) {
    process.stderr.write(`${BROWSER_CATALOG}: "${feature}" shares the key "${key}".\n`);
  }

  if (unknown.length > 0 || duplicated.length > 0) {
    process.exit(1);
  }

  process.stdout.write(
    `${gated.length} browser-gated flag key(s) are in the shared vocabulary of ${P1_FLAG_KEYS.length}.\n`,
  );
}

main();
