import type { Request } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import {
  getResourceConfig,
  searchableFields,
  sortableFields,
  writableFields,
  type FieldConfig,
  type ResourceConfig,
} from '../config/admin.config.js';
import { hooksFor } from './resource-hooks.js';
import { isEmailShaped } from '../lib/email.js';
import { audit, diff } from './audit.service.js';

/**
 * Generic CRUD, parameterised by config.
 *
 * ─── DYNAMIC DISPATCH, NOT DYNAMIC QUERIES ───────────────────────────
 * Every identifier — model, field, sort key, filter key — is looked up in
 * admin.config.ts before it is used. A name that isn't declared there is a 400,
 * never a query. The request chooses BETWEEN allowlisted options; it never
 * supplies one.
 *
 * Prisma parameterises values on its own, so injection isn't the risk here.
 * The risks this file actually guards are:
 *   1. Column exposure  — `select` is built from config, so an undeclared
 *      column (User.passwordHash) cannot be returned even by accident.
 *   2. Mass assignment  — writes are filtered to `writableFields`, so an extra
 *      key in the body is dropped rather than persisted.
 *   3. Resource exposure — a table with no config entry does not exist here.
 */

/**
 * Resource → Prisma delegate.
 *
 * Explicit rather than `(prisma as any)[model]`. An index into the client by a
 * config string would silently reach ANY model — including `user` — the moment
 * someone adds a config entry, which is exactly the hole the allowlist exists
 * to close. Adding a resource means adding a line here, on purpose.
 */
type DelegateName = 'category' | 'customer' | 'discount' | 'notification' | 'review' | 'product';

/** Minimal shape shared by every Prisma model delegate we use. */
interface ModelDelegate {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
  delete: (args: unknown) => Promise<Record<string, unknown>>;
}

/** Satisfied by both the top-level `prisma` client and a `$transaction`
 *  callback's `tx` — the standard Prisma type for "either works here". */
type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

function delegatesFrom(client: PrismaClientOrTx): Record<DelegateName, ModelDelegate> {
  return {
    category: client.category,
    customer: client.customer,
    discount: client.discount,
    notification: client.notification,
    review: client.review,
    product: client.product,
  } as unknown as Record<DelegateName, ModelDelegate>;
}

/**
 * Resource → Prisma delegate.
 *
 * Explicit rather than `(client as any)[model]`. An index into the client by
 * a config string would silently reach ANY model — including `user` — the
 * moment someone adds a config entry, which is exactly the hole the
 * allowlist exists to close. Adding a resource means adding a line to
 * `delegatesFrom` above, on purpose.
 *
 * `client` defaults to the top-level `prisma` — every existing call site
 * keeps working unchanged — but import's atomic apply passes a
 * `$transaction` callback's `tx` here instead, so a mid-batch failure rolls
 * every row in that batch back together rather than leaving a partial import
 * committed.
 */
function delegateFor(config: ResourceConfig, client: PrismaClientOrTx = prisma): ModelDelegate {
  const name = config.model as DelegateName;
  const delegate = delegatesFrom(client)[name];

  if (!delegate) {
    // A config entry naming a model with no delegate is a programming error,
    // not a client error — fail loudly rather than 404 and look like a typo.
    throw new Error(
      `admin.config.ts declares model "${config.model}" for resource "${config.resource}", ` +
        'but resource.service.ts has no delegate for it. Add it to delegatesFrom.',
    );
  }

  return delegate;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** Resolves a resource name to its config, or 404s. */
export function requireResource(resource: string): ResourceConfig {
  const config = getResourceConfig(resource);

  // 404, not 403: an unconfigured resource genuinely does not exist in this
  // API, and saying "forbidden" would confirm the table name.
  if (!config) throw AppError.notFound(`Unknown resource "${resource}"`);

  return config;
}

/**
 * Prisma returns Decimal and Date objects. Both need a stable wire format.
 *
 * Money becomes a fixed-2 STRING for the same reason as products.service.ts —
 * a JSON number loses precision inside JSON.parse on the client, before
 * anything we control can intervene.
 */
function serializeValue(value: unknown, field: FieldConfig | undefined): unknown {
  if (value === null || value === undefined) return null;

  if (value instanceof Prisma.Decimal) {
    return field?.type === 'money' ? value.toFixed(2) : value.toString();
  }

  if (value instanceof Date) return value.toISOString();

  return value;
}

function serializeRow(
  row: Record<string, unknown>,
  config: ResourceConfig,
): Record<string, unknown> {
  const byName = new Map(config.fields.map((f) => [f.name, f]));
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const field = byName.get(key);

    if (field?.type === 'multiRelation') {
      // Prisma returns the nested rows selected below (`{ id: true }`); sorted
      // so the id array has a STABLE order regardless of the join table's own
      // row order — otherwise the same set written twice could diff as
      // "changed" purely from reordering (see the audit `diff()` note).
      out[key] = Array.isArray(value)
        ? (value as { id: unknown }[]).map((r) => String(r.id)).sort()
        : [];
      continue;
    }

    // Relation labels are attached separately below and carry no field config.
    out[key] = serializeValue(value, field);
  }

  return out;
}

