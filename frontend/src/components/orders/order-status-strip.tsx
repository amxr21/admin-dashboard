'use client';

import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check, Ellipsis, Lock, RotateCcw, Truck, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  buildOrderSteps,
  isFinalOrder,
  planStatusActions,
  type OrderStep,
  type OrderStepState,
} from '@/lib/order-status-flow';
import type { OrderDetail, OrderStatus } from '@/lib/orders-api';
import { cn } from '@/lib/utils';

/**
 * Where the order is in its lifecycle, and the move to make next.
 *
 * This replaced the "Move to" select + Apply button + note field that used to
 * sit in the page header. The stepper answers "where is it?" at a glance; the
 * next move is ONE primary button named as a verb ("Mark as shipped"), and a
 * cancellation is its own, visibly destructive button rather than one more
 * option in the same list as the forward move.
 *
 * Everything offered still comes from the server's `nextStatuses` — see
 * `planStatusActions`. Clicking a button only opens the confirm dialog; the
 * page owns that dialog, because on a phone the same buttons live in a bar
 * pinned to the bottom of the page instead of in this strip.
 */

const REACHED: OrderStepState[] = ['done', 'current', 'complete', 'canceled', 'returned'];

interface OrderStatusStripProps {
  order: OrderDetail;
  /** The action cluster, or null when the page shows it elsewhere (the phone bar). */
  actions: ReactNode;
  /** Phone width: shorter dates, no names under the steps. */
  compact?: boolean;
}

export function OrderStatusStrip({ order, actions, compact = false }: OrderStatusStripProps) {
  const t = useTranslations('orders.statusControl');

  return (
    <section
      aria-label={t('progress')}
      className="bg-card flex flex-col gap-4 rounded-lg border p-4 md:flex-row md:items-center md:gap-6 md:px-5"
    >
      <OrderStepper steps={buildOrderSteps(order)} compact={compact} />
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </section>
  );
}

function OrderStepper({ steps, compact }: { steps: OrderStep[]; compact: boolean }) {
  const t = useTranslations('orders.statusControl');
  const tStatus = useTranslations('orderStatus');
  const formatter = useFormatter();

  function when(step: OrderStep): string | null {
    if (!step.at) return step.state === 'next' ? t('nextStep') : null;
    const date = formatter.dateTime(
      new Date(step.at),
      compact ? { day: 'numeric', month: 'short' } : { dateStyle: 'medium', timeStyle: 'short' },
    );
    return step.by && !compact ? `${date} · ${step.by}` : date;
  }

  return (
    <ol className="flex min-w-0 flex-1">
      {steps.map((step, index) => {
        const next = steps[index + 1];
        const lineReached = next ? REACHED.includes(next.state) : false;
        const quiet = step.state === 'next' || step.state === 'upcoming';
        const sub = when(step);

        return (
          <li
            key={step.status}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className="flex min-w-0 flex-1 flex-col gap-2"
          >
            <div className="flex items-center gap-1.5 md:gap-2">
              <StepNode state={step.state} />
              {next ? (
                <span
                  aria-hidden
                  className={cn(
                    'me-1.5 h-0.5 flex-1 rounded-full md:me-2',
                    lineReached ? 'bg-primary' : 'bg-border',
                  )}
                />
              ) : null}
            </div>
            <div className="min-w-0 pe-2 md:pe-4">
              <p
                className={cn(
                  'text-xs leading-4 md:text-sm md:leading-5',
                  quiet && 'text-muted-foreground',
                  step.state === 'current' ? 'font-semibold' : 'font-medium',
                  step.state === 'canceled' && 'text-destructive',
                )}
              >
                {tStatus(step.status)}
                {step.state === 'done' || step.state === 'complete' ? (
                  <span className="sr-only"> ({t('stepDone')})</span>
                ) : null}
              </p>
              {sub ? (
                <p className="text-muted-foreground mt-0.5 text-xs leading-4">
                  {step.at ? <time dateTime={step.at}>{sub}</time> : sub}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepNode({ state }: { state: OrderStepState }) {
  const base = 'flex size-5 shrink-0 items-center justify-center rounded-full md:size-6';
  // Check, X and the return arrow are symbols, not directions — never mirrored.
  switch (state) {
    case 'done':
      return (
        <span className={cn(base, 'bg-primary text-primary-foreground')}>
          <Check aria-hidden className="size-3.5" strokeWidth={3} />
        </span>
      );
    case 'complete':
      return (
        <span className={cn(base, 'bg-success text-success-foreground')}>
          <Check aria-hidden className="size-3.5" strokeWidth={3} />
        </span>
      );
    case 'current':
      return (
        <span className={cn(base, 'border-primary bg-card border-2')}>
          <span className="bg-primary size-2 rounded-full" />
        </span>
      );
    case 'canceled':
      return (
        <span className={cn(base, 'bg-destructive text-destructive-foreground')}>
          <X aria-hidden className="size-3.5" strokeWidth={3} />
        </span>
      );
    case 'returned':
      return (
        <span className={cn(base, 'border-muted-foreground bg-muted text-muted-foreground border-2')}>
          <RotateCcw aria-hidden className="size-3" strokeWidth={2.5} />
        </span>
      );
    default:
      return <span className={cn(base, 'border-border bg-card border-2')} />;
  }
}

interface OrderStatusActionsProps {
  order: OrderDetail;
  /** Opens the confirm dialog — or, for RETURNED, the returns flow. */
  onStart: (status: OrderStatus) => void;
  /** The phone bar: buttons share the width and meet the 44px touch target. */
  fill?: boolean;
}

export function OrderStatusActions({ order, onStart, fill = false }: OrderStatusActionsProps) {
  const t = useTranslations('orders.statusControl');
  const tStatus = useTranslations('orderStatus');
  const plan = planStatusActions(order.nextStatuses);
  const { forward, secondary, overflow } = plan;

  if (isFinalOrder(plan)) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Lock aria-hidden className="size-3.5 shrink-0" />
        {t('terminal', { status: tStatus(order.status) })}
      </p>
    );
  }

  const size = fill ? 'lg' : 'default';
  const grow = fill ? 'h-11 flex-1' : undefined;

  return (
    <>
      {overflow.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={fill ? 'size-11' : undefined} aria-label={t('more')}>
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((status) => (
              <DropdownMenuItem key={status} onSelect={() => onStart(status)}>
                {t(`actions.${status}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {secondary === 'CANCELED' ? (
        <Button
          variant="outline"
          size={size}
          className={cn('text-destructive hover:text-destructive', grow)}
          onClick={() => onStart('CANCELED')}
        >
          {t('actions.CANCELED')}
        </Button>
      ) : secondary === 'RETURNED' ? (
        <Button variant="outline" size={size} className={grow} onClick={() => onStart('RETURNED')}>
          <RotateCcw aria-hidden />
          {t('actions.RETURNED')}
        </Button>
      ) : null}

      {forward ? (
        <Button size={size} className={grow} onClick={() => onStart(forward)}>
          {/* A truck means "in motion", so it is directional and mirrors. */}
          {forward === 'SHIPPED' ? (
            <Truck aria-hidden className="rtl:-scale-x-100" />
          ) : (
            <Check aria-hidden />
          )}
          {t(`actions.${forward}`)}
        </Button>
      ) : null}
    </>
  );
}
