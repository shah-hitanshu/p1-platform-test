import fs from 'fs';
import path from 'path';

/**
 * Directory name and package name diverge — packages/p1-media-r2 publishes
 * @pantheon-systems/p1-media — so the lookup must read each manifest rather than
 * derive a path from the dependency name.
 */
export function indexWorkspacePackages(packagesDir) {
  const index = new Map();

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(packagesDir, entry.name, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!manifest.name) continue;

    index.set(manifest.name, manifest);
  }

  return index;
}

const WORKSPACE_PROTOCOL = 'workspace:';

/**
 * `workspace:*` becomes a caret range rather than the exact version pnpm publishes:
 * a scaffold should pick up patches within the minor it was generated against.
 */
function toPublishedRange(specifier, version) {
  const suffix = specifier.slice(WORKSPACE_PROTOCOL.length);

  if (suffix === '*' || suffix === '^' || suffix === '') return `^${version}`;
  if (suffix === '~') return `~${version}`;
  return suffix;
}

/**
 * Rewrites in place. A scaffolded project is not a workspace, so a single specifier
 * left behind fails `pnpm install` outright.
 */
export function resolveWorkspaceDeps(pkg, packageIndex, log = () => {}) {
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, specifier] of Object.entries(pkg[field] ?? {})) {
      if (typeof specifier !== 'string' || !specifier.startsWith(WORKSPACE_PROTOCOL)) continue;

      const manifest = packageIndex.get(name);
      if (!manifest) {
        throw new Error(
          `${name} is a workspace: dependency of the template but no package under packages/ publishes that name`
        );
      }
      if (manifest.private) {
        throw new Error(
          `${name} is private and cannot be a dependency of the scaffolded template`
        );
      }

      const range = toPublishedRange(specifier, manifest.version);
      pkg[field][name] = range;
      log(`  ${name}: ${specifier} → ${range}`);
    }
  }

  return pkg;
}
