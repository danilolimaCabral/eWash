# Contributing to eWash

Thank you for helping improve eWash. This guide explains how to contribute safely and consistently.

## Before You Start

Read these files:

- `README.md` for setup and project overview.
- `SYSTEM.md` for architecture and design.
- `AGENTS.md` for strict repository rules that also apply to AI-assisted work.
- `SECURITY.md` before touching auth, payments, tenant data, billing, or secrets.

## Development Setup

```bash
bun install
bun start
```

The app runs at:

```text
http://localhost:8787
```

Useful commands:

```bash
bun run build
bun run dev:api
bun run dev:web
bun run db:generate
bun run db:migrate:local
```

## Contribution Workflow

1. Open or pick an issue.
2. Describe the intended change and the affected modules.
3. Inspect existing code before adding new code.
4. Keep the change focused.
5. Add or update migrations for database changes.
6. Run relevant verification commands.
7. Open a pull request using the PR template.

## Coding Standards

### Frontend

- Reuse shared components in `web/src/components`.
- Keep views responsible for data loading and composition.
- Keep components props-driven and event-driven.
- Use utilities from `web/src/utils/format.js` for formatting.
- Keep screens compact, responsive, and consistent with the existing design.
- Use pagination for long lists.
- Add loading, empty, and error states for data surfaces.

### Backend

- Use Hono route modules under `api/src/routes`.
- Use Drizzle ORM and schema definitions from `api/src/db/schema.js`.
- Validate input at the route boundary using existing security helpers.
- Use integer cents for all money values.
- Scope tenant data by `tenant_id`.
- Respect branch access for branch-owned operational data.
- Use `requirePolicy` or `requirePlatformPolicy` for protected routes.
- Audit meaningful administrative, billing, financial, pricing, and order-state changes.

## Database Changes

Do not hand-edit an applied migration.

For schema changes:

```bash
cd api
bunx drizzle-kit generate --name descriptive-change-name
bun run db:migrate:local
```

Commit:

- The schema change.
- The generated migration SQL.
- The generated migration metadata.

## Security Expectations

Do not commit:

- `.dev.vars`
- Worker secrets
- Real customer data
- SMTP passwords
- OAuth secrets
- Payment provider secrets
- Private keys

Changes touching auth, billing, payments, tenancy, branch access, password reset, or customer data need careful testing and clear PR notes.

## Pull Request Checklist

Before requesting review, confirm:

- `bun run build` passes.
- Migrations were generated and applied locally if the schema changed.
- New or changed endpoints enforce policies.
- Tenant data remains tenant-scoped.
- Branch data remains branch-scoped where required.
- UI changes are responsive.
- No dead code, debug logs, or commented-out code were left behind.
- Documentation was updated when behavior changed.

## Commit Style

Use concise, descriptive commits:

```text
Add platform tenant branch management
Fix password reset request form
Document system architecture
```

Prefer small commits grouped by concern.
