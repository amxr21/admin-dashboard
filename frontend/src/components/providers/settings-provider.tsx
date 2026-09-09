'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { applyAppearance, cacheAppearance, readAppearance } from '@/lib/apply-appearance';
import { fetchSettings } from '@/lib/settings-api';
import { fetchBrand, type ResolvedBrand } from '@/lib/branches-api';
import { readBranchId } from '@/lib/auth-storage';

/**
 * Fetches the settings registry and shares it — same reasoning as
 * SchemaProvider (`schema-provider.tsx`): several unrelated pieces of the
 * shell need a value out of it (table page size, the theme accent, panel
 * style), and each re-fetching independently would mean one request per
 * consumer for data that only changes when someone saves the settings form.
 *
 * ─── EVERY DERIVED VALUE IS COMPUTED FROM `effective`, NOT JUST STORED ────
 * `effective` merges the last-fetched registry with `overrides` — an
 * in-progress, unsaved edit `SettingsForm` pushes via `previewSetting()`.
 * Every value this context exposes (CSS custom properties, `editPanelMode`,
 * `sidebarMode`, the brand strings) is derived from `effective`, so an
 * override to ANY setting is visible EVERYWHERE it's consumed the instant
 * it's made — not just the three CSS-driven ones, and not just after a
 * round-trip to the server. `clearPreview()` (called on unmount by
 * `SettingsForm`) drops back to the last-fetched registry with nothing else
 * to undo, because nothing else was ever mutated.
 *
 * ─── `refresh()` IS WHAT MAKES A SAVE PERMANENT ──────────────────────────
 * `SettingsForm` calls `refresh()` right after a successful PATCH. It
 * re-fetches the registry AND clears `overrides` — the fetch is now
 * authoritative, so anything still previewed is either already reflected in
 * it (just saved) or was abandoned, and must stop shadowing the real value
 * either way.
 *
 * ─── APPLYING THE THEME IS A SIDE EFFECT HERE, NOT IN globals.css ────────
 * `--primary` and `--radius` already exist as CSS custom properties on
 * `:root`/`.dark` (see globals.css). Setting them again via an INLINE style
 * on `<html>` wins over both by specificity, in both themes, with no
 * duplication of the token values themselves — the same "re-point the inner
 * variable, never the theme token" rule the font stack already follows (see
 * the 2026-07-27 error-log entry on `@theme inline`). A default/unset value
 * clears the inline override so the CSS defaults show through again. The
 * actual DOM mutation lives in `lib/apply-appearance.ts` now, shared with
 * `SettingsForm`'s live preview so the two can never disagree.
 */

type Value = string | boolean | number;

interface SettingsContextValue {
  isLoading: boolean;
  tablePageSize: number;
  /** The live `security.minPasswordLength`. Exposed so password forms inside
   *  the admin shell stop hardcoding a floor that drifts the moment an owner
   *  changes the setting — the server enforces it via
   *  `assertPasswordMeetsPolicy` regardless, so a stale local copy only ever
   *  makes the UI wrong (enabling Save for a password the server rejects). */
  minPasswordLength: number;
  /** The live `pos.maxCashierDiscountPercent` (O9 Tier 3) — the till reads
   *  this to decide, BEFORE a sale, whether a discount needs a manager. The
   *  server enforces the real cap regardless (`pos.service.ts`), so a stale
   *  local copy only ever makes the till's own nudge wrong, never a way
   *  around the check. */
  maxCashierDiscountPercent: number;
  /** The live `returns.restockingFeePercent` (B4.11) — a DEFAULT the return
   *  detail sheet pre-fills; the person approving may still raise or waive
   *  it for that one return. The server applies the same default when the
   *  field is omitted entirely, so a stale local copy only ever makes the
   *  pre-filled value wrong, never a way around the real one. */
  restockingFeePercent: number;
  /** The live `returns.windowDays` (B4.11) — 0 means no window. Display
   *  only; the server computes `withinWindow` itself on every return. */
  returnWindowDays: number;
  /** The live `staff.defaultInviteRole` — pre-selects the invite form's role
   *  picker. A courtesy default only; `canAssignRole` is still enforced
   *  server-side regardless of what this is set to. */
  defaultInviteRole: string;
  editPanelMode: 'drawer' | 'modal';
  /** Store-wide visual treatment for the sidebar. Collapse/expand is a
   *  SEPARATE, personal per-browser preference — see useSidebarCollapse. */
  sidebarMode: 'sticky' | 'floating';
  /** Empty string means "no logo set" — the sidebar falls back to the store name. */
  logoUrl: string;
  /** Empty string means "not set" — consumers fall back to their own default. */
  storeName: string;
  storeTagline: string;
  storeAddress: string;
  storeSupportEmail: string;
  storeSupportPhone: string;
  storeTaxId: string;
  /** The live `store.currency` — an ISO 4217 code (AED/SAR/USD/EUR/GBP).
   *  Formatting only, per the setting's own description: it changes how a
   *  price DISPLAYS, never what it converts to or is stored as. Consumed by
   *  `useCurrencyFormat` rather than read directly at most call sites. */
  storeCurrency: string;
  /** Business-specific overrides for a fixed set of nav item labels — "Staff"
   *  -> "Baristas" for a cafe, etc. Keyed by the same `labelKey` used in
   *  `NAVIGATION` (config/navigation.ts), e.g. `navLabels.staff`. Empty or
   *  missing means "use the built-in translated label" — display-only, the
   *  underlying area/resource name never changes. */
  navLabels: Record<string, string>;
  /** Re-fetches the registry and re-applies every derived side effect. Call
   *  after a settings save so the change is visible without a page reload. */
  refresh: () => Promise<void>;
  /** Applies an UNSAVED value everywhere this setting is consumed — CSS
   *  custom properties, sidebar mode, edit panel style, brand strings — the
   *  instant it changes, before Save is ever clicked. */
  previewSetting: (key: string, value: Value) => void;
  /** Drops every unsaved preview, reverting to the last-fetched registry.
   *  Called when the settings form goes away without saving. */
  clearPreview: () => void;
}

