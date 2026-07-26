import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import {
  fieldNames,
  getResourceConfig,
  searchableFields,
  sortableFields,
  writableFields,
  type FieldConfig,
  type ResourceConfig,
} from '../config/admin.config.js';
import { hooksFor } from './resource-hooks.js';

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
const DELEGATES = {
  category: prisma.category,
  customer: prisma.customer,
  discount: prisma.discount,
  notification: prisma.notification,
  review: prisma.review,
  product: prisma.product,
} as const;

type DelegateName = keyof typeof DELEGATES;

/** Minimal shape shared by every Prisma model delegate we use. */
interface ModelDelegate {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
  delete: (args: unknown) => Promise<Record<string, unknown>>;
}

function delegateFor(config: ResourceConfig): ModelDelegate {
  const delegate = DELEGATES[config.model as DelegateName] as ModelDelegate | undefined;

  if (!delegate) {
    // A config entry naming a model with no delegate is a programming error,
    // not a client error — fail loudly rather than 404 and look like a typo.
    throw new Error(
      `admin.config.ts declares model "${config.model}" for resource "${config.resource}", ` +
        'but resource.service.ts has no delegate for it. Add one to DELEGATES.',
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
    // Relation labels are attached separately below and carry no field config.
    out[key] = serializeValue(value, byName.get(key));
  }

  return out;
}

/** `select` built from config — the reason an undeclared column can't leak. */
function selectFor(config: ResourceConfig): Record<string, true> {
  return Object.fromEntries(fieldNames(config).map((name) => [name, true]));
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
    if (field.type !== 'relation' || !relation) continue;

    const target = getResourceConfig(relation.resource);
    if (!target) continue;

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
function buildWriteData(
  config: ResourceConfig,
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const field of writableFields(config)) {
    const present = Object.prototype.hasOwnProperty.call(body, field.name);

    if (!present) {
      if (!partial && field.required) {
        throw AppError.badRequest(`"${field.label}" is required`, { field: field.name });
      }
      continue;
    }

    data[field.name] = coerceWriteValue(field, body[field.name]);
  }

  if (Object.keys(data).length === 0) {
    throw AppError.badRequest('Provide at least one field to write');
  }

  return data;
}

function coerceWriteValue(field: FieldConfig, value: unknown): unknown {
  if (value === null || value === '') {
    if (field.required) {
      throw AppError.badRequest(`"${field.label}" is required`, { field: field.name });
    }
    return null;
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
      if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
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

export async function createResourceRow(
  config: ResourceConfig,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertPermitted(config, 'create');

  const data = buildWriteData(config, body, { partial: false });

  const row = await delegateFor(config).create({ data, select: selectFor(config) });

  return serializeRow(row, config);
}

export async function updateResourceRow(
  config: ResourceConfig,
  id: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertPermitted(config, 'update');

  // Existence first, so a bad id is a 404 rather than Prisma's P2025 surfacing
  // as a 500.
  await getResourceRow(config, id);

  const data = buildWriteData(config, body, { partial: true });

  const row = await delegateFor(config).update({
    where: { id },
    data,
    select: selectFor(config),
  });

  return serializeRow(row, config);
}

export interface DeleteResult {
  row: Record<string, unknown>;
  /** 'archived' when a hook kept the row instead of removing it. */
  action: 'deleted' | 'archived';
}

export async function deleteResourceRow(
  config: ResourceConfig,
  id: string,
): Promise<DeleteResult> {
  assertPermitted(config, 'delete');

  await getResourceRow(config, id);

  // A resource may refuse the plain delete and do something else — see
  // resource-hooks.ts for why that lives in code rather than config.
  const outcome = await hooksFor(config.resource)?.beforeDelete?.(id);

  if (outcome?.handled) {
    // Re-read so the caller gets the row as it now stands, not as it was.
    return { row: await getResourceRow(config, id), action: outcome.action ?? 'archived' };
  }

  const row = await delegateFor(config).delete({ where: { id }, select: selectFor(config) });

  return { row: serializeRow(row, config), action: 'deleted' };
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
