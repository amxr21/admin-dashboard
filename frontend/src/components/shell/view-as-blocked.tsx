'use client';

import { useTranslations } from 'next-intl';
import { EyeOff } from 'lucide-react';

import type { StaffRole } from '@/config/areas';

/**
 * Shown INSTEAD OF the real page content when previewing a role that cannot
 * reach the current area — otherwise "view as" would only change the sidebar
 * and typing the URL directly would still show the real (fuller-access)
 * user's actual data, which defeats the point of the preview.
 *
 * Still cosmetic only: the real session underneath is untouched, this just
 * withholds what was ALREADY visible to the real user, never reveals
 * anything new.
 */
export function ViewAsBlocked({ role }: { role: StaffRole }) {
  const t = useTranslations('viewAs.notVisible');
  const tRoles = useTranslations('roles');

  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <EyeOff className="text-muted-foreground size-8" aria-hidden="true" />
      <p className="font-medium">{t('title')}</p>
      <p className="text-muted-foreground max-w-sm text-sm">
        {t('description', { role: tRoles(role) })}
      </p>
    </div>
  );
}
