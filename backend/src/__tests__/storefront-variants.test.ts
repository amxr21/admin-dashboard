import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, ProductStatus, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createApiKey } from '../services/api-key.service.js';

/**
 * Options (variants) through the public storefront: the catalogue shows them
 * with the branch's own stock, and checkout sells them the way the POS does —
 * the option's price, the option's branch stock, the option on the order line.
 */

const app = createApp();
const RUN = `sfvariant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PHONE = '+971500001111';

const productIds: string[] = [];
let ownerId = '';
let businessId = '';
let branchId = '';
let storefrontKey = '';

interface CatalogueProduct {
  id: string;
  stock: number;
  inStock: boolean;
  variants?: { id: string; name: string; price: string; stock: number; inStock: boolean }[];
}
interface ErrorBody {
  error: { message: string };
}

/** A product listed at the branch, with options Small/Large at their own price and stock. */
async function makeShirt(small = 3, large = 0) {
  const product = await prisma.product.create({
    data: { name: `${RUN} shirt ${String(productIds.length)}`, price: new Prisma.Decimal('50.00'), stock: 0, status: ProductStatus.ACTIVE },
  });
  productIds.push(product.id);
  await prisma.branchStock.create({ data: { productId: product.id, branchId, quantity: 0 } });

  const make = async (name: string, price: string, quantity: number) => {
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name,
        sku: `${RUN}-${String(productIds.length)}-${name}`.toUpperCase(),
        price: new Prisma.Decimal(price),
        stock: quantity,
      },
    });
    await prisma.branchVariantStock.create({ data: { variantId: variant.id, branchId, quantity } });
    return variant;
  };

  return { product, small: await make('Small', '45.00', small), large: await make('Large', '55.00', large) };
}

function order(items: object[]) {
  return request(app)
    .post('/api/v1/public/orders')
    .set('X-API-Key', storefrontKey)
    .set('Idempotency-Key', randomUUID())
    .send({ branchId, items, contact: { name: 'Sara', phone: PHONE }, paymentMethod: 'cash', fulfillment: 'Pickup' });
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
  storefrontKey = (await createApiKey(owner.id, 'Storefront test', 'Exercise variant checkout', 'Test suite')).key;

  const business = await prisma.business.create({
    data: { name: `${RUN} business`, branches: { create: { name: `${RUN} branch`, isDefault: true } } },
    include: { branches: true },
  });
  businessId = business.id;
  branchId = business.branches[0]!.id;
});

afterAll(async () => {
  const sold = await prisma.orderItem.findMany({ where: { productId: { in: productIds } }, select: { orderId: true } });
  const orderIds = [...new Set(sold.map((item) => item.orderId))];
  await prisma.orderNote.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.stockMovement.deleteMany({
    where: { OR: [{ productId: { in: productIds } }, { variant: { productId: { in: productIds } } }] },
  });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { scope: 'storefront.checkout', actorId: ownerId } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe('catalogue', () => {
  it('lists options with this branch’s stock, and totals them on the product', async () => {
    const { product, small, large } = await makeShirt(3, 0);

    const res = await request(app)
      .get('/api/v1/public/products')
      .query({ branchId })
      .set('X-API-Key', storefrontKey);

    const listed = (res.body as { data: CatalogueProduct[] }).data.find((entry) => entry.id === product.id);
    expect(listed?.stock).toBe(3);
    expect(listed?.inStock).toBe(true);
    expect(listed?.variants).toEqual([
      { id: large.id, name: 'Large', price: '55.00', stock: 0, inStock: false },
      { id: small.id, name: 'Small', price: '45.00', stock: 3, inStock: true },
    ]);
  });
});

describe('checkout', () => {
  it('sells the option at its own price and draws only on its own stock', async () => {
    const { product, small } = await makeShirt(3, 0);

    const res = await order([{ productId: product.id, variantId: small.id, quantity: 2 }]);

    expect(res.status).toBe(201);
    expect((res.body as { data: { subtotal: string } }).data.subtotal).toBe('90.00');

    const line = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } });
    expect(line).toMatchObject({ variantId: small.id, variantName: 'Small', variantSku: small.sku });
    expect(line.price.toFixed(2)).toBe('45.00');

    const branchVariant = await prisma.branchVariantStock.findUniqueOrThrow({
      where: { variantId_branchId: { variantId: small.id, branchId } },
    });
    expect(branchVariant.quantity).toBe(1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: small.id } })).stock).toBe(1);
    const productBranch = await prisma.branchStock.findFirstOrThrow({ where: { productId: product.id, branchId } });
    expect(productBranch.quantity).toBe(0);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { variantId: small.id } });
    expect(movement.delta).toBe(-2);

    // The shopper's tracking view names the option too.
    const tracked = await request(app)
      .get('/api/v1/public/orders/track')
      .query({ orderNumber: (res.body as { data: { orderNumber: string } }).data.orderNumber, phone: PHONE })
      .set('X-API-Key', storefrontKey);
    expect((tracked.body as { data: { items: { variant: string | null }[] } }).data.items[0]?.variant).toBe('Small');
  });

  it('refuses a product with options when no option is chosen', async () => {
    const { product } = await makeShirt();

    const res = await order([{ productId: product.id, quantity: 1 }]);

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toBe(`Choose an option for ${product.name}`);
  });

  it('refuses an option that belongs to a different product', async () => {
    const first = await makeShirt();
    const second = await makeShirt();

    const res = await order([{ productId: first.product.id, variantId: second.small.id, quantity: 1 }]);

    expect(res.status).toBe(400);
  });

  it('refuses more than the option has at this branch', async () => {
    const { product, large } = await makeShirt(3, 0);

    const res = await order([{ productId: product.id, variantId: large.id, quantity: 1 }]);

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.message).toContain('Only 0 ×');
  });

  it('sells two options of one product as two lines', async () => {
    const { product, small, large } = await makeShirt(2, 2);

    const res = await order([
      { productId: product.id, variantId: small.id, quantity: 1 },
      { productId: product.id, variantId: large.id, quantity: 1 },
    ]);

    expect(res.status).toBe(201);
    expect((res.body as { data: { subtotal: string } }).data.subtotal).toBe('100.00');
    expect(await prisma.orderItem.count({ where: { productId: product.id } })).toBe(2);
  });
});
