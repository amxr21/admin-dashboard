import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ProductGalleryPanel } from '../product-gallery-panel';
import type { ProductImage } from '@/lib/product-images-api';

/**
 * A product's image gallery. The property worth pinning: reorder sends the
 * FULL new order every time (the server replaces the whole list atomically —
 * see product-images.service.ts), not a single "move this one" delta.
 */

const fetchImages = vi.hoisted(() => vi.fn());
const addImage = vi.hoisted(() => vi.fn());
const reorderImages = vi.hoisted(() => vi.fn());
const deleteImage = vi.hoisted(() => vi.fn());
const uploadImage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/product-images-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/product-images-api')>();
  return { ...actual, fetchImages, addImage, reorderImages, deleteImage };
});

vi.mock('@/lib/upload-api', () => ({ uploadImage }));

function makeImage(overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    id: 'i1',
    url: 'https://cdn.example.com/1.png',
    position: 0,
    productId: 'p1',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(open = true) {
  const onOpenChange = vi.fn();
  const result = render(
    <ProductGalleryPanel
      productId="p1"
      productName="Ceramic Planter"
      open={open}
      onOpenChange={onOpenChange}
    />,
  );
  return { ...result, onOpenChange };
}

beforeEach(() => {
  fetchImages.mockReset();
  addImage.mockReset();
  reorderImages.mockReset();
  deleteImage.mockReset();
  uploadImage.mockReset();
});

describe('listing', () => {
  it('shows an empty state with no images', async () => {
    fetchImages.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/no gallery images yet/i)).toBeInTheDocument();
  });

  it('renders each image', async () => {
    fetchImages.mockResolvedValue([
      makeImage({ id: 'i1', url: 'https://cdn.example.com/a.png', position: 0 }),
      makeImage({ id: 'i2', url: 'https://cdn.example.com/b.png', position: 1 }),
    ]);
    renderPanel();

    expect(await screen.findByText('https://cdn.example.com/a.png')).toBeInTheDocument();
    expect(screen.getByText('https://cdn.example.com/b.png')).toBeInTheDocument();
  });
});

describe('uploading an image', () => {
  it('adds the uploaded image to the list', async () => {
    fetchImages.mockResolvedValue([]);
    uploadImage.mockResolvedValue({ url: 'https://cdn.example.com/new.png' });
    addImage.mockResolvedValue(makeImage({ id: 'new', url: 'https://cdn.example.com/new.png' }));
    renderPanel();

    await screen.findByText(/no gallery images yet/i);
    // Sheet content is portalled to document.body, not the render `container`.
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(addImage).toHaveBeenCalledWith('p1', 'https://cdn.example.com/new.png');
    });
    expect(await screen.findByText('https://cdn.example.com/new.png')).toBeInTheDocument();
  });
});

describe('reordering', () => {
  it('moving the second image up sends the full new order', async () => {
    fetchImages.mockResolvedValue([
      makeImage({ id: 'i1', url: 'https://cdn.example.com/a.png', position: 0 }),
      makeImage({ id: 'i2', url: 'https://cdn.example.com/b.png', position: 1 }),
    ]);
    reorderImages.mockResolvedValue([
      makeImage({ id: 'i2', url: 'https://cdn.example.com/b.png', position: 0 }),
      makeImage({ id: 'i1', url: 'https://cdn.example.com/a.png', position: 1 }),
    ]);
    renderPanel();

    await screen.findByText('https://cdn.example.com/a.png');
    const upButtons = screen.getAllByRole('button', { name: 'Move up' });
    // The first image's "up" is disabled (already first) — click the second's.
    await userEvent.click(upButtons[1]!);

    await waitFor(() => {
      expect(reorderImages).toHaveBeenCalledWith('p1', ['i2', 'i1']);
    });
  });

  it('disables moving the first image up and the last image down', async () => {
    fetchImages.mockResolvedValue([
      makeImage({ id: 'i1', url: 'https://cdn.example.com/a.png', position: 0 }),
      makeImage({ id: 'i2', url: 'https://cdn.example.com/b.png', position: 1 }),
    ]);
    renderPanel();

    await screen.findByText('https://cdn.example.com/a.png');
    const upButtons = screen.getAllByRole('button', { name: 'Move up' });
    const downButtons = screen.getAllByRole('button', { name: 'Move down' });

    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
  });
});

describe('deleting', () => {
  it('removes an image from the list', async () => {
    fetchImages.mockResolvedValue([makeImage()]);
    deleteImage.mockResolvedValue(undefined);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Remove image' }));

    await waitFor(() => expect(deleteImage).toHaveBeenCalledWith('i1'));
    await waitFor(() =>
      expect(screen.queryByText('https://cdn.example.com/1.png')).not.toBeInTheDocument(),
    );
  });
});
