# admin-dashboard — Project State

## Overview
- **Project**: A schema-driven admin back office (orders, inventory, delivery, staff, settings,
  reports, returns) built as a generalisable "plug-and-play dashboard for any business" — most
  resources render themselves from `admin.config.ts` rather than being hand-coded per feature.
- **Stack**: Next.js 15 (App Router) + TypeScript · Express 5 + TypeScript · both self-hosted on a
  Hostinger KVM VPS via Coolify (moved off Vercel/Render 2026-09-03) ·
  MySQL via Prisma (Aiven) · pnpm workspace · Node 22.
- **Status**: active development. The 2026-09-10 review added report reliability, consistent
  loading feedback, scroll containment, editable organization structure and missing Settings
  destinations. UX-009 now makes POS checkout retries safe and passed the complete GitHub CI gate
  in PR #195. Batch 2 delivery operations and automatic employee branch scoping are implemented;
  the full local gate and stacked PR are next.

## 2026-09-10 review stack

The owner-reported review work is split into ordered branches so each concern remains reviewable:

1. `fix/test-database-isolation` — integration tests require a dedicated database whose name
   contains `test`; confirmed local category/POS test garbage was backed up and removed.
2. `fix/report-reliability` — all 27 report views share stale-request protection and consistent
   loading/error/retry behavior; overview validation no longer leaves stale panels visible.
3. `fix/loading-scroll-feedback` — delayed navigation and API work show an accessible global
   overlay, branch switching explains workspace preparation immediately, and modal/sidebar
   scrollers no longer compete.
4. `feat/organization-settings` — owners can define business/branch/staff fields and edit job
   titles, departments and cycle-safe reporting lines. Settings now links every shipped
   configuration area and includes POS, returns and navigation-label groups.
5. `fix/shift-branch-resolution` — an unscoped branch employee with exactly one active
   assignment can start a shift while genuine multi-branch/business ambiguity still fails safely.
6. `docs/review-verification` — final E2E coverage plus the synchronized TODO and project records.
7. `feat/motion-ux-polish` — exposes the persistent animation preference, applies it before
   hydration to CSS and GSAP motion, and smooths the global loading overlay using shared timings.
8. `fix/shell-action-errors` — permission-gates the notification bell and translates stable shift
   branch-conflict reason codes into useful English/Arabic actions instead of a generic 400 error.
9. `fix/ux-009-idempotent-checkout` — requires a UUID request key for POS checkout and atomically
   stores the first committed response, so sequential or simultaneous retries cannot duplicate an
   order, payment, stock movement or sale audit event.
10. `feat/ux-delivery-operations` — adds the assignment-centred delivery board, merged timeline,
    working-now shift view, and session-level automatic scoping for singly assigned employees.

Focused verification is green: 27/27 regular report routes in the browser; 181 backend report and
scheduled-report cases; 132 frontend report cases; 52 shift cases; organization integration,
English/Arabic mobile layout, scheduled-report validation, loading, branch switching and scroll
checks. The reported notification and shift failures also pass focused unit, lint, type and live
browser checks after a clean frontend restart. The full combined suite and production build are
the remaining local gates. No deployment has been performed.

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
- **Notes**: `total` is denormalised on purpose — never recomputed from live product prices, and
  keeps its existing meaning (grand total, tax included) even after the 2026-08-11 addition below.
- **2026-08-11**: invoice tax/subtotal breakdown. New `subtotal`/`taxAmount` columns on `Order`
  (nullable — `NULL` means "never recorded," a real gap distinct from a confirmed `0`), driven by
  a new `store.taxRate` setting (order-level flat rate; 0 is a valid "no tax" choice, not
  "unset"). `total` was deliberately NOT redefined as pre-tax — every existing Reports/Dashboard
  revenue calculation already reads `.total` as the full amount, and changing its meaning would
  have silently under-reported revenue everywhere without touching those files. The invoice
  renders Subtotal/Tax/Total only when recorded; a pre-migration order still shows the single
  Total row it always did. The live POS checkout now calls the same shared calculation and stores
  its resulting subtotal/tax/total snapshots with the order.

### POS checkout retry safety (UX-009)
- **Status**: implemented; pending full branch gate and GitHub checks.
- **Contract**: `POST /api/v1/pos/checkout` requires a UUID `Idempotency-Key` header. A retry by
  the same authenticated actor with the same key and request returns the original `201` body and
  sets `Idempotency-Replayed: true`; reusing the key for different details returns `409`.
- **Atomicity**: the generic `IdempotencyRecord` claim, order, lines, payments and stock movements
  commit in one Prisma transaction. Simultaneous duplicates serialize on the unique claim without
  producing an operational error log. Only the request that creates the sale writes its audit
  event.
- **Retention**: records are retained for seven days and pruned by the existing daily scheduler.
  The expiry index keeps cleanup bounded and lets future critical mutations reuse the same
  service without adding feature-specific replay tables.
- **Where**: `backend/src/services/idempotency.service.ts`, `backend/src/services/pos.service.ts`,
  `backend/src/routes/v1/pos.route.ts`, and `frontend/src/lib/request-intent.ts`.

### Inventory
- **Status**: shipped
- **What**: Stock as an append-only movement log (RECEIVED/SOLD/DAMAGED/LOST/RETURNED/CORRECTION),
  never an editable number. Low-stock view driven by `DEFAULT_LOW_STOCK_THRESHOLD`.
- **Where**: `backend/src/services/resource.service.ts` inventory routes, `StockMovement` model.

### Delivery (admin side)
- **Status**: shipped (admin UI + backend). Courier portal also shipped — see below.
- **What**: Courier roster, access-code issue/reissue/revoke (one-time reveal, HMAC-SHA256 at
  rest, never plaintext), order assignment/reassignment.
- **Notes**: **2026-08-07 correction** — this file previously claimed the courier login portal
  "is not built yet". It IS built and complete (`frontend/src/app/[locale]/courier/` +
  `courier/login/`), consuming every endpoint in `courier.route.ts`, with i18n, RTL, theme,
  skeletons, error+retry, empty state, rate-limit handling and sign-out. Also **fixed 2026-08-07**:
  `assign-courier-control.tsx` posted only `{orderId, driverId}`, discarding the `address`/`city`/
  `note` the backend accepts — every assignment was created with a null address that the courier
  portal then rendered blank. `Order` has no address column, so the assign form is the ONLY
  capture point for it. **`PATCH /assignments/:id` exists** (address/city/note correction without
  reassigning) — an earlier version of this file listed it as still missing; it was not.
