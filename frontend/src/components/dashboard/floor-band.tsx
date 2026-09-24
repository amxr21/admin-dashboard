'use client';

import { useFormatter, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Users,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { DashboardTemplate } from '@/lib/dashboard-template';
import type { FloorClosedTill, FloorStatus, FloorTill } from '@/lib/reports-api';

/**
 * Who is on the till, right now — the band at the top of the dashboard.
 *
 * ─── THE ONE SECTION THAT IS NOT PERIOD-SCOPED ───────────────────────
 * Everything below it on the dashboard describes the selected date range.
 * This describes THIS INSTANT, which is why it sits above the range picker's
 * influence visually and says so in words. A cashier's drawer does not have a
 * "last 30 days" reading.
 *
 * ─── FIVE SHAPES, ONE DATA SOURCE ────────────────────────────────────
 * The same `FloorStatus` renders as totals-plus-cards, cards alone, figures
 * alone, a roster table, or a triage list. They are genuinely different
 * questions — "how is today going", "who is doing it", "is anything wrong" —
 * and which one a person opens the page to ask is personal. See
 * `dashboard-template.ts` for why the choice lives per-browser.
 *
 * ─── MONEY IS NEVER RECOMPUTED HERE ──────────────────────────────────
 * Every figure arrives as a 2dp string from `getFloorStatus`. This component
 * formats and lays out; it does not add. In particular `variance` is read
 * straight through — it was stored at close, and a display that recalculated
 * it would quietly contradict what the cashier signed.
 */

interface FloorBandProps {
  data: FloorStatus | null;
  template: DashboardTemplate;
  isLoading?: boolean;
}

/** Initials for the avatar, from whatever identity the row actually has. */
function initials(person: { name: string | null; email: string }): string {
  const source = person.name?.trim() || person.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

/**
 * A stable colour per person, so the same cashier wears the same hue on every
 * render and in every template. Hashed from the id rather than assigned by
 * ROW INDEX — index would repaint everyone the moment somebody clocks off,
 * which is the categorical-colour rule the charting guidance states.
 *
 * These are identity marks, never status: nothing here means "good" or "bad".
 */
const AVATAR_HUES = [
  'bg-sky-600',
  'bg-orange-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-rose-600',
  'bg-amber-600',
] as const;

function hueFor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 997;
  }
  return AVATAR_HUES[hash % AVATAR_HUES.length]!;
}

function Avatar({
  person,
  dimmed = false,
}: {
  person: { id: string; name: string | null; email: string };
  dimmed?: boolean;
}) {
  return (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white',
        dimmed ? 'bg-muted-foreground/60' : hueFor(person.id),
      )}
      aria-hidden
    >
      {initials(person)}
    </span>
  );
}

/** How long a shift has been running, as a compact "5h 04m". */
function useElapsed() {
  const t = useTranslations('dashboard.floor');
  return (startedAt: string) => {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000));
    return t('elapsed', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  };
}

/**
 * The flag a till carries, if any.
 *
 * Severity is a SHAPE and a WORD, never colour alone — an icon plus a label,
 * per the same rule the KPI deltas follow. A drawer that is short outranks a
 * no-sale count, because money missing is the more serious fact.
 */
function tillFlag(till: FloorTill | FloorClosedTill) {
  const variance = 'variance' in till ? till.variance : null;
  if (variance !== null && Number(variance) !== 0) {
    return { kind: 'variance' as const, amount: variance };
  }
  if (till.voidCount > 0) return { kind: 'voids' as const, count: till.voidCount };
  if (till.noSaleCount > 0) return { kind: 'noSale' as const, count: till.noSaleCount };
  return null;
}

