import { v2 as cloudinary } from 'cloudinary';

import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

/**
 * Image uploads via Cloudinary — the one place a raw image URL field
 * (settings logo, a product's `imageUrl`, ...) gets an actual "upload from
 * your computer" control instead of asking someone to paste a link they
 * hosted somewhere else themselves.
 *
 * ─── WHY ALL THREE ENV VARS ARE CHECKED TOGETHER ─────────────────────
 * `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET` are all optional in
 * `env.ts` — this feature is opt-in per deployment, same as Sentry. But a
 * cloud name with no secret is a half-configuration that would only fail
 * once someone actually tried to upload something, at which point the
 * error would be confusing (Cloudinary's SDK, not this app's). Checking
 * completeness here, once, means the route can give one clear "not
 * configured" answer instead.
 */
export function isUploadConfigured(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

let configured = false;

function ensureConfigured(): void {
  if (configured) return;

  if (!isUploadConfigured()) {
    // Same shape as every other "optional integration, clearly refused when
    // absent" path in this app (see diagnostics.route.ts) — never a 500 that
    // reads as a bug.
    throw AppError.badRequest(
      'Image upload is not configured on this server. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
    );
  }

  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export interface UploadedImage {
  url: string;
}

/**
 * Streams a buffer straight to Cloudinary — no temp file on this server's
 * disk, which matters on Render's ephemeral filesystem.
 *
 * `folder` namespaces uploads by what they're for (`admin-dashboard/logo`,
 * `admin-dashboard/products`, ...) so a Cloudinary media-library browse isn't
 * one flat pile of images with no way to tell them apart.
 */
export async function uploadImage(buffer: Buffer, folder: string): Promise<UploadedImage> {
  ensureConfigured();

  return new Promise<UploadedImage>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `admin-dashboard/${folder}`,
        // Cloudinary infers the format from the bytes; this only guards
        // against accidentally uploading something that ISN'T an image
        // (the route also checks the mimetype before this ever runs).
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) {
          reject(
            error instanceof Error
              ? error
              : new Error('Cloudinary upload failed with no error detail'),
          );
          return;
        }

        resolve({ url: result.secure_url });
      },
    );

    stream.end(buffer);
  });
}
