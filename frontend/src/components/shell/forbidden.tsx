'use client';

import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import type { Area } from '@/config/areas';

/**
 * Shown INSTEAD OF the real page content when the signed-in user's ACTUAL
 * role cannot reach the current area — a stale bookmark, a shared link, or a
 * role downgrade since the last visit. Distinct from `ViewAsBlocked`, which
 * covers the cosmetic "view as" preview: that one explains a simulation the
 * user themselves turned on and can turn off; this one explains a REAL
 * block with no such escape hatch, so it needs a real way out (back to the
 * dashboard) instead.
 *
 * Sidebar hiding is a courtesy, not a control (see config/areas.ts) — the
 * API already refuses the request underneath. This is the client owning up
 * to that refusal with a reason, rather than leaving whatever the page's
 * own fetch-error state happens to render (a generic "forbidden" string
 * with no context on WHY or WHO to ask, see states.error.forbidden).
 *
 * Deliberately does not name who currently holds a role that can grant
 * access — the frontend has no such list, and fetching one just to display
 * it to someone who was just told they lack access would leak staff
 * roster data to exactly the person this screen is withholding data from.
 */
export function Forbidden({ area }: { area: Area }) {
  const t = useTranslations('errorPages');
  const tForbidden = useTranslations('errorPages.forbidden');
  const tAreas = useTranslations('nav');

  const areaLabel = tAreas.has(area) ? tAreas(area) : area;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <ShieldAlert className="text-destructive size-12" aria-hidden />

      <h1 className="text-2xl font-semibold text-balance">{tForbidden('title')}</h1>

      <p className="text-muted-foreground text-pretty">
        {tForbidden('descriptionWithArea', { area: areaLabel })}
      </p>

      <Button asChild>
        <Link href="/admin">{t('actions.backToDashboard')}</Link>
      </Button>
    </div>
  );
}
