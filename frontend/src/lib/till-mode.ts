import type { StaffRole } from '@/config/areas';

/**
 * Tiles or Full till: a per-person way of working the till, stored per
 * browser like the dashboard mode.
 *
 * Tiles is the ring-up screen cashiers know from other POS systems: big
 * product squares, one ticket, one Charge button, big payment buttons. Full is
 * the original till with split payments, other currencies, parked carts and
 * line discounts. No stored choice means Tiles for a CASHIER and Full for
 * everyone else; anyone can switch.
 */

export const TILL_MODES = ['tiles', 'full'] as const;
export type TillMode = (typeof TILL_MODES)[number];

const STORAGE_KEY = 'pos.tillMode';

export function defaultTillMode(role: StaffRole | undefined): TillMode {
  return role === 'CASHIER' ? 'tiles' : 'full';
}

export function readTillMode(): TillMode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'tiles' || stored === 'full' ? stored : null;
  } catch {
    return null;
  }
}

export function writeTillMode(mode: TillMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // A blocked store just means the choice lasts for this visit only.
  }
}
