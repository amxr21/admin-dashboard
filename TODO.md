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

## 📬 Open PRs — the 2026-09-08 stack

**8 merged, 6 open.** Merge bottom-up; each shows only its own diff.

| PR | Branch | Base | What |
|---|---|---|---|
| #165 | `stack/09-two-factor-login` | **`dev`** | O3b — 2FA login + settings panels |
| #171 | `stack/10b-shifts-backend` | #165 | F6.1 — shift model + API |
| #167 | `stack/11-shifts-ui` | #171 | F6.3/6.5 — shift UI + staff activity |
| #168 | `stack/12-shift-summary` | #167 | F6.4 — shift summary |
| #169 | `stack/13-low-stock-alert-test` | #168 | F7.5 — low-stock email test |
| #170 | `stack/14-bulk-progress` | #169 | §U — bulk-delete progress |

Merged: #156-#163 (O6, O7 §1-3, docs, O1, O2, O3).

### ⚠️ What went wrong on 2026-09-07, and how it was fixed

**#166 was merged into `stack/09-two-factor-login` instead of `dev`.** GitHub
marked it MERGED and closed it, but the F6.1 shift work never reached `dev` —
`backend/src/services/shifts.service.ts` was simply absent from it, with no
open PR left to bring it in. Nothing was lost, but nothing would have shipped
either, and the closed PR made it look done.

Reopened as **#171** on `stack/10b-shifts-backend` (a new branch name: the old
one is bound to the closed PR).

**The lesson for a stack: merge each PR into `dev`, not into its base branch.**
GitHub retargets the next PR to `dev` automatically as each one lands — that
retarget is the mechanism, and merging into the base short-circuits it.

**#165's "conflict" was fake, as this file's own rule predicts.** `merge-tree`
returned a clean tree; `git rebase origin/dev` skipped 8 already-applied
commits and produced zero conflicts. #167/#168 had a REAL conflict of the same
family — each branch carried its own copy of a parent's commit under a
different SHA — fixed by rebasing each onto its actual base, not by hand.

All six verified after the rebase: backend 922/922, frontend 1050/1050, tsc,
eslint and `check:merge` clean on the stack tip.

---

## 🔴 Blocking

**RESOLVED 2026-09-08.** vitest spawns workers again — the full backend suite
runs locally (890/890 across 41 files). The reboot listed as "untried" is the
likely cause; nothing in the repo changed. Kept as a note because the failure
mode was convincing: it once reported "116 failed" from a run where no test
ever executed, so a mass-failure run on this machine is worth distrusting
before it is worth debugging.

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

### ⭐ O7 — ✅ ALL FOUR STAGES COMPLETE 2026-09-08
**Was:** the admin cannot build or modify the structure. An owner can now add
a business, open a branch or warehouse, edit either, and put people at
branches with a per-branch role — all from the UI, none of it needing SQL.
40 new tests (17 stage 1 · 15 stage 2 · 8 stage 3); every guard and the
switcher refresh were watched failing before the code went in.

**Original entry, kept for the reasoning:**

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

#### Stage 3 — UI ✅ COMPLETE 2026-09-08
- [x] 3.1 **DONE 2026-09-08.** Grouped by business, not a flat table — a
      branch has no meaning without its business, and a flat one would repeat
      the business down every row (the same reason the switcher groups)
- [x] 3.2 **DONE 2026-09-08.** `BranchSheet` — a short field set, a detour
      from a list you return to, with the list visible underneath (you are
      usually adding a SECOND branch and seeing the first is the point)
- [x] 3.3 **DONE 2026-09-08.** `/admin/branches/new` and `/[id]` — twelve
      fields including the legal name and tax id that reach an invoice; the
      other pole of the same convention
- [x] 3.4 **DONE 2026-09-08.** `BranchRosterPanel`. Shows BOTH roles per
      person (`MANAGER here · SUPPORT elsewhere`) — showing only one would
      either invent a promotion or hide the role that actually applies.
      OWNER/DEVELOPER are not offered, since the server refuses them
- [x] 3.5 **DONE 2026-09-08.** Two distinct empties, both explaining rather
      than pointing: no businesses says what a business IS and that its details
      print on invoices; a business with no branches says it cannot record
      stock or take orders until one exists. Both asserted in tests
