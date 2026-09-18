#!/usr/bin/env bash
set -euo pipefail

: "${ENV_FILE:?Set ENV_FILE to a protected, mode-600 environment file}"
: "${COMPOSE_FILE:?Set COMPOSE_FILE to infra/customer-ops/docker-compose.friday-v1.yml}"
test -r "$ENV_FILE"
test -f "$COMPOSE_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
