'use client';

import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A text input with a search icon inside its leading edge.
 *
 * ─── WHY THIS IS A COMPONENT ─────────────────────────────────────────
 * Ten files render this exact markup by hand:
 *
 *   <div className="relative">
 *     <Search className="text-muted-foreground pointer-events-none
 *                        absolute start-3 top-1/2 size-4 -translate-y-1/2" />
 *     <Input className="ps-9" … />
 *   </div>
 *
 * Byte-identical in every one of them, differing only by `id` and which
 * translation namespace the placeholder comes from. The icon's offset and the
 * input's matching padding are a PAIR — `start-3` and `ps-9` have to change
 * together or the text runs under the icon — and ten copies is ten chances for
 * one of them to be adjusted alone.
 *
 * ─── LOGICAL PROPERTIES, NOT LEFT/RIGHT ──────────────────────────────
 * `start-3`/`ps-9` rather than `left-3`/`pl-9`, so the icon sits on the
 * reading-start edge in Arabic too. That is the single most common RTL bug in
 * this codebase and it is why the offset lives here once rather than being
 * retyped per call site.
 *
 * ─── IT IS STILL AN INPUT ────────────────────────────────────────────
 * Every `Input` prop passes through, so a caller keeps its own `value`,
 * `onChange`, `id` and `aria-label`. This adds the icon and the padding; it
 * does not own the search, the debounce, or where the value goes.
 */
export function SearchInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <Search
        className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        // `type` stays whatever the caller passes (usually nothing, i.e.
        // text): `type="search"` adds a browser-drawn clear button that would
        // sit beside the app's own filter chips and behave differently.
        className={cn('ps-9', className)}
        {...props}
      />
    </div>
  );
}