/** `select` built from config — the reason an undeclared column can't leak. */
function selectFor(config: ResourceConfig): Record<string, unknown> {
  return Object.fromEntries(
    config.fields.map((field): [string, unknown] =>
      field.type === 'multiRelation'
        ? [field.name, { select: { id: true } }]
        : [field.name, true],
    ),
  );
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  /** field → value. Keys are validated against the config. */
  filters?: Record<string, string>;
}

export interface ListResult {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listResource(
  config: ResourceConfig,
  params: ListParams = {},
): Promise<ListResult> {
  const delegate = delegateFor(config);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  const where = buildWhere(config, params);
  const orderBy = buildOrderBy(config, params);

  const [rows, total] = await Promise.all([
    delegate.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: selectFor(config),
    }),
    delegate.count({ where }),
  ]);

  const serialized = rows.map((row) => serializeRow(row, config));
  await attachRelationLabels(config, serialized);

  return {
    rows: serialized,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function buildWhere(config: ResourceConfig, params: ListParams): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  const search = params.search?.trim();
  const searchable = searchableFields(config);

  if (search && searchable.length > 0) {
    conditions.push({
      OR: searchable.map((name) => ({ [name]: { contains: search } })),
    });
  }

  for (const [name, raw] of Object.entries(params.filters ?? {})) {
    const field = config.fields.find((f) => f.name === name);

    // An unconfigured filter key is a 400, not a silently ignored parameter —
    // silently ignoring it returns unfiltered data that LOOKS filtered.
    if (!field) throw AppError.badRequest(`Cannot filter by "${name}"`, { field: name });

    conditions.push({ [name]: coerceFilterValue(field, raw) });
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

/**
 * Query strings are always strings. A boolean column filtered by the literal
 * "false" would match everything truthy, so each type is coerced explicitly.
 */
function coerceFilterValue(field: FieldConfig, raw: string): unknown {
  switch (field.type) {
    case 'boolean':
      return raw === 'true';
    case 'number':
      if (!/^-?\d+$/.test(raw)) {
        throw AppError.badRequest(`"${field.name}" must be a number`, { value: raw });
      }
      return Number(raw);
    case 'enum':
      if (field.options && !field.options.includes(raw)) {
        throw AppError.badRequest(`Invalid value for "${field.name}"`, {
          allowed: field.options,
        });
      }
      return raw;
    default:
      return raw;
  }
}

function buildOrderBy(
  config: ResourceConfig,
  params: ListParams,
): Record<string, 'asc' | 'desc'> {
  const requested = params.sort;

  if (!requested) {
    return { [config.defaultSort.field]: config.defaultSort.dir };
  }

  if (!sortableFields(config).includes(requested)) {
    // Naming the sortable fields is safe: they're already public via /_schema.
    throw AppError.badRequest(`Cannot sort by "${requested}"`, {
      sortable: sortableFields(config),
    });
  }

  return { [requested]: params.dir === 'asc' ? 'asc' : 'desc' };
}

/**
 * Adds `<field>__label` alongside each relation FK.
 *
 * Batched per relation rather than per row — the obvious implementation issues
 * one query per row, which is fine on the 20 rows in development and a
 * thousand queries on a full page in production.
 *
 * A relation pointing at an UNCONFIGURED resource resolves to no label rather
 * than reaching into an unlisted table.
 */
async function attachRelationLabels(
  config: ResourceConfig,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;

  for (const field of config.fields) {
    // Destructured so the narrowing survives into the async callbacks below —
    // TypeScript cannot keep `field.relation` narrowed across an await.
    const relation = field.relation;
    if (!relation || (field.type !== 'relation' && field.type !== 'multiRelation')) continue;

    const target = getResourceConfig(relation.resource);
    if (!target) continue;

    if (field.type === 'multiRelation') {
      const ids = [
        ...new Set(
          rows.flatMap((row) => (Array.isArray(row[field.name]) ? (row[field.name] as string[]) : [])),
        ),
      ];

      if (ids.length === 0) {
        for (const row of rows) row[`${field.name}__label`] = [];
        continue;
      }

      const related = await delegateFor(target).findMany({
        where: { id: { in: ids } },
        select: { id: true, [relation.labelField]: true },
      });
      const labels = new Map(
        related.map((row) => [String(row.id), row[relation.labelField]]),
      );

      for (const row of rows) {
        const rowIds = Array.isArray(row[field.name]) ? (row[field.name] as string[]) : [];
        row[`${field.name}__label`] = rowIds.map((id) => labels.get(id) ?? null);
      }
      continue;
    }

    const ids = [
      ...new Set(
        rows
          .map((row) => row[field.name])
          .filter((value): value is string => typeof value === 'string'),
      ),
    ];

    if (ids.length === 0) continue;

    const related = await delegateFor(target).findMany({
      where: { id: { in: ids } },
      select: { id: true, [relation.labelField]: true },
    });

    const labels = new Map(
      related.map((row) => [String(row.id), row[relation.labelField]]),
    );

    for (const row of rows) {
      const value = row[field.name];
      row[`${field.name}__label`] =
        typeof value === 'string' ? (labels.get(value) ?? null) : null;
    }
  }
}

export async function getResourceRow(
  config: ResourceConfig,
  id: string,
): Promise<Record<string, unknown>> {
  const row = await delegateFor(config).findUnique({
    where: { id },
    select: selectFor(config),
  });

  if (!row) throw AppError.notFound(`${config.label} not found`);

  const serialized = serializeRow(row, config);
  await attachRelationLabels(config, [serialized]);

  return serialized;
}

/**
 * Filters a request body down to writable fields and coerces each value.
 *
 * Unknown keys are DROPPED rather than rejected. A generic engine sees
 * `__label` fields and UI state echoed back by well-meaning clients; rejecting
 * those would make the API annoying without making it safer, since dropping
 * them is already complete protection against mass assignment.
 */
async function buildWriteData(
  config: ResourceConfig,
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};

  for (const field of writableFields(config)) {
    const present = Object.prototype.hasOwnProperty.call(body, field.name);

    if (!present) {
      if (!partial && field.required) {
        throw AppError.badRequest(`"${field.label}" is required`, { field: field.name });
      }
      continue;
    }

    data[field.name] =
      field.type === 'multiRelation'
        ? await coerceMultiRelationValue(field, body[field.name], { partial })
        : await coerceWriteValue(field, body[field.name]);
  }

  if (Object.keys(data).length === 0) {
    throw AppError.badRequest('Provide at least one field to write');
  }

  return data;
}

/**
 * Validates a multi-relation write and turns it into a nested Prisma
 * relation write that REPLACES the whole list — the right verb for a picker
 * whose value is "this is now the complete set", not a delta.
 *
 * `set` and `connect` are not interchangeable here despite both meaning
 * "attach these": Prisma's nested `create` input only accepts `connect` (or
 * `create`/`connectOrCreate`) — `set` is update-only, since "replace the
 * list" presupposes a list already exists to replace. An empty array on
 * create needs no key at all; an empty `connect: []` is accepted but is
 * needless noise on a brand new row with nothing to attach yet.
 *
 * IDs are checked against the target table before the write reaches Prisma —
 * letting a bad id surface as Prisma's own nested-connect error would be a
 * generic 500 rather than a 400 naming the field, the same reasoning
 * `coerceWriteValue` applies to every other type.
 */
async function coerceMultiRelationValue(
  field: FieldConfig,
  value: unknown,
  { partial }: { partial: boolean },
): Promise<{ set: { id: string }[] } | { connect: { id: string }[] } | undefined> {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.length === 0)) {
    throw AppError.badRequest(`"${field.label}" must be a list of ids`, { field: field.name });
  }

  const ids = [...new Set(value as string[])];

  if (ids.length === 0) {
    return partial ? { set: [] } : undefined;
  }

  const relation = field.relation;
  if (!relation) {
    throw new Error(`Field "${field.name}" is multiRelation but declares no relation target.`);
  }

  const target = requireResource(relation.resource);
  const found = await delegateFor(target).findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });

  if (found.length !== ids.length) {
    const foundIds = new Set(found.map((row) => String(row.id)));
    const missing = ids.filter((id) => !foundIds.has(id));
    throw AppError.badRequest(`"${field.label}" references unknown ${relation.resource}`, {
      field: field.name,
      missing,
    });
  }

  const refs = ids.map((id) => ({ id }));
  return partial ? { set: refs } : { connect: refs };
}

