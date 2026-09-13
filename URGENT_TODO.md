# Urgent TODO — open owner review queue

Updated 2026-09-12. This file contains **pending work only**. Completed local
implementations and their evidence are in [TODO.md](TODO.md#completed-urgent-implementations--local-record-2026-09-12).
“Implemented locally” does not mean merged, deployed, or verified in production.
The original investigation and acceptance detail remain in this file's git history.

## Current state and release order

- The working branch is `feat/business-setup-wizard` at `e19a470`, with a clean
  working tree. The owner reports most recent branches merged, except #224/#225
  while their tests continue. Confirm exact PR state when GitHub access is
  restored.
- **Corrected 2026-09-13:** the URG-026/031 group-enable work is **committed**,
  not uncommitted. `929a39b`, `c902d5c`, `b162ba9`, `bb924dc` and `470d864` are
  all ancestors of HEAD and present on three branches. The completed urgent
  items and their evidence moved to TODO.md; this file keeps only open work.
  Preserve the untracked frontend diagnostic files; none is part of a release.
- **R1 is cleared locally as of 2026-09-12** (see below). Its two previously
  unproven gates failed for one environmental reason — duplicate dev servers
  holding the Prisma query-engine DLL — not for anything in the code. Before
  re-running a build gate on Windows, check for more than one live
  `tsx watch src/server.ts`: the `EPERM` rename failure and the
  `uv_os_get_passwd` ENOMEM launcher death both trace back to that pile-up.
- `gh auth status` reports an invalid token. Current PR checks, review state,
  mergeability and deployment cannot be confirmed. Historical green checks
  must not be presented as current.
- Work in dependency order: **R1 migration safety → finish/commit current
  product toggles → reviewable stacked batches → current CI and merge in base
  order → R4 authenticated production acceptance**. Keep enhancement work
  separate from the release gate.

## R1 — release and data-migration safety (URG-004, P0)

The production start path compares live schema shape with `schema.prisma`.
When migration deploy/status fail but shape matches, a read-only catalogue
baseline check runs. It blocks a new container on a confirmed missing baseline
or failed check, and otherwise starts with `MIGRATION_DATA_REVIEW_REQUIRED`.
This is implemented locally and focused startup tests passed 26/26. It does
**not** establish that every historical data backfill ran: schema parity cannot
detect data-only migration `20260911100000_backfill_catalogue_version_baselines`.

- [x] Reproduce missing `_prisma_migrations` and an omitted data-only backfill
      on **disposable** databases. `backend/scripts/reproduce-migration-data.mjs`
      now passed against a random local test database: 60 migrations were
      applied with the data-only backfill deliberately omitted; a seeded
      product retained version zero; live schema diff returned zero; dropping
      only the disposable history table made status non-zero; the read-only
      data check returned 2; startup refused admission. The expanded script
      also proved on disposable local databases that live-schema drift returns
      exit 2 and an unavailable read-only data check returns exit 1; neither
      case starts the server. A second fully migrated disposable database
      confirmed healthy history and matching schema admit startup without an
      exceptional data review. It removed both databases and scratch files.
- [x] Finish database-backed and negative-path tests, backend build and
      merge-integrity gate on the R1 commit. **Cleared 2026-09-12.** The
      `EPERM` and `ENOMEM` failures were one environmental cause, not flaky
      tooling: three duplicate `tsx watch src/server.ts` backends were live at
      once, each holding `query_engine-windows.dll.node` open so
      `prisma generate` could never rename the new DLL into place. With them
      stopped, every gate passes on this tree — `npm run build` exit 0,
      `check:merge` exit 0, `migrate status` "up to date", `migrate diff`
      "No difference detected", `db:check-data` exit 0 (30 products, 0 zero
      versions, 0 missing version-1 snapshots), and the disposable repro PASS
      across all five negative paths plus the healthy control. Both typechecks
      and lint clean. **Correction:** the startup evidence is 17 tests, not
      26 — `production-start.test.mjs` and `migration-data.test.mjs` together
      total 17/17. The earlier figure did not match the files on disk.
      Current GitHub CI results still require restored authentication.
- [*] Operator recovery procedure is drafted in
      [RELEASE_MIGRATION_RUNBOOK.md](RELEASE_MIGRATION_RUNBOOK.md). Before
      release, obtain a verified restorable backup, exact target and checksum
      inventory, read-only checks, and per-migration data evidence. Only then
      may an operator plan one-by-one `migrate resolve --applied`.
- [ ] Confirm generated Prisma Client and required migration history match the
      release artifact before promotion. Keep an anomalous history warning
      distinct from a real data or schema admission failure.

## R2/R3 and current product work — commit and split before publication

Goodwill refund reasons, shell sizing/placeholders, canonical organization
controls, phones and tax IDs, product form grouping, slugs, order disclosure
and branch shift resolution are implemented locally; see TODO.md. The current
branch combines several logical batches after R1, so publish reviewable
stacked PRs in their dependency order rather than treating this tip as one
already-approved merge.

- [ ] **Leftover test junk in the local dev database.** The URG-026 probe found
      an existing product named `aaa` in `localhost/admin_dashboard` — same
      family as the earlier category/POS garbage cleanups. Worth a look and a
      clean-up. (URG-026/031 itself is complete and recorded in TODO.md.)
- [ ] **Arabic seeding-from-data is still unobserved.** The URG-026 Arabic leg
      covered the CREATE path only; an existing product seeding its groups from
      its own data has not been watched in Arabic.
- [ ] **URG-029 — remaining browser acceptance.** The implementation is
      complete and recorded in TODO.md. Still to watch in a real browser:
      persisted toggles and re-enable on products with existing variant
      stock/history, create/edit keyboard paths, and both locales. The toggle
      must not delete variant rows.
- [ ] **URG-030 — remaining acceptance and one open decision.** The curated
      colour suggestion is complete and recorded in TODO.md. Still open:
      - the `<datalist>` itself has never been exercised in a browser — the
        probe never opened a variants panel, so it is unit-tested only;
      - `hasColors` is otherwise inert. Nothing reads it outside the
        suggestion: no colour reporting, no POS colour filter, no per-colour
        stock view;
      - **decide whether colour needs its own warn-on-disable at all.**
        URG-029's warning covers `hasVariants` only. Disabling colours only
        withdraws suggestions and hides no data, so a warning may be noise.

## R4 — publish, merge and verify the urgent stack (P0/P1)

- [ ] Restore GitHub authentication and inspect **current** checks, base
      branches, review state and mergeability for the stacked PRs (including
      #217–#225 where applicable). Check count and type of jobs: a stacked PR
      with missing CI jobs is not green. Run required local gates on the exact
      commits being proposed. Do not merge a dirty working tree or skip R1.
- [ ] Merge only from the bottom of the stack after each branch's required
      checks pass. Confirm migrations are applied once and the running
      generated client matches the running schema.
- [ ] **URG-001 — Organization 500:** authenticated
      `GET /api/v1/organization` and Organization Settings in English/Arabic
      at mobile/desktop widths; correlate any failure with request ID and logs.
- [ ] **URG-002 — Customer Cases 500:** authenticated exact list query, a
      populated list, empty state, error state and branch/role refusal after
      deployment. A pre-auth 401 does not establish endpoint health.
- [ ] **URG-003 — POS checkout 500:** authenticated real checkout, receipt and
      stock movement; verify invalid JSON/oversized-body envelopes and
      actionable 4xx stock/tender refusals.
- [ ] Production acceptance for locally completed URG-005–010 and URG-012:
      concurrent last-unit sale, sold-out scan, single/split cash tender with
      currency rounding, focus on failed/successful payment, return and
      goodwill refund reasons including older notes, single/bulk cancellation
      reason in audit, and compact layout at keyboard/touch/Arabic/phone sizes.
- [ ] Verify the new organization/product controls, category creation and
      order sections in the deployed app after their batches merge. Include
      keyboard, phone and Arabic category create/duplicate flows. Do not infer
      production success from local tests or screenshots.
- [ ] Add the owner-deferred dedicated refund tests when test work resumes:
      missing/invalid/Other reasons, cross-branch refusal, payment/audit
      atomicity, older refund display and keyboard/RTL Select behavior.
      (The `orders.test.ts` rate-limit 429 was investigated and resolved
      2026-09-12 — it was never flaky. Recorded in TODO.md.)

### Release gates — NOT parked, and not optional before a client sees this

These two are quality gates rather than features: they are what catches a
regression before a real shop does. Not being worked on, deliberately, but
they must not be lost. Full detail lives in `TODO.md`.

- [ ] **Point 4 — the final combined gate.** Project-wide unit, type, lint,
      production-build and E2E checks, plus the motion, accessibility,
      responsive and native-Arabic review. Focused or merged CI does NOT close
      it — that is the whole point of the item.
- [ ] **Native-Arabic review.** Parity holds mechanically, but every Arabic
      string is machine/self-translated MSA that no native speaker has read.
      **This blocks any client demo and is not self-certifiable** — I cannot
      sign it off, and neither can a test.

## Returns — decision notifications (owner-approved 2026-09-12)

- Return decision notifications are COMPLETE and moved to TODO.md
  (2026-09-13). `approveReturn`/`rejectReturn` each emit one notification
  carrying the outcome, behind one setting.
- The fuller `ReturnStatus` lifecycle and the customer-facing resolution email
  both moved to the **Parked by the owner** section below (2026-09-12). Kept
  here only as a pointer, so neither reads as open work.

<!-- Original wording, retained for the reasoning:
      **Still not built, and deliberately so:** the fuller `ReturnStatus`
      lifecycle (label sent → in transit → received → inspected → resolved) is
      unchanged at REQUESTED/APPROVED/REJECTED. It was skipped on 2026-09-09 as
      a mail-order shipping flow that does not fit a physical till; reviving it
      needs a migration, new states and new UI. The customer still receives
      nothing on resolution — the UX-018 customer-email path exists to reuse,
      but that was not part of this approval.
-->

## Remaining owner and UX work

- URG-011 (two scroll regions, accepted as-is) and URG-015 (fading/clipped
  dropdown, never reproduced) were CLOSED by the owner on 2026-09-12 and moved
  to TODO.md on 2026-09-13. Neither is open work; the reasoning for not
  revisiting them is recorded there.
- URG-024 (registration/identity IDs) moved to the **Parked by the owner**
  section below — it was parked on 2026-09-12 rather than left open.
- [ ] **URG-028 — remaining follow-up (small, not urgent).** The barcode
      implementation is complete and recorded in TODO.md. One thing remains:
      **show unclassified legacy codes for review somewhere.** Nothing is lost
      without it — the server still refuses a bad code, and an unclassified one
      is accepted exactly as it was before URG-028 — but an owner has no prompt
      to classify old codes.
      **Do not resume the abandoned approach.** A `barcodeUnclassified` notice
      was attempted and WITHDRAWN 2026-09-12: the wiring looked correct
      (generic `notice?: string` prop on `FormField`, decided in `renderField`,
      key present in both locales, typecheck clean) and it still would not
      render, and five diagnostic attempts failed to explain why. Diagnose the
      render condition from scratch instead.
      Still in place and deliberately kept for a later pre-submit-feedback
      pass: the generic `notice?: string` prop and its render slot on
      `FormField`, the six `barcodeHint*` locale keys, and the client mirror
      `frontend/src/lib/barcode.ts`. None is wired, so nothing half-works.
- [ ] **URG-034 — remaining: a browser pass at the till, including Arabic/RTL.**
      The multi-currency implementation is complete and recorded in TODO.md.
      The browser attempt on 2026-09-12 was **inconclusive — a probe gap, not
      a failure.**
      What WAS verified live: `GET /pos/tenders` returned both currencies
      against a real signed-in session (`AED` base rate 1, `USD` rate 0.2723),
      so the contract and settings path work end to end.
      What was NOT reached: the selector itself. `/admin/pos` opens on a
      "Start your shift?" gate, so `SaleScreen` never mounted and the currency
      control was legitimately absent in both locales. The unit tests render
      `SaleScreen` directly with a mocked `fetchTenders`, which is exactly what
      hid this from them.
      **For the next attempt:** dismiss the shift gate FIRST (click "Not right
      now — just let me sell", or start a shift) before looking for the
      control. Then check: selector hidden on a single-currency install and
      visible with two, the rate hint appearing only after choosing a foreign
      currency, the cash field relabelled in that currency, the dual-currency
      receipt rows, and the per-currency block on the X/Z report.
      Enabling it locally needs `store.currency` plus one `pos.tenderRate.*`
      above zero. Both were set for the last attempt and **removed again**, so
      no dev data carries an enabled currency feature nobody asked for.
- [ ] **URG-035 — full form/control inventory. APPROVED 2026-09-12: AUDIT
      FIRST, findings list only — do not fix while enumerating.** Enumerate
      every create, edit, filter, checkout, settings and confirmation field.
      For each, review meaning, required/editable state, control, allowed
      values, default, placeholder/help, validation/normalization, errors,
      saved API shape, mobile keyboard, accessibility, English/Arabic and
      RTL/LTR. Track every field, not a sample. Produce a severity-grouped
      findings report and let the owner choose what to fix, rather than making
      hundreds of unreviewed judgement calls in flight. This also decides any
      remaining field-specific placeholder work from URG-013. Start it only
      after URG-028 and URG-034 land — beginning a days-long enumeration with
      two approved implementations queued would leave all three half-finished.

## Parked by the owner — 2026-09-12. Do not raise these again unless asked.

Each was a real open item; none is forgotten, and the reasoning is kept here so
a future session does not rediscover it as "missing". **Do not start any of
these without the owner asking first.**

- **URG-024 — registration/identity IDs.** Genuinely unscoped: the records
  meant by "IDs" were never identified and the owner does not recall the
  request. Candidates were business trade-licence/commercial-registration
  numbers, staff identity documents (Emirates ID/passport) and customer
  identity numbers — the latter two carry real privacy weight needing a
  read-access decision, not just validation. Business tax/TRN validation is
  already done separately as URG-023. **Ask what "IDs" means before starting.**
- **Fuller `ReturnStatus` lifecycle** (label sent → in transit → received →
  inspected → resolved). Skipped on 2026-09-09 as a mail-order shipping flow
  that does not fit a physical till, and parked again now. Reviving it means a
  migration, new states, new transitions and new UI. The shipped
  REQUESTED/APPROVED/REJECTED lifecycle is unchanged and works.
- **Customer-facing email on return resolution.** The customer currently
  learns nothing when a return is decided. The UX-018 customer order-status
  email path exists to reuse, so this is wiring rather than new
  infrastructure — but it was never part of an approval, and it needs SMTP
  configured to be worth anything in production.
- **Role simplification to Admin / Developer / Cashier.** Blocked on the
  owner approving how every legacy Owner/Manager/Fulfillment/Support/Demo
  account and branch assignment maps. Nothing may run a destructive enum or
  data migration before that mapping is agreed. Prepared role templates stay
  out of scope; future templates must be configurable data, not more
  hard-coded roles.
- **Pull-request E2E rewrite for Coolify.** `.github/workflows/e2e.yml` is
  still written around Vercel preview URLs and `RENDER_DEV_BACKEND_URL`, both
  of which are gone. It is disabled, so it breaks nothing, but the
  `pull_request` trigger cannot come back until it is rewritten.
- **Production monitoring replacement.** Sentry is on hold, not merely
  unconfigured — the owner's trial ended. Needs a replacement or a plan.
- **PR #227's missing CI.** Zero GitHub Actions runs across four pushes and a
  close/reopen, while Actions is `enabled`, the CI workflow is `active`, the
  PR is OPEN and its head SHA matches local. Every configuration input is
  correct and GitHub simply never scheduled a run; #228 ran 11 jobs normally
  minutes earlier, so it is not the repository. A rebase was declined as too
  risky (the branch is 38 commits ahead / 9 behind and carries its own copies
  of work `dev` already merged under different SHAs — the pattern that made an
  earlier rebase start reverting merged work). The owner is ignoring it during
  the testing phase. **#228 is green and `CLEAN` and can be merged.**

## Guardrails

- The Coolify MySQL is production. Verify `APP_MODE` and the resolved host
  before any database command; migrations in this queue were applied only to
  guarded local dev/test databases.
- Never backfill historical refund reasons, variant intent, tax IDs or other
  unknown facts with guesses. Preserve existing stock, payment and audit data.
- Maintain the stack order and one reviewable batch per logical concern.
  Keep TODO.md as the completed-local ledger and this file as the open queue.
