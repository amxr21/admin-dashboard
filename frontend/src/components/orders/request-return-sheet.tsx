'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { createReturn } from '@/lib/returns-api';
import type { OrderDetail } from '@/lib/orders-api';

/**
 * Request a return against a delivered order — a staff action recording that
 * a customer wants something back, since there is no customer-facing site to
 * do this itself.
 *
 * Quantities are capped to what the order actually has; the server re-checks
 * against what earlier (non-rejected) returns already claimed, but showing
 * the ordered quantity here is the honest ceiling from this screen's own data.
 */

interface RequestReturnSheetProps {
  order: OrderDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (message: string) => void;
}

export function RequestReturnSheet({
  order,
  open,
  onOpenChange,
  onCreated,
}: RequestReturnSheetProps) {
  const t = useTranslations('returns.request');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setQuantities({});
    setError(null);
  }, [open]);

  const selectedItems = Object.entries(quantities).filter(([, quantity]) => quantity > 0);
  const canSubmit = reason.trim() !== '' && selectedItems.length > 0;

  async function submit() {
    if (!canSubmit) return;

    setIsSaving(true);
    setError(null);

    try {
      const created = await createReturn({
        orderId: order.id,
        reason: reason.trim(),
        items: selectedItems.map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
      });
      onCreated(t('done', { rma: created.rmaNumber }));
      onOpenChange(false);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-lg overflow-y-auto"
        title={t('title', { order: order.orderNumber })}
      >
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">{t('title', { order: order.orderNumber })}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('items')}</p>
            <ul className="divide-y rounded-md border">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <label className="flex min-w-0 items-center gap-2 text-sm">
                    <Checkbox
                      checked={(quantities[item.id] ?? 0) > 0}
                      onCheckedChange={(checked) =>
                        setQuantities((current) => ({
                          ...current,
                          [item.id]: checked === true ? item.quantity : 0,
                        }))
                      }
                    />
                    <span className="min-w-0 truncate">
                      {item.product?.name ?? t('productRemoved')}
                    </span>
                  </label>

                  <Input
                    type="number"
                    min={0}
                    max={item.quantity}
                    step={1}
                    inputMode="numeric"
                    className="w-20 text-end"
                    aria-label={t('quantityFor', { item: item.product?.name ?? '' })}
                    value={quantities[item.id] ?? 0}
                    onChange={(event) => {
                      const value = Math.max(
                        0,
                        Math.min(item.quantity, Math.round(Number(event.target.value) || 0)),
                      );
                      setQuantities((current) => ({ ...current, [item.id]: value }));
                    }}
                  />
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    / {formatter.number(item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="return-reason">{t('reason')}</Label>
            <Textarea
              id="return-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t('reasonPlaceholder')}
            />
          </div>

          {error ? (
            <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={!canSubmit || isSaving} onClick={() => void submit()}>
              {isSaving ? t('saving') : t('submit')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
