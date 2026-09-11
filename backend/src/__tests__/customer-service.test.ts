import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { CustomerDeliveryStatus, OrderStatus, Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

const sendEmailToRecipients = vi.hoisted(() => vi.fn());
vi.mock('../services/email.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/email.service.js')>()),
  sendEmailToRecipients,
}));

const app = createApp();
const RUN = `customer-service-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const userIds: string[] = [];
const customerIds: string[] = [];
const orderIds: string[] = [];
const caseIds: string[] = [];
let businessId = '';
let branchA = '';
let branchB = '';
let ownerToken = '';
let cashierToken = '';
let ownerId = '';

interface CaseBody { data: { case: { id: string; status: string; priority: string; resolvedAt: string | null; notes: { body: string }[] } } }
interface CaseListBody { data: { cases: { id: string }[] } }
interface CustomerLookupBody { data: { customers: { id: string; internalNotes?: string }[] } }
interface OrderListBody { data: { orders: { id: string }[] } }

async function createUser(role: StaffRole) {
  const user = await prisma.user.create({ data: {
    email: `${RUN}-${role.toLowerCase()}-${userIds.length}@example.test`,
    name: role, role, passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
  } });
  userIds.push(user.id);
  return user;
}

function auth(token = ownerToken) { return { Authorization: `Bearer ${token}` } as const; }

beforeAll(async () => {
  const [owner, cashier] = await Promise.all([createUser(StaffRole.OWNER), createUser(StaffRole.CASHIER)]);
  ownerId = owner.id; ownerToken = signToken(owner); cashierToken = signToken(cashier);
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessId = business.id;
  const branches = await Promise.all([
    prisma.branch.create({ data: { businessId, name: `${RUN} A` } }),
    prisma.branch.create({ data: { businessId, name: `${RUN} B` } }),
  ]);
  branchA = branches[0].id; branchB = branches[1].id;
  await prisma.userBranch.create({ data: { userId: cashier.id, branchId: branchA, role: StaffRole.CASHIER } });
});

beforeEach(() => { sendEmailToRecipients.mockReset(); sendEmailToRecipients.mockResolvedValue(true); });

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: caseIds } } });
  await prisma.customerCase.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.userBranch.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.delete({ where: { id: businessId } });
  await prisma.$disconnect();
});

async function fixture(status: OrderStatus = OrderStatus.PENDING) {
  const customer = await prisma.customer.create({ data: {
    name: `${RUN} Customer`, email: `${RUN}-${customerIds.length}@customer.test`, phone: '+971 50 123 4567', phoneNormalized: '971501234567',
  } });
  customerIds.push(customer.id);
  const order = await prisma.order.create({ data: {
    orderNumber: `${RUN}-${orderIds.length}`, total: new Prisma.Decimal('25.00'),
    status, branchId: branchA, customerId: customer.id,
    payments: { create: { amount: new Prisma.Decimal('25.00'), method: 'card', reference: `PAY-${RUN}` } },
  } });
  orderIds.push(order.id);
  return { customer, order };
}

describe('customer case workspace', () => {
  it('enforces the customers permission area and branch scope', async () => {
    expect((await request(app).get('/api/v1/customer-cases')).status).toBe(401);
    expect((await request(app).get('/api/v1/customer-cases').set(auth(cashierToken)).set('X-Branch-Id', branchA)).status).toBe(403);
  });

  it('creates a linked case, isolates it by branch, updates status, and appends notes', async () => {
    const { customer, order } = await fixture();
    const created = await request(app).post('/api/v1/customer-cases').set(auth()).set('X-Branch-Id', branchA).send({
      title: `${RUN} damaged delivery`, priority: 'HIGH', customerId: customer.id,
      orderId: order.id, assignedToId: ownerId,
    });
    expect(created.status).toBe(201);
    const createdBody = created.body as CaseBody;
    const id = createdBody.data.case.id; caseIds.push(id);
    expect(createdBody.data.case).toEqual(expect.objectContaining({ status: 'OPEN', priority: 'HIGH' }));

    const atA = await request(app).get(`/api/v1/customer-cases?search=${encodeURIComponent(RUN)}`).set(auth()).set('X-Branch-Id', branchA);
    const atB = await request(app).get(`/api/v1/customer-cases?search=${encodeURIComponent(RUN)}`).set(auth()).set('X-Branch-Id', branchB);
    expect((atA.body as CaseListBody).data.cases).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    expect((atB.body as CaseListBody).data.cases).toEqual([]);

    const noted = await request(app).post(`/api/v1/customer-cases/${id}/notes`).set(auth()).set('X-Branch-Id', branchA).send({ body: 'Customer requested a replacement.' });
    expect(noted.status).toBe(201);
    expect((noted.body as CaseBody).data.case.notes).toEqual([expect.objectContaining({ body: 'Customer requested a replacement.' })]);

    const resolved = await request(app).patch(`/api/v1/customer-cases/${id}`).set(auth()).set('X-Branch-Id', branchA).send({ status: 'RESOLVED' });
    expect((resolved.body as CaseBody).data.case).toEqual(expect.objectContaining({ status: 'RESOLVED', resolvedAt: expect.any(String) as string }));
  });
});

describe('cashier customer association and order discovery', () => {
  it('lets a cashier find minimal customer identity without customer-management access', async () => {
    const { customer } = await fixture();
    const response = await request(app).get(`/api/v1/pos/customers?q=${encodeURIComponent(RUN)}`).set(auth(cashierToken)).set('X-Branch-Id', branchA);
    expect(response.status).toBe(200);
    const body = response.body as CustomerLookupBody;
    expect(body.data.customers).toEqual(expect.arrayContaining([expect.objectContaining({ id: customer.id })]));
    expect(body.data.customers[0]).not.toHaveProperty('internalNotes');
  });

  it('finds orders by customer phone and payment reference', async () => {
    const { order } = await fixture();
    const byPhone = await request(app).get('/api/v1/orders?search=971501234567').set(auth());
    const byPayment = await request(app).get(`/api/v1/orders?search=${encodeURIComponent(`PAY-${RUN}`)}`).set(auth());
    expect((byPhone.body as OrderListBody).data.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: order.id })]));
    expect((byPayment.body as OrderListBody).data.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: order.id })]));
  });
});

describe('customer order status delivery', () => {
  it('records a successful delivery outcome without storing the message body', async () => {
    const { order, customer } = await fixture();
    const response = await request(app).patch(`/api/v1/orders/${order.id}/status`).set(auth()).send({ to: 'CONFIRMED' });
    expect(response.status).toBe(200);
    expect(sendEmailToRecipients).toHaveBeenCalledWith([customer.email], expect.stringContaining(order.orderNumber), expect.stringContaining(order.orderNumber));
    const delivery = await prisma.customerOrderNotification.findFirstOrThrow({ where: { orderId: order.id } });
    expect(delivery).toEqual(expect.objectContaining({ deliveryStatus: CustomerDeliveryStatus.SENT, failureCode: null }));
    expect(delivery).not.toHaveProperty('body');
  });

  it('keeps the order transition successful when delivery is unavailable', async () => {
    sendEmailToRecipients.mockResolvedValue(false);
    const { order } = await fixture();
    const response = await request(app).patch(`/api/v1/orders/${order.id}/status`).set(auth()).send({ to: 'CONFIRMED' });
    expect(response.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.CONFIRMED);
    expect(await prisma.customerOrderNotification.findFirst({ where: { orderId: order.id, deliveryStatus: CustomerDeliveryStatus.FAILED } })).not.toBeNull();
  });
});
