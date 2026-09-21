import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

const app = createApp();
const RUN = `shift-branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let businessId = '';
let branchAId = '';
let branchBId = '';
let managerId = '';
let cashierId = '';
let workerId = '';
let managerToken = '';
let cashierToken = '';
let cashierShiftId = '';
let workerShiftId = '';

function scopedAuth(token: string, branchId: string) {
  return { Authorization: `Bearer ${token}`, 'X-Branch-Id': branchId } as const;
}

beforeAll(async () => {
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessId = business.id;

  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({ data: { businessId, name: `${RUN} Marina` } }),
    prisma.branch.create({ data: { businessId, name: `${RUN} Downtown` } }),
  ]);
  branchAId = branchA.id;
  branchBId = branchB.id;

  const passwordHash = await bcrypt.hash('correct-horse-battery-staple', 10);
  const [manager, cashier, worker] = await Promise.all([
    prisma.user.create({
      data: { email: `${RUN}-manager@example.test`, name: `${RUN} manager`, role: StaffRole.MANAGER, passwordHash },
    }),
    prisma.user.create({
      data: { email: `${RUN}-cashier@example.test`, name: `${RUN} cashier`, role: StaffRole.CASHIER, passwordHash },
    }),
    prisma.user.create({
      data: { email: `${RUN}-worker@example.test`, name: `${RUN} worker`, role: StaffRole.FULFILLMENT, passwordHash },
    }),
  ]);
  managerId = manager.id;
  cashierId = cashier.id;
  workerId = worker.id;
  managerToken = signToken(manager);
  cashierToken = signToken(cashier);

  await prisma.userBranch.createMany({
    data: [
      { userId: managerId, branchId: branchAId, role: StaffRole.MANAGER },
      { userId: managerId, branchId: branchBId, role: StaffRole.MANAGER },
      { userId: cashierId, branchId: branchAId, role: StaffRole.CASHIER },
      { userId: cashierId, branchId: branchBId, role: StaffRole.CASHIER },
      { userId: workerId, branchId: branchBId, role: StaffRole.FULFILLMENT },
    ],
  });

  const [cashierShift, workerShift] = await Promise.all([
    prisma.shift.create({
      data: { userId: cashierId, branchId: branchBId, openedById: cashierId, openingFloat: '20.00', startedAt: new Date('2026-09-19T08:00:00Z') },
    }),
    prisma.shift.create({
      data: {
        userId: workerId,
        branchId: branchBId,
        openedById: workerId,
        startedAt: new Date('2026-09-19T08:00:00Z'),
        endedAt: new Date('2026-09-19T16:00:00Z'),
      },
    }),
  ]);
  cashierShiftId = cashierShift.id;
  workerShiftId = workerShift.id;
});

afterAll(async () => {
  await prisma.shift.deleteMany({ where: { userId: { in: [managerId, cashierId, workerId] } } });
  await prisma.userBranch.deleteMany({ where: { userId: { in: [managerId, cashierId, workerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [managerId, cashierId, workerId] } } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.delete({ where: { id: businessId } });
  await prisma.$disconnect();
});

describe('shift and till branch isolation', () => {
  it('returns only the open shift in the active branch', async () => {
    const hidden = await request(app)
      .get('/api/v1/shifts/me')
      .set(scopedAuth(cashierToken, branchAId));
    expect(hidden.status).toBe(200);
    expect((hidden.body as { data: { shift: unknown } }).data.shift).toBeNull();

    const visible = await request(app)
      .get('/api/v1/shifts/me')
      .set(scopedAuth(cashierToken, branchBId));
    expect(visible.status).toBe(200);
    expect((visible.body as { data: { shift: { id: string } } }).data.shift.id).toBe(cashierShiftId);
  });

  it('refuses starting a shift for someone not assigned to the active branch', async () => {
    const res = await request(app)
      .post('/api/v1/shifts')
      .set(scopedAuth(managerToken, branchAId))
      .send({ forUserId: workerId });

    expect(res.status).toBe(404);
  });

  it.each([
    ['end', 'post', `/api/v1/shifts/${cashierShiftId}/end`, {}],
    ['edit', 'patch', `/api/v1/shifts/${workerShiftId}`, { reason: 'Correction' }],
    ['approve', 'post', `/api/v1/shifts/${workerShiftId}/approve`, {}],
    ['reject', 'post', `/api/v1/shifts/${workerShiftId}/reject`, { note: 'Incorrect record' }],
    ['summary', 'get', `/api/v1/shifts/${workerShiftId}/summary`, undefined],
    ['takings', 'get', `/api/v1/shifts/${cashierShiftId}/takings`, undefined],
    ['events list', 'get', `/api/v1/shifts/${cashierShiftId}/events`, undefined],
    ['report', 'get', `/api/v1/shifts/${cashierShiftId}/report`, undefined],
  ] as const)('returns 404 for cross-branch %s', async (_label, method, path, body) => {
    let call = method === 'get'
      ? request(app).get(path).set(scopedAuth(managerToken, branchAId))
      : method === 'patch'
        ? request(app).patch(path).set(scopedAuth(managerToken, branchAId))
        : request(app).post(path).set(scopedAuth(managerToken, branchAId));
    if (body !== undefined) call = call.send(body);
    const res = await call;
    expect(res.status).toBe(404);
  });

  it('returns 404 before a cashier can write a till event through another branch', async () => {
    const res = await request(app)
      .post(`/api/v1/shifts/${cashierShiftId}/events`)
      .set(scopedAuth(cashierToken, branchAId))
      .send({ type: 'NO_SALE' });

    expect(res.status).toBe(404);
  });

  it('returns 404 before a cashier can close a till through another branch', async () => {
    const res = await request(app)
      .post(`/api/v1/shifts/${cashierShiftId}/close-till`)
      .set(scopedAuth(cashierToken, branchAId))
      .send({ closingCount: '20.00' });

    expect(res.status).toBe(404);
  });
});
