#!/usr/bin/env bash
# Validates the DEPLOYED registry the way a customer meets it (PCC-3580, D20).
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
  if (JSON.stringify(i).includes('\"content\"')) throw new Error('index must not inline content');
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
cat > components.json <<JSON
{ "\$schema": "https://ui.shadcn.com/schema.json",
  "tsx": true,
  "aliases": { "components": "@/components", "lib": "@/lib", "utils": "@/lib/utils" },
  "registries": { "@p1": "$HOST/r/{name}.json" } }
JSON
pnpm dlx shadcn@latest list @p1
pnpm dlx shadcn@latest search @p1 --query hero
pnpm dlx shadcn@latest add @p1/hero --yes
test -f components/puck/blocks/hero/hero.tsx || { echo "FAIL: hero did not install"; exit 1; }

echo "==> --diff reports drift on an edited block"
printf '\n// customer edit\n' >> components/puck/blocks/hero/hero.tsx
pnpm dlx shadcn@latest add @p1/hero --diff | tee "$WORK/diff.txt"
grep -q 'customer edit\|^-\|^+' "$WORK/diff.txt" || { echo "FAIL: --diff reported nothing"; exit 1; }

echo "==> no agent tooling was installed (D19)"
test ! -e AGENTS.md && test ! -e .claude && test ! -e P1-BLOCKS.md \
  || { echo "FAIL: agent files present in a generated tree"; exit 1; }

echo "PUBLIC DISTRIBUTION OK against $HOST"
