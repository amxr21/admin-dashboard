import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * The external business-profile endpoint (D2).
 *
 * The load-bearing properties here are the two an integrator's security
 * review would ask about: an admin-created API key can read the profile at
 * all, and the payload carries nothing beyond brand identity. The second is
 * asserted as an EXCLUSION list rather than by eyeballing the shape — a
 * future field added to the service would otherwise widen the external
 * payload with every test still green.
 */

const app = createApp();

const RUN = `bizprofile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'correct-horse-battery-staple';
const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];
let staffBranchId = '';

interface CreatedKeyBody {
  data: { id: string; name: string; key: string };
}
interface ProfileBody {
  data: {
    name: string;
    legalName: string | null;
    tagline: string;
    logoUrl: string;
    accentColor: string;
    supportEmail: string;
    branches: { id: string; name: string; isSellingPoint: boolean }[];
  };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

async function makeUser(role: StaffRole, label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${label}@example.test`,
      name: label,
      role,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  createdUserIds.push(user.id);
  if (role !== StaffRole.OWNER && role !== StaffRole.DEVELOPER) {
    await prisma.userBranch.create({
      data: { userId: user.id, branchId: staffBranchId, role },
    });
  }
  return user;
}

/** A live key belonging to a real account, created the way an admin creates
 *  one — through the API, not by writing a row. */
async function makeApiKey(role: StaffRole, label: string): Promise<string> {
  const user = await makeUser(role, label);
  const res = await request(app)
    .post('/api/v1/auth/me/api-keys')
    .set(auth(signToken(user)))
    .send({ purpose: 'Test integration', recipient: 'Test operator', name: `${label} integration` });

  return (res.body as CreatedKeyBody).data.key;
}

beforeAll(async () => {
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  createdBusinessIds.push(business.id);
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: `${RUN} branch` },
  });
  staffBranchId = branch.id;
});

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.userBranch.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.branch.deleteMany({ where: { businessId: { in: createdBusinessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
  await prisma.$disconnect();
});

describe('GET /business/profile — authentication', () => {
  it('answers a valid API key with the brand profile', async () => {
    const key = await makeApiKey(StaffRole.OWNER, 'valid');

    const res = await request(app).get('/api/v1/business/profile').set(auth(key));

    expect(res.status).toBe(200);
    const body = res.body as ProfileBody;
    // The registry defaults are empty strings on a fresh install, so the
    // assertion is on the CONTRACT being present and correctly typed, not on
    // a particular shop's name being filled in.
    expect(typeof body.data.name).toBe('string');
    expect(typeof body.data.accentColor).toBe('string');
    expect(Array.isArray(body.data.branches)).toBe(true);
  });

  it('refuses a request with no credential at all', async () => {
    const res = await request(app).get('/api/v1/business/profile');
    expect(res.status).toBe(401);
  });

  it('refuses a forged key, and says the same thing as a bad session token', async () => {
    const forged = 'adk_' + 'x'.repeat(43);

    const forgedRes = await request(app).get('/api/v1/business/profile').set(auth(forged));
    const badSessionRes = await request(app)
      .get('/api/v1/business/profile')
      .set(auth('not-a-real-jwt'));

    expect(forgedRes.status).toBe(401);
    expect(badSessionRes.status).toBe(401);
    // Telling "revoked key" apart from "unknown key" is free reconnaissance —
    // the same property `api-key.test.ts` pins for /auth/me.
    expect((forgedRes.body as { error: { message: string } }).error.message).toBe(
      (badSessionRes.body as { error: { message: string } }).error.message,
    );
  });

  it('stops answering once the key is revoked', async () => {
    const user = await makeUser(StaffRole.OWNER, 'revoked');
    const token = signToken(user);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Short-lived integration' });
    const created = (createRes.body as CreatedKeyBody).data;

    await request(app).delete(`/api/v1/auth/me/api-keys/${created.id}`).set(auth(token));

    const res = await request(app).get('/api/v1/business/profile').set(auth(created.key));
    expect(res.status).toBe(401);
  });

  it('is readable by a key whose owner is not an OWNER — brand identity is not privileged', async () => {
    // A FULFILLMENT account reads the shop's name off its own sidebar, so a
    // key it created must not be refused the same fact. This pins the
    // deliberate absence of `requireArea` on this route.
    const key = await makeApiKey(StaffRole.FULFILLMENT, 'fulfillment');

    const res = await request(app)
      .get('/api/v1/business/profile')
      .set(auth(key))
      .set('X-Branch-Id', staffBranchId);
    expect(res.status).toBe(200);
  });
});

describe('GET /business/profile — leaks nothing beyond branding', () => {
  it('returns only the allowlisted identity fields', async () => {
    const key = await makeApiKey(StaffRole.OWNER, 'shape');

    const res = await request(app).get('/api/v1/business/profile').set(auth(key));
    const body = res.body as { data: Record<string, unknown> };

    expect(Object.keys(body.data).sort()).toEqual(
      [
        'accentColor',
        'address',
        'branches',
        'currency',
        'legalName',
        'logoUrl',
        'name',
        'supportEmail',
        'supportPhone',
        'tagline',
        'websiteUrl',
      ].sort(),
    );
  });

  it('carries no staff, credential, financial or tax field anywhere in the payload', async () => {
    const staffMember = await makeUser(StaffRole.MANAGER, 'pii-canary');
    const key = await makeApiKey(StaffRole.OWNER, 'no-leak');

    const res = await request(app).get('/api/v1/business/profile').set(auth(key));
    const serialised = JSON.stringify(res.body);

    // A real staff account exists while this runs — if the profile ever grew
    // a staff roster, this address would appear.
    expect(serialised).not.toContain(staffMember.email);

    for (const forbidden of [
      'passwordHash',
      'password',
      'keyHash',
      'apiKey',
      'taxId',
      'revenue',
      'total',
      'DATABASE_URL',
      'mysql://',
      'userId',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('exposes only id/name/code/city/isSellingPoint for each branch', async () => {
    const key = await makeApiKey(StaffRole.OWNER, 'branch-shape');

    const res = await request(app).get('/api/v1/business/profile').set(auth(key));
    const body = res.body as ProfileBody;

    for (const branch of body.data.branches) {
      expect(Object.keys(branch).sort()).toEqual(
        ['city', 'code', 'id', 'isSellingPoint', 'name'].sort(),
      );
    }
  });
});
