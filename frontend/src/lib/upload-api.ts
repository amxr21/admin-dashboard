import { apiUpload } from '@/lib/api';

/**
 * Client for `POST /upload/image`. `folder` namespaces the upload
 * (`logo`, `products`, `categories`, ...) — the backend allowlists it, so an
 * unrecognised value there just falls back to a generic bucket rather than
 * failing; nothing here needs to keep its own copy of the allowed list.
 */

export interface UploadedImage {
  url: string;
}

export async function uploadImage(file: File, folder: string): Promise<UploadedImage> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  return apiUpload<UploadedImage>('/upload/image', formData);
}
