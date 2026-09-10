import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { OrganizationFieldEditor } from '../organization-field-editor';
import { OrganizationProfileEditor } from '../organization-profile-editor';

const api = vi.hoisted(() => ({
  createOrganizationField: vi.fn(),
  updateOrganizationField: vi.fn(),
  fetchOrganizationProfile: vi.fn(),
  saveOrganizationProfile: vi.fn(),
}));

vi.mock('@/lib/organization-api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/organization-api')>(),
  ...api,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.createOrganizationField.mockResolvedValue({});
  api.updateOrganizationField.mockResolvedValue({});
  api.saveOrganizationProfile.mockResolvedValue({});
});

describe('OrganizationFieldEditor', () => {
  it('creates a typed field through the shared form controls', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<OrganizationFieldEditor entityType="staff" onSaved={onSaved} />);

    await user.type(screen.getByLabelText(/field label/i), 'Employee number');
    await user.click(screen.getByRole('checkbox', { name: /required/i }));
    await user.click(screen.getByRole('button', { name: /add field/i }));

    await waitFor(() => expect(api.createOrganizationField).toHaveBeenCalledWith({
      entityType: 'staff', label: 'Employee number', type: 'text', required: true,
    }));
    expect(onSaved).toHaveBeenCalledOnce();
  });
});

describe('OrganizationProfileEditor', () => {
  it('renders staff structure and custom dates without a native date input', async () => {
    api.fetchOrganizationProfile.mockResolvedValue({
      entityType: 'staff', entityId: 'staff-1', values: { 'field-date': '2026-09-10' },
      jobTitle: 'Supervisor', department: 'Retail', managerId: null,
    });

    const { container } = render(
      <OrganizationProfileEditor
        entityType="staff"
        entityId="staff-1"
        fields={[{ id: 'field-date', entityType: 'staff', label: 'Start date', type: 'date', required: false, isActive: true }]}
        staff={[{ id: 'staff-1', name: 'Current Person', isActive: true }, { id: 'staff-2', name: 'Manager Person', isActive: true }]}
        onSaved={vi.fn()}
      />,
    );

    expect(await screen.findByDisplayValue('Supervisor')).toBeInTheDocument();
    expect(screen.getByLabelText(/reports to/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start date/i })).toBeInTheDocument();
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });
});
