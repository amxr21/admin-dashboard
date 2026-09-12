# Urgent TODO — open owner review queue

Updated 2026-09-12. This file contains **pending work only**. Completed local
implementations and their evidence are in [TODO.md](TODO.md#completed-urgent-implementations--local-record-2026-09-12).
“Implemented locally” does not mean merged, deployed, or verified in production.
The original investigation and acceptance detail remain in this file's git history.

## Current state and release order

- The working branch is `fix/urgent-goodwill-refund-reasons` at `b162ba9`
  with additional uncommitted fixes. The owner reports most recent branches
  merged, except #224/#225 while their tests continue. Confirm exact ancestry
  and current PR state when GitHub access is restored.
- URG-026/031 group-enable work is **uncommitted** in `resource-form.tsx`, both
  message files and this handoff. Preserve the untracked frontend diagnostic
  files; none is part of a release.
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

- [*] **URG-026 / URG-031 — optional product group enablement (active).**
      Group switches, shared active-field predicate, stale-value omission and
      conditional validation are coded but uncommitted. Earlier browser checks
      covered new/existing products, disabled payload omission, re-enable and
      Arabic phone layout; focused form tests, typecheck and lint pass. Repeat
      the browser pass after the newest label/variant changes, then commit and
      run the exact-commit gate. The schema has dimensions and shipping fields;
      it has no first-class size, material or custom-attribute fields to gate.
      Do not invent those fields as part of this toggle fix.
- [*] **URG-029 — variant opt-in acceptance.** Nullable
      `Product.hasVariants` and builder gating exist locally. A legacy NULL
      now remains distinct from explicit false, so its builder stays reachable;
      explicit false hides it, and re-enabling shows it. Focused form tests
      cover these states. Verify persisted toggles and re-enable on products
      with existing variant stock/history in the browser, plus create/edit
      keyboard and both locales. The toggle must not delete variant rows.
      **Gap found and closed 2026-09-12:** the builder was gated purely on
      `hasVariants !== false`, never on whether variant rows exist, so opting
      out a product that already HAS variants left those rows — with their
      stock and sales history — reachable only through the database. Data was
      preserved as the rule requires; access to it was not. Owner decision:
      warn but allow. The form now warns at the moment of the change that
      saved variants survive while the route to them is being hidden. It
      deliberately states that guarantee rather than a count, since a count
      needs a `fetchVariants` round-trip per form open and would render
      "0 variants" whenever that request failed. Three tests pin when it
      fires: on `true → false`, on a legacy `NULL → true → false`, and never
      on a product already opted out. Both source comments
      (`schema.prisma`, `admin.config.ts`) previously claimed the toggle hides
      "the builder and NOTHING else" and now record the warning.
- [ ] **URG-030 — finish optional colours.** `hasColors` is stored and
      exposed, but no colour dimension or choices consume it. Define controlled
      choices and custom values, their relation to variants, legacy behavior
      and safe disable/re-enable handling; then implement and verify.

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
      Investigate the pre-existing `orders.test.ts` rate-limit 429 flake as
      test infrastructure, without weakening production rate limiting.

## Remaining owner and UX work

- [ ] **URG-011 — two scroll regions: owner decision.** At roughly 640–750px
      viewport height, the 21-link sidebar nav and main content both scroll.
      The document itself does not scroll, navigation is reachable, and the
      sidebar needs about 840px to fit without its scoped scrollbar. Confirm
      whether this behavior is acceptable. A strict one-scroller layout at
      700px requires changing navigation density or information architecture,
      not another small scrollbar CSS adjustment.
- [ ] **URG-015 — fading/clipped dropdown:** deferred until one exact page,
      dropdown/table control, action and viewport reproduces the reported
      behavior. Seeded row actions and nested selects did not reproduce it;
      avoid a speculative shared portal/overflow change.
- [ ] **URG-024 — registration/identity IDs:** identify the specific records
      meant by “IDs,” then choose identifier types, country-aware validation
      and non-destructive treatment of existing values. Do not apply a single
      UAE-only mask to unrelated identifiers.
- [ ] **URG-028 — product code types:** SKU remains available; make barcode
      opt-in per product, curate the supported retail barcode types, and show
      legacy/unmappable codes for review without rewriting them.
- [ ] **URG-034 — multi-currency till:** finish currency selector, dual-currency
      receipt and per-currency shift count. Preserve store currency as default
      and the already documented fixed-rate, tender and rounding contract.
- [ ] **URG-035 — full form/control inventory:** enumerate every create,
      edit, filter, checkout, settings and confirmation field. For each,
      review meaning, required/editable state, control, allowed values,
      default, placeholder/help, validation/normalization, errors, saved
      API shape, mobile keyboard, accessibility, English/Arabic and RTL/LTR.
      Track every field, not a sample. This also decides any remaining
      field-specific placeholder work from URG-013.

## Guardrails

- The Coolify MySQL is production. Verify `APP_MODE` and the resolved host
  before any database command; migrations in this queue were applied only to
  guarded local dev/test databases.
- Never backfill historical refund reasons, variant intent, tax IDs or other
  unknown facts with guesses. Preserve existing stock, payment and audit data.
- Maintain the stack order and one reviewable batch per logical concern.
  Keep TODO.md as the completed-local ledger and this file as the open queue.
