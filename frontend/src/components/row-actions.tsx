'use client';

import { useTranslations } from 'next-intl';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The trailing action cell every table row needs, capped at two visible
 * buttons with the rest behind a `⋯` menu.
 *
 * Before this, a table that grew a third row action (edit, delete, view
 * history) just added another icon button, so the actions column grew with
 * the feature set instead of staying a fixed width — on a narrow viewport the
 * row's substance got squeezed to make room. Two is a design constraint, not
 * a technical one: it forces "which two does this row actually need clicked
 * in a hurry" to be an explicit choice per table rather than "however many
 * we've added so far."
 *
 * `actions` is the FULL list in priority order; this component decides the
 * split. A caller doesn't hand-pick which are visible, so behaviour stays
 * identical across every table that adopts it rather than drifting per file.
 */

export interface RowAction {
  /** Stable key, also used as the DropdownMenuItem key. */
  id: string;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  /** For a link-shaped action (e.g. "view history"). Mutually exclusive with
   *  `onClick` — routes through the real, locale-aware `Link` in both the
   *  inline and overflow positions rather than a synthetic navigation, so
   *  client-side routing and the active locale are preserved either way. */
  href?: string;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
}

interface RowActionsProps {
  actions: readonly RowAction[];
  /** How many render as individual icon buttons before the rest fold into
   *  the overflow menu. Defaults to the spec's "max 2 visible." */
  visibleCount?: number;
  className?: string;
}

export function RowActions({ actions, visibleCount = 2, className }: RowActionsProps) {
  const t = useTranslations('table');

  const visible = actions.slice(0, visibleCount);
  const overflow = actions.slice(visibleCount);

  if (actions.length === 0) return null;

  return (
    <div className={cn('flex items-center justify-end gap-1', className)}>
      {visible.map((action) => (
        <Tooltip key={action.id}>
          <TooltipTrigger asChild>
            <VisibleAction action={action} />
          </TooltipTrigger>
          <TooltipContent>{action.label}</TooltipContent>
        </Tooltip>
      ))}

      {overflow.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('moreActions')}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((action) => (
              <OverflowAction key={action.id} action={action} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

const destructiveButtonClass =
  'text-destructive hover:text-destructive hover:bg-destructive/10';

function VisibleAction({ action }: { action: RowAction }) {
  const className = cn(action.variant === 'destructive' && destructiveButtonClass);

  if (action.href) {
    return (
      <Button variant="ghost" size="icon" asChild className={className}>
        <Link href={action.href} aria-label={action.label}>
          <action.icon aria-hidden />
        </Link>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={action.disabled}
      onClick={action.onClick}
      className={className}
      aria-label={action.label}
    >
      <action.icon aria-hidden />
    </Button>
  );
}

function OverflowAction({ action }: { action: RowAction }) {
  if (action.href) {
    return (
      <DropdownMenuItem variant={action.variant} disabled={action.disabled} asChild>
        <Link href={action.href}>
          <action.icon aria-hidden />
          {action.label}
        </Link>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      variant={action.variant}
      disabled={action.disabled}
      onSelect={action.onClick}
    >
      <action.icon aria-hidden />
      {action.label}
    </DropdownMenuItem>
  );
}
