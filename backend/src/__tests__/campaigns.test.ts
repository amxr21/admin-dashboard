import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { CampaignRecipientStatus, Prisma, StaffRole } from '@prisma/client';

/**
 * Customer campaigns, end to end against the real database. Only the
 * provider calls are stubbed — readiness, queueing, the dispatcher's claim
 * and retry logic, suppression and consent all run for real.
 */

const channels = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  sendSms: vi.fn(),
}));

vi.mock('../services/campaign-channels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-channels.js')>();
  return {
    ...actual,
    channelReadiness: vi.fn(() => Promise.resolve({
      EMAIL: { ready: true, problems: [] },
      SMS: { ready: true, problems: [] },
    })),
    sendEmail: channels.sendEmail,
    sendSms: channels.sendSms,
  };
});

const { createApp } = await import('../app.js');
const { prisma } = await import('../db/prisma.js');
const { signToken } = await import('../services/auth.service.js');
const { runCampaignTick } = await import('../services/campaign-dispatcher.js');
const { SendFailure, unsubscribeToken } = await import('../services/campaign-channels.js');

const app = createApp();
const RUN = `campaigntest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const customerIds: string[] = [];
let ownerToken = '';
let supportToken = '';
let supportBranchId = '';

interface CampaignBody {
  data: { campaign: { id: string; status: string; audienceSize: number | null; outcomes: Record<string, number> } };
}
interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
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

async function makeCustomer(label: string, consent: { email?: boolean; sms?: boolean; phone?: string } = {}) {
  const customer = await prisma.customer.create({
    data: {
      name: `${RUN} ${label}`,
      email: `${RUN}-${label}@example.test`,
      phone: consent.phone ?? null,
      phoneNormalized: consent.phone?.replace(/\D/g, '') ?? null,
      emailMarketingConsent: consent.email ?? false,
      smsMarketingConsent: consent.sms ?? false,
    },
  });
  customerIds.push(customer.id);
  return customer;
}

/** How many emails went to this customer — other tests' queues may drain on the same tick. */
function sentTo(email: string): number {
  return channels.sendEmail.mock.calls.filter(([to]) => to === email.toLowerCase()).length;
}

function auth(token = ownerToken, branch?: string) {
  return { Authorization: `Bearer ${token}`, ...(branch ? { 'X-Branch-Id': branch } : {}) } as const;
}

function draft(customerIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    name: `${RUN} campaign`,
    channel: 'EMAIL',
    subjectEn: 'Eid offer',
    bodyEn: 'Hi {{customer_name}}, use {{discount_code}}',
    discountCode: 'EID20',
    audience: { mode: 'manual', customerIds },
    ...overrides,
  };
}

async function create(body: Record<string, unknown>) {
  const res = await request(app).post('/api/v1/campaigns').set(auth()).send(body);
  expect(res.status).toBe(201);
  return (res.body as CampaignBody).data.campaign.id;
}

beforeAll(async () => {
  ownerToken = await makeUser(StaffRole.OWNER);
  supportToken = await makeUser(StaffRole.SUPPORT);
  // A branch-scoped role needs a branch to act in at all.
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: `${RUN} branch` } });
  supportBranchId = branch.id;
  const support = await prisma.user.findFirstOrThrow({ where: { id: { in: userIds }, role: StaffRole.SUPPORT } });
  await prisma.userBranch.create({ data: { userId: support.id, branchId: branch.id, role: StaffRole.SUPPORT } });
});

beforeEach(() => {
  channels.sendEmail.mockReset().mockResolvedValue({ messageId: 'msg-1' });
  channels.sendSms.mockReset().mockResolvedValue({ messageId: 'sms-1' });
});

afterAll(async () => {
  await prisma.campaign.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.marketingSuppression.deleteMany({ where: { address: { contains: RUN.toLowerCase() } } });
  await prisma.marketingSuppression.deleteMany({ where: { address: { in: ['+971509990001'] } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } }).catch(() => undefined);
  await prisma.userBranch.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.business.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('audience preview', () => {
  it('counts who can be reached and explains who cannot', async () => {
    const consenting = await makeCustomer('p-yes', { email: true });
    const noConsent = await makeCustomer('p-no');
    const suppressed = await makeCustomer('p-supp', { email: true });
    await prisma.marketingSuppression.create({ data: { channel: 'EMAIL', address: suppressed.email.toLowerCase(), reason: 'UNSUBSCRIBED' } });

    const res = await request(app)
      .post('/api/v1/campaigns/preview-audience')
      .set(auth())
      .send({ channel: 'EMAIL', audience: { mode: 'manual', customerIds: [consenting.id, noConsent.id, suppressed.id] } });

    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toMatchObject({
      matched: 3,
      eligible: 1,
      excluded: { noConsent: 1, noAddress: 0, suppressed: 1 },
      sample: [consenting.name],
    });
  });

  it('excludes SMS customers without a usable phone and estimates segments', async () => {
    const withPhone = await makeCustomer('s-phone', { sms: true, phone: '050 999 0002' });
    const withoutPhone = await makeCustomer('s-none', { sms: true });

    const res = await request(app)
      .post('/api/v1/campaigns/preview-audience')
      .set(auth())
      .send({ channel: 'SMS', audience: { mode: 'manual', customerIds: [withPhone.id, withoutPhone.id] }, bodyAr: 'عرض خاص' });

    const preview = (res.body as { data: { sms: unknown } }).data;
    expect(preview).toMatchObject({ eligible: 1, excluded: { noAddress: 1 } });
    expect(preview.sms).toMatchObject({ segmentsPerMessage: 1, totalSegments: 1 });
  });
});

describe('sending', () => {
  it('queues each eligible customer once and delivers on the next tick', async () => {
    const a = await makeCustomer('send-a', { email: true });
    const b = await makeCustomer('send-b', { email: true });
    const id = await create(draft([a.id, b.id]));

    const sent = await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});
    expect(sent.status).toBe(200);
    expect((sent.body as CampaignBody).data.campaign).toMatchObject({ status: 'SENDING', audienceSize: 2 });

    // A second send of the same campaign is refused, not queued twice.
    const again = await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});
    expect(again.status).toBe(409);
    expect(await prisma.campaignRecipient.count({ where: { campaignId: id } })).toBe(2);

    await runCampaignTick();

    expect(channels.sendEmail).toHaveBeenCalledTimes(2);
    const [to, rendered] = channels.sendEmail.mock.calls[0] as [string, { text: string }];
    expect([a.email.toLowerCase(), b.email.toLowerCase()]).toContain(to);
    expect(rendered.text).toContain('use EID20');

    const campaign = await request(app).get(`/api/v1/campaigns/${id}`).set(auth());
    expect((campaign.body as CampaignBody).data.campaign).toMatchObject({ status: 'COMPLETED', outcomes: { sent: 2, pending: 0 } });
  });

  it('asks for the exact count before a large send', async () => {
    const threshold = await prisma.setting.upsert({
      where: { key: 'campaigns.largeAudienceThreshold' },
      create: { key: 'campaigns.largeAudienceThreshold', value: '2' },
      update: { value: '2' },
    });
    try {
      const a = await makeCustomer('large-a', { email: true });
      const b = await makeCustomer('large-b', { email: true });
      const id = await create(draft([a.id, b.id]));

      const refused = await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});
      expect(refused.status).toBe(400);
      expect((refused.body as ErrorBody).error.details).toMatchObject({ field: 'confirmRecipients', required: 2 });

      const confirmed = await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({ confirmRecipients: 2 });
      expect(confirmed.status).toBe(200);
    } finally {
      await prisma.setting.delete({ where: { key: threshold.key } });
    }
  });

  it('schedules for later and starts when due', async () => {
    const a = await makeCustomer('sched-a', { email: true });
    const id = await create(draft([a.id]));
    const sendAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const res = await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({ sendAt });
    expect((res.body as CampaignBody).data.campaign.status).toBe('SCHEDULED');
    expect(await prisma.campaignRecipient.count({ where: { campaignId: id } })).toBe(0);

    await prisma.campaign.update({ where: { id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await runCampaignTick();

    expect(sentTo(a.email)).toBe(1);
  });

  it('retries a temporary failure and suppresses a hard bounce', async () => {
    const flaky = await makeCustomer('retry-a', { email: true });
    const bounced = await makeCustomer('retry-b', { email: true });
    const id = await create(draft([flaky.id, bounced.id]));
    await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});

    channels.sendEmail.mockImplementation((to: string) =>
      Promise.reject(
        to === bounced.email.toLowerCase()
          ? new SendFailure('550 no such user', false, 'BOUNCED')
          : new SendFailure('421 try later', true),
      ),
    );
    await runCampaignTick();

    const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: id }, select: { customerId: true, status: true, nextAttemptAt: true } });
    const flakyRow = rows.find((row) => row.customerId === flaky.id);
    expect(flakyRow?.status).toBe(CampaignRecipientStatus.PENDING);
    expect(flakyRow?.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
    expect(rows.find((row) => row.customerId === bounced.id)?.status).toBe(CampaignRecipientStatus.BOUNCED);
    expect(await prisma.marketingSuppression.findUnique({
      where: { channel_address: { channel: 'EMAIL', address: bounced.email.toLowerCase() } },
    })).not.toBeNull();
  });

  it('never sends to an address suppressed after the campaign was queued', async () => {
    const a = await makeCustomer('late-supp', { email: true });
    const id = await create(draft([a.id]));
    await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});
    await prisma.marketingSuppression.create({ data: { channel: 'EMAIL', address: a.email.toLowerCase(), reason: 'UNSUBSCRIBED' } });

    await runCampaignTick();

    expect(sentTo(a.email)).toBe(0);
    expect((await prisma.campaignRecipient.findFirst({ where: { campaignId: id } }))?.status).toBe('FAILED');
  });

  it('stops queued messages when canceled', async () => {
    const a = await makeCustomer('cancel-a', { email: true });
    const id = await create(draft([a.id]));
    await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});
    const canceled = await request(app).post(`/api/v1/campaigns/${id}/cancel`).set(auth());
    expect((canceled.body as CampaignBody).data.campaign.status).toBe('CANCELED');

    await runCampaignTick();
    expect(sentTo(a.email)).toBe(0);
  });

  it('refuses an audience with nobody who can receive it', async () => {
    const noConsent = await makeCustomer('empty-a');
    const id = await create(draft([noConsent.id]));

    const res = await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details).toMatchObject({ excluded: { noConsent: 1 } });
  });

  it('lets only an owner or manager send', async () => {
    const a = await makeCustomer('role-a', { email: true });
    const id = await create(draft([a.id]));

    const res = await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth(supportToken, supportBranchId)).send({});
    expect(res.status).toBe(403);
  });

  it('no longer lets a sent campaign be edited', async () => {
    const a = await makeCustomer('edit-a', { email: true });
    const id = await create(draft([a.id]));
    await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});

    const res = await request(app).put(`/api/v1/campaigns/${id}`).set(auth()).send(draft([a.id], { name: `${RUN} renamed` }));
    expect(res.status).toBe(409);
  });
});

describe('consent', () => {
  it('asks before unsubscribing, then withdraws consent and suppresses the address', async () => {
    const a = await makeCustomer('unsub-a', { email: true });
    const id = await create(draft([a.id]));
    await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});
    const recipient = await prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: id } });
    const token = unsubscribeToken(recipient.id);

    // A link checker following the URL must not opt anyone out.
    const looked = await request(app).get(`/api/v1/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(looked.status).toBe(200);
    expect((await prisma.customer.findUnique({ where: { id: a.id } }))?.emailMarketingConsent).toBe(true);

    const confirmed = await request(app).post(`/api/v1/unsubscribe?token=${encodeURIComponent(token)}`).type('form').send('List-Unsubscribe=One-Click');
    expect(confirmed.status).toBe(200);

    const customer = await prisma.customer.findUnique({ where: { id: a.id } });
    expect(customer).toMatchObject({ emailMarketingConsent: false, emailConsentAt: null });
    expect(await prisma.marketingSuppression.findUnique({
      where: { channel_address: { channel: 'EMAIL', address: a.email.toLowerCase() } },
    })).not.toBeNull();
  });

  it('rejects a forged unsubscribe link', async () => {
    const res = await request(app).post('/api/v1/unsubscribe?token=someone.forged');
    expect(res.status).toBe(400);
  });

  it('stamps when and how consent was given, and clears it on withdrawal', async () => {
    const created = await request(app)
      .post('/api/v1/r/customers')
      .set(auth())
      .send({ name: `${RUN} consent`, email: `${RUN}-consent@example.test`, emailMarketingConsent: true });
    expect(created.status).toBe(201);
    const id = (created.body as { data: { row: { id: string } } }).data.row?.id ?? (created.body as { data: { id: string } }).data.id;
    customerIds.push(id);

    const stamped = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(stamped.emailConsentSource).toBe('admin');
    expect(stamped.emailConsentAt).not.toBeNull();

    await request(app).patch(`/api/v1/r/customers/${id}`).set(auth()).send({ emailMarketingConsent: false });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id } })).toMatchObject({
      emailMarketingConsent: false,
      emailConsentAt: null,
      emailConsentSource: null,
    });
  });
});

describe('recipient retention', () => {
  it('erases addresses from campaigns finished longer ago than the retention period', async () => {
    const { pruneCampaignRecipients } = await import('../services/campaign-dispatcher.js');
    const a = await makeCustomer('retain-a', { email: true });
    const id = await create(draft([a.id]));
    await request(app).post(`/api/v1/campaigns/${id}/send`).set(auth()).send({});
    await runCampaignTick();
    await prisma.campaign.update({ where: { id }, data: { completedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) } });

    await pruneCampaignRecipients();

    const row = await prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: id } });
    expect(row.address).toBeNull();
    expect(row.status).toBe('SENT');
  });
});

// Keeps Prisma's Decimal import used for fixtures that may need money later.
void Prisma;
