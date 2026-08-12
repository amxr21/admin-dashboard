# Arabic Translation Review — Full Portal

**Date**: 2026-08-12 · **Scope**: all 1,500 interface keys across 49 namespaces (en.json ↔ ar.json)
**Reviewer pass**: full read of every en/ar pair, plus structural validation.

## Baseline (automated, all green)

| Check | Result |
|---|---|
| Key parity | 1500 EN / 1500 AR — 0 missing, 0 extra |
| ICU brace balance | 0 malformed strings in either file |
| ICU argument sets match | no real mismatches |
| Arabic plural categories | every plural declares all 6 forms (zero/one/two/few/many/other) |
| Untranslated (en == ar) | 15, all correct-by-design (see below) |

The 15 identical strings are all intentional: `admin-dashboard` (product name), `English`,
`you@company.com`, `XXXX-XXXX-XXXX`, `UTC`, `CSV`, `PDF`, `Sentry`, `https://…`, and the four
danger-zone confirmation phrases (`DEACTIVATE`, `TRANSFER`, `DELETE`) — those **must** stay Latin
because the user types them literally to confirm, and the code compares against the same constant.

**Overall verdict**: this is high-quality, human-grade MSA — not raw machine output. Register is
consistent (professional, second-person imperative), terminology is stable across namespaces, and
the plural handling is genuinely correct Arabic (real dual forms, not English one/other copied
over). The findings below are refinements, not a rewrite.

---

## Findings

### P0 — Settings and resource pages render hardcoded English on `/ar/` (BLOCKER)

**Found by the user from a live browser screenshot, not by this review.** Worth stating why the
review missed it: the whole audit compared `en.json` against `ar.json`, and **these strings live in
neither file**, so a key-parity check could never surface them. Any future i18n audit has to include
server-supplied display text, not just the message catalogue.

On `/ar/admin/settings`, every individual field's label and hint renders in English — "Store name",
"Support email", "Currency", "Tagline", "Logo", "Address", "Tax / VAT rate", "Shown on invoices and
in the browser tab", "Formatting only — it does not convert existing prices". Only the section
headers (العلامة التجارية) and their descriptions are Arabic, because those come from
`settings.groups.*` in `ar.json`. The result is a page that is roughly 70% untranslated by
character count while looking "mostly done" at a glance.

