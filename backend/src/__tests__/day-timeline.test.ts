import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * The day timeline — `GET /reports/day-timeline`.
 *
 * ─── THE ONE THING THESE TESTS EXIST FOR ─────────────────────────────
 * A feed that looks complete is trusted as complete. `AuditLog` records what
 * STAFF did and has no row for an order a customer placed on the storefront —
 * nothing in `storefront.service.ts` calls `audit()`, because there is no
 * actor to attribute. So an audit-only timeline would omit most of a retail
 * day and do it silently.
 *
 * The first test is therefore the important one: an order with NO audit row
 * must still appear. The rest guard the merge (one sort across two sources),
 * the cap (drops oldest, not one whole source), and the window.
 */

const app = createApp();

interface TimelineBody {
  data: {
    events: {
      id: string;
      at: string;
      kind: string;
      actor: string | null;
      label: string | null;
      amount: string | null;
      branch: { id: string; name: string } | null;
    }[];
    truncated: boolean;
  };
}

const RUN = `daytl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SHORT = Math.random().toString(36).slice(2, 10);

const userIds: string[] = [];
const businessIds: string[] = [];
const orderIds: string[] = [];
const auditIds: string[] = [];

let branchId = '';
let otherBranchId = '';
let ownerToken = '';
let storefrontOrderNumber = '';

/** A window entirely in the past, so other suites' data cannot land in it. */
const FROM = '2021-05-10';
const TO = '2021-05-10';
/** Inside that window — orders and audit rows are seeded at these instants. */
const MORNING = new Date('2021-05-10T08:00:00.000Z');
const MIDDAY = new Date('2021-05-10T12:00:00.000Z');
const EVENING = new Date('2021-05-10T18:00:00.000Z');
/** Outside it, to prove the window is honoured. */
const YESTERDAY = new Date('2021-05-09T12:00:00.000Z');

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

async function seedOrder(input: { placedAt: Date; total: string; soldByName: string | null; branchId?: string }) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${SHORT}-${orderIds.length + 1}`,
      branchId: input.branchId ?? branchId,
      status: OrderStatus.DELIVERED,
      placedAt: input.placedAt,
      subtotal: new Prisma.Decimal(input.total),
      total: new Prisma.Decimal(input.total),
      soldByName: input.soldByName,
    },
    select: { id: true, orderNumber: true },
  });
  orderIds.push(order.id);
  return order;
}

async function seedAudit(input: {
  action: string;
  entity: string;
  createdAt: Date;
  branchId?: string;
  entityId?: string;
}) {
  const row = await prisma.auditLog.create({
    data: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? `${RUN}-entity`,
      branchId: input.branchId ?? branchId,
      actorEmail: `${RUN}-cashier@example.test`,
      actorRole: 'MANAGER',
      outcome: 'SUCCESS',
      createdAt: input.createdAt,
    },
    select: { id: true },
  });
  auditIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessIds.push(business.id);
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: `${RUN} Marina` },
  });
  branchId = branch.id;
  const otherBranch = await prisma.branch.create({
    data: { businessId: business.id, name: `${RUN} Downtown` },
  });
  otherBranchId = otherBranch.id;

  const owner = await makeUser(StaffRole.OWNER, 'owner');
  ownerToken = signToken(owner);

  // A storefront order: nobody rang it up, and NOTHING audits it.
  const storefront = await seedOrder({ placedAt: MIDDAY, total: '312.00', soldByName: null });
  storefrontOrderNumber = storefront.orderNumber;

  // A till sale, which does carry an audit row.
  await seedOrder({ placedAt: MORNING, total: '84.50', soldByName: `${RUN} cashier` });
  await seedAudit({ action: 'order.sold', entity: 'order', createdAt: MORNING });

  // Bookends, so ordering across the two sources is observable.
  await seedAudit({ action: 'shift.started', entity: 'shifts', createdAt: MORNING });
  await seedAudit({ action: 'shift.till_closed', entity: 'shifts', createdAt: EVENING });

  // Same day, different branch. A selected-branch timeline must exclude both
  // sources rather than filtering orders while leaking the other audit row.
  await seedOrder({
    placedAt: new Date('2021-05-10T17:00:00.000Z'),
    total: '777.00',
    soldByName: null,
    branchId: otherBranchId,
  });
  await seedAudit({
    action: 'shift.ended',
    entity: 'shifts',
    entityId: `${RUN}-other-branch`,
    createdAt: new Date('2021-05-10T17:30:00.000Z'),
    branchId: otherBranchId,
  });

  // Outside the window entirely.
  await seedOrder({ placedAt: YESTERDAY, total: '999.00', soldByName: null });
  await seedAudit({ action: 'shift.started', entity: 'shifts', createdAt: YESTERDAY });

  // An audited action the timeline deliberately ignores.
  await seedAudit({ action: 'orders.exported', entity: 'orders', createdAt: MIDDAY });

  // A separate, order-only day proves truncation does not depend on the audit
  // source contributing enough rows to make the merged pre-cap count larger.
  await seedOrder({ placedAt: new Date('2021-05-08T08:00:00.000Z'), total: '10.00', soldByName: null });
  await seedOrder({ placedAt: new Date('2021-05-08T09:00:00.000Z'), total: '20.00', soldByName: null });
  await seedOrder({ placedAt: new Date('2021-05-08T10:00:00.000Z'), total: '30.00', soldByName: null });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

