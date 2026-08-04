'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { History } from 'lucide-react';
import { Link } from '@/i18n/navigation';

import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useAuth } from '@/hooks/useAuth';
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
  const translateError = useTranslatedApiError();
  const { user } = useAuth();
  const canViewHistory = canAccessArea((user?.role ?? 'DEMO') as StaffRole, 'staff');

  const [item, setItem] = useState<ReturnDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [resolution, setResolution] = useState<Exclude<ReturnResolution, 'NONE'> | ''>('');
  const [refundAmount, setRefundAmount] = useState('');
  const [restock, setRestock] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !returnId) return;

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setResolution('');
    setRefundAmount('');
    setRestock(true);
    setActionError(null);

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

  const money = (value: string | null) =>
    value === null ? '—' : formatter.number(Number(value), 'currency');

  const maxRefund = item
    ? item.items.reduce((sum, row) => sum + Number(row.lineTotal), 0)
    : 0;

  async function submitApprove() {
    if (!item || !resolution) return;

    setIsSaving(true);
    setActionError(null);

    try {
      const updated = await approveReturn(item.id, {
        resolution,
        ...(resolution === 'REFUND' ? { refundAmount } : {}),
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
    if (!item) return;

    setIsSaving(true);
    setActionError(null);

    try {
      const updated = await rejectReturn(item.id);
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
    (refundAmount.trim() !== '' && Number.isFinite(refundValue) && refundValue >= 0 && refundValue <= maxRefund);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
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

            <div className="space-y-1">
              <p className="text-muted-foreground text-sm font-medium">{t('reason')}</p>
              <p className="text-sm">{item.reason}</p>
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
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t('restocked')}</span>
                  <span>{item.restocked ? t('yes') : t('no')}</span>
                </div>
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
                ) : null}

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)} />
                  {t('restock')}
                </label>

                {actionError ? (
                  <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
                    {actionError}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button variant="outline" disabled={isSaving} onClick={() => void submitReject()}>
                    {isSaving ? t('saving') : t('reject')}
                  </Button>
                  <Button
                    disabled={!resolution || !isValidRefund || isSaving}
                    onClick={() => void submitApprove()}
                  >
                    {isSaving ? t('saving') : t('approve')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