- [x] 3.6 **DONE 2026-09-08.** 79 new keys per locale, parity 1630/1630
      (was 1551). Arabic uses a real ICU plural with the `two`/`few`/`many`
      forms, not an English-shaped one/other; `messages.test.ts` 18/18
- [x] 3.7 **DONE 2026-09-08.** A create/rename reloads, the same blunt and
      reliable answer the switcher already uses when the active branch
      changes. **Watched failing** — swapping the reload for a local refetch
      turns the test red. A stale switcher missing a branch is one an owner
      cannot scope to

#### Stage 4 — Tests ✅ COMPLETE 2026-09-08
- [x] 4.1 **DONE for stage 1 (2026-09-08).** `branch-writes.test.ts`, 17
      tests. **Watched all four guards fail first**: swapping `requireRole` for
      `requireArea` and disabling the last-branch check turns exactly the four
      guard tests red. "Nobody grants above their own rank" belongs to stage 2
      and is still open
- [x] 4.2 **DONE 2026-09-08.** Both directions asserted
- [x] 4.3 **DONE 2026-09-08.** Asserted through the write path for the first
      time — the read path was tested in F8.4, but nothing could create a row
      to test it with until this stage. Also asserts unscoped stays global
- [x] 4.4 **DONE 2026-09-08**, with the premise corrected: the fix is a
      deliberate FULL reload, not a reload-free update. The switcher is
      mounted in the shell above this page and holds its own state, so a
      local refetch updates the list and leaves the switcher stale — which is
      exactly what the test now catches. 8 tests in `branches-view.test.tsx`

*Full version with the reasoning behind each item: `O7-PLAN.md`.*

### O1 — ✅ FULLY DONE 2026-09-08 (O1.3 unblocked by O2 the same day)
Orders, returns and stock movements now name their branch, shown only when the
switcher is on "All branches" — with one selected, every row is from it and the
column would just repeat. The courier roster (O1.3) landed once O2 gave a
courier real branches to name.

**Original entry:**

