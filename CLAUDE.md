# admin-dashboard — Project State

## Overview
- **Project**: A schema-driven admin back office (orders, inventory, delivery, staff, settings,
  reports, returns) built as a generalisable "plug-and-play dashboard for any business" — most
  resources render themselves from `admin.config.ts` rather than being hand-coded per feature.
- **Stack**: Next.js 15 (App Router) + TypeScript → Vercel · Express 5 + TypeScript → Render ·
  MySQL via Prisma (Aiven) · pnpm workspace · Node 22.
- **Status**: active development. Every admin section has a real page; what remains before the
  `dev` → `main` gate is security/readiness work, not features (see Current work).

## Features

### Resource engine (generic CRUD)
- **Status**: shipped
- **What**: Any resource declared in `admin.config.ts` gets a list page, create/edit form, search,
  sort, pagination and bulk delete for free at `/admin/r/[resource]`, driven by `GET /r/_schema`.
- **Where**: `backend/src/services/resource.service.ts`, `backend/src/routes/v1/resource.route.ts`,
  `frontend/src/app/[locale]/admin/r/[resource]/`.
- **Notes**: covers products, notifications, categories, customers, discounts, reviews. `users`
  (staff) is deliberately excluded — kept bespoke so privilege rules can't be bypassed by a config
  entry. Writes now call `audit()` with a real field diff (wired this session).

### Orders
- **Status**: shipped
- **What**: List + detail + status lifecycle (`PENDING → CONFIRMED → SHIPPED → DELIVERED`, plus
  `CANCELED`/`RETURNED`), only legal transitions are offered in the UI. Invoice/print view.
- **Where**: `backend/src/services/orders.service.ts` (if present) / `orders.config.ts` for the
  transition table, `frontend/src/components/orders/`.
- **Notes**: `total` is denormalised on purpose — never recomputed from live product prices.

### Inventory
- **Status**: shipped
- **What**: Stock as an append-only movement log (RECEIVED/SOLD/DAMAGED/LOST/RETURNED/CORRECTION),
  never an editable number. Low-stock view driven by `DEFAULT_LOW_STOCK_THRESHOLD`.
- **Where**: `backend/src/services/resource.service.ts` inventory routes, `StockMovement` model.

### Delivery (admin side)
- **Status**: shipped (admin UI + backend). Courier portal (D2) is the one open piece.
- **What**: Courier roster, access-code issue/reissue/revoke (one-time reveal, HMAC-SHA256 at
  rest, never plaintext), order assignment/reassignment.
- **Notes**: courier login portal (a second, separate auth surface) is not built yet.

### Reports
- **Status**: shipped
- **What**: Revenue-over-time (day/week/month), overview KPIs, top products, status breakdown, all
  reading real aggregated data (dashboard used to show a fabricated sine-wave revenue chart — fixed).
  CSV export added this session (`?format=csv` on all 4 endpoints).
- **Where**: `backend/src/routes/v1/reports.route.ts`, `frontend/src/components/reports/`.
- **Notes**: cancelled orders excluded from revenue but counted as orders; returned orders are NOT
  excluded (the money moved and came back). Revenue reads the order-line snapshot, never live prices.

### Settings + Staff
- **Status**: shipped (core), in progress (parity gaps below)
- **What**: Settings is an allowlist registry (`settings.config.ts`) over a `Json` column — one
  generic form renders itself from `GET /settings`, unknown keys 400. Staff CRUD is deliberately
  bespoke (outside the resource engine) with four enforced rules: no self-promotion, no granting
  above your own rank, no touching someone who outranks you, last OWNER can't be demoted/deactivated.
- **Where**: `backend/src/config/settings.config.ts`, `backend/src/services/settings.service.ts`,
  `backend/src/services/staff.service.ts`, `frontend/src/app/[locale]/admin/settings/`.
- **Notes**: maintenance-mode toggle added this session — real enforcement (503 on writes for
  everyone except OWNER/DEVELOPER), not just a stored flag. See Current work for the settings
  parity gap list (§N in ROADMAP.md) — not yet built.

### Returns / RMA
- **Status**: shipped this session, uncommitted
- **What**: Request a return from the order detail page, approve (refund/store-credit/replacement,
  optional restock) or reject. One approved return per order by design — approving transitions the
  order to the existing `OrderStatus.RETURNED` rather than a second parallel state. Refund is capped
  server-side to the returned items' recorded price. Restocking reuses the existing `StockMovement`
  log.
- **Where**: `backend/src/services/returns.service.ts`, `backend/src/routes/v1/returns.route.ts`,
  `frontend/src/app/[locale]/admin/returns/`, `frontend/src/components/returns/`,
  `frontend/src/components/orders/request-return-sheet.tsx`.
