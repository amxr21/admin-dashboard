'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  STOCK_REASONS,
  adjustStock,
  type InventoryRow,
  type StockMovementReason,
} from '@/lib/inventory-api';

/**
 * Record a stock movement.
 *
 * ─── DIRECTION IS A CONTROL, NOT A MINUS SIGN ────────────────────────
 * The amount is entered as a positive number and the direction is chosen
 * explicitly. A single signed field invites "-5" typed as "5" — and getting
 * the sign wrong writes a movement in the opposite direction that then has to
 * be corrected in the log forever, because the log is append-only.
 *
 * The resulting stock is shown BEFORE submitting, so the consequence is
 * visible rather than discovered.
 */

interface StockAdjustSheetProps {
  product: InventoryRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdjusted: (message: string) => void;
}

type Direction = 'in' | 'out';

/** Reasons that only make sense in one direction. */
const DIRECTION_FOR: Partial<Record<StockMovementReason, Direction>> = {
  RECEIVED: 'in',
  RETURNED: 'in',
  SOLD: 'out',
  DAMAGED: 'out',
  LOST: 'out',
};

export function StockAdjustSheet({
  product,
  open,
  onOpenChange,
  onAdjusted,
}: StockAdjustSheetProps) {
  const t = useTranslations('inventory.adjust');
  const tReason = useTranslations('stockReason');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [direction, setDirection] = useState<Direction>('in');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<StockMovementReason | ''>('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDirection('in');
    setAmount('');
    setReason('');
    setNote('');
    setError(null);
  }, [open, product?.id]);

  if (!product) return null;

  // Captured after the guard: the narrowing above does not survive into the
  // async closure below, because `product` is a prop that could change.
  const target = product;

  const parsed = Number(amount);
  const isValidAmount = Number.isInteger(parsed) && parsed > 0;
  const delta = direction === 'in' ? parsed : -parsed;
  const resulting = product.stock + (isValidAmount ? delta : 0);
  // Mirrors the server's check so the consequence is visible before submitting.
  const wouldGoNegative = isValidAmount && resulting < 0;

  function chooseReason(next: StockMovementReason) {
    setReason(next);
    // A reason that only makes sense one way sets the direction with it —
    // "damaged" adding stock is almost always a mis-click.
    const implied = DIRECTION_FOR[next];
    if (implied) setDirection(implied);
  }

  async function submit() {
    if (!reason || !isValidAmount || wouldGoNegative) return;

    setIsSaving(true);
    setError(null);

    try {
      const result = await adjustStock(target.id, {
        delta,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });

      onAdjusted(
        t('done', {
          name: result.product.name,
          stock: formatter.number(result.product.stock),
        }),
      );
      onOpenChange(false);
    } catch (caught) {
      // The server's refusal names the numbers; keep that detail rather than
      // flattening it to "something went wrong".
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
        className="w-full max-w-md overflow-y-auto"
        title={t('title', { name: product.name })}
      >
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">{t('title', { name: product.name })}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('current', { stock: formatter.number(product.stock) })}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-reason">{t('reason')}</Label>
            <Select
              value={reason}
              onValueChange={(value) => chooseReason(value as StockMovementReason)}
            >
              <SelectTrigger id="adjust-reason">
                <SelectValue placeholder={t('reasonPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {STOCK_REASONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tReason(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t('direction')}</legend>
            <div className="flex gap-2">
              {(['in', 'out'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={direction === value ? 'default' : 'outline'}
                  // aria-pressed, not just colour — a toggle's state has to be
                  // announced, not only shown.
                  aria-pressed={direction === value}
                  onClick={() => setDirection(value)}
                  className="flex-1"
                >
                  {value === 'in' ? <Plus aria-hidden /> : <Minus aria-hidden />}
                  {t(value)}
                </Button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="adjust-amount">{t('amount')}</Label>
            <Input
              id="adjust-amount"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={wouldGoNegative ? true : undefined}
              aria-describedby={wouldGoNegative ? 'adjust-warning' : 'adjust-preview'}
            />

            {wouldGoNegative ? (
              <p id="adjust-warning" role="alert" className="text-destructive text-sm">
                {t('wouldGoNegative', { stock: formatter.number(product.stock) })}
              </p>
            ) : (
              <p id="adjust-preview" className="text-muted-foreground text-sm">
                {isValidAmount
                  ? t('preview', {
                      from: formatter.number(product.stock),
                      to: formatter.number(resulting),
                    })
                  : t('amountHint')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-note">{t('note')}</Label>
            <Textarea
              id="adjust-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              // Matches the column width, so the server never truncates silently.
              maxLength={255}
              placeholder={t('notePlaceholder')}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={!reason || !isValidAmount || wouldGoNegative || isSaving}
              onClick={() => void submit()}
            >
              {isSaving ? t('saving') : t('record')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