/**
 * A single `relation` field's value is written straight as the scalar FK
 * column (`categoryId`, not a nested `connect`) — unlike `multiRelation`,
 * there is no join table here, just a plain string column with a foreign
 * key constraint pointing at it.
 *
 * The existence check exists for the same reason `coerceMultiRelationValue`
 * has one: without it, a bad id reaches Prisma's own FK constraint and
 * surfaces as an unhandled 500 that leaks a raw database error, instead of
 * a 400 naming the field the way every other type-mismatch on this endpoint
 * already does.
 */
async function coerceRelationValue(field: FieldConfig, value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.length === 0) {
    throw AppError.badRequest(`"${field.label}" must be an id`, { field: field.name });
  }

  const relation = field.relation;
  if (!relation) {
    throw new Error(`Field "${field.name}" is relation but declares no relation target.`);
  }

  const target = requireResource(relation.resource);
  const found = await delegateFor(target).findUnique({
    where: { id: value },
    select: { id: true },
  });

  if (!found) {
    throw AppError.badRequest(`"${field.label}" references unknown ${relation.resource}`, {
      field: field.name,
    });
  }

  return value;
}

async function coerceWriteValue(field: FieldConfig, value: unknown): Promise<unknown> {
  if (value === null || value === '') {
    if (field.required) {
      throw AppError.badRequest(`"${field.label}" is required`, { field: field.name });
    }
    return null;
  }

  if (field.type === 'relation') {
    return coerceRelationValue(field, value);
  }

  switch (field.type) {
    case 'money': {
      // Same rule as products: money arrives as a STRING and is handed
      // straight to Decimal. A JSON number has already lost precision.
      if (typeof value !== 'string' || !/^-?\d{1,8}(\.\d{1,2})?$/.test(value)) {
        throw AppError.badRequest(
          `"${field.label}" must be a decimal string with up to 2 decimal places`,
          { field: field.name },
        );
      }
      return new Prisma.Decimal(value);
    }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw AppError.badRequest(`"${field.label}" must be a number`, {
          field: field.name,
        });
      }
      return value;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw AppError.badRequest(`"${field.label}" must be true or false`, {
          field: field.name,
        });
      }
      return value;
    }

    case 'enum': {
      if (typeof value !== 'string' || !field.options?.includes(value)) {
        throw AppError.badRequest(`Invalid value for "${field.label}"`, {
          field: field.name,
          allowed: field.options,
        });
      }
      return value;
    }

    case 'date':
    case 'datetime': {
      // Only a string or a number can be a date here. Passing an object
      // through String() yields "[object Object]", which `new Date` turns into
      // Invalid Date — the right rejection for the wrong reason, and it would
      // report a confusing message.
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw AppError.badRequest(`"${field.label}" must be a date`, {
          field: field.name,
        });
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        throw AppError.badRequest(`"${field.label}" must be a valid date`, {
          field: field.name,
        });
      }
      return date;
    }

    case 'email': {
      // Not a regex: the previous `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` was a
      // polynomial ReDoS on a value taken straight from a request body.
      // See lib/email.ts.
      if (typeof value !== 'string' || !isEmailShaped(value)) {
        throw AppError.badRequest(`"${field.label}" must be a valid email address`, {
          field: field.name,
        });
      }
      return value;
    }

    default: {
      if (typeof value !== 'string') {
        throw AppError.badRequest(`"${field.label}" must be text`, { field: field.name });
      }
      return value;
    }
  }
}

