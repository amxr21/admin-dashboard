# TODO — the one list

Updated 2026-09-07. **This is the only task list.** `MASTER_TODO.md`,
`O7-PLAN.md` and the old `TODO.md` were merged into this file; `SETUP_TODO.md`
stays separate on purpose (it is the OWNER's config/secrets checklist, not code
work).

**`SETUP_TODO.md` stays separate and is still live** — 13 open items there.
It is config, secrets and hosting decisions only the owner can make; this file
is code work. Merging them would bury "generate fresh secrets" among eighty
engineering tasks. Two items appear in both by design, because each side owns
half: the **Arabic review** (the native-speaker pass is the owner's; the wiring
is done) and **E2E** (rewriting the workflow is code; providing a database is
the owner's).

Its highest-priority item: **`prod` has no database of its own** — `_PROD` and
`_LOCAL` are not yet fully separated. Also two real gaps it tracks that are
still true: `frontend/public/` **does not exist at all** (so every deployment
serves a default favicon) and the browser tab title is still the literal
placeholder `'admin-dashboard'`.

`.claude-workbook/ROADMAP.md` remains the historical archive — read it for the
reasoning behind decisions already made, not for what is open.

---

## 🔴 Blocking

- [ ] **vitest cannot spawn workers on this machine (2026-09-07).**
      Every run fails with `[vitest-pool]: Failed to start forks worker` /
      `Timeout waiting for worker to respond`, even a single test file, even
      with `--pool=threads`. The same suites passed 134/134 an hour earlier.
      Ruled out: memory (7.5 GB free), process count (cleared to zero), node's
      own `fork()` (works), the vite/vitest caches (deleted).
      **Untried: a reboot** — this class of Windows worker-spawn failure
      usually clears with one. Then antivirus scanning `node_modules`, then a
      `pnpm store prune` + reinstall.
      **Until fixed: verify with tsc + eslint + `next build`, and let CI run
      the suites.** A local run reporting mass failures right now is
      meaningless — it once reported "116 failed" from a run where no test
      ever executed.

## ✅ State of the tree

**PR #155 is MERGED** (`cd46891`, merged 2026-09-07 19:00) — branch scoping is
applied and on `dev`.

`dev` is clean: tsc both sides, en/ar parity 1551/1551, 34 migrations, all four
F8 tables present, local database seeded and verified (2 businesses, 4
branches, 158 orders, per-branch stock agreeing with `Product.stock`).

**Track F and Track F8 are DONE and merged** — #123–#137, #142–#148,
#150–#152. Shipped today: F8.1–F8.5, F7.4, F1.3, F4.5, the APP_MODE split, the
comprehensive seeder, and F4.4 (verified already satisfied — 26 of 27 report
pages already shared one anatomy, closed without a rebuild).

---

## 📝 Raised by the owner 2026-09-07 — LISTED, NOT SCOPED

The owner is enumerating issues, **not** requesting fixes. Do not start any of
these without being asked. Recorded here so they are not lost.

### ⭐ O7 — THE ADMIN CANNOT BUILD OR MODIFY THE STRUCTURE
**Owner, 2026-09-07, stated as the priority: "I NEED THIS ONE THING: the admin
should be able to build/modify the existing structure"** — add a branch, edit
an existing one, add a warehouse, add a cashier, and so on.

He also described the shapes it must support: a branch manager with 2-3
cashiers under them; OR branches with only cashiers and the admin managing all
of them directly. Both, in the same install.

#### The audit — what exists today

| Capability | API | UI |
|---|---|---|
| List branches | `GET /branches` | switcher only |
| Read one branch | `GET /branches/:id` | — |
| Edit a branch | `PATCH /branches/:id` | **none** |
| **Create a branch** | **MISSING** | **none** |
| **Create/edit a business** | **MISSING** | **none** |
| Create staff | `POST /staff` | yes |
| **Assign staff TO a branch** | **MISSING** | **none** |

**`UserBranch` is READ-ONLY.** `branch-roles.service.ts` only ever calls
`findUnique`/`findMany`. F8.4 resolves a per-branch role correctly and there is
NO WAY TO CREATE ONE — so the feature answering "different people in different
branches" cannot actually be used. Everything in the database today was put
there by a migration or the seeder.

**F8 built the ENGINE and none of the CONTROLS.** An owner cannot open a second
shop without a developer running SQL.

#### Why it is smaller than it sounds
**No new models are needed.** `Business`, `Branch` and `UserBranch` all exist
with the right columns. A warehouse is already modelled — `isSellingPoint:
false`. This is CRUD over tables that are already there.
**Size: comparable to ONE F8 stage, not all of F8.**
**Dependencies: NONE.** Does not need the POS (O5), `Shift` (F6.1), or a
decision on MANAGER's shape (O4) — though it makes O4 easier to answer, since
per-branch roles become testable against a real roster.

---

#### Stage 1 — Business + Branch write API ✅ COMPLETE 2026-09-08
- [x] 1.1 **DONE 2026-09-08.** `POST /businesses`, `name` the only required
      field; a test creates one with nothing else and asserts `taxId` is null
- [x] 1.2 **DONE 2026-09-08.** `PATCH /businesses/:id`. `id` is not in the
      schema, so a client echoing the record back has it DROPPED rather than
      applied — tested by patching with another business's id
- [x] 1.3 **DONE 2026-09-08.** `POST /branches`; a warehouse is
      `isSellingPoint: false` on the same endpoint, not a second concept
- [x] 1.4 **DONE 2026-09-08 (backend).** The existing PATCH now runs through
      `updateBranch()`, so the 1.8 and 1.10 guards apply to it too instead of
      only to new writes. UI reachability is stage 3
- [x] 1.5 **DONE 2026-09-08.** P2002 translated to a 409 naming the field;
      tested both ways — duplicate in one business 409s, same code in another
      business succeeds
- [x] 1.6 **DONE 2026-09-08.** `business.created`/`business.updated`/
      `branch.created`/`branch.updated`, each with a real field diff via a
      shared `changedFields()` — only what moved, so the one change that
      matters is not buried under every unchanged field

**Guards to DECIDE, not default:**
- [x] 1.7 **DECIDED + DONE 2026-09-08: OWNER/DEVELOPER only.** Took the
      recommendation. Writes use `requireRole`, not `requireArea('settings')`
      — MANAGER holds `settings` and is refused, which a test asserts. READS
      stay on `settings`: seeing the org chart is ordinary, changing it is not
- [x] 1.8 **DECIDED + DONE 2026-09-08: NO.** Refused with a 400 naming the
      field, mirroring the last-OWNER rule. Refused HERE, where the person can
      still understand why, rather than at the point of sale when a stock
      movement has no branch to record
- [x] 1.9 **DECIDED + DONE 2026-09-08: they survive.** Deactivation sets a
      flag and cascades nothing; a test re-reads a closed branch by id after
      deactivating it
- [x] 1.10 **DONE 2026-09-08.** `clearOtherDefaults()` inside the same
      transaction, scoped per business. Three cases covered: the first branch
      becomes the default unasked, a second claiming it clears the first, and
      deactivating the default hands the flag to a branch that is still open
      (an inactive default is the same problem in a quieter form)

#### Stage 2 — Assign people to branches (`UserBranch` writes) ✅ COMPLETE 2026-09-08
*This is what unlocks the org shapes the owner described — a branch manager
with cashiers under them, or branches of cashiers the owner runs directly.
Both now expressible: `UserBranch` was read-only until this stage.*
- [x] 2.1 **DONE 2026-09-08.** Upsert on the unique pair; re-posting for
      someone already placed returns 200 and changes their role rather than
      409ing, since "make Sara a manager here instead" is the same intent
- [x] 2.2 **DONE 2026-09-08.** Removal is "no longer placed here", never a
      demotion — a test asserts `resolveRoleAtBranch` falls back to the global
      role afterwards
- [x] 2.3 **DONE 2026-09-08.** Returns `role` (here) AND `globalRole`
      (everywhere else). Showing only the first would make a SUPPORT-globally/
      MANAGER-here person read as a manager outright
- [x] 2.4 **DONE 2026-09-08.** `canAssignRole`/`outranks` are IMPORTED from
      `config/roles.ts`, not reimplemented, so the two paths cannot drift.
      **All four watched failing first** — disabling them turns exactly the
      four guard tests red. Rule 4 (last OWNER) needs no branch equivalent: a
      branch role never removes anyone's global role, so no write here can
      remove the final owner. The existing 93-test staff suite still passes,
      confirming the shared helpers were reused rather than altered
- [x] 2.5 **DONE 2026-09-08.** 400 naming the field. Refusing beats
      accepting: `resolveRoleAtBranch` short-circuits on business-wide roles
      before it reads the table, so the row would show the owner a grant on
      screen that has no effect anywhere
- [x] 2.6 **DONE 2026-09-08.** `branch.staff.assigned` /
      `branch.staff.role_changed` / `branch.staff.removed`, each carrying
      `{ from, to }` — "was FULFILLMENT here, now MANAGER" is the whole
      question a reviewer asks, and `to` alone cannot answer it

#### Stage 3 — UI
- [ ] 3.1 `/admin/branches` — list grouped by business: name, code, city,
      selling-point vs warehouse, active state, staff count
- [ ] 3.2 Create/edit branch in a Sheet (per the drawer-vs-page convention — a
      brief detour from a list)
- [ ] 3.3 Create/edit business as a full page — more fields, a destination
      worth its own URL
- [ ] 3.4 Branch roster panel — add/remove a person, set their role here
- [ ] 3.5 Real empty states — "add your second branch" must explain what a
      branch IS, not just show a `+`
- [ ] 3.6 i18n both locales, en/ar parity maintained
- [ ] 3.7 **The switcher must refresh** after a create/rename — it currently
      loads once on mount

#### Stage 4 — Tests (written alongside 1 and 2, not after)
- [x] 4.1 **DONE for stage 1 (2026-09-08).** `branch-writes.test.ts`, 17
      tests. **Watched all four guards fail first**: swapping `requireRole` for
      `requireArea` and disabling the last-branch check turns exactly the four
      guard tests red. "Nobody grants above their own rank" belongs to stage 2
      and is still open
- [x] 4.2 **DONE 2026-09-08.** Both directions asserted
- [x] 4.3 **DONE 2026-09-08.** Asserted through the write path for the first
      time — the read path was tested in F8.4, but nothing could create a row
      to test it with until this stage. Also asserts unscoped stays global
- [ ] 4.4 Frontend: create → appears in the switcher without a reload

*Full version with the reasoning behind each item: `O7-PLAN.md`.*

### O1 — Branch is invisible outside the order detail
Orders now name their branch (PR #155). Inventory, returns and couriers are
SCOPED but show no branch column, so on "All branches" rows from different
places are indistinguishable — the same gap the order detail had.

- [ ] O1.1 Add a branch column to the inventory list (only when unscoped — a
      column repeating the same value on every row is noise)
- [ ] O1.2 Same for the returns list, via `Return.order.branch`
- [ ] O1.3 Same for the courier roster, or state plainly that a courier has no
      single branch (depends on O2)
- [ ] O1.4 Add a branch column to the ORDERS list too — #155 only did the
      detail page
- [ ] O1.5 Backend: these lists do not currently SELECT the branch; each needs
      it added and resolved to a name, as `getOrder` now does

### O6 — ✅ FIXED 2026-09-08 — courier status update blanked the card
**Diagnosed 2026-09-07, fixed 2026-09-08.** All four items done; 47/47 courier
tests pass and the key-set test was watched failing against the original code.

The courier taps a status; the card empties. Refresh and it is back.

`PATCH /courier/assignments/:id/status` returns **5** fields (id, status,
attemptCount, failureReason, order). `GET /courier/me/assignments` returns
**14**. `courier-dashboard.tsx` does
`current.map(item => item.id === id ? updated : item)` — swapping a complete
row for a stub. The card renders with no customer, address or total. It has
not disappeared; it has been emptied.

**Why nothing caught it:** `courierFetch` casts the JSON blindly, so
`CourierAssignment`'s 14 declared fields are never compared to reality. The
tests mock a full object, so they never see the real response.

- [x] O6.1 **DONE 2026-09-08.** `COURIER_ASSIGNMENT_SELECT` — one `as const`
      select shared by `listOwnAssignments` and `updateAssignmentStatus`, with
      a comment saying why narrowing it for one caller is the bug
- [x] O6.2 **DONE 2026-09-08.** One `toCourierAssignment()` serialiser on both
      paths converts the `Decimal` to a string, so the wire shape finally
      matches the `string | null` the client always declared
- [x] O6.3 **DONE 2026-09-08.** Two tests in `courier.test.ts`: identical key
      sets, and `total` a string on both endpoints. **Watched it fail first** —
      reverting the select gives `7 keys vs 14`, the original bug exactly
- [x] O6.4 **CONSIDERED, DECIDED NO 2026-09-08.** `api.ts` — the main client
      behind every admin surface — casts the same way at two call sites, and
      `zod` is a backend-only dependency. Validating in `courier-api.ts` alone
      would make the courier portal the one client with a different contract
      and ship a parser to every visitor, to catch drift that O6.3 now catches
      server-side for free. The cast was why the bug stayed invisible, not why
      it happened; O6.1 removes the cause

### O2 — Couriers have no branch, only a work history
`DeliveryStaff` has no `branchId`. PR #155 filters on "has an assignment for an
order at this branch" — where they HAVE worked, not where they BELONG. A newly
hired courier with no assignments disappears from every scoped list.

- [ ] O2.1 **❓ OWNER DECISION: does a courier belong to ONE branch or serve
      several?** `branchId` on `DeliveryStaff` vs. a join table. Everything
      below waits on this
- [ ] O2.2 Migration for whichever shape is chosen
- [ ] O2.3 Replace the assignment-history filter with the real one
- [ ] O2.4 Show the branch on the courier roster + the create/edit form

### O3 — Every role lands on the same revenue-first dashboard
FULFILLMENT and SUPPORT open to a revenue chart they may have no `reports`
access to interpret. It is the first thing every non-owner sees on login.
This is F5.4. **No schema change needed.**

- [ ] O3.1 **❓ DECISION: is the unit of customization the ROLE or the USER?**
      *Recommend ROLE — matches `ROLE_AREAS`, keeps one owner in control, needs
      no per-user table.* (The owner said "add the ROLE feature", which reads
      as ROLE — confirm before building.) This is F5.3
- [ ] O3.2 Per-role landing route: FULFILLMENT → today's orders, SUPPORT →
      open returns/reviews, OWNER → the current dashboard
- [ ] O3.3 Per-role dashboard widgets — hide what the role cannot open rather
      than showing tiles that 403 on click
- [ ] O3.4 Redirect on login to the role's landing page

### O4 — `MANAGER` is the wrong shape for a shop manager
Today MANAGER = every area except `staff` — an OPERATIONS manager. A shop
manager who counts stock also gets `settings` (theme, tax rate, maintenance
mode) and `discounts`: more authority than the job needs.

- [ ] O4.1 **❓ OWNER DECISION: narrow MANAGER, or add a distinct role?**
      *Do not add a role reflexively — every new role multiplies the permission
      matrix, which `roles.ts` warns about in its own comment.* Easier to
      answer AFTER O7 stage 2, when per-branch roles are testable against a
      real roster
- [ ] O4.2 If narrowing: which areas leave MANAGER, and does anything break
- [ ] O4.3 If adding: the role, its rank in `ROLE_ORDER`, its `ROLE_AREAS`
      entry, i18n label, and the permissions matrix row

### O5 — POS / till: the cashier who scans items and prints a receipt
**Clarified by the owner 2026-09-07:** not a permissions question. He means a
person standing in the shop who **scans or selects items, takes payment, and
prints a receipt** — a point-of-sale terminal.

The missing piece is not authorisation: **nothing in this app creates an
order.** `prisma.order.create` appears only in tests and `demo-seed.ts`.

#### Already exists and gets reused — more than expected
`Product.barcode` (a real unique EAN/UPC column, already searchable) ·
`Product.price` · per-branch stock + `adjustStock()` with a `SOLD` reason ·
**the receipt math**, but only inside `demo-seed.ts` (~lines 472-490:
subtotal → `store.taxRate` → total) · `Order.subtotal`/`taxAmount` columns ·
the invoice/print view, already branch-aware for the letterhead · F8 gives the
till its branch for free.

#### Stage A — schema (nothing works before this)
- [ ] O5.1 **❓ OWNER DECISION: the `Shift` model's shape** — this IS F6.1, and
      a till session and a shift are the same object. Can a manager open one
      for someone who forgot to clock in (→ needs `openedById` separate from
      `userId`)? Editable after closing, or corrected only by a compensating
      entry (*recommend the latter — matches `StockMovement`*)? Per-branch is
      already answered: give it a `branchId` from the start
- [ ] O5.2 `Payment` model — amount, method, tendered, change, paidAt, and the
      order it belongs to. Without it "did the drawer balance?" is
      unanswerable BY CONSTRUCTION; `Order.paymentMethod` is free text
- [ ] O5.3 `Shift`/till session — opener, opening float, closing count,
      variance

#### Stage B — checkout
- [ ] O5.4 **Move the receipt math out of the seeder** into a shared service —
      CLAUDE.md already flags that a real checkout must call the SAME math
- [ ] O5.5 Cart state: scan/select → add line → quantity → subtotal/tax/total
- [ ] O5.6 Barcode lookup endpoint (the column exists; nothing queries it yet)
- [ ] O5.7 Create the order + its `OrderItem`s with price AND cost snapshotted
      (the F1.1 rule), decrement per-branch stock with a `SOLD` movement, and
      record the `Payment` — all in ONE transaction
- [ ] O5.8 Refuse a sale that would take branch stock negative, or decide
      deliberately that it is allowed

#### Stage C — receipt + role
- [ ] O5.9 Thermal receipt renderer (58/80mm) — the invoice is A4; different
      layout, likely a different component
- [ ] O5.10 `CASHIER` role: `ROLE_AREAS` entry, rank in `ROLE_ORDER`, i18n
      label, permissions-matrix row. **Trivial, and LAST** — adding it first
      grants screens that cannot take money
- [ ] O5.11 Open/close-shift UI in the shell, with elapsed time — must survive
      a reload and a second tab (the open shift lives on the server, never in
      `localStorage`)

**Ordering matters:** role first → screens that cannot take money. Checkout
without `Payment` → sales nobody can reconcile.
**Size: its own track, comparable to all of F8.** Start at O5.1.

## 📦 Carried over from `MASTER_TODO.md`

Everything below was open there and is still genuinely open. **Six items it
listed as open had in fact shipped** (F1.3, F4.4, F4.5, F7.4, F8.4, F8.5) —
that staleness is why these are consolidated here.

### Returns — the fuller lifecycle
- [ ] **B4.7** Per-line approve/reject on returns — needs `ReturnItem.status`.
      Batch with B4.8
- [ ] **B4.8** Partial returns — per-item quantity is already accepted on
      REQUEST; approval is what ignores it
- [ ] **B4.10** Refund without a return — needs a standalone model,
      independent of the RMA flow
- [ ] **B4.11** Policy window check, restocking fees, exchange linkage — the
      biggest of the five
- [ ] **S7.8** `ReturnStatus` 3 → ~8 values (label sent → in transit →
      received → inspected → resolved)

### Catalogue
- [ ] **A5.8** Per-locale product content (EN/AR) + a completeness indicator
- [ ] **A5.9** Version history with restore; bulk import; vendor / collections
      / related products
- [ ] **S7.6** `Category.parentId` → the category tree (nesting, reparent,
      delete guard)
- [ ] **S7.9** Tags — tag columns, filters, bulk-tag on every list page. No
      model or field exists yet

### Schema, still unstarted
- [ ] **S7.1** `Address` model → order shipping/billing, customer addresses,
      delivery zones, tax by region
- [ ] **S7.5** ~~`Location` model~~ — **SUPERSEDED by F8's `Branch`.** One
      model, not two. Kept here only so nobody re-adds it
- [ ] **F7.9** `Supplier` model — the real remaining half of S7.5's idea.
      **Unblocks F7.6 and F7.8**
- [ ] **F7.6** Supplier reorder email, sent on admin approval. Needs F7.9
- [ ] **F7.8 (rest)** Receipt / delivery date / purchase date — these belong
      on `StockMovement` (properties of a BATCH arriving), beside `unitCost`
      and a `supplierId`. **Not on `Product`** — loose columns there would
      have to be undone
- [ ] **F3.5** Bulk receive — import is create-only
      (`assertPermitted(config, 'create')`), so this is real work, not wiring

### Shifts (F6) — all gated on one decision
- [ ] **F6.1** 🚫 **the `Shift` model's shape** — see "Waiting on the owner".
      **This is the same object as O5's till session**; answering it unblocks
      both tracks
- [ ] **F6.3** Open/close shift UI in the shell (not buried in Settings), with
      elapsed time. Must survive a reload and a second tab — the open shift
      lives on the server, never in `localStorage`
- [ ] **F6.4** "My shift" summary — a time-bounded `AuditLog` query, no new
      logging needed
- [ ] **F6.5** Shift history + who is on now. **Share a surface with F2's login
      history** rather than building two near-identical staff-activity pages
- [ ] **F6.6** ⚠️ Do NOT conflate shifts with payroll or time-clock compliance.
      A note, not a task — if the owner wants payroll that is its own project
      with real legal questions

### Already built — verify and tell the owner, do not rebuild
- [ ] **F7.5** Low-stock alerts already exist, **including email**.
      `adjustStock` fires `notify()` on CROSSING into low stock, gated on
      `notifications.lowStockAlerts`; `notify()` writes the in-app row AND
      calls `sendAlertEmail`. **It works; it is almost certainly just
      unconfigured.** Confirm the three email settings and check one arrives.
      Do not build a second path

### Older, from §U / the G-GATE
- [ ] Optimistic row updates with rollback
- [ ] Bulk-action progress
- [ ] Loading-overlay blur / nav-transition smoothness
- [ ] **Design Fix Checklist Phases 6-7** — blocked: the text was never
      transcribed into the repo. **Ask the owner to re-paste**; do not
      reconstruct from memory
- [ ] **Arabic review** — parity holds, but the MSA is machine-translated and
      unreviewed. Blocks any client demo. NOT self-certifiable
- [ ] **E2E** — `.github/workflows/e2e.yml` is still written around Vercel
      preview URLs + `RENDER_DEV_BACKEND_URL`. Disabled, so it breaks nothing,
      but needs rewriting for Coolify
- [ ] **Sentry prod DSN** — on hold, the owner's trial ended

---

## ⏳ Waiting on the owner — do not guess

1. **F6.1 — the `Shift` model's shape.** Can a manager open a shift for someone who forgot to
   clock in (→ needs `openedById` distinct from `userId`)? Editable after closing, or corrected
   only by a compensating entry (**recommend the latter** — matches `StockMovement`; a timesheet
   that can be silently rewritten is worth less than one that cannot)? Per-branch is already
   answered: give it a `branchId` from the start.
2. **F7.8 — QR vs serial.** A printable shelf label using the existing `barcode` (small job), or
   a serial per individual unit (**a different inventory model** — a count plus a movement log
   cannot express it)?
3. **Pre-push `next build`.** It has cost a round trip twice. (a) add it to pre-push (~60–90s
   every push); (b) leave CI as the guard; (c) run it by hand when touching
   `useSearchParams`/`useParams`.
4. **F7.10 — re-seed the demo data.** Best done once the local DB exists. The seeder now covers
   businesses, branches, per-branch stock, staff, returns, variants and order notes.
5. **F5.5 — cashiering.** There is **no checkout/order-creation flow at all** — nothing creates
   an `Order` but the seeder and tests. A real POS needs order creation, payment capture and a
   till concept. **Scope it as its own project**; do not let it arrive disguised as a dashboard
   tweak.

---

## ⚠️ Rules that were learned the expensive way

**Stacked-PR conflicts are usually FAKE.** PRs are squash-merged, which rewrites SHAs, so each
stacked branch still carries pre-squash copies of everything below it and git reports conflicts
on byte-identical content. `#133` looked like 12 conflict hunks; `git rebase origin/dev` skipped
10 already-applied commits and produced **zero**. Recipe:
```bash
git log --oneline origin/dev..origin/<branch>          # how many are REALLY new?
git merge-tree --write-tree origin/<branch> origin/dev | head -20
git rebase origin/dev && git push --force-with-lease origin <branch>
```
`merge-tree` prints the tree hash first and CONFLICTs after — `grep -c CONFLICT` gives a false
"clean". `gh pr edit --base` is refused mid-stack; bases retarget themselves as each PR below
merges. GitHub's own stack-rebase reports conflicts when the merge is clean.

**Never add a branch to fix a red stack.** PR #140 was created to fix stack-wide CI failures and
was dropped by the very next rebase as *"patch contents already upstream"* — the fix was already
reaching `dev`. Check `origin/dev..origin/<branch>` first.

**Verify the database target before any backend test or migration.**
```bash
grep -nE 'DATABASE_URL' backend/.env | sed -E 's#(mysql://[^:]+:)[^@]*(@)#\1***\2#'
```
`DATABASE_URL=... npx vitest` does **NOT** protect you — dotenv loads `.env` afterwards and
overwrites it. The Coolify MySQL **is** production; there is no dev database.

**Uncommitted infrastructure is a trap.** `app-mode.ts` worked on one machine, was invisible to
CI and every other checkout, and vanished the moment it was stashed — taking the backend with it.

**`next build` is the only check that catches a missing Suspense boundary.** A
`useSearchParams()` without one broke the build on eleven stacked PRs while typecheck and 1006
unit tests stayed green. jsdom never prerenders. Wrap the smallest component that reads it, never
the page, or a suspended form renders as a blank screen.

**Never run `next build` while a dev server is live** in the same `frontend/.next` — stop it,
`rm -rf frontend/.next`, build, clear again before restarting.

**Fire-and-forget writes race tests.** `audit()`, `notify()`, `lastUsedAt`, `touchSession()`. A
test reading one immediately after a request passes locally and fails on CI. Use the shared
`waitFor` helper, never a longer sleep.

**Any figure describing a PAST event must read a snapshot, never a live lookup.** `Order.total`,
`OrderItem.price`, `Order.subtotal`/`taxAmount`, `OrderItem.cost`. It is what F1.1 fixed; check
the next new metric against it before it ships.

**A green test suite does not prove the UI renders.** jsdom computes no layout.

---

