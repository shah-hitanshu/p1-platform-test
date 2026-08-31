#!/usr/bin/env bash
# Installs every item in the built registry into a bare Next app with no
# Tailwind, then typechecks and builds it.
#
# Run: pnpm --filter @pantheon-systems/p1-starter-components verify:registry
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
R="$REPO_ROOT/apps/p1-registry/public/r"
WORK="${TMPDIR:-/tmp}/p1-registry-verify"

echo "==> building the registry"
(cd "$PKG_DIR" && pnpm run registry:build)

echo "==> index sanity"
node -e "
  const index = require('$R/registry.json');
  const inlines = index.items.some(i => (i.files ?? []).some(f => 'content' in f));
  if (inlines) { console.error('FAIL: the index inlines file content'); process.exit(1); }
  if ('include' in index) { console.error('FAIL: the index still has include'); process.exit(1); }
  console.log('    ' + index.items.length + ' items, no inlined content');
"

echo "==> creating a bare Next app with no Tailwind"
rm -rf "$WORK" && mkdir -p "$WORK" && cd "$WORK"
pnpm create next-app@latest consumer \
  --typescript --app --no-tailwind --no-eslint --no-src-dir --no-turbopack --import-alias "@/*" >/dev/null
cd consumer
cat > components.json <<JSON
{
  "\$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york", "rsc": true, "tsx": true,
  "tailwind": { "config": "", "css": "app/globals.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks", "utils": "@/lib/utils" },
  "registries": { "@p1": "$R/{name}.json" }
}
JSON

echo "==> installing @p1/base"
pnpm dlx shadcn@latest add "$R/base.json" --yes >/dev/null
COUNT=$(find components/puck/blocks -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')
[ "$COUNT" = "29" ] || { echo "FAIL: expected 29 blocks from base, got $COUNT"; exit 1; }
echo "    29 blocks"

echo "==> installing the eight excluded blocks individually"
for n in heading paragraph image quote list button divider spacer; do
  pnpm dlx shadcn@latest add "$R/$n.json" --yes >/dev/null
done
COUNT=$(find components/puck/blocks -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')
[ "$COUNT" = "37" ] || { echo "FAIL: expected 37 blocks total, got $COUNT"; exit 1; }
echo "    37 blocks"

echo "==> every installed import resolves"
node -e "
  const { readdirSync, readFileSync, existsSync } = require('fs');
  const { join } = require('path');
  const bad = [];
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  for (const file of walk('components/puck/blocks').filter(f => /\.tsx?$/.test(f))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from ['\"]([^'\"]+)['\"]/g)) {
      const spec = m[1];
      if (spec.startsWith('@/registry')) bad.push(file + ' -> ' + spec + ' (not rewritten)');
      if (spec.startsWith('.')) {
        const base = join(file, '..', spec);
        const found = ['', '.ts', '.tsx', '.css', '/index.ts', '/index.tsx'].some(ext => existsSync(base + ext));
        if (!found) bad.push(file + ' -> ' + spec + ' (missing)');
      }
    }
  }
  if (bad.length) { console.error('FAIL:\n' + bad.join('\n')); process.exit(1); }
  console.log('    all imports resolve');
"

echo "==> registering every block and building"
PUCK_VERSION=$(node -p "require('$PKG_DIR/package.json').devDependencies['@puckeditor/core'].replace(/^\^/, '')")
pnpm add "@puckeditor/core@$PUCK_VERSION" >/dev/null
node -e "
  const { readdirSync, readFileSync, writeFileSync } = require('fs');
  const dirs = readdirSync('components/puck/blocks', { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => e.name);
  const pascal = (s) => s.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('');
  // The export name does not always match the directory (features -> FeatureCardsBlock),
  // so read the real one rather than deriving it.
  const exportName = (d) => {
    const src = readFileSync(\`components/puck/blocks/\${d}/\${d}.block.tsx\`, 'utf8');
    const m = src.match(/export const (\w+Block)\s*[=:]/);
    if (!m) throw new Error('no *Block export in ' + d);
    return m[1];
  };
  writeFileSync('components/puck/blocks/index.ts',
    dirs.map(d => \`import { \${exportName(d)} } from './\${d}/\${d}.block';\`).join('\n') +
    '\n\nexport const p1Blocks = {\n' +
    dirs.map(d => \`  P1\${pascal(d)}: \${exportName(d)},\`).join('\n') +
    '\n};\nexport const p1Categories = {};\n');
"
pnpm exec tsc --noEmit
pnpm build

echo ""
echo "All registry checks passed."
echo "  consumer: $WORK/consumer"