function assertPermitted(
  config: ResourceConfig,
  action: 'create' | 'update' | 'delete',
): void {
  if (config.permissions?.[action] === false || config.permissions === undefined) {
    // Default-deny: a resource without an explicit permission block is
    // read-only. Forgetting to configure writes must not grant them.
    if (config.permissions?.[action] !== true) {
      throw AppError.forbidden(`${config.label} cannot be ${action}d through this API`);
    }
  }
}

/**
 * Turns Prisma's unique-constraint error into a 409 naming the field.
 *
 * A duplicate SKU or discount code is a normal thing for a user to do. Letting
 * P2002 reach the error handler produces a 500 that leaks the Prisma message —
 * and with it the table and column names — while telling the user nothing about
 * what they typed.
 *
 * Generic on purpose: every resource with a unique column gets this without
 * per-resource code, which is what the hand-written products route did by hand.
 */
function translateWriteError(error: unknown, config: ResourceConfig): unknown {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return error;
  }

  const target = error.meta?.target;
  const columns = Array.isArray(target) ? target.map(String) : [];

  // Report the field's human LABEL where we can resolve it — the column name
  // is an implementation detail the user never chose.
  const labels = columns
    .map((column) => config.fields.find((f) => f.name === column)?.label ?? column)
    .filter(Boolean);

  return AppError.conflict(
    labels.length > 0
      ? `Another ${config.label.toLowerCase().replace(/s$/, '')} already uses this ${labels.join(', ')}`
      : 'That value is already taken',
    { fields: columns },
  );
}

