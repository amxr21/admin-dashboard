'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RefreshButtonProps {
  onRefresh: () => void;
  isLoading?: boolean;
  /** Null until the first successful load, when the control reads “Refresh”. */
  lastUpdated?: Date | null;
  className?: string;
}

/** A shared, accessible refresh control with a trustworthy success timestamp. */
export function RefreshButton({
  onRefresh,
  isLoading = false,
  lastUpdated = null,
  className,
}: RefreshButtonProps) {
  const t = useTranslations('dashboard');
  const formatter = useFormatter();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onRefresh}
      disabled={isLoading}
      aria-busy={isLoading}
      className={cn('text-muted-foreground gap-1.5', className)}
    >
      <RefreshCw
        className={cn('size-3.5', isLoading && 'animate-spin motion-reduce:animate-none')}
        aria-hidden
      />
      {lastUpdated
        ? t('lastUpdated', {
            date: formatter.dateTime(lastUpdated, { dateStyle: 'medium' }),
            time: formatter.dateTime(lastUpdated, { timeStyle: 'short' }),
          })
        : t('refresh')}
    </Button>
  );
}
