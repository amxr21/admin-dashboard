'use client';

import { useTranslations } from 'next-intl';
import { Bell, PanelLeftClose, Search, Settings } from 'lucide-react';

import { useCanAccessArea } from '@/components/providers/role-permissions-provider';
import { useAppSettings } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { StaffRole } from '@/config/areas';
import { useOnboardingWelcome } from '@/hooks/useOnboardingWelcome';

/**
 * First-run welcome — shown once per browser, the first genuine "here's
 * where things are" overlay this app has had. Deliberately a single card
 * naming a handful of things that are easy to miss on a first look, not a
 * multi-step spotlight tour: a tour needs to anchor to live DOM elements
 * (the sidebar rail, the search box, the bell) and re-position through
 * responsive breakpoints and RTL — real complexity for a first pass. This
 * gets real value in front of a new user today; a guided walkthrough is a
 * later, separate upgrade if this one turns out not to be enough.
 *
 * Reuses `Sheet`'s existing `variant="modal"` rather than a new Dialog
 * primitive — same Radix Dialog underneath, same fade+zoom motion as every
 * other centered panel in the app (resource-form.tsx's modal edit mode,
 * AlertDialog), so this doesn't introduce a second modal look.
 */
export function OnboardingWelcome({ role }: { role?: StaffRole }) {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const { storeName } = useAppSettings();
  const canAccessArea = useCanAccessArea();
  const { shouldShow, dismiss } = useOnboardingWelcome();

  const title = t('title', { name: storeName.trim() || tCommon('appName') });
  // The bell and Settings are both gated on the `settings` area in the shell,
  // so a cashier must not be pointed at two things they will never see.
  const seesSettings = role === undefined || canAccessArea(role, 'settings');

  return (
    <Sheet open={shouldShow} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <SheetContent variant="modal" title={title}>
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
          </div>

          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <Search className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t('items.search')}</span>
            </li>
            {seesSettings ? (
              <li className="flex items-start gap-3">
                <Bell className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t('items.notifications')}</span>
              </li>
            ) : null}
            <li className="flex items-start gap-3">
              <PanelLeftClose className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t('items.sidebar')}</span>
            </li>
            {seesSettings ? (
              <li className="flex items-start gap-3">
                <Settings className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t('items.settings')}</span>
              </li>
            ) : null}
          </ul>

          <div className="flex justify-end pt-2">
            <Button onClick={dismiss}>{t('dismiss')}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
