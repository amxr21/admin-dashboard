'use client';

import { useTranslations } from 'next-intl';
import { Columns3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Show/hide per column, persisted per table — see `useColumnVisibility.ts`.
 *
 * Reordering is deliberately NOT part of this component. The spec's A2.4
 * asks for both, but this codebase's `Column<T>` array is a plain prop
 * passed fresh on every render — reordering it would mean either mutating
 * caller-owned state (fragile, six call sites to get right) or a second
 * "display order" concept layered on top of "declaration order", which is a
 * meaningfully bigger feature than a checkbox list. Shipping show/hide now
 * rather than blocking it on reorder.
 */

export interface ManagedColumn {
  id: string;
  /** Plain text, not the column's JSX header — a header can be a sort
   *  button or an sr-only span, neither of which reads well as a menu item
   *  label. Callers supply the human name separately. */
  label: string;
}

interface ColumnManagerProps {
  columns: readonly ManagedColumn[];
  hiddenColumns: ReadonlySet<string>;
  onToggle: (columnId: string, visible: boolean) => void;
  onReset: () => void;
  className?: string;
}

export function ColumnManager({
  columns,
  hiddenColumns,
  onToggle,
  onReset,
  className,
}: ColumnManagerProps) {
  const t = useTranslations('table');
  const hasHidden = hiddenColumns.size > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <Columns3 aria-hidden />
          {t('columns.label')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('columns.label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={!hiddenColumns.has(column.id)}
            // Radix closes the menu on select by default for a regular item,
            // but a checkbox item is meant for exactly this — toggling
            // several columns in one open menu without it snapping shut
            // after the first click.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => onToggle(column.id, checked)}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        {hasHidden ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReset}>{t('columns.reset')}</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
