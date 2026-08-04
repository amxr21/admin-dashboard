'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  NAVIGATION,
  RESOURCE_GROUP_ORDER,
  RESOURCES_OUTSIDE_SIDEBAR,
  RESOURCE_ICONS,
  RESOURCE_ICON_FALLBACK,
  SETTINGS_NAV_ITEM,
  type NavGroup,
  type NavItem,
} from '@/config/navigation';
import { canAccessArea, type Area, type StaffRole } from '@/config/areas';
import { useResourceSchema } from '@/components/providers/schema-provider';
import { getDirection } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * The navigation list. Shared by the desktop sidebar and the mobile drawer so
 * there is exactly one definition of what the nav contains and how it behaves.
 */

interface SidebarNavProps {
  role: StaffRole;
  /** Mobile drawer passes a close handler so tapping a link dismisses it. */
  onNavigate?: () => void;
  /**
   * Icon-only rail. Labels stay in the DOM (`sr-only`) rather than being
   * removed — a screen reader must still announce the destination, and it is
   * what a hover `title` attribute reads from. The mobile drawer never passes
   * this: collapsing an already-dismissable overlay saves no space that
   * matters.
   */
  collapsed?: boolean;
}

export function SidebarNav({ role, onNavigate, collapsed = false }: SidebarNavProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { resources } = useResourceSchema();
  // Deterministic from the locale (unlike `getDocumentDirection()`, which
  // reads `document` and would render 'ltr' on the server then flip after
  // hydration on an Arabic page — a real mismatch, not just a flash).
  const isRtl = getDirection(useLocale()) === 'rtl';

  /**
   * Schema-driven entries, merged with the hand-written ones.
   *
   * Generic resources come from the API so that adding one to admin.config.ts
   * puts it in the nav with no frontend change. Bespoke pages (orders,
   * inventory, delivery, reports, staff, settings) stay in NAVIGATION because
   * they are not resources and have no schema entry.
   *
   * The API already filtered the schema by the caller's permissions, and the
   * role check below runs anyway — both are courtesies, not controls.
   */
  const resourceGroups: NavGroup[] = RESOURCE_GROUP_ORDER.map((groupName) => ({
    labelKey: groupName,
    items: resources
      .filter(
        (resource) =>
          resource.group === groupName &&
          // Notifications live in the top bar; listing them here too would
          // give the same page two entry points and a stale-looking count.
          !RESOURCES_OUTSIDE_SIDEBAR.includes(resource.resource),
      )
      .map((resource) => ({
        href: `/admin/r/${resource.resource}`,
        // Prefer a translated label; fall back to the schema's English one so
        // a resource added today still reads sensibly before it is translated.
        labelKey: resource.resource,
        icon: RESOURCE_ICONS[resource.resource] ?? RESOURCE_ICON_FALLBACK,
        area: resource.permissionArea as Area,
      })),
  })).filter((group) => group.items.length > 0);

  /**
   * Merged by group key, NOT concatenated.
   *
   * Both sources legitimately produce a `people` group — NAVIGATION owns
   * Delivery (a bespoke page) and the schema owns Customers and Reviews
   * (generic resources). Concatenating rendered the heading TWICE with the
   * items split across the two, which React surfaced as a duplicate-key
   * warning; the warning was the symptom, the split sidebar was the bug.
   *
   * Order is first-appearance, so the hand-written groups keep their intended
   * sequence and a new schema group appends rather than reshuffling the nav.
   * Within a group, bespoke pages come before generic resources for the same
   * reason.
   */
  const groups: NavGroup[] = [];
  const byKey = new Map<string, NavGroup>();

  for (const group of [...NAVIGATION, ...resourceGroups]) {
    // Groups with no labelKey (the dashboard link) are never merged — they
    // have no heading to share and each is its own visual block.
    const existing = group.labelKey ? byKey.get(group.labelKey) : undefined;

    if (existing) {
      existing.items = [...existing.items, ...group.items];
      continue;
    }

    const copy: NavGroup = { ...group, items: [...group.items] };
    groups.push(copy);
    if (group.labelKey) byKey.set(group.labelKey, copy);
  }

  /** Shared by every group's items AND the trailing Settings item below, so
   *  the two can never render the link markup differently. */
  function renderNavLink(item: NavItem) {
    // Exact match for the index route, prefix match for the rest —
    // otherwise /admin stays highlighted on every child page.
    const isActive =
      item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);

    // Falls back to the raw key so a resource added to admin.config.ts
    // before its translation still shows a usable name instead of throwing.
    const label = t.has(item.labelKey) ? t(item.labelKey) : item.labelKey;

    const link = (
      <Link
        href={item.href}
        onClick={onNavigate}
        // aria-current is what a screen reader announces; the colour is
        // only for sighted users.
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          collapsed && 'justify-center px-2',
          isActive
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {/* Nav glyphs are objects, not arrows — no mirroring. */}
        <item.icon className="size-4 shrink-0" aria-hidden />
        <span className={cn('truncate', collapsed && 'sr-only')}>{label}</span>
      </Link>
    );

    // Collapsed rail only: the label is `sr-only` above, so a sighted user
    // has no way to tell what an icon means without this. `side` is
    // PHYSICAL in Radix (not logical like `align`), so it's computed here
    // from the real reading direction rather than left to default — the
    // tooltip must open INTO the content area, which is the opposite edge
    // in Arabic.
    if (!collapsed) return <li key={item.href}>{link}</li>;

    return (
      <li key={item.href}>
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side={isRtl ? 'left' : 'right'}>
            {label}
          </TooltipContent>
        </Tooltip>
      </li>
    );
  }

  const canSeeSettings = canAccessArea(role, 'settings');

  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto" aria-label={t('dashboard')}>
      {groups.map((group, groupIndex) => {
        // Hide whole groups the role cannot reach, rather than leaving an
        // empty heading behind.
        const visible = group.items.filter(
          (item) => !item.area || canAccessArea(role, item.area),
        );
        if (visible.length === 0) return null;

        return (
          <div key={group.labelKey ?? `group-${String(groupIndex)}`}>
            {group.labelKey ? (
              <h2
                className={cn(
                  'text-muted-foreground px-3 pb-1 text-xs font-medium tracking-wide uppercase',
                  // Kept in the DOM for assistive tech, just not painted — an
                  // icon rail has no room for a heading, but the grouping is
                  // still real structure a screen reader should get.
                  collapsed && 'sr-only',
                )}
              >
                {t.has(group.labelKey) ? t(group.labelKey) : group.labelKey}
              </h2>
            ) : null}

            <ul className="space-y-0.5">{visible.map(renderNavLink)}</ul>
          </div>
        );
      })}

      {/* Pinned to the bottom of the nav (mt-auto), after every group above
          — including the schema-driven ones merged in above — so Settings is
          always the last item regardless of what else gets added to the
          nav. See SETTINGS_NAV_ITEM's own comment for why this can't just be
          "declare it last in NAVIGATION". */}
      {canSeeSettings ? (
        <div className="mt-auto border-t pt-2">
          <ul className="space-y-0.5">{renderNavLink(SETTINGS_NAV_ITEM)}</ul>
        </div>
      ) : null}
    </nav>
  );
}
