'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * A searchable single-select (URG-016/017/018).
 *
 * ─── WHY THIS EXISTS ALONGSIDE `Select` ──────────────────────────────
 * `select.tsx` is right for a handful of options you can eyeball. It is not
 * usable for 417 IANA zones or 162 currencies — there is no way to type, so
 * finding "Asia/Dubai" means scrolling a 417-row list. This adds the one
 * thing those lists need (a filter) and nothing else; every short option set
 * in the app should keep using `Select`.
 *
 * ─── WHY NOT `cmdk` ──────────────────────────────────────────────────
 * It would be a new dependency for one behaviour this repo already
 * implements: `command-palette.tsx` filters a list under a
 * `role="combobox"` input with a `role="listbox"` of results and arrow-key
 * navigation. This follows that same pattern so the app has one search-list
 * idiom rather than two, built on the existing Popover primitive.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  /** Shown in the filter box. */
  searchPlaceholder?: string;
  /** Shown when the filter matches nothing. */
  emptyText?: string;
  /** Lets the caller offer "not set" without inventing a sentinel value. */
  clearText?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  clearText,
  id,
  disabled,
  className,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Matches the hint too, so typing "AED" finds the dirham by its code and
    // "+04:00" finds every zone currently at that offset.
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) ||
        option.value.toLowerCase().includes(q) ||
        (option.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  // A stale highlight pointing past the end of a freshly filtered list would
  // make Enter select nothing (or the wrong row).
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Keep the highlighted row in view during arrow-key navigation.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${String(activeIndex)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function commit(next: string | null) {
    onValueChange(next);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) commit(option.value);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          className={cn(
            'border-input bg-background ring-offset-background placeholder:text-muted-foreground',
            'focus:ring-ring flex h-8 w-full items-center justify-between gap-2 rounded-md border',
            'px-3 py-1.5 text-sm transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...aria}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>

      {/* Tailwind v4 arbitrary-property syntax: `w-(--var)`, NOT v3's
          `w-[--var]`, which compiles to nothing here. */}
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <div className="border-b p-1">
          <Input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-controls={listId}
            className="h-8 border-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div ref={listRef} id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
          {/*
            Only offered when the list is UNFILTERED. Once someone is
            searching, "not set" is not a search result: leaving it in made a
            zero-match query render one stray clickable row instead of the
            empty state, and — because it sits first — Enter or a click on the
            "only match" cleared the field instead of selecting anything.
          */}
          {clearText && !query.trim() ? (
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              onClick={() => commit(null)}
              className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm"
            >
              <span className="size-4 shrink-0" aria-hidden />
              <span className="text-muted-foreground truncate">{clearText}</span>
            </button>
          ) : null}

          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">{emptyText}</p>
          ) : (
            filtered.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                data-index={index}
                aria-selected={option.value === value}
                onClick={() => commit(option.value)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm',
                  index === activeIndex && 'bg-accent',
                )}
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    option.value === value ? 'opacity-100' : 'opacity-0',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint ? (
                  // force-ltr: an offset or a currency code is a technical
                  // identifier and must read left-to-right even in Arabic.
                  <span className="text-muted-foreground force-ltr shrink-0 text-xs">
                    {option.hint}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
