import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Low-level table primitives. `DataTable` composes these; use them directly
 * only for tables that genuinely don't need selection, sorting or state
 * handling.
 *
 * Column ORDER mirrors automatically in RTL — the first column renders
 * rightmost. That is correct and should not be fought. Note the consequence:
 * if column order encodes meaning (earliest → latest), the meaning mirrors too.
 *
 * Alignment is logical (`text-start`), never `text-left`. Numeric columns
 * should opt into `text-end` at the call site.
 */

function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    // The wrapper scrolls, not the page. A wide table inside a dashboard must
    // never make the whole document scroll horizontally.
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('bg-muted/50 border-t font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-border hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        // `py-(--table-cell-py)` rather than a fixed `h-10`, so
        // `ui.density` (see globals.css / settings-provider.tsx) can shrink
        // row height by changing the one custom property both this and
        // TableCell read.
        'text-muted-foreground px-2 py-(--table-cell-py) text-start align-middle font-medium whitespace-nowrap',
        '[&:has([role=checkbox])]:w-0 [&:has([role=checkbox])]:pe-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'px-2 py-(--table-cell-py) align-middle whitespace-nowrap',
        '[&:has([role=checkbox])]:w-0 [&:has([role=checkbox])]:pe-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
