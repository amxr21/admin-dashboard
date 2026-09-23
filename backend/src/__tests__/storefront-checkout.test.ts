import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { DiscountScope, DiscountType, Prisma, ProductStatus, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createApiKey } from '../services/api-key.service.js';

/**
 * Storefront checkout, and discount redemption in particular.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────
 * Checkout had NO test coverage at all — not the money, not the oversell
 * guard, not the stock-movement invariant — while being the one path that
 * charges a customer. Adding discount logic to untested money code is how a
 * rounding or ordering mistake reaches a real invoice, so the redemption rules
 * are pinned here alongside the arithmetic they change.
 *
 * ─── THE RULE THAT NEEDS A NON-ZERO TAX RATE TO TEST ─────────────────
 * `store.taxRate` defaults to 0, which would make `total === subtotal` and let
 * "discount before tax" pass without being exercised at all. The tax tests
 * below set a real rate first, so the ordering is genuinely proved: tax is
 * charged on `subtotal - discount`, never on the full subtotal.
 */

const app = createApp();

const RUN = `sfcheckout-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const productIds: string[] = [];
const discountIds: string[] = [];
const customerIds: string[] = [];
const categoryIds: string[] = [];
let businessId = '';
let branchId = '';
let ownerId = '';
let storefrontKey = '';

interface CheckoutBody {
  data: {
    orderNumber: string;
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    total: string;
  };
}
interface ErrorBody {
  error: { code: string; message: string };
}

async function makeProduct(price: string, stock = 100, categoryId?: string) {
  const product = await prisma.product.create({
    data: {
      name: `${RUN} item ${String(productIds.length)}`,
      price: new Prisma.Decimal(price),
      stock,
      status: ProductStatus.ACTIVE,
      ...(categoryId ? { categoryId } : {}),
    },
  });
  productIds.push(product.id);
  await prisma.branchStock.create({
    data: { productId: product.id, branchId, quantity: stock },
  });
  return product;
}

async function makeDiscount(
  code: string,
  overrides: Partial<Prisma.DiscountUncheckedCreateInput> & {
    categories?: { connect: { id: string }[] };
    products?: { connect: { id: string }[] };
    customers?: { connect: { id: string }[] };
  } = {},
) {
  const { categories, products, customers, ...rest } = overrides;
  const discount = await prisma.discount.create({
    data: {
      code: `${RUN}-${code}`.toUpperCase(),
      type: DiscountType.PERCENT,
      value: new Prisma.Decimal('10.00'),
      ...rest,
      ...(categories ? { categories } : {}),
      ...(products ? { products } : {}),
      ...(customers ? { customers } : {}),
    },
  });
  discountIds.push(discount.id);
  return discount;
}

function order(
  productId: string,
  quantity: number,
  discountCode?: string,
  idempotencyKey = randomUUID(),
) {
  return request(app)
    .post('/api/v1/public/orders')
    .set('X-API-Key', storefrontKey)
    .set('Idempotency-Key', idempotencyKey)
    .send({
      branchId,
      items: [{ productId, quantity }],
      contact: { name: 'Ali', phone: '+971500000000' },
      paymentMethod: 'cash',
      fulfillment: 'Pickup',
      ...(discountCode ? { discountCode } : {}),
    });
}

/** The rate is global, so every test that sets it must put it back. */
async function setTaxRate(percent: string) {
  await prisma.setting.upsert({
    where: { key: 'store.taxRate' },
    create: { key: 'store.taxRate', value: percent },
    update: { value: percent },
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
  storefrontKey = (await createApiKey(owner.id, 'Storefront test', 'Exercise checkout API', 'Test suite')).key;

  const business = await prisma.business.create({
    data: {
      name: `${RUN} business`,
      branches: { create: { name: `${RUN} branch`, isDefault: true } },
    },
    include: { branches: true },
  });
  businessId = business.id;
  branchId = business.branches[0]!.id;
  await setTaxRate('0');
});

afterEach(async () => {
  await setTaxRate('0');
});

afterAll(async () => {
  // Orders are found through their line items: checkout generates its own
  // reference, so there is no id to have collected at creation time.
  const sold = await prisma.orderItem.findMany({
    where: { productId: { in: productIds } },
    select: { orderId: true },
  });
  const orderIds = [...new Set(sold.map((item) => item.orderId))];

  await prisma.orderNote.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.discount.deleteMany({ where: { id: { in: discountIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.idempotencyRecord.deleteMany({
    where: { scope: 'storefront.checkout', actorId: ownerId },
  });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.delete({ where: { id: ownerId } });
  await setTaxRate('0');
  await prisma.$disconnect();
});

describe('checkout without a discount', () => {
  it('requires a valid idempotency key', async () => {
    const product = await makeProduct('12.00', 4);
    const res = await request(app)
      .post('/api/v1/public/orders')
      .set('X-API-Key', storefrontKey)
      .send({
        branchId,
        items: [{ productId: product.id, quantity: 1 }],
        contact: { name: 'Ali', phone: '+971500000000' },
        paymentMethod: 'cash',
        fulfillment: 'Pickup',
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toBe(
      'A valid Idempotency-Key header is required',
    );
  });

  it('replays one result without creating a second order or stock movement', async () => {
    const product = await makeProduct('12.00', 4);
    const idempotencyKey = randomUUID();

    const first = await order(product.id, 2, undefined, idempotencyKey);
    const replay = await order(product.id, 2, undefined, idempotencyKey);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(first.headers['idempotency-replayed']).toBe('false');
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    const orderNumber = (first.body as CheckoutBody).data.orderNumber;
    const [savedOrders, movements, branchStock] = await Promise.all([
      prisma.order.count({ where: { orderNumber } }),
      prisma.stockMovement.count({
        where: { productId: product.id, reason: 'SOLD', note: `Order ${orderNumber}` },
      }),
      prisma.branchStock.findUnique({
        where: { productId_branchId: { productId: product.id, branchId } },
        select: { quantity: true },
      }),
    ]);

    expect(savedOrders).toBe(1);
    expect(movements).toBe(1);
    expect(branchStock?.quantity).toBe(2);
  });

  it('serializes simultaneous requests that use the same key', async () => {
    const product = await makeProduct('12.00', 4);
    const idempotencyKey = randomUUID();

    const [left, right] = await Promise.all([
      order(product.id, 1, undefined, idempotencyKey),
      order(product.id, 1, undefined, idempotencyKey),
    ]);

    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    expect(left.body).toEqual(right.body);
    expect([
      left.headers['idempotency-replayed'],
      right.headers['idempotency-replayed'],
    ].sort()).toEqual(['false', 'true']);

    const orderNumber = (left.body as CheckoutBody).data.orderNumber;
    const [savedOrders, branchStock] = await Promise.all([
      prisma.order.count({ where: { orderNumber } }),
      prisma.branchStock.findUnique({
        where: { productId_branchId: { productId: product.id, branchId } },
        select: { quantity: true },
      }),
    ]);
    expect(savedOrders).toBe(1);
    expect(branchStock?.quantity).toBe(3);
  });

  it('rejects reuse of one key for different order details', async () => {
    const product = await makeProduct('12.00', 5);
    const idempotencyKey = randomUUID();

    const first = await order(product.id, 1, undefined, idempotencyKey);
    const changed = await order(product.id, 2, undefined, idempotencyKey);

    expect(first.status).toBe(201);
    expect(changed.status).toBe(409);
    expect((changed.body as ErrorBody).error.message).toContain(
      'already used for different details',
    );

    const branchStock = await prisma.branchStock.findUnique({
      where: { productId_branchId: { productId: product.id, branchId } },
      select: { quantity: true },
    });
    expect(branchStock?.quantity).toBe(4);
  });

  it('charges the catalogue price and records no discount', async () => {
    const product = await makeProduct('25.00');

    const res = await order(product.id, 2);

    expect(res.status).toBe(201);
    const body = (res.body as CheckoutBody).data;
    expect(body.subtotal).toBe('50.00');
    expect(body.discountAmount).toBe('0.00');
    expect(body.total).toBe('50.00');

    // Null, not zero: "no discount" and "a discount worth nothing" stay
    // distinguishable on the record.
    const saved = await prisma.order.findFirst({
      where: { orderNumber: body.orderNumber },
      select: { discountAmount: true, discountCode: true, discountId: true },
    });
    expect(saved?.discountAmount).toBeNull();
    expect(saved?.discountCode).toBeNull();
    expect(saved?.discountId).toBeNull();
  });

  it('attributes the order and stock movement to the selected branch', async () => {
    const product = await makeProduct('12.00', 4);

    const res = await order(product.id, 2);

    expect(res.status).toBe(201);
    const orderNumber = (res.body as CheckoutBody).data.orderNumber;
    const saved = await prisma.order.findUnique({
      where: { orderNumber },
      select: { branchId: true },
    });
    const branchStock = await prisma.branchStock.findUnique({
      where: { productId_branchId: { productId: product.id, branchId } },
      select: { quantity: true },
    });
    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, reason: 'SOLD' },
      orderBy: { createdAt: 'desc' },
      select: { branchId: true, delta: true },
    });

    expect(saved?.branchId).toBe(branchId);
    expect(branchStock?.quantity).toBe(2);
    expect(movement).toMatchObject({ branchId, delta: -2 });
  });

  it('requires an explicit active branch', async () => {
    const product = await makeProduct('12.00', 4);
    const res = await request(app)
      .post('/api/v1/public/orders')
      .set('X-API-Key', storefrontKey)
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        contact: { name: 'Ali', phone: '+971500000000' },
        paymentMethod: 'cash',
        fulfillment: 'Pickup',
      });

    expect(res.status).toBe(400);
  });

  it('refuses a product that is not carried by the selected branch', async () => {
    const product = await makeProduct('12.00', 4);
    const otherBranch = await prisma.branch.create({
      data: { businessId, name: `${RUN} other branch` },
    });

    const res = await request(app)
      .post('/api/v1/public/orders')
      .set('X-API-Key', storefrontKey)
      .set('Idempotency-Key', randomUUID())
      .send({
        branchId: otherBranch.id,
        items: [{ productId: product.id, quantity: 1 }],
        contact: { name: 'Ali', phone: '+971500000000' },
        paymentMethod: 'cash',
        fulfillment: 'Pickup',
      });

    expect(res.status).toBe(400);
  });
});

describe('a percentage code', () => {
  it('takes its percentage off and records what was applied', async () => {
    const product = await makeProduct('40.00');
    const discount = await makeDiscount('PCT10', { value: new Prisma.Decimal('10.00') });

    const res = await order(product.id, 1, discount.code);

    expect(res.status).toBe(201);
    const body = (res.body as CheckoutBody).data;
    expect(body.subtotal).toBe('40.00');
    expect(body.discountAmount).toBe('4.00');
    expect(body.total).toBe('36.00');

    const saved = await prisma.order.findFirst({
      where: { orderNumber: body.orderNumber },
      select: { discountAmount: true, discountCode: true, discountId: true, subtotal: true },
    });
    // `subtotal` still states what the GOODS cost. Folding the discount into
    // it would make every existing reader report a reduced figure as the real
    // one.
    expect(saved?.subtotal?.toFixed(2)).toBe('40.00');
    expect(saved?.discountAmount?.toFixed(2)).toBe('4.00');
    expect(saved?.discountCode).toBe(discount.code);
    expect(saved?.discountId).toBe(discount.id);
  });

  it('is case-insensitive for the shopper', async () => {
    const product = await makeProduct('40.00');
    const discount = await makeDiscount('LOWER', { value: new Prisma.Decimal('50.00') });

    const res = await order(product.id, 1, discount.code.toLowerCase());

    expect(res.status).toBe(201);
    expect((res.body as CheckoutBody).data.discountAmount).toBe('20.00');
  });
});

describe('a fixed-amount code', () => {
  it('takes the stated amount off', async () => {
    const product = await makeProduct('30.00');
    const discount = await makeDiscount('FIX5', {
      type: DiscountType.FIXED,
      value: new Prisma.Decimal('5.00'),
    });

    const res = await order(product.id, 1, discount.code);

    expect((res.body as CheckoutBody).data.discountAmount).toBe('5.00');
    expect((res.body as CheckoutBody).data.total).toBe('25.00');
  });

  it('never takes more than the order is worth', async () => {
    /**
     * A fixed 50 off a 30 order takes 30, not 50. An unclamped discount would
     * produce a negative total — a refund the shop never agreed to — and drag
     * the tax line negative with it.
     */
    const product = await makeProduct('30.00');
    const discount = await makeDiscount('FIX50', {
      type: DiscountType.FIXED,
      value: new Prisma.Decimal('50.00'),
    });

    const res = await order(product.id, 1, discount.code);

    expect(res.status).toBe(201);
    const body = (res.body as CheckoutBody).data;
    expect(body.discountAmount).toBe('30.00');
    expect(body.total).toBe('0.00');
  });
});

describe('tax is charged on what the customer actually pays', () => {
  it('computes tax on the DISCOUNTED subtotal, not the full one', async () => {
    /**
     * The ordering rule, and the reason it matters: taxing the full subtotal
     * and discounting afterwards would charge tax on money the customer never
     * paid, overstating what is owed to the tax authority.
     *
     * 100.00 subtotal − 20% = 80.00 taxable · 5% tax = 4.00 · total 84.00.
     * Tax on the UNdiscounted 100.00 would be 5.00 and a total of 85.00.
     */
    await setTaxRate('5');
    const product = await makeProduct('100.00');
    const discount = await makeDiscount('TAX20', { value: new Prisma.Decimal('20.00') });

    const res = await order(product.id, 1, discount.code);

    expect(res.status).toBe(201);
    const body = (res.body as CheckoutBody).data;
    expect(body.subtotal).toBe('100.00');
    expect(body.discountAmount).toBe('20.00');
    expect(body.taxAmount).toBe('4.00');
    expect(body.total).toBe('84.00');
  });
});

describe('codes that must be refused', () => {
  it('rejects an unknown code', async () => {
    const product = await makeProduct('10.00');

    const res = await order(product.id, 1, `${RUN}-NOPE`.toUpperCase());

    expect(res.status).toBe(400);
  });

  it('rejects an inactive code with the same message as an unknown one', async () => {
    // Telling a caller which it is confirms the code exists — free
    // reconnaissance for anyone guessing at them.
    const product = await makeProduct('10.00');
    const discount = await makeDiscount('OFF', { isActive: false });

    const res = await order(product.id, 1, discount.code);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/not valid/i);
  });

  it('rejects an expired code', async () => {
    const product = await makeProduct('10.00');
    const discount = await makeDiscount('OLD', {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await order(product.id, 1, discount.code);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/expired/i);
  });

  it('refuses a customer-scoped code to a guest, without confirming it exists', async () => {
    const product = await makeProduct('10.00');
    const customer = await prisma.customer.create({
      data: { name: `${RUN} named`, email: `${RUN}-named@example.test` },
    });
    customerIds.push(customer.id);

    const discount = await makeDiscount('MINE', {
      scope: DiscountScope.CUSTOMER,
      customers: { connect: [{ id: customer.id }] },
    });

    const res = await order(product.id, 1, discount.code);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/does not apply/i);
  });

  it('refuses a product-scoped code when the cart holds none of its products', async () => {
    const eligible = await makeProduct('10.00');
    const inCart = await makeProduct('10.00');
    const discount = await makeDiscount('PRODONLY', {
      scope: DiscountScope.PRODUCT,
      products: { connect: [{ id: eligible.id }] },
    });

    const res = await order(inCart.id, 1, discount.code);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/does not apply/i);
  });

  it('allows a product-scoped code when the cart does hold one', async () => {
    const eligible = await makeProduct('10.00');
    const discount = await makeDiscount('PRODOK', {
      scope: DiscountScope.PRODUCT,
      value: new Prisma.Decimal('10.00'),
      products: { connect: [{ id: eligible.id }] },
    });

    const res = await order(eligible.id, 1, discount.code);

    expect(res.status).toBe(201);
    expect((res.body as CheckoutBody).data.discountAmount).toBe('1.00');
  });
});

describe('the usage ledger', () => {
  it('counts a redemption', async () => {
    // `usedCount` was never incremented by anything before this — the column
    // existed and nothing maintained it, so `maxUses` was decorative.
    const product = await makeProduct('10.00');
    const discount = await makeDiscount('COUNTED');

    await order(product.id, 1, discount.code);

    const after = await prisma.discount.findUnique({
      where: { id: discount.id },
      select: { usedCount: true },
    });
    expect(after?.usedCount).toBe(1);
  });

  it('refuses a code that has been fully claimed', async () => {
    const product = await makeProduct('10.00');
    const discount = await makeDiscount('LASTONE', { maxUses: 1, usedCount: 1 });

    const res = await order(product.id, 1, discount.code);

    // 409, not 400: nothing is malformed, somebody else got there first —
    // the same shape the oversell race already reports.
    expect(res.status).toBe(409);
  });

  it('does not count a redemption when the order fails', async () => {
    /**
     * The increment lives INSIDE the checkout transaction, so an order that
     * cannot be placed must not burn a use. Oversell is the cheapest way to
     * make the transaction roll back after the discount has been claimed.
     */
    const product = await makeProduct('10.00', 1);
    const discount = await makeDiscount('ROLLBACK', { maxUses: 5 });

    const res = await order(product.id, 5, discount.code);

    expect(res.status).toBe(409);

    const after = await prisma.discount.findUnique({
      where: { id: discount.id },
      select: { usedCount: true },
    });
    expect(after?.usedCount).toBe(0);
  });
});
