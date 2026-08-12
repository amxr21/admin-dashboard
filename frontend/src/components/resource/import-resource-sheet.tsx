'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  applyResourceImport,
  downloadImportTemplate,
  previewResourceImport,
  type ImportPreview,
  type ImportResult,
} from '@/lib/resource-api';

/**
 * CSV import for the generic resource engine (A2.13).
 *
 * ─── THREE STEPS, NOT ONE CLICK ───────────────────────────────────────
 * pick a file → preview (every row validated, NOTHING written) → confirm.
 * The preview step exists because "no silent partial writes" is a promise
 * about the WHOLE file, and the only honest way to make that promise
 * believable before committing is to show every row's outcome first, not
 * just the first error encountered.
 *
 * ─── A SEPARATE COMPONENT FROM ResourceForm, ON PURPOSE ───────────────
 * Same reasoning as InviteStaffSheet vs. StaffSheet: a single-row create
 * form and a multi-row batch preview have almost no UI in common (no field
 * inputs here at all), and forcing this into ResourceForm as a third mode
 * would mean threading "am I importing a whole file" through a component
 * that has no other reason to know that.
 */

type Step = 'pick' | 'preview' | 'done';

interface ImportResourceSheetProps {
  resource: string;
  resourceLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful apply, so the caller can reload the list. */
  onImported: () => void;
}

export function ImportResourceSheet({
  resource,
  resourceLabel,
  open,
  onOpenChange,
  onImported,
}: ImportResourceSheetProps) {
  const t = useTranslations('resource.import');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep('pick');
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFileChosen(chosen: File) {
    setFile(chosen);
    setError(null);
    setIsWorking(true);

    try {
      setPreview(await previewResourceImport(resource, chosen));
      setStep('preview');
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleApply() {
    if (!file) return;

    setIsWorking(true);
    setError(null);

    try {
      const applied = await applyResourceImport(resource, file);
      setResult(applied);
      setStep('done');
      // Even a fully-failed apply is worth a reload — nothing changed, but
      // the caller doesn't need to know that to decide whether to refresh.
      if (applied.imported > 0) onImported();
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsWorking(false);
    }
  }

  const shown = step === 'done' ? result : preview;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onOpenChange(false);
        }
      }}
    >
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-lg overflow-y-auto"
        title={t('title', { label: resourceLabel })}
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t('title', { label: resourceLabel })}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
          </div>

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          {step === 'pick' ? (
            <div className="space-y-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => void downloadImportTemplate(resource)}
              >
                <Download aria-hidden className="me-1 size-4" />
                {t('downloadTemplate')}
              </Button>

              <div className="space-y-2">
                <label
                  htmlFor="import-file"
                  className="border-input hover:bg-muted flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center"
                >
                  <Upload aria-hidden className="text-muted-foreground size-6" />
                  <span className="text-sm font-medium">{t('pickFile')}</span>
                  <span className="text-muted-foreground text-xs">{t('pickFileHint')}</span>
                </label>
                <input
                  ref={fileInputRef}
                  id="import-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  disabled={isWorking}
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) void handleFileChosen(chosen);
                  }}
                />
                {isWorking && step === 'pick' ? (
                  <p className="text-muted-foreground text-sm">{t('validating')}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {(step === 'preview' || step === 'done') && shown ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                {shown.errors.length === 0 ? (
                  <CheckCircle2 aria-hidden className="text-primary size-4" />
                ) : (
                  <AlertTriangle aria-hidden className="text-destructive size-4" />
                )}
                <span>
                  {step === 'done'
                    ? t('summary.applied', {
                        imported: (shown as ImportResult).imported,
                        total: shown.totalRows,
                      })
                    : t('summary.preview', {
                        valid: shown.validRows,
                        total: shown.totalRows,
                      })}
                </span>
              </div>

              {shown.errors.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {t('errorsHeading', { count: shown.errors.length })}
                  </p>
                  <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                    {shown.errors.map((rowError, index) => (
                      <li
                        key={index}
                        className="bg-destructive/10 text-destructive rounded-md px-3 py-2"
                      >
                        {t('errorRow', { row: rowError.row })}
                        {': '}
                        {rowError.message}
                      </li>
                    ))}
                  </ul>
                  {step === 'preview' ? (
                    <p className="text-muted-foreground text-sm">{t('fixAndRetry')}</p>
                  ) : null}
                </div>
              ) : null}

              {step === 'preview' ? (
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      reset();
                    }}
                    disabled={isWorking}
                  >
                    {t('cancel')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleApply()}
                    disabled={isWorking || shown.errors.length > 0}
                  >
                    {isWorking ? t('importing') : t('confirmImport', { count: shown.validRows })}
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => {
                      reset();
                      onOpenChange(false);
                    }}
                  >
                    {t('close')}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
