# eWash System Architecture

This document describes the system design, core modules, data boundaries, security model, and development conventions for eWash.

## 1. Product Overview

eWash is a multi-tenant SaaS application for laundry businesses. It supports two operational layers:

| Layer | Users | Purpose |
| --- | --- | --- |
| Platform control centre | Platform owner/admin/billing users | Manage tenants, branches, subscriptions, invoices, platform revenue, platform audit logs, and tenant lifecycle. |
| Tenant application | Tenant admins, attendants, operators, riders, branch staff | Manage laundry operations: customers, orders, pricing, payments, expenses, users, branches, and reports. |

The platform owner manages many tenant businesses. Each tenant can have multiple branches. Tenant admins can operate across the tenant, while branch-scoped users are restricted to their assigned branch.

## 2. High-Level Architecture

```text
Browser
  |
  | Same origin
  v
Cloudflare Worker
  |
  | /api/platform/*      Platform API
  | /api/*               Tenant API
  | Static assets        Built Vue SPA
  v
Cloudflare D1 SQLite
```

The production deployment is a single Cloudflare Worker. The Worker serves:

- Vue SPA assets from `web/dist`.
- Platform REST API under `/api/platform/*`.
- Tenant REST API under `/api/*`.
- Public auth endpoints under `/api/auth/*`.
- Public payment callback endpoint guarded by a callback secret.

## 3. Repository Layout

```text
.
|-- api/
|   |-- migrations/          Drizzle generated D1 migrations
|   |-- src/
|   |   |-- db/              Drizzle schema and database factory
|   |   |-- routes/          Hono route modules
|   |   |-- auth.js          Password hashing and JWT helpers
|   |   |-- branchAccess.js  Tenant-wide versus branch-scoped access helpers
|   |   |-- middleware.js    Tenant auth, policy loading, branch checks
|   |   |-- platform.js      Platform auth and platform policy helpers
|   |   |-- policies.js      Tenant policy catalog
|   |   |-- pricing.js       Server-side pricing engine
|   |   |-- security.js      Input validation and production hardening
|   |   `-- index.js         Worker entrypoint
|   `-- wrangler.toml        Worker, assets, D1, and cron configuration
|-- web/
|   `-- src/
|       |-- components/      Shared UI components
|       |-- stores/          Pinia stores
|       |-- views/           Route-level screens
|       |-- api.js           Tenant API client
|       |-- platformApi.js   Platform API client
|       `-- router.js        Tenant and platform routes
|-- scripts/                 Local and deployment scripts
|-- AGENTS.md                Rules for coding agents
|-- README.md                Project entrypoint
`-- SYSTEM.md                This architecture document
```

## 4. Runtime Architecture

### Frontend

The frontend is a Vue 3 SPA. Route-level screens live in `web/src/views`, reusable UI primitives live in `web/src/components`, and shared formatting helpers live in `web/src/utils/format.js`.

The app uses two API clients:

- `web/src/api.js` for tenant users.
- `web/src/platformApi.js` for platform users.

These clients use separate local storage token keys to prevent platform and tenant sessions from overwriting each other.

### Backend

The backend is a Hono app running inside a Cloudflare Worker. `api/src/index.js` mounts public auth routes first, then platform routes under platform authentication, then tenant routes under tenant authentication.

Important backend modules:

| Module | Responsibility |
| --- | --- |
| `routes/auth.js` | Tenant registration, login, session refresh, password reset. |
| `routes/platform.js` | Platform dashboard, tenants, branches, members, billing, revenue, invoices, audit. |
| `routes/orders.js` | Order creation, pricing snapshot, workflow, handoff, void, discounts. |
| `routes/payments.js` | Cash/manual M-Pesa payments, refunds, STK callback scaffold. |
| `routes/finance.js` | Expenses, providers, credit ledger, P&L. |
| `routes/reports.js` | Dashboard KPIs, notifications, daily register, audit logs, summary reports. |
| `routes/users.js` | Tenant users, roles, branch management. |
| `routes/customers.js` | Tenant customers and branch-aware customer visibility. |

### Database

The database is Cloudflare D1, modeled with Drizzle in `api/src/db/schema.js`.

Migrations are stored in `api/migrations`. New schema changes must be generated with a named migration:

```bash
cd api
bunx drizzle-kit generate --name descriptive-change-name
```

Apply migrations locally:

```bash
bun run db:migrate:local
```

Apply migrations remotely:

```bash
bun run db:migrate:remote
```

## 5. Tenancy and Branch Model

The core data hierarchy is:

```text
Platform
  `-- Tenant
      |-- Branch
      |-- User
      |-- Customer
      |-- Service catalog
      |-- Order
      |-- Payment
      |-- Expense
      `-- Report data
