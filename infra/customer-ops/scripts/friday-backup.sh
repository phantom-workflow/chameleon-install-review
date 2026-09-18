#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${ENV_FILE:?Set ENV_FILE to a protected, mode-600 environment file}"
: "${COMPOSE_FILE:?Set COMPOSE_FILE to docker-compose.friday-v1.yml}"
: "${BACKUP_DIR:?Set BACKUP_DIR to a new, narrow backup directory}"
: "${FRIDAY_DB_NAME:?Set FRIDAY_DB_NAME from the protected environment}"
: "${FRIDAY_DB_USER:?Set FRIDAY_DB_USER from the protected environment}"
test -r "$ENV_FILE"
test ! -e "$BACKUP_DIR"
mkdir -p -- "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db pg_dump -Fc -U "$FRIDAY_DB_USER" -d "$FRIDAY_DB_NAME" > "$BACKUP_DIR/operations.custom.dump"
sha256sum "$BACKUP_DIR/operations.custom.dump" > "$BACKUP_DIR/SHA256SUMS"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api sh -c 'printf "git_sha=%s\nbuild_id=%s\nbuild_timestamp=%s\n" "$APP_GIT_SHA" "$APP_BUILD_ID" "$APP_BUILD_TIMESTAMP"' > "$BACKUP_DIR/build-identity.txt"
chmod 600 "$BACKUP_DIR/operations.custom.dump" "$BACKUP_DIR/SHA256SUMS" "$BACKUP_DIR/build-identity.txt"
printf '%s\n' "backup_created=$BACKUP_DIR/operations.custom.dump"
