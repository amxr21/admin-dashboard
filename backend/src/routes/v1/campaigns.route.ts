import { CampaignChannel, StaffRole } from '@prisma/client';
import express, { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea, requireRole } from '../../middleware/authorize.js';
import { withBranchContext } from '../../middleware/branch-context.js';
import { audienceSchema } from '../../services/campaign-audience.service.js';
import { channelReadiness } from '../../services/campaign-channels.js';
import {
  recordEmailEvent,
  recordInboundSms,
  recordSmsStatus,
  unsubscribeByToken,
  validEmailWebhookSecret,
  validTwilioSignature,
} from '../../services/campaign-consent.service.js';
import {
  cancelCampaign,
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  previewAudience,
  scheduleCampaign,
  testSend,
  updateCampaign,
} from '../../services/campaigns.service.js';

/**
 * Customer campaigns.
 *
 * Drafting sits in the `customers` area. Anything that reaches customers —
 * test sends aside, sending, scheduling and canceling — is owner or manager
 * only: a marketing blast is a decision about the business, not a routine
 * customer-service action.
 */

export const campaignsRouter = Router();

const guard = [authenticate, withBranchContext, requireArea('customers')] as const;
const sendGuard = [...guard, requireRole(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.DEVELOPER)] as const;

const text = (max: number) => z.string().max(max).nullable().optional();

const campaignBody = z
  .object({
    name: z.string().trim().min(1, 'Name the campaign').max(120),
    channel: z.nativeEnum(CampaignChannel),
    subjectEn: text(200),
    subjectAr: text(200),
    bodyEn: text(5000),
    bodyAr: text(5000),
    discountCode: text(64),
    branchId: z.string().max(64).nullable().optional(),
    audience: audienceSchema,
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());
  return parsed.data;
}

campaignsRouter.get('/campaigns/readiness', ...guard, async (_req, res) => {
  res.json({ data: await channelReadiness() });
});

campaignsRouter.get('/campaigns', ...guard, async (_req, res) => {
  res.json({ data: { campaigns: await listCampaigns() } });
});

campaignsRouter.post('/campaigns', ...guard, async (req, res) => {
  res.status(201).json({ data: { campaign: await createCampaign(parse(campaignBody, req.body), req) } });
});

campaignsRouter.post('/campaigns/preview-audience', ...guard, async (req, res) => {
  const body = parse(
    z.object({
      channel: z.nativeEnum(CampaignChannel),
      audience: audienceSchema,
      bodyEn: text(5000),
      bodyAr: text(5000),
    }),
    req.body,
  );
  res.json({
    data: await previewAudience(body.channel, body.audience, {
      subjectEn: null,
      subjectAr: null,
      bodyEn: body.bodyEn ?? null,
      bodyAr: body.bodyAr ?? null,
    }),
  });
});

campaignsRouter.get('/campaigns/:id', ...guard, async (req, res) => {
  res.json({ data: { campaign: await getCampaign(String(req.params.id)) } });
});

campaignsRouter.put('/campaigns/:id', ...guard, async (req, res) => {
  res.json({ data: { campaign: await updateCampaign(String(req.params.id), parse(campaignBody, req.body), req) } });
});

campaignsRouter.delete('/campaigns/:id', ...guard, async (req, res) => {
  await deleteCampaign(String(req.params.id), req);
  res.status(204).end();
});

