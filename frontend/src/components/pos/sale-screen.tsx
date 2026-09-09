'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Minus, Plus, Printer, RotateCcw, ScanLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { checkout, scanProduct } from '@/lib/pos-api';
import { ThermalReceipt, type ReceiptData } from '@/components/pos/thermal-receipt';
import { ProductGrid } from '@/components/pos/product-grid';
import { ManagerOverrideDialog } from '@/components/pos/manager-override-dialog';
import { TillReturnSheet } from '@/components/pos/till-return-sheet';
import { useAppSettings } from '@/components/providers/settings-provider';
import type { ManagerOverrideResult } from '@/lib/auth-api';

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

/**
 * Everything a cart line actually reads (O9.10) — deliberately narrower than
 * `ScannedProduct`, because a grid tap only ever has `BrowsedProduct`, which
 * lacks `sku`/`barcode`/`totalStock`. Both response shapes already satisfy
 * this subset, so a line added by either path is the same shape here rather
 * than one of them needing a cast or a placeholder value.
 */
interface CartProduct {
  id: string;
  name: string;
  price: string;
  branchStock: number | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
}

interface CartLine {
  product: CartProduct;
  quantity: number;
  /** A cashier's ad-hoc discount on THIS line (O9 Tier 3), 0-100. `null`
   *  (not 0) means no discount control has touched this line — sent to the
   *  server as absent, never as a discount of zero. */
  discountPercent: number | null;
}