- **2026-08-11**: failed-attempt path. New `FAILED_ATTEMPT` `DeliveryStatus` value — deliberately
  re-triable, not terminal: `COURIER_TRANSITIONS` now allows
  `OUT_FOR_DELIVERY → FAILED_ATTEMPT → OUT_FOR_DELIVERY`, so the same job goes back out rather than
  requiring a new assignment. New `attemptCount` (increments on each failure) and `failureReason`
  (required from the courier when reporting one) on `DeliveryAssignment`; both reset to
  0/`null` on reassignment to a new courier — a new courier starts clean, the prior failures stay
  visible in `AuditLog`. Courier portal has a "Report failed attempt" dialog; the admin
  order-detail page shows the attempt count and last reason.
- **2026-09-08 (O6)**: fixed a real bug in the courier portal — tapping a status blanked the
  card until a refresh. `PATCH /courier/assignments/:id/status` selected 5 fields where
  `GET /courier/me/assignments` selects 14, and `courier-dashboard.tsx` splices the response into
  the array it already holds, so a complete row was swapped for a stub with no customer, address
  or total. Both paths now share ONE `COURIER_ASSIGNMENT_SELECT` and one `toCourierAssignment()`
  serialiser, which also converts `total` from a Prisma `Decimal` to the string the client type
  always declared. **Why nothing caught it**: `courierFetch` casts the JSON blindly, so the 14
  declared fields were never compared to reality, and the jsdom tests mock a full object. The
  regression test compares the two endpoints' KEY SETS — it fails whenever either select changes
  without the other, which is the only way this recurs. Deliberately NOT fixed by making
  `courierFetch` validate: `api.ts` casts the same way at two call sites and `zod` is
  backend-only, so validating here alone would make the courier portal the one client with a
  different contract. The cast is why the bug stayed invisible, not why it happened.
- **2026-09-10 (UX-010/011)**: `/admin/delivery` now opens on an assignment-centred operational
  board with active, failed and all queues; URL-backed courier/status/date/search filters; branch
  scoping; responsive cards; and a chronological timeline merging assignment audits with order
  delivery-status changes. Courier setup remains available as a separate view. Courier performance
  metrics remain open.
- **2026-09-10 cashier branch fix**: the authenticated session reconciles its locally stored branch
  with the branches the user may enter. A branch-scoped employee with one assignment is selected
  automatically, stale assignments are cleared, and business-wide Owner/Developer accounts keep
  the intentional all-branch overview.

### Reports
- **Status**: shipped
- **What**: Revenue-over-time (day/week/month), overview KPIs, top products, status breakdown, all
  reading real aggregated data (dashboard used to show a fabricated sine-wave revenue chart — fixed).
  CSV export added this session (`?format=csv` on all 4 endpoints).