/**
 * `getResourceRow` attaches `${field}__label` keys for the UI. Those are
 * derived, not stored, so diffing a labelled "before" against an unlabelled
 * "after" would report every relation field as changed. Stripped before any
 * diff so the audit trail reflects real column changes only.
 */
function stripLabels(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.endsWith('__label')));
}

export async function createResourceRow(
  config: ResourceConfig,
  body: Record<string, unknown>,
  req: Request,
): Promise<Record<string, unknown>> {
  assertPermitted(config, 'create');

  const data = await buildWriteData(config, body, { partial: false });

  try {
    const row = await delegateFor(config).create({ data, select: selectFor(config) });
    const serialized = serializeRow(row, config);

    audit(req, {
      action: `${config.resource}.create`,
      entity: config.resource,
      entityId: typeof serialized.id === 'string' ? serialized.id : null,
      changes: diff({}, serialized),
    });

    return serialized;
  } catch (error) {
    throw translateWriteError(error, config);
  }
}

export async function updateResourceRow(
  config: ResourceConfig,
  id: string,
  body: Record<string, unknown>,
  req: Request,
): Promise<Record<string, unknown>> {
  assertPermitted(config, 'update');

  // Existence first, so a bad id is a 404 rather than Prisma's P2025 surfacing
  // as a 500. Doubles as the "before" side of the audit diff.
  const before = await getResourceRow(config, id);

  const data = await buildWriteData(config, body, { partial: true });

  try {
    const row = await delegateFor(config).update({
      where: { id },
      data,
      select: selectFor(config),
    });
    const after = serializeRow(row, config);

    // An update that changed nothing gets no entry — a reviewer reading the
    // trail sees decisions, not a row for every save.
    const changes = diff(stripLabels(before), after);
    if (Object.keys(changes).length > 0) {
      audit(req, {
        action: `${config.resource}.update`,
        entity: config.resource,
        entityId: id,
        changes,
      });
    }

    // Fire-and-forget, same discipline as audit() — a hook failure (e.g.
    // products' redirect recording) must never make an update that already
    // committed look like it failed to the caller.
    void hooksFor(config.resource)?.afterUpdate?.(id, before, after, req);

    return after;
  } catch (error) {
    throw translateWriteError(error, config);
  }
}

export interface DeleteResult {
  row: Record<string, unknown>;
  /** 'archived' when a hook kept the row instead of removing it. */
  action: 'deleted' | 'archived';
}

