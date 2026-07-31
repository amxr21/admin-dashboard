'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import type { StaffRole } from '@/config/areas';

interface ViewAsBannerProps {
  role: StaffRole;
  onExit: () => void;
}

/**
 * Persistent, not a toast — same reasoning as the read-only demo banner: a
 * mode this consequential to what's on screen needs to stay visible the
 * whole time it's active, not flash once.
 */
export function ViewAsBanner({ role, onExit }: ViewAsBannerProps) {
  const t = useTranslations('viewAs');
  const tRoles = useTranslations('roles');

  return (
    <div className="bg-primary/10 text-primary border-primary/20 flex items-center justify-between gap-3 border-b px-4 py-2 text-sm">
      <span>{t('banner', { role: tRoles(role) })}</span>
      <Button variant="outline" size="sm" onClick={onExit}>
        {t('exitPreview')}
      </Button>
    </div>
  );
}