### O1 — Branch is invisible outside the order detail
Orders now name their branch (PR #155). Inventory, returns and couriers are
SCOPED but show no branch column, so on "All branches" rows from different
places are indistinguishable — the same gap the order detail had.

- [x] O1.1 **DONE 2026-09-08.** On the stock-movement log, which is where a
      branch actually varies — the inventory LIST is per product, one row per
      product across all branches, so a column there would repeat or mislead
- [x] O1.2 **DONE 2026-09-08.** Reached through the order, as planned — a
      return deliberately has no `branchId` of its own
- [x] O1.3 **DONE 2026-09-08 — UNBLOCKED by O2 the same day.** Was blocked
      because `DeliveryStaff` had no branch at all and the only available
      value ("where they have worked") would have labelled a courier with a
      branch they do not belong to. Now that O2 gives them real branches, the
      roster names them
- [x] O1.4 **DONE 2026-09-08.**
- [x] O1.5 **DONE 2026-09-08.** One shared `resolveBranchLabels()` batch
      lookup rather than three copies. It is a batch lookup and NOT a Prisma
      `include` because `Order.branchId` is a plain id with no relation — an
      order outlives the branch that took it, so a per-row lookup would be N
      queries. A missing branch stays `null`; the UI renders an em dash rather
      than inventing a name, since "not recorded" is a different fact from
      "belongs to whichever branch sorts first"

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

### O2 — ✅ DONE 2026-09-08
A courier now serves MANY branches (`DeliveryStaffBranch`), per the owner's
answer. One courier record linked to several, not one record per branch — so
their access code, phone and delivery history stay in one place. 5 tests.

**Original entry:**

### O2 — Couriers have no branch, only a work history
`DeliveryStaff` has no `branchId`. PR #155 filters on "has an assignment for an
order at this branch" — where they HAVE worked, not where they BELONG. A newly
hired courier with no assignments disappears from every scoped list.

- [x] O2.1 **ANSWERED BY THE OWNER 2026-09-08: SEVERAL, via a join table.**
      A courier can serve more than one branch — in his words, "he can serve
      one branch and can serve another as well with 2 different profiles".
      Clarified: that is ONE courier record linked to many branches, not two
      unrelated rows. One access code, one phone, one delivery history that
      can be filtered by branch — the same shape `UserBranch` already uses for
      staff, so there is one idea of "who works where" and not two.
      Two separate rows was considered and rejected: it would split a person's
      work across timelines that can never be added up, and hand them a
      different sign-in code per branch
- [x] O2.2 **DONE 2026-09-08.** `DeliveryStaffBranch` join table, migration
      `20260908000000_add_delivery_staff_branches`. Purely additive — one new
      table, no ALTER on existing data, nothing backfilled. Applied to the
      LOCAL db via `migrate diff` + `migrate deploy` per the CLAUDE.md recipe.
      No `role` column, unlike `UserBranch`: a courier's capabilities do not
      vary by branch — they deliver — and a column added "for symmetry" would
      invite a meaning nobody has defined
- [x] O2.3 **DONE 2026-09-08.** `courierBranchWhere()` replaces #155's
      "has an assignment for an order at this branch". **The subtle part**: a
      courier with NO branches recorded still appears on EVERY scoped roster.
      Every courier predating O2 has an empty relation, and matching nothing
      would have emptied every scoped list the moment this deployed — a
      migration that silently hides a screenful of people. "No branches" means
      "not placed yet", the same direction as `UserBranch`'s "no row means the
      global role". Tested both ways
- [x] O2.4 **DONE 2026-09-08.** Column on the roster (unscoped only) and a
      checkbox set in the courier Sheet. Saved through its OWN endpoint
      (`PUT /couriers/:id/branches`, a full replace) rather than folded into
      the courier body — otherwise saving a phone number could silently
      rewrite where somebody works. Empty renders "Any branch", not a blank

### O3 — ✅ DONE 2026-09-08
Each role now lands on its own work, and `/admin` no longer 403s for roles
without `reports`. 9 tests. **F5.3 and F5.4 are closed by this.**

**Original entry:**

### O3 — Every role lands on the same revenue-first dashboard
FULFILLMENT and SUPPORT open to a revenue chart they may have no `reports`
access to interpret. It is the first thing every non-owner sees on login.
This is F5.4. **No schema change needed.**

- [x] O3.1 **ANSWERED BY THE OWNER 2026-09-08: ROLE, fixed in code.**
      Not per-user (needs a preferences table that does not exist, and loses
      central control over what a new hire sees first) and not configurable in
      Settings (a panel and one setting per role, for a choice that has one
      sensible answer per role anyway). It is derived from `ROLE_AREAS`, which
      already declares what each role may reach — so the landing page cannot
      drift from the permission table. Configurability can be added later
      WITHOUT a migration if it is ever wanted. This is F5.3
- [x] O3.2 **DONE 2026-09-08.** `ROLE_LANDING` in `config/areas.ts`, next to
      `ROLE_AREAS` so the two cannot drift. FULFILLMENT → orders, SUPPORT →
      returns, everyone with a `reports` grant → the dashboard. **Guarded by a
      test, not by care**: every destination is checked against the role's OWN
      grant, so narrowing a role's areas without moving its landing page fails
      at the source instead of on a real login. Watched failing
- [x] O3.3 **DONE 2026-09-08 — and it was worse than "tiles that 403 on
      click".** EVERY widget on `/admin` reads a `/reports/*` endpoint and all
      of them sit behind `requireArea('reports')`, so for FULFILLMENT and
      SUPPORT the page did not merely ask the wrong question — it fired ten
      requests that all 403'd and rendered as an error. Now gated once (the
      dependency is identical for all nine widgets, so a per-widget check
      would be nine copies of one condition), the requests are not made at
      all, and the page offers a route into their own work instead
- [x] O3.4 **DONE 2026-09-08.** `signIn` now returns the role — `setUser`
      only schedules a render, so the caller cannot read it off `user` yet.
      `verifyTwoFactor` returns it too, so a 2FA sign-in lands identically.
      **Found while wiring it**: `signIn` can return `TWO_FACTOR_REQUIRED` and
      NOTHING in the UI handled it — a 2FA user was redirected to `/admin`
      with no session at all. Out of O3's scope to build the code-entry
      screen, so the form now refuses with a clear message instead of
      redirecting into a broken state. See the new item below

### O3b — ✅ FOUND AND FIXED 2026-09-08
Pre-existing, not a regression — surfaced while wiring O3.4, fixed the same
day. A 2FA user can now actually sign in, and 2FA can actually be switched on.

