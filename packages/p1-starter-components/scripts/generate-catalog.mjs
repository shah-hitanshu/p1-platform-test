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

// Consumers must install the Puck range these blocks are written against. Unpinned,
// npm resolves latest, where the `ai` field property no longer typechecks.
const PUCK_RANGE = (() => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
  const range = pkg.dependencies?.['@puckeditor/core'] ?? pkg.devDependencies?.['@puckeditor/core'];
  if (!range) throw new Error('@puckeditor/core missing from package.json');
  return range;
})();
const PUCK_DEP = `@puckeditor/core@${PUCK_RANGE}`;
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
      dependencies: [PUCK_DEP],
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

// Field/default values are free-form prose ("Everything you need, in one
// place.") that routinely contains the very characters — commas, braces,
// brackets — the scanners below balance on. Every scanner in this file skips
// string literals wholesale so punctuation inside quotes is never mistaken
// for structure.
function skipStringLiteral(str, i) {
  const quote = str[i];
  let j = i + 1;
  while (j < str.length) {
    if (str[j] === '\\') { j += 2; continue; }
    if (str[j] === quote) return j + 1;
    j++;
  }
  return j;
}

// Finds the index of the `close` char balancing the `open` char at `startIdx`,
// treating string contents as opaque. Returns -1 if unbalanced.
function scanBalanced(str, startIdx, open, close) {
  let depth = 0;
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipStringLiteral(str, i) - 1; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Slice out the `{ ... }` following `${key}:`, balancing braces so nested
// objects don't terminate the slice early. Search starts at `fromIdx` so a
// same-named key earlier in the file (there isn't one, but belt-and-braces)
// can't be picked up instead.
function extractObjectSource(content, fromIdx, key) {
  const keyIdx = content.indexOf(`${key}:`, fromIdx);
  if (keyIdx === -1) return undefined;
  const braceIdx = content.indexOf('{', keyIdx);
  const end = scanBalanced(content, braceIdx, '{', '}');
  return content.slice(braceIdx, end + 1);
}

// Split the inner text of a `fields` (or `defaultProps`) object into
// { key: rawValueSource } without evaluating anything. Puck array fields
// carry TS-typed callbacks (e.g. `getItemSummary: (item: Card) => …`), which
// `new Function` can't parse — so unlike parseMeta's braces, these are never
// eval'd, only sliced.
function parseTopLevelFieldMap(innerStr) {
  const result = {};
  const n = innerStr.length;
  let pos = 0;
  while (pos < n) {
    while (pos < n && /[\s,]/.test(innerStr[pos])) pos++;
    if (pos >= n) break;
    const keyMatch = /^("[^"]+"|'[^']+'|[A-Za-z_$][\w$]*)\s*:/.exec(innerStr.slice(pos));
    if (!keyMatch) break;
    const rawKey = keyMatch[1].replace(/^['"]|['"]$/g, '');
    pos += keyMatch[0].length;
    while (pos < n && /\s/.test(innerStr[pos])) pos++;
    const valStart = pos;
    let depth = 0;
    let j = pos;
    for (; j < n; j++) {
      const ch = innerStr[j];
      if (ch === '"' || ch === "'" || ch === '`') { j = skipStringLiteral(innerStr, j) - 1; continue; }
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
      else if (ch === ',' && depth === 0) break;
    }
    result[rawKey] = innerStr.slice(valStart, j).trim();
    pos = j + 1;
  }
  return result;
}

// A field's own `type: "…"` always precedes any nested field definition
// (array fields' `arrayFields` sub-schema), so the first match in the raw
// source is the field's own type, never a nested one.
//
// A few fields (paragraph/quote) are a bare `text: richtextField` — the
// shared factory from @pantheon-systems/puck-css/fields, imported rather than
// inlined, so there's no "type:" text to find at all.
function extractFieldType(valueSrc) {
  if (/^\w*[Rr]ichtext\w*Field$/.test(valueSrc.trim())) return 'richtext';
  const m = /type\s*:\s*["']([^"']+)["']/.exec(valueSrc);
  return m?.[1];
}

// Puck `select`/`radio` options are plain {label,value} data — safe to eval
// in isolation even though the field's own raw source (with its typed
// callbacks) is not.
function extractOptions(valueSrc) {
  const idx = valueSrc.indexOf('options:');
  if (idx === -1) return undefined;
  const bracketIdx = valueSrc.indexOf('[', idx);
  if (bracketIdx === -1) return undefined;
  const end = scanBalanced(valueSrc, bracketIdx, '[', ']');
  if (end === -1) return undefined;
  const arrStr = valueSrc.slice(bracketIdx, end + 1).replace(/,(\s*[}\]])/g, '$1');
  try {

    return new Function('return ' + arrStr)();
  } catch {
    return undefined;
  }
}

function typeLabel(type, options) {
  if ((type === 'select' || type === 'radio') && Array.isArray(options) && options.length) {
    return options.map((o) => JSON.stringify(o.value)).join(' | ');
  }
  switch (type) {
    case 'text':
    case 'textarea':
      return 'string';
    case 'number':
      return 'number';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    case undefined:
      return 'unknown';
    default:
      return type;
  }
}

function defaultLabel(value) {
  if (value === undefined) return 'none';
  if (typeof value === 'string') {
    const truncated = value.length > 40 ? `${value.slice(0, 40)}…` : value;
    return JSON.stringify(truncated);
  }
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  return JSON.stringify(value);
}

// A default value is usually a literal, but some (e.g. `imageSrc: P1_ASSETS.LANDSCAPE`)
// reference an imported constant that can't resolve in an isolated eval. Falls
// back to the raw expression text itself, which is still meaningful in a props table.
function defaultLabelFromSource(rawSrc) {
  const objStr = rawSrc.replace(/\bas const\b/g, '').replace(/,(\s*[}\]])/g, '$1');
  try {

    return defaultLabel(new Function('return ' + objStr)());
  } catch {
    const trimmed = rawSrc.trim();
    return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
  }
}

