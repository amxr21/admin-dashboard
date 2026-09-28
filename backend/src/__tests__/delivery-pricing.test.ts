import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DiscountType, Prisma, ProductStatus, StaffRole } from '@prisma/client';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createApiKey } from '../services/api-key.service.js';
import { computeRefundBreakdown, computeRefundTaxAmount } from '../services/order-math.service.js';

/** Response bodies are untyped JSON; these name the fields asserted on. */
interface PricingBody {
  data: { orderNumber: string; total: string; deliveryFee: string };
}
interface ZoneListBody {
  data: { id: string }[];
}
interface ErrorBody {
  error: { details: { field?: string } };
}

const RUN = 'delivery-qa-' + randomUUID();
const app = createApp();
const settingKeys = [
  'store.taxRate',
  'store.pricesIncludeTax',
  'store.deliveryZonesEnabled',
] as const;
const previousSettings = new Map<string, Prisma.JsonValue>();
let ownerId = '';
let apiKey = '';
let businessId = '';
let branchId = '';
let productId = '';
let zoneId = '';
let inactiveZoneId = '';
let code = '';
let discountId = '';
const quantity = (count = 1) => [{ productId, quantity: count }];
function pricingInput(overrides: Record<string, unknown> = {}) {
  return {
    branchId,
    items: quantity(),
    fulfillment: 'Delivery',
    deliveryZoneId: zoneId,
    ...overrides,
  };
}
function quote(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/public/orders/quote')
    .set('X-API-Key', apiKey)
    .send(pricingInput(overrides));
}
function order(overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/public/orders')
    .set('X-API-Key', apiKey)
    .set('Idempotency-Key', randomUUID())
    .send({
      ...pricingInput(overrides),
      contact: { name: RUN, phone: '0501234567', address: 'QA delivery address' },
      paymentMethod: 'cash',
    });
}
async function setting(key: string, value: Prisma.InputJsonValue) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
beforeAll(async () => {
  for (const key of settingKeys) {
    const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
    if (row) previousSettings.set(key, row.value);
  }
  const owner = await prisma.user.create({
    data: { email: RUN + '@example.test', name: RUN, role: StaffRole.OWNER, passwordHash: 'test' },
  });
  ownerId = owner.id;
  apiKey = (await createApiKey(ownerId, 'Delivery QA', 'Delivery pricing tests', 'QA')).key;
  const business = await prisma.business.create({
    data: { name: RUN, branches: { create: { name: RUN, isDefault: true, isSellingPoint: true } } },
    include: { branches: true },
  });
  businessId = business.id;
  branchId = business.branches[0]!.id;
  const product = await prisma.product.create({
    data: {
      name: RUN + ' cookie',
      price: new Prisma.Decimal('48'),
      stock: 1000,
      isTaxable: true,
      status: ProductStatus.ACTIVE,
    },
  });
  productId = product.id;
  await prisma.branchStock.create({ data: { productId, branchId, quantity: 1000 } });
  const zone = await prisma.deliveryZone.create({
    data: { code: RUN, name: 'QA delivery area', fee: new Prisma.Decimal('10'), isActive: true },
  });
  zoneId = zone.id;
  const inactive = await prisma.deliveryZone.create({
    data: {
      code: RUN.slice(-40) + '-off',
      name: 'QA inactive area',
      fee: new Prisma.Decimal('20'),
      isActive: false,
    },
  });
  inactiveZoneId = inactive.id;
  const discount = await prisma.discount.create({
    data: {
      code: ('DELIVERY-' + randomUUID()).toUpperCase(),
      type: DiscountType.PERCENT,
      value: new Prisma.Decimal('10'),
    },
  });
  discountId = discount.id;
  code = discount.code;
});
beforeEach(async () => {
  await setting('store.taxRate', 5);
  await setting('store.pricesIncludeTax', false);
  await setting('store.deliveryZonesEnabled', true);
  await prisma.deliveryZone.update({
    where: { id: zoneId },
    data: {
      name: 'QA delivery area',
      fee: new Prisma.Decimal('10'),
      freeDeliveryThreshold: null,
      isActive: true,
    },
  });
});
afterAll(async () => {
  const orders = await prisma.order.findMany({
    where: { items: { some: { productId } } },
    select: { id: true },
  });
  const orderIds = orders.map((row) => row.id);
  await prisma.orderNote.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.discount.deleteMany({ where: { id: discountId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.deliveryZone.deleteMany({ where: { id: { in: [zoneId, inactiveZoneId] } } });
  await prisma.idempotencyRecord.deleteMany({ where: { actorId: ownerId } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  for (const key of settingKeys) {
    const original = previousSettings.get(key);
    if (original === undefined) await prisma.setting.deleteMany({ where: { key } });
    else await setting(key, original as Prisma.InputJsonValue);
  }
  await prisma.$disconnect();
});

describe('delivery pricing through the public quote and checkout API', () => {
  it('preserves no-fee delivery for existing stores when the feature is missing or disabled', async () => {
    await prisma.setting.deleteMany({ where: { key: 'store.deliveryZonesEnabled' } });
    const missing = await quote({ deliveryZoneId: undefined });
    expect(missing.status).toBe(200);
    expect((missing.body as PricingBody).data).toMatchObject({
      deliveryFee: '0.00',
      deliveryZoneName: null,
      subtotal: '48.00',
      taxAmount: '2.40',
      total: '50.40',
    });
    const legacyOrder = await order({ deliveryZoneId: undefined });
    expect(legacyOrder.status).toBe(201);
    expect((legacyOrder.body as PricingBody).data.total).toBe('50.40');
    await setting('store.deliveryZonesEnabled', false);
    const disabled = await quote({ deliveryZoneId: 'unknown-zone' });
    expect(disabled.status).toBe(200);
    expect((disabled.body as PricingBody).data.deliveryFee).toBe('0.00');
    const list = await request(app).get('/api/v1/public/delivery-zones').set('X-API-Key', apiKey);
    expect(list.status).toBe(200);
    expect((list.body as ZoneListBody).data).toEqual([]);
  });

  it('requires an active area for enabled delivery on both paths and lists only active areas', async () => {
    for (const deliveryZoneId of [undefined, 'unknown-zone', inactiveZoneId]) {
      const preview = await quote({ deliveryZoneId });
      const placed = await order({ deliveryZoneId });
      expect(preview.status).toBe(400);
      expect(placed.status).toBe(400);
      expect((preview.body as ErrorBody).error.details.field).toBe('deliveryZoneId');
      expect((placed.body as ErrorBody).error.details.field).toBe('deliveryZoneId');
    }
    const list = await request(app).get('/api/v1/public/delivery-zones').set('X-API-Key', apiKey);
    expect(list.status).toBe(200);
    expect((list.body as ZoneListBody).data.some((zone) => zone.id === zoneId)).toBe(true);
    expect((list.body as ZoneListBody).data.some((zone) => zone.id === inactiveZoneId)).toBe(false);
  });

  it('keeps pickup free and ignores even an inactive supplied delivery area', async () => {
    const preview = await quote({ fulfillment: 'Pickup', deliveryZoneId: inactiveZoneId });
    const placed = await order({ fulfillment: 'Pickup', deliveryZoneId: inactiveZoneId });
    expect(preview.status).toBe(200);
    expect(placed.status).toBe(201);
    expect((preview.body as PricingBody).data).toMatchObject({
      deliveryFee: '0.00',
      deliveryZoneName: null,
      taxAmount: '2.40',
      total: '50.40',
    });
    expect((placed.body as PricingBody).data.total).toBe('50.40');
    const snapshot = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: (placed.body as PricingBody).data.orderNumber },
    });
    expect(snapshot.deliveryFee.toFixed(2)).toBe('0.00');
    expect(snapshot.deliveryZoneId).toBeNull();
  });

  it('applies the free delivery threshold after discounts with equality qualifying', async () => {
    await prisma.deliveryZone.update({
      where: { id: zoneId },
      data: { freeDeliveryThreshold: new Prisma.Decimal('96') },
    });
    const full = await quote({ items: quantity(2) });
    expect(full.status).toBe(200);
    expect((full.body as PricingBody).data.deliveryFee).toBe('0.00');
    const discounted = await quote({ items: quantity(2), discountCode: code });
    expect(discounted.status).toBe(200);
    expect((discounted.body as PricingBody).data).toMatchObject({
      subtotal: '96.00',
      discountAmount: '9.60',
      deliveryFee: '10.00',
      taxAmount: '4.82',
      total: '101.22',
    });
    await prisma.deliveryZone.update({
      where: { id: zoneId },
      data: { freeDeliveryThreshold: new Prisma.Decimal('86.40') },
    });
    const threshold = await quote({ items: quantity(2), discountCode: code });
    expect(threshold.status).toBe(200);
    expect((threshold.body as PricingBody).data).toMatchObject({
      deliveryFee: '0.00',
      taxAmount: '4.32',
      total: '90.72',
    });
    const placed = await order({ items: quantity(2), discountCode: code });
    expect(placed.status).toBe(201);
    expect((placed.body as PricingBody).data.total).toBe('90.72');
  });

  it('refuses forged fee/total fields rather than accepting client pricing', async () => {
    const stock = await prisma.branchStock.findUniqueOrThrow({
      where: { productId_branchId: { productId, branchId } },
    });
    for (const field of ['deliveryFee', 'deliveryTaxAmount', 'total']) {
      expect((await quote({ [field]: '0.01' })).status).toBe(400);
      expect((await order({ [field]: '0.01' })).status).toBe(400);
    }
    expect(
      (
        await prisma.branchStock.findUniqueOrThrow({
          where: { productId_branchId: { productId, branchId } },
        })
      ).quantity,
    ).toBe(stock.quantity);
  });

  it.each([
    [false, '2.90', '60.90', '0.50', '50.40', '2.40'],
    [true, '2.77', '58.00', '0.48', '48.00', '2.29'],
  ])(
    'quotes, charges and snapshots inclusive=%s with goods refunds excluding delivery VAT',
    async (inclusive, taxAmount, total, deliveryTax, goodsRefund, goodsTax) => {
      await setting('store.pricesIncludeTax', inclusive);
      const preview = await quote();
      expect(preview.status).toBe(200);
      expect((preview.body as PricingBody).data).toMatchObject({
        subtotal: '48.00',
        deliveryFee: '10.00',
        deliveryZoneName: 'QA delivery area',
        taxAmount,
        total,
        pricesIncludeTax: inclusive,
      });
      const placed = await order();
      expect(placed.status).toBe(201);
      expect((placed.body as PricingBody).data).toMatchObject({ subtotal: '48.00', taxAmount, total });
      const snapshot = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: (placed.body as PricingBody).data.orderNumber },
        include: { items: true },
      });
      expect(snapshot.pricesIncludeTax).toBe(inclusive);
      expect(snapshot.deliveryFee.toFixed(2)).toBe('10.00');
      expect(snapshot.deliveryTaxAmount.toFixed(2)).toBe(deliveryTax);
      expect(snapshot.deliveryZoneId).toBe(zoneId);
      expect(snapshot.deliveryZoneName).toBe('QA delivery area');
      await prisma.deliveryZone.update({
        where: { id: zoneId },
        data: { name: 'Changed live name', fee: new Prisma.Decimal('30') },
      });
      await setting('store.taxRate', 20);
      await setting('store.pricesIncludeTax', !inclusive);
      const stable = await prisma.order.findUniqueOrThrow({
        where: { id: snapshot.id },
        include: { items: true },
      });
      expect(stable.deliveryFee.toFixed(2)).toBe('10.00');
      expect(stable.deliveryZoneName).toBe('QA delivery area');
      expect(stable.total.toFixed(2)).toBe(total);
      const refund = computeRefundBreakdown({ ...stable, lines: stable.items }, stable.items);
      expect(refund.refundable.toFixed(2)).toBe(goodsRefund);
      expect(computeRefundTaxAmount(refund, refund.refundable)?.toFixed(2)).toBe(goodsTax);
    },
  );
});
