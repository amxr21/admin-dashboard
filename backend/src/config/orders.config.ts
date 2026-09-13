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
 *
 * ─── CONFIRMED → RETURNED: THE POINT-OF-SALE RETURN (owner-approved 2026-09-13)
 * A POS sale is created CONFIRMED and never ships or gets delivered — the
 * customer takes the item at the counter. Before this line, `RETURNED` was
 * reachable ONLY from SHIPPED/DELIVERED, so a walk-in customer bringing an item
 * back could not be served: the till return sheet's own `createReturn` /
 * `approveReturn` both call `canTransition(status, 'RETURNED')`, which was false
 * for a CONFIRMED sale — the whole feature 400'd on the most common physical
 * return. Allowing it here makes the till return sheet work.
 *
 * ─── THE ACCEPTED AMBIGUITY ──────────────────────────────────────────
 * `RETURNED` now means two things — a delivered mail order that came back, and
 * a counter sale that was returned. The owner accepted this over a separate
 * POS-returnable terminal state (which would have needed a migration and new
 * states). Readers of `RETURNED` must not assume a delivery ever happened: a
 * POS return has no `DeliveryAssignment` (the assignment write in
 * returns.service.ts is already guarded by `if (order.assignment)`), and the
 * returns report counts it the same as any other return, which is intended.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPED, OrderStatus.CANCELED, OrderStatus.RETURNED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.RETURNED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
  [OrderStatus.CANCELED]: [],
  [OrderStatus.RETURNED]: [],
};

/**
 * How an order status change propagates to an existing delivery assignment.
 *
 * ─── THE GAP GROUP B LEFT, NOW CLOSED ────────────────────────────────
 * `DeliveryStatus` originally had no cancelled or returned member, so a
 * cancelled order could not have that reflected on its assignment — there was
 * no value to write, and a courier kept a live job for an order that no longer
 * existed. That was documented here rather than papered over.
 *
 * Group D added the two terminal members, so the mapping is now total over
 * every order status that a courier needs to hear about.
 */
export const ASSIGNMENT_ON_ORDER_STATUS: Partial<Record<OrderStatus, DeliveryStatus>> = {
  [OrderStatus.SHIPPED]: DeliveryStatus.OUT_FOR_DELIVERY,
  [OrderStatus.DELIVERED]: DeliveryStatus.DELIVERED,
  // Stop the courier. Without these the job stayed live on their portal.
  [OrderStatus.CANCELED]: DeliveryStatus.CANCELED,
  [OrderStatus.RETURNED]: DeliveryStatus.RETURNED,
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** What the UI may offer from here. Empty means the order is finished. */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}
