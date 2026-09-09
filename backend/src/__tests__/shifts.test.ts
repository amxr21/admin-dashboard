import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Shifts — a period of work (F6).
 *
 * ─── WHAT THESE TESTS ARE PROTECTING ─────────────────────────────────
 * A shift record is hours somebody may be paid for, so the rules that matter
 * are the ones about who may change them:
 *
 * 1. Nobody edits their own shift. The person who benefits must not be the
 *    person who approves — the same reasoning as self-promotion in
 *    `staff.service.ts`, and it holds at EVERY rank including OWNER.
 * 2. An edit keeps the ORIGINAL times and is attributed. A timesheet that can
 *    be silently rewritten is worth less as a record than one that cannot.
 * 3. The original survives a SECOND edit. Otherwise a manager could launder a
 *    correction by editing twice, and the audit trail would show the first
 *    edit's values as if they were what was clocked.
 * 4. One open shift per person — "who is on now" must not list somebody twice.
 */

const app = createApp();

interface ShiftBody {
  data: {
    shift: {
      id: string;
      startedAt: string;
      endedAt: string | null;
      originalStartedAt: string | null;
      originalEndedAt: string | null;
      wasEdited: boolean;
      editReason: string | null;
      user: { id: string };
      branch: { id: string };
      openedBy: { id: string };
    };
  };
}

