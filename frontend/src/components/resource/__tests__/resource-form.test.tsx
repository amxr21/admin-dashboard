import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ResourceForm } from '../resource-form';
import type { ResourceSchema } from '@/lib/resource-api';

/**
 * The generic create/edit form.
 *
 * The cases pinned here are the ones that fail QUIETLY. A money value that
 * arrives as a JSON number still saves — it just saves the wrong amount, and
 * nobody notices until an invoice disagrees with a total. A PATCH that resends
 * unchanged fields still succeeds — it just widens the audit surface. Neither
 * shows up as a broken screen, so neither would be caught by clicking around.
 */

const createRow = vi.hoisted(() => vi.fn());
const updateRow = vi.hoisted(() => vi.fn());
const fetchRelationOptions = vi.hoisted(() => vi.fn());

vi.mock('@/lib/resource-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resource-api')>();
  return { ...actual, createRow, updateRow, fetchRelationOptions };
});

const schema: ResourceSchema = {
  resource: 'products',
  label: 'Products',
  group: 'catalogue',
  labelField: 'name',
  permissionArea: 'products',
  defaultSort: { field: 'createdAt', dir: 'desc' },
  permissions: { create: true, update: true, delete: true },
  fields: [
    { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'price', label: 'Price', type: 'money', required: true },
    { name: 'stock', label: 'Stock', type: 'number' },
    { name: 'isActive', label: 'Active', type: 'boolean' },
    { name: 'status', label: 'Status', type: 'enum', options: ['DRAFT', 'ACTIVE'] },
    {
      name: 'categoryId',
      label: 'Category',
      type: 'relation',
      relation: { resource: 'categories', labelField: 'name' },
    },
    { name: 'createdAt', label: 'Created', type: 'datetime', readOnly: true },
  ],
};

const existing = {
  id: 'p1',
  name: 'Ceramic Planter',
  price: '34.99',
  stock: 12,
  isActive: true,
  status: 'ACTIVE',
  categoryId: 'c1',
  createdAt: '2026-07-01T00:00:00.000Z',
};

function renderForm(row: Record<string, unknown> | null = null, locale?: 'ar') {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();

  const result = render(
    <ResourceForm
      schema={schema}
      row={row}
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
    locale ? { locale } : {},
  );

  return { ...result, onSaved, onOpenChange };
}

beforeEach(() => {
  createRow.mockReset();
  updateRow.mockReset();
  fetchRelationOptions.mockReset();
  fetchRelationOptions.mockResolvedValue([{ value: 'c1', label: 'Home & Garden' }]);
});

describe('which fields appear', () => {
  it('omits read-only and non-form fields', async () => {
    renderForm();

    expect(await screen.findByLabelText(/name/i)).toBeInTheDocument();
    // `id` is inForm: false and `createdAt` is readOnly — the server drops both
    // on write, so offering them would be offering something that can't happen.
    expect(screen.queryByLabelText(/^id$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/created/i)).not.toBeInTheDocument();
  });

  it('populates every control when editing', async () => {
    renderForm(existing);

    expect(await screen.findByLabelText(/name/i)).toHaveValue('Ceramic Planter');
    expect(screen.getByLabelText(/price/i)).toHaveValue('34.99');
  });
});

describe('money never becomes a number', () => {
  it('sends the amount as a string', async () => {
    createRow.mockResolvedValue({ id: 'new' });
    renderForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');
    await userEvent.type(screen.getByLabelText(/price/i), '19.99');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createRow).toHaveBeenCalled());

    const payload = createRow.mock.calls[0]?.[1] as Record<string, unknown>;
    // The assertion that matters: a JSON number here would already have lost
    // precision inside JSON.parse on the way back, upstream of every check.
    expect(payload.price).toBe('19.99');
    expect(typeof payload.price).toBe('string');
  });

  it('renders price as a text input, never type=number', async () => {
    // A number input lets the browser hand back a float and undoes the whole
    // string discipline before any of our code sees the value.
    renderForm();

    expect(await screen.findByLabelText(/price/i)).toHaveAttribute('type', 'text');
  });

  it('rejects more than two decimal places without calling the API', async () => {
    renderForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');
    await userEvent.type(screen.getByLabelText(/price/i), '19.999');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/two decimal places/i)).toBeInTheDocument();
    expect(createRow).not.toHaveBeenCalled();
  });
});

