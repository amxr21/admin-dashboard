import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import {
  DeliveryStaffStatus,
  DeliveryStatus,
  OrderStatus,
  Prisma,
  StaffRole,
} from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { courierForCode } from '../services/couriers.service.js';

/**
 * Couriers, access codes and assignments.
 *
 * The access code is a PASSWORD for a portal that shows real customer names,
 * addresses and phone numbers. So the tests that matter are the ones proving
 * it is never stored, never returned twice, and never distinguishes "wrong
 * code" from "suspended courier".
 */

const app = createApp();

interface CodeBody {
  data: { code: string; courier: { id: string } };
}
interface ListBody {
  data: { couriers: { id: string; hasAccessCode: boolean }[]; total: number };
}
interface AssignBody {
  data: { assignment: { id: string; status: string; driver: { id: string } } };
}
interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const RUN = `couriertest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const courierIds: string[] = [];
const orderIds: string[] = [];
let ownerToken = '';
let demoToken = '';
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

async function makeCourier(status: DeliveryStaffStatus = DeliveryStaffStatus.ACTIVE) {
  const courier = await prisma.deliveryStaff.create({
    data: { name: `${RUN} courier ${courierIds.length}`, status },
  });
  courierIds.push(courier.id);
  return courier.id;
}

async function makeOrder(status: OrderStatus = OrderStatus.CONFIRMED) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN}-${orderIds.length}`,
      status,
      total: new Prisma.Decimal('25.00'),
    },
  });
  orderIds.push(order.id);
  return order.id;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

function issueCode(courierId: string, token = ownerToken) {
  return request(app).post(`/api/v1/couriers/${courierId}/access-code`).set(auth(token));
}

