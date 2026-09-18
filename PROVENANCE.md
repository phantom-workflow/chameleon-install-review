# Provenance

This public repository has **new, clean Git history**. It is not a publicized copy of the private Chameleon engineering repository.

## Private source

Canonical engineering repository:

`phantom-workflow/chameleon-operations` — private

Current public review material was derived from reviewed private repository state, including the Friday production-readiness work and current project architecture.

The install-facing reference files under `reference/current-proven-install/` were copied from:

- branch: `feat/friday-production-readiness-v1`
- reviewed branch head: `4f6d87199dcdc32cce4dd6c00f488c5b2b3f9c9a`

Relevant production-readiness package source was recorded in the private task status as:

`5dca33c0326aaafd27bbbe12b9b6163b35a0086a`

## Public-export rule

Only files intentionally selected for infrastructure/install review are exported.

No private repository history is copied into this repository.

## Security rule

Assume every file in this repository can be cloned and retained indefinitely.

Therefore secrets, production credentials, customer data, private database dumps, SSH material, and private runtime environment files are excluded by design.
