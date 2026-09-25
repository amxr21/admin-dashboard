/**
 * The settings registry — an ALLOWLIST, exactly like admin.config.ts.
 *
 * ─── WHY A JSON COLUMN NEEDS ONE MORE THAN ANY OTHER ─────────────────
 * `Setting.value` is `Json`, so without a registry a write endpoint accepts
 * any key with any shape: unbounded storage, no validation, and a settings
 * table that slowly becomes an undocumented second database nobody can reason
 * about. Worse, a key the UI never writes but the SERVER reads — a feature
 * flag, a limit — becomes attacker-controlled.
 *
 * So the request chooses BETWEEN declared settings; it never supplies one.
 * An unknown key is a 400, never a row.
 *
 * Adding a setting: add it here. That is the whole change — the route, the
 * validation and the defaults all read from this.
 */

export type SettingType = 'string' | 'boolean' | 'number' | 'enum' | 'color';

export interface SettingDefinition {
  /** Managed exclusively through the owner-only setup transaction. */
  setupOnly?: boolean;
  type: SettingType;
  /** Returned when no row exists, so a fresh install has working values. */
  default: string | boolean | number;
  /** Which staff area may write it. Reading settings is open to any signed-in user. */
  area: 'settings';
  max?: number;
  min?: number;
  options?: readonly string[];
  /** Shown in the UI. Not a translation key — see the note in the route. */
  label: string;
  description?: string;
  /**
   * Example text shown in an empty input.
   *
   * ─── WHY EVERY TEXT AND NUMBER SETTING WANTS ONE ─────────────────────
   * A settings form is mostly empty on a fresh install: every string here
   * defaults to `''`, so an owner opening this page sees a column of blank
   * boxes whose labels name the FIELD ("Tax / VAT registration number")
   * without showing what a filled-in one looks like. The label says what to
   * type; the placeholder shows the SHAPE, and the two answer different
   * questions — which is why a placeholder is never the label repeated back.
   *
   * A placeholder is an EXAMPLE, never an instruction: it vanishes the
   * moment someone types, so anything they still need while filling the
   * field belongs in `description`, which stays on screen. "Enter a value"
   * and "Store name" are both wrong here for that reason; "e.g. Nour Coffee
   * Roasters" is right.
   *
   * Plain text, exactly like `label` — NOT a translation key. The route's
   * own note explains why the registry ships human-readable strings rather
   * than keys, and an example is no more translatable than the label above
   * it. A localized example would also have to stay honest per locale (an
   * Arabic store name example is not a translation of an English one), which
   * is a bigger job than this field is worth today.
   *
   * Only declared for settings that render as a TEXT or NUMBER input.
   * Booleans are checkboxes, enums are selects or segmented controls and
   * colors are swatch pickers — none of them has an empty field to hint at,
   * so a placeholder on one would be dead config that reads as a promise the
   * UI never keeps.
   */
  placeholder?: string;
}

/**
 * The only accent colors a store may pick. Each is a Tailwind `600` shade —
 * dark enough to hold a legible white label (`--primary-foreground`) as a
 * button background in both themes, which an arbitrary staff-typed hex has no
 * guarantee of. Picking a color is a `SettingField` swatch click, never a
 * text field — see `settings-form.tsx`.
 */
export const ACCENT_COLOR_PALETTE = [
  '#2563eb', // blue (default)
  '#4f46e5', // indigo
  '#7c3aed', // violet
  '#db2777', // pink
  '#dc2626', // red
  '#ea580c', // orange
  '#16a34a', // green
  '#0d9488', // teal
] as const;

