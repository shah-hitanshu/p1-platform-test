#!/usr/bin/env bash
# wait-for-services.sh
#
# Waits for Docker services to be healthy before proceeding.
# Used by `make docker-up` to ensure services are ready.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Configuration
MAX_RETRIES=30
RETRY_INTERVAL=2

# Services to check
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
FIRESTORE_HOST="${FIRESTORE_HOST:-localhost}"
FIRESTORE_PORT="${FIRESTORE_PORT:-8080}"

echo -e "${YELLOW}Waiting for services to be ready...${NC}"

# Function to check PostgreSQL
check_postgres() {
    pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -q 2>/dev/null
}

# Function to check Firestore emulator
check_firestore() {
    curl -s -o /dev/null -w "%{http_code}" "http://${FIRESTORE_HOST}:${FIRESTORE_PORT}/" 2>/dev/null | grep -q "200\|404"
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

# Wait for Firestore emulator
echo -n "  Firestore ($FIRESTORE_HOST:$FIRESTORE_PORT): "
retries=0
while ! check_firestore; do
    retries=$((retries + 1))
    if [ $retries -ge $MAX_RETRIES ]; then
        echo -e "${RED}FAILED${NC}"
        echo -e "${RED}Error: Firestore emulator did not become ready in time${NC}"
        exit 1
    fi
    sleep $RETRY_INTERVAL
done
echo -e "${GREEN}ready${NC}"

echo -e "${GREEN}All services are ready!${NC}"
