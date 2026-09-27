'use client';

import { useId, useRef, type KeyboardEvent } from 'react';

import { radioArrowStep } from '@/lib/radio-group-keys';
import { cn } from '@/lib/utils';

/**
 * A single-choice picker drawn as a grid of cards: every option visible, one
 * click to pick. For a short catalogue (a cancellation reason, say) where a
 * `<Select>` would hide the choices behind an extra click.
 *
 * Same accessible primitive as `SegmentedControl` — `role="radiogroup"` over
 * `role="radio"` buttons, one tab stop, arrows move AND select, resolved
 * through the text direction so RTL moves the right way. The two share
 * `radioArrowStep` so their keyboard behaviour can't drift apart.
 *
 * Unlike a segmented control this may start with NOTHING selected (a required
 * reason the user hasn't picked yet). The first card is then the tab stop, so
 * the group is still reachable by keyboard.
 */

export interface ChoiceOption {
  value: string;
  /** Already human-readable — raw enum values never reach here. */
  label: string;
}

interface ChoiceCardsProps {
  options: ChoiceOption[];
  /** `''` when nothing is picked yet. */
  value: string;
  onChange: (value: string) => void;
  columns?: 1 | 2;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  id?: string;
  className?: string;
}

export function ChoiceCards({
  options,
  value,
  onChange,
  columns = 2,
  disabled = false,
  id,
  className,
  ...aria
}: ChoiceCardsProps) {
  const generatedId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop = selectedIndex === -1 ? 0 : selectedIndex;

  function move(delta: number) {
    // With nothing picked yet, focus sits on the tab stop (the first card), so
    // arrows move on from there — the WAI-ARIA radio group behaviour.
    const next = (tabStop + delta + options.length) % options.length;
    const nextValue = options[next]?.value;
    if (nextValue === undefined) return;
    onChange(nextValue);
    ref.current
      ?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(nextValue)}"]`)
      ?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const isRtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = radioArrowStep(event.key, isRtl);
    if (step === null) return;
    event.preventDefault();
    move(step);
  }

  return (
    <div
      ref={ref}
      id={id ?? generatedId}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2', className)}
      {...aria}
    >
      {options.map((option, index) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            data-value={option.value}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-10 items-center gap-2.5 rounded-md border px-3 py-2 text-start text-sm transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              'disabled:pointer-events-none disabled:opacity-50',
              isActive ? 'border-primary bg-primary/10' : 'hover:bg-muted/60',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-full border',
                isActive ? 'border-primary' : 'border-muted-foreground/60',
              )}
            >
              {isActive ? <span className="bg-primary size-2 rounded-full" /> : null}
            </span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