const RUN = `shifts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const businessIds: string[] = [];
const orderIds: string[] = [];

let branchId = '';
let ownerToken = '';
let workerToken = '';
let managerToken = '';
let ownerId = '';
let workerId = '';

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

/** Starts a shift directly, for tests that are about editing rather than
 *  starting — keeps each test's setup to the thing it actually asserts. */
async function seedShift(userId: string, startedAt: Date, endedAt: Date | null) {
  return prisma.shift.create({
    data: { userId, branchId, openedById: userId, startedAt, endedAt },
    select: { id: true },
  });
}

beforeAll(async () => {
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessIds.push(business.id);

  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: `${RUN} Marina` },
  });
  branchId = branch.id;

  const [owner, worker, manager] = await Promise.all([
    makeUser(StaffRole.OWNER, 'owner'),
    makeUser(StaffRole.FULFILLMENT, 'worker'),
    makeUser(StaffRole.MANAGER, 'manager'),
  ]);

  ownerId = owner.id;
  workerId = worker.id;

  ownerToken = signToken(owner);
  workerToken = signToken(worker);
  managerToken = signToken(manager);
});

afterAll(async () => {
  // Payments first: their FK to the order is Cascade, but the shift FK is
  // SetNull, so an orphaned payment would survive the shift delete.
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.shift.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('clocking on and off', () => {
  it('lets any signed-in role start their own shift', async () => {
    // FULFILLMENT holds no `staff` area. Gating this would mean the people who
    // actually work shifts are the ones who cannot record them.
    const res = await request(app)
      .post('/api/v1/shifts')
      .set(auth(workerToken))
      .set('X-Branch-Id', branchId)
      .send({});

    expect(res.status).toBe(201);

    const body = res.body as ShiftBody;
    expect(body.data.shift.endedAt).toBeNull();
    expect(body.data.shift.user.id).toBe(workerId);
    // Opened by themselves, the ordinary case.
    expect(body.data.shift.openedBy.id).toBe(workerId);
  });

  it('refuses a second open shift for the same person', async () => {
    // Two open shifts would list somebody twice in "who is on now" and make
    // "how long have they been on" have no correct answer.
    const res = await request(app)
      .post('/api/v1/shifts')
      .set(auth(workerToken))
      .set('X-Branch-Id', branchId)
      .send({});

    expect(res.status).toBe(409);
  });

  it('reports my open shift back to me', async () => {
    const res = await request(app).get('/api/v1/shifts/me').set(auth(workerToken));

    expect(res.status).toBe(200);
    expect((res.body as ShiftBody).data.shift).not.toBeNull();
  });

  it('lets a manager open a shift for someone who forgot to clock in', async () => {
    const forgetful = await makeUser(StaffRole.SUPPORT, 'forgetful');

    const res = await request(app)
      .post('/api/v1/shifts')
      .set(auth(managerToken))
      .set('X-Branch-Id', branchId)
      .send({ forUserId: forgetful.id });

    expect(res.status).toBe(201);

    const body = res.body as ShiftBody;
    // `openedById` is distinct from `userId` precisely so this case is
    // legible later: it was not the worker who clocked on.
    expect(body.data.shift.user.id).toBe(forgetful.id);
    expect(body.data.shift.openedBy.id).not.toBe(forgetful.id);
  });

  it('refuses opening a shift for someone who outranks you', async () => {
    const res = await request(app)
      .post('/api/v1/shifts')
      .set(auth(managerToken))
      .set('X-Branch-Id', branchId)
      .send({ forUserId: ownerId });

    expect(res.status).toBe(403);
  });

  it('ends an open shift and reports null afterwards', async () => {
    const open = await request(app).get('/api/v1/shifts/me').set(auth(workerToken));
    const id = (open.body as ShiftBody).data.shift.id;

    const res = await request(app).post(`/api/v1/shifts/${id}/end`).set(auth(workerToken)).send({});

    expect(res.status).toBe(200);
    expect((res.body as ShiftBody).data.shift.endedAt).not.toBeNull();

    const after = await request(app).get('/api/v1/shifts/me').set(auth(workerToken));
    expect((after.body as { data: { shift: unknown } }).data.shift).toBeNull();
  });

  it('refuses ending a shift that already ended', async () => {
    const shift = await seedShift(workerId, new Date('2026-09-01T08:00:00Z'), new Date('2026-09-01T16:00:00Z'));

    const res = await request(app)
      .post(`/api/v1/shifts/${shift.id}/end`)
      .set(auth(workerToken))
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('corrections stay visible', () => {
  it('refuses editing your OWN shift, even as OWNER', async () => {
    // The person who benefits must not be the person who approves. This holds
    // at every rank — an owner correcting their own hours is exactly the case
    // an auditor would question.
    const shift = await seedShift(ownerId, new Date('2026-09-02T08:00:00Z'), new Date('2026-09-02T16:00:00Z'));

    const res = await request(app)
      .patch(`/api/v1/shifts/${shift.id}`)
      .set(auth(ownerToken))
      .send({ endedAt: '2026-09-02T18:00:00Z', reason: 'stayed late' });

    expect(res.status).toBe(403);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/your own/i);
  });

  it('keeps the original times and attributes the edit', async () => {
    const shift = await seedShift(workerId, new Date('2026-09-03T08:00:00Z'), new Date('2026-09-03T16:00:00Z'));

    const res = await request(app)
      .patch(`/api/v1/shifts/${shift.id}`)
      .set(auth(ownerToken))
      .send({ endedAt: '2026-09-03T17:30:00Z', reason: 'forgot to clock out' });

    expect(res.status).toBe(200);

    const body = res.body as ShiftBody;
    expect(body.data.shift.wasEdited).toBe(true);
    expect(body.data.shift.editReason).toBe('forgot to clock out');
    // The original is still readable — that is the whole point.
    expect(body.data.shift.originalEndedAt).toContain('2026-09-03T16:00');
    expect(body.data.shift.endedAt).toContain('2026-09-03T17:30');
  });

  it('does not let a SECOND edit overwrite the original', async () => {
    // Otherwise an edit could be laundered by editing twice: the record would
    // show the first edit's values as though they were what was clocked.
    const shift = await seedShift(workerId, new Date('2026-09-04T08:00:00Z'), new Date('2026-09-04T16:00:00Z'));

    await request(app)
      .patch(`/api/v1/shifts/${shift.id}`)
      .set(auth(ownerToken))
      .send({ endedAt: '2026-09-04T17:00:00Z', reason: 'first correction' });

    const second = await request(app)
      .patch(`/api/v1/shifts/${shift.id}`)
      .set(auth(ownerToken))
      .send({ endedAt: '2026-09-04T18:00:00Z', reason: 'second correction' });

    const body = second.body as ShiftBody;
    // Still the ORIGINAL 16:00, not the first edit's 17:00.
    expect(body.data.shift.originalEndedAt).toContain('2026-09-04T16:00');
    expect(body.data.shift.endedAt).toContain('2026-09-04T18:00');
  });

  it('requires a reason for an edit', async () => {
    const shift = await seedShift(workerId, new Date('2026-09-05T08:00:00Z'), new Date('2026-09-05T16:00:00Z'));

    const res = await request(app)
      .patch(`/api/v1/shifts/${shift.id}`)
      .set(auth(ownerToken))
      .send({ endedAt: '2026-09-05T17:00:00Z' });

    // An edited timesheet with no stated reason is what "corrections stay
    // visible" exists to prevent: it shows that hours changed and nothing why.
    expect(res.status).toBe(400);
  });

  it('refuses a shift that would end before it starts', async () => {
    const shift = await seedShift(workerId, new Date('2026-09-06T08:00:00Z'), new Date('2026-09-06T16:00:00Z'));

    const res = await request(app)
      .patch(`/api/v1/shifts/${shift.id}`)
      .set(auth(ownerToken))
      .send({ endedAt: '2026-09-06T07:00:00Z', reason: 'typo' });

    // Not a correction, a typo — and it would render as a negative duration
    // everywhere hours are summed.
    expect(res.status).toBe(400);
  });

  it('refuses an edit from someone without `staff`', async () => {
    const shift = await seedShift(workerId, new Date('2026-09-07T08:00:00Z'), new Date('2026-09-07T16:00:00Z'));

    const res = await request(app)
      .patch(`/api/v1/shifts/${shift.id}`)
      .set(auth(managerToken))
      .send({ endedAt: '2026-09-07T17:00:00Z', reason: 'nice try' });

    // MANAGER holds every area except `staff` — correcting somebody's hours is
    // a personnel act, not part of running the shop.
    expect(res.status).toBe(403);
  });
});

describe('who worked when', () => {
  it('refuses the list to a role without `staff`', async () => {
    // It names who was present and for how long: personnel data, guarded like
    // the audit trail and login history.
    const res = await request(app).get('/api/v1/shifts').set(auth(workerToken));

    expect(res.status).toBe(403);
  });

  it('lists shifts for someone with `staff`', async () => {
    const res = await request(app).get('/api/v1/shifts?pageSize=100').set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as { data: { shifts: unknown[] } }).data.shifts.length).toBeGreaterThan(0);
  });

  it('filters to who is on right now', async () => {
    const onNow = await makeUser(StaffRole.SUPPORT, 'on-now');
    const open = await seedShift(onNow.id, new Date(), null);

    const res = await request(app)
      .get('/api/v1/shifts?open=true&pageSize=100')
      .set(auth(ownerToken))
      .set('X-Branch-Id', branchId);

    const ids = (res.body as { data: { shifts: { id: string; endedAt: string | null }[] } }).data
      .shifts.map((shift) => shift.id);

    expect(ids).toContain(open.id);
    // Every row in an open-only list must actually be open.
    for (const shift of (res.body as { data: { shifts: { endedAt: string | null }[] } }).data.shifts) {
      expect(shift.endedAt).toBeNull();
    }
  });
});

describe('what happened during a shift (F6.4)', () => {
  /**
   * The summary is a query over `AuditLog`, which every write already reaches
   * — no second activity log, which would be two records of one fact free to
   * disagree.
   *
   * The risk is the BOUNDARY. `auditWhere`'s from/to are calendar dates
   * snapped to midnight; a shift is a timestamp range inside a day. Rounding
   * it would attribute the night shift's work to the morning one, and nothing
   * would look wrong — just a plausible number against the wrong name.
   */
  async function logAt(actorId: string, action: string, at: Date) {
    return prisma.auditLog.create({
      data: { action, entity: 'shifts', actorId, createdAt: at },
      select: { id: true },
    });
  }

  it('counts only what happened inside the shift window', async () => {
    const worker = await makeUser(StaffRole.SUPPORT, 'summary-window');
    const start = new Date('2026-08-01T09:00:00Z');
    const end = new Date('2026-08-01T17:00:00Z');
    const shift = await seedShift(worker.id, start, end);

    await logAt(worker.id, 'inside.one', new Date('2026-08-01T10:00:00Z'));
    await logAt(worker.id, 'inside.two', new Date('2026-08-01T16:59:00Z'));
    // One minute before the shift and one minute after — both must be out.
    await logAt(worker.id, 'before', new Date('2026-08-01T08:59:00Z'));
    await logAt(worker.id, 'after', new Date('2026-08-01T17:01:00Z'));

    const res = await request(app).get(`/api/v1/shifts/${shift.id}/summary`).set(auth(ownerToken));

    expect(res.status).toBe(200);

    const body = res.body as { data: { totalActions: number; byAction: { action: string }[] } };
    expect(body.data.totalActions).toBe(2);

    const actions = body.data.byAction.map((row) => row.action);
    expect(actions).toContain('inside.one');
    expect(actions).not.toContain('before');
    expect(actions).not.toContain('after');
  });

  it('counts only THAT person, not everyone on at the time', async () => {
    const mine = await makeUser(StaffRole.SUPPORT, 'summary-mine');
    const theirs = await makeUser(StaffRole.SUPPORT, 'summary-theirs');
    const start = new Date('2026-08-02T09:00:00Z');
    const shift = await seedShift(mine.id, start, new Date('2026-08-02T17:00:00Z'));

    await logAt(mine.id, 'mine.action', new Date('2026-08-02T10:00:00Z'));
    // Same window, different person — a colleague's work is not yours.
    await logAt(theirs.id, 'theirs.action', new Date('2026-08-02T10:00:00Z'));

    const res = await request(app).get(`/api/v1/shifts/${shift.id}/summary`).set(auth(ownerToken));

    const body = res.body as { data: { totalActions: number } };
    expect(body.data.totalActions).toBe(1);
  });

  it('summarises an OPEN shift up to now', async () => {
    // Still working, so the honest reading is "what they have done so far",
    // not an error or an empty result.
    const worker = await makeUser(StaffRole.SUPPORT, 'summary-open');
    const shift = await seedShift(worker.id, new Date(Date.now() - 60 * 60 * 1000), null);

    await logAt(worker.id, 'during.open', new Date(Date.now() - 30 * 60 * 1000));

    const res = await request(app).get(`/api/v1/shifts/${shift.id}/summary`).set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as { data: { totalActions: number } }).data.totalActions).toBe(1);
  });

  it('lets somebody read their OWN summary without `staff`', async () => {
    // "What did I do today" is a question about your own work. A cashier
    // reviewing their own shift is not reading personnel data about anybody.
    const shift = await seedShift(workerId, new Date('2026-08-03T09:00:00Z'), new Date('2026-08-03T17:00:00Z'));

    const res = await request(app).get(`/api/v1/shifts/${shift.id}/summary`).set(auth(workerToken));

    expect(res.status).toBe(200);
  });

  it("refuses someone else's summary without `staff`", async () => {
    const other = await makeUser(StaffRole.SUPPORT, 'summary-other');
    const shift = await seedShift(other.id, new Date('2026-08-04T09:00:00Z'), new Date('2026-08-04T17:00:00Z'));

    const res = await request(app).get(`/api/v1/shifts/${shift.id}/summary`).set(auth(workerToken));

    expect(res.status).toBe(403);
  });
});

describe('the till (O5.2 / O5.3)', () => {
  /**
   * "Did the drawer balance?" is the question `Payment` exists to answer, and
   * it is arithmetic over what the cashier ACTUALLY did — took 50, gave back
   * 7.50 — not over what the order said it cost.
   *
   * The rule worth protecting is that `variance` is STORED at close, never
   * recomputed on read: a refund issued next week would otherwise silently
   * rewrite what the cashier signed off tonight. Same snapshot discipline as
   * `Order.total` and `OrderItem.cost`.
   */
  async function seedOrder(total: string) {
    const order = await prisma.order.create({
      data: { orderNumber: `${RUN}-${Math.random().toString(36).slice(2, 8)}`, total },
      select: { id: true },
    });
    orderIds.push(order.id);
    return order.id;
  }

  async function pay(shiftId: string, orderId: string, amount: string, method = 'cash') {
    return prisma.payment.create({
      data: { orderId, shiftId, amount, method },
      select: { id: true },
    });
  }

  /** A shift with a drawer open, for the tests that are about closing one. */
  async function openTill(userId: string, openingFloat: string) {
    return prisma.shift.create({
      data: { userId, branchId, openedById: userId, startedAt: new Date(), openingFloat },
      select: { id: true },
    });
  }

  it('opens a shift with a float', async () => {
    const cashier = await makeUser(StaffRole.SUPPORT, 'till-open');

    const res = await request(app)
      .post('/api/v1/shifts')
      .set(auth(signToken(cashier)))
      .set('X-Branch-Id', branchId)
      .send({ openingFloat: '100.00' });

    expect(res.status).toBe(201);
    // A string, not a number — a float cannot hold 0.10 exactly.
    expect(
      (res.body as { data: { shift: { openingFloat: string | null } } }).data.shift.openingFloat,
    ).toBe('100.00');
  });

  it('leaves the till fields null on a shift with no drawer', async () => {
    // Most shifts: a picker works one and never opens a till. Null means "no
    // till", which is a different fact from a float of zero.
    const picker = await makeUser(StaffRole.FULFILLMENT, 'till-none');

    const res = await request(app)
      .post('/api/v1/shifts')
      .set(auth(signToken(picker)))
      .set('X-Branch-Id', branchId)
      .send({});

    const shift = (res.body as { data: { shift: { openingFloat: string | null } } }).data.shift;
    expect(shift.openingFloat).toBeNull();
  });

  it('reports takings by method mid-shift', async () => {
    const cashier = await makeUser(StaffRole.SUPPORT, 'till-takings');
    const shift = await seedShift(cashier.id, new Date(), null);
    const order = await seedOrder('40.00');

    await pay(shift.id, order, '25.00', 'cash');
    await pay(shift.id, order, '15.00', 'card');

    const res = await request(app).get(`/api/v1/shifts/${shift.id}/takings`).set(auth(ownerToken));

    expect(res.status).toBe(200);

    const body = res.body as { data: { byMethod: { method: string; total: string }[] } };
    const cash = body.data.byMethod.find((row) => row.method === 'cash');
    const card = body.data.byMethod.find((row) => row.method === 'card');

    expect(cash?.total).toBe('25.00');
    expect(card?.total).toBe('15.00');
  });

  it('closes the till and records the variance', async () => {
    // float 100 + cash takings 25 = 125 expected. Counted 123 → short by 2.
    const cashier = await makeUser(StaffRole.SUPPORT, 'till-close');
    const order = await seedOrder('25.00');
    const shift = await openTill(cashier.id, '100.00');

    await pay(shift.id, order, '25.00', 'cash');

    const res = await request(app)
      .post(`/api/v1/shifts/${shift.id}/close-till`)
      .set(auth(signToken(cashier)))
      .send({ closingCount: '123.00' });

    expect(res.status).toBe(200);

    const body = res.body as { data: { expected: string; counted: string; variance: string } };
    expect(body.data.expected).toBe('125.00');
    expect(body.data.counted).toBe('123.00');
    // Negative is SHORT. Not refused — the drawer is what it is, and a till
    // that rejects an inconvenient count stops being counted honestly.
    expect(body.data.variance).toBe('-2.00');

    // Closed by the same act: a till counted but left open is a state
    // somebody has to chase later.
    const after = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(after?.endedAt).not.toBeNull();
  });

  it('ignores card takings when reconciling the DRAWER', async () => {
    // Only cash is in the drawer. Counting card payments against it would
    // show a shortfall equal to the day's card sales, every single day.
    const cashier = await makeUser(StaffRole.SUPPORT, 'till-card');
    const order = await seedOrder('80.00');
    const shift = await openTill(cashier.id, '50.00');

    await pay(shift.id, order, '80.00', 'card');

    const res = await request(app)
      .post(`/api/v1/shifts/${shift.id}/close-till`)
      .set(auth(signToken(cashier)))
      .send({ closingCount: '50.00' });

    // Float back exactly, nothing missing.
    expect((res.body as { data: { variance: string } }).data.variance).toBe('0.00');
  });

  it('keeps the variance as recorded when a refund lands later', async () => {
    // THE rule this test exists for. Recomputing on read would let a refund
    // issued next week rewrite what the cashier signed off tonight.
    const cashier = await makeUser(StaffRole.SUPPORT, 'till-refund');
    const order = await seedOrder('60.00');
    const shift = await openTill(cashier.id, '0.00');

    await pay(shift.id, order, '60.00', 'cash');

    await request(app)
      .post(`/api/v1/shifts/${shift.id}/close-till`)
      .set(auth(signToken(cashier)))
      .send({ closingCount: '60.00' });

    // A refund against the same shift, after the fact — a negative amount on
    // one signed column rather than a type enum plus a magnitude.
    await pay(shift.id, order, '-10.00', 'cash');

    const after = await prisma.shift.findUnique({
      where: { id: shift.id },
      select: { variance: true },
    });

    // Still balanced, as signed off. The refund is a separate fact.
    expect(after?.variance?.toFixed(2)).toBe('0.00');
  });

  it('refuses closing a till on a shift that already ended', async () => {
    const cashier = await makeUser(StaffRole.SUPPORT, 'till-done');
    const shift = await seedShift(
      cashier.id,
      new Date('2026-08-01T08:00:00Z'),
      new Date('2026-08-01T16:00:00Z'),
    );

    const res = await request(app)
      .post(`/api/v1/shifts/${shift.id}/close-till`)
      .set(auth(signToken(cashier)))
      .send({ closingCount: '10.00' });

    expect(res.status).toBe(400);
  });

  it('refuses another person takings to someone without `staff`', async () => {
    const other = await makeUser(StaffRole.SUPPORT, 'till-other');
    const shift = await seedShift(other.id, new Date(), null);

    const res = await request(app)
      .get(`/api/v1/shifts/${shift.id}/takings`)
      .set(auth(workerToken));

    expect(res.status).toBe(403);
  });

  describe('till events — no-sale, cash drop, payout (O9 Tier 4)', () => {
    it('logs a no-sale open with no amount', async () => {
      const cashier = await makeUser(StaffRole.SUPPORT, 'event-no-sale');
      const shift = await seedShift(cashier.id, new Date(), null);

      const res = await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'NO_SALE' });

      expect(res.status).toBe(201);
      expect((res.body as { data: { event: { amount: string | null } } }).data.event.amount).toBeNull();
    });

    it('refuses a no-sale carrying an amount', async () => {
      const cashier = await makeUser(StaffRole.SUPPORT, 'event-no-sale-amt');
      const shift = await seedShift(cashier.id, new Date(), null);

      const res = await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'NO_SALE', amount: '5.00' });

      expect(res.status).toBe(400);
    });

    it('refuses a cash drop with no amount', async () => {
      const cashier = await makeUser(StaffRole.SUPPORT, 'event-drop-no-amt');
      const shift = await seedShift(cashier.id, new Date(), null);

      const res = await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'CASH_DROP' });

      expect(res.status).toBe(400);
    });

    it('refuses logging an event on someone else\'s shift', async () => {
      const owner = await makeUser(StaffRole.SUPPORT, 'event-owner');
      const other = await makeUser(StaffRole.SUPPORT, 'event-other');
      const shift = await seedShift(owner.id, new Date(), null);

      const res = await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(other)))
        .send({ type: 'NO_SALE' });

      expect(res.status).toBe(403);
    });

    it('refuses logging an event on an already-ended shift', async () => {
      const cashier = await makeUser(StaffRole.SUPPORT, 'event-ended');
      const shift = await seedShift(cashier.id, new Date(), new Date());

      const res = await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'NO_SALE' });

      expect(res.status).toBe(400);
    });

    it('reduces expected drawer cash by drops and payouts at close', async () => {
      // float 100 + cash sales 25 - drop 10 - payout 5 = 110 expected.
      // Counted 110 → balanced, where reading raw cash sales alone (125)
      // would have reported a false 15 shortage.
      const cashier = await makeUser(StaffRole.SUPPORT, 'event-variance');
      const order = await seedOrder('25.00');
      const shift = await openTill(cashier.id, '100.00');

      await pay(shift.id, order, '25.00', 'cash');

      await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'CASH_DROP', amount: '10.00' });

      await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'PAYOUT', amount: '5.00', note: 'courier tip' });

      const res = await request(app)
        .post(`/api/v1/shifts/${shift.id}/close-till`)
        .set(auth(signToken(cashier)))
        .send({ closingCount: '110.00' });

      expect(res.status).toBe(200);
      expect((res.body as { data: { variance: string } }).data.variance).toBe('0.00');
    });

    it('lists events for the shift, newest first', async () => {
      const cashier = await makeUser(StaffRole.SUPPORT, 'event-list');
      const shift = await seedShift(cashier.id, new Date(), null);

      await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'NO_SALE' });
      await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'CASH_DROP', amount: '20.00' });

      const res = await request(app)
        .get(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)));

      expect(res.status).toBe(200);
      const events = (res.body as { data: { events: { type: string }[] } }).data.events;
      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe('CASH_DROP');
    });

    it('refuses reading another person\'s events without `staff`', async () => {
      const other = await makeUser(StaffRole.SUPPORT, 'event-other-read');
      const shift = await seedShift(other.id, new Date(), null);

      const res = await request(app)
        .get(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(workerToken));

      expect(res.status).toBe(403);
    });
  });

  describe('the X/Z report (O9 Tier 4)', () => {
    it('is NOT final while the shift is still open (an X report)', async () => {
      const cashier = await makeUser(StaffRole.SUPPORT, 'report-x');
      const shift = await openTill(cashier.id, '100.00');

      const res = await request(app)
        .get(`/api/v1/shifts/${shift.id}/report`)
        .set(auth(signToken(cashier)));

      expect(res.status).toBe(200);
      expect((res.body as { data: { isFinal: boolean } }).data.isFinal).toBe(false);
    });

    it('is final once the shift has closed (a Z report)', async () => {
      const cashier = await makeUser(StaffRole.SUPPORT, 'report-z');
      const shift = await openTill(cashier.id, '100.00');

      await request(app)
        .post(`/api/v1/shifts/${shift.id}/close-till`)
        .set(auth(signToken(cashier)))
        .send({ closingCount: '100.00' });

      const res = await request(app)
        .get(`/api/v1/shifts/${shift.id}/report`)
        .set(auth(signToken(cashier)));

      expect(res.status).toBe(200);
      expect((res.body as { data: { isFinal: boolean } }).data.isFinal).toBe(true);
    });

    it('totals cash drops and payouts separately from sales', async () => {
      const cashier = await makeUser(StaffRole.SUPPORT, 'report-totals');
      const order = await seedOrder('25.00');
      const shift = await openTill(cashier.id, '100.00');

      await pay(shift.id, order, '25.00', 'cash');

      await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'CASH_DROP', amount: '10.00' });
      await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'PAYOUT', amount: '5.00' });
      await request(app)
        .post(`/api/v1/shifts/${shift.id}/events`)
        .set(auth(signToken(cashier)))
        .send({ type: 'NO_SALE' });

      const res = await request(app)
        .get(`/api/v1/shifts/${shift.id}/report`)
        .set(auth(signToken(cashier)));

      const body = res.body as {
        data: {
          cash: string;
          expectedCash: string;
          cashDropTotal: string;
          payoutTotal: string;
          noSaleCount: number;
        };
      };

      // Raw sales, untouched by the drop/payout.
      expect(body.data.cash).toBe('25.00');
      // Drops and payouts subtracted.
      expect(body.data.expectedCash).toBe('10.00');
      expect(body.data.cashDropTotal).toBe('10.00');
      expect(body.data.payoutTotal).toBe('5.00');
      expect(body.data.noSaleCount).toBe(1);
    });

    it('refuses reading another person\'s report without `staff`', async () => {
      const other = await makeUser(StaffRole.SUPPORT, 'report-other');
      const shift = await seedShift(other.id, new Date(), null);

      const res = await request(app)
        .get(`/api/v1/shifts/${shift.id}/report`)
        .set(auth(workerToken));

      expect(res.status).toBe(403);
    });
  });
});
