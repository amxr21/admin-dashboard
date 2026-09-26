'use client';

import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { adjustVariantStock, createVariant } from '@/lib/variants-api';

/**
 * Options typed while CREATING a product. Variants attach to a real product
 * id, which doesn't exist until the first save, so these rows live in the
 * form and are created right after the product is (`createDraftVariants`).
 * Editing an existing product still goes through the full variants panel.
 */

export interface VariantDraft {
  key: number;
  name: string;
  price: string;
  stock: string;
}

const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
const COUNT_PATTERN = /^\d{1,6}$/;

let nextKey = 0;
export function emptyDraft(price = ''): VariantDraft {
  nextKey += 1;
  return { key: nextKey, name: '', price, stock: '' };
}

/** Rows the owner left completely blank are ignored, not errors. */
function isBlank(row: VariantDraft) {
  return row.name.trim() === '' && row.stock.trim() === '';
}

/** Error message keys per row key; empty when every filled row is valid. */
export function validateDrafts(rows: VariantDraft[]): Record<number, string> {
  const errors: Record<number, string> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    if (isBlank(row)) continue;
    const name = row.name.trim().toLowerCase();
    if (!name) errors[row.key] = 'nameRequired';
    else if (seen.has(name)) errors[row.key] = 'nameDuplicate';
    else if (!MONEY_PATTERN.test(row.price.trim())) errors[row.key] = 'priceInvalid';
    else if (row.stock.trim() !== '' && !COUNT_PATTERN.test(row.stock.trim())) errors[row.key] = 'stockInvalid';
    seen.add(name);
  }
  return errors;
}

/**
 * Creates the filled rows on the new product. Returns how many failed, so the
 * form can say so: the product itself is already saved at this point, and
 * the owner can finish the rest from "Manage variants".
 */
export async function createDraftVariants(productId: string, rows: VariantDraft[]): Promise<number> {
  let failed = 0;
  for (const row of rows) {
    if (isBlank(row)) continue;
    try {
      const variant = await createVariant(productId, { name: row.name.trim(), price: row.price.trim() });
      const stock = Number(row.stock.trim() || '0');
      if (stock > 0) await adjustVariantStock(variant.id, { delta: stock, reason: 'RECEIVED' });
    } catch {
      failed += 1;
    }
  }
  return failed;
}

interface VariantDraftRowsProps {
  rows: VariantDraft[];
  errors: Record<number, string>;
  defaultPrice: string;
  disabled?: boolean;
  onChange: (rows: VariantDraft[]) => void;
}

export function VariantDraftRows({ rows, errors, defaultPrice, disabled = false, onChange }: VariantDraftRowsProps) {
  const t = useTranslations('resourceForm.variantDrafts');

  function update(key: number, patch: Partial<VariantDraft>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset className="space-y-3 rounded-lg border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{t('title')}</legend>
      <p className="text-muted-foreground text-sm">{t('hint')}</p>

      <div className="space-y-2">
        {rows.map((row, index) => {
          const error = errors[row.key];
          return (
            <div key={row.key} className="space-y-1">
              <div className="grid grid-cols-[1fr_6.5rem_5.5rem_auto] items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`variant-draft-name-${String(row.key)}`} className={index > 0 ? 'sr-only' : undefined}>
                    {t('name')}
                  </Label>
                  <Input
                    id={`variant-draft-name-${String(row.key)}`}
                    value={row.name}
                    placeholder={t('namePlaceholder')}
                    aria-invalid={error ? true : undefined}
                    onChange={(event) => update(row.key, { name: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`variant-draft-price-${String(row.key)}`} className={index > 0 ? 'sr-only' : undefined}>
                    {t('price')}
                  </Label>
                  <Input
                    id={`variant-draft-price-${String(row.key)}`}
                    value={row.price}
                    inputMode="decimal"
                    className="force-ltr"
                    onChange={(event) => update(row.key, { price: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`variant-draft-stock-${String(row.key)}`} className={index > 0 ? 'sr-only' : undefined}>
                    {t('stock')}
                  </Label>
                  <Input
                    id={`variant-draft-stock-${String(row.key)}`}
                    value={row.stock}
                    inputMode="numeric"
                    placeholder="0"
                    className="force-ltr"
                    onChange={(event) => update(row.key, { stock: event.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('remove', { index: index + 1 })}
                  onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {t(`errors.${error}`)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, emptyDraft(defaultPrice)])}>
        <Plus className="size-4" aria-hidden />
        {t('add')}
      </Button>
    </fieldset>
  );
}