```

Tenancy rules:

- Every tenant-side query must be scoped by `tenant_id`.
- Customers are tenant-specific, not global.
- Orders, payments, expenses, and branch operations must respect branch scope.
- Tenant-wide admins can see and manage all branches under their tenant.
- Branch-scoped users can only work inside their assigned active branch.
- Platform users manage tenants from the platform control centre and do not use tenant auth.

Branch access is implemented with `api/src/branchAccess.js`:

- `isTenantWide(c)` checks whether the current user can operate across the tenant.
- `scopedBranchId(c, requestedBranchId)` validates requested branch access.
- `assertBranchAccess(c, branchId)` rejects cross-branch access.

## 6. Authentication and Authorization

### Tenant Auth

Tenant users authenticate through `/api/auth/*`.

The session model uses:

- Short-lived JWT access tokens.
- Rotating refresh tokens stored hashed in D1.
- Server-side logout.
- Session reuse detection.
- Idle lock support in the frontend.

Tenant users have:

- A role.
- A policy set from role policies.
- Optional per-user grant/deny overrides.
- An `access_scope` of `tenant` or `branch`.

### Platform Auth

Platform users authenticate through `/api/platform/auth/*`.

Platform JWTs include `actor: "platform"` and are accepted only by platform middleware. Platform users have platform roles:

- `platform_owner`
- `platform_admin`
- `platform_billing`

Platform policies are defined in `api/src/platform.js`.

### Authorization Rules

- Tenant endpoints use `requirePolicy`.
- Platform endpoints use `requirePlatformPolicy`.
- Mutating administrative, financial, order, and branch actions should be audit logged.
- Backend enforcement is required even if the frontend hides a button.

## 7. Order and Payment Flow

Order lifecycle:

```text
received -> washing -> ironing -> ready -> delivered
```

Important rules:

- Pricing is calculated server-side.
- Order line prices are snapshotted.
- Closed revenue is recognized when an order is delivered.
- Orders cannot be delivered before handoff rules are satisfied.
- Pickup or delivery handoff records who collected or took delivery.
- Payment status is derived from payment ledger records.
- Credit customers may pick up according to the credit workflow.

Payment methods currently supported:

- Cash
- Manual M-Pesa code

M-Pesa STK push remains intentionally disabled in the UI and guarded on the backend until implemented.

## 8. Finance and Reporting

Finance modules include:

- Expense categories.
- Expenses optionally linked to service providers.
- Recurring expenses.
- Credit customer ledger.
- P&L reports.
- Daily register.
- Tenant revenue and platform revenue reporting.

Revenue principles:

- Tenant operating revenue is based on delivered/closed orders.
- Collected cash is based on completed payments.
- Billing revenue for platform subscriptions and invoices is separate from tenant operating revenue.

## 9. Platform Control Centre

The platform control centre provides:

- Platform dashboard.
- Tenant listing with pagination.
- Tenant detail modal.
- Tenant status changes: active, suspended, cancelled.
- Tenant branch creation and management.
- Tenant member creation and management.
- Subscription creation and updates.
- Invoice creation, issuing, payment recording, and voiding.
- Billing email management.
- Platform revenue reporting.
- Platform audit log.

Platform routes are protected independently from tenant routes. A platform session cannot be used as a tenant session.

## 10. Security Design

Security controls include:

- Production secret validation.
- Security response headers.
- API body size limit.
- D1-backed auth rate limiting.
- Password hashing with PBKDF2.
- Rotating refresh tokens.
- Tenant and branch authorization checks.
- Input validation at route boundaries.
- Callback token protection for payment callback routes.
- No shared-cache API responses.

Sensitive values must be configured as Worker secrets in production. Never commit `.dev.vars`, private keys, SMTP passwords, API secrets, or real customer data.

## 11. UI Design System

The frontend is intentionally compact and operational. Use existing reusable components before adding new ones:

- `Panel`
- `KpiCard`
- `DataTable`
- `Pagination`
- `Modal`
- `FormField`
- `StatusBadge`
- `Tabs`
- `ComboBox`
- `ToggleSwitch`
- `Avatar`
- `EmptyState`
- `Skeleton`
- `ConfirmDialog`

Design rules:

- Keep screens dense, readable, and professional.
- Use shared tokens from `web/src/style.css`.
- Do not introduce one-off color systems or layout systems.
- Use pagination for long lists.
- Support desktop and mobile.
- Keep platform and tenant UI visually consistent but operationally distinct.

## 12. Development Workflow

Standard workflow:

1. Read existing code and documentation.
2. Reuse existing components, helpers, and route patterns.
3. Keep tenant, branch, policy, and audit implications explicit.
4. Add or update Drizzle migrations for schema changes.
5. Run relevant checks.
6. Document user-facing changes when needed.

Common verification commands:

```bash
bun run build
bun run db:migrate:local
```

For local API verification:

```bash
cd api
bunx wrangler dev
```

## 13. Deployment Model

The production deploy target is Cloudflare Workers with:

- One Worker.
- One D1 database binding.
- Static SPA assets.
- Worker secrets for auth, SMTP, OAuth, platform bootstrap, and callback tokens.
- Cron support for scheduled finance tasks.

Deployment command:

```bash
bun run deploy
```

## 14. Architectural Principles

- Keep one source of truth for business rules on the backend.
- Keep frontend components reusable and props-driven.
- Keep money as integer cents.
- Keep data tenant-scoped by default.
- Keep branch restrictions enforced in the backend.
- Keep migrations additive and named.
- Keep platform operations separate from tenant operations.
- Keep audit trails for sensitive business actions.
- Keep the app deployable as one Worker.
