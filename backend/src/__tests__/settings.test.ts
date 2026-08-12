import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { settingKeys } from '../config/settings.config.js';
import { waitFor } from './helpers/wait-for.js';

/**
 * Application settings.
 *
 * `Setting.value` is a Json column, which makes the registry the only thing
 * standing between a write endpoint and unbounded storage. So the tests are
 * mostly about what the allowlist REFUSES — and about a partial save, which
 * is the failure that leaves a form showing values it did not persist.
 */

const app = createApp();

interface SettingsBody {
  data: {
    settings: {
      key: string;
      value: unknown;
      isDefault: boolean;
      type: string;
      label: string;
    }[];
  };
}
interface ErrorBody {
  error: { code: string; message: string; details?: { fields?: Record<string, string> } };
}

const RUN = `settingstest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
let ownerToken = '';
let supportToken = '';

async function makeUser(role: StaffRole) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${role.toLowerCase()}@example.test`,
      name: role,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return signToken(user);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

function save(body: Record<string, unknown>, token = ownerToken) {
  return request(app).patch('/api/v1/settings').set(auth(token)).send(body);
}

function get(key: string, body: SettingsBody) {
  return body.data.settings.find((setting) => setting.key === key);
}

beforeAll(async () => {
  [ownerToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    // SUPPORT does not have the `settings` area.
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterEach(async () => {
  // Settings are global, so every test cleans up after itself rather than
  // leaving the dev database configured by a test run.
  await prisma.setting.deleteMany({ where: { key: { in: settingKeys() } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('reading', () => {
  it('is open to any signed-in user', async () => {
    // The shell needs the default locale and the demo-banner flag on every
    // page; refusing them to SUPPORT would break the layout, not protect it.
    expect((await request(app).get('/api/v1/settings').set(auth(supportToken))).status).toBe(200);
  });

  it('still requires a session', async () => {
    expect((await request(app).get('/api/v1/settings')).status).toBe(401);
  });

  it('returns declared defaults when nothing has been saved', async () => {
    // A missing row means "never changed", not an error — a fresh install has
    // to have working values.
    const res = await request(app).get('/api/v1/settings').set(auth(ownerToken));
    const currency = get('store.currency', res.body as SettingsBody);

    expect(currency?.value).toBe('AED');
    expect(currency?.isDefault).toBe(true);
  });

  it('describes each setting so the UI renders itself', async () => {
    const res = await request(app).get('/api/v1/settings').set(auth(ownerToken));
    const threshold = get('inventory.lowStockThreshold', res.body as SettingsBody);

    expect(threshold?.type).toBe('number');
    expect(threshold?.label).toBeTruthy();
  });
});

describe('writing is separately gated', () => {
  it('denies a role without the settings area', async () => {
    expect((await save({ 'store.name': 'Nope' }, supportToken)).status).toBe(403);
  });

  it('persists a change and marks it no longer default', async () => {
    expect((await save({ 'store.name': 'Ammar Supplies' })).status).toBe(200);

    const res = await request(app).get('/api/v1/settings').set(auth(ownerToken));
    const name = get('store.name', res.body as SettingsBody);

    expect(name?.value).toBe('Ammar Supplies');
    expect(name?.isDefault).toBe(false);
  });
});

/**
 * B3.8 — "per-section last-modified + audit link" needs something to LINK
 * TO. Before this, `PATCH /settings` only wrote a `req.log.info` line —
 * nothing reached the audit trail, so a settings page audit link would have
 * pointed at an always-empty filtered view.
 */
describe('settings writes reach the audit trail', () => {
  it('logs a real field diff on PATCH, not just the key name', async () => {
    await save({ 'store.name': `${RUN} audited name` });

    const entry = await waitFor(async () => {
      const found = await prisma.auditLog.findFirst({
        where: { action: 'settings.updated', entity: 'settings' },
        orderBy: { createdAt: 'desc' },
      });
      const changes = found?.changes as Record<string, { to: unknown }> | null;
      return changes?.['store.name']?.to === `${RUN} audited name` ? found : null;
    });

    const changes = entry?.changes as Record<string, { from: unknown; to: unknown }> | null;
    expect(changes?.['store.name']?.to).toBe(`${RUN} audited name`);
  });

  it('logs the PREVIOUS value as "from", not just the new one', async () => {
    await save({ 'store.name': `${RUN} first` });
    await save({ 'store.name': `${RUN} second` });

    const entry = await waitFor(async () => {
      const found = await prisma.auditLog.findFirst({
        where: { action: 'settings.updated', entity: 'settings' },
        orderBy: { createdAt: 'desc' },
      });
      const changes = found?.changes as Record<string, { to: unknown }> | null;
      return changes?.['store.name']?.to === `${RUN} second` ? found : null;
    });

    const changes = entry?.changes as Record<string, { from: unknown; to: unknown }> | null;
    expect(changes?.['store.name']).toEqual({ from: `${RUN} first`, to: `${RUN} second` });
  });

  it('logs a revert (DELETE) with the declared default as "to"', async () => {
    await save({ 'store.name': `${RUN} before revert` });
    await request(app).delete('/api/v1/settings/store.name').set(auth(ownerToken));

    const entry = await waitFor(() =>
      prisma.auditLog.findFirst({
        where: { action: 'settings.reverted', entity: 'settings' },
        orderBy: { createdAt: 'desc' },
      }),
    );

    const changes = entry?.changes as Record<string, { from: unknown; to: unknown }> | null;
    expect(changes?.['store.name']).toEqual({ from: `${RUN} before revert`, to: '' });
  });

  it('does NOT log a revert that was already a no-op (nothing stored to revert)', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'settings.reverted' } });

    await request(app).delete('/api/v1/settings/store.tagline').set(auth(ownerToken));

    // Asserting an absence has nothing to poll for — a short fixed wait is
    // the correct tool here (unlike the writes above), since there is no
    // "landed" state to detect.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const after = await prisma.auditLog.count({ where: { action: 'settings.reverted' } });
    expect(after).toBe(before);
  });
});

/**
 * B3.1 — "revert to default" is DELETE, not a special PATCH value. Deleting
 * the stored row is what makes `readAll`'s existing "missing row → declared
 * default" rule take over again — the same rule a fresh install relies on.
 */
describe('reverting a setting to its default', () => {
  it('deletes the row and the declared default becomes live again', async () => {
    await save({ 'store.name': 'Ammar Supplies' });

    const revertRes = await request(app)
      .delete('/api/v1/settings/store.name')
      .set(auth(ownerToken));
    expect(revertRes.status).toBe(200);

    const name = get('store.name', revertRes.body as SettingsBody);
    expect(name?.isDefault).toBe(true);

    // The row is genuinely gone, not just reset in place — confirmed against
    // the table directly, not only through the API's own shaping.
    const row = await prisma.setting.findUnique({ where: { key: 'store.name' } });
    expect(row).toBeNull();
  });

  it('is a no-op, not an error, when the setting was already at its default', async () => {
    const res = await request(app)
      .delete('/api/v1/settings/store.currency')
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
  });

  it('is gated on the settings area, same as writing', async () => {
    const res = await request(app)
      .delete('/api/v1/settings/store.name')
      .set(auth(supportToken));

    expect(res.status).toBe(403);
  });

  it('rejects an unknown key BY NAME, same as the allowlist on write', async () => {
    const res = await request(app)
      .delete('/api/v1/settings/store.doesNotExist')
      .set(auth(ownerToken));

    expect(res.status).toBe(400);
  });

  it('requires a session', async () => {
    const res = await request(app).delete('/api/v1/settings/store.name');
    expect(res.status).toBe(401);
  });
});

describe('the registry is an allowlist', () => {
  it('refuses an unknown key BY NAME', async () => {
    // Silently ignoring it would look like a save that worked.
    const res = await save({ 'store.name': 'Fine', 'evil.flag': true });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details?.fields).toMatchObject({
      'evil.flag': 'Unknown setting',
    });
  });

  it('writes NOTHING when any key is invalid', async () => {
    /**
     * The partial-save failure. Writing valid keys and rejecting the rest
     * leaves the form showing values that are partly persisted and partly not,
     * with no way to tell which — so the whole payload is validated first.
     */
    await save({ 'store.name': 'Original' });

    const res = await save({ 'store.name': 'Changed', 'evil.flag': true });

    expect(res.status).toBe(400);

    const after = await request(app).get('/api/v1/settings').set(auth(ownerToken));
    expect(get('store.name', after.body as SettingsBody)?.value).toBe('Original');
  });

  it('reports EVERY problem at once', async () => {
    // Otherwise someone editing six settings discovers the issues one save at
    // a time.
    const res = await save({
      'store.currency': 'XYZ',
      'ui.showDemoBanner': 'yes',
      'inventory.lowStockThreshold': -1,
    });

    expect(res.status).toBe(400);
    expect(Object.keys((res.body as ErrorBody).error.details?.fields ?? {})).toHaveLength(3);
  });
});

describe('values are validated against their declared type', () => {
  it('rejects a string where a boolean is declared', async () => {
    expect((await save({ 'ui.showDemoBanner': 'true' })).status).toBe(400);
  });

  it('accepts a real boolean', async () => {
    expect((await save({ 'ui.showDemoBanner': false })).status).toBe(200);
  });

  it('rejects an enum value outside the options', async () => {
    expect((await save({ 'ui.defaultLocale': 'fr' })).status).toBe(400);
  });

  it('enforces numeric bounds', async () => {
    expect((await save({ 'inventory.lowStockThreshold': -1 })).status).toBe(400);
    expect((await save({ 'inventory.lowStockThreshold': 999999 })).status).toBe(400);
    expect((await save({ 'inventory.lowStockThreshold': 12 })).status).toBe(200);
  });

  it('enforces numeric bounds on the tax rate, and accepts 0 as a real choice', async () => {
    expect((await save({ 'store.taxRate': -1 })).status).toBe(400);
    expect((await save({ 'store.taxRate': 101 })).status).toBe(400);
    // 0 means "no tax" — a valid, common value, not treated as unset.
    expect((await save({ 'store.taxRate': 0 })).status).toBe(200);
    expect((await save({ 'store.taxRate': 5 })).status).toBe(200);
  });

  it('enforces string length', async () => {
    expect((await save({ 'store.name': 'x'.repeat(121) })).status).toBe(400);
  });

  it('accepts a nav label override, and an empty string as "not overridden"', async () => {
    expect((await save({ 'labels.nav.staff': 'Baristas' })).status).toBe(200);
    // Empty is the declared default, meaning "use the built-in label" — not
    // an error, and not the same as omitting the key.
    expect((await save({ 'labels.nav.staff': '' })).status).toBe(200);
    expect((await save({ 'labels.nav.staff': 'x'.repeat(41) })).status).toBe(400);
  });

  it('rejects an empty payload', async () => {
    expect((await save({})).status).toBe(400);
  });

  it('rejects a non-object payload', async () => {
    const res = await request(app)
      .patch('/api/v1/settings')
      .set(auth(ownerToken))
      .send(['store.name']);

    expect(res.status).toBe(400);
  });
});

describe('the color type', () => {
  it('accepts a palette member, uppercase input lowercased', async () => {
    expect((await save({ 'theme.accentColor': '#2563EB' })).status).toBe(200);

    const res = await request(app).get('/api/v1/settings').set(auth(ownerToken));
    expect(get('theme.accentColor', res.body as SettingsBody)?.value).toBe('#2563eb');
  });

  it('rejects a well-formed hex that is not in the palette', async () => {
    // A valid 6-digit hex is necessary but not sufficient — accentColor is a
    // curated swatch picker (see ACCENT_COLOR_PALETTE), not a free field.
    expect((await save({ 'theme.accentColor': '#abcdef' })).status).toBe(400);
  });

  it('rejects a color name', async () => {
    expect((await save({ 'theme.accentColor': 'blue' })).status).toBe(400);
  });

  it('rejects a 3-digit shorthand', async () => {
    expect((await save({ 'theme.accentColor': '#fff' })).status).toBe(400);
  });

  it('rejects a hex without the leading #', async () => {
    expect((await save({ 'theme.accentColor': '2563eb' })).status).toBe(400);
  });
});

describe('the new registry entries this session added', () => {
  it('all describe themselves with a working default', async () => {
    const res = await request(app).get('/api/v1/settings').set(auth(ownerToken));
    const body = res.body as SettingsBody;

    const newKeys = [
      'store.logoUrl',
      'store.url',
      'store.tagline',
      'store.address',
      'store.supportPhone',
      'theme.accentColor',
      'ui.density',
      'ui.cornerRadius',
      'ui.editPanelMode',
      'notifications.lowStockAlerts',
      'notifications.returnRequestAlerts',
      'dashboard.tablePageSize',
    ];

    for (const key of newKeys) {
      const setting = get(key, body);
      expect(setting, `${key} is missing from GET /settings`).toBeTruthy();
      expect(setting?.isDefault).toBe(true);
    }
  });

  it('enforces the enum options on density, corner radius and edit panel mode', async () => {
    expect((await save({ 'ui.density': 'roomy' })).status).toBe(400);
    expect((await save({ 'ui.density': 'compact' })).status).toBe(200);

    expect((await save({ 'ui.cornerRadius': 'square' })).status).toBe(400);
    expect((await save({ 'ui.cornerRadius': 'round' })).status).toBe(200);

    expect((await save({ 'ui.editPanelMode': 'popover' })).status).toBe(400);
    expect((await save({ 'ui.editPanelMode': 'modal' })).status).toBe(200);
  });

  it('enforces numeric bounds on the table page size', async () => {
    expect((await save({ 'dashboard.tablePageSize': 1 })).status).toBe(400);
    expect((await save({ 'dashboard.tablePageSize': 500 })).status).toBe(400);
    expect((await save({ 'dashboard.tablePageSize': 50 })).status).toBe(200);
  });
});

describe('business-specific nav labels', () => {
  it('all six declare themselves with an empty default (no override)', async () => {
    const res = await request(app).get('/api/v1/settings').set(auth(ownerToken));
    const body = res.body as SettingsBody;

    const keys = [
      'labels.nav.staff',
      'labels.nav.orders',
      'labels.nav.delivery',
      'labels.nav.inventory',
      'labels.nav.returns',
      'labels.nav.reports',
    ];

    for (const key of keys) {
      const setting = get(key, body);
      expect(setting, `${key} is missing from GET /settings`).toBeTruthy();
      expect(setting?.isDefault).toBe(true);
      expect(setting?.value).toBe('');
    }
  });

  it('round-trips a real override', async () => {
    await save({ 'labels.nav.staff': 'Baristas' });

    const res = await request(app).get('/api/v1/settings').set(auth(ownerToken));
    const setting = get('labels.nav.staff', res.body as SettingsBody);

    expect(setting?.value).toBe('Baristas');
    expect(setting?.isDefault).toBe(false);
  });
});

describe('the engine cannot reach settings', () => {
  it('404s /r/settings', async () => {
    // Key/value pairs with per-key types are not a table of rows, and the
    // allowlist above is not something a field list can express.
    expect((await request(app).get('/api/v1/r/settings').set(auth(ownerToken))).status).toBe(404);
  });
});

describe('maintenance mode', () => {
  const customer = () => ({
    name: `${RUN} maintenance customer`,
    email: `${RUN}-maintenance-${Date.now()}@example.test`,
  });

  afterEach(async () => {
    await prisma.customer.deleteMany({ where: { email: { contains: RUN } } });
  });

  it('blocks a write from a non-exempt role once enabled', async () => {
    expect((await save({ 'system.maintenanceMode': true })).status).toBe(200);

    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(supportToken))
      .send(customer());

    expect(res.status).toBe(503);
    expect((res.body as ErrorBody).error.message).toMatch(/maintenance/i);
  });

  it('never blocks a read, even while enabled', async () => {
    await save({ 'system.maintenanceMode': true });

    expect((await request(app).get('/api/v1/r/customers').set(auth(supportToken))).status).toBe(
      200,
    );
  });

  it('exempts OWNER, so maintenance mode is never a one-way door', async () => {
    await save({ 'system.maintenanceMode': true });

    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(ownerToken))
      .send(customer());

    expect(res.status).toBe(201);
  });

  it('has no effect at all while off (the default)', async () => {
    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(supportToken))
      .send(customer());

    expect(res.status).toBe(201);
  });
});