export const SETTINGS = {
  'features.dashboard.enabled': { type: 'boolean', default: true, area: 'settings', label: 'dashboard', setupOnly: true },
  'features.pos.enabled': { type: 'boolean', default: true, area: 'settings', label: 'pos', setupOnly: true },
  'features.orders.enabled': { type: 'boolean', default: true, area: 'settings', label: 'orders', setupOnly: true },
  'features.inventory.enabled': { type: 'boolean', default: true, area: 'settings', label: 'inventory', setupOnly: true },
  'features.suppliers.enabled': { type: 'boolean', default: true, area: 'settings', label: 'suppliers', setupOnly: true },
  'features.delivery.enabled': { type: 'boolean', default: true, area: 'settings', label: 'delivery', setupOnly: true },
  'features.returns.enabled': { type: 'boolean', default: true, area: 'settings', label: 'returns', setupOnly: true },
  'features.reports.enabled': { type: 'boolean', default: true, area: 'settings', label: 'reports', setupOnly: true },
  'features.scheduledReports.enabled': { type: 'boolean', default: true, area: 'settings', label: 'scheduledReports', setupOnly: true },
  'features.customerCases.enabled': { type: 'boolean', default: true, area: 'settings', label: 'customerCases', setupOnly: true },
  'features.staff.enabled': { type: 'boolean', default: true, area: 'settings', label: 'staff', setupOnly: true },
  'features.branches.enabled': { type: 'boolean', default: true, area: 'settings', label: 'branches', setupOnly: true },
  'features.settings.enabled': { type: 'boolean', default: true, area: 'settings', label: 'settings', setupOnly: true },
  'setup.completedAt': { type: 'string', default: '', area: 'settings', label: 'completedAt', max: 60, setupOnly: true },
  'setup.skippedAt': { type: 'string', default: '', area: 'settings', label: 'skippedAt', max: 60, setupOnly: true },
  'setup.businessType': { type: 'string', default: '', area: 'settings', label: 'businessType', max: 60, setupOnly: true },
  'products.defaultHasVariants': { type: 'boolean', default: false, area: 'settings', label: 'New products: variants', setupOnly: true },
  'products.defaultHasColors': { type: 'boolean', default: false, area: 'settings', label: 'New products: colors', setupOnly: true },
  'products.defaultHasBarcode': { type: 'boolean', default: false, area: 'settings', label: 'New products: barcode', setupOnly: true },
  'labels.nav.products': { type: 'string', default: '', area: 'settings', label: 'Products page name', max: 40, placeholder: 'e.g. Menu items' },
  'store.name': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 120,
    label: 'Store name',
    description: 'Shown on invoices and in the browser tab.',
    placeholder: 'e.g. Nour Coffee Roasters',
  },
  'store.supportEmail': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 255,
    label: 'Support email',
    description: 'Where customers are told to write when something goes wrong.',
    placeholder: 'e.g. help@nourcoffee.com',
  },
  'store.currency': {
    type: 'enum',
    default: 'AED',
    area: 'settings',
    options: ['AED', 'SAR', 'USD', 'EUR', 'GBP'],
    label: 'Currency',
    description: 'Formatting only — it does not convert existing prices.',
  },

  /**
   * Accepting a second currency at the till.
   *
   * ─── WHY RATES ARE MANUAL, AND ONE SETTING EACH ──────────────────────
   * Same opt-in shape as Cloudinary and SMTP: a rate left at 0 means "this
   * currency is not accepted", so shipping this enabled nothing anywhere.
   * There is no external rate feed by owner decision — a till must not depend
   * on a network call to finish a sale, and a stale feed would be worse than a
   * number somebody chose on purpose.
   *
   * One declared setting per currency rather than a JSON map, keeping the
   * "every setting is individually declared" rule this registry exists to
   * enforce (the same reason the nav labels are six settings, not one map).
   *
   * The rate is "how many of THIS currency equal one unit of the store
   * currency", so a store in AED accepting USD sets `usd` to about 0.27.
   * Stated on every label because the inverse is an equally natural reading
   * and getting it backwards is silently wrong rather than obviously broken.
   */
  'pos.tenderRate.AED': {
    type: 'number',
    default: 0,
    area: 'settings',
    min: 0,
    label: 'AED per 1 store currency',
    description: '0 means AED is not accepted at the till. Ignored when AED is the store currency.',
    placeholder: 'e.g. 3.67',
  },
  'pos.tenderRate.SAR': {
    type: 'number',
    default: 0,
    area: 'settings',
    min: 0,
    label: 'SAR per 1 store currency',
    description: '0 means SAR is not accepted at the till. Ignored when SAR is the store currency.',
    placeholder: 'e.g. 3.75',
  },
  'pos.tenderRate.USD': {
    type: 'number',
    default: 0,
    area: 'settings',
    min: 0,
    label: 'USD per 1 store currency',
    description: '0 means USD is not accepted at the till. Ignored when USD is the store currency.',
    placeholder: 'e.g. 0.27',
  },
  'pos.tenderRate.EUR': {
    type: 'number',
    default: 0,
    area: 'settings',
    min: 0,
    label: 'EUR per 1 store currency',
    description: '0 means EUR is not accepted at the till. Ignored when EUR is the store currency.',
    placeholder: 'e.g. 0.25',
  },
  'pos.tenderRate.GBP': {
    type: 'number',
    default: 0,
    area: 'settings',
    min: 0,
    label: 'GBP per 1 store currency',
    description: '0 means GBP is not accepted at the till. Ignored when GBP is the store currency.',
    placeholder: 'e.g. 0.21',
  },
  'ui.defaultLocale': {
    type: 'enum',
    default: 'en',
    area: 'settings',
    options: ['en', 'ar'],
    label: 'Default language',
    description: 'Used for new sessions. Each person can still switch their own.',
  },
  'ui.showDemoBanner': {
    type: 'boolean',
    default: true,
    area: 'settings',
    label: 'Show the read-only demo banner',
    description:
      'The banner explaining why saves do not stick for demo accounts. The API blocks those writes regardless of this setting.',
  },
  'inventory.lowStockThreshold': {
    type: 'number',
    default: 5,
    area: 'settings',
    min: 0,
    max: 100000,
    label: 'Low stock threshold',
    description: 'Products at or below this are flagged as low.',
    placeholder: 'e.g. 5',
  },
  'system.maintenanceMode': {
    type: 'boolean',
    default: false,
    area: 'settings',
    label: 'Maintenance mode',
    description:
      'Blocks writes for everyone except owners and developers, who can still turn this back off.',
  },

  // ─── Brand ──────────────────────────────────────────────────────────
  'store.logoUrl': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 500,
    label: 'Logo',
    // Still a plain string under the hood — the value is just a URL — but
    // the frontend control is an upload widget (`ImageUploadField`) with a
    // "paste a URL instead" fallback, not a bare text field. This
    // description is user-facing copy, so it describes what someone
    // actually sees, not the storage type.
    description: 'Uploaded to your image host, or paste a URL directly. Shown in the sidebar.',
    // The control is an upload widget with a "paste a URL instead" fallback,
    // and that fallback is a bare text box — so the example shows the shape
    // the typed half expects.
    placeholder: 'e.g. https://nourcoffee.com/logo.png',
  },
  'store.url': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 255,
    label: 'Store URL',
    description: 'Linked from invoices and emails, if you have a customer-facing site.',
    placeholder: 'e.g. https://nourcoffee.com',
  },
  'store.tagline': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 200,
    label: 'Tagline',
    description: 'A short line shown under the store name on invoices.',
    placeholder: 'e.g. Small-batch roasters since 2014',
  },
  'store.address': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 500,
    label: 'Address',
    description: 'Printed on invoices.',
    placeholder: 'e.g. Shop 4, Al Wasl Road, Dubai',
  },
  'store.supportPhone': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 40,
    label: 'Support phone',
    description: 'Shown alongside the support email.',
    placeholder: 'e.g. +971 4 123 4567',
  },
  'store.taxId': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 60,
    label: 'Tax / VAT registration number',
    description: 'Printed on invoices alongside the address, if your jurisdiction requires it.',
    placeholder: 'e.g. 100123456700003',
  },
  'store.taxRate': {
    type: 'number',
    default: 0,
    area: 'settings',
    min: 0,
    max: 100,
    label: 'Tax / VAT rate (%)',
    // 0 is a real, valid choice (no tax applies / not yet registered) — never
    // treated as "unset". A single flat rate for the whole store, same
    // single-jurisdiction assumption store.taxId already makes.
    description:
      'Applied to every order subtotal on the invoice. Set to 0 if you do not charge tax.',
    placeholder: 'e.g. 5',
  },

  // ─── Security ───────────────────────────────────────────────────────
  'security.sessionTimeoutMinutes': {
    type: 'number',
    default: 10080, // 7 days — matches the previous fixed JWT_EXPIRES_IN default.
    area: 'settings',
    min: 5,
    max: 43200, // 30 days
    label: 'Session timeout (minutes)',
    description:
      'How long a signed-in session stays valid before requiring another login. Shortening this does not sign out existing sessions early — it only shapes the next one issued.',
    placeholder: 'e.g. 10080',
  },
  'security.minPasswordLength': {
    type: 'number',
    default: 12,
    area: 'settings',
    min: 8,
    max: 128,
    label: 'Minimum password length',
    description: 'Enforced when an admin sets or resets a staff password, and on self-service reset.',
    placeholder: 'e.g. 12',
  },
  'security.ipAllowlist': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 4000,
    label: 'IP allowlist',
    description:
      'Comma-separated IPs or CIDR ranges (e.g. "203.0.113.0/24, 198.51.100.9"). Empty = disabled, the default and the only safe starting state. OWNER and DEVELOPER always bypass this check, even when their own IP is not listed — otherwise a wrong range locks out the only people who could fix it.',
    placeholder: 'e.g. 203.0.113.0/24, 198.51.100.9',
  },
  'security.require2faForRoles': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 200,
    label: 'Require 2FA for roles',
    description:
      'Comma-separated role names (e.g. "OWNER, MANAGER"). Staff in a listed role who have not enabled 2FA can still sign in and use everything EXCEPT write actions until they do — never a hard lockout. Empty = disabled, the default.',
    placeholder: 'e.g. OWNER, MANAGER',
  },

  // ─── Theme ──────────────────────────────────────────────────────────
  'theme.accentColor': {
    type: 'color',
    default: '#2563eb',
    area: 'settings',
    // A curated palette, not a free-form picker: every value here is chosen
    // to hold up as `--primary` against both the light and dark surface
    // tokens (see globals.css) — an arbitrary hex a staff member typed in
    // has no such guarantee (a pale yellow, say, fails contrast against a
    // white button label). `validateSetting` enforces membership below, the
    // same way an `enum` setting enforces its `options`.
    options: ACCENT_COLOR_PALETTE,
    label: 'Accent color',
    description: 'Replaces the default blue everywhere the app uses its primary color.',
  },

  // ─── Customization ──────────────────────────────────────────────────
  'theme.fontFamily': {
    type: 'enum',
    default: 'default',
    area: 'settings',
    // Each option is a real Latin+Arabic pair, both self-hosted via next/font
    // at BUILD time (see the root layout) — never a runtime font load. This
    // is the deliberate follow-up the comment used to point to here: adding a
    // font is a registration in the layout plus an option here, not a quick
    // string field, precisely BECAUSE of the 2026-07-27 incident where a
    // runtime override of the wrong CSS variable silently broke the Arabic
    // font — every option is validated at build time instead.
    options: ['default', 'modern', 'neutral', 'classic'],
    label: 'Font',
    description: 'Applies everywhere, in both languages. Each option pairs a matching Latin and Arabic typeface.',
  },
  'ui.density': {
    type: 'enum',
    default: 'comfortable',
    area: 'settings',
    options: ['comfortable', 'compact'],
    label: 'Table density',
    description: 'Compact rows fit more on screen; comfortable is easier to scan.',
  },
  'ui.cornerRadius': {
    type: 'enum',
    default: 'default',
    area: 'settings',
    options: ['sharp', 'default', 'round'],
    label: 'Corner radius',
    description: 'Applies to cards, inputs and buttons across the whole app.',
  },
  'ui.editPanelMode': {
    type: 'enum',
    default: 'drawer',
    area: 'settings',
    options: ['drawer', 'modal'],
    label: 'Edit panel style',
    description: 'How the create/edit form opens: a side drawer, or a centered dialog.',
  },
  'ui.sidebarMode': {
    type: 'enum',
    default: 'sticky',
    area: 'settings',
    options: ['sticky', 'floating'],
    label: 'Sidebar style',
    description:
      'Sticky keeps the sidebar flush with the edge. Floating detaches it with margin, rounded corners and a shadow. Either way it stays pinned in place and never scrolls with the page.',
  },

  // ─── Notifications ──────────────────────────────────────────────────
  // "New order" has no toggle: nothing in this admin app creates an order (no
  // POST /orders route exists — orders arrive from elsewhere), so there is no
  // event to gate. Shipping a toggle with nothing behind it would be a dead
  // control, which is worse than no control.
  'notifications.lowStockAlerts': {
    type: 'boolean',
    default: true,
    area: 'settings',
    label: 'Low-stock alerts',
    description: 'Notify staff when a product crosses the low-stock threshold.',
  },
  /**
   * Whether the till may sell stock the branch does not have (O5.8).
   *
   * Defaults to FALSE — refusing suits a shop whose count is trusted, and
   * selling what is not there produces a negative somebody has to explain
   * later, while the cashier standing at the shelf can see the truth now.
   *
   * But a shop mid-stocktake, or one whose counts are known to lag reality,
   * must not have its till stop working over bookkeeping. Hence the escape
   * hatch, and hence which way round the default goes.
   */
  'inventory.allowNegativeStock': {
    type: 'boolean',
    default: false,
    area: 'settings',
    label: 'Allow selling out-of-stock items',
    description:
      'Let the till complete a sale even when the branch shows none in stock. Off by default: a sale that takes stock negative is a discrepancy somebody has to explain afterwards.',
  },

  // ─── Till (O9 Tier 3) ───────────────────────────────────────────────
  'pos.maxCashierDiscountPercent': {
    type: 'number',
    default: 20,
    area: 'settings',
    min: 0,
    max: 100,
    label: 'Max cashier discount (%)',
    // 0 is a real, valid choice ("cashiers may never discount without a
    // manager") — never treated as "unset", same reasoning `store.taxRate`
    // already documents for its own 0. A cashier requesting ABOVE this
    // figure is refused server-side unless a manager override (O9.13)
    // approved it first — this setting is the line that decision is drawn
    // against, so lowering it takes effect on the very next sale, not the
    // next process restart.
    description:
      'A cashier may discount a line up to this percentage without help. Above it, a manager has to approve in place. Set to 0 to require approval for any discount at all.',
    placeholder: 'e.g. 20',
  },

  'notifications.returnRequestAlerts': {
    type: 'boolean',
    default: true,
    area: 'settings',
    label: 'Return request alerts',
    description: 'Notify staff when a customer return is requested.',
  },

  /**
   * ONE key for both approval and rejection, not two.
   *
   * They are the same event class — a pending return stopped being pending —
   * and whoever wants to know a return was approved wants to know it was
   * refused just as much; the outcome is in the notification body either way.
   * Two switches would invite the state nobody wants ("tell me about
   * approvals but not rejections"), which reads as a bug the first time a
   * rejection goes unannounced.
   *
   * Separate from `returnRequestAlerts` on purpose, though: that one fires
   * when work ARRIVES and is aimed at whoever picks it up, while this fires
   * when work is FINISHED and is aimed at whoever was waiting on the answer.
   * A shop with one person handling returns end to end may legitimately want
   * the first and not the second.
   */
  'notifications.returnDecisionAlerts': {
    type: 'boolean',
    default: true,
    area: 'settings',
    label: 'Return decision alerts',
    description: 'Notify staff when a return is approved or rejected.',
  },

  // ─── Returns (B4.11) ─────────────────────────────────────────────────
  /**
   * A WARNING, not a gate — the owner's own call. A return past the window
   * still goes through; the person approving it sees the request is late and
   * decides with judgment (a good customer, a defect found late), the same
   * "warn, don't block" shape the till already uses for over-stock and the
   * discount cap. 0 means no window at all — every return is always within
   * it, never treated as "unset".
   */
  // ─── Customer campaigns ────────────────────────────────────────────
  'campaigns.defaultCountryCode': {
    type: 'string',
    default: '971',
    area: 'settings',
    max: 4,
    label: 'Default country calling code for SMS',
    description:
      'Added to customer phone numbers saved without one (for example 050 1234567) so SMS can reach them. Digits only: 971 for the UAE.',
    placeholder: 'e.g. 971',
  },  'campaigns.smsCostPerSegment': {
    type: 'number',
    default: 0,
    area: 'settings',
    min: 0,
    max: 100,
    label: 'SMS cost per segment',
    description:
      'What your SMS provider charges per message segment, in the store currency. Used only to estimate a campaign\'s cost before sending; 0 hides the estimate.',
    placeholder: 'e.g. 0.18',
  },
  'campaigns.largeAudienceThreshold': {
    type: 'number',
    default: 200,
    area: 'settings',
    min: 1,
    max: 1000000,
    label: 'Large campaign confirmation',
    description:
      'A campaign going to at least this many customers asks the sender to type the exact recipient count before it sends.',
    placeholder: 'e.g. 200',
  },
  'campaigns.sendsPerMinute': {
    type: 'number',
    default: 60,
    area: 'settings',
    min: 1,
    max: 1000,
    label: 'Campaign sending rate (per minute)',
    description:
      'The most campaign messages sent in one minute. Keep it within your email and SMS providers\' limits.',
    placeholder: 'e.g. 60',
  },
  'campaigns.recipientRetentionDays': {
    type: 'number',
    default: 180,
    area: 'settings',
    min: 30,
    max: 730,
    label: 'Keep recipient records (days)',
    description:
      'After this many days, a finished campaign keeps only its totals: each recipient\'s address and delivery detail is erased.',
    placeholder: 'e.g. 180',
  },  'returns.windowDays': {
    type: 'number',
    default: 30,
    area: 'settings',
    min: 0,
    max: 3650,
    label: 'Return window (days)',
    description:
      'How many days after an order was placed a return is considered on-time. Past this, a request still goes through — staff just sees it is late. Set to 0 for no window at all.',
    placeholder: 'e.g. 30',
  },
  /**
   * A DEFAULT, not the whole answer (the owner's own call, matching how
   * `pos.maxCashierDiscountPercent` already works) — the person approving a
   * return may raise or waive it for that one case (a manufacturing defect
   * gets 0%, "changed my mind" gets the full store rate), rather than the
   * number being locked in everywhere it applies.
   */
  'returns.restockingFeePercent': {
    type: 'number',
    default: 0,
    area: 'settings',
    min: 0,
    max: 100,
    label: 'Restocking fee (%)',
    description:
      'Deducted from the refund cap by default when a return is approved. The person approving can still adjust or waive it for an individual return.',
    placeholder: 'e.g. 10',
  },

  // ─── Email ──────────────────────────────────────────────────────────
  // Only the non-secret half of email config lives here — the SMTP host,
  // port, username and password are `SMTP_*` environment variables (see
  // env.ts), never a Setting, because this table is readable by any
  // signed-in user. `email.enabled` gates BOTH alert toggles above at once —
  // toggling an alert on with email off still logs the in-app row, it just
  // doesn't also send mail, so nobody's inbox fills up the moment they flip
  // one switch without meaning to touch the other.
  'email.enabled': {
    type: 'boolean',
    default: false,
    area: 'settings',
    label: 'Send email for alerts',
    description:
      'In addition to the in-app notification, also email the support address below for low-stock and return-request alerts. Requires SMTP to be configured on the server.',
  },
  'email.fromAddress': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 255,
    label: 'Send emails from',
    description: 'The "From" address on outgoing alert emails. Alerts are sent TO the support email above.',
    placeholder: 'e.g. orders@nourcoffee.com',
  },
  /**
   * The display name beside the from-address — "Nour Coffee" <alerts@…>.
   *
   * Deliberately NOT reusing `store.name`: the name a business trades under
   * and the name it sends mail as are allowed to differ, and a store whose
   * registered name is long ("Nour Coffee Roasters LLC") usually wants
   * something shorter in an inbox list. Reusing one field would also mean
   * renaming the store silently rewrites the sender on every future alert.
   *
   * Empty is the declared default and means "send the bare address", never a
   * literal empty display name — the same "blank falls back to the built-in
   * behaviour" contract `labels.nav.*` already uses.
   */
  'email.senderName': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 120,
    label: 'Sender name',
    description:
      'The name shown beside the from-address in an inbox. Left blank, the address is sent on its own.',
  },
  /**
   * Where a REPLY goes, when that is not the sending address.
   *
   * This is the email setting with a real operational failure behind it: a
   * store sending alerts from an unattended `no-reply@` mailbox has no way to
   * learn that a courier or customer answered one, because the answer lands
   * somewhere nobody opens. Splitting reply-to from the from-address is the
   * standard fix, and it names a mailbox rather than authenticating to one,
   * so it is a preference and belongs here — not with the `SMTP_*`
   * credentials in env.ts.
   *
   * Empty means "replies go to the from-address", which is the mail client's
   * own behaviour when the header is absent — so the sender OMITS the header
   * entirely rather than sending it empty. An empty `Reply-To` is handled
   * inconsistently across mail servers and some drop the message outright.
   */
  'email.replyToAddress': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 255,
    label: 'Reply-to address',
    description:
      'Where replies to an alert email go, if that is not the sending address. Left blank, replies go back to the from-address.',
  },

  // ─── Dashboard behavior ─────────────────────────────────────────────
  'dashboard.tablePageSize': {
    type: 'number',
    default: 20,
    area: 'settings',
    min: 5,
    max: 100,
    label: 'Rows per table page',
    description: 'Applies to every list in the dashboard.',
    placeholder: 'e.g. 20',
  },

  // ─── Business-specific nav labels ──────────────────────────────────
  // An owner can rename a fixed set of nav items to fit their business, e.g.
  // "Staff" as "Baristas" for a cafe. Renames the sidebar entry, the page's
  // own heading, and every breadcrumb/permissions-matrix row that names that
  // area — but display-only: the underlying area/resource identifier
  // (`staff`, `orders`, ...) never changes, so no permission check, API
  // route, or audit-log action name is affected. Empty string is the
  // declared default and means "use the built-in translated label," never a
  // real value. Dashboard, Settings and Audit are deliberately not
  // included — generic enough across businesses that relabeling them buys
  // little.
  'labels.nav.staff': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 40,
    label: 'Staff page name',
    description: 'Replaces "Staff" in the sidebar and page heading, e.g. "Baristas".',
    placeholder: 'e.g. Baristas',
  },
  'labels.nav.orders': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 40,
    label: 'Orders page name',
    description: 'Replaces "Orders" in the sidebar and page heading, e.g. "Tickets".',
    placeholder: 'e.g. Tickets',
  },
  'labels.nav.delivery': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 40,
    label: 'Delivery page name',
    description: 'Replaces "Delivery" in the sidebar and page heading, e.g. "Runs".',
    placeholder: 'e.g. Runs',
  },
  'labels.nav.inventory': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 40,
    label: 'Inventory page name',
    description: 'Replaces "Inventory" in the sidebar and page heading.',
    placeholder: 'e.g. Stock room',
  },
  'labels.nav.returns': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 40,
    label: 'Returns page name',
    description: 'Replaces "Returns" in the sidebar and page heading.',
    placeholder: 'e.g. Refunds',
  },
  'labels.nav.reports': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 40,
    label: 'Reports page name',
    description: 'Replaces "Reports" in the sidebar and page heading.',
    placeholder: 'e.g. Insights',
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

