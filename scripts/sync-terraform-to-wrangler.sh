#!/usr/bin/env bash
# sync-terraform-to-wrangler.sh
#
# Reads Terraform outputs and patches placeholder IDs in wrangler.jsonc.
# This bridges Terraform-managed infrastructure with wrangler-managed deployments.
#
# Usage:
#   ./scripts/sync-terraform-to-wrangler.sh <environment>
#   make tf-sync ENV=sbx1
#
# Prerequisites:
#   - Terraform initialized and applied for the target environment
#   - jq installed

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Supported environments and their wrangler placeholder prefixes
declare -A ENV_PREFIXES=(
  [sbx1]="SBX1"
  [production]="PROD"
  [cpub-staging]="CPUB_STAGING"
)

# Validate arguments
ENV="${1:-}"
VALID_ENVS=$(IFS="|"; echo "${!ENV_PREFIXES[*]}")

if [[ -z "$ENV" ]]; then
  echo -e "${RED}Error: Environment required. Usage: $0 <${VALID_ENVS}>${NC}"
  exit 1
fi

if [[ -z "${ENV_PREFIXES[$ENV]+x}" ]]; then
  echo -e "${RED}Error: Unknown environment '${ENV}'. Valid: ${VALID_ENVS}${NC}"
  exit 1
fi

# Check dependencies
if ! command -v jq &> /dev/null; then
  echo -e "${RED}Error: jq is required but not installed.${NC}"
  exit 1
fi

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TF_DIR="${PROJECT_ROOT}/terraform/environments/${ENV}"
WRANGLER_FILE="${PROJECT_ROOT}/workers/wrangler.jsonc"

if [[ ! -d "$TF_DIR" ]]; then
  echo -e "${RED}Error: Terraform directory not found: ${TF_DIR}${NC}"
  exit 1
fi

if [[ ! -f "$WRANGLER_FILE" ]]; then
  echo -e "${RED}Error: wrangler.jsonc not found: ${WRANGLER_FILE}${NC}"
  exit 1
fi

echo -e "${BLUE}Syncing Terraform outputs (${ENV}) to wrangler.jsonc...${NC}"

# Get Terraform outputs as JSON
cd "$TF_DIR"
TF_OUTPUT=$(terraform output -json 2>/dev/null) || {
  echo -e "${RED}Error: Failed to read Terraform outputs. Is Terraform initialized and applied?${NC}"
  exit 1
}

# Extract values
CONFIG_KV_ID=$(echo "$TF_OUTPUT" | jq -r '.config_kv_id.value // empty')
SESSION_KV_ID=$(echo "$TF_OUTPUT" | jq -r '.session_kv_id.value // empty')
HYPERDRIVE_ID=$(echo "$TF_OUTPUT" | jq -r '.hyperdrive_id.value // empty')

# Validate we got values
MISSING=()
[[ -z "$CONFIG_KV_ID" ]] && MISSING+=("config_kv_id")
[[ -z "$SESSION_KV_ID" ]] && MISSING+=("session_kv_id")
[[ -z "$HYPERDRIVE_ID" ]] && MISSING+=("hyperdrive_id")

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo -e "${RED}Error: Missing Terraform outputs: ${MISSING[*]}${NC}"
  echo -e "${YELLOW}Run 'make tf-apply ENV=${ENV}' first.${NC}"
  exit 1
fi

# Map environment to wrangler placeholder prefix
PLACEHOLDER_PREFIX="${ENV_PREFIXES[$ENV]}"

echo -e "  CONFIG_KV_ID:  ${GREEN}${CONFIG_KV_ID}${NC}"
echo -e "  SESSION_KV_ID: ${GREEN}${SESSION_KV_ID}${NC}"
echo -e "  HYPERDRIVE_ID: ${GREEN}${HYPERDRIVE_ID}${NC}"

# Patch wrangler.jsonc using sed
# These replacements target the REPLACE_WITH_*_*_ID placeholders
cd "$PROJECT_ROOT"

sed -i.bak \
  -e "s/REPLACE_WITH_${PLACEHOLDER_PREFIX}_CONFIG_KV_ID/${CONFIG_KV_ID}/g" \
  -e "s/REPLACE_WITH_${PLACEHOLDER_PREFIX}_SESSION_KV_ID/${SESSION_KV_ID}/g" \
  -e "s/REPLACE_WITH_${PLACEHOLDER_PREFIX}_HYPERDRIVE_ID/${HYPERDRIVE_ID}/g" \
  "$WRANGLER_FILE"

rm -f "${WRANGLER_FILE}.bak"

echo ""
echo -e "${GREEN}Successfully synced ${ENV} Terraform outputs to wrangler.jsonc${NC}"
echo -e "${YELLOW}Review the changes and commit when ready.${NC}"
