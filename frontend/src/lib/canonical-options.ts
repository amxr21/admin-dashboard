/**
 * Canonical option sets for organization fields (URG-016/017/018/020).
 *
 * ─── WHY `Intl` AND NOT A BUNDLED DATASET ────────────────────────────
 * `Intl.supportedValuesOf` ships 162 ISO 4217 currencies and 417 IANA zones
 * with the runtime, and `Intl.DisplayNames` localizes currency and country
 * names into whatever locale is asked for. A bundled dataset would add
 * weight, go stale (zones change — Egypt reinstated DST in 2023), and give
 * worse Arabic names than the platform's own CLDR data.
 *
 * The IDs stored are the canonical ones (`AED`, `Asia/Dubai`, `AE`); only the
 * DISPLAY text is locale-dependent, so switching language never rewrites data.
 *
 * ─── OFFSETS ARE COMPUTED, NEVER STORED ──────────────────────────────
 * URG-017 is explicit that a fixed offset must not be stored as the zone.
 * `zoneOffsetLabel` derives the offset from the zone id at call time, so a
 * daylight-saving change is reflected automatically rather than frozen into
 * a stored "+04:00" that silently becomes wrong twice a year.
 */

export interface CanonicalOption {
  /** The canonical value stored in the database. */
  value: string;
  /** Localized, human-readable label. */
  label: string;
  /** Extra text shown beside the label (offset, currency code, dial code). */
  hint?: string;
}

function displayNames(locale: string, type: Intl.DisplayNamesType) {
  try {
    return new Intl.DisplayNames([locale], { type });
  } catch {
    return null;
  }
}

/** ISO 4217, e.g. `AED` → "United Arab Emirates Dirham" (URG-016). */
export function currencyOptions(locale: string): CanonicalOption[] {
  const names = displayNames(locale, 'currency');
  return Intl.supportedValuesOf('currency')
    .map((code) => ({
      value: code,
      label: names?.of(code) ?? code,
      hint: code,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

/**
 * Current UTC offset for a zone, formatted as `UTC+04:00`.
 *
 * Uses `longOffset`, which returns exactly that shape, rather than doing
 * arithmetic on two `Date`s — the arithmetic version gets 30- and 45-minute
 * zones (Asia/Kolkata, Asia/Kathmandu) wrong often enough to matter.
 */
export function zoneOffsetLabel(zone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** IANA zones with their CURRENT offset as a hint (URG-017). */
export function timezoneOptions(locale: string): CanonicalOption[] {
  return Intl.supportedValuesOf('timeZone')
    .map((zone) => ({
      value: zone,
      // The id itself is the clearest label here: "Asia/Dubai" is more
      // useful to an admin choosing a zone than any prose rendering of it.
      label: zone.replace(/_/g, ' '),
      hint: zoneOffsetLabel(zone),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

/**
 * ISO 3166-1 alpha-2 (URG-018).
 *
 * Derived from the zone list's region codes would be wrong (zones are not
 * countries), so this uses the canonical alpha-2 range and keeps only codes
 * `DisplayNames` actually resolves — an unassigned code returns the input
 * unchanged, which is how a non-country is filtered out.
 */
export function countryOptions(locale: string): CanonicalOption[] {
  const names = displayNames(locale, 'region');
  const out: CanonicalOption[] = [];

  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const label = names?.of(code);
      if (!label || label === code) continue;
      out.push({ value: code, label, hint: code });
    }
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** True when `value` is a currency this runtime recognizes. */
export function isCanonicalCurrency(value: string): boolean {
  return Intl.supportedValuesOf('currency').includes(value.toUpperCase());
}

/** True when `value` is an IANA zone this runtime recognizes. */
export function isCanonicalTimezone(value: string): boolean {
  return Intl.supportedValuesOf('timeZone').includes(value);
}

/** True when `value` is an assigned ISO 3166-1 alpha-2 region. */
export function isCanonicalCountry(value: string): boolean {
  if (!/^[A-Za-z]{2}$/.test(value)) return false;
  const code = value.toUpperCase();
  const names = displayNames('en', 'region');
  const label = names?.of(code);
  return Boolean(label) && label !== code;
}
