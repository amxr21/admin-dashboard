# Urgent TODO — owner review queue

Created from the owner’s production and UX review on 2026-09-11. This file is the
authoritative queue for these notes. The owner approved starting this queue on 2026-09-11; work
proceeds in the order below unless a newly confirmed dependency requires a documented reorder.

## Reconciled status — 2026-09-12

`[x]` means the scoped implementation exists locally, not that production has been verified or a
PR merged. `[*]` means actively incomplete/reopened. `[ ]` means not started; a blocked item names
the missing evidence or decision. The local branch is `fix/urgent-refund-cancel-reasons`, with
unpublished local commits at this review; GitHub PR checks could not be refreshed because `gh`
returned HTTP 401. Never promote a historical CI result to a current green claim.

| Item | State | Evidence and exact remaining acceptance |
| --- | --- | --- |
| URG-001 | `[*]` | Versioned startup/migration work in PR #217; authenticated Organization read in the deployed app and request-ID/log correlation still required. |
| URG-002 | `[*]` | Customer Cases tests in PR #218; authenticated list, empty, error and branch-permission checks after deploy still required. |
| URG-003 | `[*]` | Parser envelope fix in PR #219; authenticated real checkout/receipt/stock verification after deploy still required. |
| URG-004 | `[*]` | PR #220 has schema-history and live-shape checks, but non-zero deploy/status can be bypassed by shape parity, which does not verify data-only migrations. Decide and test a safe repair/quarantine procedure for missing bookkeeping before closing. |
| URG-005 | `[x]` | Atomic conditional branch-stock decrement and loser refusal implemented; verify current PR CI and deployed concurrent sale before production sign-off. |
| URG-006 | `[x]` | Owner chose visible-disabled sold-out tiles; direct scan now refuses zero stock. Preserve that explicit exception to the original hide request. |
| URG-007 | `[x]` | Cash received required for single and split cash tender; confirm local/current CI and deployed currency/rounding behavior. |
| URG-008 | `[x]` | Failed charge keeps focus inside dialog; successful close restores scan focus. Browser keyboard/assistive-tech acceptance still valuable. |
| URG-009 | `[*]` | Return-based refund uses enum + Other; Order Details goodwill refund still uses unrestricted free text and lacks the code. Cover both workflows before closing. |
| URG-010 | `[x]` | Single and bulk cancellation reasons implemented; current CI and deployed audit display need confirmation. |
| URG-011 | `[*]` | Sidebar rows became shorter and its scrollbar thinner; two independently scrollable regions can still coexist on short viewports. Recheck owner's screenshot dimensions and both open/closed sheet states before claiming resolved. |
| URG-012 | `[x]` | Shared Button/Input/Select, sidebar and shell spacing compacted one step; no global font shrink. Verify keyboard/touch/Arabic/phone layouts in acceptance. |
| URG-013 | `[*]` | Email/phone/URL examples were added, but ordinary text/number/password fields remain without placeholders (e.g. staff name, branch name). Audit by field; do not use a misleading generic value or replace labels. |
| URG-014 | `[*]` | Trigger cap rose to 320px plus a tooltip, but it remains a fixed `max-w-80` with truncated selected text, not auto-sized as requested. Check long options and narrow widths in both locales. |
| URG-015 | Blocked | Current seeded routes did not reproduce fading/clipping. Need one exact page, dropdown and action/viewport before changing shared portal/overflow behavior. |
| URG-016–024 | `[ ]` | Currency, zone, country/city/dialing code, business type, phone, tax/TRN and identity controls still need canonical data and country-aware validation. |
| URG-025–032 | `[ ]` | Product progressive disclosure, relevant physical fields, slug/code types, optional variants/colors and category creation remain. |
| URG-033 | `[ ]` | Order detail sections still need accessible collapsible groups. |
| URG-034 | `[ ]` | Finish multi-currency selector/receipt/per-currency shift count against store default. |
| URG-035 | `[ ]` | Every form and field still needs the named inventory, control/validation review and sign-off; this includes the URG-013 remainder. |
| URG-036 | `[ ]` | Reverify singly assigned cashier starts a shift without admin branch switching, including ambiguous assignments. |

### Correction and delivery batches, in stack order

- [*] **R0 — restore the durable handoff.** Track this file again; synchronize `CLAUDE.md` and
      `TODO.md` to the actual active branch, local-only commits, PR uncertainty, reopened items,
      owner decisions and the next exact task. Commit/push only the handoff on the current stack
      after verifying its base; do not stage either untracked frontend diagnostic artifact.
- [ ] **R1 — release/data migration safety (URG-004).** Inspect every data-only/backfill migration;
      reproduce missing `_prisma_migrations` on a disposable database only; specify when shape
      parity is insufficient; make migration deploy/status outcomes actionable without converting a
      bookkeeping failure into a blanket outage; test missing backfill, real drift, and healthy
      startup. One branch stacked on R0; full backend/CI gate and release runbook before merge.
- [ ] **R2 — complete refund reasons (URG-009).** Extend the same fixed catalogue + Other contract to
      goodwill refunds; preserve the reason on its payment/audit record without inventing an RMA;
      validate API and UI, migrate additively if storage changes, test both refund paths and older
      records. One branch stacked on R1; do not regress cancellation reasons (URG-010).
- [ ] **R3 — finish shell/field corrections (URG-011/013/014).** Reproduce short-screen two-scrollbar
      state; resolve it without trapping navigation; inventory missing placeholders field-by-field;
      implement selected-branch/content width with narrow-screen fallback; test keyboard, mobile,
      Arabic/RTL and both ordinary/long names. Split into separate stacked PRs per concern.
- [ ] **R4 — verify published stack and production blockers (URG-001–010, 012).** Publish the local
      commits through their intended stacked PR, refresh all GitHub checks, merge only in base order
      after passing gates, then verify authenticated Organization, Customer Cases, checkout, stock,
      cash, refund/cancel and focus in production. Do not mark an endpoint 500 fixed solely from a
      401 probe or a migrated test database.
- [ ] **R5 — remaining approved queue.** URG-035 field inventory first, then URG-016–024 structured
      organization/identity inputs; URG-025–032 product/category simplification; URG-033 order
      details; URG-034 till currencies; URG-036 cashier branch regression. URG-015 waits for a
      reproducible exact surface. One reviewable stackable branch per logical batch with chat and
      file checklists kept current.

