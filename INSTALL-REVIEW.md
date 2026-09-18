# Kai Pre-Install Review

## Review objective

Please review this repository as the package Phantom Workflow intends to install for Chameleon Operations.

The most important expectation is:

> **Tomorrow is an installation and observation milestone, not a change to Chameleon's current day-to-day workflow.**

The current support and operational paths should continue working exactly as they do today while the new Chameleon OS is installed beside them.

## Planned sequence

### A. Base installation

Install and validate:

- Chameleon Operations dashboard
- Chameleon API
- PostgreSQL operational database
- Twenty CRM/deep-record workspace
- required workers/supporting services
- health checks
- persistent storage
- authentication
- backup/restore
- rollback

No customer-facing production authority is granted by the base installation.

### B. Shadow observation

Once the base stack is healthy, connect bounded observational/read-only inputs.

For approximately the next 3–4 days, initially:

```text
Real customer / operational event
              |
              +------> Current production workflow continues normally
              |
              +------> Chameleon OS shadow
                           |
                           +-- identify context
                           +-- classify
                           +-- reason
                           +-- propose response/action
                           +-- decide automation vs Human Work
                           +-- record result
```

The Chameleon OS shadow result is for comparison and monitoring.

It must not become an accidental second response path.

### C. Joint review

Phantom and Chameleon review:

- what the system saw;
- what it would have done;
- where it agreed/disagreed with existing handling;
- failures and missing context;
- automation candidates;
- Human Work decisions;
- safety/rollback evidence.

Low traffic may require extending the shadow period or replaying sanitized representative historical cases.

### D. Gradual production transition

Only after review do we move selected workflows from the current path into Chameleon OS.

This is intentionally gradual.

There is no planned "flip everything over" event.

A workflow moves when Chameleon and Phantom agree it is ready, beginning with bounded, low-risk work and preserving Human Work for money, risk, ambiguous data, consequential actions, or meaningful judgment.

## Please specifically tell us if

- the proposed host is too small for the complete stack;
- Twenty introduces resource or network constraints we have missed;
- any Docker networks/ports/volumes collide with existing services;
- our Cloudflare/reverse-proxy/tunnel assumptions are wrong;
- mirroring Chatwoot events could interfere with the existing support route;
- existing retry/webhook behavior could duplicate events;
- a supposedly read-only/shadow path can trigger a production side effect;
- Woo read-only integration should use a different mechanism;
- bounded reasoning through the current Kai/OpenClaw setup needs a different interface;
- our backup/rollback plan misses an important stateful component;
- there is an important operational dependency not represented here.

The desired outcome of the review is **no surprises during install and no disruption to Chameleon's current operations**.
