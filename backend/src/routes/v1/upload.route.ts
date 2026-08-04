import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { isUploadConfigured, uploadImage } from '../../services/upload.service.js';

/**
 * Image upload — a generic utility, not tied to one resource. Both the
 * Settings logo field and any resource form's `image`-type field (products,
 * ...) point at this same route; the actual WRITE that stores the resulting
 * URL still goes through that resource's own normal, permission-checked save
 * (`PATCH /settings`, `PATCH /r/products/:id`, ...). This route only ever
 * answers "here is a URL for the bytes you sent me" — no area-specific
 * meaning to gate beyond "signed in, not a read-only demo account", which
 * `authenticate` already provides via `assertCanWrite`.
 */

export const uploadRouter = Router();

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** 5 MB — generous for a logo or product photo, small enough that a runaway
 *  upload can't be used to exhaust memory (this is buffered, not streamed to
 *  disk, so the limit bounds RAM per request directly). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(AppError.badRequest('Only JPEG, PNG, WEBP or GIF images are allowed'));
      return;
    }
    callback(null, true);
  },
});

const ALLOWED_FOLDERS = new Set(['logo', 'products', 'categories']);

/**
 * `upload.single('file')` invoked by hand rather than mounted as ordinary
 * router middleware — its errors (`MulterError`, e.g. "file too large") are
 * NOT `AppError`, so left to propagate on their own they would fall through
 * `errorHandler`'s default branch: a clean "pick a smaller file" mistake
 * would be logged as a bug and shipped to Sentry as an INTERNAL_ERROR. This
 * wrapper normalises the multer-specific failure into an `AppError` before
 * it ever reaches the global handler; anything else (including the
 * `fileFilter` rejection above, already an `AppError`) passes through as-is.
 */
function parseUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      next(
        AppError.badRequest(
          err.code === 'LIMIT_FILE_SIZE'
            ? `File is too large — the limit is ${String(MAX_FILE_BYTES / (1024 * 1024))}MB`
            : err.message,
        ),
      );
      return;
    }

    next(err);
  });
}

uploadRouter.post('/upload/image', authenticate, parseUpload, async (req, res) => {
  const user = requireUser(req);

  if (!isUploadConfigured()) {
    throw AppError.badRequest(
      'Image upload is not configured on this server. Ask a developer to set the CLOUDINARY_* environment variables.',
    );
  }

  if (!req.file) {
    throw AppError.badRequest('No file uploaded — send it as multipart form field "file"');
  }

  // An allowlist, same reasoning as every other allowlist in this app
  // (admin.config.ts, settings.config.ts): a free-form folder name from the
  // client would let anyone scatter uploads across an unbounded set of
  // Cloudinary folders. `req.body` is a multer-parsed multipart body — always
  // string fields, but untyped, so narrow it explicitly rather than trusting it.
  const body: unknown = req.body;
  const folderField =
    typeof body === 'object' && body !== null && 'folder' in body
      ? (body as Record<string, unknown>).folder
      : undefined;
  const folder =
    typeof folderField === 'string' && ALLOWED_FOLDERS.has(folderField) ? folderField : 'misc';

  const result = await uploadImage(req.file.buffer, folder);

  req.log.info({
    event: 'upload.image.succeeded',
    folder,
    bytes: req.file.size,
    userId: user.id,
  });

  res.status(201).json({ data: result });
});
