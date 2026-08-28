/**
 * Catalog generator — scans registry/p1/blocks/ and writes five derived artifacts:
 *
 *   registry/p1/blocks/registry.json            (shadcn registry manifest)
 *   registry/p1/blocks/index.ts                 (barrel: imports, allBlocks, sourceCategories)
 *   apps/p1-registry/lib/preview-map.ts         (previewNames array)
 *   apps/p1-registry/_components/PreviewRenderer.tsx
 *   stories/<name>.stories.tsx                  (scaffolded if missing — never overwritten)
 *
 * Source of truth: each block's <name>.block.tsx must export `meta` containing
 * title, description, categories, dependencies, and registryDependencies.
 *
 * Run:  node scripts/generate-catalog.mjs
 *       (or via: pnpm --filter @pantheon-systems/p1-starter-components registry:generate)
 *
 * To add a block:
 *   1. Create registry/p1/blocks/<name>/
 *         <name>.tsx
 *         <name>.block.tsx  ← must export `meta` and a named *Block const
 *         <name>.css
 *   2. Run this script (happens automatically on pnpm dev / pnpm build)
 *      → story scaffold created at stories/<name>.stories.tsx (enhance with variants as needed)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOCKS_DIR = resolve(__dirname, '../registry/p1/blocks');
const STORIES_DIR = resolve(__dirname, '../stories');
const REGISTRY_APP = resolve(__dirname, '../../../apps/p1-registry');
const REGISTRY_JSON_PATH = join(BLOCKS_DIR, 'registry.json');

const NON_BLOCK = new Set([
  'index.ts', 'index.test.ts', 'parity.test.ts',
  'registry.json', 'registry.test.ts',
]);

// Category display order for the Puck drawer (global chrome first).
const CATEGORY_ORDER_BARREL = ['global', 'attention', 'trust', 'value', 'showcase', 'convert', 'editorial', 'layout', 'content'];
// Category display order for the catalog UI (most visual first).
const CATEGORY_ORDER_CATALOG = ['attention', 'trust', 'value', 'showcase', 'convert', 'editorial', 'layout', 'content', 'global'];

const CATEGORY_TITLE = {
  global: 'Global', attention: 'Attention', trust: 'Trust', value: 'Value',
  showcase: 'Showcase', convert: 'Convert', editorial: 'Editorial',
  layout: 'Layout', content: 'Content',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

// Parse the `export const meta = { ... }` literal from a .block.tsx file.
// Uses brace counting so nested structures are handled correctly.
function parseMeta(filePath) {
  const content = readFileSync(filePath, 'utf8');

  const startIdx = content.indexOf('export const meta =');
  if (startIdx === -1) throw new Error(`No "export const meta" found in ${filePath}`);

  const braceIdx = content.indexOf('{', startIdx);
  let depth = 0;
  let end = braceIdx;
  for (let i = braceIdx; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  const objStr = content.slice(braceIdx, end + 1)
    .replace(/\bas const\b/g, '') // strip TS-only syntax
    .replace(/,(\s*[}\]])/g, '$1'); // trailing commas (safe in modern JS but lets Function() be safe)

  try {
     
    const raw = new Function('return ' + objStr)();
    // Mirror defineMeta() defaults so the generator stays in sync with runtime.
    return {
      dependencies: ['@puckeditor/core'],
      registryDependencies: ['@p1/tokens'],
      ...raw,
    };
  } catch (e) {
    throw new Error(`Failed to eval meta in ${filePath}: ${e.message}`);
  }
}

// Find the named *Block export in a .block.tsx file.
function getExportName(name, filePath) {
  const content = readFileSync(filePath, 'utf8');
  const match = content.match(/export const (\w+Block)\s*[=:]/);
  if (!match) throw new Error(`No *Block export found in ${filePath}`);
  return match[1];
}

// Derive the Puck component key from the export name: "HeroBlock" → "P1Hero".
function toPuckKey(exportName) {
  return 'P1' + exportName.replace(/Block$/, '');
}

// Auto-generate the shadcn docs string.
function generateDocs(name, exportName) {
  const puckKey = toPuckKey(exportName);
  return (
    `Register the block in your Puck config:\n\n` +
    `  // components/puck/blocks/index.ts\n` +
    `  import { ${exportName} } from './${name}/${name}.block';\n` +
    `  export const p1Blocks = { ...p1Blocks, ${puckKey}: ${exportName} };\n\n` +
    `Then edit components/puck/blocks/${name}/${name}.css to restyle it — the file is yours.`
  );
}

// ── Discover blocks ──────────────────────────────────────────────────────────

const blockNames = readdirSync(BLOCKS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !NON_BLOCK.has(d.name))
  .map((d) => d.name)
  .sort();

const blocks = blockNames.map((name) => {
  const blockFile = join(BLOCKS_DIR, name, `${name}.block.tsx`);
  if (!existsSync(blockFile)) throw new Error(`Missing ${blockFile}`);

  const meta = parseMeta(blockFile);
  const exportName = getExportName(name, blockFile);
  const category = (meta.categories?.[0] ?? 'other').toLowerCase();

  return { name, exportName, category, meta };
});

// ── Build category → [exportName] map ───────────────────────────────────────

const categoryMap = {};
for (const { exportName, category } of blocks) {
  (categoryMap[category] ??= []).push(exportName);
}

function orderedCategories(order) {
  return [
    ...order.filter((c) => categoryMap[c]),
    ...Object.keys(categoryMap).filter((c) => !order.includes(c)).sort(),
  ];
}

const HEADER = `// AUTO-GENERATED — DO NOT EDIT
// Source: packages/p1-starter-components/scripts/generate-catalog.mjs
// Run \`pnpm registry:generate\` to refresh after adding or removing a block.
`;

// ── Generate registry/p1/blocks/registry.json ────────────────────────────────

const registryItems = blocks.map(({ name, exportName, category, meta }) => ({
  name,
  type: 'registry:block',
  title: meta.title ?? name,
  description: meta.description ?? '',
  categories: meta.categories ?? [category],
  dependencies: meta.dependencies ?? ['@puckeditor/core'],
  registryDependencies: meta.registryDependencies ?? ['@p1/tokens'],
  meta: { version: '0.1.0', atlas: `${category}/${name}` },
  docs: generateDocs(name, exportName),
  files: [
    { path: `${name}/${name}.tsx`, type: 'registry:component', target: `components/puck/blocks/${name}/${name}.tsx` },
    { path: `${name}/${name}.block.tsx`, type: 'registry:component', target: `components/puck/blocks/${name}/${name}.block.tsx` },
    { path: `${name}/${name}.css`, type: 'registry:file', target: `components/puck/blocks/${name}/${name}.css` },
  ],
}));

const registryJson = {
  $schema: 'https://ui.shadcn.com/schema/registry.json',
  items: registryItems,
};

writeFileSync(REGISTRY_JSON_PATH, JSON.stringify(registryJson, null, 2) + '\n');
console.log('  Generated registry/p1/blocks/registry.json');

// ── Generate registry/p1/blocks/index.ts ─────────────────────────────────────

const barrelCategories = orderedCategories(CATEGORY_ORDER_BARREL);

const importLines = barrelCategories.flatMap((cat) => {
  const title = CATEGORY_TITLE[cat] ?? (cat[0].toUpperCase() + cat.slice(1));
  const sep = `// ── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}`;
  const imports = categoryMap[cat].map((exportName) => {
    const block = blocks.find((b) => b.exportName === exportName);
    return `import { ${exportName} } from "./${block.name}/${block.name}.block";`;
  });
  return [sep, ...imports];
});

const allExportNames = barrelCategories.flatMap((c) => categoryMap[c]);

const sourceCatLines = barrelCategories.map((cat) => {
  const title = CATEGORY_TITLE[cat] ?? (cat[0].toUpperCase() + cat.slice(1));
  const components = categoryMap[cat].map((e) => `"${e}"`).join(', ');
  return `  ${title}: { title: "${title}", components: [${components}] },`;
});

const indexTs = `${HEADER}
/**
 * Dev-only barrel. Storybook, the catalog app and the invariant tests enumerate
 * blocks through here. It is NOT part of any registry item and never reaches a
 * user's project — the code registry distributes each block's files directly.
 */