**Mechanism**: the settings registry stores display text as literals —
[settings.config.ts:58](backend/src/config/settings.config.ts#L58) —
and `settings-form.tsx` renders `setting.label` / `setting.description` straight from the API
response ([settings-form.tsx:534](frontend/src/components/settings/settings-form.tsx#L534),
[:737](frontend/src/components/settings/settings-form.tsx#L737)). There is no translation layer
between the two.

**Same bug, wider blast radius — the resource engine.** `admin.config.ts` declares 68 labels the
same way (`label: 'Products'`, `label: 'Price'`, `label: 'Category'`…), and
`resource-table.tsx`/`resource-form.tsx`/`resource-view.tsx` render `field.label` and `schema.label`
verbatim ([resource-table.tsx:546](frontend/src/components/resource/resource-table.tsx#L546),
[resource-form.tsx:740](frontend/src/components/resource/resource-form.tsx#L740)). So every generic
CRUD page — products, categories, customers, discounts, reviews, notifications — shows English
column headers and form labels in Arabic too. This is the architectural cost of the schema-driven
design: config *is* the UI, and the config was written English-only.

**Scale**: 37 setting labels + 36 setting descriptions + 68 resource labels = **141 strings**, none
of which any `ar.json` edit can reach.

**This blocks the ROADMAP §G-GATE Arabic item** far more than any wording nit below. Fixing it is a
design decision, not a translation task, so I have not implemented it — the three viable options:

1. **Key-ify the configs** — replace each literal with a message key (`'settings.fields.store.name.label'`),
   add all 141 to both catalogues, resolve client-side. Most consistent with how the rest of the app
   works; touches both configs and three render sites.
2. **Ship `labelAr`/`descriptionAr` alongside** in the config, pick by locale at render. Smallest
   diff, but forks translation storage into a second place and doesn't scale past two locales.
3. **Frontend override map** — a `settings.fields.*` / `resource.fields.*` block in the catalogues
   that falls back to the server label when a key is absent. No backend change, degrades gracefully,
   but leaves the English literals as the silent default.

Option 1 is the right call if this is meant to be a genuinely bilingual product; option 3 is the
pragmatic route if you want `/ar/` presentable without touching the backend contract. **Needs your
decision before I build it.**

### P1 — Real inconsistencies worth fixing

**1. `orders.guest` uses a different word than every other "guest" string**

| Key | Arabic | Note |
|---|---|---|
| `orders.guest` | زائر | "visitor" |
| `reports.guestVsRegistered.guest` | ضيف | "guest" |
| `reports.customerGeography.subtitle` | الطلب بدون عميل مسجّل | descriptive |

`orders.guest` renders in the orders table customer column and on the invoice
([orders-table.tsx:368](frontend/src/components/orders/orders-table.tsx#L368),
[order-invoice.tsx:162](frontend/src/components/orders/order-invoice.tsx#L162)) — the same concept
the Guest vs. registered report calls ضيف. A user reading both sees two different words.
**Fix**: `orders.guest` → `ضيف`.

**2. Percent sign is inconsistent between two identical columns**

| Key | Arabic |
|---|---|
| `reports.categoryBreakdown.columns.percentOfTotal` | `% من الإجمالي` (Latin %) |
| `reports.explorer.columns.percentOfTotal` | `٪ من الإجمالي` (Arabic ٪ U+066A) |
| `reports.productMargin.subtitle` | `١٠٠٪` (Arabic-Indic digits + ٪) |

Same label, two different glyphs, in tables a user compares side by side. Also `productMargin.subtitle`
is the **only** string in the entire file using Arabic-Indic numerals (١٠٠) — everywhere else uses
Western digits, which is what the app's number formatter outputs. That one reads as inconsistent
against its own live data.
**Fix**: settle on Latin `%` + Western digits everywhere (matches the formatter output), i.e.
`٪ من الإجمالي` → `% من الإجمالي`, and `١٠٠٪` → `100%`.

**3. `resource.import.summary.applied` — Arabic plural collapses one/other**

```
AR: … من أصل {total, plural, one {# صف} other {# صف}}
```

Both branches are identical (`# صف`), and the dual/few/many forms are missing entirely — so
"of 2 rows" and "of 10 rows" both render صف (singular). Every *other* plural in the file handles
this correctly; this one looks like it was truncated. Compare the sibling key
`resource.import.summary.preview`, which does it right.
**Fix**: give `total` the full 6-form treatment, matching `preview`.

**4. `roles.SUPPORT` vs `staffRole.SUPPORT` disagree**

| Key | Arabic |
|---|---|
| `staffRole.SUPPORT` | دعم |
| `roles.SUPPORT` | الدعم |
| `staffRole.DEMO` | عرض توضيحي (قراءة فقط) |
| `roles.DEMO` | تجريبي (قراءة فقط) |

Two parallel role-label namespaces that should be identical. `DEMO` especially — عرض توضيحي vs
تجريبي are noticeably different words for the same role badge.
**Fix**: make `roles.*` match `staffRole.*` exactly (or delete one namespace if it's redundant —
worth checking whether both are actually consumed).

### P2 — Wording refinements

**5. `staff.never` over-translates.** EN `Never` (a `Last sign-in` cell value) → AR
`لم يسجّل الدخول بعد` ("hasn't signed in yet") — a full sentence in a table cell that's otherwise
short values, and it hardcodes the sign-in meaning into a generic word. Compare
`settings.apiKeys.neverUsed` = `لم يُستخدم قط` and `settings.neverChangedInSection` = `لم يتغيّر قط`,
which both keep the `قط` pattern. Suggest `لم يسجّل الدخول قط` for consistency, or just `أبداً` if
column width matters.

**6. `returns.status.REQUESTED` = `قيد الطلب`** reads as "in the process of being ordered," which
is confusing on a *returns* page where الطلب also means "order." `reports.returnResolutionBreakdown.statuses.REQUESTED`
uses `مطلوب` for the same enum. Suggest `مُقدَّم` ("submitted") or aligning both to one choice.

**7. `orders.status.RETURNED` = `مُرجَع` vs `stockReason.RETURNED` = `مُرتجع`** — two spellings of
the same participle. Both are valid Arabic; pick one. The rest of the app leans مرتجع
(`returns.title` = المرتجعات).

**8. Missing full stops.** Three strings drop the terminating punctuation their EN counterpart has:
`orders.bulkStatus.typePhrase`, `delivery.detail.dangerZone.deactivate.confirm.typePhrase`,
`settings.dangerZone.*.confirm.typePhrase` (`اكتب {phrase} للتأكيد` — EN ends with `.`). Cosmetic,
but they sit next to strings that do have it.

### P3 — Noted, no action needed

- **`inventory.adjust.preview` `{from} ← {to}`** — the reversed arrow is **correct**. In an RTL
  paragraph the mirrored arrow preserves the "before → after" reading direction. Verified against
  [stock-adjust-sheet.tsx:219](frontend/src/components/inventory/stock-adjust-sheet.tsx#L219).
- **`settings.dangerZone.deactivate.activated` / `.deactivated` are inverted key names** (the key
  named `activated` fires when the store is *deactivated*, see
  [danger-zone-panel.tsx:147](frontend/src/components/settings/danger-zone-panel.tsx#L147)). Both EN
  and AR translate them per their *displayed* meaning, so nothing is wrong for the user — it's a
  code naming wart, not a translation bug. Flagged only so a future edit doesn't "fix" the Arabic
  to match the key name and thereby break it.
- **Latin technical terms kept as-is** (SKU, CSV, PDF, API, Node, Sentry, JWT, bcrypt, XLSX) — correct
  for an admin audience; translating them would hurt comprehension.
- **`nav`, `commandPalette`, `table`, `audit`, `diagnostics`, `errorPages`, `states`, `onboarding`,
  `productGallery`, `notificationsPage`** — reviewed key by key, no issues found.

---

## Per-namespace status

| Namespace | Keys | Status |
|---|---|---|
| settings | 199 | ✅ reviewed — no P1 |
| reports | 340 | ⚠️ P1 #2 (percent sign) |
| orders | 114 | ⚠️ P1 #1 (guest), P2 #7, #8 |
| delivery + courier | 113 | ✅ reviewed — P2 #8 only |
| staff + roles + auth | 118 | ⚠️ P1 #4 (role labels), P2 #5 |
| dashboard | 71 | ✅ reviewed — clean |
| returns + inventory + variants | 142 | ⚠️ P2 #6, #7 |
| resource + table + forms | 93 | ⚠️ P1 #3 (ICU plural) |
| audit + notifications + diagnostics | 82 | ✅ reviewed — clean |
| nav, common, states, enums, misc | 228 | ✅ reviewed — clean |

## What this review does *not* cover

- **Server-supplied display text** — see P0. The catalogue-vs-catalogue method used here is blind to
  any string that never enters `en.json`/`ar.json`. A complete i18n audit needs a third input: every
  literal in `settings.config.ts` and `admin.config.ts` that reaches the UI.
- **Live-browser verification of other pages** — P0 was caught by looking at a real rendered page.
  The remaining pages have only been reviewed at catalogue level, so the same class of bug could
  exist wherever a component renders server-provided text. Worth one pass through `/ar/` in a
  browser, page by page.

- **RTL layout rendering** — this is a string-content review. Whether panels/icons/charts mirror
  correctly in `dir="rtl"` is a separate pass (the `bilingual-en-ar` skill covers it).
- **Native-speaker sign-off** — I read every pair and judged register, terminology consistency and
  grammar. For the ROADMAP §G-GATE "reviewed by a native speaker" item, a human still needs to
  confirm; this narrows their job to the flagged items rather than all 1,500 keys.
