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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Timestamp } from '@/components/timestamp';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AREAS, type Area } from '@/config/areas';
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
 * ─── A KEY ACTS AS ITS OWNER, OPTIONALLY NARROWED ─────────────────────
 * A key can never do MORE than the signed-in account — the backend checks the
 * owner's role first and the key's scopes second, as an intersection (see
 * `requireArea`). Choosing areas here therefore only ever removes access,
 * which is what makes a scoped key safe to hand to a partner.
 *
 * Choosing nothing is a real, unremarkable answer: it leaves the key unscoped,
 * matching every key issued before scopes existed. So the picker defaults to
 * empty rather than to everything-checked — a pre-ticked list of every area
 * would read as a recommendation to grant it all.
 */
export function ApiKeysPanel() {
  const t = useTranslations('settings.apiKeys');
  // The wizard's own permission grid already translates all 13 areas; reusing
  // that namespace rather than adding a second copy that could drift.
  const tAreas = useTranslations('setup.areas');
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
                  <p className="text-muted-foreground truncate text-xs">{key.purpose} · {key.recipient}</p>
                  {/* Says what this key can REACH, not just who holds it — the
                      one fact that decides whether handing it out was safe. */}
                  <p className="text-muted-foreground truncate text-xs">
                    {key.scopes && key.scopes.length > 0
                      ? key.scopes
                          .map((area) => (tAreas.has(area) ? tAreas(area) : area))
                          .join(' · ')
                      : t('scopesAll')}
                  </p>
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

type CreateStep = 'details' | 'reveal';

/** Declared again here rather than passed down: this is a separate component
 *  scope, and threading a translator through props to save one hook call is
 *  more indirection than it removes. */
function CreateKeySheet({
  editPanelMode,
  onDone,
}: {
  editPanelMode: 'drawer' | 'modal';
  onDone: () => void;
}) {
  const t = useTranslations('settings.apiKeys');
  const tAreas = useTranslations('setup.areas');
  const translateError = useTranslatedApiError();

  const [step, setStep] = useState<CreateStep>('details');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [recipient, setRecipient] = useState('');
  /**
   * Starts EMPTY, meaning "no narrowing".
   *
   * Not pre-ticked with every area: a list arriving fully checked reads as a
   * recommendation to grant everything, and the safe default for a credential
   * you are about to hand someone else is the one that asks you to choose.
   */
  const [scopes, setScopes] = useState<Area[]>([]);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  async function submit() {
    setIsSaving(true);
    setError(null);

    try {
      // An empty selection is sent as "no scopes" (the lib omits the field),
      // which the endpoint reads as unscoped — see its `.strict()` schema.
      const result = await createApiKey(name.trim(), purpose.trim(), recipient.trim(), scopes);
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

        <div className="space-y-2">
          <Label htmlFor="api-key-purpose">{t('purposeLabel')}</Label>
          <Input id="api-key-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={255} placeholder={t('purposePlaceholder')} disabled={isSaving} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-key-recipient">{t('recipientLabel')}</Label>
          <Input id="api-key-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} maxLength={255} placeholder={t('recipientPlaceholder')} disabled={isSaving} />
        </div>

        <fieldset className="space-y-2" disabled={isSaving}>
          <legend className="text-sm font-medium">{t('scopesLabel')}</legend>
          <p id="api-key-scopes-hint" className="text-muted-foreground text-xs">
            {t('scopesHint')}
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {AREAS.map((area) => {
              const id = `api-key-scope-${area}`;
              return (
                <label
                  key={area}
                  htmlFor={id}
                  className="bg-card hover:bg-muted/60 focus-within:ring-ring flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors focus-within:ring-2"
                >
                  <Checkbox
                    id={id}
                    checked={scopes.includes(area)}
                    aria-describedby="api-key-scopes-hint"
                    onCheckedChange={(checked) =>
                      setScopes((current) =>
                        checked === true
                          ? [...current, area]
                          : current.filter((entry) => entry !== area),
                      )
                    }
                  />
                  {/* `setup.areas` rather than a new namespace — the same 13
                      labels are already translated there for the wizard's own
                      permission grid, and a second copy would drift. */}
                  <span className="text-sm">{tAreas(area)}</span>
                </label>
              );
            })}
          </div>

          {scopes.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t('scopesAll')}</p>
          ) : null}
        </fieldset>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button size="sm" disabled={isSaving || !name.trim() || purpose.trim().length < 3 || recipient.trim().length < 2} onClick={() => void submit()}>
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
