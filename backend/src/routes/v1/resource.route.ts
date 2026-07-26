import { Router, type Request } from 'express';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { canAccessArea } from '../../config/roles.js';
import { ADMIN_RESOURCES } from '../../config/admin.config.js';
import {
  createResourceRow,
  deleteResourceRow,
  getResourceRow,
  listResource,
  relationOptions,
  requireResource,
  updateResourceRow,
} from '../../services/resource.service.js';

/**
 * The schema-driven resource engine.
 *
 * One set of handlers serves every resource declared in admin.config.ts. The
 * resource segment selects a config; it never becomes an identifier.
 *
 * Authorisation is per-resource: each config names a `permissionArea`, and the
 * area check runs against THAT rather than against a single blanket area.
 * Otherwise one grant would open every resource at once.
 */

export const resourceRouter = Router();

/**
 * The area guard has to be resolved per request, because which area applies
 * depends on which resource was asked for. `requireArea` is still the single
 * implementation — this only chooses the argument.
 */
function guardArea(req: Request): void {
  const config = requireResource(String(req.params.resource));
  const user = requireUser(req);

  if (!canAccessArea(user.role, config.permissionArea)) {
    throw AppError.forbidden('You do not have access to this resource');
  }
}

/**
 * GET /api/v1/r/_schema — the whole config, for a UI that renders itself.
 *
 * Filtered to what the CALLER can reach, so the navigation a user sees matches
 * what they can actually open. This is a convenience, not a control: every
 * request is authorised independently.
 */
resourceRouter.get('/r/_schema', authenticate, (req, res) => {
  const user = requireUser(req);

  const resources = ADMIN_RESOURCES.filter((config) =>
    canAccessArea(user.role, config.permissionArea),
  ).map((config) => ({
    resource: config.resource,
    label: config.label,
    group: config.group,
    labelField: config.labelField,
    permissionArea: config.permissionArea,
    defaultSort: config.defaultSort,
    permissions: config.permissions ?? {},
    fields: config.fields,
  }));

  res.status(200).json({ data: { resources } });
});

// GET /api/v1/r/:resource
resourceRouter.get('/r/:resource', authenticate, async (req, res) => {
  guardArea(req);
  const config = requireResource(String(req.params.resource));

  const { page, pageSize, search, sort, dir, ...rest } = req.query;

  // Anything not a known control parameter is treated as a field filter. The
  // service validates each key against the config, so an unknown one is a 400.
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === 'string') filters[key] = value;
  }

  const result = await listResource(config, {
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
    search: typeof search === 'string' ? search : undefined,
    sort: typeof sort === 'string' ? sort : undefined,
    dir: dir === 'asc' ? 'asc' : dir === 'desc' ? 'desc' : undefined,
    filters,
  });

  res.status(200).json({ data: result });
});

// GET /api/v1/r/:resource/_relations/:field — options for a relation picker.
resourceRouter.get('/r/:resource/_relations/:field', authenticate, async (req, res) => {
  guardArea(req);
  const config = requireResource(String(req.params.resource));

  const options = await relationOptions(
    config,
    String(req.params.field),
    typeof req.query.search === 'string' ? req.query.search : undefined,
  );

  res.status(200).json({ data: { options } });
});

// GET /api/v1/r/:resource/:id
resourceRouter.get('/r/:resource/:id', authenticate, async (req, res) => {
  guardArea(req);
  const config = requireResource(String(req.params.resource));

  const row = await getResourceRow(config, String(req.params.id));

  res.status(200).json({ data: { row } });
});

// POST /api/v1/r/:resource
resourceRouter.post('/r/:resource', authenticate, async (req, res) => {
  guardArea(req);
  const config = requireResource(String(req.params.resource));

  const row = await createResourceRow(config, req.body as Record<string, unknown>);

  req.log.info({ event: 'resource.created', resource: config.resource });

  res.status(201).json({ data: { row } });
});

// PATCH /api/v1/r/:resource/:id
resourceRouter.patch('/r/:resource/:id', authenticate, async (req, res) => {
  guardArea(req);
  const config = requireResource(String(req.params.resource));

  const row = await updateResourceRow(
    config,
    String(req.params.id),
    req.body as Record<string, unknown>,
  );

  req.log.info({ event: 'resource.updated', resource: config.resource });

  res.status(200).json({ data: { row } });
});

// DELETE /api/v1/r/:resource/:id
resourceRouter.delete('/r/:resource/:id', authenticate, async (req, res) => {
  guardArea(req);
  const config = requireResource(String(req.params.resource));

  const row = await deleteResourceRow(config, String(req.params.id));

  req.log.info({ event: 'resource.deleted', resource: config.resource });

  res.status(200).json({ data: { row } });
});
