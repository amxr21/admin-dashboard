'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { History, Minus, Package, Plus, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
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
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { VariantMovementLogSheet } from '@/components/resource/variant-movement-log-sheet';
import {
  STOCK_REASONS,
  adjustVariantStock,
  createVariant,
  deleteVariant,
  fetchVariants,
  updateVariant,
  type StockMovementReason,
  type Variant,
} from '@/lib/variants-api';

/**
 * Manage a product's variants — flat rows ("Red / Large") with their own
 * price, stock and SKU. Stock follows the SAME append-only movement-log rule
 * as the top-level product (see `variants.service.ts`), just expressed as an
 * inline expand rather than a separate Sheet: three levels of stacked Sheet
 * (product edit → this panel → an adjust panel) is exactly the kind of UI
 * this app avoids elsewhere, so the adjust form lives inline in the row
 * instead.
 *
 * Inventory-only, deliberately: a variant here cannot be purchased — this
 * codebase has no checkout flow to select one from (see the panel's own
 * empty state and the schema comment on `ProductVariant`).
 */

const MONEY_PATTERN = /^-?\d{1,8}(\.\d{1,2})?$/;

/** Reasons that only make sense in one direction. Mirrors StockAdjustSheet. */
const DIRECTION_FOR: Partial<Record<StockMovementReason, 'in' | 'out'>> = {
  RECEIVED: 'in',
  RETURNED: 'in',
  SOLD: 'out',
  DAMAGED: 'out',
  LOST: 'out',
};

