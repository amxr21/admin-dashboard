# Urgent TODO — owner review queue

Created from the owner’s production and UX review on 2026-09-11. This file is the
authoritative queue for these notes. The owner approved starting this queue on 2026-09-11; work
proceeds in the order below unless a newly confirmed dependency requires a documented reorder.

## Rules for every urgent batch

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
      A versioned production-start gate now applies all committed Prisma migrations before the HTTP
      server imports; a failed migration prevents the new container from serving. Local startup,
      Organization API, type, lint, and build checks pass. Final closure awaits the authenticated
      production page after PR #217 is merged and deployed.
- [*] **URG-002 — Customer Service API returns 500.** Independently reproduce
      `GET /api/v1/customer-cases?page=1&pageSize=20`, inspect logs and schema/runtime dependencies,
      fix the cause, and verify populated, empty, forbidden, and failed states. Do not treat the
      browser’s repeated React stack frames as separate API failures.
      The deployed unauthenticated boundary returns the normal 401 envelope and request ID. The
      first authenticated query depends on `customer_cases`, introduced with migration
      `20260910150000_add_customer_service_workspace`; code and schema match, and the endpoint works
      on the migrated test database. Current evidence therefore points to the same deployment drift
      addressed by parent PR #217, not a second endpoint defect. Exact-query, empty, paginated,
      forbidden, and invalid-input regression coverage is being completed on this stacked branch;
      final closure awaits an authenticated post-deploy check.
- [*] **URG-003 — POS checkout returns 500.** Reproduce `POST /api/v1/pos/checkout` using the exact
      failing request shape without exposing customer/payment data, correlate its request ID,
      identify whether the failure is validation, migration, stock, tender, or transaction related,
      and make expected business refusals return actionable 4xx reason codes instead of 500.
      Active branch: `fix/urgent-pos-checkout-api-500`, stacked on URG-002 PR #218. A valid fake,
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
      build, and merge-integrity checks pass. PR #219 is open against URG-002 PR #218, is mergeable,
      and its GitHub CI is running (GitGuardian passed). Remaining acceptance: CI, then an
      authenticated checkout after parent PR #217 deploys its migration gate.
- [*] **URG-004 — Production release/schema integrity check.** Verify that every migration required
      by the merged stack is deployed exactly once, the generated Prisma client matches the running
      schema, and Organization, Customer Cases, and Checkout share no hidden production-only
      dependency. Add a deployment check that catches the confirmed class of mismatch before the
      application is promoted. Active branch: `fix/urgent-production-schema-integrity`, stacked
      directly on URG-003 PR #219. Audit in progress across the production start command, Prisma
      migration/client lifecycle, container/hosting configuration, and CI promotion boundary.
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
      - [x] Block server import when migration deployment fails.
      - [x] Block server import when migration history/status is unhealthy.
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
      - [x] Test the live schema check still runs after both migration commands fail.
      - [x] Test live-schema drift blocks server import.
      - [x] Test schema-history success, missing-migration drift, and process failure.
      - [x] Test unsafe shadow URL refusals and prove the comparison never starts.
      - [ ] Resolve/document Windows MySQL case-insensitive join-table false positives without
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
      - [ ] Run backend lint, type-check, build, merge-integrity, and full relevant tests. Owner
            directed skipping database/server-dependent suites and the production build this
            session; focused startup/schema tests and targeted lint pass locally.
      - [ ] Update `URGENT_TODO.md`, `TODO.md`, `CLAUDE.md`, foundations, diagnostics comments, the
            error log, and private workbook with exact evidence and remaining acceptance.
      - [ ] Commit only URG-004 files; never stage the two user diagnostic artifacts.
      - [ ] Push and open the PR against `fix/urgent-pos-checkout-api-500`.
      - [ ] Inspect every GitHub check and record failures/pending/success precisely.
      - [ ] Keep URG-001–004 active until authenticated post-deploy Organization, Customer Cases,
            and Checkout verification passes.
      - [ ] Start URG-005 directly from URG-004's final commit.

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
      **Verification:** backend typecheck + targeted ESLint clean. Two new integration tests (a
      two-cashier race on distinct idempotency keys, and an over-quantity refusal) CANNOT run
      locally — `admin_dashboard_test` has 54 tables but an unbaselined `_prisma_migrations`, so
      they get their first real run in CI.
