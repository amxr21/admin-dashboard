import { apiFetch } from '@/lib/api';

/**
 * Client for the schema-driven resource engine (`/api/v1/r/...`).
 *
 * These types MIRROR backend/src/config/admin.config.ts. They are redeclared
 * rather than imported because the two packages don't share a types package —
 * if that ever becomes painful, extract one instead of loosening these to
 * `any`, since the whole point is that the UI renders from a known shape.
 *
 * Money stays a STRING throughout, exactly as in lib/products.ts: the API sends
 * "19.99", and parsing it into a JS number here would reintroduce the float
 * error the string form exists to avoid. Format for display; never calculate.
 */

export type FieldType =
  | 'id'
  | 'text'
  | 'longtext'
  | 'number'
  | 'money'
  | 'boolean'
  | 'enum'
  | 'date'
  | 'datetime'
  | 'image'
  | 'email'
  | 'phone'
  | 'url'
  | 'relation';

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  inList?: boolean;
  inForm?: boolean;
  required?: boolean;
  searchable?: boolean;
  sortable?: boolean;
  readOnly?: boolean;
  options?: string[];
  relation?: { resource: string; labelField: string };
  currency?: string;
}

export interface ResourceSchema {
  resource: string;
  label: string;
  group: string;
  labelField: string;
  permissionArea: string;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  permissions: { create?: boolean; update?: boolean; delete?: boolean };
  fields: FieldConfig[];
}

/** A row is untyped by nature — its shape is whatever the config declares. */
export type ResourceRow = Record<string, unknown>;

export interface ResourceListResult {
  rows: ResourceRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchSchema(): Promise<ResourceSchema[]> {
  const body = await apiFetch<{ resources: ResourceSchema[] }>('/r/_schema');
  return body.resources;
}

export interface ResourceListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  /** Field filters. Keys are validated server-side against the config. */
  filters?: Record<string, string>;
}

export async function fetchRows(
  resource: string,
  params: ResourceListParams = {},
): Promise<ResourceListResult> {
  const query = new URLSearchParams();

  const { filters, ...controls } = params;

  // Empty values are omitted rather than sent blank: the engine treats an
  // unknown key as a filter and rejects it, so `status=` would be a 400.
  for (const [key, value] of Object.entries(controls)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value !== '') query.set(key, value);
  }

  return apiFetch<ResourceListResult>(`/r/${resource}?${query.toString()}`);
}

export async function fetchRow(resource: string, id: string): Promise<ResourceRow> {
  const body = await apiFetch<{ row: ResourceRow }>(`/r/${resource}/${id}`);
  return body.row;
}

export async function createRow(
  resource: string,
  data: ResourceRow,
): Promise<ResourceRow> {
  const body = await apiFetch<{ row: ResourceRow }>(`/r/${resource}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return body.row;
}

export async function updateRow(
  resource: string,
  id: string,
  data: ResourceRow,
): Promise<ResourceRow> {
  const body = await apiFetch<{ row: ResourceRow }>(`/r/${resource}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return body.row;
}

export interface DeleteRowResult {
  row: ResourceRow;
  /**
   * What actually happened. A resource hook may archive instead of delete —
   * the UI must report which, rather than claiming a delete that didn't occur.
   */
  action: 'deleted' | 'archived';
}

export async function deleteRow(
  resource: string,
  id: string,
): Promise<DeleteRowResult> {
  return apiFetch<DeleteRowResult>(`/r/${resource}/${id}`, { method: 'DELETE' });
}

export async function fetchRelationOptions(
  resource: string,
  field: string,
  search?: string,
): Promise<{ value: string; label: string }[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const body = await apiFetch<{ options: { value: string; label: string }[] }>(
    `/r/${resource}/_relations/${field}${query}`,
  );
  return body.options;
}

/** Columns shown in the list view. `inList: false` opts a field out. */
export function listFields(schema: ResourceSchema): FieldConfig[] {
  return schema.fields.filter((field) => field.inList !== false && field.type !== 'id');
}

export function searchableFields(schema: ResourceSchema): FieldConfig[] {
  return schema.fields.filter((field) => field.searchable);
}
