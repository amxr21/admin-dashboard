import { describe, expect, it } from 'vitest';

import {
  buildOrderSteps,
  isFinalOrder,
  planStatusActions,
} from '../order-status-flow';
import type { OrderStatus, OrderStatusEntry } from '../orders-api';

const PLACED = '2026-07-01T10:00:00.000Z';

function entry(
  fromStatus: OrderStatus | null,
  toStatus: OrderStatus,
  createdAt: string,
  changedByName: string | null = 'Sara',
): OrderStatusEntry {
  return {
    id: `${fromStatus}-${toStatus}`,
    fromStatus,
    toStatus,
    note: null,
    changedById: 'u1',
    changedByName,
    createdAt,
  };
}

const states = (steps: ReturnType<typeof buildOrderSteps>) =>
  steps.map((step) => `${step.status}:${step.state}`);

describe('buildOrderSteps', () => {
  it('marks a new order current, with CONFIRMED as the next step', () => {
    const steps = buildOrderSteps({ status: 'PENDING', placedAt: PLACED, statusHistory: [] });

    expect(states(steps)).toEqual([
      'PENDING:current',
      'CONFIRMED:next',
      'SHIPPED:upcoming',
      'DELIVERED:upcoming',
    ]);
    // PENDING is "when it was placed", not a move anybody made.
    expect(steps[0]).toMatchObject({ at: PLACED, by: null });
  });

  it('dates each passed step from the move INTO it', () => {
    const steps = buildOrderSteps({
      status: 'SHIPPED',
      placedAt: PLACED,
      statusHistory: [
        entry('PENDING', 'CONFIRMED', '2026-07-01T11:00:00.000Z', 'Sara'),
        entry('CONFIRMED', 'SHIPPED', '2026-07-01T15:00:00.000Z', 'Omar'),
      ],
    });

    expect(states(steps)).toEqual([
      'PENDING:done',
      'CONFIRMED:done',
      'SHIPPED:current',
      'DELIVERED:next',
    ]);
    expect(steps[1]).toMatchObject({ at: '2026-07-01T11:00:00.000Z', by: 'Sara' });
    expect(steps[2]).toMatchObject({ at: '2026-07-01T15:00:00.000Z', by: 'Omar' });
    expect(steps[3]).toMatchObject({ at: null, by: null });
  });

  it('finishes the path on DELIVERED instead of leaving it "current"', () => {
    const steps = buildOrderSteps({ status: 'DELIVERED', placedAt: PLACED, statusHistory: [] });

    expect(states(steps).at(-1)).toBe('DELIVERED:complete');
  });

  it('stops a canceled order where it left the path', () => {
    const steps = buildOrderSteps({
      status: 'CANCELED',
      placedAt: PLACED,
      statusHistory: [
        entry('PENDING', 'CONFIRMED', '2026-07-01T11:00:00.000Z'),
        entry('CONFIRMED', 'CANCELED', '2026-07-01T12:00:00.000Z', 'Sara'),
      ],
    });

    // Never drawn as if it had shipped or been delivered.
    expect(states(steps)).toEqual(['PENDING:done', 'CONFIRMED:done', 'CANCELED:canceled']);
    expect(steps.at(-1)).toMatchObject({ at: '2026-07-01T12:00:00.000Z', by: 'Sara' });
  });

  it('draws a return from CONFIRMED without inventing SHIPPED or DELIVERED', () => {
    const steps = buildOrderSteps({
      status: 'RETURNED',
      placedAt: PLACED,
      statusHistory: [
        entry('PENDING', 'CONFIRMED', '2026-07-01T11:00:00.000Z'),
        entry('CONFIRMED', 'RETURNED', '2026-07-02T11:00:00.000Z'),
      ],
    });

    expect(states(steps)).toEqual(['PENDING:done', 'CONFIRMED:done', 'RETURNED:returned']);
  });

  it('falls back to PENDING for an exited order with no recorded history', () => {
    // An order that predates status history: nothing says how far it got, so
    // it is not drawn any further than being placed.
    const steps = buildOrderSteps({ status: 'CANCELED', placedAt: PLACED, statusHistory: [] });

    expect(states(steps)).toEqual(['PENDING:done', 'CANCELED:canceled']);
    expect(steps.at(-1)).toMatchObject({ at: null, by: null });
  });

  it('keeps a deleted account anonymous rather than dropping the step', () => {
    const steps = buildOrderSteps({
      status: 'CONFIRMED',
      placedAt: PLACED,
      statusHistory: [entry('PENDING', 'CONFIRMED', '2026-07-01T11:00:00.000Z', null)],
    });

    expect(steps[1]).toMatchObject({ state: 'current', at: '2026-07-01T11:00:00.000Z', by: null });
  });
});

