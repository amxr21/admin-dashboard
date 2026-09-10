import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { SupplierOutreachSheet } from '@/components/suppliers/supplier-outreach-sheet';
import { render, screen, waitFor } from '@/test/render';
import type { InventoryRow } from '@/lib/inventory-api';

const { fetchProductSuppliers, sendSupplierOutreach } = vi.hoisted(() => ({
  fetchProductSuppliers: vi.fn(), sendSupplierOutreach: vi.fn(),
}));
vi.mock('@/lib/suppliers-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/suppliers-api')>()),
  fetchProductSuppliers, sendSupplierOutreach,
}));

const product: InventoryRow = {
  id: 'p1', name: 'Oat milk', sku: 'OAT-1', stock: 2, status: 'ACTIVE', imageUrl: null,
  category: null, cost: '4.00', lowStockThreshold: 5, storageLocation: null,
  isLow: true, effectiveThreshold: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchProductSuppliers.mockResolvedValue({ product: { id: 'p1', name: 'Oat milk' }, suppliers: [{
    id: 's1', name: 'Foods Co', email: 'orders@foods.example', phone: null,
    contactName: null, isActive: true, lastReceivedAt: '2026-09-01T00:00:00Z',
  }] });
});

describe('supplier outreach', () => {
  it('prefills editable content and sends the reviewed values', async () => {
    sendSupplierOutreach.mockResolvedValue({ sent: true, supplier: { id: 's1', name: 'Foods Co', email: 'orders@foods.example' } });
    const onSent = vi.fn();
    render(<SupplierOutreachSheet product={product} onOpenChange={vi.fn()} onSent={onSent} />);

    const message = await screen.findByLabelText('Message');
    expect((message as HTMLTextAreaElement).value).toContain('2 units');
    await userEvent.clear(message);
    await userEvent.type(message, 'Please deliver 20 units Friday.');
    await userEvent.click(screen.getByRole('button', { name: 'Send email' }));

    await waitFor(() => expect(sendSupplierOutreach).toHaveBeenCalledWith('p1', expect.objectContaining({ supplierId: 's1', message: 'Please deliver 20 units Friday.' })));
    expect(onSent).toHaveBeenCalledWith('Foods Co');
  });

  it('explains when receipt history has no supplier', async () => {
    fetchProductSuppliers.mockResolvedValue({ product: { id: 'p1', name: 'Oat milk' }, suppliers: [] });
    render(<SupplierOutreachSheet product={product} onOpenChange={vi.fn()} onSent={vi.fn()} />);
    expect(await screen.findByText('No supplier history for this product')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send email' })).not.toBeInTheDocument();
  });

  it('renders the Arabic workflow in RTL', async () => {
    render(<SupplierOutreachSheet product={product} onOpenChange={vi.fn()} onSent={vi.fn()} />, { locale: 'ar' });
    expect(await screen.findByLabelText('الرسالة')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});