`signIn` can return `TWO_FACTOR_REQUIRED` with a `pendingToken` and no session
written. A repo-wide grep found **zero** UI handling it: the login form awaited
`signIn` and redirected to `/admin` regardless, so a user with 2FA enabled was
sent to the admin shell with no token — every request 401s and they cannot sign
in at all. The same shape as the F5.1 reset-password bug (a backend flow whose
frontend half was never built).

The 2FA/sessions/API-key SETTINGS panels have the same problem and are already
noted in CLAUDE.md as built-but-not-linked, which is probably why nobody hit
this: the feature cannot currently be switched on from the UI.

**Fixed 2026-09-08** (the interim "refuse with a message" mitigation was
replaced by the real code-entry step).

- [x] O3b.1 **DONE 2026-09-08.** A second phase of the same form, not a
      third field on the first: the password is already spent, and
      re-rendering it invites the browser to resubmit credentials that no
      longer prove anything. **The pending token lives in React state and
      nowhere else** — it proves the password step happened, so it is a
      credential that SKIPS the password if stolen; `localStorage` would
      outlive the tab for any script on the origin to read, and the URL would
      reach history, server logs and referrers. A test asserts it reaches
      neither. Accepts a backup code too (so `type="text"`, not `number`,
      with `inputMode`/`autocomplete` still giving phones the numeric pad and
      OS autofill). Lands on the role's page, same as a password-only login.
      **All 5 tests watched failing** against the reintroduced bug
- [x] O3b.2 **DONE 2026-09-08.** All three mounted next to My account —
      they configure THIS person's own access (second factor, live sessions,
      keys), not how the shop is run. This was very likely why O3b.1 went
      unnoticed for so long: 2FA could not be switched on from the UI, so
      nobody could reach the broken login path. Closes the long-standing
      "still needs a human" item (1) in CLAUDE.md

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
- [x] O5.1 **ANSWERED BY THE OWNER 2026-09-08.** His definition, which
      settles the modelling: **a shift is a period of WORK** — an employee,
      a branch, a start and an end, visible to the admin. It is NOT a
      `Session`; a session is the backlog of activity inside the system
      (already built, F2) and is written by the app, while a shift is declared
      by the person and describes their working day.
      Decided with him: (a) a manager CAN open or fix a shift for someone who
      forgot to clock in, and the correction stays VISIBLE — the original
      value is kept and the edit is attributed, the same discipline
      `StockMovement` uses, so a timesheet cannot be silently rewritten;
      (b) **actual worked time only** — no planned rota, no lateness
      comparison. A rota is a separate, larger feature and is not in scope.
      Needs `openedById` distinct from `userId` (who opened it vs. whose shift
      it is) and a `branchId` from the start
- [x] **O5.2 — DONE 2026-09-08.** `Payment` model, migration
      `20260908030000_add_payments_and_till`. A TABLE, not columns on `Order`:
      one free-text `paymentMethod` cannot express a split payment (30 cash,
      rest on card) or a refund, which is a second money movement rather than
      an edit of the first. `Order.paymentMethod` is NOT removed — every
      existing order carries it and the reports reading it keep working.
      **`amount` is signed** (positive pays, negative refunds), one column
      rather than a type enum plus a magnitude, for the same reason
      `StockMovement.delta` is signed: the sum IS what was collected, with no
      case analysis to get wrong. `tendered`/`change` are STORED, not derived
      — "did the drawer balance" is arithmetic over what the cashier actually
      did, and deriving change assumes the case a variance exists to catch.
      `paidAt` is distinct from `createdAt` (a payment entered next morning
      after a terminal outage has both)
- [x] **O5.3 — DONE 2026-09-08.** `openingFloat`/`closingCount`/`variance` on
      `Shift` — the same object as a till session, per the owner, so no
      parallel table to keep in step. `POST /shifts/:id/close-till` counts the
      drawer and ends the shift in ONE act: a till counted but left open, or a
      shift ended without a count, are both states somebody has to chase.
      **`variance` is stored, never recomputed** — a refund landing next week
      would otherwise silently rewrite what the cashier signed off tonight
      (watched failing). **Only CASH counts against the drawer** — including
      card would show a shortfall equal to the day's card sales every single
      day (also watched failing). A short or over count is recorded, never
      refused: a till that rejects an inconvenient count stops being counted
      honestly. Also `GET /shifts/:id/takings`, readable mid-shift. 9 tests