describe('a pickup order', () => {
  it('is drawn readied and collected, never shipped', () => {
    const steps = buildOrderSteps({
      status: 'READY_FOR_PICKUP',
      fulfillment: 'PICKUP',
      placedAt: PLACED,
      statusHistory: [
        entry('PENDING', 'CONFIRMED', '2026-07-01T11:00:00.000Z'),
        entry('CONFIRMED', 'READY_FOR_PICKUP', '2026-07-01T12:00:00.000Z'),
      ],
    });

    expect(states(steps)).toEqual([
      'PENDING:done',
      'CONFIRMED:done',
      'READY_FOR_PICKUP:current',
      'COLLECTED:next',
    ]);
  });

  it('finishes the path on COLLECTED', () => {
    const steps = buildOrderSteps({ status: 'COLLECTED', fulfillment: 'PICKUP', placedAt: PLACED, statusHistory: [] });

    expect(steps.at(-1)).toMatchObject({ status: 'COLLECTED', state: 'complete' });
  });

  it('is shown its own path before anything has happened to it', () => {
    const steps = buildOrderSteps({ status: 'PENDING', fulfillment: 'PICKUP', placedAt: PLACED, statusHistory: [] });

    expect(steps.map((step) => step.status)).toEqual(['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COLLECTED']);
  });

  it('stops where a no-show was canceled', () => {
    const steps = buildOrderSteps({
      status: 'CANCELED',
      fulfillment: 'PICKUP',
      placedAt: PLACED,
      statusHistory: [
        entry('PENDING', 'CONFIRMED', '2026-07-01T11:00:00.000Z'),
        entry('CONFIRMED', 'READY_FOR_PICKUP', '2026-07-01T12:00:00.000Z'),
        entry('READY_FOR_PICKUP', 'CANCELED', '2026-07-03T12:00:00.000Z'),
      ],
    });

    expect(states(steps)).toEqual([
      'PENDING:done',
      'CONFIRMED:done',
      'READY_FOR_PICKUP:done',
      'CANCELED:canceled',
    ]);
  });

  it('is recognised by its history when the order never recorded a fulfillment', () => {
    const steps = buildOrderSteps({
      status: 'READY_FOR_PICKUP',
      fulfillment: null,
      placedAt: PLACED,
      statusHistory: [entry('CONFIRMED', 'READY_FOR_PICKUP', '2026-07-01T12:00:00.000Z')],
    });

    expect(steps.map((step) => step.status)).toContain('COLLECTED');
  });

  it('offers collection as the one primary move once it is ready', () => {
    expect(planStatusActions(['COLLECTED', 'CANCELED'])).toEqual({
      forward: 'COLLECTED',
      secondary: 'CANCELED',
      overflow: [],
    });
  });
});

describe('planStatusActions', () => {
  it('PENDING: confirm is primary, cancel sits beside it', () => {
    expect(planStatusActions(['CONFIRMED', 'CANCELED'])).toEqual({
      forward: 'CONFIRMED',
      secondary: 'CANCELED',
      overflow: [],
    });
  });

  it('CONFIRMED: the rarer return goes behind the overflow, never a third button', () => {
    expect(planStatusActions(['SHIPPED', 'CANCELED', 'RETURNED'])).toEqual({
      forward: 'SHIPPED',
      secondary: 'CANCELED',
      overflow: ['RETURNED'],
    });
  });

  it('SHIPPED: return takes the secondary slot once cancel is no longer legal', () => {
    expect(planStatusActions(['DELIVERED', 'RETURNED'])).toEqual({
      forward: 'DELIVERED',
      secondary: 'RETURNED',
      overflow: [],
    });
  });

  it('DELIVERED: no forward move left', () => {
    expect(planStatusActions(['RETURNED'])).toEqual({
      forward: null,
      secondary: 'RETURNED',
      overflow: [],
    });
  });

  it('never offers a move the server did not send', () => {
    const plan = planStatusActions(['SHIPPED']);

    expect(plan).toEqual({ forward: 'SHIPPED', secondary: null, overflow: [] });
  });

  it('reads an empty list as final', () => {
    const plan = planStatusActions([]);

    expect(isFinalOrder(plan)).toBe(true);
    expect(isFinalOrder(planStatusActions(['RETURNED']))).toBe(false);
  });
});
