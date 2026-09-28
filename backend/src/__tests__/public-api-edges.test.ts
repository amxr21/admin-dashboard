import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { DiscountScope, DiscountType, Prisma, ProductStatus, StaffRole } from '@prisma/client';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { createApiKey } from '../services/api-key.service.js';
import { signCustomerToken } from '../services/customer-auth.service.js';

const RUN = 'publicedge-' + randomUUID();
const app = createApp();
let ownerId = '';
let key = '';
let branchId = '';
let businessId = '';
let productId = '';
let variantProductId = '';
let variantId = '';
let customerId = '';
let token = '';
let categoryId = '';
const discountIds: string[] = [];
const originalGoogleClientId = env.GOOGLE_CLIENT_ID;
let previousStockSetting: { value: Prisma.JsonValue } | null = null;
/** Response bodies are untyped JSON; these name the fields asserted on. */
interface PublicProductBody {
  id: string;
  stock?: number;
  inStock: boolean;
  variants: { stock?: number; inStock: boolean }[];
}
interface ProductsBody {
  data: PublicProductBody[];
}
interface ProductBody {
  data: PublicProductBody;
}
interface MenuBody {
  data: { id: string; items: PublicProductBody[] }[];
}
interface OrderBody {
  data: { orderNumber: string };
}
interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { unavailableItems?: { productId: string }[] };
  };
}
const withKey = (test: request.Test) => test.set('X-API-Key', key);
function quote(code?: string, authorization?: string) {
  const query = withKey(request(app).post('/api/v1/public/orders/quote'));
  if (authorization !== undefined) query.set('Authorization', authorization);
  return query.send({
    branchId,
    items: [{ productId, quantity: 1 }],
    ...(code ? { discountCode: code } : {}),
  });
}
function add(quantity: number) {
  return withKey(request(app).post('/api/v1/public/cart'))
    .set('Authorization', 'Bearer ' + token)
    .send({ productId, quantity });
}
async function discount(label: string, extra: Partial<Prisma.DiscountUncheckedCreateInput> = {}) {
  const row = await prisma.discount.create({
    data: {
      code: (RUN + '-' + label).slice(-48).toUpperCase(),
      type: DiscountType.PERCENT,
      value: new Prisma.Decimal(10),
      ...extra,
    },
  });
  discountIds.push(row.id);
  return row;
}

