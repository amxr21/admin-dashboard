import { Router } from 'express';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  SETTINGS,
  isSettingKey,
  settingKeys,
  validateSetting,
  type SettingKey,
} from '../../config/settings.config.js';

/**
 * Application settings.
 *
 * Reading is open to any signed-in user — the shell needs the default locale
 * and the demo-banner flag on every page, and refusing them to a SUPPORT
 * account would break the layout rather than protect anything.
 *
 * WRITING requires the `settings` area. The split is deliberate: these values
 * are not secret, but changing them affects everyone.
 *
 * The registry in settings.config.ts is an allowlist. An unknown key is a 400,
 * never a row — otherwise a Json column becomes an unbounded write target and
 * a server-read key becomes attacker-controlled.
 */

export const settingsRouter = Router();

/** Definition plus current value, so the UI renders itself from this. */
async function readAll() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: settingKeys() } },
    select: { key: true, value: true, updatedAt: true },
  });

  const stored = new Map(rows.map((row) => [row.key, row]));

  return settingKeys().map((key) => {
    const definition = SETTINGS[key];
    const row = stored.get(key);

    return {
      key,
      label: definition.label,
      ...('description' in definition ? { description: definition.description } : {}),
      type: definition.type,
      ...('options' in definition ? { options: definition.options } : {}),
      ...('min' in definition ? { min: definition.min } : {}),
      ...('max' in definition ? { max: definition.max } : {}),
      // A missing row is not an error — it means "never changed", so the
      // declared default is the live value and a fresh install works.
      value: row === undefined ? definition.default : row.value,
      isDefault: row === undefined,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

settingsRouter.get('/settings', authenticate, async (_req, res) => {
  res.json({ data: { settings: await readAll() } });
});

/**
 * Bulk update.
 *
 * ─── WHY EVERY KEY IS VALIDATED BEFORE ANY IS WRITTEN ────────────────
 * A settings form saves several values at once. Writing them one by one and
 * failing halfway leaves the form showing values that are partly saved and
 * partly not, with no way for the user to tell which. So the whole payload is
 * validated first, then applied in one transaction.
 *
 * Errors are collected per key rather than thrown on the first, so someone
 * editing six settings sees all six problems at once.
 */
settingsRouter.patch('/settings', authenticate, requireArea('settings'), async (req, res) => {
  const body: unknown = req.body;

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw AppError.badRequest('Expected an object of setting keys and values');
  }

  const entries = Object.entries(body as Record<string, unknown>);

  if (entries.length === 0) {
    throw AppError.badRequest('Provide at least one setting to write');
  }

  const errors: Record<string, string> = {};
  const writes: { key: SettingKey; value: string | boolean | number }[] = [];

  for (const [key, value] of entries) {
    if (!isSettingKey(key)) {
      // Named explicitly. A silently ignored key looks like a save that worked.
      errors[key] = 'Unknown setting';
      continue;
    }

    const result = validateSetting(key, value);

    if (result.ok) {
      writes.push({ key, value: result.value });
    } else {
      errors[key] = result.message;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw AppError.badRequest('Some settings could not be saved', { fields: errors });
  }

  await prisma.$transaction(
    writes.map((write) =>
      prisma.setting.upsert({
        where: { key: write.key },
        create: { key: write.key, value: write.value },
        update: { value: write.value },
      }),
    ),
  );

  const user = requireUser(req);

  // The KEYS are logged, never the values — a setting can hold a support
  // email, and logs have a longer retention than the table.
  req.log.info({
    event: 'settings.updated',
    keys: writes.map((write) => write.key),
    userId: user.id,
  });

  res.json({ data: { settings: await readAll() } });
});
