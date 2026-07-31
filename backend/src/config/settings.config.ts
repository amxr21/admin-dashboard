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

export type SettingType = 'string' | 'boolean' | 'number' | 'enum';

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
  }
}
