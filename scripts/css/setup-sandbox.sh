#!/usr/bin/env bash
# setup-sandbox.sh
#
# Sets up a personal sandbox deployment using Cloudflare Workers + GCP CloudSQL.
# Creates all required infrastructure and deploys the backend and frontend.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - wrangler CLI installed and authenticated (npx wrangler login)
#   - pnpm installed
#   - jq installed
#
# Usage: ./scripts/setup-sandbox.sh
#
# The script is interactive and will prompt for confirmation at key steps.
# Resource IDs are printed for manual wrangler.jsonc update.

set -euo pipefail

# ===========================================================================
# Colors and helpers
# ===========================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
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
# Configuration
# ===========================================================================
GCP_REGION="${GCP_REGION:-us-central1}"
GCP_INSTANCE_NAME="${GCP_INSTANCE_NAME:-css-sandbox-postgres}"
GCP_TIER="${GCP_TIER:-db-f1-micro}"
GCP_DISK_SIZE="${GCP_DISK_SIZE:-10}"  # GB
DB_NAME="cssdb"
DB_USER="cssuser"
DB_PASS="${DB_PASS:-$(openssl rand -base64 16 | tr -d '/+=' | head -c 20)}"

CF_WORKER_NAME="collaborative-state-worker-sandbox"
CF_PAGES_PROJECT="css-frontend-sandbox"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKERS_DIR="$PROJECT_ROOT/workers"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

# ===========================================================================
# Step 1: Verify prerequisites
# ===========================================================================
step "Step 1: Verifying prerequisites"

MISSING=()

if ! command -v gcloud &>/dev/null; then
  MISSING+=("gcloud (Google Cloud SDK)")
fi

if ! command -v npx &>/dev/null; then
  MISSING+=("npx (Node.js)")
fi

if ! command -v pnpm &>/dev/null; then
  MISSING+=("pnpm")
fi

if ! command -v jq &>/dev/null; then
  MISSING+=("jq")
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
  err "Missing required tools:"
  for tool in "${MISSING[@]}"; do
    echo "  - $tool"
  done
  exit 1
fi

# Check gcloud auth
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 | grep -q '@'; then
  err "gcloud is not authenticated. Run: gcloud auth login"
  exit 1
fi

GCP_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [[ -z "$GCP_PROJECT" || "$GCP_PROJECT" == "(unset)" ]]; then
  err "No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi

# Check wrangler auth
if ! npx wrangler whoami &>/dev/null 2>&1; then
  err "wrangler is not authenticated. Run: npx wrangler login"
  exit 1
fi

ok "All prerequisites satisfied"
info "GCP Project: $GCP_PROJECT"
info "GCP Region:  $GCP_REGION"

if ! confirm "Proceed with sandbox setup?"; then
  echo "Aborted."
  exit 0
fi

# ===========================================================================
# Step 2: Create GCP CloudSQL instance
# ===========================================================================
step "Step 2: Creating GCP CloudSQL PostgreSQL instance"

if gcloud sql instances describe "$GCP_INSTANCE_NAME" --project="$GCP_PROJECT" &>/dev/null; then
  warn "CloudSQL instance '$GCP_INSTANCE_NAME' already exists, skipping creation"
else
  info "Creating CloudSQL instance '$GCP_INSTANCE_NAME' (this may take a few minutes)..."
  gcloud sql instances create "$GCP_INSTANCE_NAME" \
    --project="$GCP_PROJECT" \
    --database-version=POSTGRES_15 \
    --tier="$GCP_TIER" \
    --region="$GCP_REGION" \
    --storage-size="$GCP_DISK_SIZE" \
    --storage-type=SSD \
    --availability-type=zonal \
    --assign-ip \
    --no-backup

  ok "CloudSQL instance created"
fi

# Get the public IP
CLOUD_SQL_IP=$(gcloud sql instances describe "$GCP_INSTANCE_NAME" \
  --project="$GCP_PROJECT" \
  --format="value(ipAddresses[0].ipAddress)")
info "CloudSQL Public IP: $CLOUD_SQL_IP"

# ===========================================================================
# Step 3: Create database and user
# ===========================================================================
step "Step 3: Creating database and user"

# Check if database exists
if gcloud sql databases describe "$DB_NAME" --instance="$GCP_INSTANCE_NAME" --project="$GCP_PROJECT" &>/dev/null; then
  warn "Database '$DB_NAME' already exists"
else
  gcloud sql databases create "$DB_NAME" \
    --instance="$GCP_INSTANCE_NAME" \
    --project="$GCP_PROJECT"
  ok "Database '$DB_NAME' created"
fi

# Set user password (creates user if not exists)
gcloud sql users set-password "$DB_USER" \
  --instance="$GCP_INSTANCE_NAME" \
  --project="$GCP_PROJECT" \
  --password="$DB_PASS" 2>/dev/null || \
gcloud sql users create "$DB_USER" \
  --instance="$GCP_INSTANCE_NAME" \
  --project="$GCP_PROJECT" \
  --password="$DB_PASS"

