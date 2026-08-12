'use client';

import { useMemo } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { TrendingDown, TrendingUp } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from '@/i18n/navigation';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { getDocumentDirection } from '@/lib/direction';
import { bucketEnd, drillDownHref, type Granularity } from '@/lib/reports-api';
import { cn } from '@/lib/utils';

/**
 * Revenue over time.
 *
 * ─── FORM ────────────────────────────────────────────────────────────
 * A line, not bars: the job is change-over-time on a continuous series, and a
 * line reads the trend directly. Bars would invite comparing individual
 * magnitudes, which is not the question here.
 *
 * ONE y-axis. A dual-axis chart (revenue + order count on separate scales) is
 * the single most common charting mistake — the crossing point is an artefact
 * of the two scales and means nothing. Two measures of different scale get two
 * charts.
 *
 * ─── A REAL TIME SCALE, NOT A CATEGORICAL ONE ─────────────────────────
 * `data` arrives GAP-FILLED (see `fillRevenueGaps` in reports-api.ts) — one
 * entry per calendar bucket in the range, `revenue: null` where nothing sold.
 * The x-axis plots each bucket's real timestamp (`type="number"`, numeric
 * domain) rather than Recharts' default categorical axis, which gives every
 * DATA POINT equal spacing regardless of the calendar gap between it and its
 * neighbour. Combined with the dense gap-filled input, equal calendar spans
 * now genuinely occupy equal pixel width.
 *
 * ─── A GAP IS A GAP, NEVER A ZERO ──────────────────────────────────────
 * `revenue: null` renders as a break in the line (`connectNulls={false}`),
 * matching this project's "never fabricate a value" rule — an interpolated
 * zero would claim certainty ("nothing sold that day") the data doesn't have.
 *
 * ─── COLOUR ──────────────────────────────────────────────────────────
 * Colours come from CSS custom properties, so light and dark each use their
 * own VALIDATED step rather than one hex flipped between themes.
 *
 * ─── RTL ─────────────────────────────────────────────────────────────
 * Recharts does not read `dir`. A time axis must stay left-to-right even in
 * Arabic (time is not a reading-direction concept), but the y-axis and tooltip
 * DO belong on the reading-start side, so `yAxisOrientation` is direction-aware.
 *
 * ─── KEYBOARD ────────────────────────────────────────────────────────
 * Recharts' `accessibilityLayer` defaults to `true` on every Cartesian chart
 * — Tab focuses the chart, arrow keys move point-to-point, each move fires
 * the same tooltip a mouse hover would. Left as the default rather than a
 * hand-rolled keydown handler.
 */

export interface RevenuePoint {
  /** Bucket start date, ISO. */
  date: string;
  /** `null` is a real gap (nothing sold), never fabricated as zero. */
  revenue: number | null;
}

interface RevenueChartProps {
  /** Gap-filled, ascending by date — see `fillRevenueGaps`. */
  data: readonly RevenuePoint[];
  granularity: Granularity;
  /**
   * A second series over the comparison period (previous period / same
   * period last year), aligned POSITIONALLY to `data` — comparison[i] is
   * plotted at data[i]'s x position, with its own real date kept only for
   * the tooltip. That's what makes an overlay of two different absolute
   * date ranges readable as one shape.
   */
  comparisonData?: readonly RevenuePoint[] | null;
  /** Noun-phrase label for the comparison row in the tooltip, e.g. "Previous
   *  period" — must track whichever comparison the caller has selected. */
  comparisonLabel?: string;
  isLoading?: boolean;
  error?: string | null;
  /**
   * C1.6 — clicking a point drills into the orders placed in exactly that
   * bucket. Opt-in (omit to keep a point inert): the dashboard and Reports
   * both render this chart, and a bare "click a chart point" affordance with
   * no visual cue would be a mystery interaction if every consumer had it
   * whether or not clicking actually did anything.
   */
  drillDownEnabled?: boolean;
}

interface ChartDatum {
  index: number;
  timestamp: number;
  date: string;
  /** Value for a settled bucket; null if incomplete or genuinely empty. */
  revenue: number | null;
  /** Value repeated at the boundary + the trailing incomplete bucket(s), so
   *  a second dashed Line can draw just the "still accumulating" segment. */
  revenueTrailing: number | null;
  isProvisional: boolean;
  comparisonDate?: string;
  comparisonRevenue?: number | null;
}

