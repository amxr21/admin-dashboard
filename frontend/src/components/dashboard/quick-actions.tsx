'use client';

import { useTranslations } from 'next-intl';
import { Boxes, ClipboardList, PackagePlus, Percent, ShoppingBag, UserPlus, type LucideIcon } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useCanAccessArea } from '@/components/providers/role-permissions-provider';
import type { Area, StaffRole } from '@/config/areas';

interface QuickAction {
  key: 'newSale' | 'orders' | 'addProduct' | 'addCustomer' | 'newDiscount' | 'stock';
  href: string;
  icon: LucideIcon;
  area: Area;
  /** A setup feature the action depends on; hidden when it is switched off. */
  feature?: 'pos' | 'inventory';
}

const ACTIONS: readonly QuickAction[] = [
  { key: 'newSale', href: '/admin/pos', icon: ShoppingBag, area: 'orders', feature: 'pos' },
  { key: 'orders', href: '/admin/orders', icon: ClipboardList, area: 'orders' },
  { key: 'addProduct', href: '/admin/r/products?new=1', icon: PackagePlus, area: 'products' },
  { key: 'addCustomer', href: '/admin/r/customers?new=1', icon: UserPlus, area: 'customers' },
  { key: 'newDiscount', href: '/admin/r/discounts?new=1', icon: Percent, area: 'discounts' },
  { key: 'stock', href: '/admin/inventory', icon: Boxes, area: 'inventory', feature: 'inventory' },
];

/**
 * The next thing to do, one tap away. Each action is shown only when the
 * EFFECTIVE role (View As included) can open its page and the feature it
 * needs is switched on — a shortcut to a 403 or a hidden page is worse than
 * no shortcut.
 */
export function QuickActions({ role }: { role: StaffRole | null }) {
  const t = useTranslations('dashboard.quickActions');
  const canAccessArea = useCanAccessArea();
  const { enabledFeatures } = useAppSettings();

  const visible = ACTIONS.filter(
    (action) =>
      role !== null &&
      canAccessArea(role, action.area) &&
      (action.feature === undefined || enabledFeatures[action.feature] !== false),
  );

  if (visible.length === 0) return null;

  return (
    <section aria-labelledby="quick-actions-title" className="bg-card rounded-lg border p-4 shadow-xs">
      <h2 id="quick-actions-title" className="font-semibold">
        {t('title')}
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map(({ key, href, icon: Icon }) => (
          <li key={key}>
            <Link
              href={href}
              className="bg-background hover:border-primary/40 hover:bg-accent focus-visible:ring-ring flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <Icon className="text-primary size-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{t(key)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}