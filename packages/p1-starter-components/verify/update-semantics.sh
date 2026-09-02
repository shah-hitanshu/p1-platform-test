#!/usr/bin/env bash
# Asserts the update contract: a local edit survives a re-add without
# --overwrite, --diff reports the difference, and --overwrite replaces it.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
R="$REPO_ROOT/apps/p1-registry/public/r"
WORK="${TMPDIR:-/tmp}/p1-update-semantics"

rm -rf "$WORK" && mkdir -p "$WORK" && cd "$WORK"
printf '{ "name":"u","private":true,"type":"module" }\n' > package.json
mkdir -p app && printf ':root{--x:1rem}\n' > app/styles.css
cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "jsx": "preserve", "baseUrl": ".", "paths": { "@/*": ["./*"] } } }
JSON
cat > components.json <<JSON
{ "\$schema": "https://ui.shadcn.com/schema.json", "style": "new-york", "rsc": true, "tsx": true,
  "tailwind": { "config": "", "css": "app/styles.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks", "utils": "@/lib/utils" },
  "registries": { "@p1": "$R/{name}.json" } }
JSON

pnpm dlx shadcn@latest add "$R/divider.json" --yes >/dev/null
FILE=components/puck/blocks/divider/divider.tsx
printf '\n// customer edit\n' >> "$FILE"

echo "==> --diff reports the local difference"
pnpm dlx shadcn@latest add "$R/divider.json" --diff 2>&1 | tee /tmp/p1-diff.txt | tail -20
grep -q 'customer edit' /tmp/p1-diff.txt || { echo "FAIL: --diff did not surface the local edit"; exit 1; }

echo "==> a re-add without --overwrite does not clobber"
# --yes does NOT imply overwrite: the CLI prompts, so with stdin closed it must
# leave the file alone rather than replacing it.
pnpm dlx shadcn@latest add "$R/divider.json" --yes < /dev/null >/dev/null 2>&1 || true
grep -q 'customer edit' "$FILE" || { echo "FAIL: the customer edit was lost without --overwrite"; exit 1; }

echo "==> --overwrite does clobber"
pnpm dlx shadcn@latest add "$R/divider.json" --yes --overwrite < /dev/null >/dev/null 2>&1
grep -q 'customer edit' "$FILE" && { echo "FAIL: --overwrite did not replace the file"; exit 1; }

echo ""
echo "Update semantics hold: --diff reports, plain add preserves, --overwrite replaces."
