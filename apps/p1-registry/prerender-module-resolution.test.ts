import { createRequire } from 'node:module';
import { readdirSync, realpathSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// next.config.ts builds into the repo root, so Next loads that output through the
// root's module resolution while the app loads its own. More than one copy of next
// means two AsyncLocalStorage instances, and prerendering then dies on the first
// page with "Expected workStore to be initialized".
const ASYNC_STORAGE = 'next/dist/server/app-render/work-async-storage.external.js';

const repoRoot = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const appDir = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const resolveFrom = (dir: string) => realpathSync(createRequire(`${dir}/x.js`).resolve(ASYNC_STORAGE));

describe('next resolves to a single copy across the distDir boundary', () => {
  it('the store holds exactly one instance of the app\'s next version', () => {
    const version = createRequire(`${appDir}/x.js`)('next/package.json').version as string;
    const instances = readdirSync(`${repoRoot}/node_modules/.pnpm`).filter((entry) =>
      entry.startsWith(`next@${version}_`),
    );
    expect(instances).toHaveLength(1);
  });

  it('the repo root and this app load the same async storage module', () => {
    expect(resolveFrom(appDir)).toBe(resolveFrom(repoRoot));
  });
});
