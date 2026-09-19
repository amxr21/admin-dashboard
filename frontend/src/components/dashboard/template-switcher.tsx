'use client';

import { useTranslations } from 'next-intl';
import { Check, LayoutTemplate } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { DASHBOARD_TEMPLATES, type DashboardTemplate } from '@/lib/dashboard-template';

/**
 * Picks which shape the live band takes.
 *
 * ─── WHY EACH OPTION CARRIES A WIREFRAME ─────────────────────────────
 * "Overview + tills" and "Till cards only" are not distinguishable as words
 * to someone who has not already seen both. A three-row block diagram shows
 * the difference at the size the menu actually renders, which a sentence
 * cannot — the same reason the band itself uses cards rather than a list.
 *
 * The diagrams are decorative: every option is fully described by its name
 * and its one-line summary, so a screen reader loses nothing by skipping
 * them.
 */

/** Row occupancy per template, drawn as filled/empty blocks. */
const WIREFRAMES: Record<DashboardTemplate, boolean[][]> = {
  combo: [
    [true, true, true],
    [true, true, true],
    [false, true, false],
  ],
  tills: [
    [true, true, true],
    [true, true, true],
  ],
  figures: [
    [true, true, true],
    [true, true, true],
  ],
  roster: [
    [true, true, true],
    [true, true, true],
    [true, true, true],
  ],
  triage: [
    [true, false, false],
    [true, true, true],
    [true, true, false],
  ],
};

function Wireframe({ rows, active }: { rows: boolean[][]; active: boolean }) {
  return (
    <span
      className={cn(
        'flex h-7 w-9 shrink-0 flex-col gap-0.5 rounded p-1',
        active ? 'bg-background' : 'bg-muted',
      )}
      aria-hidden
    >
      {rows.map((row, rowIndex) => (
        <span key={rowIndex} className="flex flex-1 gap-0.5">
          {row.map((filled, cellIndex) => (
            <span
              key={cellIndex}
              className={cn(
                'flex-1 rounded-[1px]',
                active ? 'bg-primary' : 'bg-muted-foreground',
                filled ? '' : 'opacity-25',
              )}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

interface TemplateSwitcherProps {
  value: DashboardTemplate;
  onChange: (template: DashboardTemplate) => void;
}

export function TemplateSwitcher({ value, onChange }: TemplateSwitcherProps) {
  const t = useTranslations('dashboard.templates');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <LayoutTemplate className="size-4" aria-hidden />
          {t(`${value}.name`)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[19rem]">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        {DASHBOARD_TEMPLATES.map((template) => {
          const active = template === value;
          return (
            <DropdownMenuItem
              key={template}
              onSelect={() => {
                onChange(template);
              }}
              className={cn('items-start gap-3 py-2', active && 'bg-accent')}
            >
              <Wireframe rows={WIREFRAMES[template]} active={active} />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{t(`${template}.name`)}</span>
                <span className="text-muted-foreground text-xs leading-snug whitespace-normal">
                  {t(`${template}.description`)}
                </span>
              </span>
              {active ? (
                <Check className="text-primary ms-auto size-4 shrink-0" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
