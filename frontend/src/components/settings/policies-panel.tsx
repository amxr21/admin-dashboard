'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, History, RotateCcw } from 'lucide-react';
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
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Timestamp } from '@/components/timestamp';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import type { Locale } from '@/i18n/routing';
import { LOCALES } from '@/i18n/routing';
import {
  fetchPolicies,
  fetchPolicyVersions,
  POLICY_TYPES,
  publishPolicy,
  revertPolicy,
  type PolicySummary,
  type PolicyType,
  type PolicyVersion,
} from '@/lib/policies-api';

/**
 * Return/Privacy/Terms/Shipping policy documents (B3.5) — per locale,
 * versioned. Every publish INSERTS a new version rather than overwriting —
 * see `policies.service.ts`'s doc comment — so the grid always shows the
 * live text while the drawer's history list stays a genuine append-only
 * record, same discipline as inventory's stock movement log.
 */
export function PoliciesPanel() {
  const t = useTranslations('settings.policies');

  const [policies, setPolicies] = useState<PolicySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ type: PolicyType; locale: Locale } | null>(null);
  const translateError = useTranslatedApiError();

  const load = useCallback(async () => {
    setError(null);
    try {
      setPolicies(await fetchPolicies());
    } catch (caught) {
      setError(translateError(caught));
      setPolicies(null);
    }
  }, [translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  function summaryFor(type: PolicyType, locale: Locale): PolicySummary | undefined {
    return policies?.find((p) => p.type === type && p.locale === locale);
  }

  return (
    <section aria-labelledby="settings-group-policies" className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <FileText className="text-primary size-5" aria-hidden="true" />
          <h2 id="settings-group-policies" className="text-lg font-semibold tracking-tight">
            {t('title')}
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      {error ? (
        <div className="bg-card/50 space-y-2 rounded-lg border p-4">
          <p className="text-destructive text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t('retry')}
          </Button>
        </div>
      ) : policies === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {POLICY_TYPES.map((type) => (
            <div key={type} className="bg-card/50 space-y-3 rounded-lg border p-4">
              <p className="text-sm font-medium">{t(`types.${type}`)}</p>
              <div className="space-y-2">
                {LOCALES.map((locale) => {
                  const summary = summaryFor(type, locale);
                  return (
                    <button
                      key={locale}
                      type="button"
                      onClick={() => setEditing({ type, locale })}
                      className="hover:bg-accent flex w-full items-center justify-between rounded-md border px-3 py-2 text-start text-sm transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground uppercase">{locale}</span>
                        {summary?.version ? (
                          <span className="text-muted-foreground">
                            {t('version', { version: summary.version })}
                          </span>
                        ) : (
                          <span className="text-warning">{t('unpublished')}</span>
                        )}
                      </span>
                      {summary?.updatedAt ? <Timestamp value={summary.updatedAt} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <PolicyEditorSheet
          type={editing.type}
          locale={editing.locale}
          initialSummary={summaryFor(editing.type, editing.locale) ?? null}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
    </section>
  );
}

function PolicyEditorSheet({
  type,
  locale,
  initialSummary,
  onDone,
}: {
  type: PolicyType;
  locale: Locale;
  initialSummary: PolicySummary | null;
  onDone: () => void;
}) {
  const t = useTranslations('settings.policies');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [content, setContent] = useState(initialSummary?.content ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<PolicyVersion[] | null>(null);
  const [reverting, setReverting] = useState<PolicyVersion | null>(null);
  const [isReverting, setIsReverting] = useState(false);

  const loadVersions = useCallback(async () => {
    try {
      setVersions(await fetchPolicyVersions(type, locale));
    } catch (caught) {
      toast.error(translateError(caught));
    }
  }, [type, locale, translateError]);

  useEffect(() => {
    if (showHistory) void loadVersions();
  }, [showHistory, loadVersions]);

  async function submit() {
    setIsSaving(true);
    setError(null);
    try {
      await publishPolicy(type, locale, content);
      toast.success(t('published'));
      onDone();
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmRevert() {
    if (!reverting) return;

    setIsReverting(true);
    try {
      const version = await revertPolicy(type, locale, reverting.id);
      setContent(version.content);
      setReverting(null);
      setShowHistory(false);
      toast.success(t('reverted', { version: reverting.version }));
      await loadVersions();
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsReverting(false);
    }
  }

  const dirty = content.trim() !== (initialSummary?.content ?? '').trim();

  return (
    <Sheet open onOpenChange={(next) => !next && onDone()}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        title={`${t(`types.${type}`)} — ${locale.toUpperCase()}`}
        className="space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {t(`types.${type}`)} — {locale.toUpperCase()}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {initialSummary?.version
                ? t('version', { version: initialSummary.version })
                : t('unpublished')}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowHistory(true)}>
            <History aria-hidden />
            {t('history')}
          </Button>
        </div>

        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={16}
          disabled={isSaving}
          placeholder={t('contentPlaceholder')}
        />

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button size="sm" disabled={isSaving || !content.trim() || !dirty} onClick={() => void submit()}>
            {isSaving ? t('publishing') : t('publish')}
          </Button>
          <Button variant="outline" size="sm" onClick={onDone}>
            {t('cancel')}
          </Button>
        </div>
      </SheetContent>

      {showHistory ? (
        <Sheet open onOpenChange={(next) => !next && setShowHistory(false)}>
          <SheetContent side="end" variant={editPanelMode} title={t('history')} className="space-y-4">
            <h2 className="text-lg font-semibold">{t('history')}</h2>

            {versions === null ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : versions.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('historyEmpty')}</p>
            ) : (
              <ul className="divide-y">
                {versions.map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t('version', { version: version.version })}</p>
                      <Timestamp value={version.createdAt} />
                    </div>
                    {version.version !== initialSummary?.version ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setReverting(version)}
                      >
                        <RotateCcw aria-hidden />
                        {t('revert')}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-xs">{t('current')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SheetContent>
        </Sheet>
      ) : null}

      <AlertDialog
        open={reverting !== null}
        onOpenChange={(next) => {
          if (!next) setReverting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('confirmRevert.title', { version: reverting?.version ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('confirmRevert.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('confirmRevert.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isReverting}
              onClick={(event) => {
                event.preventDefault();
                void confirmRevert();
              }}
            >
              {t('confirmRevert.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
