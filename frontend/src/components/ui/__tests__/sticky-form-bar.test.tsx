import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { StickyFormBar } from '../sticky-form-bar';

/**
 * The save/discard bar shared by resource-form.tsx and (eventually)
 * settings-form.tsx. The property that matters most, per the standing
 * 2026-08-03 note this exists to satisfy: the dirty signal has to be visible
 * BEFORE Save, driven purely by the `isDirty` prop the caller passes — this
 * component never computes dirtiness itself.
 */

describe('dirty-state signal', () => {
  it('shows nothing extra while not dirty', () => {
    render(
      <StickyFormBar isDirty={false} isSaving={false} save={{ type: 'button', onClick: vi.fn() }} />,
    );

    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  it('shows the plain unsaved-changes text when dirty with no count given', () => {
    render(
      <StickyFormBar isDirty={true} isSaving={false} save={{ type: 'button', onClick: vi.fn() }} />,
    );

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('shows a counted unsaved-changes message when unsavedCount is given', () => {
    render(
      <StickyFormBar
        isDirty={true}
        isSaving={false}
        unsavedCount={3}
        save={{ type: 'button', onClick: vi.fn() }}
      />,
    );

    expect(screen.getByText('3 unsaved changes')).toBeInTheDocument();
  });

  it('shows the saved notice only when justSaved is true and the form is no longer dirty', () => {
    render(
      <StickyFormBar
        isDirty={false}
        isSaving={false}
        justSaved={true}
        save={{ type: 'button', onClick: vi.fn() }}
      />,
    );

    expect(screen.getByText('Saved.')).toBeInTheDocument();
  });

  it('prefers the dirty signal over the saved notice if somehow both are true', () => {
    render(
      <StickyFormBar
        isDirty={true}
        isSaving={false}
        justSaved={true}
        save={{ type: 'button', onClick: vi.fn() }}
      />,
    );

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });
});

describe('Save button', () => {
  it('is disabled while not dirty, regardless of isSaving', () => {
    render(
      <StickyFormBar isDirty={false} isSaving={false} save={{ type: 'button', onClick: vi.fn() }} />,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is disabled while saving, even if dirty', () => {
    render(
      <StickyFormBar isDirty={true} isSaving={true} save={{ type: 'button', onClick: vi.fn() }} />,
    );

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('fires the button onClick handler when save.type is "button"', async () => {
    const onClick = vi.fn();
    render(<StickyFormBar isDirty={true} isSaving={false} save={{ type: 'button', onClick }} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders as a real submit button (no onClick wired) when save.type is "submit"', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <StickyFormBar isDirty={true} isSaving={false} save={{ type: 'submit' }} />
      </form>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('Cancel button', () => {
  it('is absent when onCancel is not provided', () => {
    render(
      <StickyFormBar isDirty={false} isSaving={false} save={{ type: 'button', onClick: vi.fn() }} />,
    );

    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('fires onCancel and stays enabled independent of dirty state', async () => {
    const onCancel = vi.fn();
    render(
      <StickyFormBar
        isDirty={false}
        isSaving={false}
        onCancel={onCancel}
        save={{ type: 'button', onClick: vi.fn() }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Cancel while saving — no way to abandon a write in flight', () => {
    render(
      <StickyFormBar
        isDirty={true}
        isSaving={true}
        onCancel={vi.fn()}
        save={{ type: 'button', onClick: vi.fn() }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});

describe('custom labels', () => {
  it('uses caller-supplied labels over the common.* defaults', () => {
    render(
      <StickyFormBar
        isDirty={false}
        isSaving={false}
        onCancel={vi.fn()}
        save={{ type: 'button', onClick: vi.fn() }}
        saveLabel="Apply"
        cancelLabel="Discard"
      />,
    );

    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });
});
