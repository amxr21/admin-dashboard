'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  Coins,
  CreditCard,
  Package,
  RotateCcw,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * The one anatomy every dashboard panel shares.
 *
 * ─── WHY THESE ARE NOT CARDS ANY MORE ────────────────────────────────
 * Giving every panel the same border and fill makes every panel claim equal
 * attention. Compact paired summaries therefore stay plain, separated by
 * their heading rule and the grid spacing. Dense, full-width charts, tables,
 * and feeds can opt into a card so their data has a clear visual boundary.
 *
 * This preserves emphasis for the live floor band and attention queues while
 * making the most information-dense sections easier to scan.
 *
 * ─── THE ICON IS A SIGNIFIER, NOT DECORATION ─────────────────────────
 * Looked up by NAME rather than passed as a component, for the same reason
 * `stat-tile.tsx` does it: a function cannot cross the Server→Client
 * boundary, and `icon={Package}` fails only at build time, never in dev.
 */

const ICONS = {
  revenue: BarChart3,
  profit: Coins,
  orders: ShoppingCart,
  products: Package,
  inventory: Boxes,
  returns: RotateCcw,
  delivery: Truck,
  payments: CreditCard,
  activity: ClipboardList,
  branches: Building2,
  alert: AlertTriangle,
} satisfies Record<string, LucideIcon>;

export type WidgetIcon = keyof typeof ICONS;

/**
 * The icon tile's tint. Deliberately NOT free-form colour: `alert` is the
 * only tone that means something is wrong, and reserving it keeps a red tile
 * from appearing on a panel that is merely showing numbers.
 */
const TONES = {
  neutral: 'bg-muted text-muted-foreground',
  accent: 'bg-primary/10 text-primary',
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  alert: 'bg-destructive/10 text-destructive',
} as const;

export type WidgetTone = keyof typeof TONES;
export type WidgetSurface = 'plain' | 'card';

export interface WidgetSectionProps {
  title: string;
  icon: WidgetIcon;
  tone?: WidgetTone;
  /** A bounded surface for dense, full-width data. Compact summaries stay
   *  plain so the dashboard keeps a useful visual hierarchy. */
  surface?: WidgetSurface;
  /** Marks a panel that ignores the selected range — same wording the floor
   *  band and the low-stock tile use, so "live" means one thing everywhere. */
  live?: boolean;
  /** Left side of the footer: what the panel is showing, in words. */
  footNote?: ReactNode;
  /** Right side of the footer: where to go for the whole thing. */
  action?: { href: string; label: string };
  className?: string;
  children: ReactNode;
}

export function WidgetSection({
  title,
  icon,
  tone = 'neutral',
  surface = 'plain',
  live = false,
  footNote,
  action,
  className,
  children,
}: WidgetSectionProps) {
  const Icon = ICONS[icon];
  const t = useTranslations('dashboard');

  return (
    <section
      className={cn(
        'flex min-w-0 flex-col',
        surface === 'card' && 'bg-card rounded-lg border p-4',
        className,
      )}
      aria-label={title}
    >
      <div className="mb-4 flex items-center gap-2.5 border-b pb-2.5">
        <span
          className={cn('grid size-8 shrink-0 place-items-center rounded-lg', TONES[tone])}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <h2 className="text-muted-foreground text-[11px] font-bold tracking-[0.09em] uppercase">
          {title}
        </h2>
        {live ? (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
            {t('liveBadge')}
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">{children}</div>

      {footNote ?? action ? (
        <div className="text-muted-foreground mt-3.5 flex items-center gap-2 border-t pt-2.5 text-xs">
          {footNote ? <span className="min-w-0 truncate">{footNote}</span> : null}
          {action ? (
            <Link
              href={action.href}
              className="text-primary ms-auto inline-flex shrink-0 items-center gap-1 font-semibold hover:underline"
            >
              {action.label}
              <ArrowRight className="size-3 rtl:hidden" aria-hidden />
              <ArrowLeft className="hidden size-3 rtl:block" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
