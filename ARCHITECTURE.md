# Chameleon OS — Installation Architecture

Chameleon OS is added **beside** the live path. WooCommerce, Chatwoot, and Kai stay authoritative during the initial rollout. The new stack observes, records, and recommends. It does not reply or execute customer-facing actions during shadow mode.

```mermaid
flowchart TB
  subgraph live["Existing production — stays authoritative"]
    C[Customer]
    CW[Chatwoot<br/>conversation truth]
    WOO[WooCommerce<br/>order truth]
    MAC[Existing Mac bridge<br/>+ Kai / OpenClaw]
    STAFF[Current staff / Kai handling]
    C --> CW
    CW --> MAC
    MAC --> STAFF
    WOO -.-> MAC
  end

  subgraph add["New: Chameleon OS — install then shadow"]
    API[Operations API + PostgreSQL<br/>cases, audit, idempotency]
    UI[Operations dashboard<br/>Human Work]
    CRM[Twenty<br/>CRM / deep record — not the ledger]
    API --> UI
    API --> CRM
  end

  CW -.->|observational copy<br/>existing reply path unchanged| API
  WOO -.->|HTTPS GET-only<br/>orders / context| API
  API -.->|bounded reasoning only<br/>no new OpenClaw install| MAC

  live -->|"customer-facing replies stay here"| STAFF
  add -->|"view + compare until jointly approved"| UI
```

## What is new on the host

- Chameleon Operations dashboard
- Chameleon API
- PostgreSQL operational database
- Twenty
- supporting integration workers
- health, backup, restore, and rollback tooling

The intended application exposure is loopback/private rather than a new public Chameleon application endpoint.

## What does not change during the initial install

- Chatwoot remains the customer-conversation truth.
- WooCommerce remains order/commerce truth.
- Kai/OpenClaw keeps its current live-support authority.
- The existing customer-facing reply path remains active.
- Production workflows are not moved merely because the new stack is installed.

## Shadow rule

A copy of an event may enter Chameleon OS for context, classification, reasoning, Human Work routing, and audit.

The live customer reply still leaves through the current Chatwoot/Kai path.

`SUPPORT_MODE=shadow` and `NO_EXECUTION` remain the intended boundary.

```mermaid
sequenceDiagram
  participant Event as Customer / ops event
  participant Live as Current Chatwoot + Kai path
  participant OS as Chameleon OS shadow
  participant Woo as WooCommerce GET-only
  participant KaiReason as Existing Kai reasoning

  Event ->> Live: handled as today
  Live -->> Event: customer-facing reply stays here
  Event ->> OS: observational copy
  OS ->> Woo: read order / tracking context
  OS ->> KaiReason: bounded reasoning request
  KaiReason -->> OS: structured recommendation
  OS -->> OS: match, classify, Human Work, audit
  Note over OS: no Chatwoot send, refund, label, or Woo mutation
```

## Authority progression

```text
INSTALL
   ↓
VERIFY
   ↓
VIEW + SHADOW
   ↓
COMPARE REAL RESULTS
   ↓
JOINT REVIEW
   ↓
ENABLE ONE BOUNDED WORKFLOW
   ↓
MONITOR / ROLLBACK IF NEEDED
   ↓
EXPAND ONLY WHEN AGREED
```

There is no scheduled all-at-once cutover.
