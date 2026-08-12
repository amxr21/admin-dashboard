import { Router } from 'express';
import { z } from 'zod';
import { AuditOutcome } from '@prisma/client';

import { AppError } from '../../errors/AppError.js';
import { toCsv } from '../../lib/csv.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  audit,
  listAudit,
  listAuditActions,
  listAuditEntities,
  listAuditForExport,
} from '../../services/audit.service.js';

/**
 * The audit trail.
 *
 * ─── READ ONLY, AND NOT BY ACCIDENT ──────────────────────────────────
 * There is no POST, PATCH or DELETE here, and there will not be. A trail that
 * can be edited is not evidence — the first thing anyone covering their tracks
 * would reach for is the record of what they did.
 *
 * Entries are written by the services themselves, never by a request.
 *
 * Gated on `staff`, not `reports`: it names people and what they did, which is
 * closer to personnel data than to business metrics. DEMO cannot reach `staff`
 * at all, so a demo account cannot read who works here or what they changed.
 */

export const auditRouter = Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  /** Row id from a previous response's `nextCursor`. Wins over `page`. */
  cursor: z.string().trim().max(64).optional(),
  entity: z.string().trim().max(48).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorId: z.string().trim().max(64).optional(),
  action: z.string().trim().max(64).optional(),
  outcome: z.nativeEnum(AuditOutcome).optional(),
  requestId: z.string().trim().max(64).optional(),
  from: z.string().trim().regex(DATE_PATTERN).optional(),
  to: z.string().trim().regex(DATE_PATTERN).optional(),
  /** Same endpoint, same filters — only the serialisation differs. */
  format: z.enum(['json', 'csv']).optional(),
});

auditRouter.get('/audit', authenticate, requireArea('staff'), async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid query', parsed.error.flatten());

  if (parsed.data.format === 'csv') {
    const { rows, truncated } = await listAuditForExport(parsed.data);

    /**
     * Exporting the trail is itself an auditable event (B1.7).
     *
     * Someone taking a copy of who-did-what — names, emails, IPs — out of the
     * system is exactly the action a reviewer would want recorded, and it is
     * the one action this read-only page can perform.
     */
    audit(req, {
      action: 'audit.exported',
      entity: 'audit',
      changes: {
        rowCount: rows.length,
        truncated,
        filters: {
          entity: parsed.data.entity ?? null,
          entityId: parsed.data.entityId ?? null,
          actorId: parsed.data.actorId ?? null,
          action: parsed.data.action ?? null,
          outcome: parsed.data.outcome ?? null,
          from: parsed.data.from ?? null,
          to: parsed.data.to ?? null,
        },
      },
    });

    // Stated in a header rather than an extra CSV row, which would corrupt the
    // data for anything parsing it.
    res.set('X-Export-Truncated', String(truncated));

    res
      .status(200)
      .type('text/csv')
      .set('Content-Disposition', 'attachment; filename="audit-log.csv"')
      .send(
        toCsv(rows, [
          { header: 'When (UTC)', value: (r) => r.createdAt },
          { header: 'Outcome', value: (r) => r.outcome },
          { header: 'Actor email', value: (r) => r.actorEmail ?? '' },
          { header: 'Actor role', value: (r) => r.actorRole ?? '' },
          { header: 'Action', value: (r) => r.action },
          { header: 'Entity', value: (r) => r.entity },
          { header: 'Entity ID', value: (r) => r.entityId ?? '' },
          { header: 'Changes', value: (r) => (r.changes ? JSON.stringify(r.changes) : '') },
          { header: 'IP', value: (r) => r.ip ?? '' },
          { header: 'User agent', value: (r) => r.userAgent ?? '' },
          { header: 'Request ID', value: (r) => r.requestId ?? '' },
        ]),
      );
    return;
  }

  res.json({ data: await listAudit(parsed.data) });
});

// Ahead of `/audit/:id`-shaped routes that do not exist yet, but named so it
// never collides if one is added later.
auditRouter.get('/audit/entities', authenticate, requireArea('staff'), async (_req, res) => {
  res.json({ data: await listAuditEntities() });
});

auditRouter.get('/audit/actions', authenticate, requireArea('staff'), async (_req, res) => {
  res.json({ data: await listAuditActions() });
});
