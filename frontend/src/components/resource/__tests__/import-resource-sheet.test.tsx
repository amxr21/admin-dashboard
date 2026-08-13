import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ImportResourceSheet } from '../import-resource-sheet';

/**
 * CSV import (A2.13). The property that matters most: Apply is disabled
 * whenever the preview reports any error at all — there is no "import the
 * valid rows anyway" path in this UI, matching the backend's own
 * all-or-nothing "no silent partial writes" contract.
 */

const previewResourceImport = vi.hoisted(() => vi.fn());
const applyResourceImport = vi.hoisted(() => vi.fn());
const downloadImportTemplate = vi.hoisted(() => vi.fn());

vi.mock('@/lib/resource-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resource-api')>();
  return {
    ...actual,
    previewResourceImport,
    applyResourceImport,
    downloadImportTemplate,
  };
});

function renderSheet(open = true) {
  const onOpenChange = vi.fn();
  const onImported = vi.fn();
  const result = render(
    <ImportResourceSheet
      resource="products"
      resourceLabel="Products"
      open={open}
      onOpenChange={onOpenChange}
      onImported={onImported}
    />,
  );
  return { ...result, onOpenChange, onImported };
}

function chooseFile() {
  // Sheet content is portalled to document.body, not the render `container`.
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['Name,Price\nWidget,9.99'], 'import.csv', { type: 'text/csv' });
  return userEvent.upload(input, file);
}

beforeEach(() => {
  previewResourceImport.mockReset();
  applyResourceImport.mockReset();
  downloadImportTemplate.mockReset();
  downloadImportTemplate.mockResolvedValue(undefined);
});

describe('picking a file', () => {
  it('runs a dry-run preview immediately on file selection, before any Apply click', async () => {
    previewResourceImport.mockResolvedValue({ totalRows: 1, validRows: 1, errors: [] });
    renderSheet();

    await chooseFile();

    await waitFor(() => {
      expect(previewResourceImport).toHaveBeenCalledWith('products', expect.any(File));
    });
    // The write function must NOT have been called just from picking a file.
    expect(applyResourceImport).not.toHaveBeenCalled();
  });

  it('offers the template download before any file is picked', () => {
    renderSheet();

    expect(screen.getByRole('button', { name: /download csv template/i })).toBeInTheDocument();
  });
});

describe('preview', () => {
  it('shows every row as ready and enables Apply when there are no errors', async () => {
    previewResourceImport.mockResolvedValue({ totalRows: 3, validRows: 3, errors: [] });
    renderSheet();

    await chooseFile();

    const applyButton = await screen.findByRole('button', { name: /import 3 rows/i });
    expect(applyButton).toBeEnabled();
  });

  it('disables Apply when even one row has an error — no partial-import path in this UI', async () => {
    previewResourceImport.mockResolvedValue({
      totalRows: 2,
      validRows: 1,
      errors: [{ row: 3, field: 'price', message: '"Price" must be a decimal string' }],
    });
    renderSheet();

    await chooseFile();

    const applyButton = await screen.findByRole('button', { name: /import 1 row/i });
    expect(applyButton).toBeDisabled();
    expect(screen.getByText(/row 3/i)).toBeInTheDocument();
    expect(screen.getByText(/must be a decimal string/i)).toBeInTheDocument();
  });

  it('surfaces a preview failure (e.g. bad file) as an error, not a silent dead end', async () => {
    // useTranslatedApiError maps a bare 400 to the generic "server had a
    // problem" text (only 401/403/404/413 get specific copy) — asserting on
    // THAT translated string, not the mock's own message text.
    previewResourceImport.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Could not read this file as CSV.', undefined),
    );
    renderSheet();

    await chooseFile();

    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument();
  });
});

describe('applying', () => {
  it('commits the import and reports how many rows were actually imported', async () => {
    previewResourceImport.mockResolvedValue({ totalRows: 2, validRows: 2, errors: [] });
    applyResourceImport.mockResolvedValue({
      totalRows: 2,
      validRows: 2,
      imported: 2,
      errors: [],
    });
    const { onImported } = renderSheet();

    await chooseFile();
    await userEvent.click(await screen.findByRole('button', { name: /import 2 rows/i }));

    await waitFor(() => expect(applyResourceImport).toHaveBeenCalledWith('products', expect.any(File)));
    expect(await screen.findByText(/2 imported/i)).toBeInTheDocument();
    // The caller's list must reload — a successful import that leaves the
    // table showing stale data would look like nothing happened.
    expect(onImported).toHaveBeenCalled();
  });

  it('does not call onImported when apply re-validation catches nothing importable', async () => {
    // Same scenario as the backend's "re-validates at apply time" test: the
    // preview said everything was fine, but apply's own fresh validation
    // (e.g. a relation deleted in the gap) found a problem.
    previewResourceImport.mockResolvedValue({ totalRows: 1, validRows: 1, errors: [] });
    applyResourceImport.mockResolvedValue({
      totalRows: 1,
      validRows: 1,
      imported: 0,
      errors: [{ row: 2, field: 'categoryId', message: 'references unknown categories' }],
    });
    const { onImported } = renderSheet();

    await chooseFile();
    await userEvent.click(await screen.findByRole('button', { name: /import 1 row/i }));

    expect(await screen.findByText(/nothing imported/i)).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it('surfaces an apply network/server failure as an error', async () => {
    previewResourceImport.mockResolvedValue({ totalRows: 1, validRows: 1, errors: [] });
    applyResourceImport.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom', undefined));
    renderSheet();

    await chooseFile();
    await userEvent.click(await screen.findByRole('button', { name: /import 1 row/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('closing and resetting', () => {
  it('resets to the file-picker step when reopened after a completed import', async () => {
    previewResourceImport.mockResolvedValue({ totalRows: 1, validRows: 1, errors: [] });
    applyResourceImport.mockResolvedValue({
      totalRows: 1,
      validRows: 1,
      imported: 1,
      errors: [],
    });
    renderSheet();

    await chooseFile();
    await userEvent.click(await screen.findByRole('button', { name: /import 1 row/i }));
    await screen.findByText(/1 imported/i);

    // Two "Close" buttons exist: this component's own primary Close action
    // and Radix's separate sr-only dismiss button on the sheet chrome. Ours
    // renders first in DOM order (inside the sheet body), Radix's is a
    // sibling after it.
    const [ownCloseButton] = screen.getAllByRole('button', { name: /^close$/i });
    await userEvent.click(ownCloseButton!);

    // Back to the picker — the template button is the pick-step's own marker.
    expect(screen.getByRole('button', { name: /download csv template/i })).toBeInTheDocument();
    expect(screen.queryByText(/1 imported/i)).not.toBeInTheDocument();
  });
});