- **Where**: `backend/src/routes/v1/reports.route.ts`, `frontend/src/components/reports/`.
- **Notes**: cancelled orders excluded from revenue but counted as orders; returned orders are NOT
  excluded (the money moved and came back). Revenue reads the order-line snapshot, never live prices.
  **These definitions are the single most valuable thing to surface in the UI** — they are
  genuinely non-obvious, two of them make otherwise-identical-looking numbers legitimately
  disagree, and today they exist only as comments in `reports.service.ts`. That is `TODO.md`'s
  F4.1, and it is the core of the owner's "reports are vague and unclear" complaint.
  **2026-09-05 (F1)**: profitability now reads a per-line COST snapshot (`OrderItem.cost`), the
  same discipline revenue already had — a supplier price change no longer rewrites past profit.
  Margin figures are PARTIAL BY CONSTRUCTION (only lines with a recorded cost) and every surface
  showing one must state its coverage; a bare margin percentage over an unstated subset is the
  most dangerous number this app can render.
  **2026-08-01**: dashboard home page (`/admin`) redesigned — a headline revenue figure
  (`RevenueHero`) now read as the centerpiece next to the chart, and two widgets (Top Products,
  Status Breakdown) were added using report endpoints that existed but were previously unused on
  the dashboard. **2026-08-02 (Phase 3)**: `RevenueHero` deleted — revenue folded back into the
  same 4-tile KPI strip as Orders/Cancelled/Low stock, one tile anatomy for the whole strip.
  **2026-08-03 (Phase 4, PR #84)**: the chart's x-axis now plots real timestamps instead of a
  categorical axis (equal calendar spans get equal pixel width — a flat week and a volatile week no
  longer look visually identical); the series is gap-filled client-side so a missing date renders as
  a real break in the line, never an interpolated zero; the still-accumulating current bucket
  (today/this week/this month) renders dashed with an "in progress" marker instead of implying a
  settled value; a comparison series (previous period / same period last year) overlays as a second
  muted/dashed line with its own tooltip row and delta. **2026-08-03 (Phase 5, PR #85)**: fixed a
  real internal contradiction in fulfillment health (avg-time respected the date range, the "needs
  attention" queue didn't) and in returns (`returnCount` was scoped by the return's approval date
  while its own denominator was scoped by the order's placed date); Order outcomes widget rebuilt
  as a 3-column icon+count/label grid; seeded rows' `__demo__` tag no longer leaks into two
  dashboard widgets (display-only strip, `frontend/src/lib/demo.ts`); delta polarity (which metrics
  are "down is good") now centralized in `StatTile` instead of per-call-site props.

### Businesses, branches and per-branch roles (multi-shop)
- **Status**: shipped — engine F8 (2026-09-07), controls O7 (2026-09-08)
- **What**: One install can run several businesses, each with several branches; a branch is
  either a selling point or a warehouse (`isSellingPoint: false` — not a separate model). Stock,
  orders, delivery, returns and all 18 order-based reports are scoped to the active branch,
  chosen in a topbar switcher. A person can hold a DIFFERENT role at each branch.
- **Where**: `backend/prisma/schema.prisma` (`Business`, `Branch`, `BranchStock`, `UserBranch`),
  `backend/src/services/branches.service.ts`, `branch-roles.service.ts`,
  `backend/src/middleware/branch-context.ts`, `backend/src/routes/v1/branches.route.ts`,
  `frontend/src/components/shell/branch-switcher.tsx`,
  `frontend/src/components/branches/`, `frontend/src/app/[locale]/admin/branches/`.
- **The API**: `GET /branches` (what you may switch to — the list IS the authorisation, so it is
  not behind `requireArea`), `GET /branches/_brand`, `GET|PATCH /branches/:id`,
  `POST /branches`, `GET /businesses`, `POST /businesses`, `PATCH /businesses/:id`,
  `GET|POST /branches/:id/staff`, `DELETE /branches/:id/staff/:userId`.
- **Roles**: the branch role REPLACES the global one, never unions with it — a union would let a
  Marina-only manager reach Downtown by holding any global role at all. OWNER and DEVELOPER are
  business-wide and short-circuit before the roster is read, so they are REFUSED as a branch role
  (a row that the resolver ignores would show an owner a grant that silently does nothing). No
  row means the global role, unchanged — which is what made F8.4 a no-op on upgrade.
- **Who may change the structure**: OWNER/DEVELOPER only, via `requireRole` — deliberately NOT
  `requireArea('settings')`, which MANAGER holds. Reaching the settings page does not imply "may
  open a shop": creating a branch decides where stock and revenue are attributed. READS stay on
  `settings`, so a MANAGER can see the org chart and not change it.
- **Notes**: the roster writes reuse `canAssignRole`/`outranks` from `config/roles.ts` rather
  than reimplementing them — a per-branch grant that skipped the four staff rules would be an
  escalation path AROUND the global rules, not a smaller version of the same feature.
  `Branch.code` is unique PER BUSINESS (two businesses may both have a "MAIN"); a duplicate is a
  409 naming the field, never an untranslated P2002 reaching the handler as a 500.
  Deactivating is never deleting — stock, orders and audit history survive, and the last ACTIVE
  branch of a business cannot be deactivated at all (mirrors the last-OWNER rule; otherwise
  `defaultBranchId()` has nothing to fall back to and the failure surfaces at the point of sale).
  Exactly one branch per business carries `isDefault`, cleared in the same transaction — two
  defaults make `defaultBranchId()` order-dependent, the exact bug F8.2 replaced "oldest branch"
  to fix. Delivery and returns deliberately have NO `branchId` column: both carry a required
  `orderId` and the order already records the branch, so a second copy could drift from it.
- **Still missing**: couriers have no branch of their own (`DeliveryStaff` has no `branchId`) —
  they are filtered by where they have WORKED, so a newly hired courier with no assignments
  disappears from every scoped list. Open question in `TODO.md` O2, not guessed at.
  Inventory/returns/courier lists are scoped but show no branch COLUMN (`TODO.md` O1).

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

### Business-specific nav labels
- **Status**: shipped 2026-08-11
- **What**: An owner can rename a fixed set of 6 nav items to fit their business — "Staff" as
  "Baristas" for a cafe, "Delivery" as "Runs", etc. Renames the sidebar entry, the page's own
  heading, and every breadcrumb/permissions-matrix row that names that area. Display-only: the
  underlying area/resource identifier (`staff`, `orders`, ...) never changes, so no permission
  check, API route, or audit-log action name is affected.
- **Where**: `backend/src/config/settings.config.ts` (`labels.nav.*`, 6 new string settings —
  `staff`/`orders`/`delivery`/`inventory`/`returns`/`reports`; Dashboard/Settings/Audit
  deliberately excluded as too generic to be worth relabeling), `frontend/src/components/
  providers/settings-provider.tsx` (`navLabels` map), `frontend/src/components/shell/
  nav-label-heading.tsx` (new), `frontend/src/components/shell/sidebar-nav.tsx`.
- **Notes**: reuses the EXISTING `Setting` allowlist — no new table, no relaxation of the "every
  setting is individually declared" rule (a single JSON-map-shaped setting was considered and
  rejected to keep that rule intact). Empty string is the declared default and means "use the
  built-in translated label," never a real value. The 6 target pages (`orders`, `inventory`,
  `delivery`, `staff`, `returns`, `reports`) are all Server Components, which cannot read the
  client-side settings context directly — `NavLabelHeading` is a small client component the page
  passes its already-translated default title into, deciding only whether to show that or the
  override, so the pages themselves stay server-rendered. Breadcrumbs on `order-detail.tsx`,
  `order-invoice.tsx`, and `courier-detail.tsx` read the same override (previously called
  `tNav('orders')`/`tNav('delivery')` directly, which would have silently disagreed with a
  relabeled sidebar/heading). `permissions-matrix.tsx`'s area-name column also reads it, for the
  same reason. This is the narrow slice of the long-parked "Onboarding wizard (per-field
  rename/show-hide)" idea (see ROADMAP.md §M2) — field-level rename inside a resource is still
  fully parked; this only covers the 6 top-level nav entries.

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
- **2026-08-11**: reason taxonomy + required rejection reason. New optional `ReturnCategory` enum
  (DAMAGED/WRONG_ITEM/NOT_AS_DESCRIBED/NO_LONGER_NEEDED/ARRIVED_LATE/OTHER) — alongside the
  existing free-text `reason`, not replacing it, so a requester can still describe the actual
  problem in their own words while the category unlocks reason analytics later. Rejecting a
  return now requires a `rejectionReason` — that action previously took zero input at all; the
  reject button reveals a required-reason field before confirming, the same two-step shape Approve
  already used (a resolution has to be chosen first). `ReturnStatus` itself is UNCHANGED — still
  REQUESTED/APPROVED/REJECTED only; the spec's fuller ~8-state lifecycle (label sent → in transit
  → received → inspected → resolved) is a separate, larger, not-yet-started piece of work.

### Password reset (admin-issued)
- **Status**: 🔴 **BACKEND ONLY on this branch — the redemption page is MISSING.** Verified
  2026-09-05: `find frontend/src/app -ipath "*reset*"` returns nothing, and the only copy of
  `/[locale]/reset-password/` lives in unmerged checkpoint `a9c350b`. `POST /auth/reset-password`
  and `frontend/src/lib/auth-api.ts`'s caller both exist — only the page is gone.
  **This also breaks the staff INVITE flow**, which hands a new manager a 24h token pointing at
  a 404, so an invited person cannot sign in at all. Tracked as `TODO.md` **F5.1**.
  The 2026-08-07 note below is kept because it explains the intended design, but its "shipped
  end-to-end" claim is FALSE for this branch — this is the second time this entry has
  overstated the frontend's existence, so verify with `find` before trusting it again.
