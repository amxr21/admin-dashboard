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
  **2026-08-01**: dashboard home page (`/admin`) redesigned — a headline revenue figure
  (`RevenueHero`) now reads as the centerpiece next to the chart instead of one of four identical
  tiles, and two widgets (Top Products, Status Breakdown) were added using report endpoints that
  existed but were previously unused on the dashboard.

### Settings + Staff
- **Status**: shipped, including all §N parity gaps (brand, theme accent, customization,
  dashboard behavior, notification preferences) — see 2026-08-01 note below
- **What**: Settings is an allowlist registry (`settings.config.ts`) over a `Json` column — one
  generic form renders itself from `GET /settings`, unknown keys 400. Staff CRUD is deliberately
  bespoke (outside the resource engine) with four enforced rules: no self-promotion, no granting
  above your own rank, no touching someone who outranks you, last OWNER can't be demoted/deactivated.
- **Where**: `backend/src/config/settings.config.ts`, `backend/src/services/settings.service.ts`,
  `backend/src/services/staff.service.ts`, `frontend/src/app/[locale]/admin/settings/`.
- **Notes**: maintenance-mode toggle real enforcement (503 on writes for everyone except
  OWNER/DEVELOPER), not just a stored flag. **2026-08-01**: verified the full §N gap list
  (ROADMAP.md) was already shipped in an earlier session — this file's "Planned / not started"
  entry for it was stale. Two real gaps found and fixed: brand fields (name/tagline/address/
  contact) were saved but never displayed anywhere — now wired into the invoice letterhead
  (`order-invoice.tsx`) and the browser tab title (`settings-provider.tsx`). Settings page itself
  also got a visual redesign (grouped sections by prefix — Brand/Appearance/Notifications/
  Operations — consistent card treatment for both "your preferences" and "store settings").
  Added a new store-wide `ui.sidebarMode` (sticky/floating) setting alongside a separate
  personal/localStorage sidebar-collapse toggle (not a registry entry — collapse state is
  per-browser, not org-wide).

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
- **Status**: shipped, backend AND frontend viewer
- **What**: Append-only, field-level diff log of who changed what. Credentials redacted, never
  omitted entirely. Writes never throw — a failed audit write must not fail the operation it logs.
  `/admin/audit` page (2026-08-01): filterable by entity, actor, and date range; "view history"
  icon links from every generic resource row and from the returns detail sheet deep-link into it
  pre-scoped to that record.
- **Where**: `backend/src/services/audit.service.ts`, `backend/src/routes/v1/audit.route.ts`,
  `frontend/src/app/[locale]/admin/audit/`, `frontend/src/components/audit/`,
  `frontend/src/lib/audit-api.ts`.
- **Notes**: generic resource engine's create/update/delete call `audit()` with a real field diff.
  2026-08-01 added backend date-range filtering (`from`/`to`) and `GET /audit/entities` (distinct
  values for the filter dropdown) — the whole viewer previously had zero frontend surface despite
  the backend being complete.

### Toaster + confirmation dialogs (frontend feedback)
- **Status**: shipped 2026-08-01
- **What**: `sonner`-based toaster (`ui/sonner.tsx`, themed to this app's semantic tokens, mounted
  once in the root layout) replaced every inline "notice" banner that could scroll off-screen on a
  long page. A real `AlertDialog` primitive (`ui/alert-dialog.tsx`, Radix, portal + focus trap +
  native `role="alertdialog"`) replaced every plain `<div role="alertdialog">` confirmation, which
  had the same off-screen risk since they rendered inline in normal document flow.
- **Where**: `frontend/src/components/ui/sonner.tsx`, `frontend/src/components/ui/alert-dialog.tsx`;
  consumers: `resource-table.tsx`, `resource-form.tsx`, `staff-table.tsx`, `couriers-table.tsx`,
  `returns-table.tsx`, `access-code-panel.tsx`.