export async function deleteResourceRow(
  config: ResourceConfig,
  id: string,
  req: Request,
): Promise<DeleteResult> {
  assertPermitted(config, 'delete');

  const before = await getResourceRow(config, id);

  // A resource may refuse the plain delete and do something else — see
  // resource-hooks.ts for why that lives in code rather than config.
  const outcome = await hooksFor(config.resource)?.beforeDelete?.(id);

  if (outcome?.handled) {
    // Re-read so the caller gets the row as it now stands, not as it was.
    const after = await getResourceRow(config, id);

    audit(req, {
      action: `${config.resource}.archive`,
      entity: config.resource,
      entityId: id,
      changes: diff(stripLabels(before), stripLabels(after)),
    });

    return { row: after, action: outcome.action ?? 'archived' };
  }

  const row = await delegateFor(config).delete({ where: { id }, select: selectFor(config) });

  // Not a field diff — the row is gone, not changed. Recording every column as
  // "changed to null" would be a full snapshot of the deleted row wearing a
  // diff's clothes, which is exactly what the audit log is designed to avoid.
  audit(req, {
    action: `${config.resource}.delete`,
    entity: config.resource,
    entityId: id,
    changes: null,
  });

  return { row: serializeRow(row, config), action: 'deleted' };
}

/**
 * A page is capped at MAX_PAGE_SIZE; an export is not a page. Capped instead
 * at a fixed ceiling so a resource with an unexpectedly large table degrades
 * to "truncated, told you so" rather than an unbounded query.
 */
export const RESOURCE_EXPORT_LIMIT = 10_000;

export interface ResourceExportResult {
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/**
 * All rows matching the same `search`/`filters` a list view would use, for
 * CSV export — same `where`/`select`/label-attachment as `listResource`, just
 * without pagination. Reusing `buildWhere` means an export can never see a
 * column or a filter the list view couldn't already reach.
 */
export async function listResourceForExport(
  config: ResourceConfig,
  params: Pick<ListParams, 'search' | 'filters' | 'sort' | 'dir'>,
): Promise<ResourceExportResult> {
  const delegate = delegateFor(config);
  const where = buildWhere(config, params);
  const orderBy = buildOrderBy(config, params);

  const rows = await delegate.findMany({
    where,
    orderBy,
    take: RESOURCE_EXPORT_LIMIT + 1,
    select: selectFor(config),
  });

  const truncated = rows.length > RESOURCE_EXPORT_LIMIT;
  const page = truncated ? rows.slice(0, RESOURCE_EXPORT_LIMIT) : rows;

  const serialized = page.map((row) => serializeRow(row, config));
  await attachRelationLabels(config, serialized);

  return { rows: serialized, truncated };
}

/** Options for a relation picker. Capped — a picker is not a data export. */
export async function relationOptions(
  config: ResourceConfig,
  fieldName: string,
  search?: string,
): Promise<{ value: string; label: string }[]> {
  const field = config.fields.find((f) => f.name === fieldName);

  if (!field?.relation) {
    throw AppError.badRequest(`"${fieldName}" is not a relation field`);
  }

  const target = requireResource(field.relation.resource);
  const labelField = field.relation.labelField;

  const rows = await delegateFor(target).findMany({
    where: search ? { [labelField]: { contains: search } } : {},
    orderBy: { [labelField]: 'asc' },
    take: 50,
    select: { id: true, [labelField]: true },
  });

  return rows.map((row) => ({
    value: String(row.id),
    label: String(row[labelField] ?? row.id),
  }));
}

/**
 * CSV import.
 *
 * ─── WHY THIS IS A SEPARATE COERCION LAYER, NOT A REUSE OF coerceWriteValue ──
 * A JSON body already arrives typed: a boolean field is a real `boolean`, a
 * number field a real `number`. A CSV cell is ALWAYS a string — `"true"`,
 * `"19.99"`, `"3"` — so importing has to convert cell text into the exact
 * shape `buildWriteData`/`coerceWriteValue` already validate, rather than
 * duplicating that validation a second time. This function is the ONLY new
 * validation surface; everything after it re-enters the same code path
 * every other write in this app goes through.
 *
 * `relation` is the one type CSV cannot express as a bare value the way JSON
 * can (a raw cuid means nothing to someone filling in a spreadsheet) — a
 * template names the column by the TARGET's label field, and this layer
 * resolves that label to an id via a batched pre-fetch (`buildRelationLookup`
 * below), never one query per row.
 */
export const IMPORT_ROW_LIMIT = 2_000;

export interface ImportRowError {
  row: number;
  field: string | null;
  message: string;
}

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  errors: ImportRowError[];
}

