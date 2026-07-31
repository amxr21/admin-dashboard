import { prisma } from '../db/prisma.js';
import { SETTINGS, type SettingKey } from '../config/settings.config.js';

/**
 * Read a single setting's live value.
 *
 * Separate from the route's `readAll` (which shapes the whole registry for
 * the settings page) because middleware needs exactly one value, cheaply,
 * without importing route code — `authorize.ts` calling into a route file
 * would be backwards.
 */
export async function getSettingValue<K extends SettingKey>(
  key: K,
): Promise<(typeof SETTINGS)[K]['default']> {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });

  // A missing row means "never changed" — the declared default is the live
  // value, same rule the settings page itself follows.
  return (row === null ? SETTINGS[key].default : row.value) as (typeof SETTINGS)[K]['default'];
}
