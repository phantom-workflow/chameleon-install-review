#!/usr/bin/env bash
set -euo pipefail

: "${ENV_FILE:?Set ENV_FILE to a protected environment file}"
: "${COMPOSE_FILE:?Set COMPOSE_FILE to docker-compose.friday-v1.yml}"
: "${FRIDAY_API_IMAGE:?Set FRIDAY_API_IMAGE to the previously verified immutable API image}"
: "${FRIDAY_DASHBOARD_IMAGE:?Set FRIDAY_DASHBOARD_IMAGE to the previously verified immutable dashboard image}"
: "${FRIDAY_ROLLBACK_GIT_SHA:?Set FRIDAY_ROLLBACK_GIT_SHA to the verified image source SHA}"
: "${FRIDAY_ROLLBACK_BUILD_ID:?Set FRIDAY_ROLLBACK_BUILD_ID to the verified image build identity}"
: "${FRIDAY_ROLLBACK_BUILD_TIMESTAMP:?Set FRIDAY_ROLLBACK_BUILD_TIMESTAMP to the verified image build timestamp}"
test -r "$ENV_FILE"
FRIDAY_API_IMAGE="$FRIDAY_API_IMAGE" FRIDAY_DASHBOARD_IMAGE="$FRIDAY_DASHBOARD_IMAGE" APP_GIT_SHA="$FRIDAY_ROLLBACK_GIT_SHA" APP_BUILD_ID="$FRIDAY_ROLLBACK_BUILD_ID" APP_BUILD_TIMESTAMP="$FRIDAY_ROLLBACK_BUILD_TIMESTAMP" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build --no-deps api dashboard
for attempt in $(seq 1 30); do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api node -e "fetch('http://127.0.0.1:8080/api/v2/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T dashboard node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    break
  fi
  if [ "$attempt" = 30 ]; then
    echo 'rollback health checks did not become ready' >&2
    exit 1
  fi
  sleep 1
done
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e EXPECTED_GIT_SHA="$FRIDAY_ROLLBACK_GIT_SHA" -e EXPECTED_BUILD_ID="$FRIDAY_ROLLBACK_BUILD_ID" -e EXPECTED_BUILD_TIMESTAMP="$FRIDAY_ROLLBACK_BUILD_TIMESTAMP" api node --input-type=module -e 'const expected={git_sha:process.env.EXPECTED_GIT_SHA,build_id:process.env.EXPECTED_BUILD_ID,build_timestamp:process.env.EXPECTED_BUILD_TIMESTAMP}; const r=await fetch("http://127.0.0.1:8080/api/v2/health"); const body=await r.json(); const runtime=body.runtime||{}; if(!r.ok || runtime.git_sha!==expected.git_sha || runtime.build_id!==expected.build_id || runtime.build_timestamp!==expected.build_timestamp) process.exit(1); process.exit(0)'
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e EXPECTED_GIT_SHA="$FRIDAY_ROLLBACK_GIT_SHA" -e EXPECTED_BUILD_ID="$FRIDAY_ROLLBACK_BUILD_ID" -e EXPECTED_BUILD_TIMESTAMP="$FRIDAY_ROLLBACK_BUILD_TIMESTAMP" dashboard node --input-type=module -e 'const expected={git_sha:process.env.EXPECTED_GIT_SHA,build_id:process.env.EXPECTED_BUILD_ID,build_timestamp:process.env.EXPECTED_BUILD_TIMESTAMP}; const r=await fetch("http://127.0.0.1:3000/api/health"); const body=await r.json(); const runtime=body.runtime||{}; if(!r.ok || body.status!=="ok" || runtime.git_sha!==expected.git_sha || runtime.build_id!==expected.build_id || runtime.build_timestamp!==expected.build_timestamp) process.exit(1); process.exit(0)'
printf '%s\n' "rollback_verified_api_image=$FRIDAY_API_IMAGE" "rollback_verified_dashboard_image=$FRIDAY_DASHBOARD_IMAGE"
