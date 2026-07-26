# admin-dashboard — Feature Inventory & Roadmap

What the dashboard does, what it will do, and what it deliberately doesn't.

**Last updated:** 2026-07-26

---

## Shipped

| Feature | Where |
|---|---|
| Health check with DB reachability | `GET /api/v1/health` |
| Structured logging with per-request correlation | `backend/src/logger.ts`, `middleware/requestContext.ts` |
| Error envelope shared FE↔BE | `middleware/errorHandler.ts`, `frontend/src/lib/api.ts` |
| Design token system, light + dark | `frontend/src/app/globals.css` |
| Domain data model (12 models) | `backend/prisma/schema.prisma` |

## In progress

| Feature | Group |
|---|---|
| Domain data model + seed | 1 — in review |

## Planned

Ordered by migration group. See `PROJECT_STATUS.md` for the full schedule.

**Auth & access** — JWT login, bcrypt hashing, session handling (group 2) ·
5-role RBAC: developer / owner / manager / fulfillment / support (group 3)

**Shell & UI** — GSAP motion system (4) · shadcn primitives (5) · app shell with
sidebar and topbar (6) · login page (7)

**Feature pages** — dashboard KPIs and charts (8) · products (9) · orders with
status history and invoices (10) · customers (11) · inventory and discounts (12) ·
delivery staff, assignments and courier portal (13) · settings, staff,
notifications (14)

---

## Roadmap — security

**None of these exist yet.** Listed in priority order. Each is also recorded in
`PROJECT_STATUS.md` (Open/deferred) and `.claude-workbook/errors-log.md`.

### 1. Brute-force protection on `/auth/login` — HIGH
`express-rate-limit` plus a per-account attempt counter and temporary lockout.
Rate limiting by IP alone is insufficient — it doesn't stop a slow distributed
attack against one known admin email.
**Build this in group 2, alongside the login route.** Adding it afterwards means
touching a route that already has traffic. Needs a test proving lockout triggers.

### 2. Audit log — HIGH
Who changed or deleted which record, when, and old → new values. Written at a
single CRUD choke-point so no write path can bypass it.
`OrderStatusHistory` already does this for order status only; this generalises it.
Without it, "who refunded this order" has no answer, and it cannot be
reconstructed after the fact.

### 3. Password reset / forgot-password + email transport — HIGH
Unblocks three things at once: self-service resets, staff invitations, and any
transactional alerting. Currently a locked-out admin needs direct DB access.

### 4. Token revocation / session control — HIGH
Refresh tokens, a revocation list, an active-sessions view, and "sign out this
session". Today a stolen JWT stays valid until expiry with no way to kill it.

### 5. 2FA / MFA for admin accounts — Medium
TOTP. Meaningful once the above four exist; before that it guards a door with
other doors left open.

---

## Roadmap — product

### Bilingual AR/EN with RTL — Medium
Relevant to the UAE/PDPL context. **Decide before group 8.** Retrofitting RTL
touches every component, layout, and icon; building it in from the first page is
far cheaper. The `bilingual-en-ar` skill covers the approach.

### Bulk actions + export on DataTable — Medium
CSV/Excel export, multi-select delete and edit. Standard expectation for an admin
table. Design the DataTable in group 5 with selection state in mind, even if the
actions land later.

### E2E / visual QA — Medium
Playwright coverage for critical admin flows: login, order status transition,
product create/edit, permission denial. Runner is configured; the workflow is
disabled until a real backend preview URL exists.

---

## Explicitly not building

Carried over from admin-template and dropped on purpose. Recorded so the absence
reads as a decision rather than an oversight.

| Dropped | Why |
|---|---|
| Config-driven CRUD engine (`admin.config.js`, `/r/:resource`) | Replaced by purpose-built typed pages. The indirection is what made the old codebase hard to reason about, and it fights strict TypeScript. |
| AI config drafter | Only meaningful with the config engine. |
| Live DB introspection | Same. |
| ~~`demo` role~~ | **Reinstated in group 3** with a clearer purpose and a much simpler implementation than the old one — see "Demo mode" below. The original drop was reasonable given how the old system tangled it into every permission check; this version doesn't. |
| `custom` role | Kept out. Per-user permission JSON meant every check had to special-case it. Re-add only if a real need appears. |
| Per-user `custom_permissions` JSON | Same reasoning. |

---

## Demo mode

A `DEMO` staff role for showing prospective clients the real dashboard, with
real data, and no possibility of them changing anything.

**Reads everything, writes nothing.** Full visibility across every area is the
point — a demo that hides half the product isn't a demo.

**How write-blocking is enforced**, because the mechanism is the interesting
part:

- Deny-by-default on the **HTTP method**. Anything that isn't `GET`/`HEAD`/
  `OPTIONS` is a write, and writes are refused for read-only roles.
- The check lives inside `authenticate`, so it runs the instant identity is
  established. **Every authenticated route inherits it automatically** — a new
  `POST` route added six months from now is demo-safe without anyone
  remembering to guard it.
- The alternative — a `canWrite` check in each write handler — fails silently
  the first time someone forgets, because the demo user simply succeeds.

**Two implementation notes worth knowing:**

1. It is *not* app-level middleware. Mounting it in `app.ts` would run it before
   any route's `authenticate`, so `req.user` would always be undefined and every
   write would pass through unchecked. This was caught during group 3 and is
   documented in `authorize.ts` so nobody "simplifies" it back.
2. The guarantee is scoped to **authenticated routes**. A route that omits
   `authenticate` is public anyway, so demo-blocking is moot there.

**Still to do for a complete demo experience:**

- A visible in-app banner ("read-only demo") so a client understands why an
  action didn't take effect — the API returns a clear 403, but the UI should
  never let them hit it in the first place.
- A demo account seeder with realistic volumes of data, not the 6 products the
  dev seed creates.
- Optionally, auto-resetting demo data on a schedule.
| `USE_FILE_DATA` mock mode | A real dev database exists; a divergent mock path is a source of "works in mock, breaks live" bugs. |
| Runtime theme/density customization | The design token system covers theming. Runtime density is a product feature, not infrastructure. |
