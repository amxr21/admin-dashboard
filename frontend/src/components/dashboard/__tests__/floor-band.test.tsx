import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/render';
import { FloorBand } from '../floor-band';
import type { FloorStatus } from '@/lib/reports-api';

const quietFloor: FloorStatus = {
  openShifts: [],
  recentlyClosed: [],
  totals: {
    onShift: 0,
    branches: 0,
    taken: '0.00',
    salesCount: 0,
    expectedInDrawers: '0.00',
    noSaleCount: 0,
    voidCount: 0,
  },
};

describe('FloorBand', () => {
  it('collapses an unused floor into one compact empty state', () => {
    render(<FloorBand data={quietFloor} template="combo" />);

    expect(screen.getByRole('region', { name: 'On the floor now' })).toBeInTheDocument();
    expect(screen.getByText('No tills are open right now.')).toBeInTheDocument();
    expect(screen.queryByText('Taken today')).not.toBeInTheDocument();
    expect(screen.queryByText('In drawers')).not.toBeInTheDocument();
  });

  it('keeps the compact empty behavior in Arabic', () => {
    render(<FloorBand data={quietFloor} template="combo" />, { locale: 'ar' });

    expect(screen.getByRole('region', { name: 'على الأرض الآن' })).toBeInTheDocument();
    expect(screen.getByText('لا توجد صناديق مفتوحة الآن.')).toBeInTheDocument();
  });
});
