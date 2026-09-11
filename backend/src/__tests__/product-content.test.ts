import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { getResolvedProductContent } from '../services/product-content.service.js';
import { waitFor } from './helpers/wait-for.js';

const app = createApp();
const RUN = `content-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
const productIds: string[] = [];
const categoryIds: string[] = [];
let ownerToken = '';
let supportToken = '';

interface ContentResponseBody {
  data: {
    defaultLocale: string;
    content: Array<{
      locale: string;
      name: string | null;
      description: string | null;
      metaTitle: string | null;
      metaDescription: string | null;
    }>;
  };
}

interface VersionListBody {
  data: {
    versions: Array<{ version: number; source: string; summary: string }>;
    total: number;
  };
}

interface VersionDetailBody {
  data: { version: number; currentUpdatedAt: string; snapshot: Record<string, unknown> };
}

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

async function makeProduct() {
  const product = await prisma.product.create({
    data: {
      name: `${RUN} Coffee`,
      description: 'Default description',
      price: new Prisma.Decimal('12.00'),
      metaTitle: 'Default meta title',
      sku: `${RUN}-${productIds.length}`.slice(0, 64),
    },
  });
  productIds.push(product.id);
  return product.id;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  [ownerToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('product localized content', () => {
  it('returns canonical English and an explicit empty Arabic entry', async () => {
    const productId = await makeProduct();
    const response = await request(app)
      .get(`/api/v1/products/${productId}/content`)
      .set(auth(ownerToken));

    expect(response.status).toBe(200);
    expect((response.body as ContentResponseBody).data).toMatchObject({
      defaultLocale: 'en',
      content: [
        { locale: 'en', name: `${RUN} Coffee`, description: 'Default description' },
        { locale: 'ar', name: null, description: null },
      ],
    });
  });

  it('upserts trimmed Arabic content and resolves missing fields from English', async () => {
    const productId = await makeProduct();
    const response = await request(app)
      .put(`/api/v1/products/${productId}/content/ar`)
      .set(auth(ownerToken))
      .send({ name: '  قهوة مختصة  ', description: '' });

    expect(response.status).toBe(200);
    expect((response.body as ContentResponseBody).data.content[1]).toMatchObject({
      locale: 'ar',
      name: 'قهوة مختصة',
      description: null,
    });

    await expect(getResolvedProductContent(productId, 'ar')).resolves.toMatchObject({
      locale: 'ar',
      name: 'قهوة مختصة',
      description: 'Default description',
      metaTitle: 'Default meta title',
    });

    await waitFor(async () =>
      (await prisma.auditLog.count({
        where: { entityId: productId, action: 'product.translation.updated' },
      })) === 1,
    );
  });

  it('clears the translation row when every localized field is blank', async () => {
    const productId = await makeProduct();
    await request(app)
      .put(`/api/v1/products/${productId}/content/ar`)
      .set(auth(ownerToken))
      .send({ name: 'منتج' });

    const response = await request(app)
      .put(`/api/v1/products/${productId}/content/ar`)
      .set(auth(ownerToken))
      .send({ name: null, description: null, metaTitle: null, metaDescription: null });

    expect(response.status).toBe(200);
    expect((response.body as ContentResponseBody).data.content[1]).toMatchObject({
      locale: 'ar',
      name: null,
    });
    await expect(prisma.productTranslation.count({ where: { productId } })).resolves.toBe(0);
  });

  it('rejects unsupported locales and oversized fields at the route boundary', async () => {
    const productId = await makeProduct();
    const unsupported = await request(app)
      .put(`/api/v1/products/${productId}/content/fr`)
      .set(auth(ownerToken))
      .send({ name: 'Café' });
    const oversized = await request(app)
      .put(`/api/v1/products/${productId}/content/ar`)
      .set(auth(ownerToken))
      .send({ name: 'x'.repeat(201) });

    expect(unsupported.status).toBe(400);
    expect(oversized.status).toBe(400);
  });

  it('denies staff without catalogue access', async () => {
    const productId = await makeProduct();
    const response = await request(app)
      .put(`/api/v1/products/${productId}/content/ar`)
      .set(auth(supportToken))
      .send({ name: 'غير مسموح' });

    expect(response.status).toBe(403);
  });

  it('uses Arabic names consistently in admin search, POS and the public catalogue', async () => {
    const productId = await makeProduct();
    const arabicName = `قهوة عربية ${productIds.length}`;
    await request(app)
      .put(`/api/v1/products/${productId}/content/ar`)
      .set(auth(ownerToken))
      .send({ name: arabicName });

    const [resourceList, resourceRow, globalSearch, posBrowse, publicList] = await Promise.all([
      request(app)
        .get(`/api/v1/r/products?search=${encodeURIComponent(arabicName)}`)
        .set(auth(ownerToken))
        .set('Accept-Language', 'ar-AE'),
      request(app)
        .get(`/api/v1/r/products/${productId}`)
        .set(auth(ownerToken))
        .set('Accept-Language', 'ar'),
      request(app)
        .get(`/api/v1/search?q=${encodeURIComponent(arabicName)}`)
        .set(auth(ownerToken))
        .set('Accept-Language', 'ar'),
      request(app)
        .get(`/api/v1/pos/browse?q=${encodeURIComponent(arabicName)}`)
        .set(auth(ownerToken))
        .set('Accept-Language', 'ar'),
      request(app).get('/api/v1/public/products').set('Accept-Language', 'ar'),
    ]);

    expect(resourceList.status).toBe(200);
    expect(
      (resourceList.body as { data: { rows: Array<{ id: string; name: string }> } }).data.rows,
    ).toContainEqual(expect.objectContaining({ id: productId, name: arabicName }));
    expect(
      (resourceRow.body as { data: { row: { name: string } } }).data.row.name,
    ).toBe(arabicName);
    expect(
      (globalSearch.body as { data: { products: Array<{ id: string; title: string }> } }).data
        .products,
    ).toContainEqual(expect.objectContaining({ id: productId, title: arabicName }));
    expect(
      (posBrowse.body as { data: { products: Array<{ id: string; name: string }> } }).data.products,
    ).toContainEqual(expect.objectContaining({ id: productId, name: arabicName }));
    expect(
      (publicList.body as { data: Array<{ id: string; name: string }> }).data,
    ).toContainEqual(expect.objectContaining({ id: productId, name: arabicName }));
  });
});

describe('catalogue versions', () => {
  async function createVersionedProduct() {
    const response = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({ name: `${RUN} Versioned`, price: '18.00' });
    expect(response.status).toBe(201);
    const id = (response.body as { data: { row: { id: string } } }).data.row.id;
    productIds.push(id);
    return id;
  }

  it('captures create/update history and restores a snapshot as a new version', async () => {
    const productId = await createVersionedProduct();
    await prisma.product.update({ where: { id: productId }, data: { stock: 37 } });

    const update = await request(app)
      .patch(`/api/v1/r/products/${productId}`)
      .set(auth(ownerToken))
      .send({ name: `${RUN} Renamed` });
    expect(update.status).toBe(200);

    await waitFor(async () =>
      (await prisma.productCatalogueVersion.count({ where: { productId } })) === 2,
    );

    const history = await request(app)
      .get(`/api/v1/products/${productId}/versions`)
      .set(auth(ownerToken));
    const versions = (history.body as VersionListBody).data;
    expect(versions.total).toBe(2);
    expect(versions.versions.map((entry) => entry.source)).toEqual(['UPDATE', 'CREATE']);

    const detail = await request(app)
      .get(`/api/v1/products/${productId}/versions/1`)
      .set(auth(ownerToken));
    const preview = (detail.body as VersionDetailBody).data;
    expect(preview.snapshot).toMatchObject({ name: `${RUN} Versioned`, price: '18' });
    expect(preview.snapshot).not.toHaveProperty('stock');

    const restore = await request(app)
      .post(`/api/v1/products/${productId}/versions/1/restore`)
      .set(auth(ownerToken))
      .send({ expectedUpdatedAt: preview.currentUpdatedAt });
    expect(restore.status).toBe(200);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product).toMatchObject({ name: `${RUN} Versioned`, stock: 37, catalogueVersion: 3 });
    await expect(
      prisma.productCatalogueVersion.findUnique({
        where: { productId_version: { productId, version: 3 } },
      }),
    ).resolves.toMatchObject({ source: 'RESTORE', summary: 'Restored version 1' });
  });

  it('refuses a restore when the product changed after preview', async () => {
    const productId = await createVersionedProduct();
    const detail = await request(app)
      .get(`/api/v1/products/${productId}/versions/1`)
      .set(auth(ownerToken));
    const preview = (detail.body as VersionDetailBody).data;

    await prisma.product.update({
      where: { id: productId },
      data: { description: 'A newer edit' },
    });

    const restore = await request(app)
      .post(`/api/v1/products/${productId}/versions/1/restore`)
      .set(auth(ownerToken))
      .send({ expectedUpdatedAt: preview.currentUpdatedAt });
    expect(restore.status).toBe(409);
    await expect(prisma.product.findUnique({ where: { id: productId } })).resolves.toMatchObject({
      description: 'A newer edit',
    });
  });

  it('reports a conflict when a restored category no longer exists', async () => {
    const category = await prisma.category.create({
      data: { name: `${RUN} Retired`, slug: `${RUN}-retired` },
    });
    categoryIds.push(category.id);

    const create = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({ name: `${RUN} Categorised`, price: '21.00', categoryId: category.id });
    expect(create.status).toBe(201);
    const productId = (create.body as { data: { row: { id: string } } }).data.row.id;
    productIds.push(productId);

    await prisma.category.delete({ where: { id: category.id } });
    categoryIds.splice(categoryIds.indexOf(category.id), 1);

    const detail = await request(app)
      .get(`/api/v1/products/${productId}/versions/1`)
      .set(auth(ownerToken));
    const preview = (detail.body as VersionDetailBody).data;
    const restore = await request(app)
      .post(`/api/v1/products/${productId}/versions/1/restore`)
      .set(auth(ownerToken))
      .send({ expectedUpdatedAt: preview.currentUpdatedAt });

    expect(restore.status).toBe(409);
    expect(restore.body).toMatchObject({
      error: { message: 'This catalogue version references a category or tag that no longer exists' },
    });
    await expect(prisma.product.findUnique({ where: { id: productId } })).resolves.toMatchObject({
      categoryId: null,
      catalogueVersion: 1,
    });
  });
});
