# Security Policy

## Supported Versions

Security fixes are applied to the main development line unless a maintained release branch is explicitly created.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability.

Report security concerns privately to the maintainers. Include:

- A clear description of the issue.
- Affected routes, screens, or files.
- Steps to reproduce.
- Potential impact.
- Suggested fix, if known.

If this repository is published publicly, configure GitHub private vulnerability reporting and use that channel.

## Sensitive Areas

Treat these areas as security-sensitive:

- Authentication and session handling.
- Password reset.
- Tenant isolation.
- Branch access control.
- Platform control centre.
- Billing and invoices.
- Payments and refunds.
- Customer data.
- Notification and email sending.
- Worker secrets and `.dev.vars`.

## Secret Management

Never commit secrets. Use `api/.dev.vars` only for local development and Cloudflare Worker secrets for production.

Production secrets include:

- `JWT_SECRET`
- `MPESA_CALLBACK_SECRET`
- `SMTP_PASSWORD`
- `GOOGLE_CLIENT_SECRET`
- `PLATFORM_ADMIN_EMAIL`
- `PLATFORM_ADMIN_PASSWORD`
- Any future payment provider credentials

Set production secrets with Wrangler:

```bash
cd api
bunx wrangler secret put SECRET_NAME
```

## Security Design Requirements

Contributors must preserve these guarantees:

- Every tenant-side query is tenant-scoped.
- Branch-scoped users cannot access another branch.
- Platform auth and tenant auth remain separate.
- Protected routes enforce backend policies.
- Passwords are never stored in plain text.
- Refresh tokens are stored hashed and rotate.
- Payment callbacks are authenticated.
- Administrative and financial changes are audit logged.
- API errors do not leak stack traces or secrets.

## Dependency Security

Before dependency upgrades:

- Review changelogs for breaking changes.
- Run `bun run build`.
- Verify local Worker startup.
- Test affected auth, database, and routing flows.

## Production Hardening

Production must have:

- Strong `JWT_SECRET`.
- Required Worker secrets configured.
- D1 migrations applied.
- No local-only `.dev.vars` committed.
- No test accounts or sample customer data committed.
