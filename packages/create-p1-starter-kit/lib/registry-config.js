import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Written by scripts/build-template.js from the registry's own registry.json.
 * It lives in lib/ rather than template/ on purpose: copyTemplate() copies
 * everything under template/ into the user's project with no exclusion list, so
 * a manifest there would leak and need deleting afterwards.
 */
export const REGISTRY_MANIFEST_PATH = path.join(__dirname, 'generated-registry.json');

export function readRegistryConfig(manifestPath = REGISTRY_MANIFEST_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch {
    throw new Error(
      `Registry manifest not found at ${manifestPath}. It is generated — run \`pnpm build\` in packages/create-p1-starter-kit first.`,
    );
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Registry manifest at ${manifestPath} is not valid JSON: ${error.message}`);
  }

  if (!config.url || !config.url.includes('{name}')) {
    throw new Error(
      `Registry url must be a template containing {name}, got: ${config.url}. Without it the shadcn CLI cannot resolve ${config.namespace ?? '@p1'}/<block>.`,
    );
  }
  if (!config.url.startsWith('https://')) {
    throw new Error(`Registry url must be https, got: ${config.url}`);
  }
  return config;
}

/**
 * The namespace, for the closing message that names the registry the project
 * was wired to. Returns undefined rather than throwing: a broken manifest is
 * already warned about where components.json is written, and a scaffold that
 * finished must not die on its last line.
 */
export function readNamespaceForDisplay(manifestPath = REGISTRY_MANIFEST_PATH) {
  try {
    return readRegistryConfig(manifestPath).namespace;
  } catch {
    return undefined;
  }
}

/**
 * The components.json written into a generated project. It is written on BOTH
 * prompt paths: a user who declines today can still run
 * `shadcn add @p1/<block>` tomorrow without looking up a URL.
 */
export function buildComponentsJson({ namespace, url }) {
  return {
    $schema: 'https://ui.shadcn.com/schema.json',
    style: 'p1',
    rsc: true,
    tsx: true,
    tailwind: {
      config: '',
      // @p1/tokens injects `@import "./p1-tokens.css"` into this file.
      css: 'app/styles.css',
      baseColor: 'neutral',
      cssVariables: true,
    },
    aliases: {
      components: '@/components',
      ui: '@/components/ui',
      lib: '@/lib',
      hooks: '@/hooks',
      utils: '@/lib/utils',
    },
    registries: { [namespace]: url },
  };
}
