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

describe('variants/gallery on create — no dead end', () => {
  // Previously these buttons were simply ABSENT during create, with nothing
  // explaining why "Manage variants" that works on an existing product is
  // nowhere to be found on a new one.
  it('shows the buttons on a fresh create form, disabled, with a reason', async () => {
    renderForm();

    const variantsButton = await screen.findByRole('button', { name: 'Manage variants' });
    const galleryButton = screen.getByRole('button', { name: 'Manage gallery' });

    expect(variantsButton).toBeDisabled();
    expect(galleryButton).toBeDisabled();
    expect(screen.getByText(/save this product first/i)).toBeInTheDocument();
  });

  it('enables both buttons once editing an existing product, with no hint text', async () => {
    renderForm(existing);

    const variantsButton = await screen.findByRole('button', { name: 'Manage variants' });
    const galleryButton = screen.getByRole('button', { name: 'Manage gallery' });

    expect(variantsButton).toBeEnabled();
    expect(galleryButton).toBeEnabled();
    expect(screen.queryByText(/save this product first/i)).not.toBeInTheDocument();
  });

  it('does not render the variants/gallery section at all for a non-product resource', async () => {
    const discountSchema: ResourceSchema = { ...schema, resource: 'discounts' };
    render(
      <ResourceForm
        schema={discountSchema}
        row={null}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await screen.findByLabelText(/name/i);
    expect(screen.queryByRole('button', { name: 'Manage variants' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage gallery' })).not.toBeInTheDocument();
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

describe('dates are picked, never typed', () => {
  const dated = {
    ...schema,
    fields: [
      ...schema.fields,
      { name: 'expiresAt', label: 'Expires', type: 'datetime' as const },
    ],
  };

  function renderDated() {
    return render(
      <ResourceForm
        schema={dated}
        row={null}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  }

  it('uses a calendar rather than a native date input', async () => {
    // A native date input renders browser chrome that cannot be styled and
    // shows a picker in the OS language rather than the page language.
    const { container } = renderDated();

    await screen.findByLabelText(/name/i);
    expect(container.querySelector('input[type="date"]')).toBeNull();
    // Named by its field Label, which correctly wins over the button's own
    // text — so the control is reachable the same way every other field is.
    expect(screen.getByLabelText(/expires/i).tagName).toBe('BUTTON');
  });

  it('sends the picked day as an ISO datetime, unshifted', async () => {
    createRow.mockResolvedValue({ id: 'new' });
    renderDated();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');
    await userEvent.type(screen.getByLabelText(/price/i), '5.00');

    await userEvent.click(screen.getByLabelText(/expires/i));
    await userEvent.click(await screen.findByText('20', { selector: 'button' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createRow).toHaveBeenCalled());

    const payload = createRow.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(String(payload.expiresAt)).toMatch(/^\d{4}-\d{2}-20T00:00:00\.000Z$/);
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
  it('does not offer Save at all on a completely untouched create form', async () => {
    // Save is gated on isDirty (StickyFormBar) — nothing to save yet, so the
    // button is disabled rather than clickable-then-rejected. A stronger
    // guarantee than a post-click error message: there's no click that could
    // reach the empty-form case at all.
    renderForm();

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
    expect(createRow).not.toHaveBeenCalled();
  });

  it('blocks submission and names the offending field once a required field is touched and left empty', async () => {
    renderForm();

    // Touch price (making the form dirty, enabling Save) without ever
    // filling in the still-required name field.
    await userEvent.type(screen.getByLabelText(/price/i), '9.99');
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findAllByText(/required/i)).not.toHaveLength(0);
    expect(createRow).not.toHaveBeenCalled();
  });

  it('clears the message as soon as the field is corrected', async () => {
    // A message that stays put while the user fixes the problem reads as
    // "still wrong", which sends them looking for a second mistake.
    renderForm();

    await userEvent.type(screen.getByLabelText(/price/i), '9.99');
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

  it('never offers a clickable Save when nothing has changed', async () => {
    // Stronger than a post-click no-op: Save is disabled outright while
    // !isDirty (StickyFormBar), so there is no click that could reach the
    // engine's "Provide at least one field" rejection for an untouched edit.
    renderForm(existing);

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
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

describe('the dirty-state signal appears BEFORE Save, not just after', () => {
  // Standing 2026-08-03 note: a field change must surface a dirty-state
  // signal before Save is clicked — not only discovered via a toast or a
  // discard-confirmation dialog after the fact.
  it('shows no unsaved-changes text on an untouched form', async () => {
    renderForm();

    await screen.findByRole('button', { name: 'Save' });
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
  });

  it('shows the unsaved-changes signal the moment a field is edited, before any click', async () => {
    renderForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');

    expect(await screen.findByText(/unsaved/i)).toBeInTheDocument();
    // Confirms it appeared from typing alone — Save was never clicked.
    expect(createRow).not.toHaveBeenCalled();
  });

  it('enables Save only once the form is dirty', async () => {
    renderForm();

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/name/i), 'Vase');

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('unsaved-changes guard on tab close / reload', () => {
  function fireBeforeUnload(): Event {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  it('warns before the browser discards a dirty, still-open form', async () => {
    renderForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');

    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('does not warn on an untouched form', async () => {
    renderForm();
    await screen.findByLabelText(/name/i);

    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});

describe('inline validation on blur', () => {
  it('flags a malformed value the instant the field loses focus, before Save is ever clicked', async () => {
    renderForm();

    await userEvent.type(await screen.findByLabelText(/price/i), '19.999');
    await userEvent.tab();

    expect(await screen.findByText(/two decimal places/i)).toBeInTheDocument();
    expect(createRow).not.toHaveBeenCalled();
  });

  it('clears the blur-time error as soon as the field is corrected, without waiting for another blur', async () => {
    renderForm();

    const price = await screen.findByLabelText(/price/i);
    await userEvent.type(price, '19.999');
    await userEvent.tab();
    expect(await screen.findByText(/two decimal places/i)).toBeInTheDocument();

    await userEvent.clear(price);
    await userEvent.type(price, '19.99');

    await waitFor(() => {
      expect(screen.queryByText(/two decimal places/i)).not.toBeInTheDocument();
    });
  });

  it('does NOT flag a required field left blank on blur — only submit does', async () => {
    // Tabbing through a fresh create form's untouched fields (focus then
    // blur, never typing) must not light every required field red before
    // the user has done anything wrong — see the comment in
    // resource-form.tsx's onBlur handler for why this is deliberate.
    renderForm();

    await userEvent.click(await screen.findByLabelText(/name/i));
    await userEvent.tab();

    expect(screen.queryByText(/required/i)).not.toBeInTheDocument();
  });

  it('does not require a Save attempt first — blur alone is enough to surface the message', async () => {
    renderForm();

    // Never clicked Save at all in this test.
    await userEvent.type(await screen.findByLabelText(/price/i), 'not-a-price');
    await userEvent.tab();

    expect(await screen.findByText(/two decimal places/i)).toBeInTheDocument();
  });
});

describe('multi-relation picker (discount scoping)', () => {
  const multiRelationSchema: ResourceSchema = {
    ...schema,
    resource: 'discounts',
    fields: [
      ...schema.fields,
      {
        name: 'categories',
        label: 'Categories',
        type: 'multiRelation',
        relation: { resource: 'categories', labelField: 'name' },
      },
    ],
  };

  function renderMultiRelationForm(row: Record<string, unknown> | null = null) {
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    const result = render(
      <ResourceForm
        schema={multiRelationSchema}
        row={row}
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );
    return { ...result, onSaved, onOpenChange };
  }

  beforeEach(() => {
    fetchRelationOptions.mockResolvedValue([
      { value: 'cat-a', label: 'Home & Garden' },
      { value: 'cat-b', label: 'Electronics' },
    ]);
  });

  it('renders one checkbox per fetched option', async () => {
    renderMultiRelationForm();

    expect(await screen.findByLabelText('Home & Garden')).toBeInTheDocument();
    expect(screen.getByLabelText('Electronics')).toBeInTheDocument();
  });

  it('pre-checks the ids already on the row when editing', async () => {
    renderMultiRelationForm({ ...existing, categories: ['cat-b'] });

    expect(await screen.findByLabelText('Electronics')).toBeChecked();
    expect(screen.getByLabelText('Home & Garden')).not.toBeChecked();
  });

  it('sends the checked ids as an array on create', async () => {
    createRow.mockResolvedValue({ id: 'new' });
    renderMultiRelationForm();

    await userEvent.type(await screen.findByLabelText(/name/i), 'Vase');
    await userEvent.type(screen.getByLabelText(/price/i), '5.00');
    await userEvent.click(await screen.findByLabelText('Home & Garden'));
    await userEvent.click(screen.getByLabelText('Electronics'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createRow).toHaveBeenCalled());

    const payload = createRow.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.categories).toEqual(['cat-a', 'cat-b']);
  });

  it('unchecking one option removes only that id', async () => {
    updateRow.mockResolvedValue(existing);
    renderMultiRelationForm({ ...existing, categories: ['cat-a', 'cat-b'] });

    await userEvent.click(await screen.findByLabelText('Home & Garden'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateRow).toHaveBeenCalled());
    const payload = updateRow.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload.categories).toEqual(['cat-b']);
  });

  it('does not send the field when the same set is toggled back', async () => {
    updateRow.mockResolvedValue(existing);
    renderMultiRelationForm({ ...existing, categories: ['cat-a'] });

    // Uncheck then re-check the same option — net no change.
    const checkbox = await screen.findByLabelText('Home & Garden');
    await userEvent.click(checkbox);
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Nothing changed at all, so the form closes without calling the API —
    // same behaviour as the plain "editing sends a minimal patch" case.
    await waitFor(() => expect(updateRow).not.toHaveBeenCalled());
  });

  it('shows a message instead of an empty list when there are no options', async () => {
    fetchRelationOptions.mockResolvedValue([]);
    renderMultiRelationForm();

    expect(await screen.findByText(/none available/i)).toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('renders in Arabic', async () => {
    renderForm(null, 'ar');

    expect(await screen.findByRole('button', { name: 'حفظ' })).toBeInTheDocument();
  });
});

/**
 * Margin is DERIVED from the price and cost already on the form, never stored.
 *
 * The cases that matter are the ones where a naive implementation shows a
 * confident, wrong number: a half-typed field, a zero price (÷0 → "∞%"), or a
 * resource that has a price but no cost at all.
 */
describe('margin summary', () => {
  const costed: ResourceSchema = {
    ...schema,
    fields: [
      ...schema.fields,
      { name: 'cost', label: 'Cost', type: 'money' as const },
    ],
  };

  function renderCosted(row: Record<string, unknown> | null) {
    return render(
      <ResourceForm
        schema={costed}
        row={row}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  }

  it('shows profit and margin from the stored price and cost', async () => {
    renderCosted({ id: '1', name: 'Lamp', price: '100.00', cost: '40.00' });

    expect(await screen.findByText('Profit')).toBeInTheDocument();
    // 100 − 40 = 60, and 60/100 = 60%. Matched exactly rather than with a
    // loose /60/, which also hits the "60.00" inside the price input.
    expect(screen.getByText('AED 60.00')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('recomputes as the price is edited', async () => {
    renderCosted({ id: '1', name: 'Lamp', price: '100.00', cost: '40.00' });

    const price = await screen.findByLabelText(/price/i);
    await userEvent.clear(price);
    await userEvent.type(price, '80');

    // 80 − 40 = 40, and 40/80 = 50%.
    await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument());
  });

  it('marks a negative margin as destructive rather than hiding it', async () => {
    // Selling below cost is exactly the case worth surfacing.
    renderCosted({ id: '1', name: 'Lamp', price: '40.00', cost: '100.00' });

    const margin = await screen.findByText('-150%');
    expect(margin).toHaveClass('text-destructive');
  });

  it('renders nothing while a field is empty', async () => {
    renderCosted({ id: '1', name: 'Lamp', price: '100.00', cost: '' });

    await screen.findByLabelText(/price/i);
    expect(screen.queryByText('Profit')).not.toBeInTheDocument();
  });

  it('renders nothing when the price is zero rather than dividing by it', async () => {
    renderCosted({ id: '1', name: 'Lamp', price: '0.00', cost: '10.00' });

    await screen.findByLabelText(/price/i);
    expect(screen.queryByText('Profit')).not.toBeInTheDocument();
  });

  it('stays hidden for a resource that declares no cost field', async () => {
    // The base schema has `price` but no `cost` — margin is undefined for it,
    // so the panel must not appear at all.
    renderForm({ id: '1', name: 'Lamp', price: '100.00' });

    await screen.findByLabelText(/price/i);
    expect(screen.queryByText('Profit')).not.toBeInTheDocument();
  });
});

/**
 * A5.7 — a config-declared `changeWarning` on a field (slug, in practice).
 * The property that matters: it must fire ONLY when a real existing value is
 * being changed to something different — never on create (nothing to have
 * changed from) and never on first-time entry into a field that was blank.
 */
describe('field change warning', () => {
  const withSlug: ResourceSchema = {
    ...schema,
    fields: [
      ...schema.fields,
      {
        name: 'slug',
        label: 'Slug',
        type: 'text' as const,
        changeWarning: 'Changing the slug records a redirect from the old one.',
      },
    ],
  };

  function renderSlugForm(row: Record<string, unknown> | null) {
    return render(
      <ResourceForm schema={withSlug} row={row} open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
  }

  it('says nothing while the value is unchanged', async () => {
    renderSlugForm({ ...existing, slug: 'ceramic-planter' });

    await screen.findByLabelText(/slug/i);
    expect(screen.queryByText(/records a redirect/i)).not.toBeInTheDocument();
  });

  it('appears once an existing slug is edited to something else', async () => {
    renderSlugForm({ ...existing, slug: 'ceramic-planter' });

    const slug = await screen.findByLabelText(/slug/i);
    await userEvent.clear(slug);
    await userEvent.type(slug, 'ceramic-planter-v2');

    expect(await screen.findByText(/records a redirect/i)).toBeInTheDocument();
  });

  it('does not appear for first-time entry into a previously blank slug', async () => {
    renderSlugForm({ ...existing, slug: '' });

    const slug = await screen.findByLabelText(/slug/i);
    await userEvent.type(slug, 'ceramic-planter');

    expect(screen.queryByText(/records a redirect/i)).not.toBeInTheDocument();
  });

  it('never appears on create — there is nothing to have changed from', async () => {
    renderSlugForm(null);

    const slug = await screen.findByLabelText(/slug/i);
    await userEvent.type(slug, 'brand-new-product');

    expect(screen.queryByText(/records a redirect/i)).not.toBeInTheDocument();
  });

  it('clears again if the value is edited back to the original', async () => {
    renderSlugForm({ ...existing, slug: 'ceramic-planter' });

    const slug = await screen.findByLabelText(/slug/i);
    await userEvent.clear(slug);
    await userEvent.type(slug, 'changed');
    expect(await screen.findByText(/records a redirect/i)).toBeInTheDocument();

    await userEvent.clear(slug);
    await userEvent.type(slug, 'ceramic-planter');
    await waitFor(() => expect(screen.queryByText(/records a redirect/i)).not.toBeInTheDocument());
  });
});
