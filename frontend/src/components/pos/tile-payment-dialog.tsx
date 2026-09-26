'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, CreditCard, Delete, Loader2 } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { quoteSale, type CheckoutLine } from '@/lib/pos-api';
import { cn } from '@/lib/utils';

/**
 * The tile till's payment screen: one big total, Cash or Card, and for cash a
 * keypad plus quick amounts, with the change shown before the sale is taken.
 *
 * The total comes from `POST /pos/quote`, the server's own checkout math with
 * VAT included, never from arithmetic here. "Exact" and the change figure are
 * therefore the receipt's numbers, and a cash amount the server would refuse
 * as short can't be confirmed.
 */

type Method = 'cash' | 'card';

interface TilePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: CheckoutLine[];
  method: Method;
  onMethodChange: (method: Method) => void;
  tendered: string;
  onTenderedChange: (tendered: string) => void;
  isSelling: boolean;
  error: string | null;
  onConfirm: () => void;
}

/** Round-up amounts a customer is likely to hand over, above the total. */
export function quickAmounts(total: number): number[] {
  const steps = [5, 10, 20, 50, 100, 200, 500];
  const amounts = new Set<number>();
  for (const step of steps) {
    const next = Math.ceil(total / step) * step;
    if (next > total) amounts.add(next);
  }
  return [...amounts].sort((a, b) => a - b).slice(0, 4);
}

/** Keypad input on a money string: digits, one dot, at most 2 decimals, 8 whole digits. */
export function pressKey(current: string, key: string): string {
  if (key === 'back') return current.slice(0, -1);
  if (key === 'clear') return '';
  if (key === '.') return current.includes('.') ? current : `${current || '0'}.`;
  const next = current === '0' ? key : current + key;
  return /^\d{1,8}(\.\d{0,2})?$/.test(next) ? next : current;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

export function TilePaymentDialog({
  open,
  onOpenChange,
  lines,
  method,
  onMethodChange,
  tendered,
  onTenderedChange,
  isSelling,
  error,
  onConfirm,
}: TilePaymentDialogProps) {
  const t = useTranslations('pos.tiles');
  const format = useCurrencyFormat();
  const translateError = useTranslatedApiError();
  const [total, setTotal] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const linesKey = JSON.stringify(lines);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setTotal(null);
    setQuoteError(null);
    quoteSale(lines)
      .then((quote) => { if (active) setTotal(quote.total); })
      .catch((caught: unknown) => { if (active) setQuoteError(translateError(caught)); });
    return () => { active = false; };
    // `linesKey` stands in for `lines`, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, linesKey, translateError]);

  const due = total === null ? null : Number(total);
  const received = Number(tendered || '0');
  const change = due !== null && method === 'cash' && tendered !== '' ? received - due : null;
  const canConfirm =
    due !== null && !isSelling && (method === 'card' || (tendered !== '' && received >= due));
  const quick = useMemo(() => (due === null ? [] : quickAmounts(due)), [due]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSelling) onOpenChange(next); }}>
      <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="sr-only">{t('payTitle')}</DialogTitle>
        <DialogDescription className="sr-only">{t('payDescription')}</DialogDescription>

        <div className="space-y-5">
          <div className="text-center">
            <p className="text-muted-foreground text-sm">{t('toPay')}</p>
            <p className="text-5xl font-bold tabular-nums" aria-live="polite">
              {due === null ? (quoteError ? '—' : <Loader2 className="mx-auto size-10 animate-spin" aria-label={t('loadingTotal')} />) : format(due)}
            </p>
            {quoteError ? <p role="alert" className="text-destructive mt-2 text-sm">{quoteError}</p> : null}
          </div>

          <div role="radiogroup" aria-label={t('method')} className="grid grid-cols-2 gap-3">
            {([['cash', Banknote], ['card', CreditCard]] as const).map(([value, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={method === value}
                onClick={() => onMethodChange(value)}
                className={cn(
                  'flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 text-lg font-semibold transition',
                  method === value ? 'border-primary bg-primary/10' : 'hover:bg-muted/50',
                )}
              >
                <Icon className="size-7" aria-hidden />
                {t(`methods.${value}`)}
              </button>
            ))}
          </div>

          {method === 'cash' ? (
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
              <div className="space-y-3">
                <div className="rounded-xl border p-3 text-center">
                  <p className="text-muted-foreground text-sm">{t('received')}</p>
                  <p className="text-3xl font-semibold tabular-nums">{tendered === '' ? '—' : format(received)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-14 text-base"
                    disabled={total === null}
                    onClick={() => total !== null && onTenderedChange(total)}
                  >
                    {t('exact')}
                  </Button>
                  {quick.map((amount) => (
                    <Button
                      key={amount}
                      type="button"
                      variant="outline"
                      className="min-h-14 text-base tabular-nums"
                      onClick={() => onTenderedChange(amount.toFixed(2))}
                    >
                      {format(amount)}
                    </Button>
                  ))}
                </div>
                <div
                  className={cn(
                    'rounded-xl p-3 text-center',
                    change !== null && change < 0 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success',
                  )}
                  aria-live="polite"
                >
                  <p className="text-sm">{change !== null && change < 0 ? t('short') : t('change')}</p>
                  <p className="text-2xl font-bold tabular-nums">{change === null ? '—' : format(Math.abs(change))}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2" aria-label={t('keypad')}>
                {KEYS.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    className="min-h-14 text-xl font-semibold"
                    aria-label={key === 'back' ? t('backspace') : key}
                    onClick={() => onTenderedChange(pressKey(tendered, key))}
                  >
                    {key === 'back' ? <Delete className="size-5" aria-hidden /> : key}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground rounded-xl border p-4 text-center">{t('cardHint')}</p>
          )}

          {error ? <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{error}</p> : null}

          <div className="grid grid-cols-[auto_1fr] gap-3">
            <Button type="button" variant="ghost" className="min-h-14" disabled={isSelling} onClick={() => onOpenChange(false)}>
              {t('back')}
            </Button>
            <Button type="button" className="min-h-14 text-lg" disabled={!canConfirm} onClick={onConfirm}>
              {isSelling ? t('taking') : t('complete')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