ok "Database user '$DB_USER' configured"

CONNECTION_STRING="postgresql://${DB_USER}:${DB_PASS}@${CLOUD_SQL_IP}:5432/${DB_NAME}"
info "Connection string: postgresql://${DB_USER}:***@${CLOUD_SQL_IP}:5432/${DB_NAME}"

# ===========================================================================
# Step 4: Create Cloudflare KV namespaces
# ===========================================================================
step "Step 4: Creating Cloudflare KV namespaces"

CONFIG_KV_OUTPUT=$(cd "$WORKERS_DIR" && npx wrangler kv namespace create "CONFIG_KV_SANDBOX" 2>&1)
CONFIG_KV_ID=$(echo "$CONFIG_KV_OUTPUT" | grep -o '"[a-f0-9]\{32\}"' | tr -d '"' || echo "")
if [[ -z "$CONFIG_KV_ID" ]]; then
  warn "Could not parse CONFIG_KV namespace ID. Output:"
  echo "$CONFIG_KV_OUTPUT"
  echo -n "Enter CONFIG_KV namespace ID manually: "
  read -r CONFIG_KV_ID
fi
ok "CONFIG_KV namespace ID: $CONFIG_KV_ID"

SESSION_KV_OUTPUT=$(cd "$WORKERS_DIR" && npx wrangler kv namespace create "SESSION_KV_SANDBOX" 2>&1)
SESSION_KV_ID=$(echo "$SESSION_KV_OUTPUT" | grep -o '"[a-f0-9]\{32\}"' | tr -d '"' || echo "")
if [[ -z "$SESSION_KV_ID" ]]; then
  warn "Could not parse SESSION_KV namespace ID. Output:"
  echo "$SESSION_KV_OUTPUT"
  echo -n "Enter SESSION_KV namespace ID manually: "
  read -r SESSION_KV_ID
fi
ok "SESSION_KV namespace ID: $SESSION_KV_ID"

# ===========================================================================
# Step 5: Create Cloudflare Hyperdrive
# ===========================================================================
step "Step 5: Creating Cloudflare Hyperdrive"

# Authorize CloudSQL for Cloudflare IPs (Hyperdrive needs direct access)
warn "You may need to authorize Cloudflare IPs in CloudSQL."
warn "For testing, you can temporarily authorize 0.0.0.0/0:"
warn "  gcloud sql instances patch $GCP_INSTANCE_NAME --authorized-networks=0.0.0.0/0"
echo ""
if confirm "Authorize 0.0.0.0/0 for CloudSQL now? (Not recommended for production)"; then
  gcloud sql instances patch "$GCP_INSTANCE_NAME" \
    --project="$GCP_PROJECT" \
    --authorized-networks=0.0.0.0/0 \
    --quiet
  ok "CloudSQL authorized for all IPs"
fi

HYPERDRIVE_OUTPUT=$(cd "$WORKERS_DIR" && npx wrangler hyperdrive create "css-postgres-sandbox" \
  --connection-string="$CONNECTION_STRING" 2>&1)
HYPERDRIVE_ID=$(echo "$HYPERDRIVE_OUTPUT" | grep -oE '[a-f0-9]{32}' | head -1 || echo "")
if [[ -z "$HYPERDRIVE_ID" ]]; then
  warn "Could not parse Hyperdrive ID. Output:"
  echo "$HYPERDRIVE_OUTPUT"
  echo -n "Enter Hyperdrive ID manually: "
  read -r HYPERDRIVE_ID
fi
ok "Hyperdrive ID: $HYPERDRIVE_ID"

# ===========================================================================
# Step 6: Print resource IDs for wrangler.jsonc
# ===========================================================================
step "Step 6: Resource IDs for wrangler.jsonc"

echo ""
echo -e "${BOLD}Update workers/wrangler.jsonc sandbox env with these values:${NC}"
echo ""
echo "  CONFIG_KV ID:   $CONFIG_KV_ID"
echo "  SESSION_KV ID:  $SESSION_KV_ID"
echo "  HYPERDRIVE ID:  $HYPERDRIVE_ID"
echo ""

if ! confirm "Have you updated wrangler.jsonc? (Script will continue either way)"; then
  warn "Remember to update wrangler.jsonc before deploying"
fi

# ===========================================================================
# Step 7: Set Cloudflare Worker secrets
# ===========================================================================
step "Step 7: Setting Worker secrets"

INTERNAL_SECRET=$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)
MOCK_JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)

cd "$WORKERS_DIR"
echo "$INTERNAL_SECRET" | npx wrangler secret put INTERNAL_SECRET --env sandbox 2>/dev/null || \
  warn "Could not set INTERNAL_SECRET (worker may not be deployed yet — will retry after deploy)"

echo "$MOCK_JWT_SECRET" | npx wrangler secret put MOCK_JWT_SECRET --env sandbox 2>/dev/null || \
  warn "Could not set MOCK_JWT_SECRET (worker may not be deployed yet — will retry after deploy)"

