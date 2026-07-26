import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/render';
import { StatusBadge } from '../status-badge';

/**
 * StatusBadge is the single place enum → label and enum → colour live. If it
 * regresses, every table in the app renders raw `SCREAMING_CASE` or the wrong
 * tone, and both are the kind of thing that ships unnoticed.
 */

describe('translation', () => {
  it('renders the English label, never the raw enum', () => {
    render(<StatusBadge kind="orderStatus" value="DELIVERED" />);

    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.queryByText('DELIVERED')).not.toBeInTheDocument();
  });

  it('renders the Arabic label', () => {
    render(<StatusBadge kind="orderStatus" value="DELIVERED" />, { locale: 'ar' });

    expect(screen.getByText('تم التسليم')).toBeInTheDocument();
  });

  it('translates every enum kind', () => {
    // Catches a namespace added to the tone map but not to the catalogues.
    const cases = [
      ['orderStatus', 'PENDING', 'Pending'],
      ['productStatus', 'ACTIVE', 'Active'],
      ['reviewStatus', 'APPROVED', 'Approved'],
      ['deliveryStatus', 'OUT_FOR_DELIVERY', 'Out for delivery'],
      ['deliveryStaffStatus', 'ON_SHIFT', 'On shift'],
      ['roles', 'DEMO', 'Demo (read-only)'],
    ] as const;

    for (const [kind, value, expected] of cases) {
      const { unmount } = render(<StatusBadge kind={kind} value={value} />);
      expect(screen.getByText(expected), `${kind}.${value}`).toBeInTheDocument();
      unmount();
    }
  });

  it('falls back to the raw value for an unknown status', () => {
    // An enum added to the API before the frontend knows about it should
    // degrade to showing something, not crash the page.
    render(<StatusBadge kind="orderStatus" value="SOME_NEW_STATUS" />);

    expect(screen.getByText('SOME_NEW_STATUS')).toBeInTheDocument();
  });
});

describe('tone mapping', () => {
  function toneOf(kind: 'orderStatus' | 'roles', value: string): string {
    const { container } = render(<StatusBadge kind={kind} value={value} />);
    return container.querySelector('[data-slot="badge"]')?.className ?? '';
  }

  it('uses success for a completed order', () => {
    expect(toneOf('orderStatus', 'DELIVERED')).toContain('success');
  });

  it('uses warning for a waiting order', () => {
    expect(toneOf('orderStatus', 'PENDING')).toContain('warning');
  });

  it('uses destructive for a cancelled order', () => {
    expect(toneOf('orderStatus', 'CANCELED')).toContain('destructive');
  });

  it('does NOT use destructive for a returned order', () => {
    // A return is a normal completed business outcome, not an error. Red here
    // makes healthy returns read as failures at a glance.
    expect(toneOf('orderStatus', 'RETURNED')).not.toContain('destructive');
  });

  it('makes the demo role visually distinct', () => {
    // Anyone scanning a staff list should be able to tell instantly that an
    // account cannot write.
    const demo = toneOf('roles', 'DEMO');
    const manager = toneOf('roles', 'MANAGER');

    expect(demo).not.toBe(manager);
    expect(demo).toContain('warning');
  });

  it('falls back to a neutral tone for an unknown value', () => {
    expect(toneOf('orderStatus', 'UNKNOWN')).toContain('muted');
  });
});
