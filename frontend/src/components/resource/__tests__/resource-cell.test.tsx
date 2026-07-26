import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/render';
import { ResourceCell } from '../resource-cell';
import type { FieldConfig } from '@/lib/resource-api';

/**
 * Cells are chosen by SEMANTIC type, and that choice is the whole payoff of
 * the config engine: `money` and `number` are both numeric in the database,
 * but only one is currency and only one must never become a float.
 */

function field(overrides: Partial<FieldConfig> & Pick<FieldConfig, 'type'>): FieldConfig {
  return { name: 'value', label: 'Value', ...overrides };
}

function renderCell(
  f: FieldConfig,
  row: Record<string, unknown>,
  resource = 'products',
  locale: 'en' | 'ar' = 'en',
) {
  return render(<ResourceCell field={f} row={row} resource={resource} />, { locale });
}

describe('money', () => {
  it('formats the decimal string as currency', () => {
    renderCell(field({ type: 'money' }), { value: '1234.50' });

    expect(screen.getByText(/1,234\.50/)).toBeInTheDocument();
  });

  it('keeps two decimals rather than trimming them', () => {
    // "20" and "20.00" are the same amount but not the same string. A trimmed
    // column reads as inconsistent next to its neighbours.
    renderCell(field({ type: 'money' }), { value: '20.00' });

    expect(screen.getByText(/20\.00/)).toBeInTheDocument();
  });
});

describe('boolean', () => {
  it('renders a tick with a text label, never the word "true"', () => {
    // Shape alone is not announced to a screen reader, so the icon carries an
    // sr-only label. Rendering "true" would be a database value, not an answer.
    const { container } = renderCell(field({ type: 'boolean' }), { value: true });

    expect(container.textContent).not.toContain('true');
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('distinguishes false from missing', () => {
    // false is an answer; null is the absence of one. They must not look alike.
    const falsy = renderCell(field({ type: 'boolean' }), { value: false });
    expect(screen.getByText('No')).toBeInTheDocument();

    falsy.unmount();

    const { container } = renderCell(field({ type: 'boolean' }), { value: null });
    expect(container.textContent).toContain('—');
  });
});

describe('relation', () => {
  it('shows the label the API attached, not the raw id', () => {
    // A cuid in a table cell is unreadable and leaks an internal identifier.
    renderCell(field({ type: 'relation', name: 'categoryId' }), {
      categoryId: 'cms0ze4a300009so45ks5vnml',
      categoryId__label: 'Home & Garden',
    });

    expect(screen.getByText('Home & Garden')).toBeInTheDocument();
    expect(screen.queryByText(/cms0ze4a3/)).not.toBeInTheDocument();
  });

  it('falls back to the id when no label was resolved', () => {
    // Better than an empty cell: it still identifies the row.
    renderCell(field({ type: 'relation', name: 'categoryId' }), {
      categoryId: 'orphan-id',
      categoryId__label: null,
    });

    expect(screen.getByText('orphan-id')).toBeInTheDocument();
  });
});

describe('enum', () => {
  it('renders a translated badge when the field maps to a status', () => {
    renderCell(field({ type: 'enum', name: 'status' }), { status: 'ACTIVE' }, 'products');

    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('resolves the same field name differently per resource', () => {
    // `status` means something different on a review than on a product, and
    // each has its own translations and tones.
    renderCell(field({ type: 'enum', name: 'status' }), { status: 'APPROVED' }, 'reviews');

    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('renders a non-status enum as plain text', () => {
    // discount.type is a category, not a state. A tone would imply one value
    // is healthier than the other.
    renderCell(field({ type: 'enum', name: 'type' }), { type: 'PERCENT' }, 'discounts');

    expect(screen.getByText('PERCENT')).toBeInTheDocument();
  });
});

describe('always-LTR data', () => {
  it('renders an email LTR so it does not reorder in Arabic', () => {
    renderCell(field({ type: 'email', name: 'email' }), { email: 'a@b.com' }, 'customers', 'ar');

    expect(screen.getByText('a@b.com').className).toContain('force-ltr');
  });

  it('links a phone number and keeps it LTR', () => {
    renderCell(field({ type: 'phone', name: 'phone' }), { phone: '+971501234567' }, 'customers', 'ar');

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'tel:+971501234567');
    expect(link.className).toContain('force-ltr');
  });

  it('marks the external-link icon directional so it mirrors in RTL', () => {
    const { container } = renderCell(field({ type: 'url', name: 'link' }), {
      link: 'https://example.com',
    });

    expect(container.querySelector('.icon-directional')).toBeTruthy();
  });
});

describe('missing values', () => {
  it('renders an em dash rather than an empty cell', () => {
    // An empty cell looks like the table failed to render. A dash states that
    // there is no value.
    for (const value of [null, undefined, '']) {
      const { container, unmount } = renderCell(field({ type: 'text' }), { value });
      expect(container.textContent).toContain('—');
      unmount();
    }
  });

  it('does not render an invalid date as "Invalid Date"', () => {
    const { container } = renderCell(field({ type: 'datetime' }), { value: 'not-a-date' });

    expect(container.textContent).not.toContain('Invalid');
    expect(container.textContent).toContain('—');
  });
});
