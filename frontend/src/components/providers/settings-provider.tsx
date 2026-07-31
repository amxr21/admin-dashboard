'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { fetchSettings } from '@/lib/settings-api';

/**
 * Fetches the settings registry ONCE and shares it — same reasoning as
 * SchemaProvider (`schema-provider.tsx`): several unrelated pieces of the
 * shell need a value out of it (table page size, the theme accent, panel
 * style), and each re-fetching independently would mean one request per
 * consumer for data that only changes when someone saves the settings form.
 *
 * ─── APPLYING THE THEME IS A SIDE EFFECT HERE, NOT IN globals.css ────
 * `--primary` and `--radius` already exist as CSS custom properties on
 * `:root`/`.dark` (see globals.css). Setting them again via an INLINE style
 * on `<html>` wins over both by specificity, in both themes, with no
 * duplication of the token values themselves — the same "re-point the inner
 * variable, never the theme token" rule the font stack already follows (see
 * the 2026-07-27 error-log entry on `@theme inline`). A default/unset value
 * clears the inline override so the CSS defaults show through again.
 */

const DEFAULT_ACCENT = '#2563eb';

const RADIUS_BY_OPTION: Record<string, string> = {
  sharp: '0rem',
  default: '0.625rem',
  round: '1rem',
};

interface SettingsContextValue {
  isLoading: boolean;
  tablePageSize: number;
  editPanelMode: 'drawer' | 'modal';
  /** Empty string means "no logo set" — the sidebar falls back to the store name. */
  logoUrl: string;
}

const SettingsContext = createContext<SettingsContextValue>({
  isLoading: true,
  tablePageSize: 20,
  editPanelMode: 'drawer',
  logoUrl: '',
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SettingsContextValue>({
    isLoading: true,
    tablePageSize: 20,
    editPanelMode: 'drawer',
    logoUrl: '',
  });

  useEffect(() => {
    let cancelled = false;

    fetchSettings()
      .then((settings) => {
        if (cancelled) return;

        const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

        const accent = String(byKey.get('theme.accentColor') ?? DEFAULT_ACCENT);
        const density = String(byKey.get('ui.density') ?? 'comfortable');
        const radiusOption = String(byKey.get('ui.cornerRadius') ?? 'default');
        const pageSize = Number(byKey.get('dashboard.tablePageSize') ?? 20);
        const panelMode = byKey.get('ui.editPanelMode') === 'modal' ? 'modal' : 'drawer';
        const logoUrl = String(byKey.get('store.logoUrl') ?? '');

        const root = document.documentElement;

        if (/^#[0-9a-fA-F]{6}$/.test(accent) && accent.toLowerCase() !== DEFAULT_ACCENT) {
          root.style.setProperty('--primary', accent);
          // Kept white: every accent this control accepts is a saturated
          // brand color, and computing a real contrast ratio for an
          // arbitrary hex is a bigger feature than a settings toggle
          // deserves. The swatch next to the input is the safety net —
          // a color unreadable against white looks wrong there first.
          root.style.setProperty('--primary-foreground', '#ffffff');
        } else {
          root.style.removeProperty('--primary');
          root.style.removeProperty('--primary-foreground');
        }

        if (radiusOption !== 'default' && RADIUS_BY_OPTION[radiusOption]) {
          root.style.setProperty('--radius', RADIUS_BY_OPTION[radiusOption]);
        } else {
          root.style.removeProperty('--radius');
        }

        root.dataset.density = density === 'compact' ? 'compact' : 'comfortable';

        setValue({
          isLoading: false,
          tablePageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20,
          editPanelMode: panelMode,
          logoUrl,
        });
      })
      .catch(() => {
        // Swallowed on purpose, same as SchemaProvider: the shell must still
        // render with the CSS defaults and the hardcoded page size rather
        // than failing the whole app over a settings-provider outage.
        if (!cancelled) setValue((current) => ({ ...current, isLoading: false }));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useAppSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
