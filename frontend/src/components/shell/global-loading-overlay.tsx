'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { usePathname } from '@/i18n/navigation';
import { getLoadingActivitySnapshot, subscribeToLoadingActivity } from '@/lib/loading-activity';

const OVERLAY_DELAY_MS = 120;
const NAVIGATION_TIMEOUT_MS = 15_000;

function isSamePageAnchor(anchor: HTMLAnchorElement): boolean {
  const destination = new URL(anchor.href, window.location.href);
  return destination.pathname === window.location.pathname
    && destination.search === window.location.search
    && destination.hash !== window.location.hash;
}

/** Shared feedback for delayed navigations and user-triggered API mutations. */
export function GlobalLoadingOverlay() {
  const t = useTranslations('common');
  const pathname = usePathname();
  const activeRequests = useSyncExternalStore(
    subscribeToLoadingActivity,
    getLoadingActivitySnapshot,
    () => 0,
  );
  const [navigationPending, setNavigationPending] = useState(false);
  const [visible, setVisible] = useState(false);
  const active = navigationPending || activeRequests > 0;

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === '_blank' || target.hasAttribute('download')) return;

      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin || isSamePageAnchor(target)) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      // Let the link's own click handler start the App Router transition
      // before this state update re-renders the shell around it.
      queueMicrotask(() => setNavigationPending(true));
    }

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  useEffect(() => {
    setNavigationPending(false);
  }, [pathname]);

  useEffect(() => {
    if (!navigationPending) return;
    const timeout = window.setTimeout(() => setNavigationPending(false), NAVIGATION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [navigationPending]);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timeout = window.setTimeout(() => setVisible(true), OVERLAY_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [active]);

  if (!visible) return null;

  return (
    <div
      className="bg-background/70 fixed inset-0 z-[90] grid animate-in place-items-center fade-in-0 duration-200 backdrop-blur-sm"
      aria-label={t('loading')}
    >
      {/*
        A compact horizontal row, deliberately NOT the shared `LoadingState`.
        That component carries `min-h-48` and stacks its spinner above its
        label, which is right for a panel waiting to fill a page — and wrong
        here, where the same treatment becomes a tall card floating in the
        middle of the screen saying one short word. It is used by 32 other
        surfaces, so this is the caller changing, not the primitive.

        `role="status"` lives here rather than being inherited, since the
        element it was attached to is gone.
      */}
      <div
        role="status"
        className="bg-card animate-in flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full border py-3 ps-4 pe-5 shadow-lg fade-in-0 duration-200 motion-safe:zoom-in-95"
      >
        <Loader2
          aria-hidden
          className="text-primary size-4 shrink-0 animate-spin motion-reduce:animate-none"
        />
        <span className="truncate text-sm font-medium">{t('loading')}</span>
      </div>
    </div>
  );
}
