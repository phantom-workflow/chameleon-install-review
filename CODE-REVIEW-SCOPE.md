# Code Review Scope

This repository is a **production install-review package**, not the private Chameleon application-development repository.

It intentionally exposes the code that determines how the system is built, started, checked, backed up, restored, and rolled back so Chameleon can review install risk without publishing unrelated private history or customer data.

## Included for review now

The public repository now includes a sanitized snapshot of the actual runtime source Kai will receive tomorrow:

- `apps/api/` — operational API, auth, support routing, Chatwoot shadow ingress, Woo shadow worker, Twenty projection, runtime guards, and database migrations;
- `apps/dashboard/` — operator UI, BFF routes, authentication/session handling, runtime health, and user management;
- `tests/` — production runtime guard, Woo shadow, OpenClaw shadow, and Friday production-shadow proof;
- `docs/runbooks/` — shadow-connection and Kai support-shadow runbooks;
- `infra/customer-ops/` — production-shaped API Dockerfile plus preflight, backup, restore, and rollback scripts;
- `reference/current-proven-install/` — frozen copies of the previously proven install-facing pieces.

These files are here specifically so Kai can inspect:

- runtime/base-image choices;
- container users;
- exposed application ports;
- health checks;
- build identity;
- filesystem assumptions;
- Docker/Compose expectations;
- backup mechanics;
- restore behavior;
- rollback behavior.

## Why the final Compose file is not here yet

The previous Friday readiness Compose assumed an existing Twenty endpoint.

That assumption does not match the Chameleon production environment.

**There is no existing Chameleon Twenty deployment. Phantom is installing Twenty as part of Chameleon OS.**

Rather than publish a Compose file we already know represents the wrong production topology, the final Compose is being reconciled to include the bundled Twenty deployment and its stateful dependencies.

That corrected Compose becomes the primary install artifact before installation.

## What will be added before install

- corrected full Compose topology including bundled Twenty;
- final top-level sanitized environment contract;
- pinned Twenty runtime configuration;
- Twenty provisioning/deployment definition;
- complete-stack health checks;
- complete-stack install wrapper;
- backup/restore coverage for both Chameleon Operations and Twenty state;
- final version/source manifest and measured host resource envelope.

## What is intentionally not public

This review package does not expose:

- private Git history;
- production credentials;
- customer/order/message data;
- database dumps;
- SSH keys;
- private host identifiers;
- unrelated business logic or test fixtures;
- internal development notes.

The goal is enough real code to review the installation safely, not a public copy of the entire private engineering repository.
