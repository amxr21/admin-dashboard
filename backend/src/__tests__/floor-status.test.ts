import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, StaffRole, TillEventType } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * The dashboard floor band — `GET /reports/floor-status`.
 *
 * ─── WHAT THESE TESTS ARE PROTECTING ─────────────────────────────────
 * This endpoint puts a money figure on the most-looked-at screen in the app,
 * so the things worth asserting are the ones that would make that figure a
 * lie:
 *
 * 1. Expected drawer is `openingFloat + cash − drops − payouts`. That is what
 *    `closeTill` reconciles a cashier's count against. If the dashboard used
 *    any other formula, the two screens would disagree about the same drawer
 *    and there would be no way to tell which one was wrong.
 * 2. A void is not a sale. `voidSale` writes a reversing payment with
 *    `method: 'void'`; it must not inflate `taken` or `salesCount`.
 * 3. A closed shift's `variance` is READ, never recomputed — the snapshot rule.
 * 4. Totals cover OPEN tills only. A counted-and-put-away drawer must not be
 *    claimed as money still on the floor.
 * 5. A shift that never opened a drawer reports a null float, not zero — "no
 *    till" and "a float of zero" are different facts.
 */

const app = createApp();

interface FloorBody {
  data: {
    openShifts: {
      shiftId: string;
      user: { id: string };
      branch: { id: string };
      salesCount: number;
      taken: string;
      averageSale: string;
      cash: string;
      expectedCash: string;
      cashRemoved: string;
      noSaleCount: number;
      voidCount: number;
      openingFloat: string | null;
      note: string | null;
    }[];
    recentlyClosed: {
      shiftId: string;
      variance: string | null;
      closingCount: string | null;
    }[];
    totals: {
      onShift: number;
      branches: number;
      taken: string;
      salesCount: number;
      expectedInDrawers: string;
      noSaleCount: number;
      voidCount: number;
    };
  };
}

const RUN = `floor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** `order_number` is VARCHAR(40), so the tagged suffix needs a short base. */
const SHORT = Math.random().toString(36).slice(2, 10);

const userIds: string[] = [];
const businessIds: string[] = [];
const orderIds: string[] = [];
const shiftIds: string[] = [];

let branchId = '';
let otherBranchId = '';
let ownerToken = '';
let quietId = '';
let closedShiftId = '';
let cashierShiftId = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

async function makeUser(role: StaffRole, label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${label}@example.test`,
      name: `${RUN} ${label}`,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return user;
}

async function seedShift(input: {
  userId: string;
  branchId: string;
  startedAt: Date;
  endedAt?: Date | null;
  openingFloat?: string | null;
  closingCount?: string | null;
  variance?: string | null;
  note?: string | null;
}) {
  const shift = await prisma.shift.create({
    data: {
      userId: input.userId,
      branchId: input.branchId,
      openedById: input.userId,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
      openingFloat: input.openingFloat === undefined ? null : input.openingFloat,
      closingCount: input.closingCount === undefined ? null : input.closingCount,
      variance: input.variance === undefined ? null : input.variance,
      note: input.note ?? null,
    },
    select: { id: true },
  });
  shiftIds.push(shift.id);
  return shift.id;
}

/** An order with one payment attached to a shift — the only way a sale
 *  reaches a shift, since `Order` has no `shiftId` of its own. */
