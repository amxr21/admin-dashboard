import { Router } from 'express';
import { PolicyType } from '@prisma/client';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { audit, diff } from '../../services/audit.service.js';
import {
  listPolicies,
  listPolicyVersions,
  publishPolicy,
  revertPolicy,
} from '../../services/policies.service.js';

/**
 * Return/Privacy/Terms/Shipping policy documents (B3.5).
 *
 * Gated on `settings`, same area as the rest of store configuration —
 * policy text is store-wide operational content, not personnel data like
 * `staff`/`audit`.
 */
export const policiesRouter = Router();

const guard = [authenticate, requireArea('settings')] as const;

const typeParam = z.nativeEnum(PolicyType);
const localeParam = z.string().trim().min(2).max(8);

policiesRouter.get('/policies', ...guard, async (_req, res) => {
  res.json({ data: await listPolicies() });
});

policiesRouter.get('/policies/:type/:locale/versions', ...guard, async (req, res) => {
  const type = typeParam.safeParse(req.params.type);
  const locale = localeParam.safeParse(req.params.locale);
  if (!type.success || !locale.success) throw AppError.badRequest('Invalid type or locale');

  res.json({ data: await listPolicyVersions(type.data, locale.data) });
});

const publishBody = z
  .object({ content: z.string().min(1, 'Content is required').max(100_000) })
  .strict();

policiesRouter.put('/policies/:type/:locale', ...guard, async (req, res) => {
  const type = typeParam.safeParse(req.params.type);
  const locale = localeParam.safeParse(req.params.locale);
  if (!type.success || !locale.success) throw AppError.badRequest('Invalid type or locale');

  const parsed = publishBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const actor = requireUser(req);
  const before = (await listPolicyVersions(type.data, locale.data))[0] ?? null;

  const version = await publishPolicy(type.data, locale.data, parsed.data.content, actor.id);

  audit(req, {
    action: 'policy.published',
    entity: 'policy',
    entityId: version.id,
    changes: diff(
      { content: before?.content ?? '', version: before?.version ?? 0 },
      { content: version.content, version: version.version },
    ),
  });

  res.status(201).json({ data: version });
});

const revertBody = z.object({ versionId: z.string().min(1) }).strict();

policiesRouter.post('/policies/:type/:locale/revert', ...guard, async (req, res) => {
  const type = typeParam.safeParse(req.params.type);
  const locale = localeParam.safeParse(req.params.locale);
  if (!type.success || !locale.success) throw AppError.badRequest('Invalid type or locale');

  const parsed = revertBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const actor = requireUser(req);
  const version = await revertPolicy(type.data, locale.data, parsed.data.versionId, actor.id);

  audit(req, {
    action: 'policy.reverted',
    entity: 'policy',
    entityId: version.id,
    changes: { revertedToVersionId: { from: null, to: parsed.data.versionId } },
  });

  res.status(201).json({ data: version });
});
