'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import type { Shift } from '@/lib/shifts-api';

/**
 * Who is on the till RIGHT NOW.
 *
 * ─── THE ONLY PANEL HERE THAT IS NOT PERIOD-SCOPED ───────────────────
 * Every other widget answers "during the selected range". This one answers
 * "at this instant", because a shift that ended last Tuesday is not something
 * an owner glancing at the dashboard needs — they are asking whether the shop
 * is staffed. `endedAt IS NULL` is the schema's own single source of truth for
 * that (see `Shift.endedAt`), so the widget reads open shifts rather than
 * deriving "on now" from a date window that would answer a different question.
 *
 * It carries the `liveSnapshot` note for exactly that reason: without it, a
 * panel sitting beside seven range-scoped ones reads as though changing the
 * range would change it.
 */
interface OnShiftWidgetProps {
  shifts: Shift[] | null;
  isLoading?: boolean;
}

export function OnShiftWidget({ shifts, isLoading = false }: OnShiftWidgetProps) {
  const t = useTranslations('dashboard.onShift');
  const tDashboard = useTranslations('dashboard');
  const formatter = useFormatter();

  return (
    <section className="bg-card rounded-lg border p-4" aria-label={t('title')}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <Link href="/admin/shifts" className="text-muted-foreground text-xs hover:underline">
          {t('viewAll')}
        </Link>
      </div>

      <p className="text-muted-foreground mt-1 text-xs">{tDashboard('liveSnapshot')}</p>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : shifts && shifts.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {shifts.map((shift) => (
            <li
              key={shift.id}
              className="flex items-baseline justify-between gap-3 border-b pb-2 text-sm last:border-b-0 last:pb-0"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium">{shift.user.name ?? shift.user.email}</span>
                {/* The branch is named even when a branch is selected: this
                    panel is the one an owner opens on "all branches" to see
                    the whole floor at once. */}
                <span className="text-muted-foreground"> · {shift.branch.name}</span>
              </span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {formatter.dateTime(new Date(shift.startedAt), {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">{t('empty')}</p>
      )}
    </section>
  );
}
