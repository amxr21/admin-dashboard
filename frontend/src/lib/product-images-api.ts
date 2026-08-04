import { apiFetch } from '@/lib/api';

/**
 * Client for a product's image gallery (`/api/v1/products/:id/images`,
 * `/api/v1/images/:id`) — additional images beyond `Product.imageUrl` (the
 * cover image, untouched by any of this, still edited through the generic
 * resource form).
 */

export interface ProductImage {
  id: string;
  url: string;
  position: number;
  productId: string;
  createdAt: string;
}

export async function fetchImages(productId: string): Promise<ProductImage[]> {
  const body = await apiFetch<{ images: ProductImage[] }>(`/products/${productId}/images`);
  return body.images;
}

export async function addImage(productId: string, url: string): Promise<ProductImage> {
  const body = await apiFetch<{ image: ProductImage }>(`/products/${productId}/images`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  return body.image;
}

/** Replaces the WHOLE order — send every image id for this product, once each. */
export async function reorderImages(productId: string, ids: string[]): Promise<ProductImage[]> {
  const body = await apiFetch<{ images: ProductImage[] }>(
    `/products/${productId}/images/order`,
    { method: 'PUT', body: JSON.stringify({ ids }) },
  );
  return body.images;
}

export async function deleteImage(id: string): Promise<void> {
  await apiFetch<undefined>(`/images/${id}`, { method: 'DELETE' });
}