## Rules for every urgent batch

These are recurring gates for each new branch, not one-time unfinished tickets.

- [ ] Keep each batch on its own stackable branch and preserve the documented merge order.
- [ ] At batch start, post every task as a checklist and mark the active task with `[*]`.
- [ ] Reproduce defects before changing code and record the actual root cause.
- [ ] Keep validation and business rules in shared contracts, with the server authoritative for
      financial, stock, authorization, and data-integrity rules.
- [ ] Preserve English/LTR and Arabic/RTL behavior, keyboard access, responsive layouts, and
      explicit loading/error/empty states.
- [ ] Add focused regression coverage, run relevant lint/type/tests/build checks, update project
      records, commit, push, open a stacked PR, and inspect GitHub checks.
- [ ] Do not replace visible labels with placeholders; placeholders are examples or format hints.

## U0 — production blockers and data safety (P0)

- [*] **URG-001 — Organization Settings API returns 500.** Reproduce
      `GET /api/v1/organization` in the deployed environment, correlate the request ID with backend
      logs, check deployment migration/schema parity and runtime configuration, fix the root cause,
      and return the normal structured error envelope for any recoverable failure. Verify
      `/admin/settings/organization` in both locales and at mobile/desktop widths.
      A versioned production-start gate attempts committed Prisma migrations before the HTTP
      server imports. It blocks live-schema drift but currently permits non-zero deploy/status
      when shape matches; URG-004 tracks the data-only migration caveat. Earlier local startup,
      Organization API, type, lint, and build checks passed. Final closure awaits the authenticated
      production page after the required stack is merged and deployed.
- [*] **URG-002 — Customer Service API returns 500.** Independently reproduce
      `GET /api/v1/customer-cases?page=1&pageSize=20`, inspect logs and schema/runtime dependencies,
      fix the cause, and verify populated, empty, forbidden, and failed states. Do not treat the
      browser’s repeated React stack frames as separate API failures.
      The deployed unauthenticated boundary returns the normal 401 envelope and request ID. The
      first authenticated query depends on `customer_cases`, introduced with migration
      `20260910150000_add_customer_service_workspace`; code and schema match, and the endpoint works
      on the migrated test database. Current evidence therefore points to the same deployment drift
      addressed by parent PR #217, not a second endpoint defect. Exact-query, empty, paginated,
      forbidden, and invalid-input regression coverage was added on PR #218;
      final closure awaits an authenticated post-deploy check.
- [*] **URG-003 — POS checkout returns 500.** Reproduce `POST /api/v1/pos/checkout` using the exact
      failing request shape without exposing customer/payment data, correlate its request ID,
      identify whether the failure is validation, migration, stock, tender, or transaction related,
      and make expected business refusals return actionable 4xx reason codes instead of 500.
      Historical implementation branch: `fix/urgent-pos-checkout-api-500`, stacked on URG-002 PR #218. A valid fake,
      unauthenticated checkout payload reaches the deployed authentication guard and returns the
      normal JSON 401 envelope. After authentication, checkout first reads `idempotency_records`,
      introduced by migration `20260910120000_add_idempotency_records`; this precedes every sale
      write and is the strongest direct explanation for the reported production 500 when migrations
      were skipped. The migrated integration suite proves successful atomic checkout, retry-safe
      replay, stock/tender refusals, and structured 4xx responses. Separately, a malformed JSON probe
      exposed a real shared defect: `express.json()` ran before request context, so the final error
      handler had no logger/request ID and Express fell back to an HTML 500. The branch now creates
      request context before parsing and normalizes malformed JSON to `400 BAD_REQUEST` and bodies
      over 1 MB to `413 PAYLOAD_TOO_LARGE`, both in the shared JSON envelope with a correlated request
      ID and without logging request bodies. Focused health/POS tests pass 77/77; lint, type-check,
      build, and merge-integrity checks passed at that review. PR #219 targeted URG-002 PR #218;
      current checks/merge state require an authenticated refresh. Remaining acceptance: CI, then an
      authenticated checkout after parent PR #217 deploys its migration gate.