#### Stage B — checkout
- [x] **O5.4 — DONE 2026-09-08.** `order-math.service.ts`; the seeder now calls
      it, so seeded and sold orders cannot disagree about how a total is
      reached. **Found a real rounding bug while extracting it**: the seeder
      never rounded the SUBTOTAL, so a price like 3.333 x 3 stored `9.999` and
      a total of `10.499` — money no till can take, on a receipt where
      subtotal + tax does not equal total. Rounded once, on the order rather
      than per line (per-line rounding differs by up to a cent and the invoice
      shows ONE tax figure).
      **A test-quality lesson worth keeping**: my first version of that test
      asserted with `.toFixed(2)`, which DISPLAYS 9.999 as "10.00" — it passed
      against the bug. Rewritten to compare `.toString()` and assert
      `decimalPlaces() <= 2`, then watched failing. A money assertion that
      formats before comparing tests nothing.
- [x] **O5.5 — DONE 2026-09-08.** `/admin/pos` — scan to add, quantity, running
      estimate, take payment. **The scan field keeps focus after every action**:
      a hardware scanner is a KEYBOARD, so with focus elsewhere the next
      barcode is typed into whatever is focused, silently setting a quantity
      to 5012345678900. Scanning the same item twice adds ONE rather than a
      second line — the checkout endpoint refuses duplicates and two lines
      would print twice on the receipt. The on-screen figure is labelled an
      ESTIMATE; the authoritative subtotal/tax/total come back from the server
      via the shared math (O5.4), because two implementations of the same
      arithmetic is exactly how a receipt disagrees with an invoice by a cent.
      Over-stock is a WARNING, not a block — the cashier is holding the item
      and the server decides (O5.8). Change stays on screen after the sale
      rather than in a toast that vanishes while the drawer is opening.
      **A second weak test caught and fixed**: the focus test passed with
      refocus disabled, because the field carries `autoFocus` and nothing had
      moved focus away. Now clicks elsewhere first, then watched failing.
      11 tests. CASHIER now lands here
- [x] **O5.6 — DONE 2026-09-08.** `GET /pos/scan?code=` — EXACT match on
      `barcode` then `sku`, never fuzzy. That is the rule the suite protects:
      a prefix or name match would let a dropped digit resolve to a real but
      DIFFERENT product, charging the customer for something they are not
      holding, with nothing on screen looking wrong. Watched failing.
      Reports stock **at the till's branch** (the number the cashier can
      actually reach) alongside the all-branch total, so they can say "none
      here, twelve at the warehouse". An ARCHIVED product is returned and
      FLAGGED, not hidden — one physically on the shelf still has to be
      sellable, and the till decides whether to warn. Guarded by `orders`,
      not `inventory`: selling a coffee must not require stock-editing
      rights. 13 tests
- [x] **O5.7 — DONE 2026-09-08.** `POST /pos/checkout`. **The first thing in
      this app that creates an `Order`** — until now `prisma.order.create`
      existed only in tests and the seeder. Order, lines, `SOLD` movements,
      per-branch stock, product stock and the `Payment` all commit in ONE
      transaction: a sale that recorded the money but not the stock leaves
      books and shelves disagreeing with nothing to say which half happened,
      which is exactly what a dropped connection mid-payment produces.
      **Price AND cost snapshotted** (F1.1) — a test raises the supplier cost
      AFTER the sale and asserts the recorded profit does not move. Missing
      cost stores NULL, never 0, or the sale reports as pure profit. Prices
      are read INSIDE the transaction, so the receipt shows the price at the
      moment of sale. Stock movements are written directly rather than through
      `adjustStock`, which opens its own transaction — nesting it would commit
      stock before the payment. 11 tests; three rules watched failing
- [x] **O5.8 — DECIDED + DONE 2026-09-08: refuse by DEFAULT, overridable.**
      New `inventory.allowNegativeStock` setting, default FALSE. Refusing
      suits a shop whose count is trusted — selling what is not there produces
      a negative somebody has to explain later, while the cashier standing at
      the shelf can see the truth NOW — but a shop mid-stocktake, or one whose
      counts lag reality, must not have its till stop working over
      bookkeeping. The error names the available number so it can be checked
      against the shelf. With the setting on, stock goes genuinely negative
      and stays visible rather than being clamped to zero, which would hide
      the discrepancy