async function fetchDay(query = `from=${FROM}&to=${TO}`) {
  return request(app).get(`/api/v1/reports/day-timeline?${query}`).set(auth(ownerToken));
}

describe('day timeline', () => {
  it('includes a storefront order that nothing audited', async () => {
    const res = await fetchDay();
    expect(res.status).toBe(200);

    const { events } = (res.body as TimelineBody).data;
    const placed = events.find((event) => event.label === storefrontOrderNumber);

    // The whole reason this endpoint is not a query on AuditLog.
    expect(placed).toBeDefined();
    expect(placed?.kind).toBe('order.placed');
    expect(placed?.amount).toBe('312.00');
    // Nobody rang it up — null actor, not a fabricated one.
    expect(placed?.actor).toBeNull();
    expect(placed?.branch?.id).toBe(branchId);
  });

  it('merges both sources into one descending order', async () => {
    const res = await fetchDay();
    const mine = (res.body as TimelineBody).data.events.filter(
      (event) => event.id.startsWith('order-') || event.actor?.includes(RUN) === true,
    );

    // Sorted as one feed, not audit-then-orders.
    const times = mine.map((event) => event.at);
    expect([...times].sort((a, b) => (a < b ? 1 : -1))).toEqual(times);

    // Both kinds present in the same list.
    expect(mine.some((event) => event.kind === 'order.placed')).toBe(true);
    expect(mine.some((event) => event.kind === 'shift.till_closed')).toBe(true);
  });

  it('honours the window', async () => {
    const res = await fetchDay();
    const { events } = (res.body as TimelineBody).data;

    // 999.00 was placed the day before and must not appear.
    expect(events.some((event) => event.amount === '999.00')).toBe(false);
    for (const event of events) {
      expect(event.at >= '2021-05-10').toBe(true);
      expect(event.at < '2021-05-11').toBe(true);
    }
  });

  it('scopes orders and audited events to the selected branch', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/day-timeline?from=${FROM}&to=${TO}`)
      .set(auth(ownerToken))
      .set('X-Branch-Id', branchId);

    expect(res.status).toBe(200);
    const { events } = (res.body as TimelineBody).data;
    expect(events.some((event) => event.amount === '777.00')).toBe(false);
    expect(events.some((event) => event.label === `${RUN}-other-branch`)).toBe(false);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.branch?.id === branchId)).toBe(true);
  });

  it('ignores audited actions outside the timeline set', async () => {
    const res = await fetchDay();
    const { events } = (res.body as TimelineBody).data;
    // An export is a real audited action and real noise at this altitude.
    expect(events.some((event) => event.kind === 'orders.exported')).toBe(false);
  });

  it('caps by dropping the oldest, not one whole source', async () => {
    const res = await fetchDay(`from=${FROM}&to=${TO}&limit=2`);
    const { events, truncated } = (res.body as TimelineBody).data;

    expect(events.length).toBeLessThanOrEqual(2);
    expect(truncated).toBe(true);
    // The newest event in the window is the evening till close.
    expect(events[0]?.kind).toBe('shift.till_closed');
  });

  it('reports truncation when one source alone exceeds the cap', async () => {
    const res = await fetchDay('from=2021-05-08&to=2021-05-08&limit=2');
    const { events, truncated } = (res.body as TimelineBody).data;

    expect(events).toHaveLength(2);
    expect(truncated).toBe(true);
    expect(events.map((event) => event.amount)).toEqual(['30.00', '20.00']);
  });

  it('refuses a role without the reports area', async () => {
    const picker = await makeUser(StaffRole.FULFILLMENT, 'picker');
    await prisma.userBranch.create({
      data: { userId: picker.id, branchId, role: StaffRole.FULFILLMENT },
    });
    const res = await request(app)
      .get(`/api/v1/reports/day-timeline?from=${FROM}&to=${TO}`)
      .set(auth(signToken(picker)))
      .set('X-Branch-Id', branchId);

    expect(res.status).toBe(403);
  });
});
