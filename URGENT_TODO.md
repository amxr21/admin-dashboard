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

- [x] **URG-026 / URG-031 — optional product group enablement. Browser pass
      passed 2026-09-12, after the label/variant/colour changes.** One shared
      active-field predicate drives both the payload builder and the submit
      validator, so the two choke points cannot disagree. Verified in Chromium
      against the local dev stack, signed in as OWNER:
      - a create form opens with all 8 optional groups OFF, each showing the
        translated "not used for this record" placeholder and 0 inputs;
      - enabling one reveals exactly its fields (placeholder gone);
      - every group's checkbox sits OUTSIDE its disclosure button and is
        focusable in its own right — the keyboard trap a nested control would
        cause does not exist;
      - an EXISTING product seeds from its own data: Cost, Stock, Dimensions
        and Shipping opened enabled with their values, while genuinely empty
        groups (Tags, Variants, Search) stayed off;
      - switching Dimensions off empties it, switching it back on **restores
        the original weight unchanged**, and the captured PATCH **omitted
        `weightKg`/`lengthCm`/`widthCm`/`heightCm` entirely** rather than
        nulling them — the URG-026 contract, observed on the wire;
      - Arabic at 390 px: `dir="rtl"`, translated group headings and
        placeholder, and **no horizontal overflow**;
      - zero console errors and zero failed requests across the whole pass.
      The write was intercepted and faked, so nothing was persisted to the dev
      database. The schema has dimensions and shipping fields; it has no
      first-class size, material or custom-attribute fields to gate, and none
      were invented.
      **Two caveats, recorded rather than smoothed over:** the "existing
      product with a weight" the probe found is named `aaa` — leftover test
      junk in `localhost/admin_dashboard`, in the same family as the earlier
      category/POS garbage cleanups; worth a look, and it means the seeding
      evidence comes from a junk row rather than a realistic product. And the
      Arabic leg covered the CREATE path only, so Arabic seeding-from-data is
      still unobserved.
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
- [*] **URG-030 — optional colours: suggestion half implemented locally.**
      Owner decisions 2026-09-12: a colour **is** a variant (not a new column,
      not a size×colour matrix), values are a curated list with typing still
      allowed, and disabling follows URG-029's warn-but-allow contract.
      Built: `frontend/src/lib/product-colours.ts` (16 curated names, ordered
      neutrals-first), a native `<datalist>` on the variant-name input gated on
      `hasColors`, threaded through `ProductVariantsPanel` → `VariantForm`, and
      one en/ar hint string. Deliberately a `datalist` rather than a Select or
      Combobox: a picker would imply the list is exhaustive, and the server
      accepts any variant name. No `OTHER` member and no type guard — typing an
      unlisted colour IS the escape hatch, so a guard would imply a validation
      rule that does not exist (contrast `business-types.ts`, where `kind` is a
      single stored code the server checks for membership).
      Three tests pin the properties that matter: no `list`/datalist/hint when
      not opted in, all 16 options plus the hint when opted in, and an unlisted
      colour ("Burnt Orange") still saving with no `pattern` on the input.
      Verification: frontend typecheck 0, targeted lint 0, resource+i18n suites
      190/190 (was 187).
      **Partially browser-checked 2026-09-12:** the "This product has colours"
      checkbox renders inside the Variants & options group and is reachable
      once that group is enabled. The datalist itself was NOT exercised — the
      probe never opened a variants panel — so the suggestion list is covered
      by unit tests only, not yet by a real browser.
      **Still open:** `hasColors` remains otherwise inert — nothing reads it
      outside this suggestion, so there is no colour reporting, no POS colour
      filter and no per-colour stock view. The warn-on-disable contract is NOT
      wired for colours (URG-029's warning covers `hasVariants` only). Decide
      whether colour needs its own warning at all, given that disabling only
      withdraws suggestions and hides no data.

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
      ~~Investigate the pre-existing `orders.test.ts` rate-limit 429 flake~~ —
      **DONE 2026-09-12.** It was never flaky: `apiRateLimit` allows 120
      requests per 60s per IP across all of `/api/v1`, and `orders.test.ts`
      drives 105 tests from one loopback address, so everything after the
      120th request got a 429 and the goodwill-refund cases simply sit near
      the end of the file. Skipped under `NODE_ENV=test` for that general
      backstop ONLY; every per-route security limiter still counts, so the
      tests asserting their 429s keep passing. Production limits untouched.

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

- [x] **Notify staff when a return is approved or rejected.** `notify()` fired
      only on `return.requested`, so the arrival of work was announced and its
      completion never was — whoever was waiting on the answer learned nothing.
      `approveReturn` and `rejectReturn` now each emit one notification after
      their transaction and after `audit()`, mirroring `createReturn`: the
      decision is already durable, and `notify()` never throws by contract, so
      a failed alert cannot undo a refund or a restock.
      The body carries the OUTCOME, not just the status — the approval names
      its resolution (REFUND / STORE_CREDIT / REPLACEMENT, plus `restocked`)
      because "approved" alone does not say whether money moved, and the
      rejection carries its reason because "rejected" with no why generates the
      question it was meant to answer.
      **One new setting, not two:** `notifications.returnDecisionAlerts`
      (boolean, default true). Approval and rejection are the same event class,
      and "tell me about approvals but not rejections" is a state that reads as
      a bug the first time a rejection goes unannounced. Kept separate from
      `returnRequestAlerts` because that one is aimed at whoever picks work up
      and this one at whoever was waiting on the answer.
      Verification: returns suite 52/52 (3 new), backend typecheck and targeted
      lint clean. Each new test is scoped to its own RMA — an unscoped
      `findFirst` on the type matched another test's row, which is how the
      first run reported the wrong RMA.
- [ ] **Still not built, and deliberately so:** the fuller `ReturnStatus`
      lifecycle (label sent → in transit → received → inspected → resolved) is
      unchanged at REQUESTED/APPROVED/REJECTED. It was skipped on 2026-09-09 as
      a mail-order shipping flow that does not fit a physical till; reviving it
      needs a migration, new states and new UI. The customer still receives
      nothing on resolution — the UX-018 customer-email path exists to reuse,
      but that was not part of this approval.

## Remaining owner and UX work

- [x] **URG-011 — two scroll regions: ACCEPTED AS-IS by the owner 2026-09-12.**
      At roughly 640–750px viewport height the 21-link sidebar nav and main
      content each scroll. The document itself does not scroll, navigation
      stays reachable, and the sidebar needs about 840px to fit without its
      scoped scrollbar. The owner confirmed this is acceptable behaviour for an
      admin shell with a long nav, so the item is CLOSED rather than left open
      indefinitely. Do not "fix" it later with another scrollbar CSS tweak: a
      strict one-scroller layout at 700px requires changing navigation density
      or information architecture, which was considered and declined.
- [x] **URG-015 — fading/clipped dropdown: SKIPPED by the owner 2026-09-12.**
      Never reproduced — seeded row actions and nested selects did not exhibit
      it, and no exact page/control/action/viewport was available. Closed
      without a speculative shared portal/overflow change, which would have
      risked every dropdown in the app to chase one unconfirmed report.
      Reopen only with a real reproduction.
- URG-024 (registration/identity IDs) moved to the **Parked by the owner**
  section below — it was parked on 2026-09-12 rather than left open.
- [*] **URG-028 — product code types. APPROVED 2026-09-12: opt-in per product,
      curated types. BACKEND HALF DONE AND VERIFIED; one client-side design
      question open.**
      Built: `backend/src/lib/barcode.ts` — six curated retail symbologies
      (EAN-13, EAN-8, UPC-A, UPC-E, ITF-14, CODE128) following the exact
      `tax-id.ts` convention (`test`/`normalize`/`hint`/`example`, server
      authoritative, unknown values accepted rather than refused). One GS1
      mod-10 routine walks backwards from the rightmost data digit so the same
      code is correct for all four fixed lengths instead of four copies that
      can drift. `Product.hasBarcode`/`barcodeType` added as additive nullable
      columns (migration `20260912190000`, applied to the guarded local target
      and verified: `barcode varchar(64)`, `barcode_type varchar(16)`,
      `has_barcode tinyint`, all nullable, 30 products, **0 classified and 0
      opted in — no backfill**). Validation runs in the products `beforeWrite`
      hook on CREATE **and** UPDATE, but only when the write actually touches
      `barcode` or `barcodeType` (the customers hook's `hasOwnProperty`
      discipline) — otherwise editing a product's PRICE could fail on its old
      barcode, a refusal about a field nobody opened. A PATCH setting only the
      type is checked against the STORED code, because declaring "this is an
      EAN-13" is exactly when to discover the saved digits are not one. The
      canonical form is written back on write so the till's EXACT-match scan
      cannot miss on a stored space or dash.
      **Type is stored, not derived:** `5012345678900` is a valid EAN-13 and
      also a legal prefix for other lengths, and CODE128 accepts almost
      anything — the symbology cannot be recovered from the digits later.
      **Deliberate gaps, stated so nobody reads them as oversights:** UPC-E's
      check digit is NOT validated (it derives from the expanded 12-digit
      form, six suppression rules of real work for a case never asked for);
      CODE128 has no check digit to test, so only length is bounded. Both are
      commented in the module and pinned by tests.
      Verification: 19/19 unit tests using REAL published codes (hand-made
      digits would not catch a reversed weighting, which is how this fails
      silently), backend typecheck and lint clean, en/ar parity 19/19 with 7
      new hint keys per locale.
      **The client-side design question, DECIDED 2026-09-12: server-only
      validation plus a legacy notice.** A barcode's placeholder and
      client-side validation depend on the SIBLING `barcodeType` field, but
      the generic engine's `validateField(field, value)` and
      `placeholderFor(field, tCommon)` see only one field's own value by
      design, and `FormField` receives no sibling map. Threading siblings in
      would widen a signature every resource shares to serve one product
      field; the file's own comment notes there is currently exactly ONE
      `schema.resource === 'products'` conditional and treats that as a cost
      worth not repeating. So the generic engine is left alone: the server
      already refuses a bad code with a shape-stating message that surfaces on
      the field through the existing 400 handling, which means validation is
      enforced end to end without it.
      **The `barcodeUnclassified` notice was attempted and WITHDRAWN
      2026-09-12 — owner decision, and the reason is worth recording.** The
      idea was one advisory string on a stored code carrying no type. The
      wiring looked correct (generic `notice?: string` prop on `FormField`,
      decided in `renderField`, key present under `resourceForm` in both
      locales, typecheck clean) and it still would not render; five diagnostic
      attempts failed to explain why, including a throwaway probe. Rather than
      keep spending on a cosmetic string, the wiring and its four tests were
      removed and the enforced backend work shipped on its own.
      What REMAINS in place and is deliberately kept: the generic
      `notice?: string` prop and its render slot on `FormField` (unused, but a
      clean advisory hook any resource can adopt), and the six `barcodeHint*`
      locale keys plus the client mirror `frontend/src/lib/barcode.ts` (also
      unused under the server-only decision). None of it is wired, so nothing
      half-works; a later pre-submit-feedback pass has the pieces waiting.
      **Open follow-up (small, not urgent):** show unclassified legacy codes
      for review somewhere. Nothing is lost without it — the server still
      refuses a bad code, and an unclassified one is accepted exactly as it
      was before URG-028 — but an owner has no prompt to classify old codes.
      Diagnose the render condition from scratch rather than resuming the
      abandoned approach.
      SKU remains an always-available plain field. Existing unrecognised or
      unmappable codes are SHOWN for review and never rewritten — inventing a
      corrected check digit would fabricate a code that does not exist on the
      physical product.
- [*] **URG-034 — multi-currency till. APPROVED 2026-09-12: all three pieces.
      Implemented locally the same day; sale-screen coverage and the browser
      pass remain.**
      **The queue's "backend foundation done, presentation only" framing was
      wrong, and this is the finding worth keeping:** `getShiftTakings` did
      compute `byTenderCurrency`, but `getTillReport` never forwarded it and
      neither frontend type declared it — so the breakdown existed in the
      service and was dropped at two seams before reaching any screen. A
      drawer holding two currencies printed a Z report accounting for only
      one. Shape parity between a schema and a service proves nothing about
      what survives to the client; the same class of gap as F5.1 and URG-006.
      Built: `byTenderCurrency` forwarded from `getTillReport` and declared on
      `ShiftTakings`/`TillReport`; `tenderCurrency`/`tenderTotal`/
      `tenderChange`/`tenderRate` added to the checkout response, computed
      SERVER-side from the same values written to the `Payment` row (the owner
      chose this over client-side multiplication precisely because two copies
      of money arithmetic is how a receipt ends up disagreeing with the
      drawer); `fetchTenders()` + `AcceptedTender` in `pos-api.ts`; a currency
      Select on the sale screen that hides itself when only one tender is
      accepted, shows the rate the server will apply, relabels the cash field
      in the chosen currency, and resets to base after every sale; dual-
      currency receipt rows plus the snapshotted rate; and a per-currency
      drawer block on the X/Z report, deliberately OUTSIDE the opening-float
      group so a till opened without a float still shows foreign notes.
      Split payments carry no currency by design — the server's contract is
      one shape or the other, and mixing currencies across legs is a decision
      nobody has made.
      Verification: POS suites 56/56 (was 54 with 2 failing), both typechecks
      clean, both lints clean, en/ar parity 19/19 with 8 new keys per locale.
      **Two fixture lies found and fixed rather than worked around:** the X/Z
      report tests omitted `byTenderCurrency`, which crashed the render on
      `.length` — and `tsc` could not catch it because a `mockResolvedValue`
      is untyped `any`. The fixtures were corrected to match what the server
      actually sends; the component was NOT made defensive with `?.`, since
      tolerating a malformed response is how a real backend regression hides.
      Two new tests pin the per-currency block appearing with rows and being
      absent without them.
      **A real product bug found by writing the test, and worth remembering:**
      `cashShortfall` compared `tendered` against the base-currency
      `estimate`, but the cashier now types that figure in the SELECTED
      currency — so $1.23 handed over for a 4.50 AED sale read as 3.27 short,
      the warning fired, and the confirm dialog could never open. The
      foreign-currency path was unusable end to end, and every unit test
      passed because none of them had ever selected a currency. The server's
      own guard was already correct (`tenderDue = total × rate`); the client
      was the half that was wrong. **Generalise:** when a field's UNITS become
      configurable, every comparison against it is suspect — the value moved
      currencies while the thing it is checked against did not.
      The guard now converts using the rate the server supplied, and the
      comment states why that is still not a second implementation of money
      arithmetic: it produces a warning only, and nothing recorded, printed or
      reconciled is derived on the client.
      Sale-screen coverage added (4 tests): the control is invisible on a
      single-currency install, the rate appears only once a foreign currency
      is chosen, an ordinary sale sends NO `tenderCurrency` (absent, not
      `'AED'`, so it stays on the unchanged server path), and a foreign sale
      carries both the currency and the tendered amount into checkout.
      Final verification: POS suites 60/60 (they were 54 with 2 failing when
      this work began), both typechecks clean, both lints clean, en/ar parity
      19/19. Nothing is enabled on any existing install until an owner sets a
      rate above zero.
      **Remaining: a browser pass at the till, including Arabic/RTL.**
      Attempted 2026-09-12 and **inconclusive — not a failure, a probe gap.**
      What WAS verified live: `GET /pos/tenders` returned both currencies
      correctly against a real signed-in session (`AED` base rate 1, `USD`
      rate 0.2723), so the contract and the settings path work end to end.
      What was NOT reached: the selector itself. `/admin/pos` opens on a
      "Start your shift?" gate — buttons "Start shift & open till" and "Not
      right now — just let me sell", an optional opening-float field, and no
      scan field — so `SaleScreen` never mounted and the currency control was
      legitimately absent, in both locales. The unit tests render `SaleScreen`
      directly with a mocked `fetchTenders`, which is exactly what hid this
      from them.
      **For the next attempt:** dismiss the shift gate first (click "Not right
      now — just let me sell", or start a shift) BEFORE looking for the
      control. Then check: selector hidden on a single-currency install,
      visible with two, the rate hint appearing only after choosing a foreign
      currency, the cash field relabelled in that currency, the dual-currency
      receipt rows, and the per-currency block on the X/Z report.
      Note: enabling the feature locally needs `store.currency` plus one
      `pos.tenderRate.*` above zero. Both were set for this attempt and then
      **removed again**, so no dev data was left carrying an enabled currency
      feature nobody asked for.

      <!-- Original scope note, kept for reference: -->
      The backend foundation was already shipped and tested (nullable
      `tender_currency`/`tender_amount`/`tender_rate` on `payments`, the rate
      SNAPSHOTTED per sale, per-currency `getShiftTakings` breakdown, a rate of
      0 meaning "not accepted"). Remaining is presentation only: the currency
      selector on the sale screen reading `GET /pos/tenders`, the receipt
      showing both currencies plus the rate used, and the per-currency count at
      shift close. Preserve store currency as the default and the documented
      fixed-rate/tender/rounding contract. Without the shift-close half the
      drawer cannot balance in the second currency, which is why partial
      delivery was declined.
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
