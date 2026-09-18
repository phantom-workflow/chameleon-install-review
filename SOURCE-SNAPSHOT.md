# Source Snapshot

This public review repository contains a near-complete current Operations API/dashboard runtime snapshot from the private Chameleon engineering repository, selected shadow/runtime tests and runbooks, Twenty provisioning code, plus the previously proven Friday install tooling.

## Current application/runtime source

Private source repository:

`phantom-workflow/chameleon-operations`

Application/runtime snapshot ref:

`main@9d8980e915c8651cc25031cda147836deb908812`

Published from that snapshot:

- `apps/api/` runtime and migrations, including synthetic/LAB compatibility fixtures needed for a coherent source snapshot;
- `apps/dashboard/` operator UI, BFF/auth/runtime/config source;
- selected shadow/runtime verification tests;
- shadow-connection and Kai/OpenClaw shadow runbooks;
- `tools/twenty/` provisioning tool and Chameleon Twenty manifest.

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
- the stale Friday Compose that assumed a pre-existing Twenty instance.

Synthetic fixture values such as `+1555...`, `example.test`, and `test.local` are intentionally non-production test data.

The corrected bundled-Twenty Compose is a separate pre-install gate and will replace that stale topology before installation.