- [*] **URG-004 — Production release/schema integrity check.** Verify that every migration required
      by the merged stack is deployed exactly once, the generated Prisma client matches the running
      schema, and Organization, Customer Cases, and Checkout share no hidden production-only
      dependency. Add a deployment check that catches the confirmed class of mismatch before the
      application is promoted. Active branch: `fix/urgent-production-schema-integrity`, stacked
      directly on URG-003 PR #219. PR #220 passed its checks at the time recorded below; current
      GitHub checks have not been refreshed. Engineering remains incomplete: the present startup
      gate permits non-zero deploy/status when live schema shape matches, but a shape comparison
      cannot establish whether data-only migrations/backfills were applied. This is a potential
      integrity gap, not evidence that production data is currently wrong. Authenticated
      post-deploy verification of URG-001–004 also remains.
      Atomic handoff checklist:
      - [x] Confirm the branch starts from URG-003 PR #219 rather than `dev`.
      - [x] Inspect root/backend package scripts for every build, start, and database command.
      - [x] Inspect GitHub CI and locate the migration-validation/promotion boundary.
      - [x] Inspect the Coolify-facing production start path.
      - [x] Confirm `npm start` is the sole repository-controlled production server entry.
      - [x] Confirm startup database commands use the APP_MODE/database-host safety guard.
      - [x] Confirm backend build generates Prisma Client from committed `schema.prisma`.
      - [x] Confirm CI applies committed migrations before integration tests.
      - [x] Identify the gap where a schema edit can compile without a matching migration.
      - [x] Add one reusable migration-history versus Prisma-schema comparison script.
      - [x] Require an explicit shadow database URL for the history comparison.
      - [x] Reject missing, malformed, non-MySQL, remote, and non-test shadow URLs.
      - [x] Ensure the comparison cannot reset a production/shared database.
      - [x] Add schema-history parity before CI migration application/integration tests.
      - [x] Give schema drift an actionable missing-migration failure distinct from process failure.
      - [x] Run `prisma migrate status` after production `migrate deploy`.
      - [*] Define when migration deployment failure blocks server import; current code allows
            non-zero deploy if shape matches, so data-only migration outcomes need a safe policy.
      - [*] Define how missing/unhealthy migration history is repaired or quarantined; current
            status failure is diagnostic only when shape matches.
      - [x] Add a read-only running-database versus `schema.prisma` parity check after status.
      - [x] Block server import when the live database shape differs from application schema.
      - [x] Verify the live parity command cannot mutate the database. `migrate diff` only
            introspects and compares; the argument list is asserted to contain no
            `deploy`/`dev`/`push`.
      - [x] **Corrected which signal may block startup (real defect found this session).** The gate
            originally refused to serve traffic on any non-zero `prisma migrate deploy` OR
            `prisma migrate status`. Verified locally that `admin_dashboard_test` holds all 54
            correct tables with `_prisma_migrations` missing: `migrate status` exits 1 reporting all
            57 migrations unapplied while the live schema diff reports "No difference detected", and
            `migrate deploy` fails replaying migration #1 over existing tables. The original gate
            would therefore have turned a recoverable bookkeeping gap — seen four times on this
            project — into a total production outage. Live schema shape is now the sole authority;
            deploy/status failures are logged loudly and non-fatal; a thrown runner error still
            aborts.
      - [x] Test exact startup order: deploy -> status -> live schema parity -> server import.
      - [x] Test deploy/status non-zero are non-fatal when live schema matches, and that process
            rejection still blocks server import.
      - [ ] Inventory all data-only/backfill migrations and establish their application without
            guessing from live table shape when migration bookkeeping is missing.
      - [ ] Test a non-destructive repair/quarantine policy for missing history, unapplied data
            backfill, genuine drift, and healthy startup on disposable test databases.
      - [x] Test the live schema check still runs after both migration commands fail.
      - [x] Test live-schema drift blocks server import.
      - [x] Test schema-history success, missing-migration drift, and process failure.
      - [x] Test unsafe shadow URL refusals and prove the comparison never starts.
      - [x] Resolve/document Windows MySQL case-insensitive join-table false positives without
            renaming production tables or changing existing relation data. Not reproduced: the live
            parity diff returned "No difference detected" against the migrated local database.
      - [x] Run focused startup/schema-integrity tests. 17/17 pass; targeted ESLint clean.
      - [x] Run the real migration-history parity check in Linux GitHub CI. **Its first real run
            failed, and the check itself was the cause.** PR #220's `Backend · Tests` died at
            "Apply migrations to the test database" with `P3005: The database schema is not empty`,
            while parent PR #219 was fully green. The new step pointed
            `SCHEMA_CHECK_SHADOW_DATABASE_URL` at `admin_dashboard_test` — the same database the
            tests use. `migrate diff --from-migrations` replays all 57 migrations INTO the shadow
            database to compute its comparison, leaving it populated with no migration history, so
            the following `migrate deploy` correctly refused. Fixed by giving the check its own
            `admin_dashboard_shadow_test` database, created in the step because the service block
            only auto-creates the test one and Prisma resets a shadow database without creating it.
            The name still satisfies the script's loopback + contains-"test" guard.
      - [*] Run backend lint, type-check, build, merge-integrity, and full relevant tests for the
            completed correction. The earlier session deliberately skipped database/server suites
            and production build; focused startup/schema tests and targeted lint passed then.
      - [x] Update `URGENT_TODO.md`, `TODO.md`, `CLAUDE.md`, foundations, diagnostics comments, the
            error log, and private workbook with exact evidence and remaining acceptance.
      - [x] Commit only URG-004 files; never stage the two user diagnostic artifacts. The two
            artifacts remain untracked through every branch in the stack.
      - [x] Push and open the PR against `fix/urgent-pos-checkout-api-500`. PR #220.
      - [x] Inspect every GitHub check and record failures/pending/success precisely. #220 is green
            after the shadow-database repair; its first run failed and the check itself was the cause.
      - [ ] Keep URG-001–004 active until authenticated post-deploy Organization, Customer Cases,
            and Checkout verification passes.
      - [x] Start URG-005 directly from URG-004's final commit.

## U1 — till correctness and cashier safety (P0/P1)