const BRAND_DEFAULTS = {
  storeName: '',
  storeTagline: '',
  storeAddress: '',
  storeSupportEmail: '',
  storeSupportPhone: '',
  storeTaxId: '',
};

const DEFAULT_VALUE: SettingsContextValue = {
  isLoading: true,
  tablePageSize: 20,
  // Mirrors `settings.config.ts`'s declared default, used only until the real
  // registry loads.
  minPasswordLength: 12,
  // Mirrors `settings.config.ts`'s declared default, used only until the
  // real registry loads.
  maxCashierDiscountPercent: 20,
  restockingFeePercent: 0,
  returnWindowDays: 30,
  defaultInviteRole: 'SUPPORT',
  editPanelMode: 'drawer',
  sidebarMode: 'sticky',
  logoUrl: '',
  // Mirrors `settings.config.ts`'s declared default, used only until the
  // real registry loads.
  storeCurrency: 'AED',
  ...BRAND_DEFAULTS,
  navLabels: {},
  refresh: async () => {},
  previewSetting: () => {},
  clearPreview: () => {},
};

const SettingsContext = createContext<SettingsContextValue>(DEFAULT_VALUE);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [byKey, setByKey] = useState<Record<string, Value>>({});
  const [overrides, setOverrides] = useState<Record<string, Value>>({});

  /**
   * The brand resolved against the ACTIVE branch (F8.5), or null before it
   * loads / on an install with no branches.
   *
   * Fetched alongside the settings rather than merged from them here: the
   * fallback chain (branch -> business -> store setting) lives on the server
   * so there is ONE implementation of it. Duplicating it in the client would
   * mean the copy that drifts prints a wrong tax id on an invoice with
   * nothing failing.
   */
  const [brand, setBrand] = useState<ResolvedBrand | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);

    try {
      const settings = await fetchSettings();
      setByKey(Object.fromEntries(settings.map((setting) => [setting.key, setting.value])));
      setOverrides({});

      /**
       * Only fetched when a branch is actually active.
       *
       * With no active branch the endpoint returns the store-wide settings
       * that were just loaded above, so the request buys nothing — one extra
       * round trip on every page load of every single-branch install, which
       * is every install today.
       *
       * It also stopped an unrelated CI failure: an unconditional fetch here
       * fires in every test that renders this provider, most of which mock
       * `fetchSettings` and know nothing about brands. Those requests resolved
       * AFTER the test finished, and the late re-render reached GSAP once the
       * jsdom environment was already torn down — surfacing as
       * `ReferenceError: requestAnimationFrame is not defined`, an unhandled
       * error that failed the run while all 1016 tests passed.
       *
       * Separate try: a brand-resolution failure must not lose the settings
       * that already arrived.
       */
      if (readBranchId()) {
        try {
          setBrand(await fetchBrand());
        } catch {
          setBrand(null);
        }
      } else {
        setBrand(null);
      }
    } catch {
      // Swallowed on purpose, same as SchemaProvider: the shell must still
      // render with the CSS defaults and the hardcoded page size rather than
      // failing the whole app over a settings-provider outage.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const effective = useMemo(() => ({ ...byKey, ...overrides }), [byKey, overrides]);
  const effectiveMap = useMemo(() => new Map(Object.entries(effective)), [effective]);
  const appearance = useMemo(() => readAppearance(effectiveMap), [effectiveMap]);
  const hasPreview = Object.keys(overrides).length > 0;

  useEffect(() => {
    if (isLoading) return;

    applyAppearance(appearance);

    // Only a COMMITTED appearance is cached for the next page load's blocking
    // paint — an in-progress, unsaved preview must never survive to it.
    if (!hasPreview) cacheAppearance(appearance);
  }, [appearance, isLoading, hasPreview]);

  const previewSetting = useCallback((key: string, value: Value) => {
    setOverrides((current) => ({ ...current, [key]: value }));
  }, []);

  const clearPreview = useCallback(() => {
    setOverrides({});
  }, []);

  const pageSize = Number(effective['dashboard.tablePageSize'] ?? 20);
  const minPassword = Number(effective['security.minPasswordLength'] ?? 12);
  const maxCashierDiscount = Number(effective['pos.maxCashierDiscountPercent'] ?? 20);
  const restockingFee = Number(effective['returns.restockingFeePercent'] ?? 0);
  const returnWindow = Number(effective['returns.windowDays'] ?? 30);

  // A THREE-letter check, not a hardcoded AED/SAR/USD/EUR/GBP allowlist — the
  // server (`settings.config.ts`) is the one place that enum is declared;
  // copying it here would be a second copy to keep in sync for no real
  // protection (`Intl.NumberFormat` already throws on a truly invalid ISO
  // code, and this setting is display-only regardless — see its own
  // description). This only guards against a malformed/missing value
  // reaching the formatter, not against an unlisted-but-valid currency.
  //
  // Branch-resolved first (F8.5): a business in another country prices in its
  // own currency, and showing its orders in the install's currency would be a
  // wrong NUMBER, not just a wrong symbol. Same three-letter guard applies to
  // both sources — a malformed value from either must not reach the
  // formatter.
  const rawCurrency = brand?.storeCurrency || effective['store.currency'];
  const storeCurrency =
    typeof rawCurrency === 'string' && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'AED';

  // One `labels.nav.<key>` setting per relabelable nav item — see
  // settings.config.ts's own "Labels" section for the full list and why an
  // empty string means "not overridden" rather than a real label.
  const NAV_LABEL_KEYS = ['staff', 'orders', 'delivery', 'inventory', 'returns', 'reports'];
  const navLabels = Object.fromEntries(
    NAV_LABEL_KEYS.map((key) => [key, String(effective[`labels.nav.${key}`] ?? '')]).filter(
      ([, label]) => label !== '',
    ),
  );

  const value: SettingsContextValue = {
    isLoading,
    tablePageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20,
    minPasswordLength:
      Number.isFinite(minPassword) && minPassword > 0 ? minPassword : 12,
    // 0 is a legitimate value here (an owner requiring approval for ANY
    // discount) — the guard below only replaces a genuinely malformed
    // reading, so it must not treat 0 as one.
    maxCashierDiscountPercent:
      Number.isFinite(maxCashierDiscount) && maxCashierDiscount >= 0
        ? maxCashierDiscount
        : 20,
    // 0 is a legitimate value here too (no restocking fee at all) — same
    // "only replace a genuinely malformed reading" guard as the discount
    // cap above.
    restockingFeePercent:
      Number.isFinite(restockingFee) && restockingFee >= 0 ? restockingFee : 0,
    // 0 is legitimate here too — it means "no window at all", not malformed.
    returnWindowDays: Number.isFinite(returnWindow) && returnWindow >= 0 ? returnWindow : 30,
    defaultInviteRole: String(effective['staff.defaultInviteRole'] ?? 'SUPPORT'),
    editPanelMode: effective['ui.editPanelMode'] === 'modal' ? 'modal' : 'drawer',
    sidebarMode: effective['ui.sidebarMode'] === 'floating' ? 'floating' : 'sticky',
    /**
     * Brand fields prefer the branch-resolved value (F8.5) and fall back to
     * the store-wide setting.
     *
     * `brand?.x || setting` rather than `??`: the server returns an empty
     * string for "not set anywhere", and `??` would treat that empty string
     * as a real answer and blank out a perfectly good store setting.
     *
     * `storeTagline` is deliberately NOT branch-resolved — it is marketing
     * copy for the install, not a legal identity, and `Business` has no field
     * for it. Adding one would invent a concept nobody asked for.
     */
    logoUrl: brand?.storeLogoUrl || String(effective['store.logoUrl'] ?? ''),
    storeName: brand?.storeName || appearance.storeName,
    storeTagline: String(effective['store.tagline'] ?? ''),
    storeAddress: brand?.storeAddress || String(effective['store.address'] ?? ''),
    storeSupportEmail: brand?.storeSupportEmail || String(effective['store.supportEmail'] ?? ''),
    storeSupportPhone: brand?.storeSupportPhone || String(effective['store.supportPhone'] ?? ''),
    storeTaxId: brand?.storeTaxId || String(effective['store.taxId'] ?? ''),
    storeCurrency,
    navLabels,
    refresh: load,
    previewSetting,
    clearPreview,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useAppSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
