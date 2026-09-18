# Source Snapshot

This public review repository contains selected current runtime source from the private Chameleon engineering repository plus the previously proven Friday install tooling.

## Current application/runtime source

Private source repository:

`phantom-workflow/chameleon-operations`

Application/runtime snapshot ref:

`main@9d8980e915c8651cc25031cda147836deb908812`

Published from that snapshot:

- `apps/api/` runtime and production-relevant migrations, excluding synthetic/demo-only seed paths;
- `apps/dashboard/` operator UI, BFF/auth/runtime/config source;
- selected shadow/runtime verification tests;
- shadow-connection and Kai/OpenClaw shadow runbooks.

## Install tooling source

Previously proven Friday install tooling is sourced from:

`feat/friday-production-readiness-v1@4f6d87199dcdc32cce4dd6c00f488c5b2b3f9c9a`

Published install-facing files include:

- `infra/customer-ops/Dockerfile.friday-v1`
- `infra/customer-ops/scripts/friday-preflight.sh`
- `infra/customer-ops/scripts/friday-backup.sh`
- `infra/customer-ops/scripts/friday-restore.sh`
- `infra/customer-ops/scripts/friday-rollback.sh`

## Intentional exclusions

The export intentionally excludes:

- private Git history;
- production credentials/runtime env files;
- customer data and database dumps;
- synthetic/demo-only seed code not needed for install review;
- the stale Friday Compose that assumed a pre-existing Twenty instance.

The corrected bundled-Twenty Compose is a separate pre-install gate and will replace that stale topology before installation.
