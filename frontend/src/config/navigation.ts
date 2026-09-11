import {
  BadgePercent,
  Bell,
  Boxes,
  Building2,
  ChartColumn,
  Clock,
  ClipboardCheck,
  Database,
  FolderTree,
  History,
  LayoutDashboard,
  LogIn,
  MessagesSquare,
  Package,
  RotateCcw,
  ScanLine,
  ServerCog,
  Settings,
  ShoppingCart,
  Star,
  Truck,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

import type { Area } from '@/config/areas';

/**
 * The admin navigation.
 *
 * `area` ties each item to the backend's permission model, so the sidebar
 * hides what a role cannot reach. That is a COURTESY, not a control — the API
 * enforces independently, and a hidden link is not a protected route.
 *
 * `labelKey` indexes the `nav` translation namespace rather than holding a
 * string, so the sidebar is bilingual without a second config.
 */

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  /** Omit for items every authenticated user may see. */
  area?: Area;
}

export interface NavGroup {
  /** Optional heading. Omit for the first, unlabelled group. */
  labelKey?: string;
  items: readonly NavItem[];
}

/**
 * `/admin/r/<resource>` entries are served by the GENERIC resource page, which
 * renders itself from admin.config.ts on the backend. The remaining paths are
 * hand-written pages for areas the engine cannot express — see
 * .claude-workbook/config-engine-explained.md.
 *
 * This list is still hardcoded. It should eventually be derived from
 * /r/_schema, which is already permission-filtered — see ROADMAP item A5.
 */
export const NAVIGATION: readonly NavGroup[] = [
  {
    items: [{ href: '/admin', labelKey: 'dashboard', icon: LayoutDashboard }],
  },
  /**
   * ─── ONE GROUP FOR THE SHOP, NOT TWO ─────────────────────────────
   * There used to be a hand-written "Commerce" group (orders, inventory,
   * returns) AND a config-driven "Catalogue" group (products, categories,
   * discounts). Nothing distinguished them: Products and Inventory are the
   * same items seen two ways, so an owner looking for a product had two
   * plausible tabs and no rule for choosing. They are merged under `catalogue`
   * — the key the resource engine already assigns — so the bespoke pages and
   * the generic ones land in the same place. See `sidebar-nav.tsx`, which
   * merges groups by `labelKey`.
   */
  {
    labelKey: 'catalogue',
    items: [
      // First in the Shop group: for a cashier it is the whole job, and for
      // everyone else it is where a walk-in sale starts.
      { href: '/admin/pos', labelKey: 'pos', icon: ScanLine, area: 'orders' },
      // No `area` — clocking on/off is not a privileged act (same reasoning
      // the topbar's shift control always used), so this is visible to
      // anyone signed in, not gated behind the `orders` area the till itself
      // needs. Right after Till: the owner's note was to give the shift
      // clock a tab of its own next to the till it gates access to.
      { href: '/admin/pos/shift', labelKey: 'shift', icon: Clock },
      { href: '/admin/orders', labelKey: 'orders', icon: ShoppingCart, area: 'orders' },
      { href: '/admin/inventory', labelKey: 'inventory', icon: Boxes, area: 'inventory' },
      { href: '/admin/returns', labelKey: 'returns', icon: RotateCcw, area: 'returns' },
    ],
  },
  {
    // Couriers. `people` also receives Customers and Reviews from the resource
    // engine — see the label, which names what they have in common.
    labelKey: 'people',
    items: [
      { href: '/admin/delivery', labelKey: 'delivery', icon: Truck, area: 'delivery' },
      { href: '/admin/customer-cases', labelKey: 'customerCases', icon: MessagesSquare, area: 'customers' },
    ],
  },
  {
    labelKey: 'admin',
    items: [
      { href: '/admin/reports', labelKey: 'reports', icon: ChartColumn, area: 'reports' },
      { href: '/admin/staff', labelKey: 'staff', icon: UsersRound, area: 'staff' },
      // A manager's queue for shift approval (O9.19) — separate from `staff`
      // on purpose, since MANAGER does not hold that area and confirming a
      // shift looks legitimate is day-to-day supervision, not an HR act.
      { href: '/admin/shifts', labelKey: 'shifts', icon: ClipboardCheck, area: 'shifts' },
      // Reading the org chart needs `settings`, like the page it sits beside;
      // CHANGING it is OWNER/DEVELOPER-only and enforced on the server, not
      // by hiding the link. A MANAGER who opens this sees the shops and no
      // working create button, which is the honest version of the same rule.
      { href: '/admin/branches', labelKey: 'branches', icon: Building2, area: 'settings' },
      { href: '/admin/audit', labelKey: 'audit', icon: History, area: 'staff' },
      // Same `staff` area as Audit — it names who has been failing to sign
      // in and who worked which hours, which is personnel data, not a
      // business metric. Shifts share this page (F6.5) rather than adding a
      // near-identical second one, so the label names the whole surface.
      { href: '/admin/login-history', labelKey: 'loginHistory', icon: LogIn, area: 'staff' },
    ],
  },
];

