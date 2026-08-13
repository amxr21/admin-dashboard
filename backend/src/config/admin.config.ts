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
  | 'relation'
  /** Many-to-many. `relation` names the target the same way `relation` does,
   *  but the value is an array of ids rather than one. Renders as a
   *  checkbox-list picker; written via Prisma's `{ set: [...] }`, which
   *  replaces the whole relation list atomically. */
  | 'multiRelation';

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
  /**
   * Shown by the form when an EXISTING non-empty value is being changed to
   * something different (never on first-time entry, and never on create —
   * there is nothing to warn about changing yet). Purely a UI hint; the
   * backend enforces nothing extra because of this flag.
   */
  changeWarning?: string;
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
      { name: 'price', label: 'Price', type: 'money', required: true, sortable: true },
      // Optional and deliberately not in the list view: most rows won't have
      // it filled in yet, and margin reporting must treat a blank cost as
      // "not tracked", never as free — see the schema comment on Product.cost.
      { name: 'cost', label: 'Cost', type: 'money', inList: false },
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
      // Shipping/customs block. All optional and off the list view — a
      // catalogue table isn't where anyone scans for these, and most rows
      // won't have them filled in yet (same "not yet tracked" framing as
      // `cost`, not a required-fields regression).
      { name: 'barcode', label: 'Barcode (EAN/UPC)', type: 'text', inList: false, searchable: true },
      { name: 'weightKg', label: 'Weight (kg)', type: 'number', inList: false },
      { name: 'lengthCm', label: 'Length (cm)', type: 'number', inList: false },
      { name: 'widthCm', label: 'Width (cm)', type: 'number', inList: false },
      { name: 'heightCm', label: 'Height (cm)', type: 'number', inList: false },
      { name: 'hsCode', label: 'HS code', type: 'text', inList: false },
      { name: 'countryOfOrigin', label: 'Country of origin', type: 'text', inList: false },
      // SEO block. `slug` is never auto-derived from `name` on write — see
      // the schema comment on Product.slug — a user types it, so changing it
      // is a deliberate act the UI can warn about, not a side effect of
      // renaming the product. Meta title/description are single-locale for
      // now, matching `name`/`description` (no i18n content model exists
      // yet — that's A5.8's job, not duplicated here).
      {
        name: 'slug',
        label: 'Slug',
        type: 'text',
        inList: false,
        searchable: true,
        changeWarning:
          'Changing the slug records a redirect from the old one, but nothing in this app resolves products by slug yet — this is for a future public site.',
      },
      { name: 'metaTitle', label: 'Meta title', type: 'text', inList: false },
      { name: 'metaDescription', label: 'Meta description', type: 'longtext', inList: false },
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
    // Notifications are EMITTED by the system, never authored OR edited by
    // staff — the only two things anyone does to one are read it and
    // dismiss it, neither of which is "editing a record". `update` used to
    // be `true` so `isRead` could be toggled through the generic engine's
    // edit form, which read as "you can edit a notification" — wrong frame
    // for what was actually happening. Reading and marking-all-read are now
    // bespoke routes (notifications.route.ts); delete stays on for
    // dismissing.
    permissions: { create: false, update: false, delete: true },
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
      // Staff-only, never surfaced to the customer — the customer has no API
      // access to this resource at all, so "staff-only" falls out of the
      // existing permission model rather than needing a new rule.
      { name: 'internalNotes', label: 'Internal notes', type: 'longtext', inList: false },
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
      { name: 'value', label: 'Value', type: 'money', required: true, sortable: true },
      { name: 'maxUses', label: 'Max uses', type: 'number' },
      { name: 'usedCount', label: 'Used', type: 'number', readOnly: true, sortable: true },
      { name: 'isActive', label: 'Active', type: 'boolean', sortable: true },
      { name: 'expiresAt', label: 'Expires', type: 'datetime', sortable: true },
      {
        name: 'scope',
        label: 'Scope',
        type: 'enum',
        options: ['ALL', 'CATEGORY', 'PRODUCT', 'CUSTOMER'],
        sortable: true,
      },
      // All three pickers are always shown — the generic form has no notion
      // of "only show this field when another field has value X". Only the
      // ONE matching the chosen scope is ever read by anything (there's no
      // apply-logic yet at all; see the field descriptions below and
      // ROADMAP.md's note on this), so an unused picker is inert, not wrong.
      {
        name: 'categories',
        label: 'Categories (used only when Scope = Category)',
        type: 'multiRelation',
        relation: { resource: 'categories', labelField: 'name' },
        inList: false,
      },
      {
        name: 'products',
        label: 'Products (used only when Scope = Product)',
        type: 'multiRelation',
        relation: { resource: 'products', labelField: 'name' },
        inList: false,
      },
      {
        name: 'customers',
        label: 'Customers (used only when Scope = Customer)',
        type: 'multiRelation',
        relation: { resource: 'customers', labelField: 'name' },
        inList: false,
      },
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
      { name: 'rating', label: 'Rating', type: 'number', sortable: true, readOnly: true },
      { name: 'body', label: 'Comment', type: 'longtext', inList: false, readOnly: true },
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
