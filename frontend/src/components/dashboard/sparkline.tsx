'use client';

import { Line, LineChart, ResponsiveContainer } from 'recharts';

import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * A tiny trend line for a KPI tile (C1.3) — deliberately NOT a shrunk copy of
 * the full `RevenueChart`. No axes, no gridlines, no tooltip: at tile size
 * those would be illegible, and the sparkline's only job is "does this look
 * like it's going up, down, or flat", not "what was the value on the 14th".
 * The tile's own number + delta already state the precise figures.
 *
 * `null` values (a real gap — see `fillRevenueGaps`/`fillOrdersGaps`) are
 * passed straight to Recharts with `connectNulls={false}`, same rule as the
 * full chart: an interpolated line across a gap would claim data that
 * doesn't exist.
 */
interface SparklinePoint {
  date: string;
  value: number | null;
}

interface SparklineProps {
  data: readonly SparklinePoint[];
  /** Tailwind text-color class applied to the stroke via `currentColor` —
   *  reuses whatever tone the caller already established (e.g. the same
   *  success/destructive class the delta line uses) rather than a second,
   *  independent colour decision for the same tile. */
  className?: string;
}

export function Sparkline({ data, className }: SparklineProps) {
  const reducedMotion = useReducedMotion();

  // Fewer than 2 points has no trend to show — an empty tile-sized box would
  // just be visual noise where the KPI's normal delta text already sits.
  if (data.length < 2) return null;

  return (
    <div className={className} style={{ width: '100%', height: 32 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={[...data]} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke="currentColor"
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={!reducedMotion}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