#### Stage C — receipt + role
- [x] **O5.9 — DONE 2026-09-08.** `ThermalReceipt`, its own component rather
      than a restyled invoice: at 58mm you get ~32 monospace characters per
      line, so the A4 letterhead, address block and table have nowhere to go —
      restyling would mean hiding most of it and hoping the rest reflows.
      **`@page { size: 58mm auto }`** — a real page size, with `auto` height
      because thermal printers feed continuous paper: a fixed height either
      cuts a long receipt off or ejects blank paper after a short one. Scoped
      to the component, not globals.css, or every other print in the app comes
      out on a roll. Monospace and `force-ltr` even in Arabic — the layout is a
      column of aligned figures and a printer cannot reflow them.
      Lines print the EXTENDED price (2 × 4.50 = 9.00), since printing 4.50
      beside a quantity of 2 invites arithmetic that fails. Tendered/change are
      OMITTED on a card sale rather than printed as 0.00, which reads as a
      mistake. Figures come from the SERVER's response, never the on-screen
      estimate. 5 tests, both rules watched failing
- [x] **O5.10 — DONE 2026-09-08**, and genuinely last: the TODO warned that
      adding it first grants screens that cannot take money, and those screens
      (O5.6/O5.7) now exist. Enum + `ROLE_AREAS` + `ROLE_ORDER` + i18n, both
      sides. Grant is `orders`/`returns`/`products` — deliberately NARROWER
      than FULFILLMENT, with **no `inventory`**: a cashier reads stock through
      the scan and the product list, but editing it is a different job, and
      requiring stock rights to sell a coffee is the exact over-granting O4
      exists to correct.
      **Two things the tests caught.** (1) My rank comment said "outranks
      nobody" while the placement put CASHIER above SUPPORT — moved below it,
      so code and intent agree; a person on a till has no business changing
      anyone's role. (2) I pointed the landing page at `/admin/pos`, which
      does not exist until O5.5 — the F5.4 landing test failed because it
      checks every destination is real and inside the role's grant. Points at
      orders until the sale screen lands
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
- [x] **F7.9 — DONE 2026-09-08.** `Supplier` model (name required, contact
      optional, deactivated rather than deleted). Built WITH F7.8 rather than
      before it: the batch dates alone are half an answer without knowing who
      supplied it. Deliberately thin — no payment terms, no lead times, no
      purchase orders; those belong to a procurement feature nobody asked for.
      **Still unblocks F7.6** (the reorder email now has a real address to
      send to). **No UI yet** — suppliers can be created via the API/seed but
      have no management screen; that is the obvious follow-up
- [ ] **F7.6** Supplier reorder email, sent on admin approval. Needs F7.9
- [x] **F7.8 (rest) — DONE 2026-09-08.** `deliveredAt`, `purchasedAt`,
      `reference` and `supplierId` on `StockMovement`, beside `unitCost`.
      **The owner's case decided the shape**: "buy 50 units then enter one
      unit's details once" is ONE record per receipt, not fifty identities —
      and a receipt already WAS one movement row, so nothing new was needed to
      express it. Per-unit serials were considered and rejected as not what
      was asked for.
      On `StockMovement`, never `Product`: a product bought three times from
      two suppliers has three answers to "when did it arrive", and a column on
      the product could hold only the newest, silently overwriting the history
      the log exists to keep.
      `deliveredAt` is deliberately distinct from `createdAt` — a batch
      entered the next morning has both, and collapsing them makes "how long
      does this supplier take" unanswerable. All four are REFUSED on an
      outgoing movement (nothing was delivered when stock is written off), and
      a bad `supplierId` is a 400 naming the field rather than a raw FK
      violation surfacing as a 500. FK is SetNull: deleting a supplier must
      never delete stock history. 6 tests, both guards watched failing