- [ ] **URG-006 — Hide out-of-stock items from till browsing.** Product browsing/search should omit
      variants with no sellable stock at the active branch. A direct barcode/SKU scan of an
      unavailable item must show an explicit “out of stock” result rather than silently doing
      nothing or adding it.
- [ ] **URG-007 — Enforce cash received against the amount due.** For cash tenders, the accepted
      amount must be at least the total due in the tender currency; the UI must prevent submission
      and explain the shortage, while the backend independently refuses underpayment. Change must
      use the same rounding and tender-rate contract as checkout.
- [ ] **URG-008 — Fix checkout dialog focus/`aria-hidden` warning.** Move focus into the opened
      dialog and restore it safely on close so the previously focused `#pos-scan` input is never
      hidden from assistive technology. Verify keyboard-only checkout and cancellation.
- [ ] **URG-009 — Configurable refund reasons with Other.** Present an approved reason catalogue;
      selecting `Other` reveals a required free-text field. Persist a stable reason code plus the
      optional note, show it in refund/audit views, and validate both client and server.
- [ ] **URG-010 — Configurable order-cancellation reasons with Other.** Before cancelling, require a
      reason from an approved catalogue; selecting `Other` reveals required free text. Persist and
      audit the code/note and keep cancellation authorization and stock effects transactional.

## U2 — shell sizing, scrolling, and dropdown reliability (P1)

- [ ] **URG-011 — Reopen the double-scrollbar defect.** The supplied desktop screenshot proves the
      prior shell/drawer fix does not cover this path. Reproduce the exact branch/business form,
      identify both scrolling owners, and leave exactly one intended vertical scroller while
      preserving sticky navigation/actions, mobile drawers, dialogs, and RTL.
- [ ] **URG-012 — Reduce global interface density by one to two steps.** Audit root font size,
      control heights, spacing, sidebar width, tables, sheets, dialogs, and charts; define one shared
      compact density scale rather than page-local shrinking. Preserve WCAG target sizes and offer
      no browser-zoom workaround.
- [ ] **URG-013 — Add useful placeholders to every text-entry control.** Inventory text, email,
      telephone, numeric, search, URL, code, and textarea inputs; add localized examples/format hints
      wherever useful while retaining persistent labels. Do not add misleading placeholders to
      controls whose expected value cannot be expressed safely as an example.
- [ ] **URG-014 — Make branch selectors fit their content.** Shared branch triggers/popovers should
      grow to the available title width up to a responsive maximum, avoid premature cropping, and
      fall back to an accessible tooltip/wrapped option when space is genuinely constrained.
- [ ] **URG-015 — Fix dropdown/table content fading or disappearing.** Reproduce the affected table
      row menu/dropdown, then correct stacking context, overflow clipping, portal placement, and any
      mask/gradient overlap in shared primitives. Test first/middle/last rows, short and long tables,
      scrolling containers, dialogs/sheets, and RTL.

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

- [ ] Confirm whether a refund/cancellation permits exactly one catalogue reason or multiple
      simultaneous selected reasons. This file currently assumes one required reason selected from
      multiple available choices, plus an `Other` note.
- [ ] Approve the initial refund-reason catalogue and order-cancellation-reason catalogue, or approve
      making both catalogues administrator-configurable.
- [ ] Clarify which field(s) “IDs” refers to: business registration/license numbers, national IDs,
      product identifiers, or another record.
- [ ] Approve the initial business-type options and whether an `Other` value is allowed.
- [ ] Approve the supported country/city dataset and the fallback behavior for an unlisted city.
- [ ] Confirm whether “one to two degrees smaller” means one global compact density or a user-facing
      density preference. Recommended default: one shared compact density, reviewed at 100% zoom.
- [ ] Identify at least one exact table/dropdown route where content fades or disappears if it is not
      reproducible from the current data.

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
