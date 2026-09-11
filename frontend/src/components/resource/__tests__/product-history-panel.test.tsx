import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ProductHistoryPanel } from '../product-history-panel';
import type {
  CatalogueVersionDetail,
  CatalogueVersionList,
} from '@/lib/product-content-api';

const fetchCatalogueVersions = vi.hoisted(() => vi.fn());
const fetchCatalogueVersion = vi.hoisted(() => vi.fn());
const restoreCatalogueVersion = vi.hoisted(() => vi.fn());

vi.mock('@/lib/product-content-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/product-content-api')>();
  return {
    ...actual,
    fetchCatalogueVersions,
    fetchCatalogueVersion,
    restoreCatalogueVersion,
  };
});

const summary = {
  id: 'v2',
  version: 2,
  source: 'UPDATE' as const,
  summary: 'Updated name, price',
  actorEmail: 'admin@example.com',
  actorRole: 'OWNER',
  createdAt: '2026-09-11T08:00:00.000Z',
};

const list: CatalogueVersionList = {
  versions: [summary],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

const detail: CatalogueVersionDetail = {
  ...summary,
  productId: 'p1',
  currentUpdatedAt: '2026-09-11T08:05:00.000Z',
  snapshot: {
    name: 'Old planter',
    sku: 'OLD-1',
    description: null,
    price: '12.00',
    cost: null,
    status: 'ACTIVE',
    translations: [
      {
        locale: 'ar',
        name: 'أصيص قديم',
        description: null,
        metaTitle: null,
        metaDescription: null,
      },
    ],
  },
};

function renderPanel() {
  const onRestored = vi.fn();
  render(
    <ProductHistoryPanel
      productId="p1"
      productName="Planter"
      open
      onOpenChange={vi.fn()}
      onRestored={onRestored}
    />,
  );
  return onRestored;
}

beforeEach(() => {
  fetchCatalogueVersions.mockReset();
  fetchCatalogueVersion.mockReset();
  restoreCatalogueVersion.mockReset();
});

describe('product history and restore', () => {
  it('renders immutable version metadata', async () => {
    fetchCatalogueVersions.mockResolvedValue(list);
    renderPanel();

    expect(await screen.findByText('Version 2')).toBeInTheDocument();
    expect(screen.getByText('Product updated')).toBeInTheDocument();
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument();
  });

  it('previews the snapshot and restores using its concurrency timestamp', async () => {
    fetchCatalogueVersions.mockResolvedValue(list);
    fetchCatalogueVersion.mockResolvedValue(detail);
    restoreCatalogueVersion.mockResolvedValue({
      version: 3,
      updatedAt: '2026-09-11T08:06:00.000Z',
    });
    const onRestored = renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Preview restore' }));
    expect(await screen.findByText('Restore version 2?')).toBeInTheDocument();
    expect(screen.getByText('Old planter')).toBeInTheDocument();
    expect(screen.getByText('أصيص قديم')).toBeInTheDocument();
    expect(screen.getByText(/stock quantities.*remain unchanged/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    await waitFor(() => {
      expect(restoreCatalogueVersion).toHaveBeenCalledWith(
        'p1',
        2,
        '2026-09-11T08:05:00.000Z',
      );
    });
    expect(onRestored).toHaveBeenCalledOnce();
  });

  it('keeps the preview open with actionable conflict feedback', async () => {
    fetchCatalogueVersions.mockResolvedValue(list);
    fetchCatalogueVersion.mockResolvedValue(detail);
    restoreCatalogueVersion.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'This product changed after the restore preview was loaded'),
    );
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Preview restore' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restore this version' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This product changed after the preview loaded',
    );
    expect(screen.getByText('Restore version 2?')).toBeInTheDocument();
  });

  it('renders an explicit empty history state', async () => {
    fetchCatalogueVersions.mockResolvedValue({ ...list, versions: [], total: 0 });
    renderPanel();

    expect(await screen.findByText('No catalogue versions have been recorded yet.')).toBeInTheDocument();
  });
});