- **What**: An admin issues a single-use, 30-minute token (`POST /staff/:id/reset-token`); the
  locked-out user redeems it themselves (`POST /auth/reset-password`) to set a new password without
  the admin ever learning it.
- **Where**: `backend/src/services/password-reset.service.ts`, `backend/src/routes/v1/auth.route.ts`,
  `frontend/src/lib/auth-api.ts`, `frontend/src/components/auth/reset-password-form.tsx`,
  `frontend/src/app/[locale]/reset-password/`, `frontend/src/components/staff/reset-token-panel.tsx`.
- **Notes**: HMAC-SHA256 at rest (same shape as courier access codes), atomic claim via
  `updateMany` in the WHERE clause — closes a TOCTOU double-redeem race found during security
  review. Revokes all sessions (`tokenVersion` bump) on redemption.
- **2026-08-07 correction**: this entry previously read "shipped", but the feature was
  **backend-only** — a full-repo grep for `reset-password|resetPassword|reset-token|forgot` in
  `frontend/src` returned zero real matches. There was no button to issue a token and no page to
  redeem one, so a locked-out admin had no UI path back in and the `accessEnded` 403 branch on the
  login form dead-ended. Both halves built 2026-08-07: a `Ticket` row action on the staff table
  revealing the token once (`ResetTokenPanel`, mirroring `AccessCodePanel`'s one-time-reveal
  contract), and a public `/reset-password` page linked from `/login`.
- **Deliberate design note**: the reset form imposes NO client-side password length floor.
  `security.minPasswordLength` is configurable and lives behind an authenticated endpoint that this
  page — by definition used by someone who cannot sign in — cannot read. The server is the sole
  authority and its 400 is surfaced verbatim. `staff-password-panel.tsx` and `staff-sheet.tsx`
  (both authenticated surfaces, unlike the reset form) read the LIVE `minPasswordLength` from
  `useAppSettings()` rather than a hardcoded number — checked 2026-08-11 while archiving stale
  docs, this was previously flagged as an open bug (hardcoded `MIN_LENGTH = 12`) but is fixed.

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
- ~~**Transactional email**~~ — **shipped**, found already merged to `dev` at session start
  (commit `a5ef3a1`, PR via `feat/email-alerts`): `backend/src/services/email.service.ts` sends
  outgoing alert email over plain SMTP (`nodemailer`), gated on three independent conditions (SMTP
  env vars set, `email.enabled` setting on, `email.fromAddress` filled in) — any one missing is
  "not configured," same non-error shape as `upload.service.ts`'s Cloudinary check. Never throws,
  same pattern as `notify()`/`audit()`. This file's "Planned/not started" entry was stale.

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

### Opening a shop, and putting people in it
1. `POST /businesses` (OWNER/DEVELOPER) — only `name` is required; an owner must not need a tax
   id before they can add a product. Unfilled fields fall through to the store-wide settings on
   an invoice, so a blank field is never a blank letterhead.
2. `POST /branches` with that `businessId`. The FIRST branch of a business becomes its default
   whether or not the caller asked, because a business with branches and no default sends
   `defaultBranchId()` back to the ordering-dependent answer F8.2 removed.
3. `POST /branches/:id/staff` with `{ userId, role }` — an upsert on the `[userId, branchId]`
   pair, so re-assigning changes the role rather than failing.
4. Every write calls `audit()` with a real field diff; the roster records BOTH the old and new
   role, since "was FULFILLMENT here, now MANAGER" is the whole question a reviewer asks.
5. The UI reloads after a create/rename — the topbar switcher is mounted in the shell and loads
   once, so a local refetch would leave it stale, and a switcher missing a branch is one an owner
   cannot scope to.

**Files involved**: `branches.service.ts`, `branch-roles.service.ts`, `branches.route.ts`,
`frontend/src/components/branches/`, `branch-switcher.tsx`.
**Failure modes**: duplicate `code` within one business → 409 naming the field (the same code in
a DIFFERENT business succeeds); deactivating the last active branch → 400; granting above your
own rank, editing your own row, touching someone who outranks you, or naming OWNER/DEVELOPER as a
branch role → 403/400 from the shared staff rules.

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

## Conventions

### Drawer vs. page (C4.7)
Not a blanket rule — judged per-surface, per the 2026-08-03 standing note. The two poles already
in the codebase:
- **A full page** (`orders/[id]`, `returns/` detail): the record is the DESTINATION — it has its
  own URL worth bookmarking/sharing/refreshing, carries enough content that a fixed-width drawer
  would cramp it (invoice, status timeline, line items), and is often the target of a deep link
  from elsewhere (audit trail, notifications).
- **A Sheet** (every generic resource create/edit via `resource-form.tsx`, staff/courier panels):
  the action is a brief DETOUR from a list the user is coming right back to — no standalone URL,
  content is a short field set, and staying on the list underneath (visible at the Sheet's edge)
  is itself useful context.
When adding a new mutable surface, ask which pole it's closer to rather than copying whichever
pattern happens to be nearby. A surface that's genuinely ambiguous (long content, but reached only
from one list and never linked to directly) is where "judge per-surface" actually earns its
keep — don't resolve the ambiguity by picking whichever is less code to wire up.

## Current work
- **`TODO.md` is the master task list — read it, not this file, for what's open.** This
  file describes what the system IS; that file says what is LEFT. **Every other task list has
  been folded into it** — `MASTER_TODO.md`, `O7-PLAN.md`, `.claude-workbook/NEXT-STEP.md` and
  the older `TODO.md` no longer exist, so a reference to any of them in an older doc is stale.
  `SETUP_TODO.md` stays separate ON PURPOSE: it is config, secrets and hosting decisions only
  the owner can make, and merging it would bury "generate fresh secrets" among eighty
  engineering tasks. `.claude-workbook/ROADMAP.md` is the historical archive — read it for the
  reasoning behind decisions already made, never for what is open.
- **2026-09-08 — Track F, Track F8 and O7 are all DONE.** Latest work is O6 (a courier-portal
  bug) and O7 (business/branch/roster CRUD, all four stages) — see the Changelog. Next open
  items, in the order `TODO.md` recommends: **O1** (branch column on the inventory, returns,
  courier and order lists — no decisions needed), then **O3/F5.3-5.4** (every role lands on the
  same revenue-first dashboard), then the schema-gated tracks.
