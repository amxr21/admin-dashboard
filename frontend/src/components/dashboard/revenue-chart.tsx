'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
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
import { getDocumentDirection } from '@/lib/direction';

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
 * ─── COLOUR ──────────────────────────────────────────────────────────
 * One series, so `--chart-1` and no legend — the title names it. Colours come
 * from CSS custom properties, so light and dark each use their own VALIDATED
 * step rather than one hex flipped between themes.
 *
 * ─── RTL ─────────────────────────────────────────────────────────────
 * Recharts does not read `dir`. A time axis must stay left-to-right even in
 * Arabic (time is not a reading-direction concept), but the y-axis and tooltip
 * DO belong on the reading-start side, so `yAxisOrientation` is direction-aware.
 */

export interface RevenuePoint {
  /** ISO date. Formatted for display, never rendered raw. */
  date: string;
  revenue: number;
}

interface RevenueChartProps {
  data: readonly RevenuePoint[];
  isLoading?: boolean;
  error?: string | null;
}

/**
 * Recharts v3 passes these to a custom tooltip, but its exported
 * `TooltipProps` no longer describes them. Declaring the shape locally is
 * honest about what we actually consume, and survives the library's next
 * type reshuffle.
 */
interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly { value?: number }[];
  label?: string | number;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  const formatter = useFormatter();
  const t = useTranslations('dashboard');

  if (!active || !payload?.length) return null;

  const value = payload[0]?.value ?? 0;

  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-sm shadow-md">
      <p className="text-muted-foreground mb-1 text-xs">
        {formatter.dateTime(new Date(String(label)), 'short')}
      </p>
      <p className="font-medium tabular-nums">
        {t('revenue')}: {formatter.number(value, 'currency')}
      </p>
    </div>
  );
}

export function RevenueChart({ data, isLoading = false, error = null }: RevenueChartProps) {
  const t = useTranslations('dashboard');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const locale = useLocale();

  const isRtl = getDocumentDirection() === 'rtl';

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border p-4">
      {/* The heading names the series, which is why no legend is needed for a
          single line. */}
      <h2 className="mb-4 text-sm font-medium">{t('revenueOverTime')}</h2>

      {error ? (
        <p className="text-destructive flex h-64 items-center justify-center text-sm">
          {error}
        </p>
      ) : data.length === 0 ? (
        <p className="text-muted-foreground flex h-64 items-center justify-center text-sm">
          {tStates('empty.title')}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={256}>
          <LineChart data={[...data]} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            {/* Recessive grid: horizontal only. Vertical lines add clutter
                without helping read a trend. */}
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />

            <XAxis
              dataKey="date"
              // Time flows left-to-right in every locale — NOT reversed for
              // Arabic. Reversing it would make the trend read backwards.
              reversed={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              tickFormatter={(value: string) =>
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
              width={64}
              tickFormatter={(value: number) =>
                formatter.number(value, { notation: 'compact' })
              }
            />

            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
            />

            <Line
              type="monotone"
              dataKey="revenue"
              // Token, not a hex — light and dark each resolve their own
              // validated step.
              stroke="var(--chart-1)"
              strokeWidth={2}
              // No dot per point: at 30 points they become noise. The hover
              // dot marks the value being read instead.
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
