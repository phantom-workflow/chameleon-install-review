# Chameleon Operations dashboard

This is the foundation for the task-focused human operations surface:
Operations Home, Needs You, Team Queue, decision/case context, and safe
deep-links into CRM and source-system context.

The browser calls only the local Next.js BFF routes. The BFF validates the
HttpOnly Chameleon session and calls the Chameleon API with a server-side
bearer session. Twenty credentials and caller-supplied role/user headers never
enter browser code.

The response is the `chameleon-operations-os.v1` read model. Home calls
`/api/operations?section=home`; the other operating areas lazy-load their own
domain path when opened. It includes viewer capabilities, owner-approval
visibility, queue items, and typed deep links. The BFF never uses legacy port
19210 as Chatwoot: 19210 is the frozen Operations reference surface. An unset
Chatwoot URL is rendered as unavailable, not as a conversation link.

The LAB-only owner decision path is
`POST /api/operations/demo/cases/{caseId}/approve`. It requires an
`APPROVED` or `REJECTED` decision and a reason of at least eight characters;
the BFF supplies only its server-configured LAB persona to the existing
guarded Chameleon API endpoint. The API records audit/idempotency receipts and
returns `NO_EXECUTION`. Production mode is refused, and the browser never
sends role or user headers.

This shell is read-only LAB infrastructure with V1 human authentication and
user administration. It does not implement provider ingestion, messaging,
customer editing, fulfillment, BI, or external execution.

## Bootstrap the first administrator

Run `npm run bootstrap-admin` from `apps/api` with `DATABASE_URL` and the
following values supplied by the protected runtime environment only:

`BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_USERNAME`, and
`BOOTSTRAP_ADMIN_PASSWORD` (optionally `BOOTSTRAP_ADMIN_EMAIL`).

The command succeeds only when no authenticated user exists, never prints the
password, and cannot be used as a repeatable credential reset path. Subsequent
users are managed from Settings → Users by an administrator.

Run with npm install, then npm run dev. Configure the variables in
.env.example for the local LAB API and deep-link destinations.
