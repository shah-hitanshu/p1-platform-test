/**
 * Catalog generator — scans registry/p1/blocks/ and writes two derived artifacts:
 *
 *   registry/p1/blocks/registry.json            (shadcn registry manifest)
 *   apps/p1-registry/lib/catalog.generated.tsx  (previewNames, CATALOG_CATEGORY_ORDER, previewComponents)
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
  'index.test.ts', 'parity.test.ts',
  'registry.json', 'registry.test.ts',
]);

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
// Limitation: brace counting does not skip string literals — a description
// containing an unmatched { or } would mis-terminate. Use only balanced
// braces in block meta strings (or HTML entities &#123; / &#125;).
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
      published: true,
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
    `  // 1. Add the import:\n` +
    `  import { ${exportName} } from './${name}/${name}.block';\n` +
    `  // 2. Add an entry to the existing p1Blocks object:\n` +
    `  //    ${puckKey}: ${exportName},\n\n` +
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
}).filter((b) => b.meta.published !== false);

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

// ── Generate apps/p1-registry/lib/catalog.generated.tsx ─────────────────────

const catalogOrderEntries = orderedCategories(CATEGORY_ORDER_CATALOG)
  .map((cat, i) => `  ${cat}: ${i},`)
  .join('\n');

const catalogDynamicEntries = blocks
  .map(
    ({ name, exportName }) =>
      `  '${name}': makeDynamic(() =>\n` +
      `    import('@pantheon-systems/p1-starter-components/registry/p1/blocks/${name}/${name}.block')\n` +
      `      .then(m => m.${exportName} as unknown as BlockConfig)),`,
  )
  .join('\n');

const catalogGeneratedTsx = `${HEADER}
import React from 'react';
import dynamic from 'next/dynamic';

// Block shape needed for preview: render component + initial prop values.
type BlockConfig = {
  render: React.ComponentType<Record<string, unknown>>;
  defaultProps?: Record<string, unknown>;
};

// Each import() uses a static string literal so the bundler code-splits per block.
function makeDynamic(loader: () => Promise<BlockConfig>): React.ComponentType {
  return dynamic(() =>
    loader().then(({ render: Render, defaultProps = {} }) => ({
      default: function BlockPreview() {
        return <Render {...defaultProps} />;
      },
    }))
  );
}

// Used by generateStaticParams() — safe to import in server context.
export const previewNames = [
  ${blockNames.map((n) => `'${n}'`).join(', ')},
] as const;

// Category display priority for the catalog UI. Unknown categories fall back to 99.
export const CATALOG_CATEGORY_ORDER: Record<string, number> = {
${catalogOrderEntries}
};

// Dynamic block map for PreviewRenderer. Each entry is code-split independently.
export const previewComponents: Record<string, React.ComponentType> = {
${catalogDynamicEntries}
};
`;

writeFileSync(join(REGISTRY_APP, 'lib', 'catalog.generated.tsx'), catalogGeneratedTsx);
console.log('  Generated apps/p1-registry/lib/catalog.generated.tsx');

// ── Generate apps/p1-registry/lib/preview-names.ts ───────────────────────────
// Kept free of component imports so the catalog page avoids pulling in block
// CSS (which would override .p1-header / .p1-footer in the site chrome).

const previewNamesTsContent = `${HEADER}
// Kept free of component imports — importing previewComponents here would
// pull every block's CSS into the catalog page and override site chrome.
export const previewNames: string[] = [
  ${blockNames.map((n) => `'${n}'`).join(', ')},
];
`;

writeFileSync(join(REGISTRY_APP, 'lib', 'preview-names.ts'), previewNamesTsContent);
console.log('  Generated apps/p1-registry/lib/preview-names.ts');

// ── Scaffold stories/<name>.stories.tsx for new blocks ───────────────────────
// Never overwrites an existing file — the developer owns it once it exists.

let storiesScaffolded = 0;
for (const { name, exportName, category, meta } of blocks) {
  const storyPath = join(STORIES_DIR, `${name}.stories.tsx`);

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

  // Exclusive create, so an existing file is never clobbered even if it
  // appears between this loop starting and the write.
  try {
    writeFileSync(storyPath, scaffold, { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') continue;
    throw err;
  }
  console.log(`  Scaffolded stories/${name}.stories.tsx`);
  storiesScaffolded++;
}

if (storiesScaffolded === 0) console.log('  Stories: all already exist, nothing scaffolded');

console.log(`\nDone: ${blocks.length} blocks across ${Object.keys(categoryMap).length} categories.`);
