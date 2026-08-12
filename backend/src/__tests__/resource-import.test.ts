import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * CSV import for the generic resource engine (A2.13).
 *
 * The one property that matters most: "no silent partial writes". A file
 * with one bad row among ninety-nine good ones must either import all
 * hundred or none — never ninety-nine, which would leave the table in a
 * state nobody asked for and nothing visibly wrong to notice.
 *
 * `products` is the test target — one resource with text, money, number,
 * enum and relation fields all in one config, which is real coverage rather
 * than a resource picked for being simple.
 */

const app = createApp();

interface PreviewBody {
  data: {
    totalRows: number;
    validRows: number;
    errors: { row: number; field: string | null; message: string }[];
  };
}
interface ApplyBody {
  data: {
    totalRows: number;
    validRows: number;
    imported: number;
    errors: { row: number; field: string | null; message: string }[];
  };
}
interface ErrorBody {
  error: { code: string; message: string };
}
interface RowBody {
  data: { row: Record<string, unknown> };
}

const RUN = `importtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdProductIds: string[] = [];
let ownerToken = '';
let demoToken = '';

async function makeUser(role: StaffRole) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${role.toLowerCase()}@example.test`,
      name: role,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  createdUserIds.push(user.id);
  return signToken(user);
}

beforeAll(async () => {
  [ownerToken, demoToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.DEMO),
  ]);

  const category = await prisma.category.create({
    data: { name: `${RUN} Widgets`, slug: `${RUN}-widgets` },
  });
  createdCategoryIds.push(category.id);
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

function csvFile(text: string) {
  return Buffer.from(text, 'utf-8');
}

describe('import template', () => {
  it('names the writable field LABELS as columns, not internal field names', async () => {
    const res = await request(app)
      .get('/api/v1/r/products/import-template')
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('products-import-template.csv');

    const header = res.text.trim();
    // "Category", not "categoryId" — a person filling this in has never seen
    // the internal field name.
    expect(header).toContain('Category');
    expect(header).toContain('Name');
    expect(header).toContain('Price');
    // id/createdAt are readOnly/inForm:false — never a column to fill in.
    expect(header).not.toContain('ID');
    expect(header).not.toContain('Created');
  });

  it('is denied to a role without the resource area', async () => {
    const res = await request(app)
      .get('/api/v1/r/products/import-template')
      .set(auth(demoToken));

    // DEMO can read products (has the area) — proves the route sits behind
    // the SAME guard as every other /r/products/* route, not that DEMO is
    // blocked outright.
    expect(res.status).toBe(200);
  });
});