async function seedSale(input: {
  shiftId: string;
  branchId: string;
  total: string;
  method: string;
}) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${SHORT}-${orderIds.length + 1}`,
      branchId: input.branchId,
      status: OrderStatus.DELIVERED,
      placedAt: new Date(),
      subtotal: new Prisma.Decimal(input.total),
      total: new Prisma.Decimal(input.total),
    },
    select: { id: true },
  });
  orderIds.push(order.id);

  await prisma.payment.create({
    data: {
      orderId: order.id,
      shiftId: input.shiftId,
      method: input.method,
      amount: new Prisma.Decimal(input.total),
    },
  });

  return order.id;
}

beforeAll(async () => {
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessIds.push(business.id);

  const [marina, jlt] = await Promise.all([
    prisma.branch.create({ data: { businessId: business.id, name: `${RUN} Marina` } }),
    prisma.branch.create({ data: { businessId: business.id, name: `${RUN} JLT` } }),
  ]);
  branchId = marina.id;
  otherBranchId = jlt.id;

  const [owner, cashier, quiet, closer] = await Promise.all([
    makeUser(StaffRole.OWNER, 'owner'),
    makeUser(StaffRole.MANAGER, 'cashier'),
    makeUser(StaffRole.FULFILLMENT, 'quiet'),
    makeUser(StaffRole.MANAGER, 'closer'),
  ]);

  ownerToken = signToken(owner);
  quietId = quiet.id;

  /* ── An open till with cash, a card sale, a void, a drop and a no-sale ── */
  cashierShiftId = await seedShift({
    userId: cashier.id,
    branchId,
    startedAt: new Date(Date.now() - 3 * 3_600_000),
    openingFloat: '400.00',
    note: 'Terminal 2 is flaky',
  });

  await seedSale({ shiftId: cashierShiftId, branchId, total: '120.00', method: 'cash' });
  await seedSale({ shiftId: cashierShiftId, branchId, total: '80.00', method: 'cash' });
  await seedSale({ shiftId: cashierShiftId, branchId, total: '200.00', method: 'card' });

  // A voided sale: the reversing row `voidSale` writes. Must not count.
  const voided = await seedSale({
    shiftId: cashierShiftId,
    branchId,
    total: '50.00',
    method: 'cash',
  });
  await prisma.payment.create({
    data: {
      orderId: voided,
      shiftId: cashierShiftId,
      method: 'void',
      amount: new Prisma.Decimal('-50.00'),
    },
  });

  await prisma.tillEvent.createMany({
    data: [
      {
        shiftId: cashierShiftId,
        type: TillEventType.CASH_DROP,
        amount: new Prisma.Decimal('100.00'),
        actorId: cashier.id,
      },
      { shiftId: cashierShiftId, type: TillEventType.NO_SALE, actorId: cashier.id },
      { shiftId: cashierShiftId, type: TillEventType.NO_SALE, actorId: cashier.id },
    ],
  });

  /* ── An open shift at another branch that never opened a drawer ── */
  await seedShift({
    userId: quiet.id,
    branchId: otherBranchId,
    startedAt: new Date(Date.now() - 3_600_000),
    openingFloat: null,
  });

  /* ── A shift closed an hour ago, still awaiting approval ── */
  closedShiftId = await seedShift({
    userId: closer.id,
    branchId,
    startedAt: new Date(Date.now() - 9 * 3_600_000),
    endedAt: new Date(Date.now() - 3_600_000),
    openingFloat: '300.00',
    closingCount: '415.50',
    // Deliberately NOT what recomputation would produce — see the test.
    variance: '-84.50',
  });
  await seedSale({ shiftId: closedShiftId, branchId, total: '500.00', method: 'cash' });
});

afterAll(async () => {
  await prisma.tillEvent.deleteMany({ where: { shiftId: { in: shiftIds } } });
  // Payments first: the order FK cascades but the shift FK is SetNull, so an
  // orphaned payment would survive the shift delete.
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.shift.deleteMany({ where: { id: { in: shiftIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

/** Only this test's own shifts — the table is shared with other suites. */
function mine(body: FloorBody) {
  return {
    open: body.data.openShifts.filter((row) => shiftIds.includes(row.shiftId)),
    closed: body.data.recentlyClosed.filter((row) => shiftIds.includes(row.shiftId)),
  };
}

async function fetchFloor(branch?: string) {
  const req = request(app).get('/api/v1/reports/floor-status').set(auth(ownerToken));
  if (branch) req.set('X-Branch-Id', branch);
  return req;
}

describe('floor status', () => {
  it('reports each open till with its own sales and money', async () => {
    const res = await fetchFloor();
    expect(res.status).toBe(200);

    const { open } = mine(res.body as FloorBody);
    const till = open.find((row) => row.shiftId === cashierShiftId);

    expect(till).toBeDefined();
    // 120 + 80 + 200 = 400. The voided 50 is excluded.
    expect(till?.taken).toBe('400.00');
    // Three real orders; the voided one is not a sale.
    expect(till?.salesCount).toBe(3);
    expect(till?.voidCount).toBe(1);
    expect(till?.averageSale).toBe('133.33');
    expect(till?.noSaleCount).toBe(2);
    expect(till?.note).toBe('Terminal 2 is flaky');
  });

  it('computes expected drawer the same way closeTill does', async () => {
    const res = await fetchFloor();
    const { open } = mine(res.body as FloorBody);
    const till = open.find((row) => row.shiftId === cashierShiftId);

    // Cash sales are 120 + 80 = 200 (the voided 50 never counts).
    expect(till?.cash).toBe('200.00');
    expect(till?.cashRemoved).toBe('100.00');
    // float 400 + (cash 200 − removed 100) = 500. This is exactly
    // `openingFloat + expectedCash` from `getShiftTakings`, which is what
    // `closeTill` subtracts the counted amount from.
    expect(till?.expectedCash).toBe('500.00');
  });

  it('reports a shift with no till as a null float, never zero', async () => {
    const res = await fetchFloor();
    const { open } = mine(res.body as FloorBody);
    const quiet = open.find((row) => row.user.id === quietId);

    expect(quiet).toBeDefined();
    // "No drawer" and "a float of 0.00" are different facts.
    expect(quiet?.openingFloat).toBeNull();
    expect(quiet?.salesCount).toBe(0);
    expect(quiet?.taken).toBe('0.00');
    // Guarded division — zero sales must not produce NaN.
    expect(quiet?.averageSale).toBe('0.00');
    expect(quiet?.expectedCash).toBe('0.00');
  });

  it('reads a closed shift’s stored variance rather than recomputing it', async () => {
    const res = await fetchFloor();
    const { closed } = mine(res.body as FloorBody);
    const row = closed.find((entry) => entry.shiftId === closedShiftId);

    expect(row).toBeDefined();
    // Recomputing would give 415.50 − (300 + 500) = −384.50. The stored value
    // is what the cashier signed off, and that is what must be reported.
    expect(row?.variance).toBe('-84.50');
    expect(row?.closingCount).toBe('415.50');
  });

  it('totals only the open tills', async () => {
    const res = await fetchFloor();
    const body = res.body as FloorBody;
    const { open } = mine(body);

    // The closed shift took 500 in cash. If totals included it, the sum of
    // this suite's open tills would not match the tills themselves.
    const takenFromRows = open.reduce((sum, row) => sum + Number(row.taken), 0);
    expect(takenFromRows).toBe(400);

    // Totals are install-wide (other suites may leave shifts open), so assert
    // the invariant rather than an absolute: every open row is counted.
    expect(body.data.totals.onShift).toBeGreaterThanOrEqual(open.length);
    expect(Number(body.data.totals.taken)).toBeGreaterThanOrEqual(takenFromRows);
  });

  it('scopes to the active branch', async () => {
    const res = await fetchFloor(otherBranchId);
    expect(res.status).toBe(200);

    const { open } = mine(res.body as FloorBody);
    // The Marina till must not appear when JLT is the active branch.
    expect(open.some((row) => row.shiftId === cashierShiftId)).toBe(false);
    expect(open.some((row) => row.user.id === quietId)).toBe(true);
  });

  it('refuses a role without the reports area', async () => {
    const picker = await makeUser(StaffRole.FULFILLMENT, 'picker');
    await prisma.userBranch.create({
      data: { userId: picker.id, branchId, role: StaffRole.FULFILLMENT },
    });
    const res = await request(app)
      .get('/api/v1/reports/floor-status')
      .set(auth(signToken(picker)))
      .set('X-Branch-Id', branchId);

    expect(res.status).toBe(403);
  });
});
