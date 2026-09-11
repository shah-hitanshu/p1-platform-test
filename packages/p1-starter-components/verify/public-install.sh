#!/usr/bin/env bash
# Validates the DEPLOYED registry the way a customer meets it.
# Usage: verify/public-install.sh https://p1-components.pantheon.io
set -euo pipefail
HOST="${1:?usage: public-install.sh <https://host>}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "==> index resolves unauthenticated"
# --no-netrc and a scrubbed env: no credentials of ours may make this pass.
env -u GITHUB_TOKEN -u GH_TOKEN -u NPM_TOKEN \
  curl -fsS --no-netrc "$HOST/r/registry.json" -o "$WORK/index.json"
node -e "
  const i = require('$WORK/index.json');
  if (!Array.isArray(i.items) || i.items.length < 40) throw new Error('index too small: ' + i.items?.length);
  // Structural, not a substring scan: several items are categorised \"content\",
  // which a naive JSON.stringify().includes() check reads as inlined file content.
  const inlined = i.items.filter((x) => (x.files ?? []).some((f) => 'content' in f));
  if (inlined.length) throw new Error('index inlines content: ' + inlined.map((x) => x.name).join(', '));
  console.log('index OK:', i.name, i.items.length, 'items');
"

echo "==> every indexed item resolves"
node -e "
  const i = require('$WORK/index.json');
  console.log(i.items.map((x) => x.name).join('\n'));
" | while read -r name; do
  code=$(curl -fsS -o /dev/null -w '%{http_code}' "$HOST/r/$name.json") || {
    echo "FAIL: $name did not resolve"; exit 1; }
  [ "$code" = "200" ] || { echo "FAIL: $name -> $code"; exit 1; }
done
echo "all items resolve"

echo "==> cache headers are what Hosting decided"
curl -sSI "$HOST/r/registry.json" | grep -Ei 'cache-control|etag' || {
  echo "FAIL: no cache headers on the index"; exit 1; }

echo "==> a clean project installs from the public origin"
cd "$WORK" && mkdir consumer && cd consumer
npm init -y >/dev/null
# The same shape the scaffolder writes. shadcn rejects a components.json missing
# style, rsc or tailwind outright, so a partial one fails before it ever reaches
# the registry and tells you nothing about the host.
cat > components.json <<JSON
{ "\$schema": "https://ui.shadcn.com/schema.json",
  "style": "p1",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "app/styles.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks", "utils": "@/lib/utils" },
  "registries": { "@p1": "$HOST/r/{name}.json" } }
JSON
# shadcn resolves the @/ aliases through tsconfig and refuses to run without one.
cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "jsx": "preserve", "module": "esnext", "moduleResolution": "bundler",
  "strict": true, "skipLibCheck": true, "esModuleInterop": true, "noEmit": true,
  "paths": { "@/*": ["./*"] } }, "include": ["**/*.ts", "**/*.tsx"], "exclude": ["node_modules"] }
JSON
# @p1/tokens appends its own @import to whatever tailwind.css names, so the file
# has to exist for that half of the install to be exercised.
mkdir -p app && printf '@import "tailwindcss";\n' > app/styles.css
pnpm dlx shadcn@latest list @p1
pnpm dlx shadcn@latest search @p1 --query hero
pnpm dlx shadcn@latest add @p1/hero --yes
test -f components/puck/blocks/hero/hero.tsx || { echo "FAIL: hero did not install"; exit 1; }
grep -q 'p1-tokens' app/styles.css || { echo "FAIL: @p1/tokens did not inject its import"; exit 1; }

echo "==> --diff reports drift on an edited block"
printf '\n// customer edit\n' >> components/puck/blocks/hero/hero.tsx
# Named path, not a bare --diff: shadcn prints only the first five files of an
# item and hero has nine, so the edited one falls outside the summary.
pnpm dlx shadcn@latest add @p1/hero --diff components/puck/blocks/hero/hero.tsx \
  2>&1 | tee "$WORK/diff.txt"
grep -q 'customer edit\|^-\|^+' "$WORK/diff.txt" || { echo "FAIL: --diff reported nothing"; exit 1; }

echo "==> no agent tooling was installed (D19)"
test ! -e AGENTS.md && test ! -e .claude && test ! -e P1-BLOCKS.md \
  || { echo "FAIL: agent files present in a generated tree"; exit 1; }

echo "PUBLIC DISTRIBUTION OK against $HOST"
