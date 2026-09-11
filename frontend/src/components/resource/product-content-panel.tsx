'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  fetchProductContent,
  saveProductTranslation,
  type LocalizedProductContent,
  type ProductContentInput,
} from '@/lib/product-content-api';

interface ProductContentPanelProps {
  productId: string;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMPTY_CONTENT: ProductContentInput = {
  name: null,
  description: null,
  metaTitle: null,
  metaDescription: null,
};

function editable(content: LocalizedProductContent | undefined): ProductContentInput {
  return content
    ? {
        name: content.name,
        description: content.description,
        metaTitle: content.metaTitle,
        metaDescription: content.metaDescription,
      }
    : EMPTY_CONTENT;
}

function clean(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function ProductContentPanel({
  productId,
  productName,
  open,
  onOpenChange,
}: ProductContentPanelProps) {
  const t = useTranslations('productContent');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [fallback, setFallback] = useState<LocalizedProductContent | null>(null);
  const [original, setOriginal] = useState<ProductContentInput>(EMPTY_CONTENT);
  const [values, setValues] = useState<ProductContentInput>(EMPTY_CONTENT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(original),
    [original, values],
  );
  useUnsavedChangesGuard(open && isDirty);

  function load() {
    setIsLoading(true);
    setError(null);
    void fetchProductContent(productId)
      .then((contract) => {
        const next = editable(contract.content.find((entry) => entry.locale === 'ar'));
        setFallback(contract.content.find((entry) => entry.locale === contract.defaultLocale) ?? null);
        setOriginal(next);
        setValues(next);
      })
      .catch((caught: unknown) => setError(translateError(caught)))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    if (open) load();
    // The panel deliberately reloads only when it opens or changes product.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  function requestClose(next: boolean) {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (isDirty && !isSaving) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  }

  function setField(field: keyof ProductContentInput, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const contract = await saveProductTranslation(productId, 'ar', {
        name: clean(values.name ?? ''),
        description: clean(values.description ?? ''),
        metaTitle: clean(values.metaTitle ?? ''),
        metaDescription: clean(values.metaDescription ?? ''),
      });
      const next = editable(contract.content.find((entry) => entry.locale === 'ar'));
      setOriginal(next);
      setValues(next);
      toast.success(t('saved'));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent
          side="end"
          variant={editPanelMode}
          className="w-full max-w-lg overflow-y-auto"
          title={t('title', { name: productName })}
          onEscapeKeyDown={(event) => {
            if (isDirty) {
              event.preventDefault();
              setConfirmDiscard(true);
            }
          }}
          onInteractOutside={(event) => {
            if (isDirty) {
              event.preventDefault();
              setConfirmDiscard(true);
            }
          }}
        >
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('title', { name: productName })}</h2>
            <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
          </div>

          {error ? (
            <div role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              <p>{error}</p>
              {!fallback ? (
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={load}>
                  {t('retry')}
                </Button>
              ) : null}
            </div>
          ) : null}

          {isLoading ? (
            <div className="space-y-4" aria-label={t('loading')}>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : fallback ? (
            <form onSubmit={(event) => void submit(event)} className="space-y-5" dir="rtl">
              <p className="bg-muted/60 rounded-md px-3 py-2 text-sm">{t('fallbackHelp')}</p>

              <div className="space-y-2">
                <Label htmlFor="product-content-name-ar">{t('fields.name')}</Label>
                <Input
                  id="product-content-name-ar"
                  value={values.name ?? ''}
                  maxLength={200}
                  placeholder={fallback.name ?? undefined}
                  onChange={(event) => setField('name', event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="product-content-description-ar">{t('fields.description')}</Label>
                <Textarea
                  id="product-content-description-ar"
                  value={values.description ?? ''}
                  maxLength={10_000}
                  placeholder={fallback.description ?? undefined}
                  onChange={(event) => setField('description', event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="product-content-meta-title-ar">{t('fields.metaTitle')}</Label>
                <Input
                  id="product-content-meta-title-ar"
                  value={values.metaTitle ?? ''}
                  maxLength={160}
                  placeholder={fallback.metaTitle ?? fallback.name ?? undefined}
                  onChange={(event) => setField('metaTitle', event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="product-content-meta-description-ar">
                  {t('fields.metaDescription')}
                </Label>
                <Textarea
                  id="product-content-meta-description-ar"
                  value={values.metaDescription ?? ''}
                  maxLength={320}
                  placeholder={fallback.metaDescription ?? fallback.description ?? undefined}
                  onChange={(event) => setField('metaDescription', event.target.value)}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={() => requestClose(false)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="submit"
                  className="min-h-11 sm:min-h-9"
                  disabled={!isDirty || isSaving}
                >
                  {isSaving ? t('saving') : t('save')}
                </Button>
              </div>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discard.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discard.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('discard.keep')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscard(false);
                setValues(original);
                onOpenChange(false);
              }}
            >
              {t('discard.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