- **Notes**: new `returns` area, granted to MANAGER/FULFILLMENT/SUPPORT/DEMO/OWNER/DEVELOPER. Fixed
  a real pre-existing drift while building this: frontend `config/areas.ts` had `DEMO: [ALL]` while
  the backend excluded `staff` from DEMO's grant — frontend corrected to match.

### Password reset (admin-issued)
- **Status**: shipped this session, uncommitted
- **What**: An admin issues a single-use, 30-minute token (`POST /staff/:id/reset-token`); the
  locked-out user redeems it themselves (`POST /auth/reset-password`) to set a new password without
  the admin ever learning it.
- **Where**: `backend/src/services/password-reset.service.ts`, `backend/src/routes/v1/auth.route.ts`.
- **Notes**: HMAC-SHA256 at rest (same shape as courier access codes), atomic claim via
  `updateMany` in the WHERE clause — closes a TOCTOU double-redeem race found during security
  review. Revokes all sessions (`tokenVersion` bump) on redemption.

### Audit trail
- **Status**: shipped (backend); generic-engine hook wired this session
- **What**: Append-only, field-level diff log of who changed what. Credentials redacted, never
  omitted entirely. Writes never throw — a failed audit write must not fail the operation it logs.
- **Where**: `backend/src/services/audit.service.ts`.
- **Notes**: previously only bespoke writes (staff, delivery) called `audit()`. This session wired
  it into the generic resource engine's create/update/delete, closing the biggest remaining gap.

### Diagnostics widget (frontend)
- **Status**: shipped this session, uncommitted
- **What**: `DiagnosticsBar`, DEVELOPER-only — collapsed one-liner (env/uptime/DB reachability),
  expands to node version, last 5 migrations, Sentry/logs configured-state with links.
- **Where**: `frontend/src/components/shell/diagnostics-bar.tsx`, `frontend/src/lib/diagnostics-api.ts`.
- **Notes**: consumes the existing `GET /diagnostics` (added a session earlier for the same reason —
  never leaks a DSN or connection string, reports configured-state only).

### "View as role" preview
- **Status**: shipped this session, uncommitted
- **What**: OWNER/DEVELOPER can preview the sidebar and current page as another role would see it.
  Cosmetic only — never touches the real session or server-side authorization.
- **Where**: `frontend/src/components/shell/view-as-banner.tsx`, `view-as-blocked.tsx`,
  `view-as-switcher.tsx`.
- **Notes**: re-checks the real actual role on every render as defense-in-depth against a stale
  preview surviving a user swap in the same browser tab.

