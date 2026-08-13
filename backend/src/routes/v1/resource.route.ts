import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { parse as parseCsvSync } from 'csv-parse/sync';

import { AppError } from '../../errors/AppError.js';
import { toCsv } from '../../lib/csv.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { canAccessArea } from '../../config/roles.js';
import { ADMIN_RESOURCES } from '../../config/admin.config.js';
import { audit } from '../../services/audit.service.js';
import {
  applyResourceImport,
  createResourceRow,
  deleteResourceRow,
  getResourceRow,
  importTemplateColumns,
  listResource,
  listResourceForExport,
  previewResourceImport,
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

/**
 * GET /api/v1/r/:resource/export — every row matching the same search/filter
 * a list view would use, as CSV. Registered ahead of `/:id` so "export" is
 * never mistaken for a row id.
 *
 * B3.3, scoped to export + history only — see MASTER_TODO.md. Reuses the
 * exact `audit.exported`-shaped convention `audit.route.ts` established for
 * the audit trail's own CSV export: the audit log doubles as export HISTORY
 * (`entity=<resource>&action=<resource>.export`), no new model needed.
 */
resourceRouter.get('/r/:resource/export', authenticate, async (req, res) => {
  guardArea(req);
  const config = requireResource(String(req.params.resource));

  const { search, sort, dir, ...rest } = req.query;
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === 'string') filters[key] = value;
  }

  const { rows, truncated } = await listResourceForExport(config, {
    search: typeof search === 'string' ? search : undefined,
    sort: typeof sort === 'string' ? sort : undefined,
    dir: dir === 'asc' ? 'asc' : dir === 'desc' ? 'desc' : undefined,
    filters,
  });

  audit(req, {
    action: `${config.resource}.export`,
    entity: config.resource,
    changes: { rowCount: rows.length, truncated, filters },
  });

  res.set('X-Export-Truncated', String(truncated));

  const columns = config.fields
    .filter((field) => field.type !== 'multiRelation')
    .map((field) => ({
      header: field.label,
      value: (row: Record<string, unknown>) => {
        const value = row[field.name];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value);
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
      },
    }));

  res
    .status(200)
    .type('text/csv')
    .set('Content-Disposition', `attachment; filename="${config.resource}.csv"`)
    .send(toCsv(rows, columns));
});

/**
 * GET /api/v1/r/:resource/import-template — a blank CSV naming exactly the
 * columns import will read back (writable field LABELS — the words a person
 * filling in a spreadsheet has actually seen, not the internal field name).
 * A header-only file, deliberately: a filled example row invites copy-paste
 * of placeholder data into a real import.
 */
resourceRouter.get('/r/:resource/import-template', authenticate, (req, res) => {
  guardArea(req);
  const config = requireResource(String(req.params.resource));

  const header = importTemplateColumns(config).join(',');

  res
    .status(200)
    .type('text/csv')
    .set('Content-Disposition', `attachment; filename="${config.resource}-import-template.csv"`)
    .send(`${header}\r\n`);
});

const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_FILE_BYTES },
});

/** Same MulterError-normalisation wrapper as upload.route.ts — a "file too
 *  large" mistake must reach the caller as a 400, not fall through to the
 *  generic error handler and get logged as an unexpected bug. */
function parseImportUpload(req: Request, res: Response, next: NextFunction) {
  importUpload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      next(
        AppError.badRequest(
          err.code === 'LIMIT_FILE_SIZE'
            ? `File is too large — the limit is ${String(IMPORT_MAX_FILE_BYTES / (1024 * 1024))}MB`
            : err.message,
        ),
      );
      return;
    }

    next(err);
  });
}

/** Parses the uploaded CSV into `{ label: cellText }` rows — `columns: true`
 *  reads the first line as the header and keys every row by it, matching
 *  what `import-template`'s header names and `csvRowToBody` reads back. */
function parseImportFile(req: Request): Record<string, string>[] {
  if (!req.file) {
    throw AppError.badRequest('No file uploaded — send it as multipart form field "file"');
  }

  try {
    return parseCsvSync(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch {
    // csv-parse's own error message is written for a developer console, not
    // an admin who picked the wrong file — this is the one message that
    // actually tells them what to do about it.
    throw AppError.badRequest('Could not read this file as CSV. Check it matches the template.');
  }
}

/**
 * POST /api/v1/r/:resource/import?dryRun=true — validates every row of the
 * uploaded file and reports errors WITHOUT writing anything. The frontend's
 * import flow always calls this first for the preview table; `dryRun=false`
 * (or omitted) commits, but re-validates from scratch rather than trusting
 * that nothing changed since the preview was shown.
 */
resourceRouter.post(
  '/r/:resource/import',
  authenticate,
  parseImportUpload,
  async (req, res) => {
    guardArea(req);
    const config = requireResource(String(req.params.resource));
    const rows = parseImportFile(req);

    const isDryRun = req.query.dryRun === 'true';

    if (isDryRun) {
      const { preview } = await previewResourceImport(config, rows);
      res.status(200).json({ data: preview });
      return;
    }

    const result = await applyResourceImport(config, rows, req);

    req.log.info({
      event: 'resource.imported',
      resource: config.resource,
      imported: result.imported,
      errorCount: result.errors.length,
    });

    // Always 200 — like the orders bulk-status endpoint, "some or all rows
    // failed VALIDATION" is a normal, successfully-reported outcome of the
    // request, not an HTTP-level failure. A 4xx here would put the real
    // per-row errors behind this app's error envelope instead of its data
    // one, and every client (apiUpload included) throws away a non-2xx
    // response body except for `error.message` — the one thing the import
    // preview UI actually needs to render is `errors`, not a single string.
    res.status(200).json({ data: result });
  },
);

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

  const row = await createResourceRow(config, req.body as Record<string, unknown>, req);

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
    req,
  );

  req.log.info({ event: 'resource.updated', resource: config.resource });

  res.status(200).json({ data: { row } });
});

// DELETE /api/v1/r/:resource/:id
resourceRouter.delete('/r/:resource/:id', authenticate, async (req, res) => {
  guardArea(req);
  const config = requireResource(String(req.params.resource));

  const { row, action } = await deleteResourceRow(config, String(req.params.id), req);

  req.log.info({ event: `resource.${action}`, resource: config.resource });

  // The response says WHICH happened, so the UI can tell the user the truth
  // rather than claiming a delete that did not occur.
  res.status(200).json({ data: { row, action } });
});