/**
 * Rendered as its own trailing block, after every group above (including the
 * schema-driven ones merged in at render time) — not as a member of
 * `NAVIGATION`, because a group declared last in this array would still
 * render BEFORE the schema-driven groups appended in `SidebarNav` (see the
 * merge note there). Settings is the one item in the whole nav that belongs
 * at the true bottom regardless of what else gets added above it.
 */
export const SETTINGS_NAV_ITEM: NavItem = {
  href: '/admin/settings',
  labelKey: 'settings',
  icon: Settings,
  area: 'settings',
};

/**
 * Configuration reference — DEVELOPER-only, so it carries NO `area`.
 *
 * Areas describe the business (orders, products, staff) and OWNER holds `*`,
 * which would hand this to an owner as well. Operating the deployment is not
 * a business area, so the render site gates it on the ROLE instead — the same
 * distinction `diagnostics.route.ts` draws for `requireRole` over
 * `requireArea`. Hiding the link is presentation only; the API refuses
 * everyone else regardless.
 */
export const CONFIGURATION_NAV_ITEM: NavItem = {
  href: '/admin/configuration',
  labelKey: 'configuration',
  icon: ServerCog,
};

/**
 * Icons for schema-driven resources, keyed by resource name.
 *
 * The API's schema carries labels and permissions but no icon — an icon is a
 * frontend concern and shipping a component name over the wire would just be a
 * string the client has to trust. A resource with no entry here falls back to
 * a generic one and still works, so adding a resource never breaks the nav.
 */
export const RESOURCE_ICONS: Record<string, LucideIcon> = {
  products: Package,
  categories: FolderTree,
  discounts: BadgePercent,
  customers: Users,
  reviews: Star,
  notifications: Bell,
};

export const RESOURCE_ICON_FALLBACK: LucideIcon = Database;

/**
 * Which nav group a schema `group` belongs under, and its ordering.
 * Groups the schema reports but that aren't listed here are appended last.
 */
export const RESOURCE_GROUP_ORDER = ['catalogue', 'people', 'system'] as const;

/**
 * Resources surfaced somewhere OTHER than the sidebar.
 *
 * The sidebar answers "where can I go" — a stable list of places. A
 * notification count answers "has something happened", which changes while you
 * work and belongs in the top bar where it is visible from every page.
 *
 * They are excluded here rather than removed from `admin.config.ts`, because
 * the full list is still a real resource page with search and paging; the top
 * bar links straight to it. Dropping the config entry would delete the page.
 */
export const RESOURCES_OUTSIDE_SIDEBAR: readonly string[] = ['notifications', 'tags'];

/**
 * Which area, if any, governs the given path — for "view as" content gating.
 *
 * Same sources as the sidebar: the hand-written NAVIGATION entries for
 * bespoke pages, the standalone SETTINGS_NAV_ITEM, and the schema-driven
 * resources for `/admin/r/:resource`. Returns `undefined` for a path with no
 * area (the dashboard itself, or anything not in either list) — those are
 * always visible.
 */
export function resolveAreaForPath(
  pathname: string,
  resources: readonly { resource: string; permissionArea: string }[],
): Area | undefined {
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      const matches = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
      if (matches) return item.area;
    }
  }

  if (pathname.startsWith(SETTINGS_NAV_ITEM.href)) return SETTINGS_NAV_ITEM.area;

  if (pathname.startsWith('/admin/r/')) {
    const resourceName = pathname.split('/')[3];
    const resource = resources.find((candidate) => candidate.resource === resourceName);
    return resource?.permissionArea as Area | undefined;
  }

  return undefined;
}
