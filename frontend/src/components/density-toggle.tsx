'use client';

import { useTranslations } from 'next-intl';
import { AlignJustify, Rows3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Density } from '@/hooks/useTableDensity';

/**
 * The comfortable/compact switch for one table.
 *
 * Two buttons, not a single toggle — a toggle communicates only the CURRENT
 * state and requires reading the icon to know what clicking it does; two
 * buttons show both options at once and the pressed one is self-evident.
 * `aria-pressed` carries that same information to a screen reader, so this
 * behaves as a two-item toolbar rather than a single ambiguous switch.
 */

interface DensityToggleProps {
  value: Density;
  onChange: (value: Density) => void;
  className?: string;
}

export function DensityToggle({ value, onChange, className }: DensityToggleProps) {
  const t = useTranslations('table');

  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-md border p-0.5', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={value === 'comfortable' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-7"
            aria-pressed={value === 'comfortable'}
            aria-label={t('density.comfortable')}
            onClick={() => onChange('comfortable')}
          >
            <Rows3 aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('density.comfortable')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={value === 'compact' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-7"
            aria-pressed={value === 'compact'}
            aria-label={t('density.compact')}
            onClick={() => onChange('compact')}
          >
            <AlignJustify aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('density.compact')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