- **Two questions are waiting on the owner and block real work**: **O2** — does a courier belong
  to ONE branch or serve several (`branchId` on `DeliveryStaff` vs. a join table)? Everything
  else in O2 waits on it. **O5.1/F6.1** — the `Shift` model's shape; a till session and a shift
  are the SAME object, so answering it unblocks both the shifts track and the POS track.
- **2026-09-05 — Track F opened: four gaps the owner raised directly.** (1) revenue vs. cost,
  (2) login history, (3) how to add items and stock, (4) reports are vague and unclear. Recon
  found **three of the four were already partly built**, so most of the work is surfacing and
  explaining what exists rather than building from zero — each item in `TODO.md` states
  what already exists before what is missing, specifically so nothing gets rebuilt twice.
  **F1 (revenue vs. cost) is done**; F2/F3/F4 are open. See the 2026-09-05 Changelog entry.
- **2026-09-05 — the profit bug worth remembering.** `getProductMargin` joined `products.cost`
  LIVE, so a supplier price change silently rewrote the recorded profit on every order already
  in the book — the exact drift `OrderItem.price` exists to prevent, on the other half of the
  equation. Fixed by snapshotting `OrderItem.cost` at sale time. **Generalise the lesson**: any
  figure describing a past event must read a snapshot, never a live lookup. `Order.total`,
  `OrderItem.price`, `Order.subtotal`/`taxAmount` and now `OrderItem.cost` all follow this rule;
  a new one should be checked against it before it ships.
- **Still needs a human:** ~~(1) the unlinked 2FA / sessions / API-key panels~~ — **DONE
  2026-09-08**, all three mounted next to My account. That gap turned out to matter more than
  "a small follow-up": because 2FA could not be switched on from the UI, nobody could reach the
  fact that the 2FA LOGIN had no code-entry screen at all — `signIn` returned
  `TWO_FACTOR_REQUIRED` and the form redirected to `/admin` with no session, so an account with
  2FA enabled could not sign in. Both halves fixed the same day (TODO.md O3b). The lesson is the
  F5.1 one again: a backend flow whose frontend half was never built stays invisible while the
  feature that reaches it is also unreachable. (2) `order-detail.test.tsx` has one `it.skip`
  (`includes the chosen category when one is selected`) to unskip once both the orders PR and the
  return-taxonomy PR are on `dev` — the skip is commented in place.
- **Schema-gated work still open** — `TODO.md` (was MASTER_TODO Track D §S7): S7.1 Address model, S7.3
  payment/transaction model, S7.4 split status axis, S7.5 Location model, S7.6 Category tree,
  S7.8 fuller ReturnStatus lifecycle, S7.9 tags. None started. (F1.1's `OrderItem.cost` was a
  Track-D-shaped migration but is recorded under Track F, where the work actually happened.)
- **dev → main G-GATE** — **the Render item is void, not open**: Render is gone (2026-09-03).
  What genuinely remains: **Sentry DSN in prod** is on hold, not merely unconfigured — the user's
  trial ended. **E2E** — `.github/workflows/e2e.yml` is still written around Vercel preview URLs
  and `RENDER_DEV_BACKEND_URL`; it is disabled so it breaks nothing, but it needs rewriting for
  Coolify before the `pull_request` trigger can come back. **Arabic review** — 1630 keys, en/ar
  parity holds at 1630/1630, but the MSA is machine/self-translated and unreviewed; a
  native-speaker pass still blocks any client demo. It is NOT self-certifiable.