beforeAll(async () => {
  [ownerToken, demoToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.DEMO),
    // SUPPORT has orders/customers/reviews but NOT delivery.
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterAll(async () => {
  await prisma.deliveryAssignment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.deliveryStaff.deleteMany({ where: { id: { in: courierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('authorisation', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await request(app).get('/api/v1/couriers')).status).toBe(401);
  });

  it('denies a role without the delivery area', async () => {
    const res = await request(app).get('/api/v1/couriers').set(auth(supportToken));
    expect(res.status).toBe(403);
  });

  it('blocks the read-only demo role from issuing a code', async () => {
    const id = await makeCourier();

    expect((await issueCode(id, demoToken)).status).toBe(403);

    const after = await prisma.deliveryStaff.findUnique({ where: { id } });
    expect(after?.accessCodeHash).toBeNull();
  });
});

describe('the engine cannot reach couriers', () => {
  it('404s /r/couriers', async () => {
    // They carry a credential, so they are deliberately absent from
    // admin.config.ts — the same reason `users` is.
    const res = await request(app).get('/api/v1/r/couriers').set(auth(ownerToken));
    expect(res.status).toBe(404);
  });
});

describe('the access code is a credential', () => {
  it('is returned exactly once, when issued', async () => {
    const id = await makeCourier();

    const issued = await issueCode(id);
    expect(issued.status).toBe(201);

    const code = (issued.body as CodeBody).data.code;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Nothing reads it back, because nothing stores it.
    const fetched = await request(app).get(`/api/v1/couriers/${id}`).set(auth(ownerToken));
    expect(JSON.stringify(fetched.body)).not.toContain(code);
  });

  it('is never stored in plain text', async () => {
    const id = await makeCourier();
    const code = (await issueCode(id).then((r) => r.body as CodeBody)).data.code;

    const row = await prisma.deliveryStaff.findUnique({ where: { id } });

    expect(row?.accessCodeHash).not.toBeNull();
    expect(row?.accessCodeHash).not.toContain(code.replace(/-/g, ''));
    // A keyed HMAC-SHA256, hex encoded.
    expect(row?.accessCodeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never appears in a list or detail response', async () => {
    const id = await makeCourier();
    await issueCode(id);

    const list = await request(app)
      .get(`/api/v1/couriers?search=${RUN}&pageSize=100`)
      .set(auth(ownerToken));

    expect(JSON.stringify(list.body)).not.toContain('accessCodeHash');
    // Whether one EXISTS is not secret — the code is.
    expect((list.body as ListBody).data.couriers.some((c) => c.hasAccessCode)).toBe(true);
  });

  it('invalidates the previous code when reissued', async () => {
    const id = await makeCourier();
    const first = (await issueCode(id).then((r) => r.body as CodeBody)).data.code;
    const second = (await issueCode(id).then((r) => r.body as CodeBody)).data.code;

    expect(second).not.toBe(first);
    expect(await courierForCode(first)).toBeNull();
    expect(await courierForCode(second)).toMatchObject({ id });
  });

  it('accepts the code regardless of case or dashes', async () => {
    // It gets read down a phone and typed by someone holding a parcel.
    const id = await makeCourier();
    const code = (await issueCode(id).then((r) => r.body as CodeBody)).data.code;

    expect(await courierForCode(code.toLowerCase().replace(/-/g, ''))).toMatchObject({ id });
  });

  it('refuses to issue one to a deactivated courier', async () => {
    // Otherwise access outlives employment.
    const id = await makeCourier(DeliveryStaffStatus.INACTIVE);

    const res = await issueCode(id);

    expect(res.status).toBe(400);
    expect((await prisma.deliveryStaff.findUnique({ where: { id } }))?.accessCodeHash).toBeNull();
  });

  it('stops working the moment the courier is deactivated', async () => {
    const id = await makeCourier();
    const code = (await issueCode(id).then((r) => r.body as CodeBody)).data.code;

    expect(await courierForCode(code)).toMatchObject({ id });

    await prisma.deliveryStaff.update({
      where: { id },
      data: { status: DeliveryStaffStatus.INACTIVE },
    });

    // Null, not an error naming the reason — see below.
    expect(await courierForCode(code)).toBeNull();
  });

  it('cannot tell an unknown code from a suspended courier', async () => {
    /**
     * Both return null. Distinguishing them would be an enumeration oracle:
     * an attacker could confirm which codes are real by the different answer.
     */
    const suspended = await makeCourier();
    const code = (await issueCode(suspended).then((r) => r.body as CodeBody)).data.code;
    await prisma.deliveryStaff.update({
      where: { id: suspended },
      data: { status: DeliveryStaffStatus.INACTIVE },
    });

    expect(await courierForCode(code)).toBeNull();
    expect(await courierForCode('ZZZZ-ZZZZ-ZZZZ')).toBeNull();
  });

  it('can be revoked without deleting the courier', async () => {
    const id = await makeCourier();
    const code = (await issueCode(id).then((r) => r.body as CodeBody)).data.code;

    const res = await request(app)
      .delete(`/api/v1/couriers/${id}/access-code`)
      .set(auth(ownerToken));

    expect(res.status).toBe(204);
    expect(await courierForCode(code)).toBeNull();
    expect(await prisma.deliveryStaff.findUnique({ where: { id } })).not.toBeNull();
  });
});

describe('assignments', () => {
  it('gives an order to a courier', async () => {
    const [orderId, driverId] = [await makeOrder(), await makeCourier()];

    const res = await request(app)
      .post('/api/v1/assignments')
      .set(auth(ownerToken))
      .send({ orderId, driverId, address: '12 Test Street', city: 'Dubai' });

    expect(res.status).toBe(201);
    expect((res.body as AssignBody).data.assignment.status).toBe(DeliveryStatus.ASSIGNED);
  });

  it('reassigns in place rather than creating a second assignment', async () => {
    // Two couriers holding the same parcel is a real-world failure.
    const orderId = await makeOrder();
    const first = await makeCourier();
    const second = await makeCourier();

    await request(app)
      .post('/api/v1/assignments')
      .set(auth(ownerToken))
      .send({ orderId, driverId: first });

    const res = await request(app)
      .post('/api/v1/assignments')
      .set(auth(ownerToken))
      .send({ orderId, driverId: second });

    expect(res.status).toBe(201);
    expect((res.body as AssignBody).data.assignment.driver.id).toBe(second);
    expect(await prisma.deliveryAssignment.count({ where: { orderId } })).toBe(1);
  });

  it('restarts the delivery when reassigned', async () => {
    // The new courier has not picked anything up.
    const orderId = await makeOrder();
    const first = await makeCourier();

    const created = await request(app)
      .post('/api/v1/assignments')
      .set(auth(ownerToken))
      .send({ orderId, driverId: first });

    await prisma.deliveryAssignment.update({
      where: { id: (created.body as AssignBody).data.assignment.id },
      data: { status: DeliveryStatus.OUT_FOR_DELIVERY },
    });

    const res = await request(app)
      .post('/api/v1/assignments')
      .set(auth(ownerToken))
      .send({ orderId, driverId: await makeCourier() });

    expect((res.body as AssignBody).data.assignment.status).toBe(DeliveryStatus.ASSIGNED);
  });

  it('refuses an inactive courier', async () => {
    const res = await request(app)
      .post('/api/v1/assignments')
      .set(auth(ownerToken))
      .send({
        orderId: await makeOrder(),
        driverId: await makeCourier(DeliveryStaffStatus.INACTIVE),
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details).toMatchObject({ field: 'driverId' });
  });

  it('refuses an order that needs no delivery', async () => {
    for (const status of [OrderStatus.DELIVERED, OrderStatus.CANCELED, OrderStatus.RETURNED]) {
      const res = await request(app)
        .post('/api/v1/assignments')
        .set(auth(ownerToken))
        .send({ orderId: await makeOrder(status), driverId: await makeCourier() });

      expect(res.status).toBe(400);
    }
  });

  it('will not delete a completed delivery', async () => {
    // That would erase the record that it happened.
    const orderId = await makeOrder();
    const created = await request(app)
      .post('/api/v1/assignments')
      .set(auth(ownerToken))
      .send({ orderId, driverId: await makeCourier() });

    const id = (created.body as AssignBody).data.assignment.id;
    await prisma.deliveryAssignment.update({
      where: { id },
      data: { status: DeliveryStatus.DELIVERED },
    });

    const res = await request(app).delete(`/api/v1/assignments/${id}`).set(auth(ownerToken));

    expect(res.status).toBe(400);
    expect(await prisma.deliveryAssignment.findUnique({ where: { id } })).not.toBeNull();
  });
});

/**
 * B4.1 — a wrong delivery address could previously only be fixed by
 * reassigning (`POST /assignments`), which also resets `status` back to
 * ASSIGNED even though the same courier keeps the job. This route is the
 * one place address/city/note can be corrected without that side effect.
 */
describe('PATCH /assignments/:id', () => {
  async function makeAssignment(driverId?: string) {
    const orderId = await makeOrder();
    const created = await request(app)
      .post('/api/v1/assignments')
      .set(auth(ownerToken))
      .send({ orderId, driverId: driverId ?? (await makeCourier()), address: 'Original St' });
    return (created.body as AssignBody).data.assignment.id;
  }

  it('corrects the address without touching status or driver', async () => {
    const driverId = await makeCourier();
    const id = await makeAssignment(driverId);

    await prisma.deliveryAssignment.update({
      where: { id },
      data: { status: DeliveryStatus.PICKED_UP },
    });

    const res = await request(app)
      .patch(`/api/v1/assignments/${id}`)
      .set(auth(ownerToken))
      .send({ address: 'Corrected St' });

    expect(res.status).toBe(200);
    const row = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id } });
    expect(row.address).toBe('Corrected St');
    // The whole point: status must NOT have reset to ASSIGNED.
    expect(row.status).toBe(DeliveryStatus.PICKED_UP);
    expect(row.driverId).toBe(driverId);
  });

  it('rejects an empty body', async () => {
    const id = await makeAssignment();
    const res = await request(app).patch(`/api/v1/assignments/${id}`).set(auth(ownerToken)).send({});
    expect(res.status).toBe(400);
  });

  it('404s an unknown assignment', async () => {
    const res = await request(app)
      .patch('/api/v1/assignments/nope')
      .set(auth(ownerToken))
      .send({ address: 'x' });
    expect(res.status).toBe(404);
  });

  it('refuses to edit a completed delivery', async () => {
    const id = await makeAssignment();
    await prisma.deliveryAssignment.update({
      where: { id },
      data: { status: DeliveryStatus.DELIVERED },
    });

    const res = await request(app)
      .patch(`/api/v1/assignments/${id}`)
      .set(auth(ownerToken))
      .send({ address: 'Too late St' });

    expect(res.status).toBe(400);
  });

  it('denies a role without the delivery area', async () => {
    const id = await makeAssignment();
    const res = await request(app)
      .patch(`/api/v1/assignments/${id}`)
      .set(auth(supportToken))
      .send({ address: 'x' });
    expect(res.status).toBe(403);
  });
});

describe("the gap group B documented, now closed", () => {
  it('stops the courier when the order is cancelled', async () => {
    /**
     * DeliveryStatus had no cancelled member, so a cancelled order left its
     * courier holding a live job. The enum now has one, and the order status
     * change propagates to it in the same transaction.
     */
    const orderId = await makeOrder(OrderStatus.PENDING);
    await request(app)
      .post('/api/v1/assignments')
      .set(auth(ownerToken))
      .send({ orderId, driverId: await makeCourier() });

    await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set(auth(ownerToken))
      .send({ to: OrderStatus.CANCELED });

    const assignment = await prisma.deliveryAssignment.findUnique({ where: { orderId } });
    expect(assignment?.status).toBe(DeliveryStatus.CANCELED);
  });
});

describe('courier records', () => {
  it('requires a name', async () => {
    const res = await request(app)
      .post('/api/v1/couriers')
      .set(auth(ownerToken))
      .send({ phone: '+971500000000' });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown field', async () => {
    // .strict() — accepting extras silently is how mass assignment creeps in.
    const res = await request(app)
      .post('/api/v1/couriers')
      .set(auth(ownerToken))
      .send({ name: `${RUN} x`, accessCodeHash: 'deadbeef' });

    expect(res.status).toBe(400);
  });

  it('404s an unknown courier', async () => {
    expect(
      (await request(app).get('/api/v1/couriers/nope').set(auth(ownerToken))).status,
    ).toBe(404);
  });
});

describe('updating a courier writes an audit row (C5.3)', () => {
  it('records a field-level diff for a real change', async () => {
    const id = await makeCourier();

    const res = await request(app)
      .patch(`/api/v1/couriers/${id}`)
      .set(auth(ownerToken))
      .send({ zone: 'Marina' });

    expect(res.status).toBe(200);

    let entry: { changes: unknown; entity: string; entityId: string | null } | null = null;
    for (let attempt = 0; attempt < 10 && !entry; attempt += 1) {
      entry = await prisma.auditLog.findFirst({
        where: { action: 'courier.updated', entityId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (!entry) await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(entry).not.toBeNull();
    expect(entry?.entity).toBe('couriers');
    expect((entry?.changes as { zone?: { from: unknown; to: unknown } } | null)?.zone).toEqual({
      from: null,
      to: 'Marina',
    });
  });

  it('writes nothing when the request changes nothing', async () => {
    const id = await makeCourier();
    // Prime the field so the second write below is a true no-op, not a
    // first-time set from null.
    await request(app).patch(`/api/v1/couriers/${id}`).set(auth(ownerToken)).send({ zone: 'Marina' });

    await request(app).patch(`/api/v1/couriers/${id}`).set(auth(ownerToken)).send({ zone: 'Marina' });

    const entries = await prisma.auditLog.findMany({
      where: { action: 'courier.updated', entityId: id },
    });
    // Exactly one — from the priming write, not two.
    expect(entries).toHaveLength(1);
  });
});
