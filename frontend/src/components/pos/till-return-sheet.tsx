'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchOrders, fetchOrder, type OrderDetail } from '@/lib/orders-api';
import { createReturn, approveReturn, type ReturnResolution } from '@/lib/returns-api';
import { ManagerOverrideDialog } from '@/components/pos/manager-override-dialog';
import type { ManagerOverrideResult } from '@/lib/auth-api';

/**
 * Return / exchange at the register (O9.7).
 *
 * A SHEET, not a page — the drawer-vs-page convention (C4.7): this is a
 * detour from the till the cashier is coming right back to, not a
 * destination with its own URL, and staying on the till underneath (visible
 * at the sheet's edge) is itself useful context.
 *
 * ─── THE SHAPE THE OWNER SETTLED ON ───────────────────────────────────
 * Cashier looks up the order, marks which lines are coming back — nothing
 * moves yet. Approving is the step that actually returns money and stock,
 * and THAT step needs a manager: this component calls `createReturn` (a
 * REQUEST, which `returns` already lets a cashier do) immediately followed
 * by `approveReturn` in the same flow, so from the cashier's point of view
 * it reads as one action ("process this return") even though the backend
 * still sees the same request-then-approve shape the admin returns list
 * uses. Approving is where `verifyOverrideToken` runs (O9.7's backend half)
 * — a cashier calling it with no override gets refused there regardless of
 * anything this component does, so the override dialog here is the
 * FRICTION-REMOVER, not the actual security boundary.
 */
interface TillReturnSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fired once a return finishes processing, for EVERY resolution (O9.8) —
   * this component's job ends at the return itself; it reports what
   * happened and leaves deciding what matters to the caller. `SaleScreen`
   * only acts on REPLACEMENT, carrying the return id into the replacement
   * sale's checkout, and ignores the others.
   */
  onProcessed?: (result: { returnId: string; resolution: ReturnResolution }) => void;
}

type Step = 'lookup' | 'pick-lines' | 'resolve';

interface LineSelection {
  orderItemId: string;
  selected: boolean;
  quantity: number;
  maxQuantity: number;
}

