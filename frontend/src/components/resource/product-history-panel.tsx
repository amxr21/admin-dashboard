'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { History, RotateCcw } from 'lucide-react';
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
import { EmptyState } from '@/components/empty-state';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { ApiError } from '@/lib/api';
import {
  fetchCatalogueVersion,
  fetchCatalogueVersions,
  restoreCatalogueVersion,
  type CatalogueVersionDetail,
  type CatalogueVersionList,
  type CatalogueVersionSummary,
} from '@/lib/product-content-api';

interface ProductHistoryPanelProps {
  productId: string;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
}

export function ProductHistoryPanel({
  productId,
  productName,
  open,
  onOpenChange,
  onRestored,
}: ProductHistoryPanelProps) {
  const t = useTranslations('productHistory');
  const tStatus = useTranslations('productStatus');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();
  const [history, setHistory] = useState<CatalogueVersionList | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CatalogueVersionDetail | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  function load(nextPage = page) {
    setIsLoading(true);
    setError(null);
    void fetchCatalogueVersions(productId, nextPage)
      .then(setHistory)
      .catch((caught: unknown) => setError(translateError(caught)))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    setPage(1);
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  function showPreview(version: CatalogueVersionSummary) {
    setIsLoadingPreview(true);
    setRestoreError(null);
    void fetchCatalogueVersion(productId, version.version)
      .then(setPreview)
      .catch((caught: unknown) => setError(translateError(caught)))
      .finally(() => setIsLoadingPreview(false));
  }

  async function restore() {
    if (!preview) return;
    setIsRestoring(true);
    setRestoreError(null);
    try {
      await restoreCatalogueVersion(productId, preview.version, preview.currentUpdatedAt);
      toast.success(t('restored', { version: preview.version }));
      setPreview(null);
      onRestored();
    } catch (caught) {
      setRestoreError(
        caught instanceof ApiError && caught.status === 409
          ? t('conflict')
          : translateError(caught),
      );
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="end"
          variant={editPanelMode}
          className="w-full max-w-lg overflow-y-auto"
          title={t('title', { name: productName })}
        >
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('title', { name: productName })}</h2>
            <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
          </div>

          {error ? (
            <div role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              <p>{error}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => load()}>
                {t('retry')}
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-2" aria-label={t('loading')}>
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))}
            </div>
          ) : !history || history.versions.length === 0 ? (
            <EmptyState icon={History} title={t('empty')} />
          ) : (
            <div className="space-y-3">
              <ol className="space-y-2">
                {history.versions.map((version) => (
                  <li key={version.id} className="bg-card rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{t('version', { version: version.version })}</p>
                        <p className="text-muted-foreground text-sm">
                          {t(`sources.${version.source}`)}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {formatter.dateTime(new Date(version.createdAt), 'short')}
                          {version.actorEmail ? ` · ${version.actorEmail}` : ''}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11 sm:min-h-8"
                        disabled={isLoadingPreview}
                        onClick={() => showPreview(version)}
                      >
                        {t('preview')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>

              {history.totalPages > 1 ? (
                <div className="flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    disabled={page <= 1 || isLoading}
                    onClick={() => {
                      const next = page - 1;
                      setPage(next);
                      load(next);
                    }}
                  >
                    {t('previous')}
                  </Button>
                  <span className="text-muted-foreground text-sm">
                    {t('pageOf', { page, total: history.totalPages })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    disabled={page >= history.totalPages || isLoading}
                    onClick={() => {
                      const next = page + 1;
                      setPage(next);
                      load(next);
                    }}
                  >
                    {t('next')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preview
                ? t('restoreTitle', { version: preview.version })
                : t('restoreTitle', { version: 0 })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('restoreDescription')}</AlertDialogDescription>
          </AlertDialogHeader>

          {preview ? (
            <dl className="bg-muted/60 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-md p-3 text-sm">
              <dt className="text-muted-foreground">{t('fields.name')}</dt>
              <dd className="min-w-0 truncate font-medium">{preview.snapshot.name}</dd>
              <dt className="text-muted-foreground">{t('fields.price')}</dt>
              <dd>{preview.snapshot.price}</dd>
              <dt className="text-muted-foreground">{t('fields.status')}</dt>
              <dd>{tStatus(preview.snapshot.status)}</dd>
              <dt className="text-muted-foreground">{t('fields.arabicName')}</dt>
              <dd className="min-w-0 truncate" dir="rtl">
                {preview.snapshot.translations.find((entry) => entry.locale === 'ar')?.name ??
                  t('fallback')}
              </dd>
            </dl>
          ) : null}

          <p className="text-muted-foreground text-sm">{t('stockUnaffected')}</p>
          {restoreError ? (
            <p role="alert" className="text-destructive text-sm">
              {restoreError}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!preview || isRestoring}
              onClick={(event) => {
                event.preventDefault();
                void restore();
              }}
            >
              <RotateCcw aria-hidden />
              {isRestoring ? t('restoring') : t('restore')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
