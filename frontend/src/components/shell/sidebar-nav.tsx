'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';

import { Link, usePathname } from '@/i18n/navigation';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
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
import { useAppSettings } from '@/components/providers/settings-provider';
import { useResourceSchema } from '@/components/providers/schema-provider';
import { useNavCounts } from '@/hooks/useNavCounts';
import { getDirection } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Which nav item each live count belongs to, by href. A map rather than a
 * field on `NavItem` in config/navigation.ts — that config is a list of
 * stable destinations (see its own doc comment); wiring a live count into it
 * would mix "where can I go" with "does this need attention right now" in
 * the one file that's supposed to only answer the first question.
 */
function countForHref(href: string, counts: ReturnType<typeof useNavCounts>): number | null {
  if (href === '/admin/returns') return counts.returns;
  return null;
}

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
  const navCounts = useNavCounts(role);

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

            <ul className="space-y-0.5">
              {visible.map((item) => (
                <NavLinkItem
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  isRtl={isRtl}
                  isActive={
                    item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
                  }
                  onNavigate={onNavigate}
                  count={countForHref(item.href, navCounts)}
                />
              ))}
            </ul>
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
          <ul className="space-y-0.5">
            <NavLinkItem
              item={SETTINGS_NAV_ITEM}
              collapsed={collapsed}
              isRtl={isRtl}
              isActive={pathname.startsWith(SETTINGS_NAV_ITEM.href)}
              onNavigate={onNavigate}
            />
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

/**
 * One nav row plus its hover preview — split out from `SidebarNav` so each
 * row gets its own `useState` for the preview's open state (a plain
 * per-item function called from `.map()` can't own hooks; a component can).
 *
 * ─── WHY THE PREVIEW IS CONTROLLED, NOT A BARE HoverCard ─────────────────
 * Radix's `HoverCard` is deliberately hover-only — per its own accessibility
 * guidance, it must never be the sole way to reach content, so it does not
 * open on keyboard focus. That is correct for content with another way in,
 * but a nav destination has NO other way to preview it, and the collapsed
 * rail's icon has no visible label at all otherwise. So `open` is controlled
 * here and ALSO flipped on the link's own focus/blur — a keyboard user
 * tabbing the rail gets the same preview a pointer user hovering it does.
 */
interface NavLinkItemProps {
  item: NavItem;
  collapsed: boolean;
  isRtl: boolean;
  isActive: boolean;
  onNavigate?: () => void;
  /** A live "needs attention" count — e.g. returns awaiting approval — or
   *  `null` for an item with no count, an unknown count, or a role that
   *  can't see one. See `useNavCounts`. Never shown as `0`: "nothing needs
   *  attention" earns no badge at all, same as the notification bell. */
  count?: number | null;
}

/** Matches NotificationsBell's own cutoff — see MAX_BADGE there. */
const MAX_BADGE = 99;

function NavLinkItem({ item, collapsed, isRtl, isActive, onNavigate, count }: NavLinkItemProps) {
  const t = useTranslations('nav');
  const { navLabels } = useAppSettings();
  const formatter = useFormatter();
  const [open, setOpen] = useState(false);

  // A business-specific override (Settings -> "Staff page name" etc.) wins
  // over the built-in translation; falls back to the raw key so a resource
  // added to admin.config.ts before its translation still shows a usable
  // name instead of throwing.
  const label = navLabels[item.labelKey] ?? (t.has(item.labelKey) ? t(item.labelKey) : item.labelKey);
  const descriptionKey = `descriptions.${item.labelKey}`;
  const description = t.has(descriptionKey) ? t(descriptionKey) : undefined;

  const hasCount = typeof count === 'number' && count > 0;
  const formattedCount = hasCount
    ? count > MAX_BADGE
      ? `${formatter.number(MAX_BADGE)}+`
      : formatter.number(count)
    : null;

  return (
    <li>
      <HoverCard open={open} onOpenChange={setOpen} openDelay={300} closeDelay={100}>
        <HoverCardTrigger asChild>
          <Link
            href={item.href}
            onClick={onNavigate}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            // aria-current is what a screen reader announces; the colour is
            // only for sighted users.
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              collapsed && 'justify-center px-2',
              isActive
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {/* Nav glyphs are objects, not arrows — no mirroring. */}
            <item.icon className="size-4 shrink-0" aria-hidden />
            <span className={cn('flex-1 truncate', collapsed && 'sr-only')}>{label}</span>
            {/* Screen-reader-only in BOTH rail states — the visible badges
                below carry the number for sighted users (aria-hidden, so
                they don't get announced a second time); this is what makes
                the count actually reach a screen reader user at all. */}
            {hasCount ? <span className="sr-only"> ({formattedCount})</span> : null}
            {hasCount ? (
              collapsed ? (
                // The label is sr-only in the rail, so the badge is the only
                // visual cue left — pinned to the icon's corner rather than
                // sitting inline (there is no inline space in an icon-only
                // row).
                <span
                  aria-hidden
                  className="bg-primary text-primary-foreground absolute top-0.5 end-1.5 flex min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-3.5 font-medium tabular-nums"
                >
                  {formattedCount}
                </span>
              ) : (
                <span
                  aria-hidden
                  className="bg-primary/10 text-primary flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums"
                >
                  {formattedCount}
                </span>
              )
            ) : null}
          </Link>
        </HoverCardTrigger>

        {/* `side` is PHYSICAL in Radix (not logical like `align`), so it is
            computed from the real reading direction rather than left to
            default — the card must open INTO the content area, which is the
            opposite edge in Arabic, in both collapsed and expanded rails. */}
        <HoverCardContent side={isRtl ? 'left' : 'right'} align="start">
          <div className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
              <item.icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1">
              <p className="leading-none font-semibold">{label}</p>
              {description ? (
                <p className="text-muted-foreground text-sm text-pretty">{description}</p>
              ) : null}
            </div>
          </div>

          <p className="text-primary mt-3 flex items-center gap-1 text-sm font-medium">
            {t('openPage')}
            {/* Directional: points the way in, which mirrors in RTL. */}
            <ArrowRight className="icon-directional size-3.5" aria-hidden />
          </p>
        </HoverCardContent>
      </HoverCard>
    </li>
  );
}
