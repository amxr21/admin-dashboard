'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImageOff, Loader2, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { uploadImage } from '@/lib/upload-api';
import { cn } from '@/lib/utils';

/**
 * "Upload from your computer" for an image-URL field — logo in Settings,
 * `imageUrl` on a product, and anywhere else `admin.config.ts` declares an
 * `image`-type field. Replaces asking someone to paste a link they hosted
 * themselves somewhere else.
 *
 * ─── WHY A URL FIELD STILL EXISTS UNDERNEATH ─────────────────────────────
 * Cloudinary is opt-in per deployment (see `upload.service.ts` —
 * `CLOUDINARY_*` env vars are all optional). A store that hasn't configured
 * it gets a clear "not configured" message from the upload attempt, and the
 * `showUrlFallback` toggle still lets them paste a URL directly — this is a
 * plug-and-play template for ANY business, not just ones that use
 * Cloudinary, so the control must not go dead the moment the feature is
 * unconfigured.
 */

interface ImageUploadFieldProps {
  id: string;
  value: string;
  onChange: (url: string) => void;
  /** Which Cloudinary folder this upload belongs in — see `upload-api.ts`. */
  folder: string;
  /** `'square'` (logo, a small rounded box) or `'wide'` (a product photo,
   *  wider aspect so a real photo doesn't look cropped to a stamp). */
  shape?: 'square' | 'wide';
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function ImageUploadField({
  id,
  value,
  onChange,
  folder,
  shape = 'square',
  disabled = false,
  ...aria
}: ImageUploadFieldProps) {
  const t = useTranslations('imageUpload');
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrlFallback, setShowUrlFallback] = useState(false);
  // Broken-image fallback: a stale/deleted URL should show the same "no
  // image" placeholder as having none, not a broken-image browser icon.
  const [previewFailed, setPreviewFailed] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setIsUploading(true);

    try {
      const result = await uploadImage(file, folder);
      setPreviewFailed(false);
      onChange(result.url);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('failed'));
    } finally {
      setIsUploading(false);
      // Lets the same file be re-selected immediately after a failure —
      // browsers do not fire `change` again for an unchanged file list.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'bg-muted border-border relative flex shrink-0 items-center justify-center overflow-hidden border',
            shape === 'square' ? 'size-16 rounded-lg' : 'h-16 w-28 rounded-md',
          )}
        >
          {value && !previewFailed ? (
            // Plain <img>, not next/image — same reasoning as resource-cell.tsx:
            // the URL is admin-supplied/Cloudinary-hosted at runtime, not a
            // build-time known host next/image could be configured for.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="size-full object-cover"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <ImageOff className="text-muted-foreground size-5" aria-hidden />
          )}

          {isUploading ? (
            <div className="bg-background/70 absolute inset-0 flex items-center justify-center">
              <Loader2 className="text-muted-foreground size-5 animate-spin" aria-hidden />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || isUploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden />
              {value ? t('replace') : t('upload')}
            </Button>

            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || isUploading}
                onClick={() => {
                  onChange('');
                  setPreviewFailed(false);
                }}
              >
                <X aria-hidden />
                {t('remove')}
              </Button>
            ) : null}
          </div>

          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-start text-xs underline"
            onClick={() => setShowUrlFallback((current) => !current)}
          >
            {t('pasteUrlInstead')}
          </button>
        </div>

        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          disabled={disabled || isUploading}
          {...aria}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      {showUrlFallback ? (
        <Input
          type="url"
          value={value}
          placeholder={t('urlPlaceholder')}
          disabled={disabled}
          className="force-ltr"
          onChange={(event) => {
            setPreviewFailed(false);
            onChange(event.target.value);
          }}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
