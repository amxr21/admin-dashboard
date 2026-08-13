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
  /** Null means nobody has written alt text yet — distinct from `""`,
   *  which would mean someone explicitly cleared it. */
  alt: string | null;
  position: number;
  productId: string;
  createdAt: string;
}

export async function fetchImages(productId: string): Promise<ProductImage[]> {
  const body = await apiFetch<{ images: ProductImage[] }>(`/products/${productId}/images`);
  return body.images;
}

export async function addImage(
  productId: string,
  url: string,
  alt?: string,
): Promise<ProductImage> {
  const body = await apiFetch<{ image: ProductImage }>(`/products/${productId}/images`, {
    method: 'POST',
    body: JSON.stringify({ url, ...(alt ? { alt } : {}) }),
  });
  return body.image;
}

/** `null` clears alt text back to unset, not to an empty string. */
export async function setImageAlt(id: string, alt: string | null): Promise<ProductImage> {
  const body = await apiFetch<{ image: ProductImage }>(`/images/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ alt }),
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