import type { Config } from "@puckeditor/core";

${importLines.join('\n')}

// Re-export every component config
export {
${allExportNames.map((e) => `  ${e},`).join('\n')}
};

// Convenience map — pass to Puck's \`components\`. Not distributed; see jsdoc above.
export const allBlocks = {
${allExportNames.map((e) => `  ${e},`).join('\n')}
};

// Category configuration for the Puck component drawer.
export const sourceCategories: Config["categories"] = {
${sourceCatLines.join('\n')}
};
`;

writeFileSync(join(BLOCKS_DIR, 'index.ts'), indexTs);
console.log('  Generated registry/p1/blocks/index.ts');

// ── Generate apps/p1-registry/lib/preview-map.ts ─────────────────────────────

const previewMapTs = `${HEADER}
// Names of blocks that have a /preview route.
export const previewNames = [
  ${blockNames.map((n) => `'${n}'`).join(', ')},
] as const;
`;

writeFileSync(join(REGISTRY_APP, 'lib', 'preview-map.ts'), previewMapTs);
console.log('  Generated apps/p1-registry/lib/preview-map.ts');

// ── Generate apps/p1-registry/lib/catalog-order.ts ───────────────────────────

const catalogOrderEntries = orderedCategories(CATEGORY_ORDER_CATALOG)
  .map((cat, i) => `  ${cat}: ${i},`)
  .join('\n');

const catalogOrderTs = `${HEADER}
// Category display priority for the catalog UI.
// Unknown categories fall back to 99 (appended alphabetically by the generator).
export const CATALOG_CATEGORY_ORDER: Record<string, number> = {
${catalogOrderEntries}
};
`;

writeFileSync(join(REGISTRY_APP, 'lib', 'catalog-order.ts'), catalogOrderTs);
console.log('  Generated apps/p1-registry/lib/catalog-order.ts');

// ── Generate apps/p1-registry/_components/PreviewRenderer.tsx ────────────────

const dynamicEntries = blocks
  .map(
    ({ name, exportName }) =>
      `  '${name}': makeDynamic(() =>\n` +
      `    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/${name}/${name}.block')\n` +
      `      .then(m => m.${exportName} as unknown as BlockConfig)),`,
  )
  .join('\n');

