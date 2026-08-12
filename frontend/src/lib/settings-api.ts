import { apiFetch } from '@/lib/api';

/**
 * Client for `/api/v1/settings`.
 *
 * ─── THE FORM RENDERS ITSELF FROM THE RESPONSE ───────────────────────
 * Each item carries its own `type`, `label`, `options` and bounds, so the UI
 * has no local list of settings to keep in step with the server's registry.
 * Adding a setting in `settings.config.ts` makes it appear here with no
 * frontend change — the same trick the resource engine uses, applied to a
 * much smaller surface.
 */

export type SettingType = 'string' | 'boolean' | 'number' | 'enum' | 'color';

export interface Setting {
  key: string;
  label: string;
  description?: string;
  type: SettingType;
  options?: string[];
  min?: number;
  max?: number;
  value: string | boolean | number;
  /** True when no row exists — the declared default is the live value. */
  isDefault: boolean;
  updatedAt: string | null;
}

export async function fetchSettings(): Promise<Setting[]> {
  const body = await apiFetch<{ settings: Setting[] }>('/settings');
  return body.settings;
}

/**
 * Saves the whole form in ONE request.
 *
 * The server validates every key before writing any of them, so a rejected
 * value leaves nothing persisted. Saving key-by-key would produce exactly the
 * half-saved form that behaviour exists to prevent.
 */
export async function saveSettings(
  changes: Record<string, string | boolean | number>,
): Promise<Setting[]> {
  const body = await apiFetch<{ settings: Setting[] }>('/settings', {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
  return body.settings;
}

/**
 * Reverts one setting to its declared default by deleting the stored row —
 * not a special value sent through `saveSettings`. See the backend route's
 * own doc comment for why this is DELETE rather than "PATCH with the default
 * value": the API never sends the default separately from the live value,
 * so the form has no default to send back even if it wanted to.
 */
export async function revertSetting(key: string): Promise<Setting[]> {
  const body = await apiFetch<{ settings: Setting[] }>(
    `/settings/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  );
  return body.settings;
}

/** Per-key messages from a 400, keyed exactly as the settings are. */
export function fieldErrorsFrom(details: unknown): Record<string, string> {
  if (details && typeof details === 'object' && 'fields' in details) {
    const fields = (details as { fields?: unknown }).fields;

    if (fields && typeof fields === 'object') {
      return Object.fromEntries(
        Object.entries(fields as Record<string, unknown>).map(([key, message]) => [
          key,
          String(message),
        ]),
      );
    }
  }

  return {};
}