### Auth / RBAC
- **Status**: shipped
- **What**: JWT auth with `tokenVersion`-based revocation (password reset, deactivation, role
  change all bump it — an ordinary profile edit does not, so people aren't trained to avoid editing).
  Role → area permission map (`ROLE_AREAS`), rank declared explicitly (not derived).
- **Where**: `backend/src/middleware/authenticate.ts`, `authorize.ts`, `backend/src/config/roles.ts`.

### i18n (English/Arabic)
- **Status**: shipped, translations unreviewed
- **What**: Full bilingual UI, RTL-aware layout.
- **Notes**: all Arabic strings are MSA machine/self-translated, not yet reviewed by a native
  speaker — blocks any client demo. Tracked in ROADMAP.md §G-GATE item 3.

### Planned / not started
- **Setup/Schema wizard** — introspect DB → draft a config → publish. Approved by the user,
  needs an architecture decision first (this app's config is compiled TypeScript, not the
  template's runtime-required JS file — no direct "publish and hot-reload" equivalent).
- **Settings parity gaps** (§N in ROADMAP.md) — Dashboard behavior (`tablePageSize`), notification
  preferences, theme accent color, customization (density/corner-radius/edit-panel-mode), and the
  remaining Brand fields. Scoped and about to be built — see Current work.
- **Courier portal (D2)** — a second, separate auth surface for couriers signing in by access code.
- **2FA** — not started.

## Flows

### Generic resource write (create/update/delete)
1. `PATCH/POST/DELETE /r/:resource/:id?` hits `resource.route.ts`.
2. Payload validated against the resource's config-declared field shapes.
3. `resource.service.ts` performs the write inside a transaction, computing a field-level diff.
4. `audit()` is called with the diff (best-effort, never throws — logs loudly on failure instead).
5. Response echoes `{ action: 'created' | 'updated' | 'deleted' | 'archived' }` — archive vs.
   delete is truthful, never claims a delete that was actually an archive (FK-referenced rows).

**Files involved**: `resource.service.ts`, `resource.route.ts`, `audit.service.ts`, `admin.config.ts`.
**Failure modes**: unknown resource/field → 400 before any write; audit failure is logged, not
thrown, so a logging outage can't block real writes.

### Return approval
1. Order detail page → "Request return" opens `request-return-sheet.tsx` → `POST /returns`.
2. Staff opens `/admin/returns`, approves or rejects a `REQUESTED` return.
3. Approve: re-validates the order can still legally move to `RETURNED` (it may have moved on
   since the request), transitions the order, writes `OrderStatusHistory`, updates any delivery
   assignment, optionally writes `StockMovement` rows and increments `product.stock`, all in one
   transaction, then updates the `Return` row itself.
4. `audit()` logs the approval/rejection.

**Files involved**: `returns.service.ts`, `returns.route.ts`, `orders.config.ts` (transition table
reused), `request-return-sheet.tsx`, `frontend/src/app/[locale]/admin/returns/`.
**Failure modes**: order moved to a terminal state between request and approval → 400, nothing
written; refund amount over the recorded line-item total → 400.

### Admin-issued password reset
1. Admin (same rank rules as any other staff write) hits `POST /staff/:id/reset-token`, gets a
   one-time 12-character token back, hands it over out of band (chat/call).
2. Locked-out user hits `POST /auth/reset-password` with the token + new password.
3. Atomic claim: `updateMany` with `usedAt: null, expiresAt: { gt: now }` in the WHERE clause —
   only one concurrent redemption can ever win.
4. Password set, `tokenVersion` bumped (signs out every existing session), lockout cleared.

**Files involved**: `password-reset.service.ts`, `auth.route.ts`, `staff.route.ts`.
**Failure modes**: unknown/used/expired token all return the SAME generic error — telling them
apart is an enumeration oracle.

## Current work
- **Active branch**: `feat/staff-settings` (already merged once as PR #57; this session's work
  sits on top of that old merge point).
- **In progress**: Running the six-skill pass (`project-foundations`, `project-docs`,
  `project-error-log`, `project-ship`, `project-test-gen`, `ux-animation-reviewer`) over this
  session's uncommitted work, then building the recommended subset of the §N settings-parity gap
  list (table page size → notification preferences → theme accent color → customization → Brand
  fields), then splitting everything into logical branches/PRs.
- **Next step**: finish the skill pass, build the settings additions, then segment: audit hook ·
  password reset · (CSV export + diagnostics widget + view-as-role + maintenance-mode, bundled,
  small & related) · Returns/RMA · new settings parity work — one PR per segment (or fewer, if
  segments turn out tightly coupled).
- **Blockers**: none currently. Setup/Schema wizard remains blocked on an architecture decision
  (compiled-TS config vs. a DB-backed override layer) — not started, not in this session's scope.
- **Context to remember**:
  - Nothing from this session is committed, pushed, or opened as a PR yet — all uncommitted local
    changes. Per standing instruction, commit/branch/push/PR is fine to do; merging, retargeting,
    or updating branches from base is left to the user.
  - `prisma migrate dev` raising a drop-database-looking alarm has now happened three times on
    this project. The safe recipe when it's a stale `_prisma_migrations` row rather than real
    drift: generate via `prisma migrate diff --from-schema-datamodel/--to-schema-datamodel` (pure
    schema diff, no live DB) and apply with `migrate deploy` (skips `migrate dev`'s stricter
    reconciliation). Full writeup in `.claude-workbook/errors-log.md`, rule in `FOUNDATIONS.md` §6.
  - Full detailed roadmap, security log (S1–S10) and parity-audit-against-template (§M) live in
    `.claude-workbook/ROADMAP.md` — read it for anything this file summarizes too tersely.

## Changelog
- **2026-07-31** — Returns/RMA (full feature), admin-issued password reset, audit hook wired into
  the generic resource engine, reports CSV export, DEVELOPER-only diagnostics widget, "view as
  role" preview, settings maintenance-mode toggle with real enforcement. All uncommitted as of
  this entry. Bootstrapped this CLAUDE.md (none existed before).
- **2026-07-31 (earlier)** — Token revocation (`tokenVersion`) + audit trail added (PR #56).
- **2026-07-30** — Demo seeder (real DB rows, tagged + reversible teardown), dashboard revenue
  chart switched from a fabricated sine wave to real aggregation (PR #55, reports).
- **2026-07-29** — Settings + staff UI shipped (PR #55); ReDoS on the email validator fixed
  (CodeQL finding, PR #55).
- **2026-07-28** — Delivery API + admin UI shipped, courier access codes as keyed HMAC not
  plaintext (PR #47).
- **2026-07-27** — Inventory (append-only stock movement log) shipped (PR #45); "product
  principle" (plug-and-play dashboard, not single-business) stated explicitly in the roadmap.
- **2026-07-26** — Orders shipped, backend + UI (PRs #41, #42).
- **2026-07-25 to 2026-07-26** — Resource engine (generic CRUD from config) shipped, backend +
  frontend (PRs #38, #39).
