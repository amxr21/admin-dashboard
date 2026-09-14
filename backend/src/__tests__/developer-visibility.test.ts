import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StaffRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import request from 'supertest';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { clearRolePermissionCache } from '../services/role-permissions.service.js';

const app = createApp();
const policyKey = 'security.developerHiddenAreas';
const run = `developer-visibility-${Date.now()}`;

let ownerToken = '';
let developerToken = '';
let customerId = '';
let priorPolicy: Awaited<ReturnType<typeof prisma.setting.findUnique>> = null;
const userIds: string[] = [];

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  priorPolicy = await prisma.setting.findUnique({ where: { key: policyKey } });
  await prisma.setting.deleteMany({ where: { key: policyKey } });
  clearRolePermissionCache();

  for (const role of [StaffRole.OWNER, StaffRole.DEVELOPER]) {
    const user = await prisma.user.create({
      data: {
        email: `${run}-${role.toLowerCase()}@example.test`,
        role,
        passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
      },
    });
    userIds.push(user.id);
    if (role === StaffRole.OWNER) ownerToken = signToken(user);
    else developerToken = signToken(user);
  }

  const customer = await prisma.customer.create({
    data: { name: `${run} Customer`, email: `${run}@example.test` },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.setting.deleteMany({ where: { key: policyKey } });
  if (priorPolicy) {
    await prisma.setting.create({ data: { key: policyKey, value: priorPolicy.value } });
  }
  clearRolePermissionCache();
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('owner-controlled developer visibility', () => {
  it('only lets the owner change the policy and validates the area names', async () => {
    await request(app)
      .get('/api/v1/roles/developer/visibility')
      .set(auth(developerToken))
      .expect(403);

    await request(app)
      .put('/api/v1/roles/developer/visibility')
      .set(auth(developerToken))
      .send({ hiddenAreas: ['customers'] })
      .expect(403);

    await request(app)
      .put('/api/v1/roles/developer/visibility')
      .set(auth(ownerToken))
      .send({ hiddenAreas: ['not-an-area'] })
      .expect(400);
  });

  it('blocks hidden business APIs and search while keeping owner and diagnostics access', async () => {
    const saved = await request(app)
      .put('/api/v1/roles/developer/visibility')
      .set(auth(ownerToken))
      .send({ hiddenAreas: ['customers', 'orders', 'settings', 'shifts'] })
      .expect(200);
    const savedBody = saved.body as unknown as { data: { hiddenAreas: string[] } };
    expect(savedBody.data.hiddenAreas).toEqual(['customers', 'orders', 'settings', 'shifts']);

    const role = await request(app).get('/api/v1/roles/me').set(auth(developerToken)).expect(200);
    const roleBody = role.body as unknown as { data: { areas: string[] } };
    expect(roleBody.data.areas).not.toContain('customers');

    await request(app).get('/api/v1/r/customers').set(auth(developerToken)).expect(403);
    await request(app).get('/api/v1/orders').set(auth(developerToken)).expect(403);
    await request(app).get('/api/v1/organization').set(auth(developerToken)).expect(403);
    await request(app).get('/api/v1/branches').set(auth(developerToken)).expect(403);
    await request(app).get('/api/v1/shifts/me').set(auth(developerToken)).expect(403);
    await request(app).get('/api/v1/danger-zone/demo-data').set(auth(developerToken)).expect(403);

    const search = await request(app)
      .get('/api/v1/search')
      .query({ q: run })
      .set(auth(developerToken))
      .expect(200);
    const searchBody = search.body as unknown as { data: { customers: unknown[] } };
    expect(searchBody.data.customers).toEqual([]);

    const settings = await request(app).get('/api/v1/settings').set(auth(developerToken)).expect(200);
    const settingsBody = settings.body as unknown as { data: { settings: { key: string }[] } };
    expect(settingsBody.data.settings.some((setting) => setting.key === 'store.name')).toBe(false);

    await request(app).get('/api/v1/diagnostics/configuration').set(auth(developerToken)).expect(200);
    await request(app).get('/api/v1/settings').set(auth(ownerToken)).expect(200);
    await request(app).get('/api/v1/r/customers').set(auth(ownerToken)).expect(200);
  });
});
