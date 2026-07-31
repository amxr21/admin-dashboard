'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { DiagnosticsBar } from '@/components/shell/diagnostics-bar';
import { NotificationsBell } from '@/components/shell/notifications-bell';
import { SidebarNav } from '@/components/shell/sidebar-nav';
import { UserMenu } from '@/components/shell/user-menu';
import { ViewAsSwitcher } from '@/components/shell/view-as-switcher';
import { ViewAsBanner } from '@/components/shell/view-as-banner';
import { ViewAsBlocked } from '@/components/shell/view-as-blocked';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { canAccessArea, isReadOnlyRole, type StaffRole } from '@/config/areas';
import { resolveAreaForPath } from '@/config/navigation';
import { useResourceSchema } from '@/components/providers/schema-provider';
import { usePathname } from '@/i18n/navigation';

/**
 * The dashboard chrome: sidebar, topbar, content area.
 *
 * ─── LAYOUT AND RTL ──────────────────────────────────────────────────
 * The sidebar is a flex sibling, not absolutely positioned. `flex-row`
 * already reverses under `dir="rtl"`, so the sidebar moves to the right in
 * Arabic with no code — and `border-e` becomes the correct edge automatically.
 * Do not "fix" this with explicit left/right.
 *
 * The mobile drawer is the one piece that needed care; see ui/sheet.tsx for
 * why it animates opacity rather than translateX.
 *
 * ─── "VIEW AS" IS COSMETIC, NEVER A CONTROL ──────────────────────────
 * `previewedRole` only ever narrows what THIS render shows (nav items, the
 * current page) — it is never sent to the server and never changes which
 * token the real user's requests carry. The gate on offering it at all
 * (`canPreview`) is the real user's OWN role, re-checked on every render, so
 * even a stale sessionStorage value from a previous session in the same tab
 * can never grant a lower-privileged signed-in user a HIGHER effective role —
 * it can only be ignored.
 */

const VIEW_AS_STORAGE_KEY = 'admin-dashboard:view-as-role';

interface AppShellProps {
  children: ReactNode;
  user: { name: string; email: string; role: StaffRole };
  onSignOut?: () => void;
}

export function AppShell({ children, user, onSignOut }: AppShellProps) {
  const t = useTranslations('nav');
  const tStates = useTranslations('states');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [previewedRole, setPreviewedRoleState] = useState<StaffRole | null>(null);
  const pathname = usePathname();
  const { resources } = useResourceSchema();

  const canPreview = user.role === 'OWNER' || user.role === 'DEVELOPER';

  useEffect(() => {
    if (!canPreview) return;
    const stored = sessionStorage.getItem(VIEW_AS_STORAGE_KEY);
    if (stored) setPreviewedRoleState(stored as StaffRole);
    // Only ever read once, on mount — a role picked here should not keep
    // re-reading storage behind the user's back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setPreviewedRole(role: StaffRole | null) {
    setPreviewedRoleState(role);
    if (role) sessionStorage.setItem(VIEW_AS_STORAGE_KEY, role);
    else sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
  }

  // The real role wins the moment preview is unavailable — see the note above.
  const effectiveRole = canPreview && previewedRole ? previewedRole : user.role;
  const isPreviewing = canPreview && previewedRole !== null;

  const currentArea = resolveAreaForPath(pathname, resources);
  const blockedByPreview =
    isPreviewing && currentArea !== undefined && previewedRole !== null
      ? !canAccessArea(previewedRole, currentArea)
      : false;

  const sidebarContent = (
    <>
      <div className="flex h-14 items-center px-3">
        <span className="text-lg font-semibold">admin-dashboard</span>
      </div>
      <SidebarNav role={effectiveRole} onNavigate={() => setDrawerOpen(false)} />
    </>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar. Hidden below lg; the drawer covers those widths. */}
      <aside className="bg-card hidden w-64 shrink-0 flex-col border-e p-2 lg:flex">
        {sidebarContent}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card/80 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('dashboard')}>
                {/* A hamburger is three stacked lines — symmetric, so it must
                    NOT mirror. */}
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="start" title={t('dashboard')}>
              {sidebarContent}
            </SheetContent>
          </Sheet>

          {/* ms-auto, not ml-auto — pushes controls to the reading-end edge in
              both directions. */}
          <div className="ms-auto flex items-center gap-1">
            {canPreview ? (
              <ViewAsSwitcher
                actualRole={user.role}
                previewedRole={previewedRole}
                onChange={setPreviewedRole}
              />
            ) : null}

            {/* Notifications live HERE, not in the sidebar: the count changes
                while you work and has to be visible from every page. */}
            <NotificationsBell />

            {/* The language switcher used to sit here. It MOVED to Settings —
                deliberately moved, not duplicated, so there is one place to
                change language rather than two that can disagree about which
                one someone last used.

                The login page keeps its own, because you have to be able to
                read the sign-in form before you have a session or a settings
                page to visit. */}
            <ThemeToggle />
            <UserMenu
              {...user}
              onSignOut={() => {
                // A preview must not survive into whoever signs in next in
                // this tab — belt and braces alongside the canPreview re-check.
                setPreviewedRole(null);
                onSignOut?.();
              }}
            />
          </div>
        </header>

        {isPreviewing && previewedRole ? (
          <ViewAsBanner role={previewedRole} onExit={() => setPreviewedRole(null)} />
        ) : null}

        {/* DEVELOPER only — an operational surface, not a business area, so it
            is gated on the role directly rather than an `area`. See
            diagnostics.route.ts for why. */}
        {user.role === 'DEVELOPER' ? <DiagnosticsBar /> : null}

        {isReadOnlyRole(user.role) ? (
          /* Persistent, not a toast. A demo user needs to understand why saves
             don't stick at the moment they try, not have seen a banner once on
             login. The API blocks the write regardless. */
          <div className="bg-warning/15 text-warning border-warning/30 border-b px-4 py-2 text-sm">
            <strong className="font-medium">{tStates('readOnlyDemo.title')}</strong>{' '}
            {tStates('readOnlyDemo.description')}
          </div>
        ) : null}

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          {blockedByPreview && previewedRole ? (
            <ViewAsBlocked role={previewedRole} />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
