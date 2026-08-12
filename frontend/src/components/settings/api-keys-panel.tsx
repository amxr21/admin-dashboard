'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, KeyRound, Plus, ShieldOff, TriangleAlert } from 'lucide-react';
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
import { Timestamp } from '@/components/timestamp';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  createApiKey,
  fetchApiKeys,
  revokeApiKey,
  type ApiKeySummary,
  type CreatedApiKey,
} from '@/lib/api-key-api';

/**
 * API keys (B3.2, scoped to keys only — webhooks parked, see MASTER_TODO.md).
 *
 * ─── A KEY ACTS AS ITS OWNER, EXACTLY ─────────────────────────────────
 * There is no per-key scope picker here because there is no per-key scope on
 * the backend — see `ApiKey`'s schema doc comment. A key created from this
 * panel can do exactly what the signed-in account can do, nothing more and
 * nothing less. That is the whole reason this form only ever asks for a name.
 */
export function ApiKeysPanel() {
  const t = useTranslations('settings.apiKeys');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setKeys(await fetchApiKeys());
    } catch (caught) {
      setError(translateError(caught));
      setKeys(null);
    } finally {
      setIsLoading(false);
    }
  }, [translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmRevoke() {
    if (!revoking) return;

    setIsRevoking(true);
    try {
      await revokeApiKey(revoking.id);
      toast.success(t('revoked'));
      setRevoking(null);
      await load();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError && caught.status === 404
          ? t('alreadyGone')
          : translateError(caught),
      );
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <section aria-labelledby="settings-group-api-keys" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <KeyRound className="text-primary size-5" aria-hidden="true" />
            <h2 id="settings-group-api-keys" className="text-lg font-semibold tracking-tight">
              {t('title')}
            </h2>
          </div>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>

        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          {t('create')}
        </Button>
      </div>

      <div className="bg-card/50 space-y-2 rounded-lg border p-4">
        {error ? (
          <div className="space-y-2">
            <p className="text-destructive text-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : keys && keys.length > 0 ? (
          <ul className="divide-y">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{key.name}</p>
                  <p className="text-muted-foreground flex items-center gap-1 text-xs">
                    <code className="force-ltr">{key.keyPreview}</code>
                    <span>·</span>
                    {key.lastUsedAt ? (
                      <span className="flex items-center gap-1">
                        {t('lastUsedPrefix')}
                        <Timestamp value={key.lastUsedAt} />
                      </span>
                    ) : (
                      <span>{t('neverUsed')}</span>
                    )}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevoking(key)}
                >
                  <ShieldOff aria-hidden className="text-destructive" />
                  {t('revoke')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        )}
      </div>

      {creating ? (
        <CreateKeySheet
          editPanelMode={editPanelMode}
          onDone={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(next) => {
          if (!next) setRevoking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirm.title', { name: revoking?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRevoking}
              onClick={(event) => {
                event.preventDefault();
                void confirmRevoke();
              }}
            >
              {t('confirm.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

type CreateStep = 'name' | 'reveal';

function CreateKeySheet({
  editPanelMode,
  onDone,
}: {
  editPanelMode: 'drawer' | 'modal';
  onDone: () => void;
}) {
  const t = useTranslations('settings.apiKeys');
  const translateError = useTranslatedApiError();

  const [step, setStep] = useState<CreateStep>('name');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  async function submit() {
    setIsSaving(true);
    setError(null);

    try {
      const result = await createApiKey(name.trim());
      setCreated(result);
      setStep('reveal');
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      // Clipboard access can be refused. The key is on screen and
      // selectable — a convenience failing, not the feature failing.
      setCopied(false);
    }
  }

  if (step === 'reveal' && created) {
    return (
      <AlertDialog open onOpenChange={() => {}}>
        <AlertDialogContent
          className="max-w-md space-y-4"
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <div className="flex items-start gap-3">
            <KeyRound className="text-warning mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <AlertDialogTitle className="font-medium">{t('revealTitle')}</AlertDialogTitle>
              <p className="text-muted-foreground text-sm">{created.name}</p>
              <AlertDialogDescription className="mt-1 flex items-start gap-1.5">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t('shownOnce')}
              </AlertDialogDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <code className="bg-card force-ltr flex-1 select-all overflow-x-auto rounded-md border px-3 py-2 text-sm tracking-wide whitespace-nowrap">
              {created.key}
            </code>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void copyKey()}
                  aria-label={t('copy')}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('copy')}</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">{copied ? t('copied') : t('copyHint')}</p>
            <Button size="sm" onClick={onDone}>
              {t('done')}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Sheet open onOpenChange={(next) => !next && onDone()}>
      <SheetContent side="end" variant={editPanelMode} title={t('createTitle')} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('createTitle')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('createDescription')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-key-name">{t('nameLabel')}</Label>
          <Input
            id="api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('namePlaceholder')}
            autoFocus
            disabled={isSaving}
          />
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button size="sm" disabled={isSaving || !name.trim()} onClick={() => void submit()}>
            {isSaving ? t('creating') : t('create')}
          </Button>
          <Button variant="outline" size="sm" onClick={onDone}>
            {t('cancel')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