- [x] **F3.5 — DONE 2026-09-08.** `POST /inventory/receive` + `/receive/preview`,
      matching on SKU or barcode (whichever the supplier's paperwork carries).
      **Its own service, not the generic import**: that one is create-only AND
      writes rows of a CONFIGURED resource, while a delivery UPDATES stock and
      inventory is deliberately not configured — stock is an append-only
      movement log, never an editable number. It reuses the import's SHAPE
      (validate all, then apply all-or-nothing), not its code.
      **All-or-nothing**: receiving "47 of 50" leaves a shop whose count
      matches neither the paperwork nor the shelf, and the 3 that failed are
      the ones nobody chases. **A duplicate product across two lines is
      REFUSED, not summed** — silently adding them doubles the stock with
      nothing on screen to explain it. Each line goes through `adjustStock`
      rather than writing movements directly, so the branch fallback,
      per-branch total, product total and low-stock alert all still fire.
      Carries F7.8's batch detail onto every line. 9 tests, both rules watched
      failing. **No UI yet** — API only

### Shifts (F6) — ✅ COMPLETE 2026-09-08
All five items done. The gating decision (F6.1's shape) was answered by the
owner on 2026-09-08 and the whole track followed the same day.
- [x] **F6.1 — DONE 2026-09-08.** `Shift` model + service + routes, migration
      `20260908010000_add_shifts` (additive, one table). Built to the owner's
      definition: a period of WORK (user · branch · start · end), distinct
      from a `Session`. `endedAt IS NULL` is the single source of truth for
      "open" — not a separate status column, because two representations of
      one fact drift and an `isOpen` disagreeing with a set `endedAt` has no
      correct reading. `openedById` is separate from `userId` so "a manager
      clocked them on" stays legible. Corrections keep the ORIGINAL times and
      are attributed; **a second edit does not overwrite the original**, or a
      manager could launder a correction by editing twice. **Nobody edits
      their own shift at any rank, including OWNER** — the person who benefits
      must not be the person who approves. Clocking on needs no area (the
      people who work shifts would otherwise be the ones who cannot record
      them); READING other people's is behind `staff`, like the audit trail.
      16 tests, both critical rules watched failing. **This also unblocks O5's
      till session — same object.**
- [x] **F6.3 — DONE 2026-09-08.** `ShiftControl` in the topbar beside the
      branch switcher (they answer the same kind of question: where you are
      working, and whether you are on the clock). The open shift is read from
      `GET /shifts/me` on every mount and NOTHING is written to
      `localStorage` — a test asserts that, since two tabs could otherwise
      disagree and a cleared cache would lose worked hours. Elapsed time is
      RECOMPUTED from `startedAt` each tick rather than incremented, so a
      backgrounded tab (where timers are throttled) shows the truth the moment
      it is looked at. Clamped at zero: a clock skew or a start corrected into
      the future would otherwise render "-1:00". 7 tests
- [x] **F6.4 — DONE 2026-09-08.** `GET /shifts/:id/summary` over the existing
      `AuditLog`; no second activity log, which would be two records of one
      fact free to disagree. **Deliberately NOT `auditWhere`**: its `from`/`to`
      are CALENDAR DATES snapped to midnight, and a shift is a timestamp range
      inside a day — rounding it would attribute the night shift's work to the
      morning one, with nothing looking wrong, just a plausible number against
      the wrong name. Watched that exact bug fail the boundary test. An OPEN
      shift summarises up to now. **Your own is always readable without
      `staff`** — "what did I do today" is a question about your own work.
      The panel STATES that it counts changes, not busyness: reads are not
      audited, so a shift spent answering questions records little, and a bare
      count next to somebody's name invites the wrong reading before a
      conversation about their work. 5 tests
- [x] **F6.5 — DONE 2026-09-08.** Shared, as the item asked. `/admin/
      login-history` became **Staff activity** with three tabs: On now ·
      Shifts · Sign-ins. **Not merged into one table** — a sign-in is an
      instant the system recorded, a shift is a span the person declared, and
      interleaving them would imply a relationship that does not exist.
      "On now" is its own TAB rather than a filter, because it is the question
      a manager actually walks up to the page to ask and a non-default filter
      value is not discoverable. A corrected shift is marked as corrected,
      with who and why — the point of keeping the original times is lost if
      the table renders clocked and edited hours identically.
      **Found while doing it**: the existing sidebar tests queried the Staff
      link by `/staff/i`, which the new "Staff activity" label also matched.
      Anchored to `/^staff$/i` — the tests were right, the label made them
      ambiguous
- [x] **F6.6 — HONOURED 2026-09-08** (a note, never a task). Nothing built
      carries a pay rate, an overtime rule or any jurisdiction-specific
      rounding, and the `Shift` model says so in its own comment. If payroll
      is ever wanted it is its own project with real legal questions.

### Already built — verify and tell the owner, do not rebuild
- [x] **F7.5 — VERIFIED 2026-09-08. Nothing was missing; NO CODE WRITTEN.**
      Traced the whole chain and it is intact: `adjustStock` fires `notify()`
      on CROSSING into low stock (gated on `notifications.lowStockAlerts`,
      default ON), and `notify()` writes the in-app row AND calls
      `sendAlertEmail` — the two are independent, so neither is gated on the
      other succeeding.
      **Why it looks broken:** it is unconfigured. Queried the local database
      directly — there are ZERO `Setting` rows, so everything sits at registry
      defaults, and `email.enabled` defaults to **false**. No `SMTP_*` env
      vars are set either.
      **To switch it on** (owner task, now in `SETUP_TODO.md`): set
      `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD` in `backend/.env`,
      then in Settings turn on **Send email for alerts**, fill **Send emails
      from**, and make sure **Support email** is set — that last one is the
      RECIPIENT (`store.supportEmail`), which is easy to miss because the
      field is not named like one.
      **Added a regression test** (`low-stock-alert.test.ts`) pinning that
      `notify()` reaches `sendAlertEmail`, watched failing. Not because the
      link was broken, but because a working-but-unconfigured feature is
      exactly what gets rebuilt by the next person who looks.

### Older, from §U / the G-GATE
- [ ] Optimistic row updates with rollback
- [x] **Bulk-action progress — DONE 2026-09-08.** The confirm button counts
      real completions ("Deleting 3 of 12…") as each request lands. The
      requests still all go out at once: serialising them for a tidy counter
      would make deleting 50 rows genuinely SLOWER for the sake of a label,
      so the count reflects actual completions rather than a simulated
      animation. Hidden for a single row — "1 of 1" resolves faster than the
      eye reads it. **Orders' bulk status change deliberately gets NO
      counter**: it sends one request for the whole batch, so there is nothing
      to count and a progress number there would be a lie. Watched failing
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

1. ~~**F6.1 — the `Shift` model's shape.**~~ **ANSWERED 2026-09-08 — see O5.1.**
   A shift is a period of WORK (employee · branch · start · end), distinct from a `Session`,
   which is system activity. A manager may correct one and the correction stays visible;
   actual worked time only, no planned rota.
2. ~~**F7.8 — QR vs serial.**~~ **ANSWERED 2026-09-08: BATCH details, not per-unit serials.**
   The owner's words: "the owner will buy the stock of 50 units then enter one unit details
   once". That is one record per RECEIPT, not fifty identities — and `StockMovement` is already
   exactly that shape (a receipt of 50 is one row, already carrying `unitCost` and `note`). So
   this is F7.8's "rest" — receipt / delivery / purchase date, plus a supplier link — added to
   `StockMovement`, NOT loose columns on `Product`, which would have to be undone. Per-unit
   serials were considered and are NOT what was asked for: they need a different inventory model
   (a count plus a movement log cannot express "unit #47 came back faulty").
3. ~~**Pre-push `next build`.**~~ **DECIDED + DONE 2026-09-08 — option (c), automated.**
   `frontend/scripts/check-suspense-risk.sh` greps what the push actually ADDS for
   `useSearchParams`/`useParams`; no match exits instantly, a match runs the build. Every push
   pays nothing; the handful that can break pay 90s. Running it on every push was rejected for a
   behavioural reason, not a performance one: 90s on doc-only pushes is enough friction to get
   bypassed with `--no-verify`, and a check people skip is worse than one that runs rarely and
   honestly. It also REFUSES to build when `frontend/.next` looks like a live dev server's cache
   (no `BUILD_ID`), because building into it corrupts the cache and the dev server then throws
   module-not-found errors that read like a code regression. Both paths tested: skip on a clean
   push, and detection + the dev-server refusal on a probe commit.
4. **F7.10 — re-seed the demo data. POSTPONED by the owner 2026-09-08.** Not blocked, not
   wanted yet. The seeder covers businesses, branches, per-branch stock, staff, returns,
   variants and order notes; the local DB predates several of those.
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