function toTimestamp(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d).getTime();
}

/** Evenly spaced tick indices — dense for a short range, thinned out for a
 *  long one, rather than trusting Recharts' categorical auto-skip. */
function computeTickIndices(count: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [0];
  const target = count <= 10 ? count : count <= 40 ? 8 : 10;
  const step = (count - 1) / (target - 1);
  const indices = new Set<number>();
  for (let i = 0; i < target; i++) indices.add(Math.round(i * step));
  return [...indices].sort((a, b) => a - b);
}

/**
 * Recharts v3 passes these to a custom tooltip, but its exported
 * `TooltipProps` no longer describes them. Declaring the shape locally is
 * honest about what we actually consume, and survives the library's next
 * type reshuffle.
 */
interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly { payload?: ChartDatum }[];
  comparisonLabel?: string;
  /** Adds the "click to view orders" hint (C1.6) — the tooltip is the one
   *  place this affordance can be discovered without already knowing it's
   *  there, since the cursor-pointer change alone is easy to miss. */
  drillDownEnabled?: boolean;
}

/**
 * States what each stroke means, so the meaning isn't locked behind a hover.
 *
 * Only ever renders entries for series that actually exist on this render —
 * the comparison swatch appears exclusively when `comparisonData` is passed,
 * the provisional swatch only when the chart actually has a trailing
 * incomplete bucket to explain. A legend item for a line that isn't drawn
 * would be worse than none: it invites hunting for a stroke that was never
 * there.
 *
 * Deliberately NOT rendered for the single-line case — that's still the
 * heading-names-the-series shortcut this file already used, and adding a
 * one-item legend under a heading that already says "Revenue over time"
 * would be pure redundancy.
 */
function ChartLegend({
  hasComparison,
  hasProvisional,
  comparisonLabel,
}: {
  hasComparison: boolean;
  hasProvisional: boolean;
  comparisonLabel?: string;
}) {
  const t = useTranslations('dashboard');

  if (!hasComparison && !hasProvisional) return null;

  return (
    <div className="text-muted-foreground mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-4 shrink-0" style={{ backgroundColor: 'var(--chart-1)' }} />
        {t('revenue')}
      </span>

      {hasProvisional ? (
        <span className="inline-flex items-center gap-1.5">
          <DashedSwatch color="var(--chart-1)" />
          {t('revenueChart.inProgress')}
        </span>
      ) : null}

      {hasComparison ? (
        <span className="inline-flex items-center gap-1.5">
          <DashedSwatch color="var(--muted-foreground)" />
          {comparisonLabel ?? t('comparison.previousPeriod')}
        </span>
      ) : null}
    </div>
  );
}

/** A tiny dashed line sample, matching the SVG strokes exactly — an actual
 *  dashed stroke, not a CSS border approximation, so the swatch never drifts
 *  from what the chart itself draws. */
function DashedSwatch({ color }: { color: string }) {
  return (
    <svg width="16" height="2" className="shrink-0" aria-hidden>
      <line x1="0" y1="1" x2="16" y2="1" stroke={color} strokeWidth="1.5" strokeDasharray="4 4" />
    </svg>
  );
}

