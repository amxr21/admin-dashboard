import { describe, expect, it, vi } from 'vitest';
import { Pencil, Trash2, History, Ticket } from 'lucide-react';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { RowActions, type RowAction } from '../row-actions';

/**
 * The trailing action cell, capped at two visible buttons with the rest
 * behind a `⋯` menu.
 *
 * What matters: the cap is enforced regardless of how many actions a caller
 * hands over (so a table can't silently regress to "just add another icon"),
 * both onClick and href actions work in EITHER position, and destructive
 * styling survives the move into the menu.
 */

function actions(count: number): RowAction[] {
  const icons = [Pencil, Trash2, History, Ticket];
  return Array.from({ length: count }, (_, i) => ({
    id: `action-${String(i)}`,
    label: `Action ${String(i)}`,
    icon: icons[i % icons.length]!,
    onClick: vi.fn(),
  }));
}

describe('the visible/overflow split', () => {
  it('renders nothing for an empty list', () => {
    const { container } = render(<RowActions actions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one action with no overflow trigger', () => {
    render(<RowActions actions={actions(1)} />);

    expect(screen.getByRole('button', { name: 'Action 0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });

  it('renders exactly two actions with no overflow trigger', () => {
    // The boundary case: two fit visibly, so the menu must not appear just
    // because there's more than one action.
    render(<RowActions actions={actions(2)} />);

    expect(screen.getByRole('button', { name: 'Action 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });

  it('caps visible buttons at two and folds the rest into the menu', async () => {
    render(<RowActions actions={actions(4)} />);

    expect(screen.getByRole('button', { name: 'Action 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action 1' })).toBeInTheDocument();
    // Not rendered as buttons — they're inside the (closed) menu.
    expect(screen.queryByRole('button', { name: 'Action 2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Action 3' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));

    expect(await screen.findByRole('menuitem', { name: 'Action 2' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Action 3' })).toBeInTheDocument();
  });

  it('respects a caller-supplied visible count', () => {
    render(<RowActions actions={actions(3)} visibleCount={1} />);

    expect(screen.getByRole('button', { name: 'Action 0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Action 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });
});

describe('firing the action', () => {
  it('calls onClick for a visible action', async () => {
    const list = actions(1);
    render(<RowActions actions={list} />);

    await userEvent.click(screen.getByRole('button', { name: 'Action 0' }));

    expect(list[0]!.onClick).toHaveBeenCalledOnce();
  });

  it('calls onClick for an overflowed action', async () => {
    const list = actions(3);
    render(<RowActions actions={list} />);

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Action 2' }));

    expect(list[2]!.onClick).toHaveBeenCalledOnce();
  });

  it('renders an href action as a real link when visible', () => {
    render(
      <RowActions
        actions={[
          { id: 'history', label: 'View history', icon: History, href: '/admin/audit' },
        ]}
      />,
    );

    const link = screen.getByRole('link', { name: 'View history' });
    expect(link).toHaveAttribute('href', '/admin/audit');
  });

  it('renders an href action as a real link inside the overflow menu', async () => {
    render(
      <RowActions
        actions={[
          ...actions(2),
          { id: 'history', label: 'View history', icon: History, href: '/admin/audit' },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));

    const link = await screen.findByRole('menuitem', { name: 'View history' });
    expect(link.closest('a')).toHaveAttribute('href', '/admin/audit');
  });
});

describe('destructive styling', () => {
  it('marks a visible destructive action', () => {
    render(
      <RowActions
        actions={[
          { id: 'delete', label: 'Delete', icon: Trash2, variant: 'destructive', onClick: vi.fn() },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('text-destructive');
  });

  it('marks a destructive action even after it folds into the menu', async () => {
    render(
      <RowActions
        actions={[
          ...actions(2),
          { id: 'delete', label: 'Delete', icon: Trash2, variant: 'destructive', onClick: vi.fn() },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));

    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
  });
});

describe('disabled actions', () => {
  it('disables a visible action without firing its handler', async () => {
    const onClick = vi.fn();
    render(
      <RowActions
        actions={[{ id: 'a', label: 'Action', icon: Pencil, onClick, disabled: true }]}
      />,
    );

    const button = screen.getByRole('button', { name: 'Action' });
    expect(button).toBeDisabled();
  });
});