- [x] **URG-005 — Prevent overselling authoritatively.** Reject checkout when requested quantity
      exceeds the selected branch’s available stock, inside the same transaction that creates the
      order/payment/stock movement. Cover concurrent checkouts so two cashiers cannot both consume
      the final units.
      **Root cause (confirmed by reading, not assumed):** `executeIdempotently` opens the checkout
      transaction with no `isolationLevel`, so it runs at MySQL's default REPEATABLE READ.
      `checkoutOnce` read branch stock into a map, checked `line.quantity > available`, then issued
      an UNCONDITIONAL `branchStock.upsert({ update: { quantity: { decrement } } })`. Two cashiers
      with DIFFERENT idempotency keys both read `available = 1`, both passed the check, and both
      decremented — the shelf reaching -1. `@@unique([productId, branchId])` constrains the row's
      IDENTITY, not its VALUE, so the upsert could not catch it.
      **Fix:** the decrement is now a conditional `updateMany` carrying
      `quantity: { gte: line.quantity }` in the WHERE clause; `count === 0` is the refusal, and it
      re-reads the row to name the real remaining count. Check and write are one atomic statement —
      the same TOCTOU-closing shape the password-reset redemption already uses. The read-based
      check is retained as the FRIENDLY refusal (it names the product) but is explicitly no longer
      the safety boundary.
      **Rejected:** Serializable isolation — it would serialize every sale including the
      overwhelming majority that never contend for one row, and add deadlock retries across the
      whole checkout to fix a single-row conflict.
      **Preserved:** the `inventory.allowNegativeStock` escape hatch (O5.8) still takes the
      unconditional path, because a shop mid-stocktake has deliberately accepted lagging counts.
      **Audited, no change needed:** the other three `branchStock` writers cannot oversell —
      void/restock and return-restock INCREMENT, the inventory adjustment is an explicit human act
      rather than a race, and the product-create hook writes an opening figure.
      **Deliberately unchanged:** the till still WARNS rather than blocks above stock
      (`sale-screen.tsx`), matching the documented "the server decides" split; URG-005 is a
      server-authority requirement and the server is now authoritative.
      **Second defect, found by CI (PR #221):** the guard stopped the oversell, but the LOSING
      cashier received a 500 rather than a refusal —
      `AssertionError: expected [ 201, 500 ] to deeply equal [ 201, 400 ]`, caused by
      `Transaction failed due to a write conflict or a deadlock`. Both transactions write an order,
      its items and a stock movement BEFORE the decrement, so they hold locks and then contend on
      the same `branch_stock` row; InnoDB aborts one with P2034, which escaped unmapped. That
      violated URG-003's own principle that expected business refusals must return actionable 4xx.
      P2034 now maps to the SAME 400 the pre-flight check returns, following the existing
      `storefront.service.ts` precedent — which maps to 409 only because ITS pre-flight returns 409;
      the rule being copied is "both paths look the same", not the status code. Not retried: the
      transaction is already rolled back and retrying under a claimed idempotency key would re-run
      the whole sale.
      **Verification:** backend typecheck + targeted ESLint clean. CI run on PR #221 proved the fix
      works — 1235/1236 passed, the oversell was prevented, stock stayed at 0, and the sibling
      over-quantity refusal passed; the single failure was the unmapped 500 now corrected. The two
      integration tests could not run locally (`admin_dashboard_test` has 54 tables but an
      unbaselined `_prisma_migrations`), so CI is their real gate.
- [x] **URG-006 — Hide out-of-stock items from till browsing.** Product browsing/search should omit
      variants with no sellable stock at the active branch. A direct barcode/SKU scan of an
      unavailable item must show an explicit “out of stock” result rather than silently doing
      nothing or adding it.
      **Browse half — owner decided to KEEP the existing behavior rather than omit.** The grid
      already blocks these items: `product-grid.tsx` disables the tile, renders an “out of stock”
      badge, and carries a comment recording that the owner previously asked to check stock “before
      listing the items” and it was decided as visible-but-disabled — because a tile that vanishes
      leaves a cashier unable to tell “we just ran out of X” from “we never had X”. Asked again on
      2026-09-11 with that context; the owner confirmed keeping disabled tiles. No browse query
      change was made, deliberately. A settings toggle was offered and not taken.
      **Scan half — a real gap, now fixed.** `sale-screen.tsx` called `addToCart(product)`
      unconditionally, so scanning a sold-out item silently added it — the one remaining path that
      could put a zero-stock line in the cart. It now refuses with a named message and keeps the
      code in the field, matching the not-found path beside it. Deliberately NOT the cart's
      warn-don't-block rule: that is a quantity correction on a line already added, whereas this is
      the decision to add a line at all — the same distinction the grid tile draws.
      `branchStock === null` (no branch in context) means stock is unknowable, so nothing is refused.
      **Verification:** 30/30 POS frontend tests pass including three new ones (refuses a zero-stock
      scan, still adds when no branch is in context, and the pre-existing quantity warning still only
      warns); en/ar parity holds at 2273/2273 with the new key in both locales; i18n parity suite
      19/19; frontend typecheck and targeted ESLint clean.
- [x] **URG-007 — Enforce cash received against the amount due.** For cash tenders, the accepted
      amount must be at least the total due in the tender currency; the UI must prevent submission
      and explain the shortage, while the backend independently refuses underpayment. Change must
      use the same rounding and tender-rate contract as checkout.
      **Root cause:** the server guard read `if (tendered !== null && tendered.lessThan(tenderDue))`,
      and `tendered` is `null` whenever the field is omitted — which Zod allowed, since it is
      `.optional()`. So a cash sale that simply sent no `tendered` **skipped the underpayment check
      entirely** and completed with `tendered: null, change: null`. The same hole existed per-entry
      in the split path. The frontend made it reachable rather than theoretical: it only included
      `tendered` when non-empty, and Take Payment was disabled solely on an empty cart.
      **Owner decision:** cash requires a tendered amount (asked 2026-09-11, "Require it for cash").
      **Fix:** a cash `method`, and each cash split leg, must record what was handed over; both
      refuse with `Enter the cash received` otherwise. Compared against `tenderDue`, not the base
      total, so the existing foreign-currency contract is preserved untouched. Card and transfer are
      unaffected — `null` there means "not applicable", never "unrecorded".
      **Second gap found while fixing it:** `splitLines` carried a `tendered` field in state and
      sent it, but **no input was ever rendered for a split leg** — only method and amount. So
      `line.tendered` was permanently `''` and every cash leg omitted its tender. Requiring it
      server-side without this would have made every split sale containing a cash leg impossible
      from the till. The per-leg input is now rendered for cash legs only.
      **UI half:** the shortfall (missing or short) is explained above Take Payment and disables it,
      before the confirm dialog rather than at it — the same reasoning the manager-override dialog
      already used. The server independently enforces the rule, so this is a courtesy, not the
      boundary.
      **Blast radius — first measurement was WRONG, corrected by CI.** An initial scan claimed only
      3 backend tests completed a cash sale. That scan looked ±6 lines around `method: 'cash'` for a
      `tendered:` token, so it missed sales whose assertion sits further away and missed
      split-payment cash legs entirely. CI found 5 more: the two-cashier oversell race (which failed
      `[400, 400]` — neither side could win), `refuses reuse of a key for different sale details`,
      both discount-override completions, and `records the order paymentMethod as "split"` (which
      asserts on the order row rather than a status code, so no `toBe(201)` existed to detect).
      **8 backend tests needed a tender, not 3.** The remaining 13 untendered cash sales are
      genuine negative-path tests refused before payment and were deliberately left alone — adding
      tenders there would mask what they assert.
      **Lesson recorded:** a proximity-based grep is not a measurement. A test "completes a sale" if
      it reads back `data.orderId`, the order row, or payments — not only if it asserts `201`.
      On the frontend, 16 tests broke because Take Payment is now disabled until cash covers the
      total; 11 flowed through the shared `takePaymentThroughConfirm` helper and were fixed at that
      one point, the rest individually.
      **Verification:** 32/32 POS frontend tests; en/ar parity 2278/2278; both typechecks and
      targeted ESLint clean. The three new backend tender tests (cash with no tender refused, cash
      split leg with no tender refused, card with no tender still accepted) could not run locally —
      `admin_dashboard_test` has an unbaselined `_prisma_migrations` — so CI is their first gate.
- [x] **URG-008 — Fix checkout dialog focus/`aria-hidden` warning.** Move focus into the opened
      dialog and restore it safely on close so the previously focused `#pos-scan` input is never
      hidden from assistive technology. Verify keyboard-only checkout and cancellation.
      **Root cause:** `takePayment`'s `finally` called `refocus()` unconditionally. On a FAILED
      charge the dialog deliberately stays open — the `AlertDialogAction` prevents its own default
      close so the cashier can read the refusal — and Radix marks everything outside an open dialog
      `aria-hidden="true"`. Focusing `#pos-scan` from there therefore moved focus onto an element
      hidden from assistive technology (the reported warning) and silently pulled keyboard focus
      out of the dialog the cashier was still reading. On success the dialog is already closed, so
      refocusing is correct there.
      **Fix:** refocus only when the dialog is actually gone.
      **A bug in the first attempt, caught by its own test:** the open state was tracked with a
      `useRef` mirrored by a `useEffect`. `setConfirmOpen(false)` is batched, so that effect had not
      run when `finally` read the ref — it was still `true`, the success path never refocused, and
      focus landed on `<body>`. The ref is now set synchronously beside `setConfirmOpen(false)`,
      with the effect kept only as a safety net for external closes (Cancel/Escape).
      **Audited, no change needed:** the other four `refocus()` call sites run with no dialog open,
      and the other four `autoFocus` usages (park dialog, shift clock, till events, till return) are
      all INSIDE their own dialog or sheet, which is correct — Radix focuses them within the trap.
      `#pos-scan` was the only element focused from outside an open dialog.
      **Verification:** 34/34 POS frontend tests including two new ones — focus stays inside the
      dialog when a charge is refused, and returns to the scan field after a successful sale.
      Frontend typecheck and targeted ESLint clean.
- [*] **URG-009 — Configurable refund reasons with Other.** Present an approved reason catalogue;
      selecting `Other` reveals a required free-text field. Persist a stable reason code plus the
      optional note, show it in refund/audit views, and validate both client and server.
      **Owner decisions (2026-09-12):** exactly one reason plus an `Other` note; a fixed enum in
      code rather than an admin-managed catalogue; values chosen without waiting for approval.
      **Catalogue:** DAMAGED, WRONG_ITEM, NOT_AS_DESCRIBED, FAULTY, CHANGED_MIND, OTHER.
      **Deliberately separate from the existing `ReturnCategory`.** That enum records why the
      CUSTOMER says they are returning an item; this records why STAFF chose to refund. The two can
      legitimately disagree — a customer claiming NOT_AS_DESCRIBED may be refunded as CHANGED_MIND
      once staff inspect it — and collapsing them into one column would lose exactly that
      disagreement.
      **Contract:** required when `resolution = REFUND`, refused on any other resolution (a refund
      reason on a REPLACEMENT is a stored fact that never happened); the note is required for OTHER
      and refused for a catalogued reason, so the code stays the thing reports group by. Both
      columns are written in the SAME transaction as the refund itself.
      **Where:** `RefundReason` enum + `Return.refundReason`/`refundReasonNote`
      (`20260912000000_add_refund_and_cancellation_reasons`, additive and nullable — existing
      refunds are a real "never recorded" gap, never backfilled with a guess),
      `assertRefundReason` in `returns.service.ts`, `approveBody` in `returns.route.ts`,
      `return-detail-sheet.tsx`, `returns-api.ts`.
      **Remaining:** the separate goodwill refund in Order Details still accepts unrestricted
      free-text reason and stores no catalogue code. Extend the same reason + Other contract to
      `refund-order-dialog.tsx`, the order refund route/service, payment/audit display, and tests;
      preserve pre-existing records without inventing a reason or an RMA.
- [x] **URG-010 — Configurable order-cancellation reasons with Other.** Before cancelling, require a
      reason from an approved catalogue; selecting `Other` reveals required free text. Persist and
      audit the code/note and keep cancellation authorization and stock effects transactional.
      **Catalogue:** OUT_OF_STOCK, CUSTOMER_REQUEST, DUPLICATE_ORDER, PAYMENT_FAILED,
      UNABLE_TO_FULFILL, OTHER. Kept as its OWN enum rather than shared with refunds: a cancellation
      happens before fulfilment and has different causes, so one shared list would force both to
      carry values that are nonsense for the other.
      **The bulk hole this avoids:** validation lives in `changeOrderStatus`, not the route, because
      `bulkChangeOrderStatus` calls that same function. A check in the route alone would have left
      the bulk path able to cancel up to 200 orders with no reason at all. The bulk dialog asks once
      — cancelling fifty orders is one decision, not fifty — and the server writes a copy onto each
      row.
      **Where:** `CancellationReason` enum + `Order.cancellationReason`/`cancellationReasonNote`
      (same migration), `assertCancellationReason` in `orders.service.ts`, `statusBody` and
      `bulkStatusBody` in `orders.route.ts`, `order-status-control.tsx`, `orders-table.tsx`,
      `orders-api.ts`. The reason travels in an options object rather than as more positional
      arguments — `(id, to, note, reason, reasonNote)` is unreadable at the call site.
      **A real defect in the first attempt, caught by CI (PR #225) and then reproduced locally.**
      `assertCancellationReason` ran BEFORE `canTransition`, so a missing reason hijacked every
      illegal-cancellation refusal: `SHIPPED -> CANCELED` reported `{ field: 'cancellationReason' }`
      instead of naming the legal moves, telling the caller to justify a move that was never going
      to be allowed. 21 backend tests failed. The guard now runs AFTER the transition check —
      legality is decided first, and only a move that COULD happen is then asked to justify itself.
      **Test fallout, the URG-007 pattern repeating:** 19 existing REFUND sends and the transition
      matrix's own `CANCELED` cases legitimately needed reasons (the matrix adds one ONLY for
      `CANCELED`, since sending a reason on any other transition is itself refused). Five frontend
      assertions also needed updating — `changeOrderStatus`/`bulkChangeOrderStatus` grew a fourth
      argument, and both the bulk-cancel and refund-approve flows now require a reason before their
      confirm button enables, which the tests now assert rather than route around.
      **Verification:** after the owner allowed killing the two duplicate backend dev servers
      (PIDs 43392/14964) that held the Prisma Windows query-engine DLL, `prisma generate` succeeded
      and the previously blocked checks ran: backend typecheck and lint clean, frontend typecheck
      and lint clean, en/ar parity 2302/2302 with 24 new keys per locale. The additive migration was
      applied to `admin_dashboard_test` (loopback, name contains "test") and live parity then
      reported "No difference detected". Backend returns 49/49, POS 75/75, orders 103/105 — the two
      failures are `429`s in the unrelated goodwill-refund block (`POST /orders/:id/refund`), local
      rate-limit noise from repeated runs, not this change. Frontend orders+returns 100/100 with 1
      skipped. Full-suite runs were deliberately skipped per the owner's lighter-testing rule.
## U2 — shell sizing, scrolling, and dropdown reliability (P1)

- [*] **URG-011 — Reopen the double-scrollbar defect.** Live-reproduced with a real seeded login
      (Playwright against the running dev servers), not read from code alone.
      **Root cause was NOT the branch/business Sheet or Dialog scroll-lock** — both are correctly
      single scrollers, and the existing `body[data-scroll-locked] ... main, nav { overflow:
      hidden }` rule in `globals.css` works as designed whenever a real dialog is open. The actual
      second scroller is the **sidebar `<nav>`** (`sidebar-nav.tsx`): with 19+ items (grows with
      schema resources per this repo's own design) it overflows and scrolls independently of
      `<main>` on common laptop viewport heights — confirmed at 1440x700/730, not contrived. Two
      live, independently scrollable regions on screen at once, on ANY page, not specific to the
      branch/business form; the owner's screenshot happened to be taken on that page.
      **Fix:** tightened nav row height (`py-2` → `py-1.5`) and heading/list spacing
      (`gap-2`→`gap-1`, `pb-1`→`pb-0.5`, `space-y-0.5`→`space-y-px`) to raise the overflow
      threshold, and gave `nav`'s own scrollbar a thin/low-contrast treatment
      (`scrollbar-width: thin` + `::-webkit-scrollbar` rules, both using the existing `--border`
      token) so on the shortest screens where it still needs one, it no longer reads as a second
      scrollbar competing with `main`'s. `<main>` remains the shell's one intended CONTENT
      scroller; nav scrolling on a very short screen is now a quiet fallback for its own fixed
      track, not a competing second one. No change to sticky navigation/actions, mobile drawer,
      dialogs, or RTL — none of those were the actual defect.
      **Verification:** frontend typecheck and targeted ESLint clean. Visual re-check at 1440x730
      confirmed materially more items fit before nav needs to scroll at all. Full suite/build
      deferred per the owner's lighter-testing rule for this pass.
      **Remaining:** shorter rows and a thinner nav scrollbar do not eliminate two independent
      scroll regions at short heights. Recheck the owner's viewport and open/closed sheet states,
      then resolve the interaction without making sidebar destinations unreachable.
- [x] **URG-012 — Reduce global interface density by one to two steps.** Owner decision: one shared
      compact density for everyone, no per-user toggle — kept separate from the existing
      `ui.density` table-row setting (untouched, still owner-configurable per table).
      **One step, at the shared primitives so it's consistent app-wide rather than page-local:**
      Button/Input/Select heights (`h-9`→`h-8` default, `h-8`→`h-7` sm, `h-10`→`h-9` lg, icon
      `size-9`→`size-8` — every size still clears WCAG 2.2's 24px target-size minimum with room to
      spare), sidebar `w-64`→`w-56`, `<main>`'s padding `p-4/p-6`→`p-3/p-5`, and the table-cell-py
      COMFORTABLE-baseline default `0.5rem`→`0.375rem` (the owner-toggleable compact override stays
      at `0.25rem`, still meaningfully denser than the new default).
      **Left alone, deliberately:** root font-size/`--text-*` scale (this file's own Arabic-typeface
      comment already documents why scaling the root is risky — inflates layout, not just glyphs;
      shrinking further also risked hurting readability more than density), charts (no real-browser
      visual check performed on Recharts internals this pass), and Sheet/Dialog padding (`p-4` was
      not an outlier next to the shrunk primitives).
      **Verification:** frontend typecheck and targeted ESLint clean. Visually confirmed live
      (seeded login, dashboard + branches list at 1440x900): full sidebar nav now fits with room to
      spare, no overlap/truncation beyond a pre-existing `truncate` on an unusually long placeholder
      store name, which degrades gracefully. Full suite/build deferred per the owner's
      lighter-testing rule.
- [*] **URG-013 — Add useful placeholders to every text-entry control.** Initial inventory (41
      files with `<Input>`) before touching anything.
      **Search/filter/code inputs already had placeholders everywhere** — every table search box
      (orders/staff/returns/inventory/suppliers/couriers/audit/notifications), the topbar global
      search, the resource-engine list search, and the courier login access-code field. No gap.
      **The real gap was email/phone/url TYPED fields** — `resource-form.tsx`'s `placeholderFor`
      only handled `money`; every bespoke form with a real `type="email"/"tel"/"url"` input had none
      (branch/business, staff, invite-staff, supplier, forgot-password, manager-override — the
      generic resource engine already covers products/notifications/categories/customers/
      discounts/reviews). Fixed with one shared `common.placeholders.{email,phone,url}` translation,
      reused by `placeholderFor` and by every bespoke caller — one source of truth, not seven
      copies that could drift.
      **Deliberately NOT touched:** `text`/`longtext`/`number` fields. Per this ticket's own
      caution — their real content varies per FIELD (a product name vs. a SKU vs. a quantity vs.
      someone's age), so a single generic placeholder would be a guess at best, actively misleading
      at worst. A per-field placeholder for those belongs in `admin.config.ts`, not a type-level
      default. Organization's owner-configurable custom fields only support
      `text | number | date | boolean` — no email/tel/url variant exists there to extend.
      **Verification:** en/ar parity 2305/2305 (3 new keys/locale); the translated-Arabic guard
      test (`messages.test.ts`) required — and got — an explicit allowlist entry for the new keys,
      same reasoning already documented there for `auth.emailPlaceholder`/`imageUpload.urlPlaceholder`
      (a format example is the same shape in every language). Frontend typecheck and targeted
      ESLint clean; full suite deferred per the owner's lighter-testing rule.
      **Remaining:** staff and branch names, among other ordinary text/number/password fields,
      still have no placeholder. Inventory each form field and add meaningful field-specific
      examples or format hints where appropriate; retain visible labels and avoid generic guesses.
- [*] **URG-014 — Make branch selectors fit their content.** One shared component
      (`branch-switcher.tsx`) — no other branch trigger/popover exists in the app.
      **Root cause:** a flat `max-w-56` (224px) on the trigger regardless of content, so a real
      branch name (business prefix, name, disambiguating code — e.g. `_demo__ Corniche  CRN`)
      cropped well before it needed to.
      **Fix:** `max-w-56`→`max-w-80` (320px; stayed `w-full` so it still shrinks on a narrow
      topbar rather than forcing one), plus a `Tooltip` fallback showing the full name for
      whatever still doesn't fit — shown only for a genuinely selected branch, never the
      always-short "All branches" default. Wired the Tooltip onto `SelectTrigger` itself, not the
      `Select` root — `TooltipTrigger asChild` clones its child and forwards a ref, which needs a
      real DOM-rendering element, not the context-provider root wrapping it.
      **Verification:** frontend typecheck clean, targeted ESLint clean, all 5
      `branch-switcher.test.tsx` cases pass. Visually confirmed live (seeded login, dashboard):
      the open dropdown renders every demo branch name and code fully, no cropping.
      **Remaining:** the selected trigger still has a fixed `max-w-80` and `truncate`, so a long
      name remains cropped until hover. Implement content-aware width with a viewport-safe fallback;
      test long names, both locales, keyboard focus, and narrow topbars.
- [ ] **BLOCKED — URG-015 — Fix dropdown/table content fading or disappearing.** Live-reproduction
      attempted (seeded login against the real dev servers) before writing any fix, per this file's
      own rule. Tested and found CORRECT in every case: the shared `RowActions` overflow menu (used
      by every generic-resource table) on the first row, the last row (correctly auto-flips upward
      near the viewport edge), a `Select` opened inside a `Sheet` panel (branch roster — nested
      portal case), and the products/orders/staff table search+list surfaces generally. Every case
      showed full opacity, correct `z-index`, no clipping, and normal Radix Portal-to-`body`
      behavior. One case initially looked wrong on screenshot (an open Person `Select` visually
      overlapping the Role `Select` beneath it in a tight stacked form) but is ordinary floating-
      listbox-over-content behavior, not a stacking/clipping defect — every dropdown in every app
      does this by design.
      **Matches this file's own anticipated outcome** — see "Decisions needed", which already asks
      for "at least one exact table/dropdown route where content fades or disappears if it is not
      reproducible from the current data." It was not reproducible from current data. Owner
      decision: skip for now rather than fix a defect that can't be confirmed to exist; needs an
      exact page/action from the owner before further work.

## U3 — structured organization and identity inputs (P1)

- [ ] **URG-035 — Audit and revise every form field/control.** Inventory every create, edit,
      filter, checkout, settings, and confirmation form. For each field, verify its business
      meaning, required/optional state, editable/read-only state, control type, allowed values,
      default, placeholder, helper text, validation, normalization, error placement, and saved API
      shape. Replace generic text boxes with the appropriate shared shadcn control: searchable
      combobox/select for finite data, calendar/popover for dates, purpose-built money/quantity/
      percentage inputs, country-aware phone/identifier controls, textarea for long notes, and
      toggles/checkboxes only for true boolean choices. Add correct `inputMode`, autocomplete,
      min/max/step, mobile keyboard behavior, English/Arabic copy, RTL/LTR isolation, and matching
      server validation. Track each audited form and field so “reviewed” never means sampled.
- [ ] **URG-016 — Currency must be selected, not free text.** Replace organization currency text
      entry with a searchable ISO 4217 option control showing code and name; store the canonical
      code and keep the configured store currency as the till default.
- [ ] **URG-017 — Time zone must be selected, not free text.** Use a searchable IANA time-zone
      control with readable UTC offsets, retain canonical zone IDs, and handle daylight-saving
      offset changes without storing a fixed offset as the zone.
- [ ] **URG-018 — Country must be selected from canonical options.** Store a stable ISO country code
      and display localized country names. Existing free-text data needs a non-destructive mapping
      or review state.
- [ ] **URG-019 — City must be options-based.** Make city a searchable option constrained by the
      selected country, with a documented fallback for legitimate places absent from the dataset;
      changing country must not silently leave an invalid city.
- [ ] **URG-020 — Calling-country code must be selected.** Derive or select a valid international
      dialing prefix and keep it coordinated with phone formatting; do not confuse dialing prefixes
      with ISO country codes.
- [ ] **URG-021 — Business type must be options-based.** Replace free text with a curated,
      extensible business-type catalogue and an explicit owner-approved fallback for businesses not
      represented by the initial list.
- [ ] **URG-022 — Phone numbers need standard formatting.** Use country-aware entry and validation,
      normalize storage to E.164 where possible, preserve extensions deliberately, and render phone
      identifiers left-to-right in Arabic.
- [ ] **URG-023 — Tax IDs/TRNs need jurisdiction-aware templates.** Validate and format tax
      identifiers based on the selected country and identifier kind. UAE TRN must follow its legal
      shape; other jurisdictions must not be forced into a UAE-only mask.
- [ ] **URG-024 — Other registration/identity numbers need explicit types.** Replace ambiguous
      generic `ID` free text with an owner-approved identifier type and country-aware validator;
      preserve existing values until their type can be mapped safely.

## U4 — simpler, conditional product creation (P1/P2)

- [ ] **URG-025 — Make the default product form basic.** Show only the fields required for a normal
      product first; group advanced merchandising, dimensions, shipping, localized content, and
      other specialist details behind clearly named optional sections.
- [ ] **URG-026 — Show physical attributes only when relevant.** Weight, height, density, and similar
      fields must be enabled by product type or an explicit advanced toggle, not displayed for every
      product. Hidden fields must not submit stale values.
- [ ] **URG-027 — Auto-generate product slugs.** Generate a unique normalized slug from the product
      name, update it predictably while creating, preserve deliberate edits if advanced editing is
      allowed, and resolve collisions server-side.
- [ ] **URG-028 — Curate product code types.** Replace the all-code-types list with the small set the
      product workflow actually supports (for example SKU and the approved retail barcode types),
      while retaining a safe mapping for existing records.
- [ ] **URG-029 — Make variants optional.** A simple product should not require variant complexity;
      enabling variants reveals the variant builder and disabling it requires an explicit safe rule
      for existing variant data.
- [ ] **URG-030 — Make colors optional and variant-aware.** Only show color choices when the owner
      enables that option for the product; use controlled options/custom values without implying
      every product has a color dimension.
- [ ] **URG-031 — Make remaining optional attributes toggleable.** Audit size, material, dimensions,
      shipping and custom attributes individually, place them in reusable optional groups, and keep
      each group’s validation conditional on being enabled.
- [ ] **URG-032 — Redesign category creation for administrators.** Clarify parent selection, name,
      slug generation, status, save/cancel feedback, duplicate handling, and where the created
      category appears. Verify keyboard use, small screens, Arabic, and creating a category without
      leaving the product task.

## U5 — order information architecture (P2)

- [ ] **URG-033 — Make order-detail sections collapsible.** Customer, delivery, payment, items,
      returns, and audit/history sections should use accessible shared accordions with sensible
      defaults, preserved essential status/total information, keyboard operation, and no hidden
      error or destructive action.

## Previously captured related notes

- [ ] **URG-034 — Complete the active multi-currency till batch.** The store setting remains the
      default; finish the currency selector, dual-currency receipt, and per-currency shift count
      against the already documented fixed-rate/tender contract. This is existing Batch 16, not a
      duplicate new implementation.
- [x] **Till customer search was removed from the primary sale flow.** Anonymous checkout remains;
      the backend customer-association contract was deliberately retained for a future secondary
      workflow.
- [x] **The loading overlay was redesigned as a compact horizontal row.** Keep this behavior while
      changing density or shell scrolling.
- [x] **The multi-branch dashboard summary was added.** Keep its single-branch simplification and
      multi-branch comparison behavior while changing global density.
- [ ] **URG-036 — Branch-scoped cashier startup regression check.** Reverify that a cashier with one active
      assignment automatically resolves that branch and can start a shift without using the
      admin-only branch switcher; keep the explicit ambiguity error for multiple assignments.

## Decisions needed before the affected batches

- [x] Refund/cancellation uses exactly one required reason from multiple available choices;
      `Other` requires a note. Owner confirmed 2026-09-12.
- [x] Owner chose fixed code catalogues for now and allowed the initial values to be selected
      without another approval; the implemented refund and cancellation values are recorded in
      URG-009/010. Future admin-managed templates are out of this batch.
- [ ] Clarify which field(s) “IDs” refers to: business registration/license numbers, national IDs,
      product identifiers, or another record.
- [ ] Approve the initial business-type options and whether an `Other` value is allowed.
- [ ] Approve the supported country/city dataset and the fallback behavior for an unlisted city.
- [x] Owner chose one shared compact density, not a user-facing toggle (URG-012).
- [ ] URG-015 was not reproduced from seeded data and owner chose to defer it. Resume when an
      exact table/dropdown route, action, and viewport where content fades is available.

## Inventory reconciliation

| Owner note | Tracked as | Interpretation / gap handled |
| --- | --- | --- |
| Currency, city, country code, and time/zone cannot be free text | URG-016–020 | Split into canonical currency, IANA zone, country, dependent city, and dialing-code controls. |
| Business type must be an options dropdown | URG-021 | Adds an extensible catalogue and a decision on `Other`. |
| Tax IDs, IDs, TRNs, and phones need standard formats | URG-022–024 | Split phone, tax/TRN, and ambiguous IDs; formatting is country-aware, not one global mask. |
| Two scrollbars remain | URG-011 | Reopened despite the earlier completed item because the screenshot is contradictory evidence. |
| Whole app is too big | URG-012 | Converts a subjective global resize into a shared density-system task with accessibility limits. |
| Refund reasons plus Other/free text | URG-009 | Captures catalogue, conditional note, persistence, validation, and audit display. |
| All text fields need placeholders | URG-013 | Makes this an app-wide inventory; retains labels for accessibility. |
| Organization Settings returns 500 | URG-001 and URG-004 | Separates endpoint diagnosis from the release/schema safeguard that should prevent recurrence. |
| Customer Service/customer-cases returns 500 | URG-002 and URG-004 | One API defect despite repeated browser stack frames, plus deployment integrity coverage. |
| Out-of-stock items should not appear in till | URG-006 | Covers browse/search and the direct scan exception. |
| Checkout returns 500 | URG-003 | Separate from the customer-cases request shown in the same console report. |
| Checkout warns about focused input under `aria-hidden` | URG-008 | Explicit dialog focus-management/accessibility regression. |
| Cash received must be at least total | URG-007 | Enforced at UI and server, including currency/rounding behavior. |
| Cannot exceed available stock | URG-005 | Adds transactional and concurrent protection, not just a disabled plus button. |
| Cancelling an order needs reasons plus Other | URG-010 | Kept separate from refund reasons because lifecycle and stock effects differ. |
| Customer/delivery order details should collapse | URG-033 | Expanded to all order-detail sections using a shared accessible pattern. |
| Product form lists irrelevant details | URG-025, URG-026, URG-031 | Splits default progressive disclosure, physical relevance, and remaining optional groups. |
| Slug should be generated and code types reduced | URG-027, URG-028 | Separates identifier generation from the supported-code catalogue. |
| Variants and colors should be toggled | URG-029, URG-030 | Separate optional variant and color dimensions with safe existing-data behavior. |
| Branch dropdown titles are cropped | URG-014 | Shared responsive width/overflow behavior. |
| Table dropdown items fade/disappear | URG-015 | Captures portal, overflow, stacking, gradient, table-position, and RTL cases. |
| Adding a category feels strange | URG-032 | Turns the broad concern into an administrator-focused workflow review and acceptance set. |
| Some fields/input controls must be revised | URG-035 | Adds a complete field-by-field audit covering meaning, control choice, constraints, formatting, help, localization, accessibility, and API validation. |

### Additional gaps added during normalization

- Production `500` fixes need request-ID/log correlation and migration/client parity checks; browser
  stack frames alone cannot identify their root causes.
- Stock and cash rules must be server-enforced and transaction-safe even if the UI also blocks them.
- A hidden out-of-stock product still needs an explicit direct-scan response.
- Country codes, dialing codes, and time zones are different canonical datasets and cannot safely
  share a generic text/dropdown implementation.
- Tax/TRN/ID masks require jurisdiction and identifier type; “standard format” is not globally
  uniform.
- Optional product sections need stale-value rules when toggled off, especially for existing data.
- Placeholder coverage must not remove labels or rely on placeholder text as instructions.
- Input revision is broader than placeholders: every field must use the correct control and data
  contract for what it represents, and the audit must account for every form rather than a sample.
- Refund and cancellation reasons require persisted stable codes and audit visibility, not only
  temporary UI choices.
