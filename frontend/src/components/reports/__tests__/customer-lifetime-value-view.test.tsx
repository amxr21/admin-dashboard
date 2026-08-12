import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { CustomerLifetimeValueView } from '../customer-lifetime-value-view';

const fetchCustomerLifetimeValue = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchCustomerLifetimeValue, downloadReport };
});

beforeEach(() => {
  fetchCustomerLifetimeValue.mockReset();
  downloadReport.mockReset();
});

describe('customer lifetime value view (C3.5)', () => {
  it('lists customers ranked by all-time revenue, with no date range control', async () => {
    fetchCustomerLifetimeValue.mockResolvedValue({
      customers: [
        { customerId: 'c1', name: 'Amina Yusuf', email: 'amina@example.test', revenue: '900.00', orders: 6, averageOrderValue: '150.00' },
      ],
    });

    render(<CustomerLifetimeValueView />);

    expect(await screen.findByText('Amina Yusuf')).toBeInTheDocument();
    expect(fetchCustomerLifetimeValue).toHaveBeenCalledWith();
  });

  it('surfaces a load failure', async () => {
    fetchCustomerLifetimeValue.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CustomerLifetimeValueView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