campaignsRouter.post('/campaigns/:id/test', ...sendGuard, async (req, res) => {
  const body = parse(z.object({ phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +971501234567').optional() }), req.body ?? {});
  await testSend(String(req.params.id), body, req);
  res.status(204).end();
});

campaignsRouter.post('/campaigns/:id/send', ...sendGuard, async (req, res) => {
  const body = parse(
    z.object({
      sendAt: z.string().datetime({ offset: true }).optional(),
      confirmRecipients: z.number().int().nonnegative().optional(),
    }),
    req.body ?? {},
  );
  res.json({ data: { campaign: await scheduleCampaign(String(req.params.id), body, req) } });
});

campaignsRouter.post('/campaigns/:id/cancel', ...sendGuard, async (req, res) => {
  res.json({ data: { campaign: await cancelCampaign(String(req.params.id), req) } });
});

/* ── Public: unsubscribe links and provider webhooks ────────────────────
 * No staff session — each is authenticated by what it carries: a signed
 * unsubscribe token, Twilio's request signature, or the email webhook secret.
 */

export const campaignPublicRouter = Router();

const form = express.urlencoded({ extended: false, limit: '32kb' });

function page(title: string, body: string, action?: string): string {
  const button = action
    ? `<form method="post" action="${action}"><button type="submit" style="font-size:16px;padding:10px 20px;border-radius:6px;border:0;background:#2563eb;color:#fff;cursor:pointer">Unsubscribe · إلغاء الاشتراك</button></form>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1f2937;line-height:1.6">${body}${button}</body></html>`;
}

/**
 * GET only ASKS. Mail scanners follow links to check them, and an
 * unsubscribe that happened on a GET would opt people out who never clicked.
 */
campaignPublicRouter.get('/unsubscribe', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  res
    .type('html')
    .send(
      page(
        'Unsubscribe',
        `<h1 style="font-size:22px">Stop these messages?</h1><p>You will no longer receive marketing messages from us. Order updates are not affected.</p><p dir="rtl" lang="ar">لن تصلك رسائل تسويقية منا بعد الآن. لن يؤثر ذلك على تحديثات طلباتك.</p>`,
        `?token=${encodeURIComponent(token)}`,
      ),
    );
});

/** The confirmed unsubscribe — also what RFC 8058 one-click POSTs to. */
campaignPublicRouter.post('/unsubscribe', form, async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const done = await unsubscribeByToken(token);

  if (!done) {
    res
      .status(400)
      .type('html')
      .send(page('Link not valid', '<h1 style="font-size:22px">This link is not valid</h1><p>Please use the link from the latest message you received.</p><p dir="rtl" lang="ar">هذا الرابط غير صالح. يُرجى استخدام الرابط الوارد في أحدث رسالة وصلتك.</p>'));
    return;
  }

  res
    .type('html')
    .send(page('Unsubscribed', '<h1 style="font-size:22px">You are unsubscribed</h1><p>You will not receive marketing messages from us again.</p><p dir="rtl" lang="ar">تم إلغاء اشتراكك، ولن تصلك رسائل تسويقية منا بعد الآن.</p>'));
});

function twilioParams(body: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries((body ?? {}) as Record<string, unknown>).map(([key, value]) => [key, String(value)]));
}

campaignPublicRouter.post('/webhooks/sms/status', form, async (req, res) => {
  const params = twilioParams(req.body);
  if (!validTwilioSignature('/webhooks/sms/status', params, req.header('X-Twilio-Signature'))) {
    throw AppError.forbidden('Signature did not verify');
  }
  if (params.MessageSid && params.MessageStatus) {
    await recordSmsStatus(params.MessageSid, params.MessageStatus, params.ErrorCode);
  }
  res.status(204).end();
});

campaignPublicRouter.post('/webhooks/sms/inbound', form, async (req, res) => {
  const params = twilioParams(req.body);
  if (!validTwilioSignature('/webhooks/sms/inbound', params, req.header('X-Twilio-Signature'))) {
    throw AppError.forbidden('Signature did not verify');
  }
  if (params.From && params.Body) await recordInboundSms(params.From, params.Body);
  // Empty TwiML: record the opt-out, send no automatic reply of our own
  // (the carrier already confirms STOP to the sender).
  res.type('text/xml').send('<Response></Response>');
});

const emailEvents = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(['delivered', 'bounced', 'complained', 'unsubscribed']),
        email: z.string().email(),
        messageId: z.string().max(255).optional(),
      }),
    )
    .max(1000),
});

campaignPublicRouter.post('/webhooks/email/events', async (req, res) => {
  if (!validEmailWebhookSecret(req.header('X-Webhook-Secret'))) throw AppError.forbidden('Webhook secret did not verify');
  const body = parse(emailEvents, req.body);
  for (const event of body.events) await recordEmailEvent(event);
  res.status(204).end();
});
