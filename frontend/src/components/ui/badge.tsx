import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Status badge.
 *
 * Tones map to the semantic tokens, so they re-point correctly in dark mode
 * with no `dark:` prefix. Never write a raw colour here.
 *
 * The `/15` alpha on the tinted variants is deliberate: a solid success-green
 * fill on every delivered order turns a table into a wall of colour. Tinted
 * backgrounds with a saturated foreground stay readable at density.
 *
 * IMPORTANT: pass TRANSLATED text as children. The DB stores `DELIVERED`; the
 * UI renders `t('orderStatus.DELIVERED')`. Never render a raw enum value.
 */
const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden',
    'rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    '[&>svg]:size-3 [&>svg]:pointer-events-none',
  ),
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground border-border',
        success: 'border-transparent bg-success/15 text-success',
        warning: 'border-transparent bg-warning/15 text-warning',
        destructive: 'border-transparent bg-destructive/15 text-destructive',
        info: 'border-transparent bg-info/15 text-info',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
export type { BadgeProps };
