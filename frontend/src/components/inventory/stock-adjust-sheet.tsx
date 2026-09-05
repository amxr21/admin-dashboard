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
import { useAppSettings } from '@/components/providers/settings-provider';
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
  /**
   * Reframes the sheet as "record opening stock" for a product that was just
   * created (F3.2). Copy only — the mechanism is identical, because an
   * opening balance IS a stock movement, and pretending otherwise would put
   * a number into `product.stock` that the movement log cannot explain.
   *
   * Worth the separate wording: "Adjust Widget / Currently 0 in stock" reads
   * as a correction to something that already went wrong, when in fact
   * nothing has happened to this product yet.
   */
  variant?: StockSheetVariant;
}

/**
 * The three occasions this sheet is opened. Same mechanism every time — a
 * movement in the append-only log — but three different things to say about
 * it, and copy that fits one fits the others badly:
 *
 *   adjust   a correction. "Currently 10 in stock" is the relevant fact.
 *   opening  a product that has just been created and has no history yet.
 *   receive  a delivery arriving. The ROUTINE case, and the one "Adjust
 *            stock" describes worst — nothing has gone wrong.
 */
export type StockSheetVariant = 'adjust' | 'opening' | 'receive';

/** Reason preselected per variant. `null` leaves the field unset, which is
 *  correct for a correction: the reason IS the decision being made. */
const PRESET_REASON: Record<StockSheetVariant, StockMovementReason | null> = {
  adjust: null,
  opening: 'RECEIVED',
  receive: 'RECEIVED',
};

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
  variant = 'adjust',
}: StockAdjustSheetProps) {
  const t = useTranslations('inventory.adjust');
  const tReason = useTranslations('stockReason');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [direction, setDirection] = useState<Direction>('in');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<StockMovementReason | ''>('');
  const [note, setNote] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpening = variant === 'opening';
  const isReceive = variant === 'receive';

  useEffect(() => {
    if (!open) return;
    setDirection('in');
    setAmount('');
    // Opening stock and a delivery are both stock ARRIVING, so RECEIVED is
    // preselected — still changeable (a migrated count is arguably a
    // CORRECTION), just not asked from scratch when the answer is obvious.
    setReason(PRESET_REASON[variant] ?? '');
    setNote('');
    setUnitCost('');
    setError(null);
  }, [open, product?.id, variant]);

  if (!product) return null;

  // Captured after the guard: the narrowing above does not survive into the
  // async closure below, because `product` is a prop that could change.
  const target = product;

  /**
   * A unit cost only means something where stock ARRIVES (F1.4a).
   *
   * DAMAGED/LOST/SOLD have no acquisition cost, and the server refuses one
   * there rather than ignoring it — so the field is hidden rather than
   * disabled, and the value is dropped on submit if the reason changed after
   * it was typed. CORRECTION is excluded too: it reconciles a count, it does
   * not represent a purchase.
   */
  const showsUnitCost = reason === 'RECEIVED' || reason === 'RETURNED';

  /**
   * One place deciding what this sheet SAYS, rather than the same ternary
   * repeated at the title, the subtitle and the two buttons — where a fourth
   * variant would mean four more chances to miss one.
   */
  const copy = {
    title: isOpening
      ? t('openingTitle', { name: product.name })
      : isReceive
        ? t('receiveTitle', { name: product.name })
        : t('title', { name: product.name }),
    subtitle: isOpening
      ? t('openingHint', { name: product.name })
      : t('current', { stock: formatter.number(product.stock) }),
    submit: isOpening ? t('openingRecord') : isReceive ? t('receiveRecord') : t('record'),
    cancel: isOpening ? t('openingSkip') : t('cancel'),
  };

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
        // Only sent where it applies — the server REFUSES a cost on an
        // outgoing movement, so sending a stale value after switching the
        // reason would turn a valid adjustment into a 400.
        ...(showsUnitCost && unitCost.trim() ? { unitCost: unitCost.trim() } : {}),
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
        variant={editPanelMode}
        className="w-full max-w-md overflow-y-auto"
        title={copy.title}
      >
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">{copy.title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{copy.subtitle}</p>
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

          {showsUnitCost ? (
            <div className="space-y-2">
              <Label htmlFor="adjust-unit-cost">{t('unitCost')}</Label>
              <Input
                id="adjust-unit-cost"
                // `inputMode` rather than type=number: a spinner on a money
                // field invites scroll-wheel edits, and type=number would also
                // localise the decimal separator inconsistently.
                inputMode="decimal"
                className="force-ltr"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                placeholder={t('unitCostPlaceholder')}
              />
              <p className="text-muted-foreground text-xs">{t('unitCostHint')}</p>
            </div>
          ) : null}

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
              {copy.cancel}
            </Button>
            <Button
              disabled={!reason || !isValidAmount || wouldGoNegative || isSaving}
              onClick={() => void submit()}
            >
              {isSaving ? t('saving') : copy.submit}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
