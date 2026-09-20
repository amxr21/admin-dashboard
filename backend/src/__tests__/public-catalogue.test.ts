import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { DiscountScope, DiscountType, ProductStatus, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createApiKey } from '../services/api-key.service.js';
import { signCustomerToken } from '../services/customer-auth.service.js';

/**
 * The public catalogue surface: categories and discounts.
 *
 * These endpoints are UNAUTHENTICATED — anyone on the internet reads them — so
 * the load-bearing assertions here are all about what must NOT come back.
 * Every one of them corresponds to a decision in `storefront.service.ts`:
 *
 *   - a deactivated category is invisible (it was not, before this change)
 *   - a CUSTOMER-targeted discount is never published
 *   - `usedCount`/`maxUses` never leak, because together they say how close a
 *     code is to exhaustion
 *   - an expired offer is gone, but a null expiry means "no end date", not
 *     "expired"
 *
 * If one of these starts failing, the fix is the service, not the test.
 */

const app = createApp();

const RUN = `pubcat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const categoryIds: string[] = [];
const productIds: string[] = [];
const discountIds: string[] = [];
const customerIds: string[] = [];
let storefrontKey = '';
let apiKeyOwnerId = '';
let customerToken = '';

function storefrontGet(path: string) {
  return request(app).get(path).set('X-API-Key', storefrontKey);
}

let activeParentId = '';
let inactiveParentId = '';
let orphanedChildId = '';

interface CategoryBody {
  data: { id: string; name: string; slug: string; parentId: string | null }[];
}
interface DiscountBody {
  data: {
    code: string;
    type: string;
    value: string;
    scope: string;
    expiresAt: string | null;
    appliesTo: { id: string; slug: string | null; name: string }[];
  }[];
}

async function makeCategory(label: string, isActive: boolean, parentId?: string) {
  const category = await prisma.category.create({
    data: {
      name: `${RUN} ${label}`,
      slug: `${RUN}-${label}`,
      isActive,
      ...(parentId ? { parentId } : {}),
    },
  });
  categoryIds.push(category.id);
  return category;
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `${RUN}-api@example.test`,
      name: 'Storefront test integration',
      role: StaffRole.OWNER,
      passwordHash: await bcrypt.hash('storefront-test-password', 10),
    },
  });
  apiKeyOwnerId = owner.id;
  storefrontKey = (
    await createApiKey(owner.id, 'Storefront tests', 'Catalogue access', 'Vitest')
  ).key;

  const activeParent = await makeCategory('active-parent', true);
  const inactiveParent = await makeCategory('inactive-parent', false);
  activeParentId = activeParent.id;
  inactiveParentId = inactiveParent.id;

  // Active child of an ACTIVE parent — keeps its parentId.
  await makeCategory('active-child', true, activeParent.id);
  // Active child of a DEACTIVATED parent — the orphan case.
  const orphan = await makeCategory('orphan-child', true, inactiveParent.id);
  orphanedChildId = orphan.id;

  const product = await prisma.product.create({
    data: {
      name: `${RUN} product`,
      slug: `${RUN}-product`,
      price: '10.00',
      status: ProductStatus.ACTIVE,
      categoryId: activeParent.id,
    },
  });
  productIds.push(product.id);

  const customer = await prisma.customer.create({
    data: { name: `${RUN} customer`, email: `${RUN}@example.test` },
  });
  customerIds.push(customer.id);
  customerToken = signCustomerToken(customer);

  const discounts = await Promise.all([
    prisma.discount.create({
      data: {
        code: `${RUN}-ALL`,
        type: DiscountType.PERCENT,
        value: '10.00',
        scope: DiscountScope.ALL,
        isActive: true,
        maxUses: 100,
        usedCount: 37,
      },
    }),
    prisma.discount.create({
      data: {
        code: `${RUN}-CATEGORY`,
        type: DiscountType.FIXED,
        value: '5.00',
        scope: DiscountScope.CATEGORY,
        isActive: true,
        categories: { connect: { id: activeParent.id } },
        // Also connected to a product it does NOT name, to prove `appliesTo`
        // reads only the relation the scope actually names.
        products: { connect: { id: product.id } },
      },
    }),
    prisma.discount.create({
      data: {
        code: `${RUN}-CUSTOMER`,
        type: DiscountType.PERCENT,
        value: '50.00',
        scope: DiscountScope.CUSTOMER,
        isActive: true,
        customers: { connect: { id: customer.id } },
      },
    }),
    prisma.discount.create({
      data: {
        code: `${RUN}-EXPIRED`,
        type: DiscountType.PERCENT,
        value: '90.00',
        scope: DiscountScope.ALL,
        isActive: true,
        expiresAt: new Date(Date.now() - 60_000),
      },
    }),
    prisma.discount.create({
      data: {
        code: `${RUN}-INACTIVE`,
        type: DiscountType.PERCENT,
        value: '80.00',
        scope: DiscountScope.ALL,
        isActive: false,
      },
    }),
  ]);
  discountIds.push(...discounts.map((discount) => discount.id));
});

afterAll(async () => {
  await prisma.discount.deleteMany({ where: { id: { in: discountIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  /**
   * Children before parents: `Category.parentId` is `onDelete: Restrict`, so a
   * parent with any surviving child refuses to delete (P2003).
   *
   * Selected by "has a parent" rather than by naming one id — this run creates
   * two children, and deleting only the one I happened to remember left the
   * other holding its parent hostage.
   */
  await prisma.category.deleteMany({
    where: { id: { in: categoryIds }, parentId: { not: null } },
  });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.apiKey.deleteMany({ where: { userId: apiKeyOwnerId } });
  await prisma.user.delete({ where: { id: apiKeyOwnerId } });
  await prisma.$disconnect();
});

describe('GET /public/categories', () => {
  it('rejects a request without a generated API key', async () => {
    const res = await request(app).get('/api/v1/public/categories');
    expect(res.status).toBe(401);
  });

  it('accepts a valid generated API key', async () => {
    const res = await storefrontGet('/api/v1/public/categories');
    expect(res.status).toBe(200);
  });

  it('rejects an invalid API key', async () => {
    const res = await request(app)
      .get('/api/v1/public/categories')
      .set('X-API-Key', `adk_${'x'.repeat(43)}`);
    expect(res.status).toBe(401);
  });

  it('rejects a revoked API key', async () => {
    const created = await createApiKey(
      apiKeyOwnerId,
      'Revoked storefront test',
      'Revocation boundary',
      'Vitest',
    );
    await prisma.apiKey.update({
      where: { id: created.id },
      data: { revokedAt: new Date() },
    });

    const res = await request(app)
      .get('/api/v1/public/categories')
      .set('X-API-Key', created.key);
    expect(res.status).toBe(401);

  });

  it('rejects a key whose scope does not include the route area', async () => {
    const productsOnly = await createApiKey(
      apiKeyOwnerId,
      'Products-only storefront test',
      'Scope boundary',
      'Vitest',
      ['products'],
    );
    const res = await request(app)
      .get('/api/v1/public/categories')
      .set('X-API-Key', productsOnly.key);
    expect(res.status).toBe(403);
  });

  it('omits a deactivated category', async () => {
    const res = await storefrontGet('/api/v1/public/categories');
    const codes = (res.body as CategoryBody).data.map((row) => row.id);

    expect(codes).toContain(activeParentId);
    expect(codes).not.toContain(inactiveParentId);
  });

  it('reports a child of a deactivated parent as top-level, not dangling', async () => {
    /**
     * The child is still active, so it stays public — but its parent is not in
     * this response. Leaving `parentId` pointing at an absent row would make a
     * client building a tree silently drop the whole subtree.
     */
    const res = await storefrontGet('/api/v1/public/categories');
    const orphan = (res.body as CategoryBody).data.find((row) => row.id === orphanedChildId);

    expect(orphan).toBeDefined();
    expect(orphan?.parentId).toBeNull();
  });

  it('keeps a real parentId when the parent is visible', async () => {
    const res = await storefrontGet('/api/v1/public/categories');
    const child = (res.body as CategoryBody).data.find(
      (row) => row.slug === `${RUN}-active-child`,
    );

    expect(child?.parentId).toBe(activeParentId);
  });

  it('returns no timestamps or internal flags', async () => {
    const res = await storefrontGet('/api/v1/public/categories');
    const row = (res.body as CategoryBody).data.find((entry) => entry.id === activeParentId);

    expect(Object.keys(row ?? {}).sort()).toEqual(['id', 'name', 'parentId', 'slug']);
  });
});

describe('storefront and customer credentials', () => {
  it('accepts X-API-Key and a customer Bearer token together', async () => {
    const res = await request(app)
      .get('/api/v1/public/me')
      .set('X-API-Key', storefrontKey)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect((res.body as { data: { id: string } }).data.id).toBe(customerIds[0]);
  });
});

describe('GET /public/discounts', () => {
  function ours(body: DiscountBody) {
    return body.data.filter((row) => row.code.startsWith(RUN));
  }

  it('NEVER publishes a customer-targeted discount', async () => {
    // The one that would hand every shopper a code meant for one person.
    const res = await storefrontGet('/api/v1/public/discounts');
    const codes = ours(res.body as DiscountBody).map((row) => row.code);

    expect(codes).not.toContain(`${RUN}-CUSTOMER`);
  });

  it('omits expired and deactivated offers', async () => {
    const res = await storefrontGet('/api/v1/public/discounts');
    const codes = ours(res.body as DiscountBody).map((row) => row.code);

    expect(codes).not.toContain(`${RUN}-EXPIRED`);
    expect(codes).not.toContain(`${RUN}-INACTIVE`);
  });

  it('includes an offer with no end date', async () => {
    // A null expiry means "runs until we stop it", not "already expired" — a
    // comparison that excluded nulls would silently hide every open-ended offer.
    const res = await storefrontGet('/api/v1/public/discounts');
    const codes = ours(res.body as DiscountBody).map((row) => row.code);

    expect(codes).toContain(`${RUN}-ALL`);
  });

  it('never leaks usage counts', async () => {
    /**
     * `usedCount` and `maxUses` together say how close a code is to running
     * out — an invitation to race for the last use, and a read on how the
     * promotion is performing.
     */
    const res = await storefrontGet('/api/v1/public/discounts');
    const row = ours(res.body as DiscountBody).find((entry) => entry.code === `${RUN}-ALL`);

    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'appliesTo',
      'code',
      'expiresAt',
      'scope',
      'type',
      'value',
    ]);
  });

  it('serialises value as a fixed-2 string, never a float', async () => {
    const res = await storefrontGet('/api/v1/public/discounts');
    const row = ours(res.body as DiscountBody).find((entry) => entry.code === `${RUN}-ALL`);

    expect(row?.value).toBe('10.00');
  });

  it('reads only the relation the scope names', async () => {
    // The CATEGORY-scoped offer is also connected to a product. Showing that
    // product would misreport what the offer applies to.
    const res = await storefrontGet('/api/v1/public/discounts');
    const row = ours(res.body as DiscountBody).find(
      (entry) => entry.code === `${RUN}-CATEGORY`,
    );

    expect(row?.appliesTo.map((entry) => entry.id)).toEqual([activeParentId]);
  });

  it('reports an empty appliesTo for a store-wide offer', async () => {
    const res = await storefrontGet('/api/v1/public/discounts');
    const row = ours(res.body as DiscountBody).find((entry) => entry.code === `${RUN}-ALL`);

    expect(row?.appliesTo).toEqual([]);
  });
});
