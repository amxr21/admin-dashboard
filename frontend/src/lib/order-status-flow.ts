import type { OrderDetail, OrderStatus } from '@/lib/orders-api';

/**
 * How an order's lifecycle reads on the detail page: the progress steps it has
 * been through, and which moves to offer next.
 *
 * ─── NO SECOND COPY OF THE TRANSITION TABLE ──────────────────────────
 * Which moves are legal comes from the server (`order.nextStatuses`, built
 * from orders.config.ts). `planStatusActions` only decides how to PRESENT
 * that list — it never adds a move the server didn't send, so a button can't
 * look legal and then 400.
 *
 * `ORDER_PATH` is presentation too: the happy path drawn as a stepper. The
 * two exits (CANCELED, RETURNED) are drawn where the order actually left the
 * path, read from its status history.
 */

/** The forward path, in order. CANCELED and RETURNED leave it; they are not steps on it. */
export const ORDER_PATH = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED'] as const satisfies readonly OrderStatus[];

export type OrderStepState =
  /** Passed through. */
  | 'done'
  /** Where the order is now, still moving. */
  | 'current'
  /** The step right after the current one — labelled "Next step". */
  | 'next'
  /** Further ahead than the next step. */
  | 'upcoming'
  /** DELIVERED reached: the path is finished. */
  | 'complete'
  /** The order left the path here. */
  | 'canceled'
  | 'returned';

export interface OrderStep {
  status: OrderStatus;
  state: OrderStepState;
  /** When the order reached this step; null for a step it hasn't reached. */
  at: string | null;
  /** Who moved it here. Null for PENDING (the order was placed, nobody moved it)
   *  and for an account that has since been deleted. */
  by: string | null;
}

type StepSource = Pick<OrderDetail, 'status' | 'placedAt' | 'statusHistory'>;

function lastEntryInto(order: StepSource, status: OrderStatus) {
  return order.statusHistory.findLast((entry) => entry.toStatus === status) ?? null;
}

function reached(order: StepSource, status: OrderStatus, state: OrderStepState): OrderStep {
  if (status === 'PENDING') return { status, state, at: order.placedAt, by: null };

  const entry = lastEntryInto(order, status);
  return { status, state, at: entry?.createdAt ?? null, by: entry?.changedByName ?? null };
}

function pathIndex(status: OrderStatus | null | undefined): number {
  return status ? (ORDER_PATH as readonly OrderStatus[]).indexOf(status) : -1;
}

/**
 * The furthest point on the path an exited (canceled or returned) order got
 * to. Normally that is the `fromStatus` of the move that took it off the path.
 * An order with no recorded history falls back to the furthest step its
 * history mentions, and then to PENDING, rather than guessing it got further.
 */
function exitPoint(order: StepSource): number {
  const exit = lastEntryInto(order, order.status);
  const fromExit = pathIndex(exit?.fromStatus);
  if (fromExit >= 0) return fromExit;

  const furthest = Math.max(-1, ...order.statusHistory.map((entry) => pathIndex(entry.toStatus)));
  return Math.max(0, furthest);
}

export function buildOrderSteps(order: StepSource): OrderStep[] {
  const current = pathIndex(order.status);

  if (current >= 0) {
    return ORDER_PATH.map((status, index) => {
      if (index < current) return reached(order, status, 'done');
      if (index === current) {
        return reached(order, status, status === 'DELIVERED' ? 'complete' : 'current');
      }
      return { status, state: index === current + 1 ? 'next' : 'upcoming', at: null, by: null };
    });
  }

  // CANCELED or RETURNED: the steps it actually passed, then the exit.
  const passed = ORDER_PATH.slice(0, exitPoint(order) + 1).map((status) =>
    reached(order, status, 'done'),
  );
  const exitState: OrderStepState = order.status === 'CANCELED' ? 'canceled' : 'returned';
  return [...passed, reached(order, order.status, exitState)];
}

export interface StatusActionPlan {
  /** The next step along the path: the page's one primary button. */
  forward: OrderStatus | null;
  /** Shown beside it. Cancel when that's legal, otherwise a return. */
  secondary: 'CANCELED' | 'RETURNED' | null;
  /** Anything else still legal, behind a "more" menu. Only ever a return today
   *  (CONFIRMED can be canceled OR returned), but kept general. */
  overflow: OrderStatus[];
}

export function planStatusActions(nextStatuses: readonly OrderStatus[]): StatusActionPlan {
  const forward = nextStatuses.find((status) => status !== 'CANCELED' && status !== 'RETURNED') ?? null;
  const secondary = nextStatuses.includes('CANCELED')
    ? 'CANCELED'
    : nextStatuses.includes('RETURNED')
      ? 'RETURNED'
      : null;
  const overflow = nextStatuses.filter((status) => status !== forward && status !== secondary);

  return { forward, secondary, overflow };
}

export function isFinalOrder(plan: StatusActionPlan): boolean {
  return plan.forward === null && plan.secondary === null && plan.overflow.length === 0;
}
