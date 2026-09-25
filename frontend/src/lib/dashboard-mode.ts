/**
 * Simple or Detailed dashboard — a per-person view preference, stored per
 * browser like the live-band template (see `dashboard-template.ts` for why
 * that is localStorage rather than a setting).
 *
 * No stored choice means the business's default: Simple for a Home Business,
 * whose owner mostly needs today's orders and what to do next; Detailed for
 * everyone else, which is the page they already know.
 */

export const DASHBOARD_MODES = ['simple', 'detailed'] as const;
export type DashboardMode = (typeof DASHBOARD_MODES)[number];

const STORAGE_KEY = 'dashboard.mode';

export function defaultModeFor(businessType: string): DashboardMode {
  return businessType === 'HOME_BUSINESS' ? 'simple' : 'detailed';
}

/** The stored choice, or null when this browser has never chosen. */
export function readMode(): DashboardMode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'simple' || stored === 'detailed' ? stored : null;
  } catch {
    return null;
  }
}

export function writeMode(mode: DashboardMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // A blocked store just means the choice lasts for this visit only.
  }
}