beforeAll(async () => {
  previousStockSetting = await prisma.setting.findUnique({
    where: { key: 'storefront.hideStockCounts' },
    select: { value: true },
  });
  await prisma.setting.deleteMany({ where: { key: 'storefront.hideStockCounts' } });
  const owner = await prisma.user.create({
    data: { email: RUN + '@example.test', name: RUN, role: StaffRole.OWNER, passwordHash: 'test' },
  });
  ownerId = owner.id;
  key = (await createApiKey(ownerId, 'Storefront', 'Public edge tests', 'QA')).key;
  const business = await prisma.business.create({
    data: { name: RUN, branches: { create: { name: RUN, isDefault: true, isSellingPoint: true } } },
    include: { branches: true },
  });
  businessId = business.id;
  branchId = business.branches[0]!.id;
  const category = await prisma.category.create({ data: { name: RUN, slug: RUN } });
  categoryId = category.id;
  const product = await prisma.product.create({
    data: {
      name: RUN + ' cookie',
      slug: RUN + '-cookie',
      categoryId,
      price: new Prisma.Decimal('10'),
      stock: 1000,
      status: ProductStatus.ACTIVE,
    },
  });
  productId = product.id;
  await prisma.branchStock.create({ data: { productId, branchId, quantity: 1000 } });
  const variantProduct = await prisma.product.create({
    data: {
      name: RUN + ' options',
      slug: RUN + '-options',
      categoryId,
      price: new Prisma.Decimal('10'),
      stock: 6,
      status: ProductStatus.ACTIVE,
    },
  });
  variantProductId = variantProduct.id;
  const variant = await prisma.productVariant.create({
    data: { productId: variantProductId, name: 'Large', sku: RUN, price: new Prisma.Decimal('12') },
  });
  variantId = variant.id;
  await prisma.branchStock.create({ data: { productId: variantProductId, branchId, quantity: 6 } });
  await prisma.branchVariantStock.create({ data: { variantId, branchId, quantity: 6 } });
  const customer = await prisma.customer.create({
    data: { name: RUN, email: RUN + '-customer@example.test', phone: '+971 50 123 4567' },
  });
  customerId = customer.id;
  token = signCustomerToken(customer);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.GOOGLE_CLIENT_ID = originalGoogleClientId;
});
afterAll(async () => {
  const products = [productId, variantProductId];
  const orders = await prisma.order.findMany({
    where: { items: { some: { productId: { in: products } } } },
    select: { id: true },
  });
  await prisma.orderNote.deleteMany({ where: { orderId: { in: orders.map((row) => row.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orders.map((row) => row.id) } } });
  await prisma.stockMovement.deleteMany({ where: { productId: { in: products } } });
  await prisma.discount.deleteMany({ where: { id: { in: discountIds } } });
  await prisma.product.deleteMany({ where: { id: { in: products } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.idempotencyRecord.deleteMany({ where: { actorId: ownerId } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  if (previousStockSetting) {
    await prisma.setting.upsert({
      where: { key: 'storefront.hideStockCounts' },
      create: {
        key: 'storefront.hideStockCounts',
        value: previousStockSetting.value as Prisma.InputJsonValue,
      },
      update: { value: previousStockSetting.value as Prisma.InputJsonValue },
    });
  } else await prisma.setting.deleteMany({ where: { key: 'storefront.hideStockCounts' } });
  await prisma.$disconnect();
});

describe('public API edge contracts', () => {
  it('limits repeated and concurrent cart additions to 99', async () => {
    expect((await add(98)).status).toBe(201);
    const results = await Promise.all([add(1), add(1), add(1)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 400, 400]);
    expect(
      (
        await prisma.cartItem.findUniqueOrThrow({
          where: { customerId_productId: { customerId, productId } },
        })
      ).quantity,
    ).toBe(99);
    expect((await add(1)).status).toBe(400);
    const invalidPatch = await withKey(request(app).patch('/api/v1/public/cart'))
      .set('Authorization', 'Bearer ' + token)
      .send({ productId, quantity: 100 });
    expect(invalidPatch.status).toBe(400);
  });

  it('keeps guests working and refuses every supplied invalid session on quote and checkout', async () => {
    expect((await quote()).status).toBe(200);
    const expired = jwt.sign({ sub: customerId, type: 'customer', tv: 0 }, env.JWT_SECRET, {
      expiresIn: -1,
    });
    for (const authorization of ['Bearer ' + expired, 'Bearer invalid', 'Basic credentials']) {
      expect((await quote(undefined, authorization)).status).toBe(401);
      const rejected = await withKey(request(app).post('/api/v1/public/orders'))
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', authorization)
        .send({
          branchId,
          items: [{ productId, quantity: 1 }],
          contact: { name: RUN, phone: '0501234567' },
          paymentMethod: 'cash',
          fulfillment: 'Pickup',
        });
      expect(rejected.status).toBe(401);
    }
    expect(await prisma.order.count({ where: { customerId } })).toBe(0);
  });

  it('maps invalid Google credentials to 401 while outages and missing configuration stay 503', async () => {
    env.GOOGLE_CLIENT_ID = 'edge-test-client';
    const verifier = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken');
    verifier.mockRejectedValueOnce(new Error('Invalid token signature: hidden-token'));
    const invalid = await withKey(request(app).post('/api/v1/public/auth/google')).send({
      idToken: 'header.payload.signature',
    });
    expect(invalid.status).toBe(401);
    expect(JSON.stringify(invalid.body)).not.toContain('hidden-token');
    verifier.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND google.example'));
    expect(
      (
        await withKey(request(app).post('/api/v1/public/auth/google')).send({
          idToken: 'header.payload.signature',
        })
      ).status,
    ).toBe(503);
    env.GOOGLE_CLIENT_ID = '';
    expect(
      (
        await withKey(request(app).post('/api/v1/public/auth/google')).send({
          idToken: 'header.payload.signature',
        })
      ).status,
    ).toBe(503);
  });

  it('gives one denial response for unknown, inactive, expired, exhausted and customer-only codes', async () => {
    const inactive = await discount('INACTIVE', { isActive: false });
    const expired = await discount('EXPIRED', { expiresAt: new Date(0) });
    const exhausted = await discount('EXHAUSTED', { maxUses: 1, usedCount: 1 });
    const privateCode = await discount('PRIVATE', { scope: DiscountScope.CUSTOMER });
    const responses = [];
    for (const code of [
      'UNKNOWN-' + RUN.slice(-16),
      inactive.code,
      expired.code,
      exhausted.code,
      privateCode.code,
    ]) {
      const denied = await quote(code);
      expect(denied.status).toBe(400);
      responses.push({
        code: (denied.body as ErrorBody).error.code,
        message: (denied.body as ErrorBody).error.message,
        details: (denied.body as ErrorBody).error.details,
      });
    }
    for (const response of responses) expect(response).toEqual(responses[0]);
  });

  it('marks unavailable product/option IDs without exposing draft names', async () => {
    const option = await withKey(request(app).post('/api/v1/public/orders/quote')).send({
      branchId,
      items: [{ productId, variantId, quantity: 1 }],
    });
    expect(option.status).toBe(400);
    expect((option.body as ErrorBody).error.message).toContain(RUN + ' cookie');
    const draft = await prisma.product.create({
      data: {
        name: 'Secret unreleased recipe',
        price: new Prisma.Decimal(10),
        status: ProductStatus.DRAFT,
      },
    });
    try {
      const rejected = await withKey(request(app).post('/api/v1/public/orders/quote')).send({
        branchId,
        items: [{ productId: draft.id, quantity: 1 }],
      });
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(rejected.body)).not.toContain('Secret unreleased recipe');
      expect((rejected.body as ErrorBody).error.details?.unavailableItems?.[0]?.productId).toBe(draft.id);
    } finally {
      await prisma.product.delete({ where: { id: draft.id } });
    }
  });

  it('shows stock counts by default and omits product/variant/wishlist counts when configured', async () => {
    const list = await withKey(request(app).get('/api/v1/public/products').query({ branchId }));
    expect(list.status).toBe(200);
    expect((list.body as ProductsBody).data.find((row) => row.id === productId)?.stock).toBe(1000);
    await prisma.wishlistItem.create({ data: { customerId, productId } });
    await prisma.setting.upsert({
      where: { key: 'storefront.hideStockCounts' },
      create: { key: 'storefront.hideStockCounts', value: true },
      update: { value: true },
    });
    try {
      const hiddenList = await withKey(
        request(app).get('/api/v1/public/products').query({ branchId }),
      );
      const hiddenProduct = (hiddenList.body as ProductsBody).data.find(
        (row) => row.id === variantProductId,
      )!;
      expect(hiddenList.status).toBe(200);
      expect(hiddenProduct).not.toHaveProperty('stock');
      expect(hiddenProduct.inStock).toBe(true);
      expect(hiddenProduct.variants[0]).not.toHaveProperty('stock');
      expect(hiddenProduct.variants[0].inStock).toBe(true);
      const menu = await withKey(
        request(app).get('/api/v1/public/products/menu').query({ branchId }),
      );
      expect(menu.status).toBe(200);
      expect(
        (menu.body as MenuBody).data.find((row) => row.id === categoryId)!.items[0],
      ).not.toHaveProperty('stock');
      const detail = await withKey(
        request(app)
          .get('/api/v1/public/products/' + RUN + '-cookie')
          .query({ branchId }),
      );
      expect(detail.status).toBe(200);
      expect((detail.body as ProductBody).data).not.toHaveProperty('stock');
      const wishlist = await withKey(request(app).get('/api/v1/public/wishlist')).set(
        'Authorization',
        'Bearer ' + token,
      );
      expect(wishlist.status).toBe(200);
      expect((wishlist.body as ProductsBody).data[0]!).not.toHaveProperty('stock');
      expect((wishlist.body as ProductsBody).data[0]!.inStock).toBe(true);
    } finally {
      await prisma.setting.deleteMany({ where: { key: 'storefront.hideStockCounts' } });
    }
  });

  it('tracks equivalent formatted numbers, rejects fragments and isolates tracking budgets per shopper', async () => {
    const placed = await withKey(request(app).post('/api/v1/public/orders'))
      .set('Idempotency-Key', randomUUID())
      .send({
        branchId,
        items: [{ productId, quantity: 1 }],
        contact: { name: RUN, phone: '050 123 4567' },
        paymentMethod: 'cash',
        fulfillment: 'Pickup',
      });
    expect(placed.status).toBe(201);
    const savedOrderNumber = (placed.body as OrderBody).data.orderNumber;
    const track = (phone: string, ip: string) =>
      withKey(request(app).get('/api/v1/public/orders/track'))
        .set('X-Storefront-Client-IP', ip)
        .query({ orderNumber: savedOrderNumber, phone });
    for (const phone of ['0501234567', '+971501234567', '00971501234567'])
      expect((await track(phone, '198.51.100.31')).status).toBe(200);
    expect((await track('4567', '198.51.100.32')).status).toBe(404);
    for (let index = 0; index < 20; index += 1)
      expect((await track('0509999999', '198.51.100.33')).status).toBe(404);
    expect((await track('0501234567', '198.51.100.33')).status).toBe(429);
    expect((await track('0501234567', '198.51.100.34')).status).toBe(200);
  });
});
