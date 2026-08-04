'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { DiagnosticsBar } from '@/components/shell/diagnostics-bar';
import { GlobalSearch } from '@/components/shell/global-search';
import { NotificationsBell } from '@/components/shell/notifications-bell';
import { OnboardingWelcome } from '@/components/shell/onboarding-welcome';
import { usePageTitle } from '@/components/shell/page-title';
import { SidebarNav } from '@/components/shell/sidebar-nav';
import { UserMenu } from '@/components/shell/user-menu';
import { ViewAsSwitcher } from '@/components/shell/view-as-switcher';
import { ViewAsBanner } from '@/components/shell/view-as-banner';
import { ViewAsBlocked } from '@/components/shell/view-as-blocked';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { canAccessArea, isReadOnlyRole, type StaffRole } from '@/config/areas';
import { resolveAreaForPath } from '@/config/navigation';
import { useResourceSchema } from '@/components/providers/schema-provider';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useSidebarCollapse } from '@/hooks/useSidebarCollapse';
import { usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

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
  const { logoUrl, sidebarMode, storeName } = useAppSettings();
  const pageTitle = usePageTitle();
  // Collapse/expand is a personal per-browser preference, separate from
  // `sidebarMode` (store-wide sticky-vs-floating) above — see the hook.
  const { collapsed, toggle: toggleCollapsed } = useSidebarCollapse();

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

  /**
   * Shared between the desktop rail and the mobile drawer, but the two never
   * collapse the same way: `collapsedForThis` only ever comes in `true` for
   * the desktop `<aside>` below. The drawer is already a dismissable overlay
   * — collapsing it too would save no space that matters and would hide the
   * toggle button behind an interaction nobody expects there.
   */
  function renderSidebarContent(collapsedForThis: boolean, showCollapseToggle: boolean) {
    return (
      <>
        <div className="flex h-14 items-center gap-2 px-3">
          {logoUrl && !collapsedForThis ? (
            // Plain <img>, not next/image — same reasoning as resource-cell.tsx's
            // image field: the URL is admin-supplied at runtime from settings,
            // not a build-time known host next/image could be configured for.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-7 w-auto shrink-0" />
          ) : null}
          {!collapsedForThis ? (
            // Falls back to the generic app name only when the store hasn't
            // set its own — collapsed hides this entirely (see the aside's
            // width comment): a rail has no room for a wordmark.
            <span className="truncate text-lg font-semibold">{storeName || 'admin-dashboard'}</span>
          ) : null}
          {showCollapseToggle ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ms-auto"
                  onClick={toggleCollapsed}
                  aria-label={collapsedForThis ? t('expandSidebar') : t('collapseSidebar')}
                >
                  {/* Not .icon-directional: a panel-rail glyph describes an open/
                      closed STATE, not a reading direction. */}
                  {collapsedForThis ? (
                    <PanelLeftOpen className="size-4" aria-hidden />
                  ) : (
                    <PanelLeftClose className="size-4" aria-hidden />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {collapsedForThis ? t('expandSidebar') : t('collapseSidebar')}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <SidebarNav
          role={effectiveRole}
          onNavigate={() => setDrawerOpen(false)}
          collapsed={collapsedForThis}
        />
      </>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <OnboardingWelcome />

      {/* Desktop sidebar. Hidden below lg; the drawer covers those widths.
          STRUCTURALLY sized (h-full inside an h-dvh/overflow-hidden shell) —
          not sticky/fixed. The whole point of the scroll model below is that
          nothing here needs viewport-relative positioning to stay in place;
          it stays in place because it is a fixed-size flex track that never
          scrolls, and <main> is the only element that does.

          Collapse (`collapsed`, personal/localStorage) only ever changes the
          WIDTH. `sidebarMode` (store-wide, `ui.sidebarMode`) only ever
          changes the surrounding chrome (flush edge vs. detached card, via
          margin).

          `h-full` (sticky mode) and `m-3` (floating mode) do NOT combine the
          way the old comment here claimed: `height: 100%` is an EXPLICIT
          size, so `align-items: stretch`'s margin-subtracting behavior never
          engages (stretch only applies when the cross size is `auto`) — the
          box becomes exactly 100% tall and the margin is added on TOP of
          that, overflowing the parent by the margin amount. Floating mode
          therefore sizes itself explicitly to `calc(100% - margin)` instead
          of relying on stretch. */}
      <aside
        className={cn(
          'bg-card hidden shrink-0 flex-col p-2 lg:flex',
          'transition-[width] duration-200 ease-in-out motion-reduce:transition-none',
          collapsed ? 'w-16' : 'w-64',
          sidebarMode === 'floating'
            ? 'm-3 h-[calc(100%-1.5rem)] rounded-xl border shadow-lg'
            : 'h-full border-e',
        )}
      >
        {renderSidebarContent(collapsed, true)}
      </aside>

      {/* The scrolling content column. `overflow-hidden` here (not just on
          <main>) is deliberate: it is what stops a wide child from ever
          reintroducing a document-level horizontal scrollbar that would undo
          the point of containing scroll to one element. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* No `sticky`/`fixed`, no `z-30` — a flex column with `shrink-0`
            children holds its position structurally; there is nothing
            beneath it to scroll past or stack above anymore. Solid `bg-card`
            (not `bg-card/80` + `backdrop-blur`) because that translucency
            existed for content sliding underneath a viewport-pinned bar —
            with <main> as the only scroller, nothing ever slides under this
            header, so a semi-transparent bar was vestigial, not a look. */}
        <header
          className={cn(
            'bg-card flex h-14 shrink-0 items-center gap-2 px-4',
            sidebarMode === 'floating'
              ? 'mx-3 mt-3 rounded-xl border shadow-lg'
              : 'border-b',
          )}
        >
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('dashboard')}>
                {/* A hamburger is three stacked lines — symmetric, so it must
                    NOT mirror. */}
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="start" title={t('dashboard')}>
              {/* Always expanded: the drawer is already an overlay the user
                  dismisses outright, so there is no icon-rail to offer here. */}
              {renderSidebarContent(false, false)}
            </SheetContent>
          </Sheet>

          {/* Inline-start region: the current page's title (opt-in via
              `<PageTitle>`, see that file for why it's opt-in rather than
              route-derived), then search. `truncate` + `min-w-0` so a long
              title can't push search and the reading-end controls off the
              header on a narrow viewport. */}
          {pageTitle ? (
            <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">
              {pageTitle}
            </h1>
          ) : null}
          <GlobalSearch role={effectiveRole} />

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

        {/* Every banner below is `shrink-0`: real content between the
            structural header and the one scrolling element, not part of
            what scrolls or what may be compressed to make room for it. */}
        {isPreviewing && previewedRole ? (
          <div className="shrink-0">
            <ViewAsBanner role={previewedRole} onExit={() => setPreviewedRole(null)} />
          </div>
        ) : null}

        {/* DEVELOPER only — an operational surface, not a business area, so it
            is gated on the role directly rather than an `area`. See
            diagnostics.route.ts for why. */}
        {user.role === 'DEVELOPER' ? (
          <div className="shrink-0">
            <DiagnosticsBar />
          </div>
        ) : null}

        {isReadOnlyRole(user.role) ? (
          /* Persistent, not a toast. A demo user needs to understand why saves
             don't stick at the moment they try, not have seen a banner once on
             login. The API blocks the write regardless. */
          <div className="bg-warning/15 text-warning border-warning/30 shrink-0 border-b px-4 py-2 text-sm">
            <strong className="font-medium">{tStates('readOnlyDemo.title')}</strong>{' '}
            {tStates('readOnlyDemo.description')}
          </div>
        ) : null}

        {/* THE only scrolling element in the shell. Sidebar and header are
            fixed-size flex tracks now, not viewport-pinned overlays, so a
            long page scrolls in here alone — no document-level scrollbar,
            no competing scroll containers. */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
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