// Props reference for the catalog's block detail page: real Puck field
// name/type/default, read straight from the block's own config so the table
// can never drift from what the component actually accepts.
function parseProps(exportName, filePath) {
  const content = readFileSync(filePath, 'utf8');
  const exportIdx = content.indexOf(`export const ${exportName}`);
  if (exportIdx === -1) throw new Error(`Cannot find export const ${exportName} in ${filePath}`);

  const fieldsSrc = extractObjectSource(content, exportIdx, 'fields');
  const defaultsSrc = extractObjectSource(content, exportIdx, 'defaultProps');

  // Parsed per-key rather than eval'd whole, so one unresolvable value (an
  // imported constant, not a literal) can't blank out every other default.
  const defaultRawMap = defaultsSrc ? parseTopLevelFieldMap(defaultsSrc.slice(1, -1)) : {};

  if (!fieldsSrc) return [];

  const fieldMap = parseTopLevelFieldMap(fieldsSrc.slice(1, -1));
  return Object.entries(fieldMap).map(([name, valueSrc]) => {
    const type = extractFieldType(valueSrc);
    const options = type === 'select' || type === 'radio' ? extractOptions(valueSrc) : undefined;
    const rawDefault = defaultRawMap[name];
    return {
      name,
      type: typeLabel(type, options),
      default: rawDefault !== undefined ? defaultLabelFromSource(rawDefault) : 'none',
    };
  });
}

// Derive the Puck component key from the export name: "HeroBlock" → "P1Hero".
function toPuckKey(exportName) {
  return 'P1' + exportName.replace(/Block$/, '');
}

// The three lines a user pastes to register a block. Built from the block's own
// metadata, so nothing has to read the user's file to work out what to tell them.
function generateDocs(name, exportName, categories) {
  const puckKey = toPuckKey(exportName);
  // Categories are single lowercase words in the registry; the starter's own keys
  // are namespaced so an unprefixed collision can't hide the block in the drawer.
  const category = (categories?.[0] ?? 'other').replace(/^./, (c) => c.toUpperCase());
  const categoryKey = `p1${category}`;
  return (
    `Register it in components/puck/blocks/index.ts:\n\n` +
    `  import { ${exportName} } from "./${name}/${name}.block";\n\n` +
    `  // in p1Blocks\n` +
    `  ${puckKey}: ${exportName},\n\n` +
    `  // in p1Categories — create the entry if it does not exist yet:\n` +
    `  ${categoryKey}: { title: "P1 ${category}", components: ["${puckKey}"] },\n` +
    `  // or, if ${categoryKey} already exists, add to its components array (no duplicate key):\n` +
    `  // ${categoryKey}: { title: "P1 ${category}", components: ["${puckKey}", "P1CTA"] },\n\n` +
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
  const props = parseProps(exportName, blockFile);

  return { name, exportName, category, meta, props };
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
  dependencies: (meta.dependencies ?? ['@puckeditor/core']).map((d) => (d === '@puckeditor/core' ? PUCK_DEP : d)),
  // Every block imports defineMeta, so this is appended rather than left to the per-block list.
  registryDependencies: [...new Set([...(meta.registryDependencies ?? ['@p1/tokens']), '@p1/internal-meta'])],
  meta: { version: '0.1.0', atlas: `${category}/${name}`, exportName },
  docs: generateDocs(name, exportName, meta.categories ?? [category]),
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

const blockPropsEntries = blocks
  .map(({ name, props }) => `  '${name}': ${JSON.stringify(props)},`)
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

// ── Generate apps/p1-registry/lib/block-props.generated.ts ──────────────────
// Same reasoning as preview-names.ts: a plain data export, kept out of
// catalog.generated.tsx. next/dynamic's CSS preloading pulls in a component's
// CSS for any page that imports its module server-side, even unrendered —
// so a page that only wants this data would otherwise drag in every block's
// CSS (and, e.g., the Footer block's own .p1-footer/.p1-footer__tagline
// classes collide with the site chrome's identically-named classes).

const blockPropsTsContent = `${HEADER}
// Kept free of component imports — see catalog.generated.tsx's previewComponents
// for why. Puck field metadata per block — name, display type, and default
// value — for the catalog's block detail page. Parsed from each block's own
// \`fields\` and \`defaultProps\`, so it can't drift from what the component accepts.
export const blockProps: Record<string, { name: string; type: string; default: string }[]> = {
${blockPropsEntries}
};
`;

writeFileSync(join(REGISTRY_APP, 'lib', 'block-props.generated.ts'), blockPropsTsContent);
console.log('  Generated apps/p1-registry/lib/block-props.generated.ts');

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
