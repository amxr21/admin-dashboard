import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { Link } from '@/i18n/navigation';
import { UnsavedChangesProvider } from '../unsaved-changes-provider';

function Fixture() {
  const [dirty, setDirty] = useState(true);
  useUnsavedChangesGuard(dirty);
  return (
    <UnsavedChangesProvider>
      <button onClick={() => setDirty(false)}>save</button>
      <Link href="/admin/orders">Orders</Link>
    </UnsavedChangesProvider>
  );
}

describe('in-app unsaved-change navigation', () => {
  it('blocks a normal internal link until the user confirms discard', async () => {
    const navigated = vi.fn();
    const observeLink = (event: Event) => {
      if ((event.target as Element | null)?.closest('a[href]')) {
        event.preventDefault();
        navigated();
      }
    };
    document.addEventListener('click', observeLink);
    render(<Fixture />);

    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(navigated).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(navigated).toHaveBeenCalledTimes(1);
    document.removeEventListener('click', observeLink);
  });

  it('does not intervene once the form is clean', async () => {
    const bubbled = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener('click', bubbled);
    render(<Fixture />);

    await userEvent.click(screen.getByRole('button', { name: 'save' }));
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(bubbled).toHaveBeenCalled();
    document.removeEventListener('click', bubbled);
  });
});
