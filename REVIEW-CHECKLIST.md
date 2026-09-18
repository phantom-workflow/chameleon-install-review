# Pre-Install Review Checklist

This checklist is intended for Kai/Chameleon review of the installation package.

## Host

- [ ] Full stack CPU requirement is acceptable.
- [ ] Full stack RAM requirement is acceptable.
- [ ] Disk/free-space requirement is acceptable.
- [ ] Docker is installed and healthy.
- [ ] Docker Compose v2 is available.
- [ ] No material service/port conflicts identified.
- [ ] Persistent-volume locations are acceptable.
- [ ] Host backup/snapshot coverage is understood.

## Networking

- [ ] Loopback/internal service exposure is compatible with the host.
- [ ] Reverse proxy assumptions are correct.
- [ ] Cloudflare/tunnel assumptions are correct.
- [ ] Existing Chatwoot/Kai/OpenClaw paths remain untouched by base install.
- [ ] Shadow event mirroring cannot become an accidental second response path.

## Data and integrations

- [ ] Woo read-only access path is appropriate.
- [ ] Chatwoot event/replay identifiers are understood.
- [ ] Duplicate/retry behavior is understood.
- [ ] Bounded reasoning-only Kai/OpenClaw path is feasible.
- [ ] Twenty deployment/state requirements are acceptable.

## Recovery

- [ ] Operations PostgreSQL backup path is acceptable.
- [ ] Twenty backup/state path is acceptable.
- [ ] Restore process is understood.
- [ ] Immutable rollback images/build identity are understood.
- [ ] Failure of Chameleon OS leaves the existing day-to-day workflow available.

## Rollout expectations

- [ ] Tomorrow is install + verify + viewing, not operational cutover.
- [ ] Existing support path stays authoritative during shadow.
- [ ] Initial shadow window is approximately 3–4 days and may be extended.
- [ ] No automatic cutover occurs at the end of the observation window.
- [ ] Production authority moves workflow-by-workflow only after joint review.

## Review result

Use one of:

- **PASS** — no material install blocker identified.
- **PARTIAL** — install may proceed only after listed items are resolved.
- **NO-GO** — a specific host/integration/recovery risk should be fixed before installation.

Please identify concrete conflicts or missing assumptions rather than sending credentials or customer data.
