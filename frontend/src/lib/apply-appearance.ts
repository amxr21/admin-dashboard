/**
 * The single place that turns appearance settings into DOM side effects (CSS
 * custom properties, the density flag, the document title).
 *
 * Used in TWO moments that must never drift apart: applying the PERSISTED
 * registry (`SettingsProvider`, on load and after a save) and PREVIEWING an
 * in-progress edit before Save is clicked (`SettingsForm`). Both call the same
 * function so "what you see while editing" and "what actually gets applied"
 * can never disagree.
 */

const DEFAULT_ACCENT = '#2563eb';

const RADIUS_BY_OPTION: Record<string, string> = {
  sharp: '0rem',
  default: '0.625rem',
  round: '1rem',
};

/** Every option a real, registered `next/font` pair exists for — see the
 *  root layout. `default` needs no `[data-font-family]` rule at all;
 *  globals.css's unattributed `:root` already points at it. */
const FONT_FAMILY_OPTIONS = new Set(['default', 'modern', 'neutral', 'classic']);

/** localStorage key for the blocking pre-hydration script below — same
 *  pattern `next-themes` uses for dark mode (see `theme-provider.tsx`), applied
 *  to the settings this app derives from a DB fetch instead of a toggle. */
const CACHE_KEY = 'admin.appearance';

/**
 * Caches the last-applied appearance so the NEXT page load can paint it
 * before React even hydrates, instead of flashing default → actual while
 * `SettingsProvider` fetches the registry. Called only from the provider's
 * `load()` — i.e. only for values that came from a real fetch, never from
 * `SettingsForm`'s live, unsaved preview.
 */
export function cacheAppearance(
  values: Pick<AppearanceValues, 'accentColor' | 'cornerRadius' | 'density' | 'fontFamily'>,
): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(values));
  } catch {
    // Private browsing / storage disabled — the page still works, it just
    // flashes on load like it always did. Not worth failing over.
  }
}

export interface AppearanceValues {
  accentColor: string;
  cornerRadius: string;
  density: string;
  fontFamily: string;
  storeName: string;
}

/** Pulls the appearance-relevant keys out of any key→value map, with the same defaults this app has always used. */
export function readAppearance(byKey: Map<string, string | boolean | number>): AppearanceValues {
  return {
    accentColor: String(byKey.get('theme.accentColor') ?? DEFAULT_ACCENT),
    cornerRadius: String(byKey.get('ui.cornerRadius') ?? 'default'),
    density: String(byKey.get('ui.density') ?? 'comfortable'),
    fontFamily: String(byKey.get('theme.fontFamily') ?? 'default'),
    storeName: String(byKey.get('store.name') ?? ''),
  };
}

/**
 * The vanilla-JS twin of `applyAppearance()`, as a string for a blocking
 * `<script>` in the root layout's `<body>` — it has to run before any bundled
 * module (including this file) loads, so it can't just call the function
 * above. Built from the SAME constants so the two can't silently diverge; the
 * logic itself is intentionally kept in lockstep with `applyAppearance` by
 * hand, since a shared runtime import is exactly what this script exists to
 * avoid waiting for.
 */
export function getBlockingAppearanceScript(): string {
  return `(function(){try{
    var a=JSON.parse(localStorage.getItem(${JSON.stringify(CACHE_KEY)}));
    if(!a)return;
    var root=document.documentElement;
    var RADIUS=${JSON.stringify(RADIUS_BY_OPTION)};
    if(a.accentColor&&/^#[0-9a-fA-F]{6}$/.test(a.accentColor)&&a.accentColor.toLowerCase()!==${JSON.stringify(DEFAULT_ACCENT)}){
      root.style.setProperty('--primary',a.accentColor);
      root.style.setProperty('--primary-foreground','#ffffff');
    }
    if(a.cornerRadius&&a.cornerRadius!=='default'&&RADIUS[a.cornerRadius]){
      root.style.setProperty('--radius',RADIUS[a.cornerRadius]);
    }
    if(a.density==='compact')root.dataset.density='compact';
    if(a.fontFamily&&a.fontFamily!=='default')root.dataset.fontFamily=a.fontFamily;
  }catch(e){}})();`;
}

export function applyAppearance(values: AppearanceValues): void {
  const root = document.documentElement;

  // The registry's own description promises this ("Shown on invoices and in
  // the browser tab") — a Server Component `metadata` export can't reach a
  // DB-backed setting without a public read endpoint, so this is a side
  // effect applied to the one browser-chrome property that isn't a style.
  if (values.storeName) document.title = values.storeName;

  if (
    /^#[0-9a-fA-F]{6}$/.test(values.accentColor) &&
    values.accentColor.toLowerCase() !== DEFAULT_ACCENT
  ) {
    root.style.setProperty('--primary', values.accentColor);
    // Kept white: every accent this control accepts is a saturated brand
    // color, and computing a real contrast ratio for an arbitrary hex is a
    // bigger feature than a settings toggle deserves. The swatch next to the
    // input is the safety net.
    root.style.setProperty('--primary-foreground', '#ffffff');
  } else {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--primary-foreground');
  }

  const radius = RADIUS_BY_OPTION[values.cornerRadius];
  if (values.cornerRadius !== 'default' && radius) {
    root.style.setProperty('--radius', radius);
  } else {
    root.style.removeProperty('--radius');
  }

  root.dataset.density = values.density === 'compact' ? 'compact' : 'comfortable';

  if (values.fontFamily !== 'default' && FONT_FAMILY_OPTIONS.has(values.fontFamily)) {
    root.dataset.fontFamily = values.fontFamily;
  } else {
    delete root.dataset.fontFamily;
  }
}
