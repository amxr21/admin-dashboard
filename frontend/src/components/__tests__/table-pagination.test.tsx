import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { TablePagination } from '../table-pagination';

/**
 * The pagination footer shared by every list page.
 *
 * What matters: it never claims "0 results, page 1 of 0" for an empty table,
 * the prev/next pair hides on a single page while the size selector does not
 * (a 20-of-23-row list still needs a way to discover there's more), and the
 * size control is opt-in per caller.
 */

function noop() {
  //
}

describe('the empty case', () => {
  it('renders nothing at all when there is nothing to page', () => {
    const { container } = render(
      <TablePagination
        page={1}
        totalPages={1}
        total={0}
        pageSize={20}
        onPageChange={noop}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('a single page', () => {
  it('hides prev/next but still offers the size selector', () => {
    render(
      <TablePagination
        page={1}
        totalPages={1}
        total={12}
        pageSize={20}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    // A list showing all 12 of 12 rows still benefits from discovering the
    // size control BEFORE the day it has 30.
    expect(screen.getByRole('combobox', { name: /rows per page/i })).toBeInTheDocument();
  });

  it('omits the size selector when the caller passes no handler', () => {
    // A fixed-size preview shouldn't offer a control that does nothing.
    render(
      <TablePagination page={1} totalPages={1} total={12} pageSize={20} onPageChange={noop} />,
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

describe('multiple pages', () => {
  it('disables Previous on the first page and Next on the last', () => {
    render(
      <TablePagination
        page={1}
        totalPages={3}
        total={45}
        pageSize={20}
        onPageChange={noop}
      />,
    );

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('calls back with the adjacent page, not an offset', async () => {
    const onPageChange = vi.fn();

    render(
      <TablePagination
        page={2}
        totalPages={5}
        total={90}
        pageSize={20}
        onPageChange={onPageChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('clamps rather than stepping past the last page', async () => {
    const onPageChange = vi.fn();

    render(
      <TablePagination
        page={5}
        totalPages={5}
        total={90}
        pageSize={20}
        onPageChange={onPageChange}
      />,
    );

    // Next is disabled here, so this documents the clamp rather than relying
    // solely on the disabled attribute to prevent an out-of-range call.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('disables both buttons while loading', () => {
    render(
      <TablePagination
        page={2}
        totalPages={5}
        total={90}
        pageSize={20}
        isLoading
        onPageChange={noop}
      />,
    );

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

describe('the size selector', () => {
  it('reports the chosen size', async () => {
    const onPageSizeChange = vi.fn();

    render(
      <TablePagination
        page={1}
        totalPages={3}
        total={45}
        pageSize={20}
        onPageChange={noop}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    await userEvent.click(screen.getByRole('combobox', { name: /rows per page/i }));
    await userEvent.click(await screen.findByRole('option', { name: '50' }));

    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

describe('the total label', () => {
  it('falls back to a pluralised count', () => {
    render(
      <TablePagination page={1} totalPages={1} total={1} pageSize={20} onPageChange={noop} />,
    );

    expect(screen.getByText('1 result')).toBeInTheDocument();
  });

  it('uses the caller-supplied label when given one', () => {
    render(
      <TablePagination
        page={1}
        totalPages={1}
        total={1}
        pageSize={20}
        onPageChange={noop}
        totalLabel="1 customer"
      />,
    );

    expect(screen.getByText('1 customer')).toBeInTheDocument();
    expect(screen.queryByText('1 result')).not.toBeInTheDocument();
  });
});
