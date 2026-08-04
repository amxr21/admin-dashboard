import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Image upload. This dev environment has no CLOUDINARY_* env vars set, so
 * the tests that matter here are exactly the ones that don't need a real
 * Cloudinary account: auth is required, an unconfigured server refuses
 * clearly rather than 500ing, and the mimetype allowlist actually rejects
 * a non-image. A real upload is covered by manual/staging verification —
 * see upload.service.ts for why a partial credential set is refused too.
 */

const app = createApp();

interface ErrorBody {
  error: { code: string; message: string };
}

const RUN = `uploadtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
let ownerToken = '';
let demoToken = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `${RUN}-owner@example.test`,
      name: 'Owner',
      role: StaffRole.OWNER,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(owner.id);
  ownerToken = signToken(owner);

  const demo = await prisma.user.create({
    data: {
      email: `${RUN}-demo@example.test`,
      name: 'Demo',
      role: StaffRole.DEMO,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(demo.id);
  demoToken = signToken(demo);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('POST /upload/image', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/v1/upload/image')
      .attach('file', Buffer.from('not-a-real-image'), 'test.png');

    expect(res.status).toBe(401);
  });

  it('blocks a read-only demo account from uploading', async () => {
    const res = await request(app)
      .post('/api/v1/upload/image')
      .set(auth(demoToken))
      .attach('file', Buffer.from('not-a-real-image'), 'test.png');

    expect(res.status).toBe(403);
  });

  it('rejects a non-image file type before ever reaching Cloudinary', async () => {
    const res = await request(app)
      .post('/api/v1/upload/image')
      .set(auth(ownerToken))
      .attach('file', Buffer.from('just some text'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/JPEG|PNG|WEBP|GIF/i);
  });

  it('refuses clearly when Cloudinary is not configured, rather than 500ing', async () => {
    // This dev/test environment has no CLOUDINARY_* vars set — see
    // upload.service.ts's `isUploadConfigured`.
    const res = await request(app)
      .post('/api/v1/upload/image')
      .set(auth(ownerToken))
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/not configured/i);
  });
});
