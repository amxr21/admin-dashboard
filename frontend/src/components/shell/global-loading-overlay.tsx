'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';

import { usePathname } from '@/i18n/navigation';
import { getLoadingActivitySnapshot, subscribeToLoadingActivity } from '@/lib/loading-activity';
import { LoadingState } from '@/components/ui/loading-state';

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
      <div className="bg-card animate-in rounded-xl border px-8 py-6 shadow-lg fade-in-0 duration-200 motion-safe:zoom-in-95">
        <LoadingState label={t('loading')} />
      </div>
    </div>
  );
}