export function settingKeys(): SettingKey[] {
  return Object.keys(SETTINGS) as SettingKey[];
}

/**
 * Validate a value against its declared shape.
 *
 * Returns the coerced value, or a message. Never throws — the caller reports
 * every bad key at once rather than failing on the first, so someone editing
 * six settings does not discover the problems one save at a time.
 */
export function validateSetting(
  key: SettingKey,
  value: unknown,
): { ok: true; value: string | boolean | number } | { ok: false; message: string } {
  const definition: SettingDefinition = SETTINGS[key];

  switch (definition.type) {
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, message: 'Must be true or false' };

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, message: 'Must be a number' };
      }
      if (definition.min !== undefined && value < definition.min) {
        return { ok: false, message: `Must be at least ${String(definition.min)}` };
      }
      if (definition.max !== undefined && value > definition.max) {
        return { ok: false, message: `Must be at most ${String(definition.max)}` };
      }
      return { ok: true, value };
    }

    case 'enum':
      return typeof value === 'string' && definition.options?.includes(value)
        ? { ok: true, value }
        : {
            ok: false,
            message: `Must be one of: ${(definition.options ?? []).join(', ')}`,
          };

    case 'string': {
      if (typeof value !== 'string') return { ok: false, message: 'Must be text' };
      if (definition.max !== undefined && value.length > definition.max) {
        return { ok: false, message: `Must be ${String(definition.max)} characters or fewer` };
      }
      return { ok: true, value };
    }

    case 'color': {
      // 6-digit hex only — the one shape every consumer (a CSS custom
      // property, an <input type="color">-style preview) can use with no
      // further parsing. Never a name ("blue") or a 3-digit shorthand.
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        return { ok: false, message: 'Must be a hex color like #2563eb' };
      }

      const normalised = value.toLowerCase();

      // Membership check, same shape as `enum` — a color setting with
      // `options` declared (every one today) is a swatch picker, not a free
      // text field, and the server enforces that rather than trusting the
      // frontend control to.
      if (definition.options && !definition.options.includes(normalised)) {
        return {
          ok: false,
          message: `Must be one of: ${definition.options.join(', ')}`,
        };
      }

      return { ok: true, value: normalised };
    }
  }
}
