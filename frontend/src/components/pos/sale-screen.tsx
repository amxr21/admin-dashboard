'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Minus, Plus, Printer, ScanLine, Trash2 } from 'lucide-react';
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
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { checkout, scanProduct, type ScannedProduct } from '@/lib/pos-api';
import { ThermalReceipt, type ReceiptData } from '@/components/pos/thermal-receipt';

/**
 * The till (O5.5).
 *
 * ─── THE SCAN FIELD KEEPS FOCUS, ALWAYS ──────────────────────────────
 * A hardware scanner is a keyboard: it types the code and presses Enter. If
 * focus has wandered to a quantity box, the barcode lands there instead and
 * silently changes a quantity to 5012345678900. So focus returns to the scan
 * field after every action, which is also what a cashier expects — the next
 * thing they do is always scan the next item.
 *
 * ─── THIS SCREEN DOES NOT KNOW WHICH SHIFT IT IS IN ──────────────────
 * It used to: it read the open shift once on mount and sent that id with
 * every sale. Held for the life of the page, that id went stale the moment
 * the cashier clocked out — and a cashier who hands the terminal over
 * without a reload then posted the PREVIOUS person's shift, quietly moving
 * their takings into somebody else's drawer (O9.17).
 *
 * The server now resolves the shift from the authenticated user on every
 * checkout, so there is nothing here to go stale. Do not reintroduce a
 * client-held shift id.
 *
 * ─── THE TOTAL IS COMPUTED SERVER-SIDE, NOT HERE ─────────────────────
 * What this screen shows is an ESTIMATE for the customer's benefit. The
 * authoritative subtotal/tax/total come back from `/pos/checkout`, which uses
 * the shared receipt math (O5.4). Two implementations of the same arithmetic
 * is precisely how a receipt ends up disagreeing with an invoice by a cent.
 */

interface CartLine {
  product: ScannedProduct;
  quantity: number;
}