function ChartTooltip({ active, payload, comparisonLabel, drillDownEnabled }: ChartTooltipProps) {
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const t = useTranslations('dashboard');

  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;

  const hasComparison = datum.comparisonRevenue !== undefined;
  const delta =
    hasComparison &&
    datum.revenue !== null &&
    datum.comparisonRevenue !== null &&
    datum.comparisonRevenue !== undefined &&
    datum.comparisonRevenue !== 0
      ? ((datum.revenue - datum.comparisonRevenue) / datum.comparisonRevenue) * 100
      : undefined;

  return (
    <div className="bg-popover text-popover-foreground min-w-40 rounded-md border px-3 py-2 text-sm shadow-md">
      <p className="text-muted-foreground mb-1 text-xs">
        {formatter.dateTime(new Date(datum.date), 'short')}
        {datum.isProvisional ? (
          <span className="text-muted-foreground/80 ms-1.5">
            · {t('revenueChart.inProgress')}
          </span>
        ) : null}
      </p>
      <p className="font-medium tabular-nums">
        {t('revenue')}:{' '}
        {datum.revenue === null ? '—' : formatCurrency(datum.revenue)}
      </p>

      {hasComparison ? (
        <>
          <p className="text-muted-foreground tabular-nums">
            {comparisonLabel ?? t('comparison.previousPeriod')}
            {datum.comparisonDate ? (
              <span className="ms-1">
                ({formatter.dateTime(new Date(datum.comparisonDate), 'short')})
              </span>
            ) : null}
            :{' '}
            {datum.comparisonRevenue === null || datum.comparisonRevenue === undefined
              ? '—'
              : formatCurrency(datum.comparisonRevenue)}
          </p>
          {delta !== undefined ? (
            <p
              className={cn(
                'mt-0.5 flex items-center gap-1 text-xs tabular-nums',
                delta >= 0 ? 'text-success' : 'text-destructive',
              )}
            >
              {delta >= 0 ? (
                <TrendingUp className="size-3" aria-hidden />
              ) : (
                <TrendingDown className="size-3" aria-hidden />
              )}
              {formatter.number(Math.abs(delta) / 100, {
                style: 'percent',
                maximumFractionDigits: 1,
              })}
            </p>
          ) : null}
        </>
      ) : null}

      {drillDownEnabled ? (
        <p className="text-muted-foreground border-border/60 mt-1.5 border-t pt-1.5 text-xs">
          {t('revenueChart.clickToViewOrders')}
        </p>
      ) : null}
    </div>
  );
}

