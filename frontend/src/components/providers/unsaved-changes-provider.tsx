'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  hasDirtySources,
  isUnsavedNavigationBypassed,
  runWithUnsavedNavigationBypass,
} from '@/lib/unsaved-changes';

function navigatesAway(anchor: HTMLAnchorElement): boolean {
  if (anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
  const destination = new URL(anchor.href, window.location.href);
  if (!['http:', 'https:'].includes(destination.protocol)) return false;
  return destination.origin !== window.location.origin
    || destination.pathname !== window.location.pathname
    || destination.search !== window.location.search;
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('resourceForm.discard');
  const [pendingAnchor, setPendingAnchor] = useState<HTMLAnchorElement | null>(null);

  useEffect(() => {
    function intercept(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (isUnsavedNavigationBypassed() || !hasDirtySources()) return;
      const anchor = (event.target as Element | null)?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || !navigatesAway(anchor)) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingAnchor(anchor);
    }

    document.addEventListener('click', intercept, true);
    return () => document.removeEventListener('click', intercept, true);
  }, []);

  function discardAndContinue() {
    const anchor = pendingAnchor;
    setPendingAnchor(null);
    if (anchor) runWithUnsavedNavigationBypass(() => anchor.click());
  }

  return (
    <>
      {children}
      <AlertDialog open={pendingAnchor !== null} onOpenChange={(open) => { if (!open) setPendingAnchor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={discardAndContinue}>{t('confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
