import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * The bespoke notifications actions — see notifications.route.ts for why
 * "mark as read" (one, or all) needed its own routes rather than living in
 * the generic `/r/notifications` engine, and why that engine's `update` is
 * now `false`.
 */

const app = createApp();

interface MarkAllBody {
  data: { updated: number };
}
interface MarkOneBody {
  data: { notification: { id: string; isRead: boolean } };
}
interface ErrorBody {
  error: { code: string; message: string };
}

const RUN = `notiftest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const notificationIds: string[] = [];
let ownerToken = '';
let supportToken = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
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

async function makeNotification(isRead: boolean) {
  const notification = await prisma.notification.create({
    data: { type: `${RUN}-type`, title: `${RUN} notification`, isRead },
  });
  notificationIds.push(notification.id);
  return notification.id;
}

beforeAll(async () => {
  [ownerToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    // SUPPORT does not have the `settings` area.
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('PATCH /notifications/mark-all-read', () => {
  it('rejects an unauthenticated request', async () => {
    expect(
      (await request(app).patch('/api/v1/notifications/mark-all-read')).status,
    ).toBe(401);
  });

  it('denies a role without the settings area', async () => {
    const res = await request(app)
      .patch('/api/v1/notifications/mark-all-read')
      .set(auth(supportToken));

    expect(res.status).toBe(403);
  });

  it('marks every unread notification read and leaves already-read ones alone', async () => {
    await makeNotification(false);
    await makeNotification(false);
    const alreadyRead = await makeNotification(true);

    const res = await request(app)
      .patch('/api/v1/notifications/mark-all-read')
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as MarkAllBody).data.updated).toBeGreaterThanOrEqual(2);

    const stillUnread = await prisma.notification.count({
      where: { id: { in: notificationIds }, isRead: false },
    });
    expect(stillUnread).toBe(0);

    const untouched = await prisma.notification.findUnique({ where: { id: alreadyRead } });
    expect(untouched?.isRead).toBe(true);
  });
});

describe('PATCH /notifications/:id/read', () => {
  it('marks a single notification read', async () => {
    const id = await makeNotification(false);

    const res = await request(app)
      .patch(`/api/v1/notifications/${id}/read`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as MarkOneBody).data.notification.isRead).toBe(true);
  });

  it('is idempotent — reading an already-read notification is a no-op 200', async () => {
    const id = await makeNotification(true);

    const res = await request(app)
      .patch(`/api/v1/notifications/${id}/read`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
  });

  it('404s for an unknown id', async () => {
    const res = await request(app)
      .patch('/api/v1/notifications/does-not-exist/read')
      .set(auth(ownerToken));

    expect(res.status).toBe(404);
  });
});

describe('the generic /r/notifications engine', () => {
  it('has no edit capability — PATCH is rejected even for an owner', async () => {
    const id = await makeNotification(false);

    const res = await request(app)
      .patch(`/api/v1/r/notifications/${id}`)
      .set(auth(ownerToken))
      .send({ isRead: true });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.message).toMatch(/update/i);
  });

  it('still allows delete — dismissing a notification', async () => {
    const id = await makeNotification(false);

    const res = await request(app)
      .delete(`/api/v1/r/notifications/${id}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);

    const removed = notificationIds.indexOf(id);
    if (removed !== -1) notificationIds.splice(removed, 1);
  });
});