const previewRendererTsx = `${HEADER}
'use client';
import dynamic from 'next/dynamic';
import React from 'react';

// Block shape we need for preview: render component + default props.
type BlockConfig = {
  render: React.ComponentType<Record<string, unknown>>;
  defaultProps?: Record<string, unknown>;
};

// Each entry is a separate import() string so the bundler can code-split per block.
// Template-literal imports would cause the bundler to include every block in every chunk.
function makeDynamic(loader: () => Promise<BlockConfig>) {
  return dynamic(() =>
    loader().then(({ render: Render, defaultProps = {} }) => ({
      default: function BlockPreview() {
        return <Render {...defaultProps} />;
      },
    }))
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicBlocks: Record<string, React.ComponentType<any>> = {
${dynamicEntries}
};

interface PreviewRendererProps {
  name: string;
}

export function PreviewRenderer({ name }: PreviewRendererProps) {
  const Block = dynamicBlocks[name];

  if (!Block) {
    return <div style={{ padding: '2rem', color: '#888' }}>Block &quot;{name}&quot; not found.</div>;
  }

  return <Block />;
}
`;

writeFileSync(join(REGISTRY_APP, '_components', 'PreviewRenderer.tsx'), previewRendererTsx);
console.log('  Generated apps/p1-registry/_components/PreviewRenderer.tsx');

// ── Scaffold stories/<name>.stories.tsx for new blocks ───────────────────────
// Never overwrites an existing file — the developer owns it once it exists.

let storiesScaffolded = 0;
for (const { name, exportName, category, meta } of blocks) {
  const storyPath = join(STORIES_DIR, `${name}.stories.tsx`);
  if (existsSync(storyPath)) continue;

  const title = meta.title ?? name;
  const catTitle = CATEGORY_TITLE[category] ?? (category[0].toUpperCase() + category.slice(1));
  const propsType = exportName.replace(/Block$/, 'Props');

  const scaffold = `import type { Meta, StoryObj } from "@storybook/react";
import { ${exportName}, type ${propsType} } from "@/registry/p1/blocks/${name}/${name}.block";

const ${title.replace(/\s+/g, '')}Wrapper = (props: ${propsType}) => {
  const Component = ${exportName}.render as React.FC<${propsType}>;
  return <Component {...props} />;
};

const meta = {
  title: "${catTitle}/${exportName}",
  component: ${title.replace(/\s+/g, '')}Wrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
} satisfies Meta<typeof ${title.replace(/\s+/g, '')}Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };
`;

  writeFileSync(storyPath, scaffold);
  console.log(`  Scaffolded stories/${name}.stories.tsx`);
  storiesScaffolded++;
}

if (storiesScaffolded === 0) console.log('  Stories: all already exist, nothing scaffolded');

console.log(`\nDone: ${blocks.length} blocks across ${barrelCategories.length} categories.`);
