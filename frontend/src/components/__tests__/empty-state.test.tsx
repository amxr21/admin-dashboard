import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Users } from 'lucide-react';

import { render, screen } from '@/test/render';
import { EmptyState } from '../empty-state';

/**
 * The genuinely-empty state (no rows exist at all) — distinct from a
 * search/filter "no results", which stays plain text elsewhere and never
 * renders this component (see resource-table.tsx / staff-table.tsx / and the
 * dedicated test below for one real wiring site).
 */

describe('EmptyState', () => {
  it('renders the default icon, title, and no action when none is given', () => {
    render(<EmptyState title="Nothing here yet" />);

    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a description when given', () => {
    render(<EmptyState title="No couriers yet" description="Add your first courier to get started." />);

    expect(screen.getByText('Add your first courier to get started.')).toBeInTheDocument();
  });

  it('renders no description when omitted', () => {
    render(<EmptyState title="No couriers yet" />);

    expect(screen.queryByText(/get started/i)).not.toBeInTheDocument();
  });

  it('renders a custom icon in place of the default', () => {
    const { container } = render(<EmptyState icon={Users} title="No staff yet" />);

    expect(container.querySelector('.lucide-users')).toBeInTheDocument();
  });

  it('renders an action and fires its callback on click', async () => {
    const onClick = vi.fn();
    render(
      <EmptyState title="No products yet" action={{ label: 'Add product', onClick }} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add product' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
