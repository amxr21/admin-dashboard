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
  | 'multiRelation'
  /**
   * Free-text many-to-many (S7.9) — the value is an array of NAMES, not
   * ids. Genuinely different from `multiRelation`: that type picks among
   * EXISTING rows by id (a checkbox list), this type accepts text a staff
   * member just typed and reuses-by-name or creates the row on the fly.
   * `relation.resource` still names the target table (for the unique-name
   * lookup), but there is no `relation.labelField` to configure — the name
   * IS the value on both sides, so there is nothing else to look up a
   * label from.
   */
  | 'tags';

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
  /** Create-form default for booleans, matching the model default. */
  defaultValue?: boolean;
  /** Included in the `search` query. Only index-backed columns belong here. */
  searchable?: boolean;
  sortable?: boolean;
  /** Never writable, regardless of `inForm`. */
  readOnly?: boolean;
  /**
   * Example text shown in an empty input.
   *
   * Lives HERE rather than in the frontend's `placeholderFor` because the
   * useful example depends on the FIELD, not its type: "SKU" and "Meta title"
   * are both `text`, and no single string is true for both. `placeholderFor`
   * still supplies the type-level defaults (email/phone/url/money) that ARE
   * true everywhere — this only overrides them for a specific field.
   *
   * A placeholder is an EXAMPLE, never an instruction and never a stand-in
   * for the label: it disappears the moment someone types, so anything a
   * person still needs to see while filling the field belongs in the label
   * or a hint instead.
   */
  placeholder?: string;
  /**
   * A standing explanation of what this field means, shown under the control
   * and never dismissed.
   *
   * ─── WHY THIS IS NOT A PLACEHOLDER ───────────────────────────────────
   * The comment above says it outright: a placeholder is an EXAMPLE and it
   * disappears the moment someone types, so anything a person still needs
   * while filling the field has nowhere to live. That "hint" it points at did
   * not exist until now — which is why the rule behind `cost` (blank means
   * "not tracked", and the line is then excluded from margin entirely rather
   * than counted as free profit) was written only as a comment in this file,
   * beside a field with no way to display it.
   *
   * ─── THE SAME SHAPE THE SETTINGS REGISTRY ALREADY USES ───────────────
   * `settings.config.ts` has carried a `description` on nearly every key for
   * a long time, rendered by `settings-form.tsx` under the control and
   * sharing `aria-describedby` with the error. This is that, for resource
   * fields, deliberately spelled the same way so the two registries stay one
   * pattern rather than two.
   *
   * Plain text, not a translation key — same reasoning as `label` and
   * `placeholder`, and the same known limitation: the registry ships English
   * and localizing it is a larger job than any single field justifies.
   *
   * Reserve it for a rule that is NOT evident from the label. "The product's
   * name" under a field labelled Name is noise; what a blank value means, or
   * what a number is measured against, is not.
   */
  description?: string;
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
  /**
   * Progressive disclosure (URG-025). A field with no group renders in the
   * default form body; grouped fields collect into named optional sections
   * below, in first-appearance order.
   *
   * The value is a translation key under `resource.fieldGroups`, not prose —
   * the heading is localized like every other label.
   *
   * Product groups are optionally enabled in the form. Disabled groups are
   * omitted from client validation and payloads; the server still validates
   * every field it receives.
   */
  group?: string;
  /**
   * Groups whose switch starts ON for a BRAND-NEW record (B3).
   *
   * URG-026 seeds every group's switch from the DATA — a product that already
   * has a weight is self-evidently physical, so its Dimensions group opens
   * enabled. On a CREATE there is no data by definition, so every group seeded
   * off, and `cost` — which lives in `pricing` — was unreachable while adding a
   * product. The owner asked for price and cost together at that exact moment.
   *
   * This flag is the narrow exception, not a repeal: it says "this group is
   * part of describing the thing, so open it even with nothing to go on".
   * Specialist groups (shipping/customs, SEO, dimensions) deliberately do NOT
   * set it and keep URG-025's progressive disclosure — the complaint was about
   * cost, never about being asked for an HS code.
   *
   * Declared per FIELD but read per GROUP: any field carrying it opens its
   * whole group, since a group is enabled or disabled as one unit. It changes
   * only the INITIAL state of a switch the user can still turn off, and it
   * makes nothing required — a blank cost still means "not tracked", never 0.
   */
  defaultEnabled?: boolean;
  /**
   * Older CSV templates may carry a previous human label. These aliases are
   * read on import only; templates still emit the current `label`.
   */
  importAliases?: readonly string[];
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
  /**
   * Scope this resource's rows to the request's active branch, using the named
   * column.
   *
   * ─── WHY NOT JUST A FILTER ───────────────────────────────────────────
   * `filters` is exact-match by construction, and exact-match is the WRONG
   * rule here: a NULL branch means "concerns every branch" (a settings change,
   * a system alert), so an exact match on the active branch would hide exactly
   * the rows that most need to be seen. The engine builds `OR [column = active,
   * column IS NULL]` instead, which no query-string filter can express.
   *
   * Opt-in per resource: most tables either have no branch column or are
   * genuinely global (products, customers), and scoping those would silently
   * narrow lists that are correct as they are.
   */
  branchScopeField?: string;
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
      { name: 'name', label: 'Name', type: 'text', required: true, searchable: true, sortable: true, placeholder: 'e.g. Black cotton T-shirt' },
      // URG-025/028 — SKU is the identifier every product gets, so it stays
      // reachable, but it is not one of the six fields needed to list a
      // sellable product. Grouped with the other codes rather than sitting
      // between Name and Description.
      {
        name: 'sku',
        label: 'SKU',
        type: 'text',
        searchable: true,
        group: 'identifiers',
        placeholder: 'e.g. TSH-BLK-M',
        description:
          'Your own code for this product. Used for searching and on exports; it is never shown to a customer.',
      },
      // Excluded from the list view: a TEXT column makes rows unreadable and
      // is not what anyone scans a catalogue for.
      // URG-025 — not one of the six fields needed to list a sellable product.
      // A long description is written deliberately, not filled in while
      // rattling off name/price/stock, so it groups with the other content.
      {
        name: 'description',
        label: 'Description',
        type: 'longtext',
        inList: false,
        group: 'organisation',
        placeholder: 'e.g. Soft combed cotton, pre-shrunk, fits true to size',
      },
      { name: 'price', label: 'Price', type: 'money', required: true, sortable: true },
      {
        name: 'isTaxable',
        label: 'Charge VAT on this product',
        type: 'boolean',
        inList: false,
        group: 'pricing',
        defaultValue: true,
        description:
          'When enabled, the store VAT rate is added at checkout. Turn it off only for a product that is VAT-exempt or zero-rated under your tax rules.',
      },
      // Optional and deliberately not in the list view: most rows won't have
      // it filled in yet, and margin reporting must treat a blank cost as
      // "not tracked", never as free — see the schema comment on Product.cost.
      //
      // `defaultEnabled` (B3) opens the Cost & margin group on a new product so
      // cost sits next to price while someone is adding one, which is what the
      // owner asked for. Still OPTIONAL: the switch can be turned off, and a
      // blank cost saves as NULL, keeping "not tracked" distinct from a real
      // zero. That distinction is what the dashboard's "Based on N of M order
      // lines" coverage note is built on, so it must survive this change —
      // making cost easy to fill is the goal, making it mandatory is not.
      {
        name: 'cost',
        label: 'Cost',
        type: 'money',
        inList: false,
        group: 'pricing',
        defaultEnabled: true,
        // The rule this field has always had, finally on screen: a blank cost
        // is "not tracked", never zero, and profit reporting drops the line
        // rather than treating it as pure margin. Stated here because nothing
        // about a money input labelled "Cost" implies any of it.
        description:
          'What one unit costs you. Leave it blank if you do not track it — blank is not zero, and lines without a cost are left out of profit and margin entirely rather than counted as free.',
      },
      {
        name: 'stock',
        label: 'Stock',
        type: 'number',
        sortable: true,
        placeholder: 'e.g. 24',
        // Says where the real control lives. Editing this number here writes
        // no movement, so the two surfaces disagree unless someone says so.
        description:
          'The quantity on hand right now. Day-to-day changes belong on the Inventory page, where each one is recorded as a movement with a reason.',
      },
      /**
       * Per-product stock defaults (F7.8). Both `inList: false` — they are
       * setup values you fill in once, not columns worth a place in a list
       * that already carries name/SKU/stock/cost.
       *
       * Blank on either means FALL BACK, never zero: an empty threshold uses
       * the store-wide `inventory.lowStockThreshold`, and an empty location
       * means "not recorded".
       */
      {
        name: 'lowStockThreshold',
        label: 'Low stock alert at',
        type: 'number',
        inList: false,
        group: 'inventory',
        placeholder: 'e.g. 5',
        description:
          "This product's own alert level. Leave it blank to use the store-wide threshold from Settings — blank means \"follow the default\", never zero.",
      },
      {
        name: 'storageLocation',
        label: 'Stored at',
        type: 'text',
        inList: false,
        group: 'inventory',
        placeholder: 'e.g. Aisle 3, shelf B',
      },
      {
        name: 'categoryId',
        label: 'Category',
        type: 'relation',
        relation: { resource: 'categories', labelField: 'name' },
      },
      // Free-text, reused by name (S7.9, the owner's own call) — genuinely
      // different from the `multiRelation` pickers above/below: this one
      // accepts text a staff member just typed, not a selection from an
      // existing list. See the FieldType's own comment for why.
      {
        name: 'tags',
        label: 'Tags',
        type: 'tags',
        relation: { resource: 'tags', labelField: 'name' },
        group: 'organisation',
      },
      /**
       * URG-029/030 — per-product opt-in for the variant and colour
       * dimensions. Grouped with the other options rather than sitting in the
       * default body: a simple product should never have to answer them.
       *
       * Turning either off hides the builder and NOTHING else — existing
       * variant rows keep their stock and sales history, per the owner's
       * decision that a UI toggle must not destroy data. Because that also
       * hides the only route to those rows, the form warns as the change is
       * made rather than letting real variants quietly become unreachable
       * (URG-029).
       */
      { name: 'hasVariants', label: 'This product has variants', type: 'boolean', inList: false, group: 'options' },
      { name: 'hasColors', label: 'This product has colours', type: 'boolean', inList: false, group: 'options' },
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
      /**
       * URG-028 — a barcode is opt-in per product, and says which symbology
       * it is.
       *
       * Grouped with the other codes, and `hasBarcode` sits FIRST so the
       * switch reads before the fields it governs. A shop selling unpackaged
       * goods (a bakery, a cafe) never prints one, and the toggle is what
       * stops the form asking them for it.
       *
       * The type is a plain enum field rather than free text: the point of
       * declaring it is that `lib/barcode.ts` can then check the digits, and
       * an unconstrained string would defeat that. Legacy rows hold NULL,
       * which that module treats as "unclassified, accept as-is".
       */
      {
        name: 'hasBarcode',
        label: 'This product has a barcode',
        type: 'boolean',
        inList: false,
        group: 'identifiers',
      },
      {
        name: 'barcodeType',
        label: 'Barcode type',
        type: 'enum',
        options: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF14', 'CODE128'],
        inList: false,
        group: 'identifiers',
      },
      {
        name: 'barcode',
        label: 'Barcode',
        type: 'text',
        inList: false,
        searchable: true,
        group: 'identifiers',
        importAliases: ['Barcode (EAN/UPC)'],
        placeholder: 'e.g. 5901234123457',
        description:
          'What a scanner reads at the till. Only products with one can be scanned; everything else is found by tapping the grid.',
      },
      { name: 'weightKg', label: 'Weight (kg)', type: 'number', inList: false, group: 'physical', placeholder: 'e.g. 0.25' },
      { name: 'lengthCm', label: 'Length (cm)', type: 'number', inList: false, group: 'physical', placeholder: 'e.g. 30' },
      { name: 'widthCm', label: 'Width (cm)', type: 'number', inList: false, group: 'physical', placeholder: 'e.g. 22' },
      { name: 'heightCm', label: 'Height (cm)', type: 'number', inList: false, group: 'physical', placeholder: 'e.g. 3' },
      { name: 'hsCode', label: 'HS code', type: 'text', inList: false, group: 'shipping', placeholder: 'e.g. 6109.10' },
      {
        name: 'countryOfOrigin',
        label: 'Country of origin',
        type: 'text',
        inList: false,
        group: 'shipping',
        placeholder: 'e.g. India',
      },
      // SEO block. `slug` is auto-derived from `name` ON CREATE ONLY, and only
      // when the user left it blank (C1/C2, owner-approved) — see the products
      // hook in resource-hooks.ts, which reuses `uniqueSlug` so a clash becomes
      // `blue-mug-2` rather than a 409 nobody asked for.
      //
      // This comment previously read "never auto-derived from `name` on write".
      // That rule still holds for every UPDATE, which is what it was really
      // protecting: an existing slug is a URL someone may have linked, and
      // changing one records a `ProductRedirect`, so it stays a deliberate act
      // the UI warns about rather than a side effect of renaming a product. The
      // create case it also covered was never the risk — there is no previous
      // slug to redirect from — and leaving it blank just produced a product
      // with no URL key at all. Meta title/description are single-locale for
      // now, matching `name`/`description` (no i18n content model exists
      // yet — that's A5.8's job, not duplicated here).
      {
        name: 'slug',
        label: 'Slug',
        type: 'text',
        inList: false,
        searchable: true,
        group: 'seo',
        changeWarning:
          'Changing the slug records a redirect from the old one, but nothing in this app resolves products by slug yet — this is for a future public site.',
        placeholder: 'e.g. black-cotton-t-shirt',
      },
      { name: 'metaTitle', label: 'Meta title', type: 'text', inList: false, group: 'seo', placeholder: 'e.g. Black Cotton T-Shirt | Nour' },
      {
        name: 'metaDescription',
        label: 'Meta description',
        type: 'longtext',
        inList: false,
        group: 'seo',
        placeholder: 'e.g. Soft combed-cotton tee in black. Free returns within 30 days.',
        description:
          'The summary a search engine may show under the title. Nothing in this app displays it yet — it is groundwork for a future public site.',
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
    // Notifications are EMITTED by the system, never authored OR edited by
    // staff — the only two things anyone does to one are read it and
    // dismiss it, neither of which is "editing a record". `update` used to
    // be `true` so `isRead` could be toggled through the generic engine's
    // edit form, which read as "you can edit a notification" — wrong frame
    // for what was actually happening. Reading and marking-all-read are now
    // bespoke routes (notifications.route.ts); delete stays on for
    // dismissing.
    permissions: { create: false, update: false, delete: true },
    // A low-stock alert belongs to the shop that is low; a settings change
    // belongs to everyone. `branchId IS NULL` carries that second case, so
    // selecting a branch narrows to its own alerts WITHOUT losing the
    // install-wide ones. See `branchScopeField` on ResourceConfig.
    branchScopeField: 'branchId',
    fields: [
      { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
      { name: 'type', label: 'Type', type: 'text', readOnly: true, sortable: true },
      { name: 'title', label: 'Title', type: 'text', readOnly: true, searchable: true },
      { name: 'body', label: 'Body', type: 'longtext', readOnly: true, inList: false },
      { name: 'link', label: 'Link', type: 'url', readOnly: true, inList: false },
      // Declared so the column EXISTS for the engine, not so anyone filters by
      // it from a query string: branch scoping is applied server-side from the
      // `X-Branch-Id` header (see `branchScopeField` below), because the rule
      // is an OR with NULL that an exact-match filter cannot express.
      { name: 'branchId', label: 'Branch', type: 'text', readOnly: true, inForm: false, inList: false },
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
      { name: 'name', label: 'Name', type: 'text', required: true, searchable: true, sortable: true, placeholder: 'e.g. Hot drinks' },
      // URG-027/032 — no longer required of the ADMINISTRATOR. The column is
      // still NOT NULL and unique; `resource-hooks.ts` derives a free slug
      // from the name on create when this is left blank. Keeping
      // `required: true` here would make the form refuse the write before the
      // server ever got the chance to generate one, which is precisely the
      // "adding a category feels strange" complaint.
      { name: 'slug', label: 'Slug', type: 'text', searchable: true, placeholder: 'e.g. hot-drinks' },
      // Depth cap and circular-parent prevention are enforced server-side
      // (resource-hooks.ts's beforeWrite, S7.6) — a resource with no field
      // rule for "cannot select an id below a certain depth" leans on that,
      // not on this config.
      {
        name: 'parentId',
        label: 'Parent category',
        type: 'relation',
        relation: { resource: 'categories', labelField: 'name' },
      },
      { name: 'isActive', label: 'Active', type: 'boolean', defaultValue: true, sortable: true },
      { name: 'createdAt', label: 'Created', type: 'datetime', inForm: false, readOnly: true, sortable: true },
    ],
  },
  /**
   * Product tags (S7.9) — exists as a resource only so the `tags` FIELD
   * TYPE on products can resolve `requireResource('tags')` and so a tag
   * can be searched/filtered like anything else. No separate management
   * screen (the owner's own call): every write to this table goes through
   * `resource-hooks.ts`'s find-or-create on the PRODUCT form, never a
   * direct create/update/delete here — hence every permission below is
   * false. Excluded from the sidebar in navigation.ts for the same reason
   * `notifications` is: reachable through `/r/tags` for read/filter needs,
   * not a page anyone navigates to on its own.
   */
  {
    resource: 'tags',
    model: 'tag',
    label: 'Tags',
    group: 'catalogue',
    labelField: 'name',
    permissionArea: 'products',
    defaultSort: { field: 'name', dir: 'asc' },
    permissions: { create: false, update: false, delete: false },
    fields: [
      { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
      { name: 'name', label: 'Name', type: 'text', required: true, searchable: true, sortable: true },
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
      { name: 'name', label: 'Name', type: 'text', required: true, searchable: true, sortable: true, placeholder: 'e.g. Sarah Haddad' },
      // email/phone deliberately carry no placeholder: `placeholderFor` already
      // supplies a format example true for every field of those types.
      { name: 'email', label: 'Email', type: 'email', required: true, searchable: true, sortable: true },
      { name: 'phone', label: 'Phone', type: 'phone', searchable: true },
      { name: 'city', label: 'City', type: 'text', sortable: true, placeholder: 'e.g. Dubai' },
      { name: 'country', label: 'Country', type: 'text', sortable: true, placeholder: 'e.g. United Arab Emirates' },
      // Staff-only, never surfaced to the customer — the customer has no API
      // access to this resource at all, so "staff-only" falls out of the
      // existing permission model rather than needing a new rule.
      { name: 'internalNotes', label: 'Internal notes', type: 'longtext', inList: false, placeholder: 'e.g. Prefers afternoon delivery; called about order 1042' },
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
      { name: 'code', label: 'Code', type: 'text', required: true, searchable: true, sortable: true, placeholder: 'e.g. SUMMER25' },
      { name: 'type', label: 'Type', type: 'enum', options: ['PERCENT', 'FIXED'], required: true, sortable: true },
      // PERCENT stores the percentage itself (10.00 = 10%); FIXED stores a
      // money amount. Same Decimal(10,2) either way, so the same string rule.
      { name: 'value', label: 'Value', type: 'money', required: true, sortable: true },
      { name: 'maxUses', label: 'Max uses', type: 'number', placeholder: 'e.g. 100' },
      { name: 'usedCount', label: 'Used', type: 'number', readOnly: true, sortable: true },
      { name: 'isActive', label: 'Active', type: 'boolean', defaultValue: true, sortable: true },
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
