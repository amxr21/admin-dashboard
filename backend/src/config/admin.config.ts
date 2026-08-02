import type { Area } from './roles.js';

/**
 * admin.config.ts — the resource config for the schema-driven admin.
 *
 * ─── THIS FILE IS THE ALLOWLIST ──────────────────────────────────────
 * The generic CRUD engine can only ever read, write, sort, search or filter
 * a column that is DECLARED here. Nothing about a request can widen that:
 * resource names, field names, sort keys and filter keys are all checked
 * against this file before they reach Prisma.
 *
 * That is what makes one generic endpoint safe. Without it, `/r/users?sort=
 * passwordHash` or a POST carrying `{ role: "OWNER" }` would be a vulnerability
 * rather than a 400.
 *
 * A resource NOT listed here does not exist as far as the engine is concerned,
 * even if the table is right there in the schema. `users` is deliberately
 * absent — staff accounts have their own guarded routes.
 *
 * ─── SEMANTIC TYPES ──────────────────────────────────────────────────
 * `type` describes MEANING, not storage. The frontend picks a table cell and a
 * form control from it, so a money column renders as currency everywhere
 * without any per-page code.
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

export interface RelationSpec {
  /** Resource name to resolve labels from. Must itself be configured. */
  resource: string;
  labelField: string;
}

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  /** Shown in the list view. Defaults to true. */
  inList?: boolean;
  /** Editable in the create/edit form. Defaults to true. */
  inForm?: boolean;
  required?: boolean;
  /** Included in the `search` query. Only index-backed columns belong here. */
  searchable?: boolean;
  sortable?: boolean;
  /** Never writable, regardless of `inForm`. */
  readOnly?: boolean;
  /** For `enum`. The engine rejects any value not in this list. */
  options?: readonly string[];
  relation?: RelationSpec;
  /** For `money`. Display only — the API always emits a decimal string. */
  currency?: string;
}

export interface ResourceConfig {
  /** URL segment: /api/v1/r/<resource>. */
  resource: string;
  /** Prisma model name. Mapped to a delegate in resource.service.ts. */
  model: string;
  label: string;
  group: string;
  labelField: string;
  permissionArea: Area;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  /**
   * Which writes are allowed AT ALL for this resource. Read-only roles are
   * blocked separately by assertCanWrite — these two are independent, so a
   * resource can be read-only for everyone.
   */
  permissions?: { create?: boolean; update?: boolean; delete?: boolean };
  fields: readonly FieldConfig[];
}

