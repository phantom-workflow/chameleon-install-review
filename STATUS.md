# Review Status

**State:** PRE-INSTALL REVIEW

**Purpose:** give Chameleon and Kai a transparent, reviewable representation of what Phantom intends to install before any day-to-day operational cutover.

## Proven / included

- production-shaped API container definition;
- production-shaped dashboard container definition;
- non-root application runtime;
- health checks;
- protected-environment preflight pattern;
- PostgreSQL custom-format backup with checksum;
- deliberate restore procedure;
- immutable API/dashboard rollback procedure;
- explicit separation of INSTALL, SHADOW, and future authoritative execution;
- no customer-facing execution in the initial rollout.

## In final reconciliation before install

- one complete Compose topology that bundles Twenty;
- complete Twenty state/backup handling;
- sanitized environment contract;
- final install/health command wrapper;
- exact source/version manifest.

## Intentional decision

A known-stale Compose file was **not** published merely to make this repository appear complete.

That Compose expected an external Twenty instance. Chameleon has no such existing deployment; Phantom is bringing Twenty.

The install package is being corrected before publication so the code Kai reviews is the code we actually intend to run.

## Rollout expectation

Tomorrow changes infrastructure visibility, not Chameleon's day-to-day operating authority.

Initial sequence:

1. install;
2. verify;
3. make the dashboard available for review;
4. observe real workflow in shadow;
5. compare results for several days;
6. jointly decide which bounded workflows are ready to transition.

The initial 3–4 day shadow window may be extended if customer traffic is too light to provide representative evidence.

## Review standard

A capability is considered:

- **PROVEN** only when backed by code/test/runtime evidence;
- **PARTIAL** when some required production evidence remains open;
- **UNVERIFIED** when it has not yet been exercised in the target environment.

Installation does not imply production authority.
