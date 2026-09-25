'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { DASHBOARD_MODES, type DashboardMode } from '@/lib/dashboard-mode';

interface DashboardModeToggleProps {
  value: DashboardMode;
  onChange: (mode: DashboardMode) => void;
}

/** Two toggle buttons in a labelled group — the pressed state is announced,
 *  and both stay reachable by Tab like any other button. */
export function DashboardModeToggle({ value, onChange }: DashboardModeToggleProps) {
  const t = useTranslations('dashboard.mode');

  return (
    <div role="group" aria-label={t('label')} className="bg-muted inline-flex rounded-lg p-0.5">
      {DASHBOARD_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            'min-h-8 rounded-md px-3 text-sm font-medium transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            value === mode
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(mode)}
        </button>
      ))}
    </div>
  );
}