export const ADMIN_RESOURCES: readonly ResourceConfig[] = [
  {
    resource: 'products',
    model: 'product',
    label: 'Products',
    group: 'catalogue',
    labelField: 'name',
    permissionArea: 'products',
    defaultSort: { field: 'createdAt', dir: 'desc' },
    permissions: { create: true, update: true, delete: true },
    fields: [
      { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
      { name: 'imageUrl', label: 'Image', type: 'image' },
      { name: 'name', label: 'Name', type: 'text', required: true, searchable: true, sortable: true },
      { name: 'sku', label: 'SKU', type: 'text', searchable: true },
      // Excluded from the list view: a TEXT column makes rows unreadable and
      // is not what anyone scans a catalogue for.
      { name: 'description', label: 'Description', type: 'longtext', inList: false },
      { name: 'price', label: 'Price', type: 'money', currency: 'AED', required: true, sortable: true },
      // Optional and deliberately not in the list view: most rows won't have
      // it filled in yet, and margin reporting must treat a blank cost as
      // "not tracked", never as free — see the schema comment on Product.cost.
      { name: 'cost', label: 'Cost', type: 'money', currency: 'AED', inList: false },
      { name: 'stock', label: 'Stock', type: 'number', sortable: true },
      {
        name: 'categoryId',
        label: 'Category',
        type: 'relation',
        relation: { resource: 'categories', labelField: 'name' },
      },
      {
        name: 'status',
        label: 'Status',
        type: 'enum',
        options: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
        sortable: true,
      },
      { name: 'createdAt', label: 'Created', type: 'datetime', inForm: false, readOnly: true, sortable: true },
    ],
  },
  {
    resource: 'notifications',
    model: 'notification',
    label: 'Notifications',
    group: 'system',
    labelField: 'title',
    permissionArea: 'settings',
    defaultSort: { field: 'createdAt', dir: 'desc' },
    // Notifications are EMITTED by the system, never authored by staff. Only
    // `isRead` is meaningfully editable, so create is off and delete stays on
    // for clearing noise.
    permissions: { create: false, update: true, delete: true },
    fields: [
      { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
      { name: 'type', label: 'Type', type: 'text', readOnly: true, sortable: true },
      { name: 'title', label: 'Title', type: 'text', readOnly: true, searchable: true },
      { name: 'body', label: 'Body', type: 'longtext', readOnly: true, inList: false },
      { name: 'link', label: 'Link', type: 'url', readOnly: true, inList: false },
      { name: 'isRead', label: 'Read', type: 'boolean', sortable: true },
      { name: 'createdAt', label: 'Created', type: 'datetime', inForm: false, readOnly: true, sortable: true },
    ],
  },
  {
    resource: 'categories',
    model: 'category',
    label: 'Categories',
    group: 'catalogue',
    labelField: 'name',
    permissionArea: 'categories',
    defaultSort: { field: 'name', dir: 'asc' },
    permissions: { create: true, update: true, delete: true },
    fields: [
      { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
      { name: 'name', label: 'Name', type: 'text', required: true, searchable: true, sortable: true },
      { name: 'slug', label: 'Slug', type: 'text', required: true, searchable: true },
      { name: 'isActive', label: 'Active', type: 'boolean', sortable: true },
      { name: 'createdAt', label: 'Created', type: 'datetime', inForm: false, readOnly: true, sortable: true },
    ],
  },
  {
    resource: 'customers',
    model: 'customer',
    label: 'Customers',
    group: 'people',
    labelField: 'name',
    permissionArea: 'customers',
    defaultSort: { field: 'createdAt', dir: 'desc' },
    permissions: { create: true, update: true, delete: true },
    fields: [
      { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
      { name: 'name', label: 'Name', type: 'text', required: true, searchable: true, sortable: true },
      { name: 'email', label: 'Email', type: 'email', required: true, searchable: true, sortable: true },
      { name: 'phone', label: 'Phone', type: 'phone', searchable: true },
      { name: 'city', label: 'City', type: 'text', sortable: true },
      { name: 'country', label: 'Country', type: 'text', sortable: true },
      { name: 'createdAt', label: 'Created', type: 'datetime', inForm: false, readOnly: true, sortable: true },
    ],
  },
  {
    resource: 'discounts',
    model: 'discount',
    label: 'Discounts',
    group: 'catalogue',
    labelField: 'code',
    permissionArea: 'discounts',
    defaultSort: { field: 'createdAt', dir: 'desc' },
    permissions: { create: true, update: true, delete: true },
    fields: [
      { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
      { name: 'code', label: 'Code', type: 'text', required: true, searchable: true, sortable: true },
      { name: 'type', label: 'Type', type: 'enum', options: ['PERCENT', 'FIXED'], required: true, sortable: true },
      // PERCENT stores the percentage itself (10.00 = 10%); FIXED stores a
      // money amount. Same Decimal(10,2) either way, so the same string rule.
      { name: 'value', label: 'Value', type: 'money', currency: 'AED', required: true, sortable: true },
      { name: 'maxUses', label: 'Max uses', type: 'number' },
      { name: 'usedCount', label: 'Used', type: 'number', readOnly: true, sortable: true },
      { name: 'isActive', label: 'Active', type: 'boolean', sortable: true },
      { name: 'expiresAt', label: 'Expires', type: 'datetime', sortable: true },
      { name: 'createdAt', label: 'Created', type: 'datetime', inForm: false, readOnly: true, sortable: true },
    ],
  },
  {
    resource: 'reviews',
    model: 'review',
    label: 'Reviews',
    group: 'people',
    labelField: 'id',
    permissionArea: 'reviews',
    defaultSort: { field: 'createdAt', dir: 'desc' },
    // Reviews are written by customers, not staff. Staff moderate them, so
    // update is allowed and create is not.
    permissions: { create: false, update: true, delete: true },
    fields: [
      { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
      { name: 'rating', label: 'Rating', type: 'number', sortable: true },
      { name: 'body', label: 'Comment', type: 'longtext', inList: false },
      {
        name: 'status',
        label: 'Status',
        type: 'enum',
        options: ['PENDING', 'APPROVED', 'REJECTED'],
        sortable: true,
      },
      {
        name: 'productId',
        label: 'Product',
        type: 'relation',
        relation: { resource: 'products', labelField: 'name' },
        inForm: false,
      },
      { name: 'createdAt', label: 'Created', type: 'datetime', inForm: false, readOnly: true, sortable: true },
    ],
  },
];

const BY_RESOURCE = new Map(ADMIN_RESOURCES.map((r) => [r.resource, r]));

export function getResourceConfig(resource: string): ResourceConfig | undefined {
  return BY_RESOURCE.get(resource);
}

export function fieldNames(config: ResourceConfig): string[] {
  return config.fields.map((f) => f.name);
}

export function searchableFields(config: ResourceConfig): string[] {
  return config.fields.filter((f) => f.searchable).map((f) => f.name);
}

export function sortableFields(config: ResourceConfig): string[] {
  return config.fields.filter((f) => f.sortable).map((f) => f.name);
}

/**
 * Fields a client may WRITE.
 *
 * `readOnly` and `inForm: false` both exclude a field. This is the mass-assignment
 * choke point: anything not returned here is dropped from the payload rather
 * than rejected, so an extra key can never reach Prisma.
 */
export function writableFields(config: ResourceConfig): FieldConfig[] {
  return config.fields.filter((f) => f.inForm !== false && !f.readOnly && f.type !== 'id');
}
