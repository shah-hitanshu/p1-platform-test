#!/usr/bin/env bash
# teardown-sandbox.sh
#
# Removes all sandbox infrastructure created by setup-sandbox.sh.
# Deletes: CloudSQL instance, KV namespaces, Hyperdrive, Worker, Pages project.
#
# Usage: ./scripts/teardown-sandbox.sh
#
# The script prompts for confirmation before each destructive action.

set -euo pipefail

# ===========================================================================
# Colors and helpers
# ===========================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "[INFO]  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }
step()  { echo -e "\n${BOLD}==> $*${NC}"; }

confirm() {
  local msg="${1:-Continue?}"
  echo -en "${YELLOW}${msg} [y/N] ${NC}"
  read -r answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

# ===========================================================================
# Configuration (must match setup-sandbox.sh)
# ===========================================================================
GCP_INSTANCE_NAME="${GCP_INSTANCE_NAME:-css-sandbox-postgres}"
CF_WORKER_NAME="collaborative-state-worker-sandbox"
CF_PAGES_PROJECT="css-frontend-sandbox"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKERS_DIR="$PROJECT_ROOT/workers"

GCP_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")

echo -e "${BOLD}Sandbox Teardown${NC}"
echo ""
echo "This will delete the following resources:"
echo "  - GCP CloudSQL instance: $GCP_INSTANCE_NAME"
echo "  - CF Worker:             $CF_WORKER_NAME"
echo "  - CF Pages project:      $CF_PAGES_PROJECT"
echo "  - CF KV namespaces:      CONFIG_KV_SANDBOX, SESSION_KV_SANDBOX"
echo "  - CF Hyperdrive:         css-postgres-sandbox"
echo ""

if ! confirm "This is destructive and cannot be undone. Proceed?"; then
  echo "Aborted."
  exit 0
fi

# ===========================================================================
# Delete Cloudflare Worker
# ===========================================================================
step "Deleting Cloudflare Worker"

if confirm "Delete worker '$CF_WORKER_NAME'?"; then
  cd "$WORKERS_DIR"
  npx wrangler delete --name "$CF_WORKER_NAME" 2>/dev/null && \
    ok "Worker deleted" || \
    warn "Worker deletion failed (may not exist)"
else
  info "Skipped worker deletion"
fi

# ===========================================================================
# Delete Cloudflare Pages project
# ===========================================================================
step "Deleting Cloudflare Pages project"

if confirm "Delete Pages project '$CF_PAGES_PROJECT'?"; then
  npx wrangler pages project delete "$CF_PAGES_PROJECT" 2>/dev/null && \
    ok "Pages project deleted" || \
    warn "Pages project deletion failed (may not exist)"
else
  info "Skipped Pages deletion"
fi

# ===========================================================================
# Delete Cloudflare KV namespaces
# ===========================================================================
step "Deleting Cloudflare KV namespaces"

# List KV namespaces and find ours
KV_LIST=$(cd "$WORKERS_DIR" && npx wrangler kv namespace list 2>/dev/null || echo "[]")

delete_kv_namespace() {
  local title="$1"
  local ns_id
  ns_id=$(echo "$KV_LIST" | jq -r ".[] | select(.title | contains(\"$title\")) | .id" 2>/dev/null || echo "")
  if [[ -n "$ns_id" ]]; then
    if confirm "Delete KV namespace '$title' (ID: $ns_id)?"; then
      cd "$WORKERS_DIR" && npx wrangler kv namespace delete --namespace-id="$ns_id" 2>/dev/null && \
        ok "Deleted KV namespace '$title'" || \
        warn "Failed to delete KV namespace '$title'"
    fi
  else
    info "KV namespace '$title' not found"
  fi
}

delete_kv_namespace "CONFIG_KV_SANDBOX"
delete_kv_namespace "SESSION_KV_SANDBOX"

# ===========================================================================
# Delete Cloudflare Hyperdrive
# ===========================================================================
step "Deleting Cloudflare Hyperdrive"

if confirm "Delete Hyperdrive config 'css-postgres-sandbox'?"; then
  cd "$WORKERS_DIR"
  # List hyperdrives to find the ID
  HYPERDRIVE_LIST=$(npx wrangler hyperdrive list 2>/dev/null || echo "[]")
  HYPERDRIVE_ID=$(echo "$HYPERDRIVE_LIST" | jq -r '.[] | select(.name == "css-postgres-sandbox") | .id' 2>/dev/null || echo "")
  if [[ -n "$HYPERDRIVE_ID" ]]; then
    npx wrangler hyperdrive delete "$HYPERDRIVE_ID" 2>/dev/null && \
      ok "Hyperdrive deleted" || \
      warn "Hyperdrive deletion failed"
  else
    info "Hyperdrive 'css-postgres-sandbox' not found"
  fi
else
  info "Skipped Hyperdrive deletion"
fi

# ===========================================================================
# Delete GCP CloudSQL instance
# ===========================================================================
step "Deleting GCP CloudSQL instance"

if [[ -z "$GCP_PROJECT" || "$GCP_PROJECT" == "(unset)" ]]; then
  warn "No GCP project configured, skipping CloudSQL deletion"
else
  if gcloud sql instances describe "$GCP_INSTANCE_NAME" --project="$GCP_PROJECT" &>/dev/null; then
    if confirm "Delete CloudSQL instance '$GCP_INSTANCE_NAME' in project '$GCP_PROJECT'? (ALL DATA WILL BE LOST)"; then
      gcloud sql instances delete "$GCP_INSTANCE_NAME" \
        --project="$GCP_PROJECT" \
        --quiet
      ok "CloudSQL instance deleted"
    else
      info "Skipped CloudSQL deletion"
    fi
  else
    info "CloudSQL instance '$GCP_INSTANCE_NAME' not found"
  fi
fi

# ===========================================================================
# Summary
# ===========================================================================
step "Teardown Complete"

echo ""
echo "Remaining manual cleanup (if needed):"
echo "  - Remove sandbox env from workers/wrangler.jsonc"
echo "  - Clear any local .env files referencing sandbox URLs"
echo ""
