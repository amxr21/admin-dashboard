import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { DeliveryStaffStatus, OrderStatus, Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * The courier-facing surface (`/courier/*`) — a separate auth surface from
 * every other route. The tests that matter: a courier can only ever see and
 * touch their OWN assignment, an access code that is wrong/unknown/suspended
 * all fail identically, and the status transitions a courier may self-report
 * are the narrower list from `COURIER_TRANSITIONS`, not the full enum.
 */

const app = createApp();

interface AuthBody {
  data: { token: string; courier: { id: string; name: string } };
}
interface AssignmentsBody {
  data: { assignments: { id: string; status: string }[] };
}
interface StatusBody {
  data: { assignment: { id: string; status: string } };
}
interface ErrorBody {
  error: { code: string; message: string };
}
interface IssueCodeBody {
  data: { code: string };
}

const RUN = `couriertest2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const courierIds: string[] = [];
const orderIds: string[] = [];
let ownerToken = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

async function makeOrder() {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN}-${orderIds.length}`,
      status: OrderStatus.CONFIRMED,
      total: new Prisma.Decimal('25.00'),
    },
  });
  orderIds.push(order.id);
  return order.id;
}

/** Creates a courier, issues a real code via the staff-facing route, and
 *  hands back both the id and the plaintext code for the caller to sign in
 *  with — mirroring how a real access code is only ever readable once. */
async function makeCourierWithCode(status: DeliveryStaffStatus = DeliveryStaffStatus.ACTIVE) {
  const courier = await prisma.deliveryStaff.create({
    data: { name: `${RUN} courier ${courierIds.length}`, status },
  });
  courierIds.push(courier.id);

  const issued = await request(app)
    .post(`/api/v1/couriers/${courier.id}/access-code`)
    .set(auth(ownerToken));

  return { id: courier.id, code: (issued.body as IssueCodeBody).data.code };
}

async function assignOrder(orderId: string, driverId: string) {
  return request(app)
    .post('/api/v1/assignments')
    .set(auth(ownerToken))
    .send({ orderId, driverId });
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `${RUN}-owner@example.test`,
      name: 'Owner',
      role: StaffRole.OWNER,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(owner.id);
  ownerToken = signToken(owner);
});