export function SaleScreen() {
  const t = useTranslations('pos');
  const translateError = useTranslatedApiError();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [code, setCode] = useState('');
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isSelling, setIsSelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The completed sale, kept so it can be printed. Cleared by the next scan
   *  — a receipt left on screen while a new sale is rung up is one somebody
   *  eventually prints for the wrong customer. */
  const [lastSale, setLastSale] = useState<ReceiptData | null>(null);

  const scanField = useRef<HTMLInputElement>(null);

  /** Display only — see the note at the top of this file. */
  const estimate = useMemo(
    () =>
      lines
        .reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0)
        .toFixed(2),
    [lines],
  );

  function refocus() {
    scanField.current?.focus();
  }

  async function submitScan(event: React.FormEvent) {
    event.preventDefault();

    const trimmed = code.trim();
    if (trimmed === '' || isScanning) return;

    setIsScanning(true);
    setError(null);

    try {
      const product = await scanProduct(trimmed);

      // A new scan starts a new sale; the previous receipt goes away.
      setLastSale(null);

      setLines((current) => {
        const existing = current.find((line) => line.product.id === product.id);

        // Scanning the same item twice adds one, rather than a second line.
        // Two lines for one product is what the checkout endpoint refuses,
        // and it would print twice on the receipt.
        if (existing) {
          return current.map((line) =>
            line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
          );
        }

        return [...current, { product, quantity: 1 }];
      });

      setCode('');
    } catch (caught) {
      // The API's 404 names the code it could not find — at a till the usual
      // cause is a mis-scan, and seeing what was read is how somebody notices
      // a dropped digit.
      setError(
        caught instanceof ApiError && caught.status === 404
          ? caught.message
          : translateError(caught),
      );
      // The bad code stays in the field so it can be corrected rather than
      // retyped from the label.
    } finally {
      setIsScanning(false);
      refocus();
    }
  }

  function setQuantity(productId: string, quantity: number) {
    setLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.product.id !== productId)
        : current.map((line) =>
            line.product.id === productId ? { ...line, quantity } : line,
          ),
    );
    refocus();
  }

  async function takePayment() {
    if (lines.length === 0 || isSelling) return;

    setIsSelling(true);
    setError(null);

    try {
      const result = await checkout({
        lines: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        method,
        ...(method === 'cash' && tendered.trim() !== '' ? { tendered: tendered.trim() } : {}),
      });

      // Kept on screen rather than toasted away: the change to hand back is
      // the one number the cashier still needs AFTER the sale completes, and
      // a toast disappears while they are opening the drawer.
      //
      // Built from the SERVER's figures, not the on-screen estimate — the
      // receipt is the document of record and must show what was charged.
      setLastSale({
        orderNumber: result.orderNumber,
        soldAt: new Date().toLocaleString(),
        lines: lines.map((line) => ({
          name: line.product.name,
          quantity: line.quantity,
          price: line.product.price,
        })),
        subtotal: result.subtotal,
        taxAmount: result.taxAmount,
        total: result.total,
        method,
        tendered: method === 'cash' && tendered.trim() !== '' ? tendered.trim() : null,
        change: result.change,
      });
      toast.success(t('sold', { total: result.total }));

      setLines([]);
      setTendered('');
    } catch (caught) {
      // A 400 here is a real refusal the cashier must read — not enough
      // stock, tendered less than the total — so it is shown verbatim rather
      // than flattened.
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSelling(false);
      refocus();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <form onSubmit={(event) => void submitScan(event)} className="space-y-2">
          <Label htmlFor="pos-scan">{t('scanLabel')}</Label>
          <div className="flex gap-2">
            <Input
              id="pos-scan"
              ref={scanField}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t('scanPlaceholder')}
              // force-ltr: a code must not visually reorder in an Arabic
              // layout, and autoFocus because scanning is the default action.
              className="force-ltr"
              autoFocus
              autoComplete="off"
              disabled={isScanning}
            />
            <Button type="submit" disabled={isScanning || code.trim() === ''}>
              <ScanLine className="size-4" aria-hidden />
              {t('add')}
            </Button>
          </div>
        </form>

        {error ? (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        {lines.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-12 text-center text-sm">
            {t('empty')}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {lines.map((line) => (
              <li key={line.product.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{line.product.name}</p>
                  <p className="text-muted-foreground text-sm tabular-nums">
                    {line.product.price}
                  </p>
                  {/* Warnings, not blocks — the server decides. A cashier
                      holding the item needs to know, not to be stopped. */}
                  {line.product.branchStock !== null &&
                  line.quantity > line.product.branchStock ? (
                    <p className="text-warning flex items-center gap-1 text-xs">
                      <AlertTriangle className="size-3 shrink-0" aria-hidden />
                      {t('overStock', { available: line.product.branchStock })}
                    </p>
                  ) : null}
                  {line.product.status === 'ARCHIVED' ? (
                    <p className="text-muted-foreground text-xs">{t('archived')}</p>
                  ) : null}
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setQuantity(line.product.id, line.quantity - 1)}
                    aria-label={t('decrease', { name: line.product.name })}
                  >
                    <Minus className="size-4" aria-hidden />
                  </Button>
                  <span className="w-8 text-center tabular-nums">{line.quantity}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setQuantity(line.product.id, line.quantity + 1)}
                    aria-label={t('increase', { name: line.product.name })}
                  >
                    <Plus className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setQuantity(line.product.id, 0)}
                    aria-label={t('remove', { name: line.product.name })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="space-y-4 rounded-lg border p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground text-sm">{t('estimate')}</span>
          <span className="text-2xl font-semibold tabular-nums">{estimate}</span>
        </div>
        {/* Said outright: the authoritative figure comes back from the server,
            which applies tax with the shared receipt math. */}
        <p className="text-muted-foreground text-xs">{t('estimateNote')}</p>

        <div className="space-y-2">
          <Label htmlFor="pos-method">{t('method')}</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger id="pos-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">{t('methods.cash')}</SelectItem>
              <SelectItem value="card">{t('methods.card')}</SelectItem>
              <SelectItem value="transfer">{t('methods.transfer')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {method === 'cash' ? (
          <div className="space-y-2">
            <Label htmlFor="pos-tendered">{t('tendered')}</Label>
            <Input
              id="pos-tendered"
              value={tendered}
              onChange={(event) => setTendered(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="force-ltr"
            />
          </div>
        ) : null}

        <Button
          className="w-full"
          onClick={() => void takePayment()}
          disabled={lines.length === 0 || isSelling}
        >
          {isSelling ? t('taking') : t('takePayment')}
        </Button>

        {lastSale ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t('done', { number: lastSale.orderNumber })}</p>
            {lastSale.change !== null ? (
              // The number the cashier still needs after the sale — kept on
              // screen rather than in a toast that vanishes while they are
              // opening the drawer.
              <p className="text-lg font-semibold tabular-nums">
                {t('change', { amount: lastSale.change })}
              </p>
            ) : null}
            <Button variant="outline" className="w-full" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              {t('printReceipt')}
            </Button>
          </div>
        ) : null}
      </aside>

      {/* Rendered off-screen and revealed only by the print stylesheet, so the
          till screen stays a till screen. `hidden` would remove it from the
          print output too — `sr-only` keeps it in the document. */}
      {lastSale ? (
        <div className="sr-only print:not-sr-only">
          <ThermalReceipt data={lastSale} />
        </div>
      ) : null}
    </div>
  );
}
