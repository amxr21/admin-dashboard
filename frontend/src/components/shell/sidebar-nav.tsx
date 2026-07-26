'use client';

import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { NAVIGATION } from '@/config/navigation';
import { canAccessArea, type StaffRole } from '@/config/areas';
import { cn } from '@/lib/utils';

/**
 * The navigation list. Shared by the desktop sidebar and the mobile drawer so
 * there is exactly one definition of what the nav contains and how it behaves.
 */

interface SidebarNavProps {
  role: StaffRole;
  /** Mobile drawer passes a close handler so tapping a link dismisses it. */
  onNavigate?: () => void;
}

export function SidebarNav({ role, onNavigate }: SidebarNavProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto" aria-label={t('dashboard')}>
      {NAVIGATION.map((group, groupIndex) => {
        // Hide whole groups the role cannot reach, rather than leaving an
        // empty heading behind.
        const visible = group.items.filter(
          (item) => !item.area || canAccessArea(role, item.area),
        );
        if (visible.length === 0) return null;

        return (
          <div key={group.labelKey ?? `group-${String(groupIndex)}`}>
            {group.labelKey ? (
              <h2 className="text-muted-foreground px-3 pb-1 text-xs font-medium tracking-wide uppercase">
                {t(group.labelKey)}
              </h2>
            ) : null}

            <ul className="space-y-0.5">
              {visible.map((item) => {
                // Exact match for the index route, prefix match for the rest —
                // otherwise /admin stays highlighted on every child page.
                const isActive =
                  item.href === '/admin'
                    ? pathname === '/admin'
                    : pathname.startsWith(item.href);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      // aria-current is what a screen reader announces; the
                      // colour is only for sighted users.
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {/* Nav glyphs are objects, not arrows — no mirroring. */}
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
