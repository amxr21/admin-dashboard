'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Crown, Power, Trash2 } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { deleteDemoData, fetchDemoDataSummary, type DemoDataSummary } from '@/lib/demo-data-api';
import { fetchSettings, saveSettings } from '@/lib/settings-api';
import { fetchStaff, transferOwnership, type StaffMember } from '@/lib/staff-api';

/**
 * Danger zone (B3.4) — three irreversible or near-irreversible operations,
 * each behind its own typed confirmation. OWNER/DEVELOPER only; visually
 * separated (destructive border/heading) from the rest of Settings.
 *
 * ─── WHY EACH ACTION ASKS THE USER TO TYPE SOMETHING ──────────────────
 * A single "Are you sure?" click is exactly what caused the very P0 this
 * app's own AlertDialog primitive was built to make impossible to trigger
 * by accident (see the Toaster/AlertDialog changelog entry) — but that fix
 * was about the dialog rendering on-screen at all, not about the CLICK
 * itself being deliberate. These three actions are the highest-consequence
 * writes in the app (store-wide write lock, permanently losing OWNER, and an
 * unrecoverable bulk delete), so each one raises the bar past a single
 * click: the confirm button stays disabled until the exact phrase is typed.
 *
 * ─── DEACTIVATE STORE REUSES `system.maintenanceMode` — NO NEW BACKEND ──
 * That setting already exists and is already enforced (503 on writes for
 * everyone except OWNER/DEVELOPER, who can still turn it back off) — see
 * CLAUDE.md's Settings section. This panel is a Danger Zone–styled front
 * end for the exact same toggle `SettingsForm` renders generically further
 * down the page, with a typed confirmation in front of the ON transition
 * specifically (turning it back off needs no ceremony — it is the escape
 * hatch, not the danger).
 */
export function DangerZonePanel() {
  const t = useTranslations('settings.dangerZone');
  const { user } = useAuth();

  if (user?.role !== 'OWNER' && user?.role !== 'DEVELOPER') return null;

  return (
    <section aria-labelledby="settings-group-danger" className="space-y-4">
      <div className="border-destructive/40 space-y-1 border-t pt-6">
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-destructive size-5" aria-hidden="true" />
          <h2 id="settings-group-danger" className="text-destructive text-lg font-semibold tracking-tight">
            {t('title')}
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <div className="border-destructive/40 divide-destructive/20 divide-y rounded-lg border">
        <DeactivateStoreRow />
        {user.role === 'OWNER' ? <TransferOwnershipRow /> : null}
        <DeleteTestDataRow />
      </div>
    </section>
  );
}

