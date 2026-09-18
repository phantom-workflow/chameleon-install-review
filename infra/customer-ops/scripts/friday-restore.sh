#!/usr/bin/env bash
set -euo pipefail

: "${ENV_FILE:?Set ENV_FILE to a protected, mode-600 environment file}"
: "${COMPOSE_FILE:?Set COMPOSE_FILE to docker-compose.friday-v1.yml}"
: "${BACKUP_FILE:?Set BACKUP_FILE to one exact custom-format dump}"
: "${CONFIRM_RESTORE:?Set CONFIRM_RESTORE=YES only after checking the target and backup hash}"
: "${FRIDAY_DB_NAME:?Set FRIDAY_DB_NAME from the protected environment}"
: "${FRIDAY_DB_USER:?Set FRIDAY_DB_USER from the protected environment}"
test "$CONFIRM_RESTORE" = YES
test -r "$ENV_FILE"
test -f "$BACKUP_FILE"
sha256sum --check "${BACKUP_FILE%/*}/SHA256SUMS"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop dashboard api
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db pg_restore --clean --if-exists --no-owner -U "$FRIDAY_DB_USER" -d "$FRIDAY_DB_NAME" < "$BACKUP_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api dashboard
printf '%s\n' 'restore_completed=verify_api_and_dashboard_health_before_reopening_access'
