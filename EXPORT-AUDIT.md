# Public Export Audit

## Result

**PASS for public code review.**

This result applies to the current public repository contents. It does **not** mean the final install package is complete; the corrected bundled-Twenty Compose/resource envelope remains a pre-install gate.

## Source coverage

Current Operations application snapshot:

`phantom-workflow/chameleon-operations@9d8980e915c8651cc25031cda147836deb908812`

Public review includes:

- Operations API source and migrations;
- Operations dashboard/BFF source;
- access control and admin bootstrap;
- Human Work/support routing;
- Chatwoot shadow ingress/pipeline;
- Woo read-only shadow worker;
- support-agent/OpenClaw adapter boundary;
- Twenty adapter/projection;
- Twenty provisioning tool and manifest;
- production runtime/shadow tests;
- shadow connection runbooks;
- production-shaped Dockerfiles and backup/restore/rollback scripts.

## Export scan

Public files were inspected for common high-risk patterns including:

- private-key headers;
- GitHub token formats;
- AWS access-key formats;
- live Stripe secret-key format;
- Twilio Account SID format;
- JWT-shaped literals;
- non-test email addresses;
- US phone literals.

Findings requiring review:

- `apps/api/src/server-v2.js` — `+15550100001`: synthetic 555 fixture.
- `tests/friday-production-shadow-v1.mjs` — `+15550109991`: synthetic 555 fixture.
- `tests/openclaw-shadow-adapter.mjs` — `pass@support-bridge.example.test`: reserved test domain and synthetic URL credentials.
- `apps/api/src/seed.js` — `sarah.customer@test.local`: synthetic LAB fixture.

No production credential/customer-data finding was identified by this scan.

## Intentionally absent

- private Git history;
- production/runtime secrets;
- customer database dumps;
- SSH material;
- provider credentials;
- stale Friday Compose that assumes pre-existing Twenty;
- corrected final bundled-Twenty Compose (pending pre-install reconciliation).

## Review interpretation

Kai can now review actual application behavior and shadow/integration boundaries from code.

Measured host fit still requires:

1. corrected bundled-Twenty Compose;
2. resource envelope;
3. final host bind/volume/network map;
4. read-only target-host preflight.

Tonight remains review-only; no infrastructure changes are authorized by this repository.
