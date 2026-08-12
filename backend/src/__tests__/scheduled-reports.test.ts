import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { runScheduledReport } from '../services/scheduled-reports.service.js';

/**
 * Scheduled reports (C3.2) — a recurring send of one report to a recipient
 * list. The property worth pinning hardest: `runScheduledReport` (what the
 * cron tick actually calls) NEVER throws — a schedule with a bad report key
 * or an unreachable mail server must not stop the tick's next schedule from
 * running. SMTP is never configured in this test env, so every real "send"
 * degrades to `{ sent: false, reason: 'email_not_configured' }` — the same
 * honest-no-op contract `sendAlertEmail` already has, exercised here rather
 * than mocked, since that degrade path IS the behaviour worth proving.
 */

const app = createApp();

interface ScheduleBody {
  data: {
    id: string;
    reportKey: string;
    frequency: string;
    format: string;
    recipients: string[];
    isActive: boolean;
    lastRunAt: string | null;
    lastRunStatus: string | null;
  };
}
interface ListBody {
  data: ScheduleBody['data'][];
}
interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const RUN = `schedreport-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const scheduleIds: string[] = [];
let ownerToken = '';
let fulfillmentToken = '';

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
  return { id: user.id, token: signToken(user) };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  ownerToken = (await makeUser(StaffRole.OWNER)).token;
  // FULFILLMENT has no `reports` area.
  fulfillmentToken = (await makeUser(StaffRole.FULFILLMENT)).token;
});

afterAll(async () => {
  await prisma.scheduledReport.deleteMany({ where: { id: { in: scheduleIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('creating a schedule', () => {
  it('creates one and records who created it', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: ['manager@example.test'] });

    expect(res.status).toBe(201);
    const body = (res.body as ScheduleBody).data;
    scheduleIds.push(body.id);

    expect(body.reportKey).toBe('overview');
    expect(body.format).toBe('CSV'); // default
    expect(body.isActive).toBe(true); // default
    expect(body.recipients).toEqual(['manager@example.test']);
  });

  it('rejects an unknown report key', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'not-a-real-report', frequency: 'DAILY', recipients: ['x@example.test'] });

    expect(res.status).toBe(400);
  });

  it('rejects "needs-attention" — deliberately live state, not registered as a schedulable report', async () => {
    // Confirms the registry itself, not just this route's validation: a
    // live-state report (see getNeedsAttention's own doc comment) has no
    // date range to compute for a schedule, so it was never added to
    // REPORT_REGISTRY at all rather than being registered and special-cased.
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'needs-attention', frequency: 'DAILY', recipients: ['x@example.test'] });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toContain('Unknown report');
  });

  it('rejects a malformed email in the recipient list', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: ['not-an-email'] });

    expect(res.status).toBe(400);
  });

  it('dedupes recipients rather than storing them twice', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({
        reportKey: 'overview',
        frequency: 'WEEKLY',
        recipients: ['dup@example.test', 'dup@example.test'],
      });

    expect(res.status).toBe(201);
    const body = (res.body as ScheduleBody).data;
    scheduleIds.push(body.id);
    expect(body.recipients).toEqual(['dup@example.test']);
  });

  it('rejects an empty recipient list', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: [] });

    expect(res.status).toBe(400);
  });

  it('is denied to a role without the reports area', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(fulfillmentToken))
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: ['x@example.test'] });

    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-reports')
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: ['x@example.test'] });

    expect(res.status).toBe(401);
  });
});

describe('listing schedules', () => {
  it('includes a created schedule', async () => {
    const created = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'staff-activity', frequency: 'MONTHLY', recipients: ['x@example.test'] });
    scheduleIds.push((created.body as ScheduleBody).data.id);

    const res = await request(app).get('/api/v1/scheduled-reports').set(auth(ownerToken));

    expect(res.status).toBe(200);
    const ids = (res.body as ListBody).data.map((s) => s.id);
    expect(ids).toContain((created.body as ScheduleBody).data.id);
  });
});

describe('updating a schedule', () => {
  it('toggles isActive without touching other fields', async () => {
    const created = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: ['x@example.test'] });
    const id = (created.body as ScheduleBody).data.id;
    scheduleIds.push(id);

    const res = await request(app)
      .patch(`/api/v1/scheduled-reports/${id}`)
      .set(auth(ownerToken))
      .send({ isActive: false });

    expect(res.status).toBe(200);
    const body = (res.body as ScheduleBody).data;
    expect(body.isActive).toBe(false);
    expect(body.reportKey).toBe('overview');
    expect(body.frequency).toBe('DAILY');
  });

  it('404s an unknown schedule', async () => {
    const res = await request(app)
      .patch('/api/v1/scheduled-reports/does-not-exist')
      .set(auth(ownerToken))
      .send({ isActive: false });

    expect(res.status).toBe(404);
  });

  it('rejects an empty update body', async () => {
    const created = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: ['x@example.test'] });
    const id = (created.body as ScheduleBody).data.id;
    scheduleIds.push(id);

    const res = await request(app)
      .patch(`/api/v1/scheduled-reports/${id}`)
      .set(auth(ownerToken))
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('deleting a schedule', () => {
  it('removes it', async () => {
    const created = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: ['x@example.test'] });
    const id = (created.body as ScheduleBody).data.id;

    const res = await request(app).delete(`/api/v1/scheduled-reports/${id}`).set(auth(ownerToken));
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/v1/scheduled-reports').set(auth(ownerToken));
    expect((list.body as ListBody).data.map((s) => s.id)).not.toContain(id);
  });

  it('404s an unknown schedule', async () => {
    const res = await request(app)
      .delete('/api/v1/scheduled-reports/does-not-exist')
      .set(auth(ownerToken));

    expect(res.status).toBe(404);
  });
});

describe('running a schedule (send-now, and the tick path via runScheduledReport directly)', () => {
  it('records a lastRunAt and lastRunStatus after running, honest about SMTP being unconfigured in this env', async () => {
    const created = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: ['x@example.test'] });
    const id = (created.body as ScheduleBody).data.id;
    scheduleIds.push(id);

    const res = await request(app)
      .post(`/api/v1/scheduled-reports/${id}/send-now`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    const outcome = (res.body as { data: { sent: boolean; reason?: string } }).data;
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toBe('email_not_configured');

    const after = await prisma.scheduledReport.findUnique({ where: { id } });
    expect(after?.lastRunAt).not.toBeNull();
    expect(after?.lastRunStatus).toBe('email_not_configured'.slice(0, 16));
  });

  it('never throws for an unknown schedule id — returns a not_found outcome instead', async () => {
    const outcome = await runScheduledReport('does-not-exist');
    expect(outcome).toEqual({ sent: false, reason: 'not_found' });
  });

  it.each(['CSV', 'XLSX', 'PDF'] as const)(
    'runs a %s-formatted schedule without throwing while building its attachment (C3.4)',
    async (format) => {
      const created = await request(app)
        .post('/api/v1/scheduled-reports')
        .set(auth(ownerToken))
        .send({ reportKey: 'category-breakdown', frequency: 'DAILY', format, recipients: ['x@example.test'] });
      const id = (created.body as ScheduleBody).data.id;
      scheduleIds.push(id);
      expect((created.body as ScheduleBody).data.format).toBe(format);

      // Runs the SAME function the cron tick calls — the XLSX/PDF branches
      // (`toXlsx`/`toPdf`) execute for real here, before the email step
      // degrades to a no-op (SMTP is unconfigured in this env). A thrown
      // error inside attachment-building would surface as `reason` naming
      // the error, not the honest 'email_not_configured' — so asserting the
      // reason also proves the attachment step didn't blow up.
      const outcome = await runScheduledReport(id);
      expect(outcome).toEqual({ sent: false, reason: 'email_not_configured' });
    },
  );

  it('is denied to a role without the reports area', async () => {
    const created = await request(app)
      .post('/api/v1/scheduled-reports')
      .set(auth(ownerToken))
      .send({ reportKey: 'overview', frequency: 'DAILY', recipients: ['x@example.test'] });
    const id = (created.body as ScheduleBody).data.id;
    scheduleIds.push(id);

    const res = await request(app)
      .post(`/api/v1/scheduled-reports/${id}/send-now`)
      .set(auth(fulfillmentToken));

    expect(res.status).toBe(403);
  });
});

describe('the engine does not serve scheduled reports', () => {
  it('404s /r/scheduled-reports', async () => {
    const res = await request(app).get('/api/v1/r/scheduled-reports').set(auth(ownerToken));
    expect(res.status).toBe(404);
  });
});
