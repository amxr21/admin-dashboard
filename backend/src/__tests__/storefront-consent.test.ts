import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, ProductStatus, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createApiKey } from '../services/api-key.service.js';
import { signCustomerToken } from '../services/customer-auth.service.js';

/**
 * A shopper's own marketing consent: the account-page endpoint and the
 * checkout tick-boxes. The rules worth pinning are the ones that protect
 * someone else — an SMS opt-in never lifts a suppression (the phone is
 * unverified), and a guest's tick-box writes nothing.
 */

const app = createApp();
const RUN = `sfconsent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const customerIds: string[] = [];
const suppressedAddresses: string[] = [];
let ownerId = '';
let businessId = '';
let branchId = '';
let productId = '';
let storefrontKey = '';

interface ConsentBody {
  data: { email: boolean; sms: boolean };
}

async function makeCustomer(phone: string | null = null) {
  const customer = await prisma.customer.create({
    data: {
      name: `${RUN} shopper`,
      email: `${RUN}-${String(customerIds.length)}@shopper.test`,
      ...(phone ? { phone, phoneNormalized: phone.replace(/\D/g, '') } : {}),
    },
  });
  customerIds.push(customer.id);
  suppressedAddresses.push(customer.email, ...(phone ? [`+${phone.replace(/\D/g, '')}`] : []));
  return { customer, token: signCustomerToken(customer) };
}

function putMarketing(token: string, body: object) {
  return request(app)
    .put('/api/v1/public/me/marketing')
    .set('X-API-Key', storefrontKey)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function checkout(token: string | null, marketingConsent?: object, phone = '+971 50 765 4321') {
  const req = request(app)
    .post('/api/v1/public/orders')
    .set('X-API-Key', storefrontKey)
    .set('Idempotency-Key', randomUUID());
  if (token) void req.set('Authorization', `Bearer ${token}`);
  return req.send({
    branchId,
    items: [{ productId, quantity: 1 }],
    contact: { name: 'Mariam', phone },
    paymentMethod: 'cash',
    fulfillment: 'Pickup',
    ...(marketingConsent ? { marketingConsent } : {}),
  });
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `${RUN}-owner@example.test`,
      name: `${RUN} owner`,
      role: StaffRole.OWNER,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  ownerId = owner.id;
  storefrontKey = (await createApiKey(owner.id, 'Storefront test', 'Exercise consent API', 'Test suite')).key;

  const business = await prisma.business.create({
    data: { name: `${RUN} business`, branches: { create: { name: `${RUN} branch`, isDefault: true } } },
    include: { branches: true },
  });
  businessId = business.id;
  branchId = business.branches[0]!.id;

  const product = await prisma.product.create({
    data: { name: `${RUN} item`, price: new Prisma.Decimal('10.00'), stock: 50, status: ProductStatus.ACTIVE },
  });
  productId = product.id;
  await prisma.branchStock.create({ data: { productId, branchId, quantity: 50 } });
});

afterAll(async () => {
  const sold = await prisma.orderItem.findMany({ where: { productId }, select: { orderId: true } });
  const orderIds = [...new Set(sold.map((item) => item.orderId))];
  await prisma.orderNote.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.marketingSuppression.deleteMany({ where: { address: { in: suppressedAddresses } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { scope: 'storefront.checkout', actorId: ownerId } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe('account marketing preferences', () => {
  it('reports consent on /public/me', async () => {
    const { token } = await makeCustomer();
    const res = await request(app)
      .get('/api/v1/public/me')
      .set('X-API-Key', storefrontKey)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as { data: { marketing: unknown } }).data.marketing).toEqual({ email: false, sms: false });
  });

  it('opts in with evidence and lifts the verified email’s own unsubscribe', async () => {
    const { customer, token } = await makeCustomer();
    await prisma.marketingSuppression.create({
      data: { channel: 'EMAIL', address: customer.email, reason: 'UNSUBSCRIBED' },
    });

    const res = await putMarketing(token, { email: true });

    expect(res.status).toBe(200);
    expect((res.body as ConsentBody).data).toEqual({ email: true, sms: false });
    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(stored.emailConsentSource).toBe('storefront');
    expect(stored.emailConsentAt).toBeInstanceOf(Date);
    expect(await prisma.marketingSuppression.count({ where: { address: customer.email } })).toBe(0);
  });

  it('keeps a bounce suppression on opt-in', async () => {
    const { customer, token } = await makeCustomer();
    await prisma.marketingSuppression.create({
      data: { channel: 'EMAIL', address: customer.email, reason: 'BOUNCED' },
    });

    await putMarketing(token, { email: true });

    expect(await prisma.marketingSuppression.count({ where: { address: customer.email } })).toBe(1);
  });

  it('never lifts an SMS suppression, because the phone is unverified', async () => {
    const { token } = await makeCustomer('971509998877');
    await prisma.marketingSuppression.create({
      data: { channel: 'SMS', address: '+971509998877', reason: 'UNSUBSCRIBED' },
    });

    const res = await putMarketing(token, { sms: true });

    expect((res.body as ConsentBody).data.sms).toBe(true);
    expect(await prisma.marketingSuppression.count({ where: { channel: 'SMS', address: '+971509998877' } })).toBe(1);
  });

  it('opting out clears evidence and suppresses the address, like an unsubscribe link', async () => {
    const { customer, token } = await makeCustomer();
    await putMarketing(token, { email: true });

    const res = await putMarketing(token, { email: false });

    expect((res.body as ConsentBody).data.email).toBe(false);
    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(stored.emailConsentAt).toBeNull();
    expect(stored.emailConsentSource).toBeNull();
    const suppression = await prisma.marketingSuppression.findFirst({ where: { address: customer.email } });
    expect(suppression?.reason).toBe('UNSUBSCRIBED');
  });

  it('requires a signed-in shopper', async () => {
    const res = await request(app)
      .put('/api/v1/public/me/marketing')
      .set('X-API-Key', storefrontKey)
      .send({ email: true });
    expect(res.status).toBe(401);
  });

  it('rejects unknown fields', async () => {
    const { token } = await makeCustomer();
    expect((await putMarketing(token, { email: true, customerId: 'someone-else' })).status).toBe(400);
  });
});

describe('checkout tick-boxes', () => {
  it('grants consent for a signed-in shopper and adopts the checkout phone when none is on file', async () => {
    const { customer, token } = await makeCustomer();
    suppressedAddresses.push('+971507654321');

    const res = await checkout(token, { email: true, sms: true });

    expect(res.status).toBe(201);
    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(stored.emailMarketingConsent).toBe(true);
    expect(stored.smsMarketingConsent).toBe(true);
    expect(stored.smsConsentSource).toBe('checkout');
    expect(stored.phone).toBe('+971 50 765 4321');
    expect(stored.phoneNormalized).toBe('971507654321');
  });

  it('never overwrites a phone already on the profile', async () => {
    const { customer, token } = await makeCustomer('971501112233');

    await checkout(token, { sms: true });

    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(stored.phoneNormalized).toBe('971501112233');
  });

  it('accepts but ignores the boxes for a guest', async () => {
    const before = await prisma.customer.count({ where: { name: { startsWith: RUN } } });
    const res = await checkout(null, { email: true });

    expect(res.status).toBe(201);
    expect(await prisma.customer.count({ where: { name: { startsWith: RUN } } })).toBe(before);
  });

  it('refuses a withdrawal through checkout (unticked is not "no")', async () => {
    const { token } = await makeCustomer();
    expect((await checkout(token, { email: false })).status).toBe(400);
  });
});