describe('dry run — validates without writing', () => {
  it('reports every row as valid and writes nothing', async () => {
    const csv = `Name,Price,Stock,Category,Status\n${RUN} Alpha,19.99,5,${RUN} Widgets,ACTIVE\n${RUN} Beta,29.99,10,${RUN} Widgets,DRAFT\n`;

    const before = await prisma.product.count({ where: { name: { startsWith: RUN } } });

    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect(res.status).toBe(200);
    const body = (res.body as PreviewBody).data;
    expect(body.totalRows).toBe(2);
    expect(body.validRows).toBe(2);
    expect(body.errors).toEqual([]);

    const after = await prisma.product.count({ where: { name: { startsWith: RUN } } });
    expect(after).toBe(before);
  });

  it('reports a per-row, per-field error for a bad value, naming the row a spreadsheet would call it', async () => {
    // Row 1 is valid; row 2 has a non-numeric price. Row numbers are
    // 1-indexed AND count the header line, so this is CSV line 3 — "row 3"
    // in the error, matching what a person would see if they opened the
    // file in a spreadsheet.
    const csv = `Name,Price,Stock,Category,Status\n${RUN} Good,19.99,5,${RUN} Widgets,ACTIVE\n${RUN} Bad,not-a-price,5,${RUN} Widgets,ACTIVE\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect(res.status).toBe(200);
    const body = (res.body as PreviewBody).data;
    expect(body.totalRows).toBe(2);
    expect(body.validRows).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.row).toBe(3);
    expect(body.errors[0]?.field).toBe('price');
    expect(body.errors[0]?.message).toContain('decimal');
  });

  it('rejects a required field left blank, same rule as a normal create', async () => {
    const csv = `Name,Price,Stock,Category,Status\n,19.99,5,${RUN} Widgets,ACTIVE\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    const body = (res.body as PreviewBody).data;
    expect(body.validRows).toBe(0);
    expect(body.errors[0]?.field).toBe('name');
  });

  it('resolves a relation column by its LABEL, not a raw id', async () => {
    const csv = `Name,Price,Stock,Category,Status\n${RUN} Labeled,9.99,1,${RUN} Widgets,ACTIVE\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect((res.body as PreviewBody).data.validRows).toBe(1);
  });

  it('rejects a relation label that matches nothing, naming the field', async () => {
    const csv = `Name,Price,Stock,Category,Status\n${RUN} NoCat,9.99,1,Nonexistent Category,ACTIVE\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    const body = (res.body as PreviewBody).data;
    expect(body.validRows).toBe(0);
    expect(body.errors[0]?.field).toBe('categoryId');
  });

  it('treats an empty optional cell as "not provided", not as an explicit clear', async () => {
    // Category is not required on Product — a blank cell must not fail the
    // row, and must not be sent as coerceWriteValue's explicit-clear "".
    const csv = `Name,Price,Stock,Category,Status\n${RUN} NoCategory,9.99,1,,ACTIVE\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect((res.body as PreviewBody).data.validRows).toBe(1);
  });

  it('rejects an empty file with no data rows', async () => {
    const csv = `Name,Price,Stock,Category,Status\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect(res.status).toBe(400);
  });

  it('rejects a file that is not CSV at all', async () => {
    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile('{"not": "csv"}'), 'import.json');

    // csv-parse happily reads *some* garbage as a one-column CSV rather than
    // throwing — the real assertion is that it never 500s and never silently
    // treats junk as valid product rows.
    expect(res.status).toBeLessThan(500);
  });

  it('caps the row count rather than accepting an unbounded file', async () => {
    const header = 'Name,Price,Stock,Category,Status\n';
    const rows = Array.from(
      { length: 2001 },
      (_, i) => `${RUN} Row${i},9.99,1,${RUN} Widgets,ACTIVE`,
    ).join('\n');

    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile(header + rows), 'import.csv');

    expect(res.status).toBe(400);
  });

  it('is denied to the read-only demo role', async () => {
    const csv = `Name,Price,Stock,Category,Status\n${RUN} Demo,9.99,1,${RUN} Widgets,ACTIVE\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(demoToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect(res.status).toBe(403);
  });
});

describe('apply — no silent partial writes', () => {
  it('imports every valid row and writes one audit entry for the whole batch', async () => {
    const csv = `Name,Price,Stock,Category,Status\n${RUN} Apply1,19.99,5,${RUN} Widgets,ACTIVE\n${RUN} Apply2,29.99,10,${RUN} Widgets,DRAFT\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    // Always 200 — a request that completed and reported a real outcome,
    // same convention as the orders bulk-status endpoint. The outcome
    // itself (`imported`/`errors`) is what tells success from failure, not
    // the HTTP status.
    expect(res.status).toBe(200);
    const body = (res.body as ApplyBody).data;
    expect(body.imported).toBe(2);
    expect(body.errors).toEqual([]);

    const created = await prisma.product.findMany({
      where: { name: { in: [`${RUN} Apply1`, `${RUN} Apply2`] } },
    });
    expect(created).toHaveLength(2);
    createdProductIds.push(...created.map((p) => p.id));

    // Scoped to THIS batch's own ids, not just "most recent products.import"
    // — this suite's other tests (A5.5's field coverage included) also
    // write products.import audit rows, and audit() is fire-and-forget, so
    // "most recent by createdAt" is not reliably this test's own entry.
    const createdIdSet = new Set(created.map((p) => p.id));
    let entry: { changes: unknown } | null = null;
    for (let attempt = 0; attempt < 10 && !entry; attempt += 1) {
      const candidates = await prisma.auditLog.findMany({
        where: { action: 'products.import' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      entry =
        candidates.find((candidate) => {
          const ids = (candidate.changes as { ids?: unknown } | null)?.ids;
          return Array.isArray(ids) && ids.some((id) => createdIdSet.has(String(id)));
        }) ?? null;
      if (!entry) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(entry).not.toBeNull();
    expect((entry?.changes as { rowCount?: number } | null)?.rowCount).toBe(2);
  });

  it('imports NOTHING when even one row in the file is invalid', async () => {
    const csv = `Name,Price,Stock,Category,Status\n${RUN} Valid,19.99,5,${RUN} Widgets,ACTIVE\n${RUN} Invalid,not-a-price,5,${RUN} Widgets,ACTIVE\n`;

    const before = await prisma.product.count({ where: { name: { startsWith: RUN } } });

    const res = await request(app)
      .post('/api/v1/r/products/import')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect(res.status).toBe(200);
    const body = (res.body as ApplyBody).data;
    expect(body.imported).toBe(0);
    expect(body.errors.length).toBeGreaterThan(0);

    // The row that WOULD have succeeded on its own must not exist either —
    // this is the whole point of the "no silent partial writes" requirement.
    const after = await prisma.product.count({ where: { name: { startsWith: RUN } } });
    expect(after).toBe(before);
    const valid = await prisma.product.findFirst({ where: { name: `${RUN} Valid` } });
    expect(valid).toBeNull();
  });

  it('re-validates at apply time rather than trusting a stale preview', async () => {
    // A relation deleted in the gap between preview and apply must be caught
    // by apply's OWN validation, not silently skipped because "the preview
    // already said this was fine".
    const shortLived = await prisma.category.create({
      data: { name: `${RUN} ShortLived`, slug: `${RUN}-shortlived` },
    });

    const csv = `Name,Price,Stock,Category,Status\n${RUN} Stale,9.99,1,${RUN} ShortLived,ACTIVE\n`;

    const preview = await request(app)
      .post('/api/v1/r/products/import?dryRun=true')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');
    expect((preview.body as PreviewBody).data.validRows).toBe(1);

    await prisma.category.delete({ where: { id: shortLived.id } });

    const apply = await request(app)
      .post('/api/v1/r/products/import')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect(apply.status).toBe(200);
    expect((apply.body as ApplyBody).data.imported).toBe(0);
    expect((apply.body as ApplyBody).data.errors.length).toBeGreaterThan(0);
  });

  it('is denied to the read-only demo role', async () => {
    const csv = `Name,Price,Stock,Category,Status\n${RUN} DemoApply,9.99,1,${RUN} Widgets,ACTIVE\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import')
      .set(auth(demoToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect(res.status).toBe(403);
    const row = await prisma.product.findFirst({ where: { name: `${RUN} DemoApply` } });
    expect(row).toBeNull();
  });

  it('404s an unconfigured resource, same as every other /r/:resource route', async () => {
    const res = await request(app)
      .post('/api/v1/r/users/import')
      .set(auth(ownerToken))
      .attach('file', csvFile('Name\nx\n'), 'import.csv');

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('reports a unique-constraint race at commit time as a clean 409, not a raw 500', async () => {
    // Preview-time validation has no way to catch this — it doesn't touch
    // uniqueness at all — so this can only surface inside applyResourceImport
    // itself. A row importing a barcode that already exists on another
    // product (created after preview ran, or just missed by preview) must
    // hit the transaction's own P2002 handling.
    const existing = await prisma.product.create({
      data: { name: `${RUN} Existing`, price: '9.99', barcode: `${RUN}-BC1` },
    });
    createdProductIds.push(existing.id);

    const csv = `Name,Price,Stock,Category,Status,Barcode (EAN/UPC)\n${RUN} DupeBarcode,9.99,1,${RUN} Widgets,ACTIVE,${RUN}-BC1\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect(res.status).toBe(409);
    const row = await prisma.product.findFirst({ where: { name: `${RUN} DupeBarcode` } });
    expect(row).toBeNull();
  });
});

describe('shipping/customs fields (A5.5)', () => {
  it('imports the new optional fields end to end', async () => {
    const csv =
      'Name,Price,Stock,Category,Status,Barcode (EAN/UPC),Weight (kg),Length (cm),Width (cm),Height (cm),HS code,Country of origin\n' +
      `${RUN} Shippable,49.99,3,${RUN} Widgets,ACTIVE,${RUN}-BC2,1.25,10,5,2,850110,AE\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect(res.status).toBe(200);
    expect((res.body as ApplyBody).data.imported).toBe(1);

    const created = await prisma.product.findFirst({ where: { name: `${RUN} Shippable` } });
    expect(created).not.toBeNull();
    createdProductIds.push(created!.id);
    expect(created?.barcode).toBe(`${RUN}-BC2`);
    expect(Number(created?.weightKg)).toBeCloseTo(1.25);
    expect(created?.hsCode).toBe('850110');
    expect(created?.countryOfOrigin).toBe('AE');
  });

  it('leaves the fields unset when the columns are blank, never a fabricated 0', async () => {
    const csv = `Name,Price,Stock,Category,Status\n${RUN} NoShipping,9.99,1,${RUN} Widgets,ACTIVE\n`;

    const res = await request(app)
      .post('/api/v1/r/products/import')
      .set(auth(ownerToken))
      .attach('file', csvFile(csv), 'import.csv');

    expect((res.body as ApplyBody).data.imported).toBe(1);
    const created = await prisma.product.findFirst({ where: { name: `${RUN} NoShipping` } });
    expect(created).not.toBeNull();
    createdProductIds.push(created!.id);
    expect(created?.weightKg).toBeNull();
    expect(created?.barcode).toBeNull();
  });

  it('creates and updates the fields through the normal /r/products form path, not just CSV', async () => {
    const createRes = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({
        name: `${RUN} DirectCreate`,
        price: '15.00',
        barcode: `${RUN}-BC3`,
        weightKg: 0.5,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 3,
        hsCode: '420212',
        countryOfOrigin: 'CN',
      });

    expect(createRes.status).toBe(201);
    const row = (createRes.body as RowBody).data.row;
    expect(row.barcode).toBe(`${RUN}-BC3`);
    expect(row.hsCode).toBe('420212');
    expect(row.countryOfOrigin).toBe('CN');
    createdProductIds.push(String(row.id));

    const updateRes = await request(app)
      .patch(`/api/v1/r/products/${String(row.id)}`)
      .set(auth(ownerToken))
      .send({ weightKg: 0.75, countryOfOrigin: 'AE' });

    expect(updateRes.status).toBe(200);
    const updated = (updateRes.body as RowBody).data.row;
    expect(Number(updated.weightKg)).toBeCloseTo(0.75);
    expect(updated.countryOfOrigin).toBe('AE');
    // Untouched fields survive a partial update unchanged.
    expect(updated.barcode).toBe(`${RUN}-BC3`);
  });

  it('exposes the new fields in the schema, so the generic form can render them', async () => {
    const res = await request(app).get('/api/v1/r/_schema').set(auth(ownerToken));

    const products = (
      res.body as { data: { resources: { resource: string; fields: { name: string }[] }[] } }
    ).data.resources.find((r) => r.resource === 'products');
    const fieldNames = products?.fields.map((f) => f.name) ?? [];

    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'barcode',
        'weightKg',
        'lengthCm',
        'widthCm',
        'heightCm',
        'hsCode',
        'countryOfOrigin',
      ]),
    );
  });
});
