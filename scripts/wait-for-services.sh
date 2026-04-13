#!/usr/bin/env bash
# wait-for-services.sh
#
# Waits for container services to be healthy before proceeding.
# Used by `make docker-up` to ensure services are ready.
#
# Supports both Docker and Podman via the CONTAINER_ENGINE env var.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Container runtime (passed from Makefile, defaults to docker)
CONTAINER_ENGINE="${CONTAINER_ENGINE:-docker}"

# Configuration
MAX_RETRIES=30
RETRY_INTERVAL=2

# Services to check
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

echo -e "${YELLOW}Waiting for services to be ready...${NC}"

# Function to check PostgreSQL (runs inside container to avoid needing local pg_isready)
check_postgres() {
    $CONTAINER_ENGINE exec css-postgres pg_isready -U cssuser -d cssdb -q 2>/dev/null
}

# Wait for PostgreSQL
echo -n "  PostgreSQL ($POSTGRES_HOST:$POSTGRES_PORT): "
retries=0
while ! check_postgres; do
    retries=$((retries + 1))
    if [ $retries -ge $MAX_RETRIES ]; then
        echo -e "${RED}FAILED${NC}"
        echo -e "${RED}Error: PostgreSQL did not become ready in time${NC}"
        exit 1
    fi
    sleep $RETRY_INTERVAL
done
echo -e "${GREEN}ready${NC}"

echo -e "${GREEN}All services are ready!${NC}"
