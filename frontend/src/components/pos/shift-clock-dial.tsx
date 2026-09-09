'use client';

/**
 * The circular clock face (owner's note, 2026-09-09: "an interactive clock
 * to set the shift, smth like [Apple Sleep's bedtime dial]").
 *
 * ─── WHY THIS IS A VISUALIZATION, NOT A SCHEDULER ─────────────────────
 * The reference image sets two FUTURE times (bedtime, wake time) on a 24h
 * ring. This app's `Shift` model is deliberately real-time only — see the
 * schema comment on `Shift`: "no planned start, no rota, no schedule
 * editor," the owner's own call from 2026-09-08, one day before this
 * request. Reversing that to add scheduling would be a real schema change
 * this component has no business making on its own (confirmed with the
 * owner 2026-09-09). So the dial shows the SAME clock-on/clock-off facts
 * the plain screen already did — a single handle marks the shift's actual
 * start, an arc sweeps to the current time, and the center shows elapsed
 * duration — just read off a 24-hour circle instead of a stopwatch string.
 * No new data, no new state; `startedAt`/`now` are the only inputs.
 *
 * ─── NOT DRAGGABLE ─────────────────────────────────────────────────────
 * The reference dial is drag-to-set because both its handles are planned
 * (arbitrary) times. Here the start handle IS "when I pressed Start" and the
 * end of the arc IS "now" — neither is a free variable, so dragging would
 * either do nothing or silently rewrite a timestamp the correction flow
 * (`originalStartedAt`/`editedById`) exists specifically to keep honest.
 */

import { useId, useMemo } from 'react';

const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = 96;
const STROKE = 14;

/** Minutes since local midnight, 0–1439. */
function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** 0 minutes = top of the circle (12 o'clock), clockwise, one full lap = 24h. */
function pointOnRing(minutes: number, radius: number) {
  const angle = (minutes / 1440) * 2 * Math.PI - Math.PI / 2;
  return {
    x: CENTER + radius * Math.cos(angle),
    y: CENTER + radius * Math.sin(angle),
  };
}

/** SVG arc path from `startMinutes` to `endMinutes`, clockwise, wrapping at 24h. */
function arcPath(startMinutes: number, endMinutes: number, radius: number): string {
  const span = ((endMinutes - startMinutes + 1440) % 1440) || 1440;
  const start = pointOnRing(startMinutes, radius);
  const end = pointOnRing(endMinutes, radius);
  const largeArc = span > 720 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

interface ShiftClockDialProps {
  /** ISO timestamp the shift started, or null when nothing is running yet. */
  startedAt: string | null;
  /** Elapsed duration already formatted (h:mm) — reused from `elapsedLabel`
   *  rather than recomputed here, so the two never disagree. */
  durationLabel?: string;
  /** Small caption under the duration, e.g. the branch name. */
  caption?: string;
}

export function ShiftClockDial({ startedAt, durationLabel, caption }: ShiftClockDialProps) {
  const gradientId = useId();

  // `now` intentionally does not tick on its own — the parent already
  // re-renders this once a minute via useShiftClock's `tick`, and adding a
  // second independent timer here would just be two clocks that can drift
  // apart from each other on a throttled background tab. Reading the clock
  // directly in render (no memo) means every re-render — including that
  // tick — draws an up-to-date arc.
  const now = new Date();

  const ticks = useMemo(
    () =>
      Array.from({ length: 24 }, (_, hour) => {
        const outer = pointOnRing(hour * 60, RADIUS + STROKE / 2 + 6);
        const inner = pointOnRing(hour * 60, RADIUS + STROKE / 2 + (hour % 6 === 0 ? 2 : 3));
        return { hour, outer, inner, major: hour % 6 === 0 };
      }),
    [],
  );

  const start = startedAt ? new Date(startedAt) : null;
  const startMinutes = start ? minutesOfDay(start) : null;
  const nowMinutes = minutesOfDay(now);
  const handle = start ? pointOnRing(startMinutes!, RADIUS) : null;

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={
          start
            ? `Shift started at ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : 'No shift running'
        }
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {/* Track */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.1}
          strokeWidth={STROKE}
        />

        {/* Hour ticks */}
        {ticks.map(({ hour, outer, inner, major }) => (
          <line
            key={hour}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            stroke="currentColor"
            strokeOpacity={major ? 0.35 : 0.15}
            strokeWidth={major ? 1.5 : 1}
          />
        ))}

        {/* Elapsed arc, start → now */}
        {start ? (
          <path
            d={arcPath(startMinutes!, nowMinutes, RADIUS)}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        ) : null}

        {/* Start handle */}
        {handle ? (
          <circle
            cx={handle.x}
            cy={handle.y}
            r={STROKE / 2 + 3}
            fill="var(--color-background)"
            stroke="var(--color-primary)"
            strokeWidth={3}
          />
        ) : null}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
        {durationLabel ? (
          <p className="text-3xl font-semibold tabular-nums">{durationLabel}</p>
        ) : (
          <p className="text-muted-foreground text-sm">—</p>
        )}
        {caption ? <p className="text-muted-foreground max-w-36 text-xs">{caption}</p> : null}
      </div>
    </div>
  );
}
