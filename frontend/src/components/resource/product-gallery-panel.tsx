'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, ImageIcon, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { ImageUploadField } from '@/components/image-upload-field';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  addImage,
  deleteImage,
  fetchImages,
  reorderImages,
  type ProductImage,
} from '@/lib/product-images-api';

/**
 * Manage a product's image gallery — additional photos beyond
 * `Product.imageUrl` (the cover image, edited through the generic form,
 * untouched here). Reorder is up/down per row rather than drag-and-drop: the
 * server API already takes a full ordered id list either way, and a
 * keyboard-operable button pair needs no extra a11y work drag-and-drop would.
 */

interface ProductGalleryPanelProps {
  productId: string;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductGalleryPanel({
  productId,
  productName,
  open,
  onOpenChange,
}: ProductGalleryPanelProps) {
  const t = useTranslations('productGallery');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [images, setImages] = useState<ProductImage[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);

  function load() {
    setIsLoading(true);
    setError(null);
    fetchImages(productId)
      .then(setImages)
      .catch((caught: unknown) => setError(translateError(caught)))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  async function move(index: number, direction: -1 | 1) {
    if (!images) return;
    const target = index + direction;
    if (target < 0 || target >= images.length) return;

    const reordered = [...images];
    const temp = reordered[index]!;
    reordered[index] = reordered[target]!;
    reordered[target] = temp;

    setIsReordering(true);
    setError(null);
    try {
      setImages(await reorderImages(productId, reordered.map((image) => image.id)));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsReordering(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-lg overflow-y-auto"
        title={t('title', { name: productName })}
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t('title', { name: productName })}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
          </div>

          <ImageUploadField
            id="gallery-add"
            value=""
            folder="products"
            onChange={(url) => {
              if (!url) return;
              void addImage(productId, url)
                .then((image) => setImages((current) => [...(current ?? []), image]))
                .catch((caught: unknown) => setError(translateError(caught)));
            }}
          />

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : !images || images.length === 0 ? (
            <EmptyState icon={ImageIcon} title={t('empty')} />
          ) : (
            <ul className="space-y-2">
              {images.map((image, index) => (
                <li key={image.id} className="bg-card flex items-center gap-3 rounded-lg border p-2">
                  {/* Admin-supplied/Cloudinary-hosted at runtime — same reasoning
                      as resource-cell.tsx for why this is a plain <img>. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt=""
                    className="bg-muted size-14 shrink-0 rounded-md object-cover"
                  />
                  <p className="force-ltr text-muted-foreground min-w-0 flex-1 truncate text-xs">
                    {image.url}
                  </p>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t('moveUp')}
                      disabled={index === 0 || isReordering}
                      onClick={() => void move(index, -1)}
                    >
                      <ChevronUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t('moveDown')}
                      disabled={index === images.length - 1 || isReordering}
                      onClick={() => void move(index, 1)}
                    >
                      <ChevronDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('delete')}
                      onClick={() => {
                        void deleteImage(image.id)
                          .then(() =>
                            setImages((current) => current?.filter((i) => i.id !== image.id) ?? current),
                          )
                          .catch((caught: unknown) => setError(translateError(caught)));
                      }}
                    >
                      <Trash2 className="text-destructive size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
