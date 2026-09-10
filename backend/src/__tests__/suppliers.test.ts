import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, StaffRole, StockMovementReason } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { waitFor } from './helpers/wait-for.js';

const sendEmailToRecipients = vi.hoisted(() => vi.fn());
vi.mock('../services/email.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/email.service.js')>()),
  sendEmailToRecipients,
}));

const app = createApp();
const RUN = `suppliers-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const userIds: string[] = [];
const supplierIds: string[] = [];
const productIds: string[] = [];
let ownerToken = '';
let supportToken = '';
let branchA = '';
let branchB = '';
let businessId = '';

interface SupplierBody { data: { id: string; isActive: boolean; phone: string | null } }
interface SupplierListBody { data: { suppliers: { id: string; productCount: number; receiptCount: number }[] } }
interface ProductSuppliersBody { data: { suppliers: { id: string }[] } }

async function user(role: StaffRole) {
  const row = await prisma.user.create({ data: {
    email: `${RUN}-${role.toLowerCase()}@example.test`, name: role, role,
    passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
  } });
  userIds.push(row.id);
  return signToken(row);
}

function auth(token = ownerToken) { return { Authorization: `Bearer ${token}` } as const; }

beforeAll(async () => {
  [ownerToken, supportToken] = await Promise.all([user(StaffRole.OWNER), user(StaffRole.SUPPORT)]);
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessId = business.id;
  const branches = await Promise.all([
    prisma.branch.create({ data: { businessId, name: `${RUN} Marina` } }),
    prisma.branch.create({ data: { businessId, name: `${RUN} Downtown` } }),
  ]);
  branchA = branches[0].id; branchB = branches[1].id;
});

beforeEach(() => { sendEmailToRecipients.mockReset(); sendEmailToRecipients.mockResolvedValue(true); });

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: supplierIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.delete({ where: { id: businessId } });
  await prisma.$disconnect();
});

describe('supplier directory', () => {
  it('enforces authentication and the inventory permission area', async () => {
    expect((await request(app).get('/api/v1/suppliers')).status).toBe(401);
    expect((await request(app).get('/api/v1/suppliers').set(auth(supportToken))).status).toBe(403);
  });

  it('creates, searches, edits and deactivates suppliers', async () => {
    const created = await request(app).post('/api/v1/suppliers').set(auth()).send({
      name: `${RUN} Coffee Co`, email: 'orders@coffee.example', contactName: 'Mina',
    });
    expect(created.status).toBe(201);
    const id = (created.body as SupplierBody).data.id; supplierIds.push(id);

    const listed = await request(app).get(`/api/v1/suppliers?search=${RUN}&active=true`).set(auth());
    expect(listed.status).toBe(200);
    expect((listed.body as SupplierListBody).data.suppliers).toEqual(expect.arrayContaining([expect.objectContaining({ id, productCount: 0, receiptCount: 0 })]));

    const updated = await request(app).patch(`/api/v1/suppliers/${id}`).set(auth()).send({ isActive: false, phone: '+971500000000' });
    expect(updated.status).toBe(200);
    expect((updated.body as SupplierBody).data).toEqual(expect.objectContaining({ isActive: false, phone: '+971500000000' }));
  });
});

describe('receipt-derived product suppliers and outreach', () => {
  async function fixture() {
    const supplier = await prisma.supplier.create({ data: { name: `${RUN} Foods`, email: 'orders@foods.example' } });
    supplierIds.push(supplier.id);
    const product = await prisma.product.create({ data: { name: `${RUN} Oat milk`, price: new Prisma.Decimal('12'), stock: 2, lowStockThreshold: 5 } });
    productIds.push(product.id);
    await prisma.stockMovement.create({ data: {
      productId: product.id, branchId: branchA, supplierId: supplier.id,
      delta: 10, reason: StockMovementReason.RECEIVED, deliveredAt: new Date('2026-09-01T08:00:00Z'),
    } });
    return { supplier, product };
  }

  it('derives suppliers from receiving history and respects the selected branch', async () => {
    const { supplier, product } = await fixture();
    const atA = await request(app).get(`/api/v1/inventory/${product.id}/suppliers`).set(auth()).set('X-Branch-Id', branchA);
    expect((atA.body as ProductSuppliersBody).data.suppliers).toEqual([expect.objectContaining({ id: supplier.id })]);
    const atB = await request(app).get(`/api/v1/inventory/${product.id}/suppliers`).set(auth()).set('X-Branch-Id', branchB);
    expect((atB.body as ProductSuppliersBody).data.suppliers).toEqual([]);
  });

  it('sends editable content only to a historical supplier and audits metadata', async () => {
    const { supplier, product } = await fixture();
    const response = await request(app)
      .post(`/api/v1/inventory/${product.id}/supplier-outreach`)
      .set(auth()).set('X-Branch-Id', branchA)
      .send({ supplierId: supplier.id, subject: 'Restock oats', message: 'Please send 20 units.' });
    expect(response.status).toBe(200);
    expect(sendEmailToRecipients).toHaveBeenCalledWith(['orders@foods.example'], 'Restock oats', 'Please send 20 units.');
    const entry = await waitFor(() => prisma.auditLog.findFirst({ where: { action: 'supplier.outreach.sent', entityId: supplier.id } }));
    expect(entry?.changes).not.toContain('Please send 20 units');
  });

  it('revalidates low stock at send time', async () => {
    const { supplier, product } = await fixture();
    await prisma.product.update({ where: { id: product.id }, data: { stock: 20 } });
    const response = await request(app).post(`/api/v1/inventory/${product.id}/supplier-outreach`).set(auth()).set('X-Branch-Id', branchA).send({ supplierId: supplier.id, subject: 'Restock', message: 'Please send.' });
    expect(response.status).toBe(409);
    expect(sendEmailToRecipients).not.toHaveBeenCalled();
  });

  it('does not claim success when mail cannot be sent', async () => {
    const { supplier, product } = await fixture();
    sendEmailToRecipients.mockResolvedValue(false);
    const response = await request(app).post(`/api/v1/inventory/${product.id}/supplier-outreach`).set(auth()).set('X-Branch-Id', branchA).send({ supplierId: supplier.id, subject: 'Restock', message: 'Please send.' });
    expect(response.status).toBe(503);
  });
});
