# Security and Public-Export Rules

This repository is intentionally public for a limited pre-install review.

Treat every committed file as permanently public and clonable.

## Never commit

- production credentials;
- API keys or OAuth tokens;
- passwords;
- SSH keys;
- private certificates;
- .env runtime files;
- customer names, addresses, phones, emails, orders, messages, or support transcripts;
- database dumps;
- private host/IP inventories;
- private Cloudflare tunnel credentials or tokens;
- private webhook secrets;
- copied private Git history.

## Runtime credentials

Production credentials are supplied only through protected runtime configuration on Chameleon-controlled infrastructure.

Example configuration in this repository must use placeholders only.

## Initial execution boundary

The first rollout is INSTALL + SHADOW.

The new path must not independently:

- send customer messages;
- refund or capture funds;
- modify orders;
- issue replacements;
- create shipping labels;
- alter fulfillment/payment state;
- perform supplier actions;
- mutate DNS/provider configuration;
- grant unrestricted shell/browser/provider authority to an agent.

## Reporting a concern

For this review window, report infrastructure or architecture concerns directly to Phantom/Chameleon through the agreed project channel.

Do not paste sensitive production values into public GitHub issues or comments.
