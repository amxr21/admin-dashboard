import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { StaffRole } from '@prisma/client';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { validateProfileValues } from '../services/organization.service.js';

const app = createApp();
const RUN = `organization-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let ownerId = '';
let staffId = '';
let businessId = '';
let token = '';
let managerToken = '';
const fieldIds: string[] = [];

beforeAll(async () => {
  const owner = await prisma.user.create({ data: { email: `${RUN}-owner@example.test`, passwordHash: 'not-a-login', role: StaffRole.OWNER } });
  const staff = await prisma.user.create({ data: { email: `${RUN}-staff@example.test`, passwordHash: 'not-a-login', role: StaffRole.MANAGER } });
  ownerId = owner.id; staffId = staff.id;
  token = signToken(owner); managerToken = signToken(staff);
  businessId = (await prisma.business.create({ data: { name: RUN } })).id;
});
afterAll(async () => {
  await prisma.organizationProfile.deleteMany({ where: { entityId: { in: [ownerId, staffId, businessId] } } });
  await prisma.organizationField.deleteMany({ where: { id: { in: fieldIds } } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
  await prisma.$disconnect();
});
const auth = () => ({ Authorization: `Bearer ${token}` });
const profilePath = () => `/api/v1/organization/profiles/business/${businessId}`;

describe('organization management', () => {
  it('requires a business-wide owner for read and write access', async () => {
    expect((await request(app).get('/api/v1/organization')).status).toBe(401);
    expect((await request(app).get('/api/v1/organization').set({ Authorization: `Bearer ${managerToken}` })).status).toBe(403);
    expect((await request(app).post('/api/v1/organization/fields').set({ Authorization: `Bearer ${managerToken}` }).send({})).status).toBe(403);
  });

  it('creates fields, validates profile values, and preserves values through archiving', async () => {
    const created = await request(app).post('/api/v1/organization/fields').set(auth()).send({ entityType: 'business', label: `${RUN} License`, type: 'text', required: true });
    expect(created.status).toBe(201);
    const field = created.body as { data: { id: string } };
    const id = field.data.id; fieldIds.push(id);
    expect((await request(app).put(profilePath()).set(auth()).send({ values: {} })).status).toBe(400);
    expect((await request(app).put(profilePath()).set(auth()).send({ values: { [id]: 'LIC-123' } })).status).toBe(200);
    expect((await request(app).patch(`/api/v1/organization/fields/${id}`).set(auth()).send({ type: 'number' })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/organization/fields/${id}`).set(auth()).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/v1/organization/fields/${id}`).set(auth()).send({ isActive: false })).status).toBe(200);
    expect((await request(app).put(profilePath()).set(auth()).send({ values: {} })).status).toBe(200);
    const saved = await prisma.organizationProfile.findUnique({ where: { entityType_entityId: { entityType: 'business', entityId: businessId } } });
    expect(saved?.values).toEqual({ [id]: 'LIC-123' });
    expect((await request(app).patch(`/api/v1/organization/fields/${id}`).set(auth()).send({ isActive: true })).status).toBe(200);
  });

  it('rejects nonexistent records and unrecognized fields', async () => {
    expect((await request(app).get('/api/v1/organization/profiles/business/missing').set(auth())).status).toBe(404);
    expect((await request(app).put(profilePath()).set(auth()).send({ values: { forged: 'value' } })).status).toBe(400);
  });

  it('updates job titles and reporting lines without changing access, and refuses cycles', async () => {
    const path = `/api/v1/organization/profiles/staff/${staffId}`;
    expect((await request(app).put(path).set(auth()).send({ values: {}, jobTitle: 'Floor lead', department: 'Retail', managerId: ownerId })).status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: staffId } }))?.role).toBe(StaffRole.MANAGER);
    const partial = await request(app).put(path).set(auth()).send({ values: {}, managerId: ownerId });
    expect((partial.body as { data: { jobTitle: string; department: string } }).data)
      .toMatchObject({ jobTitle: 'Floor lead', department: 'Retail' });
    const cycle = await request(app).put(`/api/v1/organization/profiles/staff/${ownerId}`).set(auth()).send({ values: {}, managerId: staffId });
    expect(cycle.status).toBe(400);
    expect((cycle.body as { error: { message: string } }).error.message).toMatch(/cycle/);
    expect((await request(app).put(path).set(auth()).send({ values: {}, managerId: staffId })).status).toBe(400);
  });

  it('keeps staff-only structure off business profiles', async () => {
    expect((await request(app).put(profilePath()).set(auth()).send({ values: {}, managerId: ownerId })).status).toBe(400);
  });
});

describe('custom value validation', () => {
  const field = { id: 'field', label: 'Value', type: 'boolean', required: true, isActive: true };
  it('accepts false as an answered required boolean', () => {
    expect(validateProfileValues([field], { field: false })).toEqual({ field: false });
  });
  it('accepts zero as an answered required number', () => {
    expect(validateProfileValues([{ ...field, type: 'number' }], { field: 0 })).toEqual({ field: 0 });
  });
  it('refuses impossible calendar dates', () => {
    expect(() => validateProfileValues([{ ...field, type: 'date' }], { field: '2026-02-30' })).toThrow(/valid value/);
  });
});
