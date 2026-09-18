# Friday Shadow Connection V1

Status: local/mock plumbing only. This runbook does **not** authorize connecting
real Kai, changing Stuart’s Mac, changing Chatwoot, connecting real Woo,
exposing Chameleon publicly, or enabling execution.

Use this sequence tomorrow after the production-shaped package from
`docs/runbooks/FRIDAY-PRODUCTION-INSTALL-V1.md` is installed on the approved
Hetzner host. Keep Chameleon’s API loopback-only.

## Day-one path

```
existing Mac Chatwoot bridge
  → localhost forwarded port
  → existing SSH local forward
  → Hetzner 127.0.0.1 Chameleon API  POST /api/v2/ingest/chatwoot-shadow
  → verified Woo/order context (read-only)
  → support-standard-v1
  → existing Mac OpenClaw  POST /v1/support/reason
  → Chameleon decision / case / dashboard
  → NO_EXECUTION  (no Chatwoot reply)
```

Do not add Tailscale, a second OpenClaw install, a public Chameleon ingress, or
a direct Chatwoot webhook. The existing Mac bridge remains the Chatwoot
transport boundary. The existing Cloudflare path is only for the Mac support
reasoning route, via an explicit hostname allowlist.

## 1. Install Chameleon

Follow `docs/runbooks/FRIDAY-PRODUCTION-INSTALL-V1.md` section 1. Twenty is not
required for support-shadow. Leave `TWENTY_PROJECTION_ENABLED=false` unless a
later task re-enables the CRM projection.

## 2. Verify health / auth

```bash
curl --fail --silent --show-error "http://127.0.0.1:${FRIDAY_API_PORT:-19600}/api/v2/health"
curl --fail --silent --show-error "http://127.0.0.1:${FRIDAY_API_PORT:-19600}/api/v2/runtime"
```

Expect `execution: NO_EXECUTION`, `support_ingress.mode: shadow`,
`twenty_projection: disabled` unless Twenty was explicitly re-enabled, and
`shadow_ingress.enabled: false` until step 7.

## 3. Enable Woo read-only

Follow `docs/runbooks/FRIDAY-PRODUCTION-INSTALL-V1.md` section 2. Recreate only
the API after adding the protected Woo GET credentials. Confirm
`/api/v2/job-health` for `woo-read-only-shadow`. This is read-only; it does not
prove a write.

## 4. Establish existing SSH localhost transport from the Mac

Do not change launchd/autossh tonight. Tomorrow, on the Mac, use the **existing**
approved SSH identity/alias already used for Hetzner Command Center access.
Replace only the alias; do not put secrets in the command:

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:${FRIDAY_API_PORT:-19600}:127.0.0.1:${FRIDAY_API_PORT:-19600} \
  <existing-hetzner-ssh-alias>
```

Preflight, from the Mac, while the tunnel is up:

```bash
curl --fail --silent --show-error "http://127.0.0.1:${FRIDAY_API_PORT:-19600}/api/v2/health"
curl --fail --silent --show-error "http://127.0.0.1:${FRIDAY_API_PORT:-19600}/api/v2/runtime"
```

Smoke: a missing/wrong bearer to `/api/v2/ingest/chatwoot-shadow` must return
`401 CHATWOOT_BRIDGE_UNAUTHENTICATED` (or `403` if shadow is still disabled).
The synthetic LAB route `/api/v2/ingest/chatwoot` must remain `403 SYNTHETIC_ONLY`.

Stop / rollback the tunnel:

```bash
# foreground: Ctrl-C
# or, if backgrounded:
kill <ssh-local-forward-pid>
```

The API bind stays `127.0.0.1`. No public ingress is opened.

## 5. Add / verify Mac `POST /v1/support/reason`

Inspect the **existing** Mac support bridge. Add the reasoning-only route from
`docs/runbooks/KAI-SUPPORT-SHADOW-INSTALL-V1.md`. Do not grant Chatwoot reply,
Woo mutation, refund, replacement, label, SMS, email, or unrestricted tools.

## 6. Configure the explicit OpenClaw endpoint

Add only these values to the protected environment file, then recreate the API.
Do not hard-code a hostname in Git. For the existing Cloudflare → Mac support
bridge, list that exact hostname; HTTP and wildcards are rejected:

```text
CHAMELEON_SUPPORT_AGENT_PROVIDER=openclaw
CHAMELEON_SUPPORT_AGENT_BASE_URL=https://<reviewed-support-bridge-hostname>
CHAMELEON_SUPPORT_AGENT_TOKEN=<runtime-only token>
CHAMELEON_SUPPORT_AGENT_TIMEOUT_MS=12000
CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS=<exact-hostname>
SUPPORT_MODE=shadow
```

Private loopback/RFC1918 origins remain allowed without the allowlist. Public
hosts require HTTPS, an exact allowlist match, and a token. Recreate only the
API and confirm `/api/v2/runtime` shows `provider: openclaw`,
`endpoint_configured: true`, `authorization: false`, `execution: NO_EXECUTION`.

## 7. Enable Mac bridge shadow forwarding

Keep the route off the public internet. Add to the protected environment:

```text
CHAMELEON_CHATWOOT_SHADOW_ENABLED=true
CHAMELEON_CHATWOOT_BRIDGE_TOKEN=<runtime-only bridge token>
```

Recreate only the API. The Mac bridge should POST a duplicate of the existing
Chatwoot event to `http://127.0.0.1:${FRIDAY_API_PORT:-19600}/api/v2/ingest/chatwoot-shadow`
through the SSH local forward, with `Authorization: Bearer <bridge token>`.
Chameleon stamps source authentication itself and ignores caller-supplied
`sourceAuth`.

## 8. Run one synthetic shadow case

Send one non-customer fixture through the Mac bridge duplicate path. Confirm a
new case, decision packet, and `execution: NO_EXECUTION`. Replay the same source
event and confirm duplicate retention.

## 9. Observe one real case

Leave live Chatwoot/Kai handling unchanged. Observe the shadow copy in
Chameleon dashboard/API only.

## 10. Verify existing live support unchanged

The customer still receives the existing Mac/Chatwoot reply. Chameleon must not
send a Chatwoot message. `/api/v2/runtime` outbound/shadow remains disabled for
replies.

## 11. Verify NO_EXECUTION

`/api/v2/health` and `/api/v2/runtime` still report `execution: NO_EXECUTION`.
No Woo mutation, refund, replacement, label, SMS, or email is issued.

## Egress boundary

Friday Compose attaches the API to `ops-egress` so it can make approved outbound
HTTPS calls (Woo GET, configured support-worker URL). `db` and `dashboard` stay
off that network. API and dashboard remain published only on `127.0.0.1`.
Application code still rejects unapproved URLs. Remaining tomorrow control: the
host firewall/egress policy for those reviewed destinations. This is not a
generic egress platform.

## Rollback

1. Set `CHAMELEON_CHATWOOT_SHADOW_ENABLED=false` and recreate the API.
2. Set `CHAMELEON_SUPPORT_AGENT_PROVIDER=disabled` or restore Ollama.
3. Stop the SSH local forward.
4. Leave Woo shadow disabled if that gate was not approved.
5. Confirm live Chatwoot/Kai still operate on the existing Mac path.
