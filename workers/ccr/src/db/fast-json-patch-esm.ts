/**
 * ESM shim for fast-json-patch — see node-esm-compat.ts. Loads the CJS entry
 * through require(), where its Object.assign-populated exports work, and
 * re-exports the names the services graph imports.
 */

import { createRequire } from 'node:module';

const fjp = createRequire(import.meta.url)(
  'fast-json-patch',
) as typeof import('fast-json-patch');

export const compare = fjp.compare;
export const applyPatch = fjp.applyPatch;
export default fjp;