export function TillReturnSheet({ open, onOpenChange, onProcessed }: TillReturnSheetProps) {
  const t = useTranslations('pos.tillReturn');
  const translateError = useTranslatedApiError();

  const [step, setStep] = useState<Step>('lookup');
  const [orderNumber, setOrderNumber] = useState('');
  const [isLooking, setIsLooking] = useState(false);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lines, setLines] = useState<LineSelection[]>([]);
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState<Exclude<ReturnResolution, 'NONE'>>('REFUND');
  const [restock, setRestock] = useState(true);
  const [refundAmount, setRefundAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  /** Set only if the FIRST attempt to approve is refused for lacking one —
   *  most returns never need this, so nothing here asks up front. */
  const [pendingReturnId, setPendingReturnId] = useState<string | null>(null);

  function reset() {
    setStep('lookup');
    setOrderNumber('');
    setOrder(null);
    setLines([]);
    setReason('');
    setResolution('REFUND');
    setRestock(true);
    setRefundAmount('');
    setError(null);
    setPendingReturnId(null);
  }

  async function lookupOrder() {
    const trimmed = orderNumber.trim();
    if (trimmed === '' || isLooking) return;

    setIsLooking(true);
    setError(null);

    try {
      const results = await fetchOrders({ search: trimmed, pageSize: 5 });
      const match = results.orders.find((row) => row.orderNumber === trimmed) ?? results.orders[0];

      if (!match) {
        setError(t('notFound', { orderNumber: trimmed }));
        return;
      }

      const detail = await fetchOrder(match.id);
      setOrder(detail);
      setLines(
        detail.items.map((item) => ({
          orderItemId: item.id,
          selected: false,
          quantity: item.quantity,
          maxQuantity: item.quantity,
        })),
      );
      setStep('pick-lines');
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLooking(false);
    }
  }

  function toggleLine(orderItemId: string, selected: boolean) {
    setLines((current) =>
      current.map((line) => (line.orderItemId === orderItemId ? { ...line, selected } : line)),
    );
  }

  function setLineQuantity(orderItemId: string, quantity: number) {
    setLines((current) =>
      current.map((line) =>
        line.orderItemId === orderItemId
          ? { ...line, quantity: Math.min(Math.max(1, quantity), line.maxQuantity) }
          : line,
      ),
    );
  }

  const selectedLines = lines.filter((line) => line.selected);

  async function processReturn(overrideToken?: string) {
    if (!order || selectedLines.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // A request is created first regardless — `returns` already lets a
      // cashier do this, and it is the record of what the customer brought
      // back even if approval has to wait for a manager.
      let returnId = pendingReturnId;

      if (!returnId) {
        const created = await createReturn({
          orderId: order.id,
          reason: reason.trim() || t('defaultReason'),
          items: selectedLines.map((line) => ({
            orderItemId: line.orderItemId,
            quantity: line.quantity,
          })),
        });
        returnId = created.id;
        setPendingReturnId(returnId);
      }

      await approveReturn(returnId, {
        resolution,
        restock,
        ...(resolution === 'REFUND' ? { refundAmount: refundAmount.trim() } : {}),
        ...(overrideToken ? { overrideToken } : {}),
      });

      toast.success(t('done'));
      onProcessed?.({ returnId, resolution });
      reset();
      onOpenChange(false);
    } catch (caught) {
      // A cashier hitting this for the first time on an over-cap-shaped
      // action reads as FORBIDDEN — that is the till's cue to open the
      // override dialog rather than just show the refusal, since the
      // request itself already succeeded and only approval is blocked.
      if (caught instanceof ApiError && caught.status === 403) {
        setOverrideDialogOpen(true);
        return;
      }

      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent title={t('title')} className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>

        {error ? (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        {step === 'lookup' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void lookupOrder();
            }}
            className="space-y-2"
          >
            <Label htmlFor="till-return-order">{t('orderNumberLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="till-return-order"
                value={orderNumber}
                onChange={(event) => setOrderNumber(event.target.value)}
                placeholder={t('orderNumberPlaceholder')}
                className="force-ltr"
                autoFocus
                disabled={isLooking}
              />
              <Button type="submit" disabled={isLooking || orderNumber.trim() === ''}>
                <Search className="size-4" aria-hidden />
                {t('lookUp')}
              </Button>
            </div>
          </form>
        ) : null}

        {step === 'pick-lines' && order ? (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {t('orderFound', { orderNumber: order.orderNumber })}
            </p>

            <ul className="divide-y rounded-lg border">
              {order.items.map((item) => {
                const line = lines.find((l) => l.orderItemId === item.id);
                if (!line) return null;

                return (
                  <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      id={`return-line-${item.id}`}
                      checked={line.selected}
                      onCheckedChange={(checked) => toggleLine(item.id, checked === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={`return-line-${item.id}`} className="truncate font-medium">
                        {item.product?.name ?? t('unknownProduct')}
                      </Label>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {t('orderedQuantity', { quantity: item.quantity })}
                      </p>
                    </div>
                    {line.selected ? (
                      <Input
                        type="number"
                        min={1}
                        max={line.maxQuantity}
                        value={line.quantity}
                        onChange={(event) =>
                          setLineQuantity(item.id, Number(event.target.value))
                        }
                        className="force-ltr h-8 w-16"
                        aria-label={t('returnQuantity', {
                          name: item.product?.name ?? t('unknownProduct'),
                        })}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <Button
              className="w-full"
              disabled={selectedLines.length === 0}
              onClick={() => setStep('resolve')}
            >
              {t('continue')}
            </Button>
          </div>
        ) : null}

        {step === 'resolve' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="till-return-reason">{t('reasonLabel')}</Label>
              <Input
                id="till-return-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('reasonPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="till-return-resolution">{t('resolutionLabel')}</Label>
              <Select
                value={resolution}
                onValueChange={(value) => setResolution(value as typeof resolution)}
              >
                <SelectTrigger id="till-return-resolution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REFUND">{t('resolutions.refund')}</SelectItem>
                  <SelectItem value="STORE_CREDIT">{t('resolutions.storeCredit')}</SelectItem>
                  <SelectItem value="REPLACEMENT">{t('resolutions.replacement')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {resolution === 'REFUND' ? (
              <div className="space-y-2">
                <Label htmlFor="till-return-refund">{t('refundAmountLabel')}</Label>
                <Input
                  id="till-return-refund"
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="force-ltr"
                />
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Checkbox
                id="till-return-restock"
                checked={restock}
                onCheckedChange={(checked) => setRestock(checked === true)}
              />
              <Label htmlFor="till-return-restock">{t('restockLabel')}</Label>
            </div>

            <Button
              className="w-full"
              onClick={() => void processReturn()}
              disabled={
                isSubmitting || (resolution === 'REFUND' && refundAmount.trim() === '')
              }
            >
              <RotateCcw className="size-4" aria-hidden />
              {isSubmitting ? t('processing') : t('process')}
            </Button>
          </div>
        ) : null}

        <ManagerOverrideDialog
          open={overrideDialogOpen}
          onOpenChange={setOverrideDialogOpen}
          reason={t('managerOverrideReason')}
          onApproved={(result: ManagerOverrideResult) => {
            void processReturn(result.overrideToken);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