export function SaleScreen() {
  const t = useTranslations('pos');
  const translateError = useTranslatedApiError();
  const { maxCashierDiscountPercent } = useAppSettings();

  const [lines, setLines] = useState<CartLine[]>([]);
  /** Set once a manager approves a discount above the cap, for the CURRENT
   *  sale only — cleared whenever the cart empties, so the next customer's
   *  sale needs its own approval rather than inheriting the last one's. */
  const [overrideToken, setOverrideToken] = useState<string | null>(null);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [returnSheetOpen, setReturnSheetOpen] = useState(false);
  const [code, setCode] = useState('');
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  /** The card terminal's own receipt/reference number — asked for in the
   *  confirm dialog, not the sidebar, since it only makes sense once the
   *  method is card. See the schema comment on `Payment.reference`. */
  const [reference, setReference] = useState('');
  /** A confirm step between "Take Payment" and the charge actually firing —
   *  the sidebar total was always visible, but tapping the button charged
   *  immediately with no chance to catch a wrong item or method first. */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSelling, setIsSelling] = useState(false);
  /** Bumped once per completed sale so the grid refetches stock (O9.10). */
  const [gridRefreshKey, setGridRefreshKey] = useState(0);
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
        .reduce((sum, line) => {
          const unit =
            line.discountPercent === null
              ? Number(line.product.price)
              : (Number(line.product.price) * (100 - line.discountPercent)) / 100;
          return sum + unit * line.quantity;
        }, 0)
        .toFixed(2),
    [lines],
  );

  /** A NUDGE, not the real check — the server re-verifies every line against
   *  the live cap regardless (`pos.service.ts`), so this only decides
   *  whether to show the override dialog before even trying, rather than
   *  letting the cashier fill in the confirm dialog and hit a refusal. */
  const needsOverride = useMemo(
    () => lines.some((line) => (line.discountPercent ?? 0) > maxCashierDiscountPercent),
    [lines, maxCashierDiscountPercent],
  );

  function refocus() {
    scanField.current?.focus();
  }

  /**
   * Shared by a scan AND a grid tap (O9.10) — the de-dupe rule must be
   * identical either way. Scanning the same item twice adds one rather than
   * a second line, because two lines for one product is what the checkout
   * endpoint refuses, and it would print twice on the receipt. A grid tap
   * on an already-added product must behave the same way, not open a way
   * around that rule.
   */
  function addToCart(product: CartProduct) {
    // A new item starts a new sale; the previous receipt goes away.
    setLastSale(null);

    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);

      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }

      return [...current, { product, quantity: 1, discountPercent: null }];
    });
  }

  /** A cashier types a discount on one line (O9 Tier 3). Clamped, never
   *  refused client-side — the SERVER is the one that actually decides
   *  whether it needs a manager, the same "warn, don't block" split the
   *  over-stock warning already uses. */
  function setLineDiscount(productId: string, rawPercent: string) {
    const trimmed = rawPercent.trim();

    setLines((current) =>
      current.map((line) => {
        if (line.product.id !== productId) return line;

        if (trimmed === '') return { ...line, discountPercent: null };

        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) return line;

        return { ...line, discountPercent: Math.min(100, Math.max(0, parsed)) };
      }),
    );
  }

  async function submitScan(event: React.FormEvent) {
    event.preventDefault();

    const trimmed = code.trim();
    if (trimmed === '' || isScanning) return;

    setIsScanning(true);
    setError(null);

    try {
      const product = await scanProduct(trimmed);

      addToCart(product);
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
        lines: lines.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          ...(line.discountPercent !== null ? { discountPercent: line.discountPercent } : {}),
        })),
        method,
        ...(method === 'cash' && tendered.trim() !== '' ? { tendered: tendered.trim() } : {}),
        ...(method === 'card' && reference.trim() !== '' ? { reference: reference.trim() } : {}),
        ...(overrideToken ? { overrideToken } : {}),
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
      setReference('');
      setConfirmOpen(false);
      // The approval is for THIS sale only — the next customer's discount
      // (if any) needs its own manager, never inherited from the last one.
      setOverrideToken(null);
      // The sale just decremented branch stock — the grid must reflect that
      // for the NEXT customer, or a just-sold-out item still shows as
      // available. Found by walking through an actual sale end to end, not
      // by testing the grid's fetch logic in isolation.
      setGridRefreshKey((n) => n + 1);
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

        {/* Independent of any sale in progress — a customer bringing
            something back is not part of building the CURRENT cart, so this
            stays reachable regardless of what is in it (O9.7). */}
        <Button variant="outline" size="sm" onClick={() => setReturnSheetOpen(true)}>
          <RotateCcw className="size-4" aria-hidden />
          {t('processReturn')}
        </Button>

        <TillReturnSheet open={returnSheetOpen} onOpenChange={setReturnSheetOpen} />

        {error ? (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        {/* The running cart, moved ABOVE the grid (the owner's own screenshot
            of what he wanted at the top) — visible while the grid fills the
            rest of the screen, rather than scrolling out of view below it. */}
        {lines.length > 0 ? (
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
                  {/* Above the cap is shown, never hidden or refused HERE —
                      the server decides for real when the sale is taken, the
                      same "warn, don't block" split the over-stock notice
                      above already uses. */}
                  {line.discountPercent !== null &&
                  line.discountPercent > maxCashierDiscountPercent ? (
                    <p className="text-warning flex items-center gap-1 text-xs">
                      <AlertTriangle className="size-3 shrink-0" aria-hidden />
                      {t('discountNeedsApproval', { max: maxCashierDiscountPercent })}
                    </p>
                  ) : null}
                  <div className="mt-1 flex items-center gap-1.5">
                    <Label htmlFor={`discount-${line.product.id}`} className="sr-only">
                      {t('discountLabel', { name: line.product.name })}
                    </Label>
                    <Input
                      id={`discount-${line.product.id}`}
                      value={line.discountPercent === null ? '' : String(line.discountPercent)}
                      onChange={(event) => setLineDiscount(line.product.id, event.target.value)}
                      placeholder={t('discountPlaceholder')}
                      inputMode="decimal"
                      className="force-ltr h-7 w-20 text-xs"
                    />
                    <span className="text-muted-foreground text-xs">%</span>
                  </div>
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
        ) : null}

        {/* The PRIMARY way most products are found (O9.10) — the scan field
            above stays exact-match for the few products that carry a code.
            Tapping a tile calls the same addToCart() a scan does, so the
            de-dupe rule cannot differ between the two paths. */}
        <ProductGrid onAdd={addToCart} disabled={isSelling} refreshKey={gridRefreshKey} />
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
          onClick={() => {
            setError(null);
            // A discount above the cap gets its own dialog FIRST — the
            // confirm dialog is where money actually moves, and a cashier
            // who cannot get that far without a manager should not fill in
            // tendered/reference only to be refused at the last step.
            if (needsOverride && overrideToken === null) {
              setOverrideDialogOpen(true);
              return;
            }
            setConfirmOpen(true);
          }}
          disabled={lines.length === 0 || isSelling}
        >
          {t('takePayment')}
        </Button>

        <ManagerOverrideDialog
          open={overrideDialogOpen}
          onOpenChange={setOverrideDialogOpen}
          reason={t('managerOverride.discountReason', { max: maxCashierDiscountPercent })}
          onApproved={(result: ManagerOverrideResult) => {
            setOverrideToken(result.overrideToken);
            setConfirmOpen(true);
          }}
        />

        {/*
         * The confirm step between "Take Payment" and the charge actually
         * firing. The sidebar total was always visible, but tapping the
         * button used to charge immediately — no chance to catch a wrong
         * item or the wrong method before money moved.
         *
         * `AlertDialogAction` calls takePayment() directly rather than
         * closing the dialog first: a failed charge must keep the dialog
         * OPEN so the cashier sees the refusal right where they are, not
         * back on the till screen wondering why nothing happened. Success
         * closes it itself (see takePayment's `setConfirmOpen(false)`).
         */}
        <AlertDialog open={confirmOpen} onOpenChange={(open) => !isSelling && setConfirmOpen(open)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <ul className="divide-y rounded-md border text-start">
                    {lines.map((line) => (
                      <li
                        key={line.product.id}
                        className="text-foreground flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <span className="truncate">
                          {line.product.name}
                          <span className="text-muted-foreground ms-1 tabular-nums">
                            × {line.quantity}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {(Number(line.product.price) * line.quantity).toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="text-foreground flex items-baseline justify-between font-semibold">
                    <span>{t('confirmTotal')}</span>
                    <span className="text-lg tabular-nums">{estimate}</span>
                  </div>

                  <p className="text-muted-foreground text-xs">{t('confirmMethod', { method: t(`methods.${method}`) })}</p>

                  {method === 'card' ? (
                    <div className="space-y-2 pt-1">
                      <Label htmlFor="pos-reference">{t('referenceLabel')}</Label>
                      <Input
                        id="pos-reference"
                        value={reference}
                        onChange={(event) => setReference(event.target.value)}
                        placeholder={t('referencePlaceholder')}
                        className="force-ltr"
                        disabled={isSelling}
                      />
                      <p className="text-muted-foreground text-xs">{t('referenceHint')}</p>
                    </div>
                  ) : null}

                  {error ? (
                    <p
                      role="alert"
                      className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
                    >
                      {error}
                    </p>
                  ) : null}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSelling}>{t('confirmBack')}</AlertDialogCancel>
              <AlertDialogAction
                // Radix's Action closes the dialog on click by default —
                // prevented here because a FAILED charge must keep the
                // dialog open with the refusal visible, not dismiss and
                // strand the cashier looking at the till screen wondering
                // what happened. Success closes it explicitly instead, in
                // takePayment's own setConfirmOpen(false).
                onClick={(event) => {
                  event.preventDefault();
                  void takePayment();
                }}
                disabled={isSelling}
              >
                {isSelling ? t('taking') : t('confirmCharge')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
