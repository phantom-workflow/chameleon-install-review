# Chameleon Operations — Install Review

> **Tomorrow does not change Chameleon's current day-to-day operations.**

This repository contains the sanitized **pre-install review package** for the initial Chameleon Operations / Chameleon OS rollout.

The immediate goal is to install the new operating layer **beside the existing production workflow**, verify that it is healthy, and observe how it would handle real work. It is **not** a next-day replacement of the systems or processes Chameleon currently relies on.

## Executive summary

| Question | Answer |
|---|---|
| Are we changing normal customer-support operations tomorrow? | **No.** |
| Will the existing support path keep running? | **Yes.** |
| Will Chameleon OS be installed and viewable? | **Yes.** |
| Will it observe real workflow in shadow? | **Yes, after the base install is verified.** |
| Will it independently message customers or take consequential actions? | **No.** |
| Initial observation window? | **About 3–4 days, longer if traffic is too light.** |
| Automatic cutover after that period? | **No.** |
| How does production adoption happen? | **Workflow-by-workflow, after joint review and agreement.** |
| Is Twenty already installed at Chameleon? | **No. Phantom is bringing it.** |

## Review map

- [INSTALL-REVIEW.md](INSTALL-REVIEW.md) — Kai's pre-install review brief
- [ARCHITECTURE.md](ARCHITECTURE.md) — intended system and shadow-mode data flow
- [STATUS.md](STATUS.md) — proven vs still in final reconciliation
- [CODE-REVIEW-SCOPE.md](CODE-REVIEW-SCOPE.md) — what code is public and why
- [PROVENANCE.md](PROVENANCE.md) — source/provenance of the public review artifacts
- [reference/current-proven-install/](reference/current-proven-install/) — current proven container and operational scripts

Current real code available for inspection now includes the Operations API, dashboard/BFF, authentication, Human Work and support routing, Chatwoot shadow ingress, Woo read-only shadow worker, Twenty projection/adapter, runtime guards, production-shadow tests, Dockerfiles, and backup/restore/rollback tooling.

**Remaining pre-install gate:** the final host Compose/resource envelope is being finalized around the bundled Twenty deployment. The application/runtime source is available now so Kai can review behavior and integration boundaries tonight; the final host-fit check happens during the read-only preflight before install.

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

## What we want Kai to review tonight

Kai: please treat tonight as a **read-only code, operating-model, and dependency review**. The repository now contains the relevant application/runtime source, but the corrected bundled-Twenty Compose and measured host resource envelope are still separate pre-install gates.

In particular, please advise us on:

1. Whether the code preserves the existing WooCommerce / Chatwoot / Kai path during shadow.
2. Whether the Chatwoot shadow-ingress design can observe without becoming a second reply path.
3. Whether the Woo shadow worker is appropriately read-only/bounded.
4. Whether the support-agent/OpenClaw boundary is narrow enough for shadow operation.
5. Whether retry/replay/idempotency behavior matches the real environment.
6. Whether our understanding of the existing Chatwoot -> support bridge -> OpenClaw path is directionally correct.
7. Whether introducing Twenty as a Phantom-managed component creates an obvious architectural concern.
8. What proxy, Cloudflare, tunnel, Docker, backup, or service conventions the final install must respect.
9. What exact host CPU/RAM/disk/port facts should be measured during tomorrow's preflight before starting the install.

The current public tree is **not claiming measured host-fit certification yet**; that requires the final Compose/resource envelope plus a read-only inspection of the chosen host.

Please do not post passwords, tokens, API keys, customer data, or other secrets in issues or review comments.

## Safety boundary

The initial production installation is intentionally separated from production authority.

**Install != cutover.**

**Shadow observation != customer execution.**

**Several days of observation != automatic approval.**

Production authority moves workflow-by-workflow only after review and agreement.