function DangerRow({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="text-destructive mt-0.5" aria-hidden="true">
          {icon}
        </span>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

/** Types the confirm phrase before the action button enables. Shared shape for all three dialogs. */
function useTypedConfirm(phrase: string) {
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim() === phrase;
  const reset = useCallback(() => setTyped(''), []);
  return { typed, setTyped, confirmed, reset };
}

function DeactivateStoreRow() {
  const t = useTranslations('settings.dangerZone.deactivate');
  const translateError = useTranslatedApiError();

  const [isOn, setIsOn] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const confirm = useTypedConfirm(t('confirmPhrase'));

  useEffect(() => {
    let cancelled = false;
    void fetchSettings()
      .then((settings) => {
        if (cancelled) return;
        const setting = settings.find((s) => s.key === 'system.maintenanceMode');
        setIsOn(Boolean(setting?.value));
      })
      .catch(() => {
        if (!cancelled) setIsOn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setIsSaving(true);
    try {
      await saveSettings({ 'system.maintenanceMode': true });
      setIsOn(true);
      setOpen(false);
      confirm.reset();
      toast.success(t('activated'));
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  async function turnOff() {
    setIsSaving(true);
    try {
      await saveSettings({ 'system.maintenanceMode': false });
      setIsOn(false);
      toast.success(t('deactivated'));
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <DangerRow
      icon={<Power className="size-5" />}
      title={t('title')}
      description={isOn ? t('descriptionOn') : t('description')}
      action={
        isOn === null ? (
          <Skeleton className="h-9 w-28" />
        ) : isOn ? (
          <Button type="button" size="sm" variant="outline" disabled={isSaving} onClick={() => void turnOff()}>
            {t('turnOff')}
          </Button>
        ) : (
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) confirm.reset();
            }}
          >
            <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
              {t('turnOn')}
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
                <AlertDialogDescription>{t('confirm.description')}</AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-2">
                <Label htmlFor="deactivate-store-confirm">
                  {t('confirm.typePhrase', { phrase: t('confirmPhrase') })}
                </Label>
                <Input
                  id="deactivate-store-confirm"
                  value={confirm.typed}
                  onChange={(event) => confirm.setTyped(event.target.value)}
                  autoComplete="off"
                  className="force-ltr"
                />
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={!confirm.confirmed || isSaving}
                  onClick={(event) => {
                    event.preventDefault();
                    void turnOn();
                  }}
                >
                  {t('confirm.action')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      }
    />
  );
}

function TransferOwnershipRow() {
  const t = useTranslations('settings.dangerZone.transferOwnership');
  const translateError = useTranslatedApiError();
  const { user, signOut } = useAuth();

  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<StaffMember[] | null>(null);
  const [targetId, setTargetId] = useState('');
  const [password, setPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useTypedConfirm(t('confirmPhrase'));

  useEffect(() => {
    if (!open) return;
    void fetchStaff({ isActive: true, pageSize: 100 })
      .then((result) => setCandidates(result.staff.filter((member) => member.id !== user?.id)))
      .catch(() => setCandidates([]));
  }, [open, user?.id]);

  async function submit() {
    if (!targetId || !password) return;

    setIsSaving(true);
    setError(null);
    try {
      await transferOwnership(targetId, password);
      toast.success(t('transferred'));
      // Both accounts' sessions are revoked server-side, including this
      // one — the caller is no longer OWNER, so there is nothing left for
      // this session to do here.
      signOut();
    } catch (caught) {
      setError(translateError(caught));
      setIsSaving(false);
    }
  }

  return (
    <DangerRow
      icon={<Crown className="size-5" />}
      title={t('title')}
      description={t('description')}
      action={
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              confirm.reset();
              setTargetId('');
              setPassword('');
              setError(null);
            }
          }}
        >
          <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
            {t('action')}
          </Button>
          <AlertDialogContent className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('confirm.description')}</AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-2">
              <Label htmlFor="transfer-ownership-target">{t('targetLabel')}</Label>
              {candidates === null ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger id="transfer-ownership-target" className="w-full">
                    <SelectValue placeholder={t('targetPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name ?? member.email} ({member.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="transfer-ownership-password">{t('passwordLabel')}</Label>
              <Input
                id="transfer-ownership-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="transfer-ownership-confirm">
                {t('confirm.typePhrase', { phrase: t('confirmPhrase') })}
              </Label>
              <Input
                id="transfer-ownership-confirm"
                value={confirm.typed}
                onChange={(event) => confirm.setTyped(event.target.value)}
                autoComplete="off"
                className="force-ltr"
              />
            </div>

            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={!confirm.confirmed || !targetId || !password || isSaving}
                onClick={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                {t('confirm.action')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    />
  );
}

function DeleteTestDataRow() {
  const t = useTranslations('settings.dangerZone.deleteTestData');
  const translateError = useTranslatedApiError();

  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<DemoDataSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const confirm = useTypedConfirm(t('confirmPhrase'));

  useEffect(() => {
    if (!open) return;
    void fetchDemoDataSummary()
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [open]);

  async function submit() {
    setIsDeleting(true);
    try {
      const result = await deleteDemoData();
      toast.success(t('deleted', { count: result.total }));
      setOpen(false);
      confirm.reset();
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <DangerRow
      icon={<Trash2 className="size-5" />}
      title={t('title')}
      description={t('description')}
      action={
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) confirm.reset();
          }}
        >
          <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
            {t('action')}
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {summary === null
                  ? t('confirm.counting')
                  : t('confirm.description', { count: summary.total })}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-2">
              <Label htmlFor="delete-test-data-confirm">
                {t('confirm.typePhrase', { phrase: t('confirmPhrase') })}
              </Label>
              <Input
                id="delete-test-data-confirm"
                value={confirm.typed}
                onChange={(event) => confirm.setTyped(event.target.value)}
                autoComplete="off"
                className="force-ltr"
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={!confirm.confirmed || isDeleting || summary?.total === 0}
                onClick={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                {t('confirm.action')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    />
  );
}