- **Design Fix Checklist** (phased dashboard/settings/shell redesign): Phases 1-5 built and PR'd
  (#80, #82, #83, #84 merged; #85 open), plus #86 (Tooltip primitive, open — not part of the
  checklist). **Phases 6-7 remain** (full Settings rebuild, sidebar IA regrouping) and are
  **blocked**: the text of Phases 6-7 was never transcribed into this repo, only into the
  conversation that pasted it, and Phase 6's own 6.41 stop-gate needs the original numbered
  items. **Ask the user to re-paste before starting Phase 6** — do not reconstruct it from
  memory. Four standing user notes from 2026-08-03 are earmarked for it: a field change must
  surface a dirty-state signal BEFORE Save, not just after; some notification types need an icon,
  not colour alone (this is about the Toaster — #86's Tooltip is unrelated groundwork);
  drawer/modal conversions are NOT a blanket rule, judge per-surface; some fields (e.g. review
  content) must stay read-only for integrity even though the resource engine would allow editing
  (really Phase 8's recon to identify — Phase 6 just must not contradict it).
- **In progress**: nothing uncommitted-and-unreviewed. The six-skill pass requested on 2026-07-31
  (`project-foundations`, `project-docs`, `project-error-log`, `project-ship`, `project-test-gen`,
  `ux-animation-reviewer`) is still outstanding.
- **Next step**: see `TODO.md`. (This line named F3.1-F3.3 + F4.1, all since shipped.) Highest value per line
  changed, no schema dependency, independently shippable. F4.1 (put each metric's definition on
  screen) is the core of the "reports are vague" complaint; a definition-tooltip pattern already
  exists in exactly one place (`reports-view.tsx`, the `averageOrderValue` tile) — extract that
  rather than writing a second. Then F2 (login history, self-contained), then F1.3.
  Also still open, from §U (ROADMAP.md): the one remaining in-flight-state gap
  (`staff-password-panel.tsx`), optimistic row updates, bulk-action progress, and the
  loading-overlay-blur / nav-transition-smoothness items. The nav-hover-guide item is likely
  already covered by #86 as a side effect — re-verify before treating it as remaining work.
- **Blockers**: three, all waiting on the user, none blocking Track F.
  (1) **Design Fix Checklist Phase 6** — needs its original text re-pasted (see above).
  (2) **Setup/Schema wizard** — blocked on an architecture decision (compiled-TS config vs. a
  DB-backed override layer); not started, not in scope.
  (3) **Two Track F items need a decision before they start** — F1.4's landed-cost question
  (should receiving stock capture that batch's unit cost, and if so FIFO or weighted average?)
  and F3.5's bulk receive. Both are flagged in `TODO.md` rather than guessed at.
- **Context to remember**:
  - **New 2026-09-03 rule — env files: `.env` + `.env.local` per side. NOTHING is committed.**
    No `.env.example`, and no `.env.fluffy`/`.env.dev`/`.env.staging` per-target variants (a
    deleted `backend/.env.fluffy`, its own DB `fluffy_cookies` on port 4001, is what prompted
    this). `.gitignore` no longer whitelists `.env.example` — do not re-add that whitelist, and
    do not recreate the file. The user does not want his setup shared with everyone who can read
    the repo, so "the values are only placeholders" and "a fresh clone needs a template" are NOT
    reasons to override this; both were argued once and rejected. Environment differences belong
    in `NEXT_PUBLIC_APP_MODE` (see the rule below) or in the host's own service env vars, never in
    a new file. **The same applies beyond env files**: do not write hosting/deployment/infra
    details into any committed file. This file (CLAUDE.md) is the right place for them.
  - **Hosting moved to Hostinger + Coolify (2026-09-03).** Vercel and Render are GONE — ignore any
    older note in this file or in `ROADMAP.md` that treats them as live, including the whole
    `dev → main` G-GATE item about "Render redeploy status". The `hostinger-coolify-hosting` skill
    covers this setup. Still stale and not yet rewritten: `.github/workflows/e2e.yml` (built around
    Vercel preview URLs + `RENDER_DEV_BACKEND_URL`; already disabled, so it breaks nothing).
    `frontend/src/middleware.ts`'s `_vercel` matcher exclusion is harmless and was left alone.
    **The user's dev/prod backend URLs are not yet known** — `NEXT_PUBLIC_API_URL_DEV`/`_PROD` are
    deliberately EMPTY placeholders in `frontend/.env`. Local is the only
    working target right now; the user will fill the others in later. Do not invent a value.
  - **New 2026-08-23 rule — the frontend API URL is mode-driven, never inferred.**
    `frontend/src/lib/api-config.ts` is the ONLY place the API base URL is resolved. Set
    `NEXT_PUBLIC_APP_MODE` to `local` | `dev` | `prod` (unset = `dev`) and provide the matching
    `NEXT_PUBLIC_API_URL_LOCAL` / `_DEV` / `_PROD`. There is deliberately **no fallback** — the
    old `process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'` in `api.ts` and
    `courier-api.ts` meant a deploy that lost the variable shipped a bundle calling the
    *visitor's own machine*, failing as an unexplained network error naming nothing. The module
    throws at module scope (so `next build` goes red) if the active mode has no URL, if a
    `dev`/`prod` URL is a loopback host, or if a `local` URL is remote (that mirror guard stops
    local testing writing to shared data). Legacy `NEXT_PUBLIC_API_URL` is still honoured as an
    override but is subject to the same guards. `NEXT_PUBLIC_ENV` is a SEPARATE axis, untouched —
    it still drives Sentry's environment tag only. `frontend/vitest.setup.ts` declares
    `local` + a localhost URL for the test run, since ~40 suites import `lib/api` transitively.
  - PRs #85 and #86 (this session) are pushed and open; merging is the user's call per standing
    instruction.
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
  - **New 2026-08-11 rule**: never run a frontend production `next build` while a `pnpm dev`
    frontend server is live in the same `frontend/.next` directory — the two processes write
    incompatible artifact shapes into the same cache, and the dev server starts throwing
    `Cannot find module './vendor-chunks/...'` / React Client Manifest errors that look like a
    code regression but are pure build-cache corruption. This is how a real incident happened
    2026-08-11 right after a `next build` verification step in the same session as a live `pnpm
    dev`. Fix: stop the dev server, `rm -rf frontend/.next`, restart `pnpm dev`. Before running
    `next build` as a verification step, check whether a dev server is already running first.
  - Full detailed roadmap, security log (S1–S10) and parity-audit-against-template (§M) live in
    `.claude-workbook/ROADMAP.md` — read it for anything this file summarizes too tersely.

## Changelog
- **2026-09-10 (UX-009)** — POS checkout is idempotent across lost responses and simultaneous
  submissions. A generic actor-scoped record stores a canonical request hash and response in the
  same transaction as order/payment/stock writes; mismatched reuse returns 409, successful replay
  returns the original receipt, and the till retains its UUID until checkout details change.
  Seven-day daily cleanup prevents unbounded growth. Focused concurrency coverage, both full test
  suites, lint, typechecks, builds, merge integrity and GitGuardian passed locally or in GitHub PR
  #195; Batch 1 is closed.
- **2026-09-08 (O6 + O7)** — The controls F8 never shipped. F8 built the multi-shop ENGINE
  (businesses, branches, per-branch stock, query scoping, per-branch roles, a switcher) and left
  every row creatable only by a migration or the seeder: `UserBranch` was read-only, there was no
  `POST /branches` and no `POST /businesses`, so an owner could not open a second shop without a
  developer running SQL, and the per-branch-role feature could not actually be used. Four stages,
  40 new tests:
  **Stage 1 (write API)** — `POST /businesses`, `PATCH /businesses/:id`, `POST /branches`,
  `GET /businesses`; the pre-existing `PATCH /branches/:id` re-routed through the service so the
  new guards apply to it too. Three guard decisions taken rather than defaulted, all as
  recommended in the plan: OWNER/DEVELOPER only (not `requireArea('settings')` — MANAGER holds
  it); the last active branch cannot be deactivated; a deactivated branch keeps its stock and
  orders. Duplicate `code` → 409, `isDefault` cleared in the same transaction.
  **Stage 2 (roster)** — `POST|GET /branches/:id/staff`, `DELETE /branches/:id/staff/:userId`.
  The four staff rules are IMPORTED from `config/roles.ts`, not reimplemented: a per-branch grant
  that skipped them would be an escalation path around the global rules. One rule added —
  OWNER/DEVELOPER refused as a branch role, since the resolver ignores such a row and an owner
  would see a grant on screen that does nothing.
  **Stage 3 (UI)** — `/admin/branches` grouped by business, a Sheet for a branch and a full page
  for a business (the drawer-vs-page convention judged per surface, not copied), a roster panel
  showing BOTH roles per person, empty states that explain what a business IS, and 79 new keys
  per locale (parity 1630/1630, Arabic using a real ICU plural with two/few/many).
  **Stage 4 (tests)** — written alongside 1 and 2, not after. **Every guard was watched failing
  before its code went in**: swapping `requireRole` for `requireArea`, disabling the last-branch
  check, disabling the four staff rules, and removing the switcher reload each turn exactly the
  intended tests red.
  **One planned item was corrected rather than implemented**: 4.4 asked that a created branch
  appear in the switcher "without a reload". The switcher is mounted in the shell ABOVE the page
  and holds its own state, so a local refetch updates the list and leaves the switcher stale —
  the deliberate full reload is the fix, and the test now asserts it.
  **Also fixed: O6**, the courier card-blanking bug — see the Delivery section.
  Verification: backend 890/890 (41 files), frontend 1027/1027 + 1 skipped (114 files), tsc and
  eslint clean both sides, en/ar parity 1630/1630. `next build` was NOT run locally: a dev server
  was live on :3000 and building into the same `.next` corrupts it, and no new component calls
  `useSearchParams`/`useParams`, which is the hazard that check exists to catch.
- **2026-09-05 (Track F, batch 1)** — Four gaps raised directly by the owner became `MASTER_TODO.md`'s
  **Track F**: revenue vs. cost, login history, adding items/stock, and reports being vague.
  Recon found **three of the four already partly built** — 34 report endpoints and 27 pages
  already exist, stock adjustment and product creation both work, logins are already audited and
  a `Session` model already exists — so the track is written as surfacing/explaining work, with
  each item stating what exists before what is missing. **F1 shipped:**
  (a) **A real correctness bug fixed** — `getProductMargin` joined `products.cost` LIVE, so
  editing a supplier price silently rewrote the recorded profit on every past order. Now
  snapshotted on the order line (`OrderItem.cost`, migration
  `20260905000000_add_order_item_cost_snapshot`, additive + nullable + deliberately never
  backfilled, since inventing a past cost is exactly what the column exists to prevent). A
  regression test edits a product's cost and asserts past COGS does not move.
  (b) `productsWithoutCost` → **`orderLinesWithoutCost`** — the unit genuinely changed, because
  one product can now have both costed and uncosted lines, and counting products would place it
  in the table AND in the excluded count simultaneously.
  (c) **Gross profit + gross margin on the dashboard**, each carrying a "Based on N of M order
  lines" coverage note. Margin is measured against the costed subset's OWN revenue — subtracting
  partial COGS from total revenue would invent profit on every uncosted line. The KPI strip went
  4-up → 3-up (six tiles divide evenly at three, not four).
  (d) `StatTile.value` now accepts `null` and renders an em dash, so a margin that cannot be
  computed never renders as a fabricated `0%`; a genuine measured `0` still renders as `0`, and
  both cases are tested.
  Also this session: **every planning doc rewritten against actual repo state** — `SETUP_TODO.md`
  still named Aiven/Render/Vercel and told you to set `DATABASE_URL`/`CORS_ORIGINS`/
  `NEXT_PUBLIC_API_URL`, none of which exist after the mode split, so following it would have
  produced a backend that refuses to boot; `MASTER_TODO.md`'s handoff header pointed new sessions
  at Track A with test counts four weeks stale; `.claude-workbook/NEXT-STEP.md` still called
  itself "the one file to read before doing anything" while having been empty for a month.
  Verification: backend 817/817 (37 files), frontend 986/986 + 1 skipped (108 files), tsc and
  eslint clean both sides, en/ar parity 1459/1459.
- **2026-09-05** — Backend `APP_MODE` env split, mirroring the frontend's 2026-08-23 API-URL rule
  (see the Context-to-remember entry above for the full contract). New
  `backend/src/config/app-mode.ts` resolves `DATABASE_URL`/`CORS_ORIGINS` from an explicit mode
  with no fallback and a both-directions host guard; `env.ts` resolves before the Zod parse and
  writes the result back into `process.env` so Prisma cannot end up on a different database than
  the app; new `backend/scripts/with-db-url.mjs` puts every `db:*`/`demo:*` script behind the same
  guards, since the Prisma CLI never runs app code. `backend/.env` moved from one `DATABASE_URL`
  with alternatives commented out to per-mode variables.
  **Two real findings, neither of which was the thing being worked on:**
  1. **Local backend test runs were hitting the PRODUCTION database.** (Recorded first as "the
     shared dev database"; the owner clarified on 2026-09-05 that the Coolify MySQL *is*
     production and no dev database exists — so this was a P0, not a P1.) `vitest.setup.ts`
     loads `.env` before applying its `??=` CI fallbacks, so the fallback never fired — the real
     `DATABASE_URL` won every time. Closed with a hard `APP_MODE = 'local'` pin. Worth assuming
     this had been true for as long as that file has had a `.env` to load.
  2. The wrapper's `shell: true` on Windows resolves via `PATH`, which excludes
     `node_modules/.bin` — so `prisma`/`tsx` worked under pnpm but a hand-run failed with
     "'tsx' is not recognized", which reads like a missing dependency. The wrapper now prepends
     that directory itself. Reported by a parallel session that hit it live.
  Verified: 817/817 backend tests, `tsc` + `eslint` clean, all 12 resolver branches exercised
  (including refusing local→remote, and parsing a raw `@` inside a password, which naive
  string-splitting gets wrong). Ran alongside a second session doing the F1 revenue-vs-cost work;
  file sets were disjoint and confirmed so by direct exchange. That session applied its
  cost-snapshot migration *through* this wrapper, which printed
  `[with-db-url] APP_MODE=local → localhost:3306/admin_dashboard` before the `ALTER TABLE` — the
  first real use of the guard, and it did its job.
- **2026-08-12** — Split ~47k uncommitted lines (145 modified files + 230 new paths, roughly a
  week of work) into 14 reviewed PRs. Merged: #99 deps/config, #100 table-infrastructure,
  #101 auth-stack, #102 delivery-failed-attempt. Opened: #103 schema+order-enhancements,
  #104 reports-suite, #105 policies-cms, #106 return-reason-taxonomy, #107 global-search,
  #108 resource-import-export, #109 staff-invite-and-self-service, #110 demo-data-management,
  #111 courier-detail-page, #112 translation-completeness. Every branch was verified
  independently (`tsc --noEmit` on both sides plus the full frontend suite) before its PR opened.

  **Four findings reshaped the split, and are worth remembering:**
  1. **A planned split does not survive contact with the imports.** The original plan had 26
     branches; tracing real imports collapsed five of them into one `auth-stack`, because
     `authenticate.ts` ↔ `authorize.ts` ↔ `audit.service.ts` are genuinely fused — the IP-allowlist
     and 2FA-required checks are *called from* the same function that forks between session and
     API-key auth, and both write `auditDenied()`. There was no seam to cut. Same for the eight
     order-detail features sharing three files. Trace imports BEFORE promising a branch boundary.
  2. **The dev DB was already ahead of `dev`'s code.** All 25 migrations were applied to the live
     dev database in one 18-second batch on 2026-08-11 — the tail of that session, never committed.
     This is why most branches' backend suites fail locally on `orders.internal_notes` while CI
     (its own MySQL) is fine. **A DB-vs-code mismatch is not automatically drift**: mid-split I
     "fixed" a missing `orders.internal_notes` by re-adding the column, when a later migration had
     correctly DROPPED it — reverted, no data lost, but check the migration history before
     touching a shared DB.
  3. **`en.json`/`ar.json` are one shared file per locale**, so every branch needed its own keys
     extracted surgically rather than taking the file wholesale. Same for `orders.test.ts` and
     `order-detail.test.tsx`, which each mix 5-8 features' tests in one file.
  4. **Type-to-confirm phrases must stay identical across locales** and are allowlisted in
     `messages.test.ts`: the string shown is the string compared, so translating one side would
     break the safeguard in that locale with no visible failure. Same allowlist covers genuine
     loanwords (UTC, CSV, PDF).
- **2026-08-11** — Three schema-gated fixes from the ordered TODO backlog, each with its own
  migration, run one at a time (never in parallel — migrations touch the same shared local dev
  DB): (1) courier failed-delivery path — `FAILED_ATTEMPT` status, re-triable not terminal,
  `attemptCount`/`failureReason` on `DeliveryAssignment`, reset on reassignment; (2) invoice
  tax/subtotal breakdown — new `store.taxRate` setting, `subtotal`/`taxAmount` on `Order`,
  `total`'s existing grand-total meaning deliberately preserved so Reports/Dashboard needed zero
  changes; (3) return reason taxonomy — optional `ReturnCategory` enum alongside the existing
  free-text reason (not replacing it), rejecting a return now requires a reason (previously took
  none). All three: full backend + frontend suites green, `tsc`/`eslint` clean on both sides.
  Also shipped same session: business-specific nav-label renaming (see § above) — reuses the
  existing `Setting` allowlist, no new table, unblocks part of the long-parked "Onboarding
  wizard" idea in ROADMAP.md §M2. Verified both dev servers start clean from a wiped `.next`
  cache with no stale-build errors. **Recurring issue surfaced, not resolved**: the local
  `_prisma_migrations` tracking table disappeared three separate times mid-session (real schema
  tables and data were untouched each time — confirmed via direct query — so nothing was lost,
  just re-baselined via `prisma migrate resolve --applied`). Root cause not found: MySQL server
  uptime was 11 days (no restart), no script in this repo drops that table, and it recurred even
  with zero dev servers running. Also found and killed two duplicate `pnpm dev` backend processes
  that had been running simultaneously since the prior afternoon, holding a lock on the Prisma
  query-engine DLL — a real contributor to at least the EPERM symptom, possibly not the whole
  story on the missing-table symptom. Worth the user's own investigation (container/volume,
  backup script, DB GUI tool) since it's outside what this session could observe.
- **2026-08-04** — dev → main G-GATE session: found transactional email (§ above) already shipped
  on `dev` from a prior session (`a5ef3a1`), CLAUDE.md was stale on that. Re-wired `e2e.yml` for
  Option A (persistent dev backend via `RENDER_DEV_BACKEND_URL`, dropping the Render-preview-wait
  job entirely) — kept the `pull_request` trigger disabled since the dev backend's DB is local-only
  right now, so a live run would fail everything without proving anything real. Generated a
  filterable en/ar review-sheet Artifact (744 keys, 18 heuristically flagged) for the user's own
  native-speaker review pass. Confirmed Render-redeploy status and prod Sentry DSN are both
  open questions only the user can answer — not attempted from the repo. No code behavior changed;
  `PasswordResetToken`/audit/returns/etc. untouched.
- **2026-08-03 (even later)** — Real Tooltip primitive (PR #86, open; not part of the 7-phase
  checklist, an older-backlog item picked up between phases): `components/ui/tooltip.tsx`
  (Radix, matching Popover/AlertDialog conventions), `TooltipProvider` mounted once in the root
  layout. Applied to the collapsed sidebar rail, replacing a plain `title` attribute a code comment
  had already marked as a stopgap for exactly this. `side` computed from the locale rather than
  `document.dir`, avoiding an SSR/hydration mismatch on Arabic pages.
- **2026-08-03 (later)** — Design Fix Checklist Phase 5 (PR #85, open): five real data-integrity
  bugs on the dashboard, found via a fresh Phase-0-style recon rather than assumed from an older
  summary. `__demo__` seed-tag no longer leaks into the fulfillment "needs attention" queue or
  recent-activity feed (display-only strip). Fulfillment health's attention queue now respects the
  selected date range — it used to ignore it while the average-time half of the same widget didn't,
  a real internal contradiction, not just a design preference. Returns' `returnCount` was mixing two
  different date fields against its own denominator (the return's approval date vs. the order's
  placed date), disagreeing with Order Outcomes' RETURNED count for the same window — re-scoped to
  match. Delta polarity ("down is good" for cancellations/pending/low-stock) centralized into one
  descriptor instead of relying on every `StatTile` call site to pass `invertDelta` correctly by
  hand. "Cancelled" → "Canceled" to match the rest of the app (en + ar). Order outcomes widget
  rebuilt as a 3-column icon+count/label grid — iterated once in-session from an initial vertical-
  list version after the user sent a screenshot asking for a better use of the card's width.
- **2026-08-03** — Design Fix Checklist Phase 4 (PR #84, merged): the dashboard/reports revenue chart
  moved from a categorical x-axis (equal spacing per data point regardless of real date gaps) to a
  real time-scale axis over a client-side gap-filled series (a missing date is a real gap, never a
  fabricated zero — consistent with the reports service's existing "never fabricate a value" rule).
  The current in-progress bucket renders dashed with an explicit marker rather than looking settled;
  a single-bucket range renders as a stat instead of a one-point line; a period-comparison overlay
  (reusing Phase 2's existing selector) shows a second muted/dashed line with its own tooltip row and
  delta; point markers restored; keyboard-accessible tooltip via Recharts' `accessibilityLayer`
  (already on by default in v3, no custom keydown handler needed).
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
