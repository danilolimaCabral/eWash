# instructions.md — Mandatory workflow for all contributions

Every task in this repository — feature, fix, refactor, doc — follows this
loop. No exceptions, no shortcuts, regardless of how small the task looks.
Rules of conduct are in `AGENTS.md`; architecture in `CLAUDE.md`.

## The loop: Understand → Investigate → Plan → Review → Implement → Verify → Review

### 1. Understand (no assumptions)

- Restate the request in your own words.
- If **anything** is ambiguous — scope, behavior, edge cases, which screen,
  which role can do it, what happens to money — **ask before proceeding**.
  Guessing product behavior is prohibited.
- Check the product spec in `Laundry_Management_SaaS_MockUp.html` when the
  question is "how should this behave".

### 2. Investigate before creating

- Search for existing components, endpoints, helpers, and patterns that cover
  (or nearly cover) the need. List what you found.
- Assume the thing you need probably exists in some form. Recreating an
  existing capability is a rejected change.

### 3. Plan — and present it for review BEFORE writing code

Post a short plan containing:

- **Goal** — one sentence.
- **Approach** — what changes, file by file (or module by module).
- **Reuse** — which existing components/endpoints/helpers you will use or
  extend, and why nothing existing already solves it.
- **Data changes** — any schema change (means a new named Drizzle migration),
  any new endpoint + its policy check, pagination approach for any listing.
- **UI** — which shared components compose the screen; mobile behavior.
- **Out of scope** — what you are deliberately not doing.
- **Verification plan** — how you will prove it works end-to-end.

**Wait for explicit approval before implementing.** If during implementation
you discover the plan was wrong, stop and re-plan — do not improvise.

### 4. Implement

- Exactly the approved plan, in the existing style, obeying `AGENTS.md`
  (reuse, no duplication, tenant scoping, policy checks, audit logging,
  integer cents, pagination, responsive UI).
- Keep the diff minimal and focused.

### 5. Verify (Definition of Done)

A change is done only when ALL of these hold:

- [ ] `bun run build` succeeds; migrations applied (`bun run db:migrate:local`).
- [ ] The affected flow was **exercised against the running app**
      (`bun run dev:api` → drive it: curl for API, headless browser or manual
      for UI). Not just "it compiles".
- [ ] Multi-tenant safety checked: a second tenant cannot see or touch the data.
- [ ] Permissions checked: a role without the policy gets a 403 and the UI
      hides the control.
- [ ] Price-affecting actions appear in the audit log.
- [ ] Listings are paginated and were tested past page one.
- [ ] UI verified at desktop **and** ~375px width; empty/loading/error states
      present; no console errors.
- [ ] No duplicated markup/logic introduced; no dead code, stray logs, or
      unused imports.

### 6. Review of results

Present what was done for review:

- What changed (short), how it was verified (commands, test output,
  screenshots for UI work), and anything the reviewer should look at closely.
- Report failures honestly — a failing test or skipped check is reported as
  such, never glossed over.

## Quick reference

All tooling goes through **bun** (`bun` / `bunx`) — never npm or npx.

| Task | Command |
|---|---|
| **Run everything (install + build + all migrations + serve)** | `bun start` → http://localhost:8787 |
| Build SPA only (required to see UI changes) | `bun run build` |
| New migration | `cd api && bunx drizzle-kit generate --name <name>` |
| Apply migrations only | `bun run db:migrate:local` / `:remote` |
| Deploy | `bun run deploy` |
