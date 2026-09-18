# Pre-Install Advice Checklist

This is a prompt for Kai/Chameleon to give Phantom practical installation advice. It is not a request to certify the final host or approve a production cutover.

## Current environment

Please note anything we should account for regarding:

- [ ] Docker / Docker Compose conventions already in use
- [ ] existing services or ports we should avoid
- [ ] persistent-volume / database conventions
- [ ] host backup or snapshot conventions
- [ ] proxy / Cloudflare / tunnel conventions
- [ ] current Chatwoot → Mac bridge → Kai/OpenClaw flow
- [ ] current WooCommerce API/read-only access pattern

## Shadow integration

Please flag anything that could make these assumptions wrong:

- [ ] existing customer-facing replies stay on today's path
- [ ] Chameleon receives only an observational copy during shadow
- [ ] Woo access is GET-only
- [ ] Kai/OpenClaw is reasoning-only for the new path
- [ ] duplicate/retry behavior is understood
- [ ] Chameleon cannot accidentally become a second reply path
- [ ] failure of Chameleon OS leaves current operations available

## Twenty / host planning

Twenty is part of the stack Phantom is bringing.

Please tell us:

- [ ] any obvious reason it should not share the proposed host
- [ ] storage/volume constraints we should plan for
- [ ] networking/port conventions we should respect
- [ ] CPU/RAM/disk facts you want measured before install

## Rollout expectation

- [ ] tomorrow is install + verify + viewing, not operational cutover
- [ ] existing support remains authoritative during shadow
- [ ] initial shadow observation is approximately 3–4 days and may be extended
- [ ] there is no automatic cutover after that period
- [ ] workflows move gradually only after joint review

## Requested output

A short Markdown review is enough:

1. **Environment facts we should know**
2. **Install advice / conflicts to avoid**
3. **Items to measure during preflight**
4. **Any assumption in the repo that differs from reality**

No credentials, tokens, customer data, or private secrets should be included.
