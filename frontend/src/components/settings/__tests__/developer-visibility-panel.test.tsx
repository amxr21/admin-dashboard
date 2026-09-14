import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/render';
import { DeveloperVisibilityPanel } from '../developer-visibility-panel';

const fetchDeveloperVisibility = vi.hoisted(() => vi.fn());
const setDeveloperVisibility = vi.hoisted(() => vi.fn());
let role: 'OWNER' | 'DEVELOPER' = 'OWNER';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'owner-1', name: 'Owner', email: 'owner@example.test', role } }),
}));

vi.mock('@/lib/roles-api', () => ({ fetchDeveloperVisibility, setDeveloperVisibility }));

beforeEach(() => {
  role = 'OWNER';
  fetchDeveloperVisibility.mockReset();
  setDeveloperVisibility.mockReset();
  fetchDeveloperVisibility.mockResolvedValue({
    areas: ['orders', 'products', 'customers', 'reports'],
    hiddenAreas: ['customers'],
  });
  setDeveloperVisibility.mockResolvedValue({
    areas: ['orders', 'products', 'customers', 'reports'],
    hiddenAreas: ['customers', 'products'],
  });
});

describe('DeveloperVisibilityPanel', () => {
  it('is owner-only and does not render for a developer', () => {
    role = 'DEVELOPER';
    render(<DeveloperVisibilityPanel />);
    expect(screen.queryByRole('heading', { name: /developer business area access/i })).not.toBeInTheDocument();
    expect(fetchDeveloperVisibility).not.toHaveBeenCalled();
  });

  it('loads area checkboxes and saves the selected hidden areas', async () => {
    const user = userEvent.setup();
    render(<DeveloperVisibilityPanel />);

    const products = await screen.findByRole('checkbox', { name: /products/i });
    expect(screen.getByRole('checkbox', { name: /customers/i })).toBeChecked();
    expect(products).not.toBeChecked();

    await user.click(products);
    await user.click(screen.getByRole('button', { name: /save visibility/i }));

    await waitFor(() => expect(setDeveloperVisibility).toHaveBeenCalledWith(['customers', 'products']));
    expect(await screen.findByRole('status')).toHaveTextContent('Visibility saved.');
  });

  it('explains that infrastructure access bypasses app visibility', async () => {
    render(<DeveloperVisibilityPanel />, { locale: 'ar' });
    expect(await screen.findByText(/بيانات النشر أو الخادم أو قاعدة البيانات/i)).toBeInTheDocument();
  });
});