export interface ImportResult extends ImportPreview {
  imported: number;
}

/** Multi-relation cells are a single delimited string — the same separator
 *  the CSV export doesn't need (multiRelation columns are skipped there) but
 *  import does, since round-tripping a many-to-many picker through one
 *  spreadsheet cell needs SOME delimiter, and a semicolon is the one least
 *  likely to appear inside a label that a comma-based format doesn't already
 *  reserve. */
const MULTI_VALUE_SEPARATOR = ';';

/** Builds `label -> id` (case-insensitive) for every relation/multiRelation
 *  field an import might reference, in ONE query per target table rather
 *  than one per cell — a 500-row import of a resource with two relation
 *  columns is 2 queries, not 1,000. */
async function buildRelationLookups(
  config: ResourceConfig,
): Promise<Map<string, Map<string, string>>> {
  const lookups = new Map<string, Map<string, string>>();

  const relationFields = writableFields(config).filter(
    (field) => field.type === 'relation' || field.type === 'multiRelation',
  );

  for (const field of relationFields) {
    const relation = field.relation;
    if (!relation) continue;

    const target = requireResource(relation.resource);
    const labelField = relation.labelField;

    const rows = await delegateFor(target).findMany({
      select: { id: true, [labelField]: true },
    });

    const byLabel = new Map<string, string>();
    for (const row of rows) {
      const label = row[labelField];
      if (typeof label === 'string') byLabel.set(label.toLowerCase(), String(row.id));
    }
    lookups.set(field.name, byLabel);
  }

  return lookups;
}

/**
 * Converts one CSV row's string cells into the typed shape `buildWriteData`
 * expects, resolving relation labels to ids along the way. Returns the
 * converted body — validation itself (required-ness, type-correctness,
 * enum membership) still happens inside `buildWriteData`, not here, so
 * there is exactly one place that decides what a valid value looks like.
 */
function csvRowToBody(
  config: ResourceConfig,
  row: Record<string, string>,
  lookups: Map<string, Map<string, string>>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  for (const field of writableFields(config)) {
    if (!Object.prototype.hasOwnProperty.call(row, field.label)) continue;

    const raw = row[field.label]?.trim() ?? '';

    if (raw === '') {
      // An empty cell means "not provided" for a create, same as an absent
      // JSON key — NOT the literal empty string, which coerceWriteValue
      // treats as an explicit clear (fine for update, wrong for a fresh row
      // where "clear" has nothing to clear).
      continue;
    }

    switch (field.type) {
      case 'number':
        body[field.name] = Number(raw);
        break;

      case 'boolean': {
        const lower = raw.toLowerCase();
        if (['true', '1', 'yes'].includes(lower)) body[field.name] = true;
        else if (['false', '0', 'no'].includes(lower)) body[field.name] = false;
        // Anything else is left as the raw string — coerceWriteValue's own
        // "`must be true or false`" rejection is the one message the user
        // sees, rather than this layer inventing a second wording for the
        // same failure.
        else body[field.name] = raw;
        break;
      }

      case 'relation': {
        const id = lookups.get(field.name)?.get(raw.toLowerCase());
        // An unresolved label is passed through AS THE RAW TEXT rather than
        // silently dropped — coerceRelationValue's existence check then
        // rejects a value that resolves to nothing real, naming the field,
        // instead of the row quietly landing with that relation unset.
        body[field.name] = id ?? raw;
        break;
      }

      case 'multiRelation': {
        const labels = raw
          .split(MULTI_VALUE_SEPARATOR)
          .map((label) => label.trim())
          .filter((label) => label.length > 0);
        const table = lookups.get(field.name);
        body[field.name] = labels.map((label) => table?.get(label.toLowerCase()) ?? label);
        break;
      }

      default:
        body[field.name] = raw;
    }
  }

  return body;
}