interface ProductVariantsPanelProps {
  productId: string;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductVariantsPanel({
  productId,
  productName,
  open,
  onOpenChange,
}: ProductVariantsPanelProps) {
  const t = useTranslations('productVariants');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    setError(null);
    fetchVariants(productId)
      .then(setVariants)
      .catch((caught: unknown) => setError(translateError(caught)))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setAdjustingId(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-lg overflow-y-auto"
        title={t('title', { name: productName })}
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t('title', { name: productName })}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
          </div>

          <VariantForm
            key={editingId ?? 'new'}
            variant={variants?.find((v) => v.id === editingId) ?? null}
            onCancelEdit={() => setEditingId(null)}
            onSaved={(saved) => {
              setVariants((current) => {
                if (!current) return current;
                const exists = current.some((v) => v.id === saved.id);
                return exists
                  ? current.map((v) => (v.id === saved.id ? saved : v))
                  : [...current, saved];
              });
              setEditingId(null);
            }}
            productId={productId}
          />

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : !variants || variants.length === 0 ? (
            <EmptyState icon={Package} title={t('empty')} />
          ) : (
            <ul className="space-y-2">
              {variants.map((variant) => (
                <li key={variant.id} className="bg-card space-y-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{variant.name}</p>
                      {variant.sku ? (
                        <p className="text-muted-foreground force-ltr truncate text-xs">
                          {variant.sku}
                        </p>
                      ) : null}
                    </div>
                    <p className="tabular-nums">{variant.price}</p>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-muted-foreground text-sm">
                      {t('stock', { count: variant.stock })}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAdjustingId(adjustingId === variant.id ? null : variant.id)}
                      >
                        {t('adjust')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingId(variant.id)}
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('history')}
                        onClick={() => setHistoryId(variant.id)}
                      >
                        <History className="size-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('delete', { name: variant.name })}
                        onClick={() => setPendingDeleteId(variant.id)}
                      >
                        <Trash2 className="text-destructive size-4" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  {adjustingId === variant.id ? (
                    <InlineStockAdjust
                      variant={variant}
                      onAdjusted={(updated) => {
                        setVariants((current) =>
                          current?.map((v) => (v.id === updated.id ? { ...v, stock: updated.stock } : v)) ??
                          current,
                        );
                        setAdjustingId(null);
                      }}
                      onCancel={() => setAdjustingId(null)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDelete')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDeleteId(null)}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = pendingDeleteId;
                setPendingDeleteId(null);
                if (!id) return;
                void deleteVariant(id)
                  .then(() => setVariants((current) => current?.filter((v) => v.id !== id) ?? current))
                  .catch((caught: unknown) => setError(translateError(caught)));
              }}
            >
              {t('deleteShort')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VariantMovementLogSheet
        variantId={historyId}
        open={historyId !== null}
        onOpenChange={(next) => {
          if (!next) setHistoryId(null);
        }}
      />
    </Sheet>
  );
}

function VariantForm({
  variant,
  productId,
  onSaved,
  onCancelEdit,
}: {
  variant: Variant | null;
  productId: string;
  onSaved: (variant: Variant) => void;
  onCancelEdit: () => void;
}) {
  const t = useTranslations('productVariants');
  const translateError = useTranslatedApiError();

  const [name, setName] = useState(variant?.name ?? '');
  const [sku, setSku] = useState(variant?.sku ?? '');
  const [price, setPrice] = useState(variant?.price ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPriceValid = MONEY_PATTERN.test(price.trim());
  const canSubmit = name.trim().length > 0 && isPriceValid;

  async function submit() {
    if (!canSubmit) return;
    setIsSaving(true);
    setError(null);

    try {
      const input = { name: name.trim(), sku: sku.trim() || undefined, price: price.trim() };
      const saved = variant ? await updateVariant(variant.id, input) : await createVariant(productId, input);
      onSaved(saved);
      if (!variant) {
        setName('');
        setSku('');
        setPrice('');
      }
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="variant-name">{t('name')}</Label>
          <Input id="variant-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="variant-sku">{t('sku')}</Label>
          <Input
            id="variant-sku"
            className="force-ltr"
            value={sku}
            onChange={(event) => setSku(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="variant-price">{t('price')}</Label>
        <Input
          id="variant-price"
          inputMode="decimal"
          placeholder="0.00"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {variant ? (
          <Button type="button" variant="outline" size="sm" onClick={onCancelEdit}>
            {t('cancel')}
          </Button>
        ) : null}
        <Button type="button" size="sm" disabled={!canSubmit || isSaving} onClick={() => void submit()}>
          {isSaving ? t('saving') : variant ? t('save') : t('add')}
        </Button>
      </div>
    </div>
  );
}

function InlineStockAdjust({
  variant,
  onAdjusted,
  onCancel,
}: {
  variant: Variant;
  onAdjusted: (variant: { id: string; stock: number }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('productVariants');
  const tReason = useTranslations('stockReason');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<StockMovementReason | ''>('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(amount);
  const isValidAmount = Number.isInteger(parsed) && parsed > 0;
  const delta = direction === 'in' ? parsed : -parsed;
  const resulting = variant.stock + (isValidAmount ? delta : 0);
  const wouldGoNegative = isValidAmount && resulting < 0;

  function chooseReason(next: StockMovementReason) {
    setReason(next);
    // Same mapping StockAdjustSheet uses — a reason that only makes sense
    // one way sets the direction with it, so "damaged" adding stock is never
    // a silent mis-click.
    const implied = DIRECTION_FOR[next];
    if (implied) setDirection(implied);
  }

  async function submit() {
    if (!reason || !isValidAmount || wouldGoNegative) return;
    setIsSaving(true);
    setError(null);

    try {
      const result = await adjustVariantStock(variant.id, { delta, reason });
      onAdjusted(result.variant);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400 ? caught.message : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex gap-2">
        <Select value={reason} onValueChange={(value) => chooseReason(value as StockMovementReason)}>
          <SelectTrigger className="flex-1" aria-label={t('reasonLabel')}>
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

        <div className="flex gap-1">
          {(['in', 'out'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="icon"
              variant={direction === value ? 'default' : 'outline'}
              aria-pressed={direction === value}
              aria-label={t(value)}
              onClick={() => setDirection(value)}
            >
              {value === 'in' ? <Plus aria-hidden /> : <Minus aria-hidden />}
            </Button>
          ))}
        </div>

        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          className="w-20"
          aria-label={t('amount')}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>

      {wouldGoNegative ? (
        <p role="alert" className="text-destructive text-sm">
          {t('wouldGoNegative', { stock: formatter.number(variant.stock) })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!reason || !isValidAmount || wouldGoNegative || isSaving}
          onClick={() => void submit()}
        >
          {isSaving ? t('saving') : t('record')}
        </Button>
      </div>
    </div>
  );
}
