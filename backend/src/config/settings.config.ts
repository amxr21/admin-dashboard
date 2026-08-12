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
  'store.name': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 120,
    label: 'Store name',
    description: 'Shown on invoices and in the browser tab.',
  },
  'store.supportEmail': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 255,
    label: 'Support email',
    description: 'Where customers are told to write when something goes wrong.',
  },
  'store.currency': {
    type: 'enum',
    default: 'AED',
    area: 'settings',
    options: ['AED', 'SAR', 'USD', 'EUR', 'GBP'],
    label: 'Currency',
    description: 'Formatting only — it does not convert existing prices.',
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
  },
  'store.url': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 255,
    label: 'Store URL',
    description: 'Linked from invoices and emails, if you have a customer-facing site.',
  },
  'store.tagline': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 200,
    label: 'Tagline',
    description: 'A short line shown under the store name on invoices.',
  },
  'store.address': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 500,
    label: 'Address',
    description: 'Printed on invoices.',
  },
  'store.supportPhone': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 40,
    label: 'Support phone',
    description: 'Shown alongside the support email.',
  },
  'store.taxId': {
    type: 'string',
    default: '',
    area: 'settings',
    max: 60,
    label: 'Tax / VAT registration number',
    description: 'Printed on invoices alongside the address, if your jurisdiction requires it.',
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
  },
  'security.minPasswordLength': {
    type: 'number',
    default: 12,
    area: 'settings',
    min: 8,
    max: 128,
    label: 'Minimum password length',
    description: 'Enforced when an admin sets or resets a staff password, and on self-service reset.',
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
  'notifications.returnRequestAlerts': {
    type: 'boolean',
    default: true,
    area: 'settings',
    label: 'Return request alerts',
    description: 'Notify staff when a customer return is requested.',
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
