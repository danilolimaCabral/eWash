# AGENTS.md — Rules for every agent contributing to eWash

These rules are **strict and binding** for any AI agent (Claude, or otherwise)
working in this repository. They exist because this is a production-grade
application used by real businesses. Read `CLAUDE.md` for architecture,
`instructions.md` for the mandatory workflow, and `UX_UI.md` before touching
any user interface.

## 1. Never recreate what already exists

Before writing anything, **search the codebase for prior art**:

- Need an icon? It goes in `web/src/components/AppIcon.vue` — check its `PATHS`
  registry first; add a path there, never inline an `<svg>` in a view.
- Need a card, table, badge, modal, form field, toggle, combobox, avatar,
  empty state or toast? They already exist in `web/src/components/`. Use them.
  If one is 90% right, **extend it with a prop or slot** — do not fork it.
- Need money/date/initials formatting? `web/src/utils/format.js`.
- Need an API call? `web/src/api.js` client + existing endpoint. Check
  `api/src/routes/` before adding a new route — many needs are a query param
  away from an existing endpoint.
- Need a DB helper (audit, pagination, tenant scoping)? Check `api/src/util.js`
  and the route modules.

**Duplication is a defect.** If you find yourself copying a block of markup,
styling, or logic, stop and extract it to the shared location instead. Two
copies of anything is one too many.

## 2. Reusability is the default shape of all new code

- New UI element used (or plausibly usable) in more than one view → it is a
  component in `web/src/components/`, props-driven, documented with a one-line
  usage comment at the top.
- New backend logic used by more than one route → module in `api/src/`.
- Components take data via props and emit events; they do not fetch or hold
  global state (stores and views do that).
- Style with the design tokens in `:root` (`web/src/style.css`) — never
  hard-code colors, radii, or font stacks in a component.

## 3. UI standards: sleek, clean, compact

- Maintain the existing design language defined by the tokens in
  `web/src/style.css`: teal palette, shared UI typeface, 8–16px radii, soft
  shadows, and generous-but-tight 12–16px gaps. New screens must be
  indistinguishable in feel from existing ones.
- **Compact — no wasted space.** Dense tables, tight cards, no oversized hero
  sections, no decorative filler. Every pixel earns its place.
- **Pagination is mandatory on every listing** (tables and long lists):
  server-side `limit/offset` (or cursor) + a shared pagination control.
  Never render an unbounded list; never fetch more than one page.
- Empty, loading, and error states are required for every data surface —
  use `EmptyState`, skeleton/`Loading…`, and toast errors consistently.
- **Mobile-responsive always** (breakpoints 980px and 640px): drawer nav,
  stacking grids, horizontally scrollable tables/kanban. Verify at ~375px and
  desktop before calling UI work done.
- High creativity is welcome **within** the system: better micro-interactions,
  clearer information hierarchy, smarter defaults — not new color schemes,
  fonts, or one-off layouts.

## 4. Backend standards

- Drizzle ORM only; named migrations only (`drizzle-kit generate --name …`).
  Never edit an applied migration; create a new one.
- Every query tenant-scoped; every mutating endpoint policy-checked
  (`requirePolicy`) and, if price-affecting, audit-logged.
- Money in integer cents; order pricing snapshotted; status/payments
  append-only. Validate all input at the route boundary; throw
  `ApiError`/`bad()` with human-readable messages — never leak stack traces.
- Idempotency for anything callback- or retry-shaped (payments, webhooks).
- Keep endpoints RESTful and consistent with the existing route style.

## 5. Cleanliness

- Match the surrounding code's naming, idiom and comment density. Comments
  state non-obvious constraints only — no narration, no TODO graveyards.
- No dead code, no commented-out blocks, no unused imports, no `console.log`
  left behind (server `console.error` for real errors is fine).
- Small, focused diffs. One concern per change. No drive-by reformatting.

## 6. No assumptions — ask, then show a plan

You do not guess product behavior, and you do not silently expand scope.
The full protocol is in `instructions.md`; the short version:

1. Understand the request; **ask clarifying questions** if anything is
   ambiguous.
2. Investigate the existing code (rule 1).
3. **Present a plan for review** — what you intend to change, where, how it
   reuses what exists, what it does NOT cover — and wait for approval.
4. Implement exactly the approved plan.
5. Verify end-to-end and **present the result for review** with evidence
   (commands run, tests passed, screenshots for UI).

Deviating from an approved plan requires going back to step 3.
