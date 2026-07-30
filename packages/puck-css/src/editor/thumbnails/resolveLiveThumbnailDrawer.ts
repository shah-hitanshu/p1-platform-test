/**
 * resolveLiveThumbnailDrawer
 *
 * Decides whether useP1Editor should apply the live thumbnail component drawer,
 * turning the `liveThumbnailDrawer` option into a Puck override layer (or null).
 *
 * The drawer is ON by default — passing `undefined` or `true` builds it, an
 * options object builds it with those settings, and `false` opts out (Puck's
 * default drawer is kept). Kept as a pure function so the default-on / opt-out
 * policy is unit-testable independently of the drawer's rendering internals.
 */

import type { PuckOverrides } from '../plugin/index.js';
import { buildLiveThumbnailDrawer, type LiveThumbnailDrawerOptions } from './buildLiveThumbnailDrawer.js';

export function resolveLiveThumbnailDrawer(
  config: unknown,
  option: boolean | LiveThumbnailDrawerOptions | undefined,
): Partial<PuckOverrides> | null {
  if (option === false) return null;
  const options = typeof option === 'object' ? option : undefined;
  return buildLiveThumbnailDrawer(config, options);
}
