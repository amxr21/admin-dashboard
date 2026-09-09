'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle, History } from 'lucide-react';
import { Link } from '@/i18n/navigation';

import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { canAccessArea, type StaffRole } from '@/config/areas';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useAuth } from '@/hooks/useAuth';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  approveReturn,
  fetchReturn,
  rejectReturn,
  type ReturnDetail,
  type ReturnResolution,
} from '@/lib/returns-api';

/**
 * A return's detail, with approve/reject when it is still REQUESTED.
 *
 * ─── THE REFUND CAP IS SHOWN, NOT JUST ENFORCED ──────────────────────
 * The server caps a refund at the returned items' recorded price (never a
 * live product price) and refuses anything above it. Showing that ceiling
 * here means the refusal is never a surprise — the same reasoning as the
 * stock-adjust sheet showing the resulting stock before submitting.
 */

const RESOLUTIONS: Exclude<ReturnResolution, 'NONE'>[] = ['REFUND', 'STORE_CREDIT', 'REPLACEMENT'];

interface ReturnDetailSheetProps {
  returnId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (message: string) => void;
}

export function ReturnDetailSheet({
  returnId,
  open,
  onOpenChange,
  onChanged,
}: ReturnDetailSheetProps) {
  const t = useTranslations('returns.detail');
  const tAudit = useTranslations('audit');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();
  const { user } = useAuth();
  const { editPanelMode, restockingFeePercent: defaultFeePercent } = useAppSettings();
  const canViewHistory = canAccessArea((user?.role ?? 'DEMO') as StaffRole, 'staff');

  const [item, setItem] = useState<ReturnDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [resolution, setResolution] = useState<Exclude<ReturnResolution, 'NONE'> | ''>('');
  const [refundAmount, setRefundAmount] = useState('');
  const [restock, setRestock] = useState(true);
  /** A default the approving person may raise or waive for THIS return
   *  (B4.11) — pre-filled from the store setting, never re-read after the
   *  sheet opens, so typing over it can't be silently reverted. */
  const [feePercent, setFeePercent] = useState(String(defaultFeePercent));
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Reject is a two-step action: clicking Reject reveals a required-reason
   *  field rather than firing immediately — the same reasoning approve
   *  already follows (a resolution must be chosen first), applied to the
   *  action that used to need no input at all. */
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    if (!open || !returnId) return;

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setResolution('');
    setRefundAmount('');
    setFeePercent(String(defaultFeePercent));
    setRestock(true);
    setActionError(null);
    setIsRejecting(false);
    setRejectionReason('');

    fetchReturn(returnId)
      .then((loaded) => {
        if (!cancelled) setItem(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(translateError(caught));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, returnId, translateError]);

  if (!returnId) return null;

  const money = (value: string | null) => (value === null ? '—' : formatCurrency(Number(value)));

  const itemsValue = item ? item.items.reduce((sum, row) => sum + Number(row.lineTotal), 0) : 0;
  const parsedFeePercent = Number(feePercent);
  const isValidFeePercent = Number.isFinite(parsedFeePercent) && parsedFeePercent >= 0 && parsedFeePercent <= 100;
  // Mirrors the server's own math (B4.11) — a fee reduces the CAP, never
  // forces the refund amount itself.
  const maxRefund = isValidFeePercent
    ? (itemsValue * (100 - parsedFeePercent)) / 100
    : itemsValue;

  async function submitApprove() {
    if (!item || !resolution) return;

    setIsSaving(true);
    setActionError(null);

    try {
      const updated = await approveReturn(item.id, {
        resolution,
        ...(resolution === 'REFUND'
          ? { refundAmount, restockingFeePercent: parsedFeePercent }
          : {}),
        restock,
      });
      onChanged(t('approved', { rma: updated.rmaNumber }));
      onOpenChange(false);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function submitReject() {
    if (!item || !rejectionReason.trim()) return;

    setIsSaving(true);
    setActionError(null);

    try {
      const updated = await rejectReturn(item.id, rejectionReason.trim());
      onChanged(t('rejected', { rma: updated.rmaNumber }));
      onOpenChange(false);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  const refundValue = Number(refundAmount);
  const isValidRefund =
    resolution !== 'REFUND' ||
    (isValidFeePercent &&
      refundAmount.trim() !== '' &&
      Number.isFinite(refundValue) &&
      refundValue >= 0 &&
      refundValue <= maxRefund);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-lg overflow-y-auto"
        title={item ? item.rmaNumber : t('title')}
      >
        {isLoading || !item ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : loadError ? (
          <p role="alert" className="text-destructive text-sm">
            {loadError}
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <h2 className="flex items-center gap-3 text-lg font-semibold">
                <span className="force-ltr">{item.rmaNumber}</span>
                <StatusBadge kind="returnStatus" value={item.status} />
                {canViewHistory ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="ms-auto" asChild>
                        <Link
                          href={`/admin/audit?entity=return&entityId=${item.id}`}
                          aria-label={tAudit('viewHistory')}
                        >
                          <History aria-hidden />
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{tAudit('viewHistory')}</TooltipContent>
                  </Tooltip>
                ) : null}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                <Link
                  href={`/admin/orders/${item.order.id}`}
                  className="hover:text-primary underline-offset-4 hover:underline"
                >
                  <span className="force-ltr">{item.order.orderNumber}</span>
                </Link>
                {item.customer ? ` · ${item.customer.name}` : null}
              </p>
            </div>

            {/* A warning, not a gate (B4.11) — the return still processes
                normally either way; this only flags it as late so the
                person approving can weigh it. */}
            {!item.withinWindow ? (
              <div className="bg-warning/10 text-warning-foreground flex items-center gap-2 rounded-md px-3 py-2 text-sm">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {t('pastWindowBody', { days: item.daysSincePurchase })}
              </div>
            ) : null}

            <div className="space-y-1">
              <p className="text-muted-foreground text-sm font-medium">{t('reason')}</p>
              <p className="text-sm">{item.reason}</p>
              {item.category ? (
                <StatusBadge kind="returnCategory" value={item.category} className="mt-1" />
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-muted-foreground text-sm font-medium">{t('items')}</p>
              <ul className="divide-y rounded-md border">
                {item.items.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {row.product?.name ?? t('productRemoved')}
                      <span className="text-muted-foreground ms-2 tabular-nums">
                        ×{formatter.number(row.quantity)}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{money(row.lineTotal)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {item.status !== 'REQUESTED' ? (
              <div className="bg-muted/50 space-y-2 rounded-md border p-3 text-sm">
                {item.status === 'REJECTED' ? (
                  <div className="space-y-1">
                    <span className="text-muted-foreground">{t('rejectionReason')}</span>
                    <p>{item.rejectionReason}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t('resolution')}</span>
                      <StatusBadge kind="returnResolution" value={item.resolution} />
                    </div>
                    {item.refundAmount !== null ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('refundAmount')}</span>
                        <span className="tabular-nums">{money(item.refundAmount)}</span>
                      </div>
                    ) : null}
                    {item.restockingFeePercent !== null &&
                    Number(item.restockingFeePercent) > 0 ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('restockingFeeApplied')}</span>
                        <span className="tabular-nums">
                          {Number(item.restockingFeePercent).toFixed(0)}%
                        </span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t('restocked')}</span>
                      <span>{item.restocked ? t('yes') : t('no')}</span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-4 border-t pt-4">
                <div className="space-y-2">
                  <Label htmlFor="return-resolution">{t('chooseResolution')}</Label>
                  <Select
                    value={resolution}
                    onValueChange={(value) => setResolution(value as Exclude<ReturnResolution, 'NONE'>)}
                  >
                    <SelectTrigger id="return-resolution">
                      <SelectValue placeholder={t('resolutionPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOLUTIONS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`resolutions.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {resolution === 'REFUND' ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="return-restocking-fee">{t('restockingFeeLabel')}</Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id="return-restocking-fee"
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          inputMode="decimal"
                          className="w-24"
                          value={feePercent}
                          onChange={(event) => setFeePercent(event.target.value)}
                          aria-invalid={!isValidFeePercent ? true : undefined}
                        />
                        <span className="text-muted-foreground text-sm">%</span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {t('restockingFeeHint')}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="return-refund-amount">
                        {t('refundAmountLabel', { max: money(maxRefund.toFixed(2)) })}
                      </Label>
                      <Input
                        id="return-refund-amount"
                        type="number"
                        min={0}
                        max={maxRefund}
                        step={0.01}
                        inputMode="decimal"
                        value={refundAmount}
                        onChange={(event) => setRefundAmount(event.target.value)}
                        aria-invalid={!isValidRefund ? true : undefined}
                      />
                    </div>
                  </>
                ) : null}

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)} />
                  {t('restock')}
                </label>

                {isRejecting ? (
                  <div className="space-y-2 border-t pt-4">
                    <Label htmlFor="return-rejection-reason">{t('rejectionReasonLabel')}</Label>
                    <Textarea
                      id="return-rejection-reason"
                      autoFocus
                      value={rejectionReason}
                      onChange={(event) => setRejectionReason(event.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder={t('rejectionReasonPlaceholder')}
                    />
                  </div>
                ) : null}

                {actionError ? (
                  <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
                    {actionError}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2 border-t pt-4">
                  {isRejecting ? (
                    <>
                      <Button
                        variant="outline"
                        disabled={isSaving}
                        onClick={() => {
                          setIsRejecting(false);
                          setRejectionReason('');
                        }}
                      >
                        {t('cancel')}
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={!rejectionReason.trim() || isSaving}
                        onClick={() => void submitReject()}
                      >
                        {isSaving ? t('saving') : t('confirmReject')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" disabled={isSaving} onClick={() => setIsRejecting(true)}>
                        {t('reject')}
                      </Button>
                      <Button
                        disabled={!resolution || !isValidRefund || isSaving}
                        onClick={() => void submitApprove()}
                      >
                        {isSaving ? t('saving') : t('approve')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
