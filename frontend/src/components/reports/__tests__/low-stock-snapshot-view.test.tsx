import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { LowStockSnapshotView } from '../low-stock-snapshot-view';

const fetchLowStockSnapshot = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchLowStockSnapshot, downloadReport };
});

beforeEach(() => {
  fetchLowStockSnapshot.mockReset();
  downloadReport.mockReset();
});

describe('low stock snapshot view (C3.5)', () => {
  it('lists low-stock products with the live threshold, no date range control', async () => {
    fetchLowStockSnapshot.mockResolvedValue({
      threshold: 5,
      products: [{ productId: 'p1', name: 'Widget', sku: 'W-1', stock: 2, daysSinceLastRestock: 10 }],
    });

    render(<LowStockSnapshotView />);

    expect(await screen.findByText('Widget')).toBeInTheDocument();
    expect(fetchLowStockSnapshot).toHaveBeenCalledWith();
  });

  it('shows "never restocked" for a null daysSinceLastRestock, not a fabricated 0', async () => {
    fetchLowStockSnapshot.mockResolvedValue({
      threshold: 5,
      products: [{ productId: 'p1', name: 'Widget', sku: 'W-1', stock: 0, daysSinceLastRestock: null }],
    });

    render(<LowStockSnapshotView />);

    expect(await screen.findByText(/never recorded as restocked/i)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is low on stock', async () => {
    fetchLowStockSnapshot.mockResolvedValue({ threshold: 5, products: [] });

    render(<LowStockSnapshotView />);

    expect(await screen.findByText(/nothing is low on stock/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchLowStockSnapshot.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<LowStockSnapshotView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
