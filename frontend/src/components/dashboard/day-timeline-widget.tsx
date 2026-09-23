'use client';

import { useFormatter, useTranslations } from 'next-intl';
import {
  Ban,
  CheckCircle2,
  DoorOpen,
  LogIn,
  LogOut,
  RotateCcw,
  ShoppingCart,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { WidgetSection } from '@/components/dashboard/widget-section';
import { stripDemoTag } from '@/lib/demo';
import { cn } from '@/lib/utils';
import type { DayEvent, DayTimeline } from '@/lib/reports-api';

/**
 * What happened during the day, newest first.
 *
 * ─── IT MERGES TWO SOURCES BECAUSE ONE WOULD LIE ─────────────────────
 * The backend reads audited staff actions AND the orders table, because a
 * storefront order is never audited (no actor, no privileged action). A feed
 * built on the audit log alone would omit most of a retail day while still
 * looking complete — see `getDayTimeline`'s own note.
 *
 * ─── EVERY ROW IS THE SAME SHAPE ─────────────────────────────────────
 * Time, icon, sentence, amount. An order and a till close are different
 * events but they answer the same question here ("what happened, when"), so
 * they get one anatomy rather than a card each.
 *
 * ─── THE ICON AND THE VERB BOTH CARRY THE KIND ───────────────────────
 * A void and a sale differ by more than colour: different icon, different
 * sentence. Colour is the third signal, never the only one.
 */

interface DayTimelineWidgetProps {
  data: DayTimeline | null;
  isLoading?: boolean;
}

/** Icon and tone per event kind. Unknown kinds fall back rather than vanish —
 *  a new audited action should appear as a plain row, not silently disappear. */
interface TimelineKindConfig {
  icon: LucideIcon;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
  label: string;
}

const KINDS: Record<string, TimelineKindConfig> = {
  'order.placed': { icon: ShoppingCart, tone: 'good', label: 'orderPlaced' },
  'order.sold': { icon: ShoppingCart, tone: 'good', label: 'orderSold' },
  'order.voided': { icon: Ban, tone: 'bad', label: 'orderVoided' },
  'order.status.changed': { icon: CheckCircle2, tone: 'neutral', label: 'orderStatusChanged' },
  'order.goodwill_refund': { icon: RotateCcw, tone: 'warn', label: 'orderGoodwillRefund' },
  'shift.started': { icon: LogIn, tone: 'neutral', label: 'shiftStarted' },
  'shift.ended': { icon: LogOut, tone: 'neutral', label: 'shiftEnded' },
  'shift.till_closed': { icon: Wallet, tone: 'warn', label: 'shiftTillClosed' },
  'shift.approved': { icon: CheckCircle2, tone: 'good', label: 'shiftApproved' },
  'shift.rejected': { icon: XCircle, tone: 'bad', label: 'shiftRejected' },
  'return.approved': { icon: RotateCcw, tone: 'warn', label: 'returnApproved' },
  'return.rejected': { icon: XCircle, tone: 'bad', label: 'returnRejected' },
};

const FALLBACK = { icon: DoorOpen, tone: 'neutral' as const };

const TONE_CLASSES = {
  neutral: 'bg-muted text-muted-foreground',
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  bad: 'bg-destructive/10 text-destructive',
} as const;

/** Where a row leads, when it leads anywhere. */
function hrefFor(event: DayEvent): string | null {
  if (event.kind.startsWith('order.') && event.entityId) {
    return `/admin/orders/${event.entityId}`;
  }
  if (event.kind.startsWith('shift.')) return '/admin/shifts';
  if (event.kind.startsWith('return.')) return '/admin/returns';
  return null;
}

export function DayTimelineWidget({ data, isLoading = false }: DayTimelineWidgetProps) {
  const t = useTranslations('dashboard.dayTimeline');
  const formatter = useFormatter();

  const events = data?.events ?? [];

  return (
    <WidgetSection
      title={t('title')}
      icon="activity"
      tone="accent"
      surface="card"
      footNote={
        data
          ? data.truncated
            ? t('showingNewest', { count: events.length })
            : t('eventCount', { count: events.length })
          : null
      }
      action={{ href: '/admin/audit', label: t('fullTrail') }}
    >
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : events.length > 0 ? (
        <ol className="flex flex-col">
          {events.map((event) => {
            const configuredKind = KINDS[event.kind];
            const { icon: Icon, tone } = configuredKind ?? FALLBACK;
            const href = hrefFor(event);

            const sentence = (
              <>
                <span className="font-medium">
                  {/* A translated verb per kind, falling back to the raw
                      action so an unmapped one is still readable rather than
                      rendering an empty row. */}
                  {configuredKind ? t(`kinds.${configuredKind.label}`) : event.kind}
                </span>
                {event.label ? (
                  <span className="force-ltr text-muted-foreground ms-1.5">
                    {stripDemoTag(event.label)}
                  </span>
                ) : null}
                {event.actor ? (
                  <span className="text-muted-foreground"> · <bdi dir="auto">{event.actor}</bdi></span>
                ) : event.kind === 'order.placed' ? (
                  // Not "unknown": a storefront order genuinely has no
                  // operator, and saying so is more useful than a blank.
                  <span className="text-muted-foreground"> · {t('storefront')}</span>
                ) : null}
                {event.branch ? (
                  <span className="text-muted-foreground">
                    {' '}· {t('branch')}: <bdi dir="auto">{event.branch.name}</bdi>
                  </span>
                ) : null}
              </>
            );

            return (
              <li
                key={event.id}
                className="flex items-center gap-3 border-b py-2.5 last:border-b-0 last:pb-0"
              >
                <time
                  dateTime={event.at}
                  className="text-muted-foreground w-11 shrink-0 text-xs tabular-nums"
                >
                  {formatter.dateTime(new Date(event.at), { timeStyle: 'short' })}
                </time>

                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-md',
                    TONE_CLASSES[tone],
                  )}
                  aria-hidden
                >
                  <Icon className="size-3.5" />
                </span>

                <span className="min-w-0 flex-1 truncate text-sm">
                  {href ? (
                    <Link href={href} className="hover:underline">
                      {sentence}
                    </Link>
                  ) : (
                    sentence
                  )}
                </span>

                {event.amount ? (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatter.number(Number(event.amount), 'currency')}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      )}
    </WidgetSection>
  );
}
