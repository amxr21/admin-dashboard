'use client';

import { useId, useRef, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

/**
 * A segmented control — a single-choice picker whose few options are all
 * visible at once, for settings with 2–3 short, visual choices (density,
 * corner radius, panel style) where a `<Select>` would hide the options
 * behind a click and describe visual differences in words.
 *
 * ─── WHY NOT A NATIVE <select> OR RAW BUTTONS ────────────────────────
 * project-ui-system bans native interactive widgets; the accessible primitive
 * for "pick one of a few" is a radio group. This is that, styled as a segmented
 * bar: `role="radiogroup"` wrapping `role="radio"` buttons, one tab stop, arrow
 * keys move AND select between options (WAI-ARIA radiogroup pattern).
 *
 * ─── RTL ─────────────────────────────────────────────────────────────
 * Arrow handling is logical, not physical: ArrowRight/ArrowLeft are mapped
 * through the element's resolved direction so "next" always means the next
 * option in reading order, in both LTR and Arabic. Left/right are never
 * hard-coded.
 */

export interface SegmentedOption {
  value: string;
  /** Already human-readable — the caller title-cases; raw enum values never reach here. */
  label: string;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** Labels the group for assistive tech — there is no visible <label> inside. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  id?: string;
  className?: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  id,
  className,
  ...aria
}: SegmentedControlProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const ref = useRef<HTMLDivElement>(null);

  function move(delta: number) {
    const currentIndex = options.findIndex((option) => option.value === value);
    const from = currentIndex === -1 ? 0 : currentIndex;
    const next = (from + delta + options.length) % options.length;
    const nextValue = options[next]?.value;
    if (nextValue === undefined) return;
    onChange(nextValue);
    // Move focus to the newly-selected segment so keyboard and selection stay together.
    ref.current
      ?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(nextValue)}"]`)
      ?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Resolve physical arrows to logical direction so RTL moves the right way.
    const isRtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move(isRtl ? -1 : 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(isRtl ? 1 : -1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={ref}
      id={groupId}
      role="radiogroup"
      onKeyDown={onKeyDown}
      className={cn(
        'bg-muted/60 inline-flex w-full max-w-full rounded-lg border p-1',
        className,
      )}
      {...aria}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            data-value={option.value}
            // Only the selected segment is in the tab order; arrows reach the rest.
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
