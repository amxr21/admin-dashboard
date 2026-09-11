import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { CustomerCasesWorkspace } from '@/components/customer-cases/customer-cases-workspace';
import { render, screen, waitFor } from '@/test/render';

const { fetchCustomerCases, fetchCustomerCase, createCustomerCase, updateCustomerCase, addCustomerCaseNote, searchCaseLinkOptions } = vi.hoisted(() => ({
  fetchCustomerCases: vi.fn(), fetchCustomerCase: vi.fn(), createCustomerCase: vi.fn(),
  updateCustomerCase: vi.fn(), addCustomerCaseNote: vi.fn(), searchCaseLinkOptions: vi.fn(),
}));

vi.mock('@/lib/customer-cases-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/customer-cases-api')>()),
  fetchCustomerCases, fetchCustomerCase, createCustomerCase, updateCustomerCase,
  addCustomerCaseNote, searchCaseLinkOptions,
}));

const summary = {
  id: 'case-1', caseNumber: 'CASE-AB12', title: 'Damaged delivery', status: 'OPEN',
  priority: 'HIGH', branchId: 'branch-1', updatedAt: '2026-09-10T10:00:00.000Z',
  customer: { id: 'customer-1', name: 'Sara Ali', email: 'sara@example.test', phone: '+971501234567' },
  order: { id: 'order-1', orderNumber: 'ORD-1001', status: 'DELIVERED' },
  assignedTo: { id: 'user-1', name: 'Mina', email: 'mina@example.test' }, noteCount: 0,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  fetchCustomerCases.mockResolvedValue({ cases: [summary], total: 1, page: 1, pageSize: 20, totalPages: 1 });
  searchCaseLinkOptions.mockResolvedValue({ customers: [], orders: [], assignees: [] });
  createCustomerCase.mockResolvedValue({ ...summary, description: null, createdAt: summary.updatedAt, resolvedAt: null, notes: [] });
});

describe('customer cases workspace', () => {
  it('renders linked operational context and localized controls', async () => {
    render(<CustomerCasesWorkspace />);
    expect(await screen.findByText('Damaged delivery')).toBeInTheDocument();
    expect(screen.getByText('Sara Ali')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('ORD-1001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New case' })).toBeInTheDocument();
  });

  it('creates an unlinked case without requiring business-specific fields', async () => {
    render(<CustomerCasesWorkspace />);
    await screen.findByText('Damaged delivery');
    await userEvent.click(screen.getByRole('button', { name: 'New case' }));
    await userEvent.type(screen.getByLabelText('Title'), 'Customer asked for a callback');
    await userEvent.click(screen.getByRole('button', { name: 'Create case' }));
    await waitFor(() => expect(createCustomerCase).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Customer asked for a callback', priority: 'NORMAL',
    })));
  });
});
