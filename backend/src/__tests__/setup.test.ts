import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { AppError } from '../errors/AppError.js';

const mocks = vi.hoisted(() => {
  const setting = { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() };
  const rolePermission = { findMany: vi.fn(), upsert: vi.fn() };
  // `settingsRouter` mounts the real `withBranchContext`, which resolves the
  // caller's branch role through `prisma.user`. Unmocked it throws a plain
  // Error and the handler reports 500, hiding the 400 this suite asserts.
  const user = { findUnique: vi.fn(), findFirst: vi.fn() };
  const userBranch = { findUnique: vi.fn() };
  const probes = Object.fromEntries(['order', 'stockMovement', 'supplier', 'deliveryAssignment', 'return', 'scheduledReport', 'customerCase', 'user', 'branch'].map(key => [key, { findFirst: vi.fn() }]));
  return { setting, rolePermission, probes, user, userBranch, transaction: vi.fn(), audit: vi.fn(), auditDenied: vi.fn() };
});
// `user` is spread last on purpose: `probes.user` only needs `findFirst`, while
// branch resolution also needs `findUnique`, and this mock carries both.
vi.mock('../db/prisma.js', () => ({ prisma: { setting: mocks.setting, rolePermission: mocks.rolePermission, ...mocks.probes, user: mocks.user, userBranch: mocks.userBranch, $transaction: mocks.transaction } }));
vi.mock('../services/audit.service.js', () => ({ audit: mocks.audit, auditDenied: mocks.auditDenied }));
vi.mock('../middleware/authenticate.js', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    const role = req.headers['x-test-role'];
    if (!role) return next(AppError.unauthorized());
    req.user = { id: 'owner-id', email: 'owner@example.test', role: role as StaffRole } as Request['user'];
    req.log = { warn: vi.fn(), info: vi.fn() } as unknown as Request['log'];
    next();
  },
  requireUser: (req: Request) => { if (!req.user) throw AppError.unauthorized(); return req.user; },
}));

import { setupRouter } from '../routes/v1/setup.route.js';
import { settingsRouter } from '../routes/v1/settings.route.js';
import { setupTemplate } from '../config/setup.config.js';
import { clearRolePermissionCache } from '../services/role-permissions.service.js';

const app = express();
app.use(express.json(), setupRouter, settingsRouter);
app.use((error: AppError, _req: Request, res: Response, _next: NextFunction) => { res.status(error.statusCode ?? 500).json({ error: { message: error.message } }); });

beforeEach(() => {
  vi.clearAllMocks(); clearRolePermissionCache();
  mocks.setting.findMany.mockResolvedValue([]);
  mocks.setting.findUnique.mockResolvedValue(null);
  mocks.setting.upsert.mockResolvedValue({});
  mocks.rolePermission.findMany.mockResolvedValue([]);
  mocks.rolePermission.upsert.mockResolvedValue({});
  for (const probe of Object.values(mocks.probes)) probe.findFirst.mockResolvedValue(null);
  mocks.user.findFirst.mockResolvedValue(null);
  mocks.user.findUnique.mockResolvedValue({ role: StaffRole.OWNER });
  mocks.userBranch.findUnique.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ setting: mocks.setting, rolePermission: mocks.rolePermission }));
});

describe('setup API and persistence', () => {
  it.each(['get', 'put', 'post'] as const)('rejects an unauthenticated %s', async method => {
    const path = method === 'post' ? '/setup/preview' : '/setup';
    expect((await request(app)[method](path).send(setupTemplate('CAFE'))).status).toBe(401);
  });
  it.each(['MANAGER', 'CASHIER', 'SUPPORT', 'FULFILLMENT', 'DEMO'])('refuses %s for every setup action', async role => {
    for (const [method, path] of [['get', '/setup'], ['put', '/setup'], ['post', '/setup/preview'], ['post', '/setup/skip']] as const) {
      expect((await request(app)[method](path).set('x-test-role', role).send(setupTemplate('CAFE'))).status).toBe(403);
    }
    expect(mocks.setting.findMany).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('reads defaults and declared templates for an owner', async () => {
    const response = await request(app).get('/setup').set('x-test-role', 'OWNER');
    expect(response.status).toBe(200);
    const body = response.body as { data: { templates: unknown[]; current: { features: Record<string, boolean> }; completedAt: string | null } };
    expect(body.data.templates).toHaveLength(18);
    expect(body.data.current.features.delivery).toBe(true);
    expect(body.data.completedAt).toBeNull();
  });
  it('preview warns about existing data without saving', async () => {
    mocks.probes['deliveryAssignment']!.findFirst.mockResolvedValue({ id: 'existing' });
    const response = await request(app).post('/setup/preview').set('x-test-role', 'OWNER').send(setupTemplate('CAFE'));
    expect((response.body as { data: { warnings: unknown[] } }).data.warnings).toContainEqual({ code: 'existingData', feature: 'delivery', severity: 'warning' });
    expect(mocks.setting.upsert).not.toHaveBeenCalled();
  });
  it('skip writes only skippedAt and audits, preserving feature choices', async () => {
    const response = await request(app).post('/setup/skip').set('x-test-role', 'OWNER').send({});
    expect(response.status).toBe(200);
    expect(mocks.setting.upsert).toHaveBeenCalledTimes(1);
    const [firstUpsert] = mocks.setting.upsert.mock.calls as [{ where: { key: string } }][];
    expect(firstUpsert?.[0].where.key).toBe('setup.skippedAt');
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'setup.skipped' }));
  });
  it('applies normalized choices and explicit role edits in the same transaction, then audits', async () => {
    const draft = setupTemplate('CAFE'); draft.features.orders = false;
    draft.rolePermissions = { CASHIER: ['orders'] };
    const response = await request(app).put('/setup').set('x-test-role', 'OWNER').send(draft);
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'features.orders.enabled' }, update: { value: true } }));
    expect(mocks.rolePermission.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { role: 'CASHIER' }, update: { areas: ['orders'], updatedById: 'owner-id' } }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'setup.applied' }));
  });
  it('does not report success or audit an apply if the transaction fails', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('transaction failed'));
    expect((await request(app).put('/setup').set('x-test-role', 'OWNER').send(setupTemplate('CAFE'))).status).toBe(500);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('rejects invalid setup before writing and protects setup keys from generic Settings writes', async () => {
    expect((await request(app).put('/setup').set('x-test-role', 'OWNER').send({ ...setupTemplate('CAFE'), features: { bad: true } })).status).toBe(400);
    const result = await request(app).patch('/settings').set('x-test-role', 'OWNER').send({ 'features.pos.enabled': false });
    expect(result.status).toBe(400);
    expect(mocks.setting.upsert).not.toHaveBeenCalled();
  });
});
