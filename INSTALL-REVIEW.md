# Kai Pre-Install Review

## Review objective

Please review the current Chameleon OS code and rollout plan and give us practical advice for tomorrow's install.

The most important expectation is:

> **Tomorrow is an installation and observation milestone, not a change to Chameleon's current day-to-day workflow.**

The current WooCommerce / Chatwoot / Kai support path stays authoritative while Chameleon OS is installed beside it.

## Planned sequence

### A. Base installation

Install and verify:

- Chameleon Operations dashboard
- Chameleon API
- PostgreSQL operational database
- Twenty CRM / deep-record workspace
- required supporting services
- health checks
- persistent storage
- authentication
- backup / restore
- rollback

No customer-facing production authority is granted by the base installation.

### B. Shadow observation

Once the base stack is healthy, connect bounded observational/read-only inputs.

For approximately the next 3–4 days initially:

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

The Chameleon OS result is for comparison and monitoring. It must not become a second customer-response path.

### C. Joint review

Phantom and Chameleon review what the system saw, what it would have done, where it disagreed with current handling, failures/missing context, Human Work decisions, and recovery evidence.

Low traffic may require extending the shadow period or using sanitized representative historical cases.

### D. Gradual production transition

There is no all-at-once cutover.

Selected workflows move into Chameleon OS only after Chameleon and Phantom agree they are ready, beginning with bounded low-risk work.

## Advice we want from Kai

Please use your knowledge of the real Chameleon environment to tell us anything we should account for before or during installation.

Especially useful:

- existing Docker/service conventions we should respect;
- ports, volumes, databases, proxy, Cloudflare, tunnel, or networking details we should avoid conflicting with;
- whether our understanding of the current Chatwoot → Mac bridge → Kai/OpenClaw path is correct;
- the safest way to mirror support activity without changing the existing reply path;
- the safest WooCommerce read-only access pattern;
- retry/replay behavior we should account for;
- anything about the proposed Twenty deployment that affects host placement, storage, or networking;
- what CPU/RAM/disk/port facts you want us to measure during the read-only host preflight;
- any recovery/backup convention you want us to preserve;
- any hidden dependency we should know about before installation.

If something in our assumptions differs from reality, just tell us the actual setup or constraint and we will account for it.

## Tonight's boundary

**Review only.**

Please do not install anything, restart anything, reconfigure services, create containers, change Docker/networking, touch Cloudflare, or make any other infrastructure change tonight.

Detailed findings can go into the shared Drive Markdown review rather than Telegram.

The goal is simple: **use Kai's environment knowledge to remove surprises before tomorrow's install without disturbing today's operation.**