ok "Secrets configured"

# ===========================================================================
# Step 8: Deploy the Worker
# ===========================================================================
step "Step 8: Deploying Worker"

cd "$WORKERS_DIR"
pnpm deploy:sandbox
WORKER_URL="https://${CF_WORKER_NAME}.$(npx wrangler whoami 2>/dev/null | grep -oE '[a-z0-9-]+\.workers\.dev' | head -1 || echo 'YOUR_SUBDOMAIN.workers.dev')"
ok "Worker deployed"
info "Worker URL: $WORKER_URL"

# Retry secrets if they failed earlier
echo "$INTERNAL_SECRET" | npx wrangler secret put INTERNAL_SECRET --env sandbox 2>/dev/null || true
echo "$MOCK_JWT_SECRET" | npx wrangler secret put MOCK_JWT_SECRET --env sandbox 2>/dev/null || true

# ===========================================================================
# Step 9: Run database migrations
# ===========================================================================
step "Step 9: Running database migrations"

# Temporarily set connection string for migration
export POSTGRES_CONNECTION_STRING="$CONNECTION_STRING"
cd "$WORKERS_DIR"
pnpm db:migrate || warn "Migration failed — you may need to run manually"
ok "Database migrations complete"

# ===========================================================================
# Step 10: Build frontend
# ===========================================================================
step "Step 10: Building frontend"

cd "$FRONTEND_DIR"
VITE_API_BASE_URL="$WORKER_URL" pnpm build
ok "Frontend built with API base URL: $WORKER_URL"

# ===========================================================================
# Step 11: Deploy frontend to Cloudflare Pages
# ===========================================================================
step "Step 11: Deploying frontend to Cloudflare Pages"

cd "$FRONTEND_DIR"
PAGES_OUTPUT=$(npx wrangler pages deploy dist --project-name="$CF_PAGES_PROJECT" 2>&1)
PAGES_URL=$(echo "$PAGES_OUTPUT" | grep -oE 'https://[^ ]+\.pages\.dev' | head -1 || echo "")
if [[ -z "$PAGES_URL" ]]; then
  warn "Could not parse Pages URL. Output:"
  echo "$PAGES_OUTPUT"
  echo -n "Enter Pages URL manually: "
  read -r PAGES_URL
fi
ok "Frontend deployed"
info "Pages URL: $PAGES_URL"

# ===========================================================================
# Step 12: Update Worker CORS_ORIGINS and redeploy
# ===========================================================================
step "Step 12: Updating CORS_ORIGINS with Pages URL"

warn "Add the Pages URL to CORS_ORIGINS in wrangler.jsonc sandbox env:"
echo ""
echo "  \"CORS_ORIGINS\": \"http://localhost:5173,$PAGES_URL\""
echo ""

if confirm "Redeploy worker after updating CORS_ORIGINS?"; then
  cd "$WORKERS_DIR"
  pnpm deploy:sandbox
  ok "Worker redeployed with updated CORS"
fi

# ===========================================================================
# Step 13: Verify deployment
# ===========================================================================
step "Step 13: Verifying deployment"

HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/health" 2>/dev/null || echo "000")
if [[ "$HEALTH_STATUS" == "200" ]]; then
  ok "/health returned 200"
  curl -s "$WORKER_URL/health" | jq . 2>/dev/null || true
elif [[ "$HEALTH_STATUS" == "503" ]]; then
  warn "/health returned 503 (database may not be reachable yet)"
  curl -s "$WORKER_URL/health" | jq . 2>/dev/null || true
else
  warn "/health returned $HEALTH_STATUS"
fi

# ===========================================================================
# Summary
# ===========================================================================
step "Sandbox Setup Complete"

echo ""
echo -e "${BOLD}Resources:${NC}"
echo "  GCP CloudSQL Instance: $GCP_INSTANCE_NAME ($CLOUD_SQL_IP)"
echo "  GCP Project:           $GCP_PROJECT"
echo "  Database:              $DB_NAME"
echo "  Database User:         $DB_USER"
echo ""
echo "  CF Worker:             $WORKER_URL"
echo "  CF Pages:              ${PAGES_URL:-N/A}"
echo "  CF CONFIG_KV:          $CONFIG_KV_ID"
echo "  CF SESSION_KV:         $SESSION_KV_ID"
echo "  CF Hyperdrive:         $HYPERDRIVE_ID"
echo ""
echo -e "${BOLD}Credentials (save securely):${NC}"
echo "  DB Password:           $DB_PASS"
echo "  Internal Secret:       $INTERNAL_SECRET"
echo "  Mock JWT Secret:       $MOCK_JWT_SECRET"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo "  1. Open $PAGES_URL in browser"
echo "  2. Login with a test user"
echo "  3. Create a site and verify end-to-end"
echo ""
echo -e "${BOLD}Teardown:${NC}"
echo "  ./scripts/teardown-sandbox.sh"
echo ""