- **Notes**: this was the confirmed P0 bug from the prior session ("delete confirmation renders
  off-screen"). While migrating, found and fixed a SEPARATE, much bigger, unrelated pre-existing
  bug: `sheet.tsx` (used for every create/edit form) and 7 other files used invented Tailwind class
  names (`inset-inline-start-*`, `inset-block-*`) that generated zero CSS — every drawer-style
  panel in the app was invisible. See the Changelog and `.claude-workbook/errors-log.md`
  (2026-08-01 entry) for the full story; this is very likely the actual root cause behind every
  earlier "modal doesn't work" report this project has had.

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
- **Courier portal (D2)** — a second, separate auth surface for couriers signing in by access code.
- **2FA** — not started.
- **Rest of §U** (ROADMAP.md) — "why disabled" tooltips, in-flight button state, optimistic row
  updates with rollback, bulk-action progress. Toaster and the AlertDialog primitive (the first two
  items) shipped 2026-08-01 — see the Toaster changelog entry.
- **Staff self-service profile** — no `PATCH /auth/me` or self-service password change yet; a staff
  member needs an OWNER to edit their own name/phone.
- **Transactional email** — every "notify" path writes an in-app row only; no ESP integrated.
  Needs a deliberate in-scope/out-of-scope decision before the notification-preferences settings
  section's toggles fully mean what they imply.

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
- **This session's work is now 4 stacked PRs against `dev`**, pushed and open:
  **#65** `feat(feedback): Toaster + real AlertDialog primitive` (base `dev`) →
  **#66** `feat(audit): admin viewer for the audit trail` (base #65) →
  **#67** `feat(settings): brand fields + settings/dashboard redesign` (base #66) →
  **#68** `feat(shell): collapsible sidebar, dialog motion, transitions` (base #67).
  Merge in stack order. The prior session's work (2026-07-31) turned out to already be merged via
  PRs #58-64 — this file previously said otherwise; corrected.
- **In progress**: none — 2026-08-01's scope is done, verified, and PR'd. The six-skill pass
  requested on 2026-07-31 (`project-foundations`, `project-docs`, `project-error-log`,
  `project-ship`, `project-test-gen`, `ux-animation-reviewer`) is still outstanding.
- **Next step**: rest of §U (ROADMAP.md) — build a Tooltip primitive for "why disabled", fix the
  one remaining in-flight-state gap (`staff-password-panel.tsx`), optimistic row updates,
  bulk-action progress.
- **Blockers**: none currently. Setup/Schema wizard remains blocked on an architecture decision
  (compiled-TS config vs. a DB-backed override layer) — not started, not in scope.
- **Context to remember**:
  - PRs #65-68 (this session) are pushed and open; merging/retargeting them is the user's call per
    standing instruction.
  - `prisma migrate dev` raising a drop-database-looking alarm has now happened three times on
    this project. The safe recipe when it's a stale `_prisma_migrations` row rather than real
    drift: generate via `prisma migrate diff --from-schema-datamodel/--to-schema-datamodel` (pure
    schema diff, no live DB) and apply with `migrate deploy` (skips `migrate dev`'s stricter
    reconciliation). Full writeup in `.claude-workbook/errors-log.md`, rule in `FOUNDATIONS.md` §6.
  - **New 2026-08-01 rule**: a component test suite that's fully green does NOT prove the UI
    renders correctly — jsdom doesn't compute real layout, so a Tailwind class that silently
    generates zero CSS (as `inset-inline-start-*`/`inset-block-*` did, see Changelog and
    `errors-log.md`) is invisible to it. When a user reports something visibly isn't working and
    the test suite disagrees, reproduce in a real browser before concluding it's user error.
  - The backend dev server must be run via `pnpm dev` (tsx watch), never `pnpm start` (runs the
    last COMPILED build, which silently goes stale the moment a route is added — this caused a
    real "Settings page 404s" incident on 2026-08-01).
  - Full detailed roadmap, security log (S1–S10) and parity-audit-against-template (§M) live in
    `.claude-workbook/ROADMAP.md` — read it for anything this file summarizes too tersely.

## Changelog
- **2026-08-01** — Real `AlertDialog` primitive + Toaster (`sonner`) shipped, closing §U items 1-2;
  full `/admin/audit` viewer built (backend was complete, frontend had zero surface); §N settings
  parity gaps found to already be fully shipped from an earlier pass (this file was stale, not the
  code) — the two real gaps (brand fields never displayed) fixed; settings page and dashboard home
  page both got a visual redesign pass; sidebar gained collapse/expand + a sticky/floating setting;
  page transitions now name their destination; error states gained an icon + a section-scoped
  variant. Found and fixed a P0 pre-existing bug affecting the whole app: `inset-inline-start/end-*`
  and `inset-block-*` are not real Tailwind utility names and silently produced zero CSS, leaving
  every drawer-style Sheet (every generic create/edit form, staff/courier panels, mobile nav)
  invisible — full story in `.claude-workbook/errors-log.md`. All uncommitted.
- **2026-08-01 (later same day)** — Real motion added to Sheet/AlertDialog: the drawer variant
  genuinely slides (`translateX`, direction chosen via Tailwind's `rtl:`/`ltr:` variants, verified
  compiling to a real selector rather than assumed), the modal variant and AlertDialog "pop" (fade +
  zoom). Page-transition overlay now fades out smoothly instead of vanishing instantly, so a page
  change reads as one crossfade. A second live bug (`/login`/`/admin/orders` 500ing) was found and
  fixed — dev-server Fast Refresh corruption from a very long multi-editor session, not a code bug.
  A fresh, evidence-based re-audit of the remaining UX/motion gap list found it stale in both
  directions (some items already done and uncredited, "in-flight button state" down to one real gap
  — see ROADMAP.md §U/§F). All uncommitted.
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