describe('types on the wire', () => {
  it('sends number fields as JSON numbers and booleans as booleans', async () => {
    // The engine rejects a numeric STRING for a `number` field and a string
    // for a `boolean` — these are 400s, not coercions.
    createRow.mockResolvedValue({ id: 'new' });
    renderForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');
    await userEvent.type(screen.getByLabelText(/price/i), '5.00');
    await userEvent.type(screen.getByLabelText(/stock/i), '7');
    await userEvent.click(screen.getByLabelText(/active/i));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createRow).toHaveBeenCalled());

    const payload = createRow.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.stock).toBe(7);
    expect(payload.isActive).toBe(true);
  });

  it('sends an empty optional field as null rather than an empty string', async () => {
    createRow.mockResolvedValue({ id: 'new' });
    renderForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');
    await userEvent.type(screen.getByLabelText(/price/i), '5.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createRow).toHaveBeenCalled());

    const payload = createRow.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.stock).toBeNull();
  });
});

describe('optional selections can be cleared', () => {
  it('unsets a relation that already had a value', async () => {
    /**
     * Radix reserves "" for its own internal "unset", so without an explicit
     * sentinel option an optional relation could be SET but never cleared —
     * the only route back to empty would have been a direct API call.
     */
    updateRow.mockResolvedValue(existing);
    renderForm(existing);

    await userEvent.click(await screen.findByLabelText(/category/i));
    await userEvent.click(await screen.findByRole('option', { name: /none/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateRow).toHaveBeenCalled());

    const payload = updateRow.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload).toEqual({ categoryId: null });
  });

  it('offers no clear option on a required field', async () => {
    // Offering "None" where the server will reject it teaches the user that
    // the form lies about what it accepts.
    render(
      <ResourceForm
        schema={{
          ...schema,
          fields: schema.fields.map((field) =>
            field.name === 'status' ? { ...field, required: true } : field,
          ),
        }}
        row={existing}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByLabelText(/status/i));

    expect(screen.queryByRole('option', { name: /none/i })).not.toBeInTheDocument();
  });
});

describe('required fields', () => {
  it('blocks submission and names the offending field', async () => {
    renderForm();

    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findAllByText(/required/i)).not.toHaveLength(0);
    expect(createRow).not.toHaveBeenCalled();
  });

  it('clears the message as soon as the field is corrected', async () => {
    // A message that stays put while the user fixes the problem reads as
    // "still wrong", which sends them looking for a second mistake.
    renderForm();

    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText(/required/i)).not.toHaveLength(0);

    await userEvent.type(screen.getByLabelText(/name/i), 'Vase');

    await waitFor(() => {
      expect(
        screen.getByLabelText(/name/i).getAttribute('aria-invalid'),
      ).toBeNull();
    });
  });
});

describe('editing sends a minimal patch', () => {
  it('includes only the fields that changed', async () => {
    updateRow.mockResolvedValue(existing);
    renderForm(existing);

    const name = await screen.findByLabelText(/name/i);
    await userEvent.clear(name);
    await userEvent.type(name, 'Stone Planter');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateRow).toHaveBeenCalled());

    const payload = updateRow.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload).toEqual({ name: 'Stone Planter' });
  });

  it('closes without calling the API when nothing changed', async () => {
    // The engine rejects an empty PATCH with "Provide at least one field",
    // so an untouched form must not send one.
    const { onOpenChange } = renderForm(existing);

    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(updateRow).not.toHaveBeenCalled();
  });
});

describe('server errors land on the right field', () => {
  it('attaches a duplicate-value conflict to the named fields', async () => {
    // 409 is the one failure the client genuinely cannot predict, so it gets a
    // translated message rather than the server's English sentence.
    createRow.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'Another product already uses this Name', 'req-1', {
        fields: ['name'],
      }),
    );
    renderForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');
    await userEvent.type(screen.getByLabelText(/price/i), '5.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/already uses this value/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/name/i)).toHaveAttribute('aria-invalid', 'true'),
    );
  });

  it('falls back to a form-level message when the field is unknown', async () => {
    createRow.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Something else', 'req-2', { field: 'mystery' }),
    );
    renderForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');
    await userEvent.type(screen.getByLabelText(/price/i), '5.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('unsaved changes', () => {
  it('asks before discarding them', async () => {
    const { onOpenChange } = renderForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText(/discard your unsaved changes/i)).toBeInTheDocument();
    // Still open — the edits are not gone yet.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('closes immediately when nothing was touched', async () => {
    const { onOpenChange } = renderForm();

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('localisation', () => {
  it('renders in Arabic', async () => {
    renderForm(null, 'ar');

    expect(await screen.findByRole('button', { name: 'حفظ' })).toBeInTheDocument();
  });
});