/**
 * Validates every row without writing anything — the dry-run half of
 * import. Shared by the preview endpoint AND the apply endpoint (apply
 * re-validates from scratch rather than trusting a client-supplied "this was
 * already checked" flag, since the underlying data — a relation target, a
 * unique column — could have changed in the gap between preview and apply).
 */
export async function previewResourceImport(
  config: ResourceConfig,
  rows: Record<string, string>[],
): Promise<{ preview: ImportPreview; validated: Record<string, unknown>[] }> {
  assertPermitted(config, 'create');

  if (rows.length === 0) {
    throw AppError.badRequest('The file has no data rows');
  }
  if (rows.length > IMPORT_ROW_LIMIT) {
    throw AppError.badRequest(`Import is capped at ${IMPORT_ROW_LIMIT} rows per file`, {
      max: IMPORT_ROW_LIMIT,
      received: rows.length,
    });
  }

  const lookups = await buildRelationLookups(config);
  const errors: ImportRowError[] = [];
  const validated: Record<string, unknown>[] = [];

  for (const [index, row] of rows.entries()) {
    // 1-indexed and counting the header line, so "row 2" in an error message
    // is the same row a spreadsheet application would call row 2.
    const rowNumber = index + 2;

    try {
      const body = csvRowToBody(config, row, lookups);
      const data = await buildWriteData(config, body, { partial: false });
      validated.push(data);
    } catch (caught) {
      if (caught instanceof AppError) {
        const field =
          typeof caught.details === 'object' &&
          caught.details !== null &&
          'field' in caught.details &&
          typeof (caught.details as { field?: unknown }).field === 'string'
            ? (caught.details as { field: string }).field
            : null;
        errors.push({ row: rowNumber, field, message: caught.message });
      } else {
        errors.push({ row: rowNumber, field: null, message: 'Unexpected error validating this row' });
      }
    }
  }

  return {
    preview: { totalRows: rows.length, validRows: validated.length, errors },
    validated,
  };
}

/**
 * Commits an import — ALL rows in one transaction, so "no silent partial
 * writes" is a database guarantee, not a best-effort loop. If even one row
 * that validated at preview time fails to write (a unique-constraint race,
 * a relation deleted in the gap since preview), the whole transaction rolls
 * back and reports zero imported rather than leaving the table with an
 * unpredictable subset of the file applied.
 */
export async function applyResourceImport(
  config: ResourceConfig,
  rows: Record<string, string>[],
  req: Request,
): Promise<ImportResult> {
  const { preview, validated } = await previewResourceImport(config, rows);

  if (preview.errors.length > 0) {
    // Apply refuses outright rather than importing the valid subset — a
    // partial import of "47 of 50 rows" is a worse failure mode than
    // refusing all 50, because the 47 that landed now silently disagree
    // with whatever the other 3 were supposed to complete (e.g. a batch of
    // discount codes meant to be redeemed together).
    return { ...preview, imported: 0 };
  }

  const createdIds: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const data of validated) {
        const row = await delegateFor(config, tx).create({ data, select: selectFor(config) });
        createdIds.push(String(row.id));
      }
    });
  } catch (error) {
    // A unique-constraint race (e.g. a duplicate barcode/SKU written by
    // someone else in the gap since preview) must surface as the same clean
    // 400 a single create/update gets, not a raw Prisma error escaping this
    // transaction as an unhandled 500.
    throw translateWriteError(error, config);
  }

  // One audit entry for the whole batch, not one per row — a reviewer
  // asking "was this data bulk-imported" needs the fact and the count, not
  // fifty near-identical rows crowding out everything else in the trail
  // around it.
  audit(req, {
    action: `${config.resource}.import`,
    entity: config.resource,
    changes: { rowCount: createdIds.length, ids: createdIds },
  });

  return { ...preview, imported: createdIds.length };
}

/** Column headers for the downloadable import template — writable field
 *  LABELS, matching what csvRowToBody reads back, not the internal field
 *  name a user importing data has never seen. */
export function importTemplateColumns(config: ResourceConfig): string[] {
  return writableFields(config).map((field) => field.label);
}
