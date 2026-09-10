import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SuppliersTable } from '@/components/suppliers/suppliers-table';
import { render, screen } from '@/test/render';

const { fetchSuppliers, updateSupplier } = vi.hoisted(() => ({ fetchSuppliers: vi.fn(), updateSupplier: vi.fn() }));
vi.mock('@/lib/suppliers-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/suppliers-api')>()), fetchSuppliers, updateSupplier,
}));

beforeEach(() => {
  vi.clearAllMocks();
  fetchSuppliers.mockResolvedValue({ suppliers: [{
    id: 's1', name: 'Foods Co', email: 'orders@foods.example', phone: '+971500000000',
    contactName: 'Mina', note: null, isActive: true, receiptCount: 7, productCount: 3,
    lastReceivedAt: '2026-09-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  }], total: 1, page: 1, pageSize: 20, totalPages: 1 });
});

describe('supplier directory', () => {
  it('shows receipt-derived supplier context and contact details', async () => {
    render(<SuppliersTable />);
    expect(await screen.findByText('Foods Co')).toBeInTheDocument();
    expect(screen.getByText('orders@foods.example')).toHaveClass('force-ltr');
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
