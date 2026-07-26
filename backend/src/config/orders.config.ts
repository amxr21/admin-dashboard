import { DeliveryStatus, OrderStatus } from '@prisma/client';

/**
 * Order lifecycle rules.
 *
 * ─── WHY THIS IS CONFIG AND THE HANDLER IS NOT ───────────────────────
 * "Which status may follow which" is a TABLE — data, with no sequencing,
 * conditionals or side effects in it. It belongs here, where it can be read at
 * a glance and changed without touching a query.
 *
 * What happens *when* a status changes is not: it writes an audit row, may
 * touch the delivery assignment, and all of it has to be one transaction.
 * Expressing that here would mean inventing syntax for "then", "if" and "roll
 * back" — i.e. a worse programming language than the one we already have.
 * That line is the whole reason orders is bespoke rather than a config entry.
 */

/**
 * Legal next states. An empty array is terminal.
 *
 * Deliberately NOT symmetric: a delivered order can be returned, but a
 * returned one cannot go back to delivered. Undoing a mistake is a new order
 * or a credit note, not a status rewind — otherwise history stops being a
 * record of what happened.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPED, OrderStatus.CANCELED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.RETURNED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
  [OrderStatus.CANCELED]: [],
  [OrderStatus.RETURNED]: [],
};

/**
 * How an order status change propagates to an existing delivery assignment.
 *
 * Only the two forward states map. `DeliveryStatus` has no cancelled or
 * returned member, so a cancelled order CANNOT have that reflected on its
 * assignment — there is no value to write. Rather than inventing one here or
 * silently leaving the courier with a live job, the gap is left explicit and
 * belongs to group D, which owns the courier side.
 */
export const ASSIGNMENT_ON_ORDER_STATUS: Partial<Record<OrderStatus, DeliveryStatus>> = {
  [OrderStatus.SHIPPED]: DeliveryStatus.OUT_FOR_DELIVERY,
  [OrderStatus.DELIVERED]: DeliveryStatus.DELIVERED,
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** What the UI may offer from here. Empty means the order is finished. */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}
