import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * URG-028 — barcode validation at the write boundary.
 *
 * `lib/barcode.test.ts` covers the check-digit arithmetic in isolation. What
 * this file covers is the part that cannot be unit-tested: WHEN the products
 * `beforeWrite` hook decides to judge a code at all.
 *
 * That question is the whole design. `Product.barcode` predates barcode
 * types, so rows hold codes nobody classified — validating unconditionally
 * would mean editing a product's PRICE could fail on its old barcode, a
 * refusal about a field the user never opened. These cases pin the boundary
 * in both directions, because it was reasoned about rather than observed.
 */

const app = createApp();

const RUN = `barcodetest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
const productIds: string[] = [];
let ownerToken = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

async function makeProduct(data: Record<string, unknown> = {}) {
  const product = await prisma.product.create({
    data: {
      name: `${RUN} product ${productIds.length}`,
      price: new Prisma.Decimal('10.00'),
      ...data,
    },
  });
  productIds.push(product.id);
  return product;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-owner@example.test`,
      name: 'Owner',
      role: StaffRole.OWNER,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  ownerToken = signToken(user);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.branchStock.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.productCatalogueVersion.deleteMany({
    where: { productId: { in: productIds } },
  });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('creating a product with a barcode', () => {
  it('refuses a code that does not match its declared type', async () => {
    const res = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({
        name: `${RUN} bad code`,
        price: '10.00',
        barcodeType: 'EAN13',
        barcode: '5012345678901', // last digit wrong
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: { details?: { field?: string } } }).error.details?.field).toBe(
      'barcode',
    );
  });

  it('stores a valid code in its canonical form', async () => {
    // Typed with spaces the way someone reads digits off a label. The till
    // matches this column EXACTLY, so a stored space is a scan that finds
    // nothing.
    const res = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({
        name: `${RUN} spaced code`,
        price: '10.00',
        barcodeType: 'EAN13',
        barcode: '5012 3456 78900',
      });

    expect(res.status).toBe(201);
    const created = (res.body as { data: { row: { id: string } } }).data.row;
    productIds.push(created.id);

    const stored = await prisma.product.findUnique({
      where: { id: created.id },
      select: { barcode: true },
    });
    expect(stored?.barcode).toBe('5012345678900');
  });

  it('accepts a code with no declared type — legacy entry stays possible', async () => {
    const res = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({ name: `${RUN} untyped`, price: '10.00', barcode: 'OLD-SHELF-77' });

    expect(res.status).toBe(201);
    productIds.push((res.body as { data: { row: { id: string } } }).data.row.id);
  });
});

describe('updating a product that already has a barcode', () => {
  it('does NOT fail on an unrelated field when the stored code is unclassified', async () => {
    // The case that decides the whole design: a legacy code, and an edit that
    // never touches it. Validating unconditionally would refuse this.
    const product = await makeProduct({ barcode: `${RUN}-legacy-code`, barcodeType: null });

    const res = await request(app)
      .patch(`/api/v1/r/products/${product.id}`)
      .set(auth(ownerToken))
      .send({ price: '12.50' });

    expect(res.status).toBe(200);
  });

  it('judges a type-only PATCH against the STORED code', async () => {
    // Declaring "this is an EAN-13" is exactly when to discover the saved
    // digits are not one — even though this request carries no barcode.
    const product = await makeProduct({ barcode: '5012345678901', barcodeType: null });

    const res = await request(app)
      .patch(`/api/v1/r/products/${product.id}`)
      .set(auth(ownerToken))
      .send({ barcodeType: 'EAN13' });

    expect(res.status).toBe(400);
    expect((res.body as { error: { details?: { field?: string } } }).error.details?.field).toBe(
      'barcode',
    );
  });

  it('accepts a type-only PATCH when the stored code does match', async () => {
    // A DISTINCT valid EAN-13: `barcode` is @unique, so reusing one code
    // across tests in this file collides on `products_barcode_key` rather
    // than testing anything.
    const product = await makeProduct({ barcode: '4006381333931', barcodeType: null });

    const res = await request(app)
      .patch(`/api/v1/r/products/${product.id}`)
      .set(auth(ownerToken))
      .send({ barcodeType: 'EAN13' });

    expect(res.status).toBe(200);
  });

  it('judges a code-only PATCH against the STORED type', async () => {
    // Another distinct code, for the same uniqueness reason.
    const product = await makeProduct({ barcode: '0036000291452', barcodeType: 'EAN13' });

    const res = await request(app)
      .patch(`/api/v1/r/products/${product.id}`)
      .set(auth(ownerToken))
      .send({ barcode: '5012345678901' });

    expect(res.status).toBe(400);
  });
});