afterAll(async () => {
  await prisma.deliveryAssignment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.deliveryStaff.deleteMany({ where: { id: { in: courierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('POST /courier/auth', () => {
  it('signs in with a valid code', async () => {
    const { code } = await makeCourierWithCode();

    const res = await request(app).post('/api/v1/courier/auth').send({ code });

    expect(res.status).toBe(200);
    expect((res.body as AuthBody).data.token).toBeTruthy();
  });

  it('rejects an unknown code', async () => {
    const res = await request(app).post('/api/v1/courier/auth').send({ code: 'NOPE-NOPE-NOPE' });

    expect(res.status).toBe(401);
  });

  it('rejects a suspended courier with the SAME message as an unknown code', async () => {
    // Issue the code while ACTIVE (issuing to an already-inactive courier is
    // itself refused, correctly — see `regenerateAccessCode`), then suspend
    // directly, as a status change made after the code already exists would.
    const { id, code } = await makeCourierWithCode();
    await prisma.deliveryStaff.update({
      where: { id },
      data: { status: DeliveryStaffStatus.INACTIVE },
    });

    const unknown = await request(app).post('/api/v1/courier/auth').send({ code: 'NOPE-NOPE-NOPE' });
    const suspended = await request(app).post('/api/v1/courier/auth').send({ code });

    expect(suspended.status).toBe(401);
    expect((suspended.body as ErrorBody).error.message).toBe(
      (unknown.body as ErrorBody).error.message,
    );
  });
});

describe('GET /courier/me/assignments', () => {
  it('rejects a request with no token', async () => {
    expect((await request(app).get('/api/v1/courier/me/assignments')).status).toBe(401);
  });

  it('rejects a staff token — the two auth surfaces cannot cross', async () => {
    const res = await request(app)
      .get('/api/v1/courier/me/assignments')
      .set(auth(ownerToken));

    expect(res.status).toBe(401);
  });

  it("only returns the signed-in courier's own assignments", async () => {
    const mine = await makeCourierWithCode();
    const someoneElse = await makeCourierWithCode();

    const myOrder = await makeOrder();
    const otherOrder = await makeOrder();
    await assignOrder(myOrder, mine.id);
    await assignOrder(otherOrder, someoneElse.id);

    const signIn = await request(app).post('/api/v1/courier/auth').send({ code: mine.code });
    const token = (signIn.body as AuthBody).data.token;

    const res = await request(app).get('/api/v1/courier/me/assignments').set(auth(token));

    expect(res.status).toBe(200);
    const ids = (res.body as AssignmentsBody).data.assignments.map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe('PATCH /courier/assignments/:id/status', () => {
  it('lets a courier move their own assignment through a legal transition', async () => {
    const courier = await makeCourierWithCode();
    const orderId = await makeOrder();
    const assigned = await assignOrder(orderId, courier.id);
    const assignmentId = (assigned.body as { data: { assignment: { id: string } } }).data.assignment
      .id;

    const signIn = await request(app).post('/api/v1/courier/auth').send({ code: courier.code });
    const token = (signIn.body as AuthBody).data.token;

    const res = await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'PICKED_UP' });

    expect(res.status).toBe(200);
    expect((res.body as StatusBody).data.assignment.status).toBe('PICKED_UP');
  });

  it('rejects an illegal transition (skipping straight to DELIVERED)', async () => {
    const courier = await makeCourierWithCode();
    const orderId = await makeOrder();
    const assigned = await assignOrder(orderId, courier.id);
    const assignmentId = (assigned.body as { data: { assignment: { id: string } } }).data.assignment
      .id;

    const signIn = await request(app).post('/api/v1/courier/auth').send({ code: courier.code });
    const token = (signIn.body as AuthBody).data.token;

    const res = await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'DELIVERED' });

    expect(res.status).toBe(400);
  });

  it("404s on another courier's assignment rather than leaking that it exists", async () => {
    const mine = await makeCourierWithCode();
    const someoneElse = await makeCourierWithCode();
    const otherOrder = await makeOrder();
    const assigned = await assignOrder(otherOrder, someoneElse.id);
    const assignmentId = (assigned.body as { data: { assignment: { id: string } } }).data.assignment
      .id;

    const signIn = await request(app).post('/api/v1/courier/auth').send({ code: mine.code });
    const token = (signIn.body as AuthBody).data.token;

    const res = await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'PICKED_UP' });

    expect(res.status).toBe(404);
  });

  it("writes an audit row against the ORDER, naming the courier by name (C5.4)", async () => {
    const courier = await makeCourierWithCode();
    const orderId = await makeOrder();
    const assigned = await assignOrder(orderId, courier.id);
    const assignmentId = (assigned.body as { data: { assignment: { id: string } } }).data.assignment
      .id;

    const signIn = await request(app).post('/api/v1/courier/auth').send({ code: courier.code });
    const token = (signIn.body as AuthBody).data.token;

    await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'PICKED_UP' });

    let entry: { changes: unknown; actorEmail: string | null } | null = null;
    for (let attempt = 0; attempt < 10 && !entry; attempt += 1) {
      entry = await prisma.auditLog.findFirst({
        where: { action: 'delivery.assignment.status_changed', entityId: orderId },
        orderBy: { createdAt: 'desc' },
      });
      if (!entry) await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const courierRow = await prisma.deliveryStaff.findUnique({ where: { id: courier.id } });

    expect(entry).not.toBeNull();
    // A courier has no email — its name fills that role instead.
    expect(entry?.actorEmail).toBe(courierRow?.name);
    expect(
      (entry?.changes as { deliveryStatus?: { from: string; to: string } } | null)?.deliveryStatus,
    ).toEqual({ from: 'ASSIGNED', to: 'PICKED_UP' });
  });
});

describe('reporting a failed delivery attempt', () => {
  async function courierOutForDelivery() {
    const courier = await makeCourierWithCode();
    const orderId = await makeOrder();
    const assigned = await assignOrder(orderId, courier.id);
    const assignmentId = (assigned.body as { data: { assignment: { id: string } } }).data.assignment
      .id;

    const signIn = await request(app).post('/api/v1/courier/auth').send({ code: courier.code });
    const token = (signIn.body as AuthBody).data.token;

    await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'PICKED_UP' });
    await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'OUT_FOR_DELIVERY' });

    return { assignmentId, token };
  }

  it('is re-triable: FAILED_ATTEMPT can go back to OUT_FOR_DELIVERY, not just forward', async () => {
    const { assignmentId, token } = await courierOutForDelivery();

    const failed = await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'FAILED_ATTEMPT', failureReason: 'Customer not home' });

    expect(failed.status).toBe(200);
    expect((failed.body as StatusBody).data.assignment.status).toBe('FAILED_ATTEMPT');

    const retried = await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'OUT_FOR_DELIVERY' });

    expect(retried.status).toBe(200);
    expect((retried.body as StatusBody).data.assignment.status).toBe('OUT_FOR_DELIVERY');
  });

  it('requires a reason — cannot report a failure silently', async () => {
    const { assignmentId, token } = await courierOutForDelivery();

    const res = await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'FAILED_ATTEMPT' });

    expect(res.status).toBe(400);
  });

  it('rejects a whitespace-only reason the same as a missing one', async () => {
    const { assignmentId, token } = await courierOutForDelivery();

    const res = await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'FAILED_ATTEMPT', failureReason: '   ' });

    expect(res.status).toBe(400);
  });

  it('increments attemptCount on each failure and keeps the latest reason', async () => {
    const { assignmentId, token } = await courierOutForDelivery();

    await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'FAILED_ATTEMPT', failureReason: 'Customer not home' });
    await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'OUT_FOR_DELIVERY' });
    const second = await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'FAILED_ATTEMPT', failureReason: 'Refused delivery' });

    expect(second.status).toBe(200);
    const row = await prisma.deliveryAssignment.findUnique({ where: { id: assignmentId } });
    expect(row?.attemptCount).toBe(2);
    expect(row?.failureReason).toBe('Refused delivery');
  });

  it('resets attemptCount and failureReason when the order is reassigned to a new courier', async () => {
    const { assignmentId, token } = await courierOutForDelivery();
    await request(app)
      .patch(`/api/v1/courier/assignments/${assignmentId}/status`)
      .set(auth(token))
      .send({ status: 'FAILED_ATTEMPT', failureReason: 'Customer not home' });

    const before = await prisma.deliveryAssignment.findUnique({ where: { id: assignmentId } });
    expect(before?.attemptCount).toBe(1);

    const newCourier = await makeCourierWithCode();
    const orderId = before!.orderId;
    const reassigned = await assignOrder(orderId, newCourier.id);

    expect(reassigned.status).toBe(201);
    const after = await prisma.deliveryAssignment.findUnique({ where: { id: assignmentId } });
    expect(after?.attemptCount).toBe(0);
    expect(after?.failureReason).toBeNull();
    expect(after?.status).toBe('ASSIGNED');
  });
});
