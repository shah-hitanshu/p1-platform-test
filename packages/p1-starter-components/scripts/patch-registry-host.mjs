/**
 * Substitutes REGISTRY_HOST into the built registry JSON after `shadcn build`.
 * Run as part of registry:build. Defaults to localhost:3005 for local dev.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'p1-registry', 'public', 'r');
// REGISTRY_HOST includes the protocol, e.g. http://localhost:3005 or https://your.domain.com
const host = process.env.REGISTRY_HOST ?? 'http://localhost:3005';

let patched = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const path = join(dir, file);
  const before = readFileSync(path, 'utf8');
  // Source files use https://P1_REGISTRY_HOST_TBD — replace the full origin.
  const after = before.replaceAll('https://P1_REGISTRY_HOST_TBD', host);
  if (before !== after) {
    writeFileSync(path, after);
    patched++;
  }
}

console.log(`patch-registry-host: ${host} → ${patched} file(s) updated`);
