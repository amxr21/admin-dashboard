import {
  BadgePercent,
  Bell,
  Boxes,
  ChartColumn,
  Database,
  FolderTree,
  LayoutDashboard,
  Package,
  RotateCcw,
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
  {
    labelKey: 'commerce',
    items: [
      { href: '/admin/orders', labelKey: 'orders', icon: ShoppingCart, area: 'orders' },
      { href: '/admin/inventory', labelKey: 'inventory', icon: Boxes, area: 'inventory' },
      { href: '/admin/returns', labelKey: 'returns', icon: RotateCcw, area: 'returns' },
    ],
  },
  {
    labelKey: 'people',
    items: [
      { href: '/admin/delivery', labelKey: 'delivery', icon: Truck, area: 'delivery' },
    ],
  },
  {
    labelKey: 'admin',
    items: [
      { href: '/admin/reports', labelKey: 'reports', icon: ChartColumn, area: 'reports' },
      { href: '/admin/staff', labelKey: 'staff', icon: UsersRound, area: 'staff' },
      { href: '/admin/settings', labelKey: 'settings', icon: Settings, area: 'settings' },
    ],
  },
];

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
export const RESOURCES_OUTSIDE_SIDEBAR: readonly string[] = ['notifications'];

/**
 * Which area, if any, governs the given path — for "view as" content gating.
 *
 * Same two sources as the sidebar: the hand-written NAVIGATION entries for
 * bespoke pages, and the schema-driven resources for `/admin/r/:resource`.
 * Returns `undefined` for a path with no area (the dashboard itself, or
 * anything not in either list) — those are always visible.
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

  if (pathname.startsWith('/admin/r/')) {
    const resourceName = pathname.split('/')[3];
    const resource = resources.find((candidate) => candidate.resource === resourceName);
    return resource?.permissionArea as Area | undefined;
  }

  return undefined;
}