export function RevenueChart({
  data,
  granularity,
  comparisonData = null,
  comparisonLabel,
  isLoading = false,
  error = null,
  drillDownEnabled = false,
}: RevenueChartProps) {
  const t = useTranslations('dashboard');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
  const router = useRouter();

  const isRtl = getDocumentDirection() === 'rtl';

  const chartData = useMemo<ChartDatum[]>(() => {
    const now = Date.now();
    const isProvisional = data.map((point) => bucketEnd(point.date, granularity).getTime() > now);

    return data.map((point, index) => {
      const comparisonPoint = comparisonData?.[index];
      // The last SETTLED bucket immediately before a provisional one also
      // gets a `revenueTrailing` value, repeating its own `revenue` — that's
      // the anchor the dashed "still accumulating" segment draws from.
      // Recharts only draws a segment between two consecutive non-null
      // entries, so without this the dashed line would have nothing to join.
      const isJoiningPoint = !isProvisional[index] && isProvisional[index + 1] === true;

      return {
        index,
        timestamp: toTimestamp(point.date),
        date: point.date,
        revenue: isProvisional[index] ? null : point.revenue,
        revenueTrailing: isProvisional[index] || isJoiningPoint ? point.revenue : null,
        isProvisional: isProvisional[index]!,
        ...(comparisonData
          ? {
              comparisonDate: comparisonPoint?.date,
              comparisonRevenue: comparisonPoint?.revenue ?? null,
            }
          : {}),
      };
    });
  }, [data, comparisonData, granularity]);

  const hasAnyData = chartData.some((d) => d.revenue !== null || d.revenueTrailing !== null);
  const hasProvisional = chartData.some((d) => d.isProvisional);
  const tickIndices = useMemo(() => computeTickIndices(chartData.length), [chartData.length]);
  const tickTimestamps = tickIndices.map((i) => chartData[i]!.timestamp);

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    );
  }

  // A one-bucket range (e.g. the "Today" preset) has nothing to draw a LINE
  // between — a single point is a stat, not a chart. Render it as one.
  if (chartData.length === 1) {
    const only = chartData[0]!;
    return (
      <div className="bg-card rounded-lg border p-4">
        <h2 className="mb-4 text-sm font-medium">{t('revenueOverTime')}</h2>
        {error ? (
          <p className="text-destructive flex h-64 items-center justify-center text-sm">
            {error}
          </p>
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-1">
            <p className="text-3xl font-semibold tabular-nums">
              {only.revenue === null && only.revenueTrailing === null
                ? '—'
                : formatCurrency((only.revenue ?? only.revenueTrailing)!)}
            </p>
            <p className="text-muted-foreground text-sm">
              {formatter.dateTime(new Date(only.date), 'long')}
              {only.isProvisional ? ` · ${t('revenueChart.inProgress')}` : ''}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border p-4">
      {/* The heading names the series, which is why no legend is needed for a
          single line — ChartLegend itself stays silent in that case. Once a
          comparison overlay or an in-progress tail is on screen, "the
          heading names the series" stops being true (there are up to three
          strokes now), so the legend picks up exactly the entries the
          heading no longer covers alone. */}
      <h2 className="mb-4 text-sm font-medium">{t('revenueOverTime')}</h2>

      {error ? (
        <p className="text-destructive flex h-64 items-center justify-center text-sm">
          {error}
        </p>
      ) : !hasAnyData ? (
        <p className="text-muted-foreground flex h-64 items-center justify-center text-sm">
          {t('revenueChart.noData')}
        </p>
      ) : (
        <>
          <ChartLegend
            hasComparison={Boolean(comparisonData)}
            hasProvisional={hasProvisional}
            comparisonLabel={comparisonLabel}
          />
          <ResponsiveContainer width="100%" height={256}>
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            accessibilityLayer
            className={drillDownEnabled ? 'cursor-pointer' : undefined}
            onClick={
              drillDownEnabled
                ? (state) => {
                    // Recharts 3 dropped `activePayload` from the click
                    // event; `activeIndex` is the position into the same
                    // `chartData` array this component built, so looking the
                    // point up there is the direct replacement.
                    const index = typeof state?.activeIndex === 'number' ? state.activeIndex : undefined;
                    const clicked = index === undefined ? undefined : chartData[index];
                    if (!clicked) return;

                    router.push(drillDownHref(clicked.date, granularity));
                  }
                : undefined
            }
          >
            {/* Recessive grid: horizontal only. Vertical lines add clutter
                without helping read a trend. */}
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />

            <XAxis
              dataKey="timestamp"
              type="number"
              // Default linear scale over numeric epoch-ms values — d3's
              // "time" scale expects Date objects, and would silently
              // mishandle the plain numbers `timestamp` carries.
              domain={['dataMin', 'dataMax']}
              ticks={tickTimestamps}
              // Time flows left-to-right in every locale — NOT reversed for
              // Arabic. Reversing it would make the trend read backwards.
              reversed={false}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              tickFormatter={(value: number) =>
                new Intl.DateTimeFormat(locale, {
                  day: 'numeric',
                  month: 'short',
                  // Western digits in both locales, matching the app-wide rule.
                  numberingSystem: 'latn',
                }).format(new Date(value))
              }
            />

            <YAxis
              // The value axis belongs on the reading-START edge, so it moves
              // to the right in Arabic. Unlike the time axis, this one IS a
              // reading-direction concern.
              orientation={isRtl ? 'right' : 'left'}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              width={72}
              tickFormatter={(value: number) =>
                // Composed by hand: next-intl can't merge the named 'currency'
                // format with `notation: 'compact'` in one call, so the shape
                // mirrors i18n/request.ts's currency format directly.
                formatter.number(value, {
                  style: 'currency',
                  currency: 'AED',
                  numberingSystem: 'latn',
                  notation: 'compact',
                })
              }
            />

            <Tooltip
              content={
                <ChartTooltip comparisonLabel={comparisonLabel} drillDownEnabled={drillDownEnabled} />
              }
              cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
            />

            {comparisonData ? (
              // Rendered FIRST so it sits behind the primary line in SVG
              // stacking order — muted and dashed, a reference shape rather
              // than a second thing competing for attention.
              <Line
                type="monotone"
                dataKey="comparisonRevenue"
                stroke="var(--muted-foreground)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 1, stroke: 'var(--card)' }}
                connectNulls={false}
                isAnimationActive={!reducedMotion}
              />
            ) : null}

            <Line
              type="monotone"
              dataKey="revenue"
              // Token, not a hex — light and dark each resolve their own
              // validated step.
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--chart-1)', strokeWidth: 0 }}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
            />

            {/* The still-accumulating tail: same colour, dashed, no dots of
                its own — a continuation of the line above, not a second
                series. Only ever non-null for the most recent bucket(s). */}
            <Line
              type="monotone"
              dataKey="revenueTrailing"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
            />
          </LineChart>
        </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
