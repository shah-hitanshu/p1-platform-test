/**
 * Node-ESM loading compat for the tsx db: scripts [PCC-3652].
 *
 * The services module graph carries two imports plain Node cannot load, which
 * the Workers runtime and vitest each patch over in their own way:
 *
 * - cloudflare:workers (via cache/purge.ts) — a Workers builtin. Redirected to
 *   the stub vitest aliases; the scripts never publish, so the stubbed cache
 *   is loaded but never invoked.
 * - fast-json-patch — its CJS entry populates exports via Object.assign, which
 *   Node's ESM named-export lexer cannot see. Redirected to a shim that loads
 *   it through require() and re-exports the names.
 *
 * Import this module FIRST (its side effect registers the hooks), then load
 * the rest of the graph via dynamic import so nothing resolves before the
 * hooks exist.
 */

import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return nextResolve(
        new URL('../../tests/stubs/cloudflare-workers.ts', import.meta.url).href,
        context,
      );
    }
    // The shim itself requires the real package — don't redirect its own load.
    if (
      specifier === 'fast-json-patch'
      && !(context.parentURL ?? '').includes('fast-json-patch-esm')
    ) {
      return nextResolve(
        new URL('./fast-json-patch-esm.ts', import.meta.url).href,
        context,
      );
    }
    return nextResolve(specifier, context);
  },
});
