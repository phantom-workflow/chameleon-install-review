# Chameleon Operations — Install Review

> **Tomorrow does not change Chameleon's current day-to-day operations.**

This repository contains the sanitized installation package and review material for the initial Chameleon Operations / Chameleon OS rollout.

The immediate goal is to install the new operating layer **beside the existing production workflow**, verify that it is healthy, and observe how it would handle real work. It is **not** a next-day replacement of the systems or processes Chameleon currently relies on.

## Rollout expectation

The rollout has three distinct stages:

### 1. Install and verify

Phantom Workflow installs the Chameleon Operations stack on Chameleon-controlled infrastructure and verifies:

- service/container health;
- persistent state;
- authentication;
- Chameleon API and dashboard;
- PostgreSQL;
- Twenty CRM/deep-record workspace;
- restart behavior;
- monitoring;
- backup/restore;
- rollback.

At the end of this stage, the new system is available for Chameleon and Phantom to view and evaluate.

**Existing day-to-day customer support and operations continue normally.**

### 2. Shadow and observe

For the next several days, initially about **3–4 days**, Chameleon Operations runs alongside the current workflow.

It may observe or mirror relevant customer communications and operational events so we can evaluate:

- customer and order matching;
- request classification;
- proposed responses;
- proposed next actions;
- automation vs Human Work decisions;
- escalation quality;
- missing context or policy;
- duplicates/retries;
- latency;
- integration failures;
- disagreement with the current workflow.

The shadow system is intended to show **what Chameleon OS would have done**.

It does **not** replace the current customer-support path during this stage.

It does **not** independently send customer messages, issue refunds/replacements, modify orders, purchase labels, alter payments/fulfillment, or take other customer-facing production actions.

We understand current customer traffic may be lower than normal. The 3–4 day period is therefore an initial observation window, **not an automatic cutover deadline**. If there is not enough representative traffic, shadow mode can continue longer and/or be supplemented with representative sanitized historical cases.

### 3. Gradual production adoption

There is no all-at-once cutover.

After shadow results are reviewed by Chameleon and Phantom, we can move specific low-risk workflows into the new Chameleon OS **gradually and only when we all agree they are ready**.

A workflow should move only after its behavior, failure handling, ownership, and rollback path are understood.

Higher-risk or judgment-heavy work remains Human Work until separately approved.

The intended progression is:

```text
CURRENT WORKFLOW
      +
CHAMELEON OS SHADOW
      ↓
REVIEW REAL RESULTS
      ↓
ENABLE SPECIFIC LOW-RISK WORKFLOWS
      ↓
MONITOR
      ↓
EXPAND ONLY WHEN AGREED
```

## What Phantom is bringing

The intended stack includes:

- Chameleon Operations dashboard;
- Chameleon API;
- PostgreSQL operational database;
- Twenty CRM/deep-record projection;
- integration/workflow workers;
- Human Work and case context;
- provenance/audit;
- automation/integration health;
- backup, restore, and rollback tooling.

There is no existing Chameleon Twenty deployment that Kai needs to provide. Twenty is part of the Phantom installation.

## Existing production systems

During the initial rollout:

- **WooCommerce** remains commerce/order truth.
- **Chatwoot** remains customer-conversation truth.
- **Existing Kai/OpenClaw** remains the current AI/runtime domain.
- The existing customer-support path remains active.

Chameleon OS initially observes and coordinates around those systems rather than replacing them.

## What we want Kai to review

Kai: please review the actual package in this repository against the real Chameleon environment and flag anything likely to cause install or shadow-mode problems.

In particular, please challenge:

1. CPU/RAM/disk capacity for the full stack, including Twenty.
2. Docker/Compose compatibility.
3. Port, container, network, volume, database, cron, or service conflicts.
4. Reverse proxy / Cloudflare / tunnel assumptions.
5. Backup/snapshot and rollback boundaries.
6. Our understanding of the existing Chatwoot -> support bridge -> OpenClaw path.
7. The safest way to mirror support events without changing the current response path.
8. Retry/replay behavior that could create duplicates.
9. The safest bounded read-only WooCommerce access.
10. Whether existing support intelligence can expose a reasoning-only interface without broader Kai authority.
11. Health/logging signals Chameleon OS should monitor.
12. Any hidden production dependency or failure mode we have missed.

Please do not post passwords, tokens, API keys, customer data, or other secrets in issues or review comments.

## Safety boundary

The initial production installation is intentionally separated from production authority.

**Install != cutover.**

**Shadow observation != customer execution.**

**Several days of observation != automatic approval.**

Production authority moves workflow-by-workflow only after review and agreement.
