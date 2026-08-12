import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ColumnManager } from '../column-manager';

const COLUMNS = [
  { id: 'name', label: 'Name' },
  { id: 'sku', label: 'SKU' },
  { id: 'price', label: 'Price' },
];

describe('opening the menu', () => {
  it('lists every column with its current visibility', async () => {
    render(
      <ColumnManager
        columns={COLUMNS}
        hiddenColumns={new Set(['sku'])}
        onToggle={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));

    expect(screen.getByRole('menuitemcheckbox', { name: 'Name' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'SKU' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});

describe('toggling a column', () => {
  it('reports hiding a currently visible column', async () => {
    const onToggle = vi.fn();
    render(
      <ColumnManager
        columns={COLUMNS}
        hiddenColumns={new Set()}
        onToggle={onToggle}
        onReset={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'SKU' }));

    expect(onToggle).toHaveBeenCalledWith('sku', false);
  });

  it('reports showing a currently hidden column', async () => {
    const onToggle = vi.fn();
    render(
      <ColumnManager
        columns={COLUMNS}
        hiddenColumns={new Set(['sku'])}
        onToggle={onToggle}
        onReset={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'SKU' }));

    expect(onToggle).toHaveBeenCalledWith('sku', true);
  });

  it('keeps the menu open after toggling, so several columns can be changed at once', async () => {
    render(
      <ColumnManager
        columns={COLUMNS}
        hiddenColumns={new Set()}
        onToggle={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'SKU' }));

    expect(screen.getByRole('menuitemcheckbox', { name: 'Price' })).toBeInTheDocument();
  });
});

describe('reset', () => {
  it('offers reset only when something is hidden', async () => {
    render(
      <ColumnManager
        columns={COLUMNS}
        hiddenColumns={new Set()}
        onToggle={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));

    expect(screen.queryByRole('menuitem', { name: 'Show all columns' })).not.toBeInTheDocument();
  });

  it('calls onReset when clicked', async () => {
    const onReset = vi.fn();
    render(
      <ColumnManager
        columns={COLUMNS}
        hiddenColumns={new Set(['sku'])}
        onToggle={vi.fn()}
        onReset={onReset}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show all columns' }));

    expect(onReset).toHaveBeenCalledOnce();
  });
});
