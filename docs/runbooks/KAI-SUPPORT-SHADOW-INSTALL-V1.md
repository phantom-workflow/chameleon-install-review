# Kai Support Shadow Install V1

Status: Chameleon-side OpenClaw provider seam is ready. This runbook does **not**
authorize connecting to real Kai, modifying Stuart’s Mac, changing Chatwoot,
adding Tailscale, installing OpenClaw, or enabling execution.

Starting/verified Standard Support Playbook V1 baseline SHA:
`4187b02e191f358622d3cd53680d482f2304a126`

## Architecture

```
Chatwoot-shaped ingress (shadow)
  → Chameleon case context (identity, Woo order/tracking, knowledge, playbook)
  → support-agent adapter
       ├─ ollama  POST {BASE_URL}/api/chat
       └─ openclaw POST {BASE_URL}/v1/support/reason
  → provider-neutral 7-field decision
  → existing routing / persistence / Human Work / approvals / dashboard / audit
```

Chameleon remains the workflow and execution authority. OpenClaw is
reasoning-only. `SUPPORT_MODE=shadow` and `NO_EXECUTION` stay in force: a valid
decision still cannot send a customer message, mutate Woo, refund, replace,
reship, buy a label, or send SMS/email.

## Chameleon configuration

Do not hard-code a production URL. Preserve the Ollama provider.

```text
CHAMELEON_SUPPORT_AGENT_PROVIDER=openclaw
CHAMELEON_SUPPORT_AGENT_BASE_URL=http://127.0.0.1:<private-port>
CHAMELEON_SUPPORT_AGENT_TOKEN=<runtime-only token>
SUPPORT_MODE=shadow
```

Optional, already supported:

```text
CHAMELEON_SUPPORT_AGENT_TIMEOUT_MS=12000
CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS=<exact-hostname>
```

`BASE_URL` must have no path and no credentials. Default destinations are
private HTTP(S) origins only (loopback, RFC1918, or CGNAT `100.64.0.0/10`).
Unknown/public destinations are rejected unless
`CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS` contains that exact hostname and the
URL is HTTPS. Wildcards, credentialed URLs, and HTTP public hosts fail closed.
The token is sent as `Authorization: Bearer …` and must not be committed or
logged.

Do not hard-code a production hostname in Git. Leave
`CHAMELEON_SUPPORT_AGENT_PROVIDER=ollama` to keep today’s Qwen path, or
`disabled` for fail-closed Friday defaults.

Mac → Chameleon transport, shadow ingress, and the mechanical Friday sequence
are in `docs/runbooks/FRIDAY-SHADOW-CONNECTION-V1.md`.

## Expected Mac-side route contract

Unverified on the Mac tonight. Kai must inspect the **existing** support
bridge tomorrow and add this reasoning-only route there. Do not create a new
OpenClaw install. No OpenClaw CLI or Mac config commands are specified here
because they have not been verified.

**Route:** `POST /v1/support/reason`
**Auth:** `Authorization: Bearer ${CHAMELEON_SUPPORT_AGENT_TOKEN}`
**Content-Type:** `application/json`

### Input

```json
{
  "playbook_version": "support-standard-v1",
  "profile": "STANDARD",
  "customer_message": "<bounded customer text>",
  "verified_context": {
    "customer": {"resolved": true, "identity_method": "exact", "matched_fields": ["email"]},
    "order": {"order_number": "6276", "status": "processing", "fulfillment_state": "processing", "items": [], "refund_state": "NONE", "source": "woocommerce"},
    "tracking": {"state": "MISSING", "trustworthy": true, "reason": "..."}
  },
  "history_summary": "<compact relevant history, or null>",
  "approved_support_knowledge": {"id": "kb-support-core", "status": "approved", "playbook": "support-standard-v1"},
  "constraints": {
    "reasoning_only": true,
    "execution": "NO_EXECUTION",
    "forbidden": [
      "chatwoot_reply",
      "conversation_pause",
      "conversation_resume",
      "woo_mutation",
      "refund",
      "replace",
      "reship",
      "label",
      "sms",
      "email",
      "unrestricted_tools"
    ]
  }
}
```

The Mac route must use only this packet. It must **not** post Chatwoot replies,
pause/resume conversations, mutate Woo, refund, replace/reship, buy labels,
send SMS/email, or expose unrestricted Kai tools.

### Output

Return one JSON object (no chain-of-thought). `FAILED_AUTOMATION` is
Chameleon-owned and must not be returned by a healthy worker.

```json
{
  "classification": "...",
  "disposition": "AUTO_REPLY|WAITING_CUSTOMER|HUMAN_WORK|APPROVAL_REQUIRED",
  "reason": "...",
  "confidence": 0.0,
  "draft": "...",
  "missing_information": "...",
  "proposed_action": "..."
}
```

## Synthetic health test (no real Kai)

Loopback fixture only: `tests/fixtures/openclaw-shadow-worker.mjs`.

```bash
node tests/fixtures/openclaw-shadow-worker.mjs
# READY on 127.0.0.1:18798

curl -sS http://127.0.0.1:18798/health
# {"status":"READY","reasoning_only":true,"execution":"NO_EXECUTION",...}

curl -sS http://127.0.0.1:18798/v1/support/reason \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer lab-openclaw-shadow-token' \
  -d '{"playbook_version":"support-standard-v1","profile":"STANDARD","customer_message":"Where is my order?"}'
```

## Acceptance test

```bash
node tests/support-agent-adapter.mjs
node tests/openclaw-shadow-adapter.mjs
```

Required results: OpenClaw provider, 7-field contract, mock `AUTO_REPLY`,
`WAITING_CUSTOMER`, `HUMAN_WORK`, `APPROVAL_REQUIRED`, malformed/timeout →
Chameleon `FAILED_AUTOMATION`, and `SUPPORT_MODE=shadow` / `NO_EXECUTION`.

## NO_EXECUTION / shadow requirements

- Do not point `CHAMELEON_SUPPORT_AGENT_BASE_URL` at a live Kai host until Matt
  approves tomorrow’s connect step.
- Do not change `SUPPORT_MODE` away from `shadow`.
- Do not grant the Mac route any tool that can act.
- Adapter `authorization` remains `false`; recommendations are advisory.

## Rollback

1. Set `CHAMELEON_SUPPORT_AGENT_PROVIDER=ollama` (or `disabled`).
2. Restore the previous Ollama `CHAMELEON_SUPPORT_AGENT_BASE_URL` / model.
3. Unset `CHAMELEON_SUPPORT_AGENT_TOKEN`.
4. Restart the Chameleon API.
5. Confirm `/api/v2/health` still reports `execution: NO_EXECUTION`.

No database migration is required. Case, Human Work, approval, dashboard, and
audit contracts are unchanged.

## Tomorrow — Kai step (after inspecting the existing support bridge)

1. Inspect the current Mac support bridge. Do not replace it.
2. Add `POST /v1/support/reason` as a reasoning-only handler on that bridge.
3. Return only the seven-field JSON above.
4. Give Chameleon a private `BASE_URL` **or** one reviewed HTTPS hostname in
   `CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS`, plus a runtime token.
5. Establish the existing SSH localhost forward from the Mac to Hetzner
   `127.0.0.1` as documented in `docs/runbooks/FRIDAY-SHADOW-CONNECTION-V1.md`.
   Do not expose Chameleon publicly.
6. Run the synthetic health test against the Mac route, then one shadow case
   through `POST /api/v2/ingest/chatwoot-shadow`.
7. Stop if the route can execute, talk to Chatwoot/Woo, or expose extra tools.
