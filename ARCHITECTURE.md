# Chameleon OS — Installation Architecture

## Operating model

Chameleon OS is being introduced as an **operating layer beside the existing Chameleon workflow**, not as an immediate replacement.

```text
                 EXISTING PRODUCTION
                 remains authoritative
                         |
       +-----------------+------------------+
       |                 |                  |
  WooCommerce         Chatwoot         Kai / OpenClaw
 order truth      conversation truth     AI runtime
       |                 |                  |
       +----------- observational ----------+
                         |
                         v
                 CHAMELEON OS
              initial SHADOW mode
                         |
        +----------------+----------------+
        |                |                |
   Operations API   Operations UI      Twenty
   + PostgreSQL      / Human Work     deep record
        |
   provenance / audit /
   idempotency / health
```

## What Phantom installs

The intended Chameleon-controlled stack is:

```text
Chameleon OS host
├── Chameleon Operations Dashboard
├── Chameleon API
├── Chameleon PostgreSQL
├── Twenty
│   └── required Twenty state/services
├── bounded integration workers
└── health / backup / rollback tooling
```

Chameleon PostgreSQL is operational authority for receipts, routing, Human Work, provenance, replay/idempotency, job health, approvals, and audit.

Twenty is the CRM/deep-record projection. It is useful for customer/order/case navigation but is not the reliability ledger.

## Tomorrow's boundary

Tomorrow's target is:

```text
INSTALL → VERIFY → VIEW → SHADOW
```

not:

```text
INSTALL → REPLACE CURRENT OPERATIONS
```

The current customer-facing path remains active.

## Shadow data flow

```text
Customer event
     |
     +------> existing production path ------> normal current handling
     |
     +------> Chameleon OS shadow
                   |
                   +-- identify customer/order
                   +-- classify request
                   +-- load approved context
                   +-- obtain bounded reasoning
                   +-- propose action/response
                   +-- decide automation vs Human Work
                   +-- record result + provenance
```

The shadow path is observational. It is not a second customer-response channel.

## Authority progression

Production responsibility moves incrementally:

```text
OBSERVE
   ↓
COMPARE
   ↓
REVIEW
   ↓
APPROVE ONE WORKFLOW
   ↓
ENABLE NARROWLY
   ↓
MONITOR / ROLLBACK IF NEEDED
   ↓
EXPAND ONLY WHEN AGREED
```

There is no scheduled all-at-once cutover.
