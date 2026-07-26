import {
  BadgePercent,
  Boxes,
  ChartColumn,
  FolderTree,
  LayoutDashboard,
  Package,
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
      { href: '/admin/r/products', labelKey: 'products', icon: Package, area: 'products' },
      {
        href: '/admin/r/categories',
        labelKey: 'categories',
        icon: FolderTree,
        area: 'categories',
      },
      { href: '/admin/inventory', labelKey: 'inventory', icon: Boxes, area: 'inventory' },
      {
        href: '/admin/r/discounts',
        labelKey: 'discounts',
        icon: BadgePercent,
        area: 'discounts',
      },
    ],
  },
  {
    labelKey: 'people',
    items: [
      { href: '/admin/r/customers', labelKey: 'customers', icon: Users, area: 'customers' },
      { href: '/admin/r/reviews', labelKey: 'reviews', icon: Star, area: 'reviews' },
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
