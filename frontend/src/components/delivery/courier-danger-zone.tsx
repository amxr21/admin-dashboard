'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserX } from 'lucide-react';
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
import { DangerZoneRow, DangerZoneSection, useTypedConfirm } from '@/components/danger-zone';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { updateCourier, type CourierDetail } from '@/lib/delivery-api';

/**
 * C5.2 — the courier detail page's danger zone.
 *
 * ─── WHY THIS IS THE ONLY ACTION HERE ────────────────────────────────
 * A courier cannot be deleted (no such route exists), and revoking their
 * access code already has its own dedicated, one-time-reveal-shaped panel on
 * the roster table (`access-code-panel.tsx`, Track B's), so duplicating it
 * here would be a second control for the same action. Deactivating is the
 * one consequential state change that currently has NO dedicated
 * confirmation anywhere — today it's just a status field inside the edit
 * sheet's dropdown, indistinguishable in weight from editing a phone number.
 */
export function CourierDangerZone({
  courier,
  onChanged,
}: {
  courier: CourierDetail;
  onChanged: (next: CourierDetail) => void;
}) {
  const t = useTranslations('delivery.detail.dangerZone');
  const translateError = useTranslatedApiError();

  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const confirm = useTypedConfirm(t('deactivate.confirmPhrase'));

  async function deactivate() {
    setIsSaving(true);
    try {
      const updated = await updateCourier(courier.id, { status: 'INACTIVE' });
      onChanged({ ...courier, ...updated });
      setOpen(false);
      confirm.reset();
      toast.success(t('deactivate.done', { name: courier.name }));
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <DangerZoneSection
      titleId="courier-detail-danger"
      title={t('title')}
      description={t('description')}
    >
      <DangerZoneRow
        icon={<UserX className="size-5" />}
        title={t('deactivate.title')}
        description={t('deactivate.description')}
        action={
          courier.status === 'INACTIVE' ? (
            <span className="text-muted-foreground text-sm">{t('alreadyInactive')}</span>
          ) : (
            <AlertDialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next);
                if (!next) confirm.reset();
              }}
            >
              <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
                {t('deactivate.action')}
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('deactivate.confirm.title', { name: courier.name })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {courier.activeAssignments > 0
                      ? t('deactivate.confirm.descriptionWithActive', {
                          name: courier.name,
                          count: courier.activeAssignments,
                        })
                      : t('deactivate.confirm.description', { name: courier.name })}
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-2">
                  <Label htmlFor="deactivate-courier-confirm">
                    {t('deactivate.confirm.typePhrase', { phrase: t('deactivate.confirmPhrase') })}
                  </Label>
                  <Input
                    id="deactivate-courier-confirm"
                    value={confirm.typed}
                    onChange={(event) => confirm.setTyped(event.target.value)}
                    autoComplete="off"
                    className="force-ltr"
                  />
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isSaving}>
                    {t('deactivate.confirm.cancel')}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={!confirm.confirmed || isSaving}
                    onClick={(event) => {
                      event.preventDefault();
                      void deactivate();
                    }}
                  >
                    {t('deactivate.confirm.action')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )
        }
      />
    </DangerZoneSection>
  );
}
