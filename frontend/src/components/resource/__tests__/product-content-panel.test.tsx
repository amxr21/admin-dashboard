import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ProductContentPanel } from '../product-content-panel';
import type { ProductContentContract } from '@/lib/product-content-api';

const fetchProductContent = vi.hoisted(() => vi.fn());
const saveProductTranslation = vi.hoisted(() => vi.fn());

vi.mock('@/lib/product-content-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/product-content-api')>();
  return { ...actual, fetchProductContent, saveProductTranslation };
});

function contract(arName: string | null = null): ProductContentContract {
  return {
    defaultLocale: 'en',
    content: [
      {
        locale: 'en',
        name: 'Ceramic Planter',
        description: 'Default description',
        metaTitle: 'Planter title',
        metaDescription: null,
      },
      {
        locale: 'ar',
        name: arName,
        description: null,
        metaTitle: null,
        metaDescription: null,
      },
    ],
  };
}

function renderPanel() {
  const onOpenChange = vi.fn();
  render(
    <ProductContentPanel
      productId="p1"
      productName="Ceramic Planter"
      open
      onOpenChange={onOpenChange}
    />,
  );
  return onOpenChange;
}

beforeEach(() => {
  fetchProductContent.mockReset();
  saveProductTranslation.mockReset();
});

describe('localized product editor', () => {
  it('shows raw Arabic values and English field fallbacks', async () => {
    fetchProductContent.mockResolvedValue(contract('أصيص خزفي'));
    renderPanel();

    expect(await screen.findByLabelText('Arabic name')).toHaveValue('أصيص خزفي');
    expect(screen.getByLabelText('Arabic description')).toHaveAttribute(
      'placeholder',
      'Default description',
    );
  });

  it('normalizes blank fields to null when saving', async () => {
    fetchProductContent.mockResolvedValue(contract());
    saveProductTranslation.mockResolvedValue(contract('أصيص خزفي'));
    renderPanel();

    const name = await screen.findByLabelText('Arabic name');
    await userEvent.type(name, '  أصيص خزفي  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save Arabic content' }));

    await waitFor(() => {
      expect(saveProductTranslation).toHaveBeenCalledWith('p1', 'ar', {
        name: 'أصيص خزفي',
        description: null,
        metaTitle: null,
        metaDescription: null,
      });
    });
  });

  it('protects unsaved localized text when the panel is closed', async () => {
    fetchProductContent.mockResolvedValue(contract());
    const onOpenChange = renderPanel();

    await userEvent.type(await screen.findByLabelText('Arabic name'), 'منتج');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Discard localized-content changes?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders a recoverable loading failure', async () => {
    fetchProductContent.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(contract());
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server");
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Arabic name')).toBeInTheDocument();
    expect(fetchProductContent).toHaveBeenCalledTimes(2);
  });
});
