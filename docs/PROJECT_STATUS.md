# admin-dashboard — Project Status

Living status of the rebuild. Updated at the end of each migration group.

**Last updated:** 2026-07-26 · **Current group:** 1 of 14 (`feat/data-model`)

---

## Migration progress

| # | Group | Status |
|---|---|---|
| 1 | `feat/data-model` — Prisma schema, migration, seed | **in review** (PR #27) |
| 2 | `feat/auth` — JWT login, bcrypt, brute-force protection | **in review** |
| 3 | `feat/rbac` — 5-role permission map | not started |
| 4 | `feat/motion-system` — GSAP foundation | not started |
| 5 | `feat/ui-primitives` — shadcn components | not started |
| 6 | `feat/app-shell` — layout, sidebar, topbar | not started |
| 7 | `feat/login-page` — login UI | not started |
| 8 | `feat/dashboard` — KPIs, charts | not started |
| 9 | `feat/products` — CRUD, images | not started |
| 10 | `feat/orders` — list, detail, status, invoice | not started |
| 11 | `feat/customers` — list, detail, history | not started |
| 12 | `feat/inventory-discounts` | not started |
| 13 | `feat/delivery` — staff, assignments, portal | not started |
| 14 | `feat/settings-staff` | not started |

---

## Open / deferred

Things known to be missing. Nothing here is an accident — each was a deliberate
scope call, and each needs to be decided rather than forgotten.

### Security gaps — none of these exist yet

Recorded here **and** in `.claude-workbook/errors-log.md`. All are absent by
default, not broken by a bug — the auth layer simply hasn't been built. They
must not stay absent once real users have accounts.

| Gap | Risk if shipped without it | Priority |
|---|---|---|
| ~~**Brute-force protection on `/auth/login`**~~ | **CLOSED in group 2.** Two layers: per-IP rate limit (10 / 15 min, failed attempts only) and per-account lockout (5 attempts → 15 min). Both needed — IP limiting misses a distributed attack on one email; account lockout misses one IP spraying many accounts. ⚠️ The rate-limit store is **in-memory**, so counts are per-process. Correct on Render's single free instance; needs Redis before scaling to multiple instances or an attacker multiplies their budget by the instance count. | done |
| **Audit log** | No record of who changed or deleted a record. In a dashboard where staff edit orders and refunds, "who did this" is unanswerable — and unanswerable retroactively. | **HIGH** |
| **Password reset / forgot-password** | A locked-out admin needs a developer with DB access. Also blocks staff invites and any transactional email. | **HIGH** |
| **Token revocation / session control** | A stolen JWT is valid until it expires, with no way to kill it. No refresh tokens, no revocation list, no "sign out other sessions". | **HIGH** |
| **2FA / MFA** | Admin accounts protected by a password alone. | Medium |

### Feature gaps

| Feature | Notes | Priority |
|---|---|---|
| **Bilingual AR/EN + RTL** | Relevant to the UAE/PDPL context. Cheaper to build in from the start than to retrofit — every component and layout is affected. Decide before Phase 3 pages get built. | Medium |
| **Bulk actions + export on DataTable** | CSV/Excel export, multi-select delete/edit. Expected in any admin dashboard. | Medium |
| **E2E / visual QA** | Playwright is configured but the workflow is disabled (no Render preview URL — see `.github/workflows/e2e.yml`). One placeholder spec exists. | Medium |

### Technical debt carried deliberately

- **Money is `Decimal(10,2)`.** Prisma returns a Decimal.js instance, not a
  number. Two rules follow, and they are easy to get wrong:
  - `JSON.stringify` renders it as a **string** — API responses carry `"49.99"`.
  - `+` and `*` do **not** work. `price * qty` yields `NaN` or a concatenated
    string. Use `.times()` / `.plus()`.
  - **Needed:** a shared money serialisation helper so every route formats the
    same way, rather than each one deciding independently.
- **Coverage thresholds are 0** in both vitest configs. `project-test-gen`
  raises them once real tests exist.
- **`prisma.config.ts` not adopted.** Prisma 6 warns that `package.json#prisma`
  is deprecated, but the replacement config file is a Prisma **7** feature and
  6.x rejects it. Migrate as part of the Prisma 7 upgrade (Dependabot PR open).
- **E2E workflow disabled.** Manual trigger only until a real backend preview
  URL exists. `Playwright` is deliberately **not** a required status check.

### Dropped from admin-template — not coming back unless asked

Config engine (`admin.config.js` + generic `/r/:resource`), AI config drafter,
live DB introspection, `demo` and `custom` roles, per-user `custom_permissions`
JSON, `USE_FILE_DATA` mock mode, runtime theme/density customization.

---

## Current work

**Group 1 — `feat/data-model`.** 12 Prisma models, one migration, idempotent
seed. Awaiting review.

## Next

Group 2 — `feat/auth`. The brute-force gap above should be closed **in that
group**, not deferred: adding rate limiting to a login route that already exists
is harder than building it in.