function FlagBadge({ till }: { till: FloorTill | FloorClosedTill }) {
  const t = useTranslations('dashboard.floor');
  const formatter = useFormatter();
  const flag = tillFlag(till);

  if (!flag) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3" aria-hidden />
        {t('flags.clean')}
      </span>
    );
  }

  const isVariance = flag.kind === 'variance';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        isVariance
          ? 'bg-destructive/10 text-destructive'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
      )}
    >
      <AlertTriangle className="size-3" aria-hidden />
      {flag.kind === 'variance'
        ? // Short or over — both are a discrepancy worth naming, and the sign
          // is carried by the number rather than by two different words.
          t('flags.variance', { amount: formatter.number(Number(flag.amount), 'currency') })
        : flag.kind === 'voids'
          ? t('flags.voids', { count: flag.count })
          : t('flags.noSale', { count: flag.count })}
    </span>
  );
}

/* ═══════════════════ the six figures (template: figures, combo) ═══════════ */

function FigureCells({ data }: { data: FloorStatus }) {
  const t = useTranslations('dashboard.floor');
  const formatter = useFormatter();
  const { totals } = data;

  const cells: {
    key: string;
    label: string;
    value: string;
    sub: string;
    tone: 'info' | 'good' | 'warn' | 'crit';
    faces?: FloorTill[];
  }[] = [
    {
      key: 'onShift',
      label: t('figures.onShift'),
      value: formatter.number(totals.onShift),
      sub: t('figures.acrossBranches', { count: totals.branches }),
      tone: 'info',
      faces: data.openShifts,
    },
    {
      key: 'taken',
      label: t('figures.taken'),
      value: formatter.number(Number(totals.taken), 'currency'),
      sub: t('figures.salesCount', { count: totals.salesCount }),
      tone: 'good',
    },
    {
      key: 'drawers',
      label: t('figures.inDrawers'),
      value: formatter.number(Number(totals.expectedInDrawers), 'currency'),
      sub: t('figures.expected'),
      tone: 'info',
    },
    {
      key: 'noSale',
      label: t('figures.noSale'),
      value: formatter.number(totals.noSaleCount),
      sub: t('figures.noSaleSub'),
      tone: totals.noSaleCount > 0 ? 'warn' : 'info',
    },
    {
      key: 'voids',
      label: t('figures.voids'),
      value: formatter.number(totals.voidCount),
      sub: t('figures.voidsSub'),
      tone: totals.voidCount > 0 ? 'crit' : 'info',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cells.map((cell) => (
        <div
          key={cell.key}
          className="bg-card relative overflow-hidden rounded-lg border p-4"
        >
          {/* The tone stripe repeats information the value and label already
              carry — it is an accent, never the only signal. */}
          <span
            aria-hidden
            className={cn(
              'absolute inset-x-0 top-0 h-[3px]',
              cell.tone === 'crit'
                ? 'bg-destructive'
                : cell.tone === 'warn'
                  ? 'bg-amber-500'
                  : cell.tone === 'good'
                    ? 'bg-emerald-500'
                    : 'bg-primary',
            )}
          />
          <p className="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
            {cell.label}
          </p>
          <p
            className={cn(
              'mt-1 text-2xl font-semibold tracking-tight tabular-nums',
              cell.tone === 'crit' && 'text-destructive',
              cell.tone === 'warn' && 'text-amber-700 dark:text-amber-400',
            )}
          >
            {cell.value}
          </p>
          {cell.faces && cell.faces.length > 0 ? (
            <span className="mt-2 flex">
              {cell.faces.slice(0, 5).map((till) => (
                <span key={till.shiftId} className="-me-2 last:me-0">
                  <span className="border-card block rounded-full border-2">
                    <Avatar person={till.user} />
                  </span>
                </span>
              ))}
            </span>
          ) : null}
          <p className="text-muted-foreground mt-1 text-xs">{cell.sub}</p>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ one card per till (templates: combo, tills) ══════════ */

function TillCard({
  till,
  shareOfTaken,
  closed = false,
}: {
  till: FloorTill | FloorClosedTill;
  shareOfTaken: number;
  closed?: boolean;
}) {
  const t = useTranslations('dashboard.floor');
  const formatter = useFormatter();
  const elapsed = useElapsed();
  const closedTill = closed ? (till as FloorClosedTill) : null;

  return (
    <article
      className={cn(
        'flex min-w-0 flex-col gap-3 p-4',
        closed ? 'bg-muted/40' : 'bg-card',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar person={till.user} dimmed={closed} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">
            {till.user.name ?? till.user.email}
          </span>
          <span className="text-muted-foreground truncate text-[11px] tabular-nums">
            {till.branch.name} ·{' '}
            {closed && closedTill?.endedAt
              ? t('closedAt', {
                  time: formatter.dateTime(new Date(closedTill.endedAt), { timeStyle: 'short' }),
                })
              : elapsed(till.startedAt)}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xl font-semibold tracking-tight tabular-nums">
          {formatter.number(Number(till.taken), 'currency')}
        </span>
        <span className="text-muted-foreground ms-auto text-xs">
          {t('salesCount', { count: till.salesCount })}
        </span>
      </div>

      <div>
        {/* Magnitude across one measure, so one hue — this is not a
            categorical chart and must not borrow the avatar palette. */}
        <span className="bg-muted block h-2 overflow-hidden rounded-full">
          <span
            className={cn('block h-full rounded-full', closed ? 'bg-muted-foreground' : 'bg-primary')}
            style={{ width: `${String(Math.max(2, Math.round(shareOfTaken)))}%` }}
          />
        </span>
        <span className="text-muted-foreground mt-1 flex justify-between gap-2 text-[11px] tabular-nums">
          <span>{t('averageSale', { amount: formatter.number(Number(till.averageSale), 'currency') })}</span>
          <span>{t('shareOfToday', { percent: Math.round(shareOfTaken) })}</span>
        </span>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-2.5">
        <FlagBadge till={till} />
        <span className="text-muted-foreground ms-auto text-[11px] tabular-nums">
          {closed
            ? t('counted', {
                amount:
                  closedTill?.closingCount === null || closedTill?.closingCount === undefined
                    ? '—'
                    : formatter.number(Number(closedTill.closingCount), 'currency'),
              })
            : // Null float means no till on this shift — the drawer line is
              // omitted entirely rather than showing a fabricated zero.
              till.openingFloat === null
              ? t('noTill')
              : t('drawer', {
                  amount: formatter.number(Number(till.expectedCash), 'currency'),
                })}
        </span>
      </div>
    </article>
  );
}

function TillCards({ data }: { data: FloorStatus }) {
  const t = useTranslations('dashboard.floor');
  const rows = [...data.openShifts, ...data.recentlyClosed];

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground bg-card rounded-lg border px-4 py-8 text-center text-sm">
        {t('empty')}
      </p>
    );
  }

  // Share is measured against the BUSIEST till, not against the total: the
  // bars compare cashiers to each other, and a five-way split would render
  // every bar as a stub against a total nobody is trying to reach.
  const busiest = Math.max(1, ...rows.map((row) => Number(row.taken)));

  return (
    <div className="bg-border grid grid-cols-1 gap-px overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {data.openShifts.map((till) => (
        <TillCard
          key={till.shiftId}
          till={till}
          shareOfTaken={(Number(till.taken) / busiest) * 100}
        />
      ))}
      {data.recentlyClosed.map((till) => (
        <TillCard
          key={till.shiftId}
          till={till}
          shareOfTaken={(Number(till.taken) / busiest) * 100}
          closed
        />
      ))}
    </div>
  );
}

/* ═══════════════════ roster table (template: roster) ═════════════════════ */

function RosterTable({ data }: { data: FloorStatus }) {
  const t = useTranslations('dashboard.floor');
  const formatter = useFormatter();
  const elapsed = useElapsed();
  const rows = [...data.openShifts, ...data.recentlyClosed];

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground bg-card rounded-lg border px-4 py-8 text-center text-sm">
        {t('empty')}
      </p>
    );
  }

  return (
    <div className="bg-card overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-muted/60 text-muted-foreground text-[10px] tracking-wider uppercase">
            <th scope="col" className="px-3 py-2 text-start font-bold">{t('table.who')}</th>
            <th scope="col" className="px-3 py-2 text-start font-bold">{t('table.branch')}</th>
            <th scope="col" className="px-3 py-2 text-start font-bold">{t('table.in')}</th>
            <th scope="col" className="px-3 py-2 text-end font-bold">{t('table.sales')}</th>
            <th scope="col" className="px-3 py-2 text-end font-bold">{t('table.taken')}</th>
            <th scope="col" className="px-3 py-2 text-end font-bold">{t('table.average')}</th>
            <th scope="col" className="px-3 py-2 text-end font-bold">{t('table.drawer')}</th>
            <th scope="col" className="px-3 py-2 text-start font-bold">{t('table.flags')}</th>
          </tr>
        </thead>
        <tbody>
          {data.openShifts.map((till) => (
            <tr key={till.shiftId} className="border-t">
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <Avatar person={till.user} />
                  <span className="truncate font-medium">{till.user.name ?? till.user.email}</span>
                </span>
              </td>
              <td className="px-3 py-2.5">{till.branch.name}</td>
              <td className="px-3 py-2.5 tabular-nums">{elapsed(till.startedAt)}</td>
              <td className="px-3 py-2.5 text-end tabular-nums">{formatter.number(till.salesCount)}</td>
              <td className="px-3 py-2.5 text-end font-medium tabular-nums">
                {formatter.number(Number(till.taken), 'currency')}
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums">
                {formatter.number(Number(till.averageSale), 'currency')}
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums">
                {till.openingFloat === null
                  ? '—'
                  : formatter.number(Number(till.expectedCash), 'currency')}
              </td>
              <td className="px-3 py-2.5"><FlagBadge till={till} /></td>
            </tr>
          ))}
          {data.recentlyClosed.map((till) => (
            <tr key={till.shiftId} className="text-muted-foreground border-t">
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <Avatar person={till.user} dimmed />
                  <span className="truncate font-medium">{till.user.name ?? till.user.email}</span>
                </span>
              </td>
              <td className="px-3 py-2.5">{till.branch.name}</td>
              <td className="px-3 py-2.5 tabular-nums">
                {till.endedAt
                  ? t('closedAt', {
                      time: formatter.dateTime(new Date(till.endedAt), { timeStyle: 'short' }),
                    })
                  : '—'}
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums">{formatter.number(till.salesCount)}</td>
              <td className="px-3 py-2.5 text-end font-medium tabular-nums">
                {formatter.number(Number(till.taken), 'currency')}
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums">
                {formatter.number(Number(till.averageSale), 'currency')}
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums">
                {till.closingCount === null
                  ? '—'
                  : formatter.number(Number(till.closingCount), 'currency')}
              </td>
              <td className="px-3 py-2.5"><FlagBadge till={till} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════ triage (template: triage) ══════════════════════════ */

function Triage({ data }: { data: FloorStatus }) {
  const t = useTranslations('dashboard.floor');
  const formatter = useFormatter();

  // Only genuine discrepancies, newest concern first: a short drawer, then
  // voids, then unexplained drawer opens.
  const shortDrawers = data.recentlyClosed.filter(
    (till) => till.variance !== null && Number(till.variance) !== 0,
  );
  const withVoids = data.openShifts.filter((till) => till.voidCount > 0);
  const withNoSale = data.openShifts.filter((till) => till.noSaleCount > 0);

  const items = [
    ...shortDrawers.map((till) => ({
      key: `variance-${till.shiftId}`,
      severity: 'crit' as const,
      count: 1,
      title: t('triage.variance', {
        name: till.user.name ?? till.user.email,
        amount: formatter.number(Number(till.variance), 'currency'),
      }),
      detail: t('triage.varianceDetail', { branch: till.branch.name }),
      href: '/admin/shifts',
    })),
    ...withVoids.map((till) => ({
      key: `voids-${till.shiftId}`,
      severity: 'warn' as const,
      count: till.voidCount,
      title: t('triage.voids', { name: till.user.name ?? till.user.email }),
      detail: t('triage.voidsDetail', { branch: till.branch.name }),
      href: '/admin/shifts',
    })),
    ...withNoSale.map((till) => ({
      key: `nosale-${till.shiftId}`,
      severity: 'warn' as const,
      count: till.noSaleCount,
      title: t('triage.noSale', { name: till.user.name ?? till.user.email }),
      detail: t('triage.noSaleDetail', { branch: till.branch.name }),
      href: '/admin/shifts',
    })),
  ];

  return (
    <div className="bg-card rounded-lg border p-5">
      <p className="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
        {t('triage.eyebrow')}
      </p>
      <h2 className="mt-1 text-lg font-bold tracking-tight">
        {items.length === 0 ? t('triage.allClearTitle') : t('triage.title', { count: items.length })}
      </h2>

      {items.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="hover:bg-muted/60 flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-md text-xs font-bold text-white tabular-nums',
                    item.severity === 'crit' ? 'bg-destructive' : 'bg-amber-600',
                  )}
                  aria-hidden
                >
                  {item.count}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{item.title}</span>
                  <span className="text-muted-foreground truncate text-xs">{item.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex items-center gap-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" aria-hidden />
        </span>
        <p className="text-muted-foreground text-sm">
          {t('triage.quiet', {
            tills: data.totals.onShift,
            taken: formatter.number(Number(data.totals.taken), 'currency'),
          })}
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════ the band itself ════════════════════════════════════ */

export function FloorBand({ data, template, isLoading = false }: FloorBandProps) {
  const t = useTranslations('dashboard.floor');
  const formatter = useFormatter();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!data) return null;

  const hasTillRows = data.openShifts.length + data.recentlyClosed.length > 0;
  const showFigures = template === 'combo' || template === 'figures';
  const showCards = template === 'combo' || template === 'tills';

  return (
    <section className="space-y-3" aria-label={t('title')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="relative flex size-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <Users className="size-3.5" aria-hidden />
          {t('summary', {
            tills: data.totals.onShift,
            branches: data.totals.branches,
          })}
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs tabular-nums">
          <Banknote className="size-3.5" aria-hidden />
          {t('takenToday', { amount: formatter.number(Number(data.totals.taken), 'currency') })}
        </span>
        {/* Says outright that the range picker does not reach this band. */}
        <span className="text-muted-foreground/80 ms-auto text-[11px]">{t('liveNote')}</span>
        <Link href="/admin/shifts" className="text-primary text-xs font-semibold hover:underline">
          {t('allShifts')}
        </Link>
      </div>

      {!hasTillRows ? (
        // A quiet floor is one fact, not five zero-valued KPI cards plus an
        // empty till grid. Keeping it compact makes a new/small business reach
        // revenue and orders without scrolling through unused POS detail.
        <p className="text-muted-foreground bg-card rounded-lg border px-4 py-4 text-sm">
          {t('empty')}
        </p>
      ) : (
        <>
          {template === 'roster' ? <RosterTable data={data} /> : null}
          {template === 'triage' ? <Triage data={data} /> : null}
          {showFigures ? <FigureCells data={data} /> : null}
          {showCards ? <TillCards data={data} /> : null}

          {/* A cashier's own note is the one thing here they wrote themselves, so
              it is surfaced rather than buried on the shift detail page. */}
          {data.openShifts
            .filter((till) => till.note)
            .slice(0, 2)
            .map((till) => (
              <p
                key={`note-${till.shiftId}`}
                className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs"
              >
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-400"
                  aria-hidden
                />
                <span>
                  <span className="font-semibold">{t('shiftNote')}</span> “{till.note}”
                  <span className="text-muted-foreground"> · {till.user.name ?? till.user.email}</span>
                </span>
              </p>
            ))}
        </>
      )}
    </section>
  );
}
