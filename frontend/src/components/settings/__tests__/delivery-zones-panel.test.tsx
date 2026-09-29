import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/render';
import { DeliveryZonesPanel } from '../delivery-zones-panel';
import { normalizeDeliveryAmount } from '@/lib/delivery-zones-api';

const fetchDeliveryZones = vi.hoisted(() => vi.fn());
const saveDeliveryZone = vi.hoisted(() => vi.fn());
vi.mock('@/lib/delivery-zones-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/delivery-zones-api')>()),
  fetchDeliveryZones,
  saveDeliveryZone,
}));
const zone = {
  id: 'z1',
  code: 'central',
  name: 'Central area',
  fee: '15.00',
  freeDeliveryThreshold: null,
  isActive: true,
  sortOrder: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  fetchDeliveryZones.mockResolvedValue([]);
  saveDeliveryZone.mockImplementation(async (input: typeof zone) => ({ ...input, id: 'z1' }));
});

describe('DeliveryZonesPanel', () => {
  it('loads an empty state and saves exact decimal strings with a nullable threshold', async () => {
    render(<DeliveryZonesPanel />);
    expect(await screen.findByText(/no delivery areas yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /add delivery area/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Central area');
    await userEvent.type(screen.getByLabelText(/^code$/i), 'central');
    await userEvent.clear(screen.getByLabelText(/^delivery fee$/i));
    await userEvent.type(screen.getByLabelText(/^delivery fee$/i), '15.5');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(saveDeliveryZone).toHaveBeenCalledWith(
        {
          code: 'central',
          name: 'Central area',
          fee: '15.50',
          freeDeliveryThreshold: null,
          isActive: true,
          sortOrder: 0,
        },
        undefined,
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/delivery area saved/i);
  });

  it('keeps invalid precision in the form and does not issue a write', async () => {
    fetchDeliveryZones.mockResolvedValue([zone]);
    render(<DeliveryZonesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: /edit central area/i }));
    await userEvent.clear(screen.getByLabelText(/^delivery fee$/i));
    await userEvent.type(screen.getByLabelText(/^delivery fee$/i), '15.555');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/two decimal places/i);
    expect(saveDeliveryZone).not.toHaveBeenCalled();
  });

  it('edits an existing area and can deactivate it without deleting history', async () => {
    fetchDeliveryZones.mockResolvedValue([zone]);
    render(<DeliveryZonesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: /edit central area/i }));
    await userEvent.click(screen.getByRole('switch', { name: /^active$/i }));
    await userEvent.type(screen.getByLabelText(/^free delivery from$/i), '100');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(saveDeliveryZone).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false, freeDeliveryThreshold: '100.00' }),
        'z1',
      ),
    );
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
  });

  it('offers retry when the list cannot load', async () => {
    fetchDeliveryZones
      .mockRejectedValueOnce(new Error('Connection failed'))
      .mockResolvedValueOnce([zone]);
    render(<DeliveryZonesPanel />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(await screen.findByText('Central area')).toBeInTheDocument();
  });

  it('renders Arabic labels in RTL and isolates area codes', async () => {
    fetchDeliveryZones.mockResolvedValue([zone]);
    render(<DeliveryZonesPanel />, { locale: 'ar' });
    expect(await screen.findByRole('heading', { name: 'مناطق التوصيل' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect((await screen.findByText('central')).closest('bdi')).toHaveAttribute('dir', 'ltr');
  });

  it('normalizes decimal text without rounding money or accepting exponent notation', () => {
    expect(normalizeDeliveryAmount('9999999.99')).toBe('9999999.99');
    expect(normalizeDeliveryAmount('12.5')).toBe('12.50');
    expect(normalizeDeliveryAmount('0')).toBe('0.00');
    for (const input of ['1.001', '-1', '1e2', '10000000', ''])
      expect(normalizeDeliveryAmount(input)).toBeNull();
  });
});
