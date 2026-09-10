'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  ArchiveRestore,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  ScanLine,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  browseProducts,
  checkout,
  discardParkedSale,
  listParkedSales,
  parkSale,
  resumeParkedSale,
  scanProduct,
  voidSale,
  type ParkedSale,
  type CheckoutInput,
} from '@/lib/pos-api';
import { requestIntentFor, type RequestIntent } from '@/lib/request-intent';
import { addOrderNote } from '@/lib/orders-api';
import { ThermalReceipt, type ReceiptData } from '@/components/pos/thermal-receipt';
import { ProductGrid } from '@/components/pos/product-grid';
import { ManagerOverrideDialog } from '@/components/pos/manager-override-dialog';
import { TillReturnSheet } from '@/components/pos/till-return-sheet';
import { useAppSettings } from '@/components/providers/settings-provider';
import type { ManagerOverrideResult } from '@/lib/auth-api';
import type { ReturnResolution } from '@/lib/returns-api';

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
  const checkoutIntentRef = useRef<RequestIntent | null>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  /** Set once a manager approves a discount above the cap, for the CURRENT
   *  sale only — cleared whenever the cart empties, so the next customer's
   *  sale needs its own approval rather than inheriting the last one's. */
  const [overrideToken, setOverrideToken] = useState<string | null>(null);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [returnSheetOpen, setReturnSheetOpen] = useState(false);
  /** Exchange (O9.8) — set when a return just processed as REPLACEMENT, so
   *  the NEXT sale rung up links back to it. Two linked records, not one
   *  combined transaction: this is otherwise an ordinary sale, the return
   *  already happened on its own. Cleared once that sale completes, or if
   *  the cashier cancels out by clearing the cart before ringing it up. */
  const [pendingExchangeReturnId, setPendingExchangeReturnId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  /** Split payment (O9 Tier 3) — replaces `method`/`tendered` entirely when
   *  on, never combined with them (matches the server's own "one shape or
   *  the other" rule). Two entries to start: a split of one is not a split. */
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitLines, setSplitLines] = useState<
    { method: string; amount: string; tendered: string }[]
  >([
    { method: 'cash', amount: '', tendered: '' },
    { method: 'card', amount: '', tendered: '' },
  ]);
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
  /** Kept alongside `lastSale` (not folded into `ReceiptData`, which is a
   *  pure printing shape) so the void button below knows which order to
   *  void — the receipt itself has no reason to carry an id. */
  const [lastSaleOrderId, setLastSaleOrderId] = useState<string | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);
  /** A note on the just-completed sale (O9 Tier 3) — reuses the EXISTING
   *  order-notes thread (`OrderNote`, C5.7) rather than inventing a second
   *  one; the till is simply a new entry point into it, the same way it
   *  reused `returns.service.ts` wholesale for O9.7. */
  const [saleNote, setSaleNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [voidOverrideOpen, setVoidOverrideOpen] = useState(false);
  /** Carts set aside mid-sale (O9.12b) — the customer forgot their wallet,
   *  and without this the cashier's only option is to delete the cart and
   *  re-scan. Loaded once on mount, same as the grid's own category list;
   *  refetched after every park/resume/discard rather than patched locally,
   *  since the list is small and a round trip keeps it trivially correct. */
  const [parkedSales, setParkedSales] = useState<ParkedSale[]>([]);
  const [isParking, setIsParking] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [parkLabel, setParkLabel] = useState('');
  const [parkDialogOpen, setParkDialogOpen] = useState(false);

  const scanField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listParkedSales()
      .then(setParkedSales)
      .catch(() => {
        // A failed load just means the panel starts empty — parking still
        // works for the rest of the shift, and the next successful list
        // refresh (after the next park) corrects it.
      });
  }, []);

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
    // A new item starts a new sale; the previous receipt — and the ability
    // to void it from here — goes away with it. The order still exists and
    // can be voided from its own detail page if truly needed; this screen
    // only offers the fast path for "moments ago, same register".
    setLastSale(null);
    setLastSaleOrderId(null);
    setSaleNote('');
    setNoteSaved(false);

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

  /** Set the current cart aside. Clears the cart the same way a completed
   *  sale does — parking one and starting a fresh cart are the same "this
   *  cart is no longer what's in front of me" transition. */
  async function submitPark() {
    if (lines.length === 0 || isParking) return;

    setIsParking(true);
    setError(null);

    try {
      await parkSale(
        lines.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          ...(line.discountPercent !== null ? { discountPercent: line.discountPercent } : {}),
        })),
        parkLabel.trim() || undefined,
      );

      setParkedSales(await listParkedSales());
      setLines([]);
      setParkLabel('');
      setParkDialogOpen(false);
      toast.success(t('parked'));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsParking(false);
      refocus();
    }
  }

  /** Bring a parked cart back to the register. Re-fetches CURRENT price and
   *  stock for every line through the ordinary browse path rather than
   *  trusting what was parked — see the note on `ParkedSaleLine` in
   *  `pos-api.ts`. A line whose product was archived since it was parked is
   *  silently dropped, the same as it would be from an ordinary browse. */
  async function resumeCart(parked: ParkedSale) {
    if (resumingId) return;

    setResumingId(parked.id);
    setError(null);

    try {
      const resumed = await resumeParkedSale(parked.id);
      const products = await browseProducts({ ids: resumed.lines.map((line) => line.productId) });
      const byId = new Map(products.map((product) => [product.id, product]));

      const restored: CartLine[] = resumed.lines
        .map((line): CartLine | null => {
          const product = byId.get(line.productId);
          if (!product) return null;
          return {
            product,
            quantity: line.quantity,
            discountPercent: line.discountPercent ?? null,
          };
        })
        .filter((line): line is CartLine => line !== null);

      const droppedCount = resumed.lines.length - restored.length;

      setLastSale(null);
      setLastSaleOrderId(null);
      setSaleNote('');
      setNoteSaved(false);
      setLines(restored);
      setParkedSales(await listParkedSales());

      if (droppedCount > 0) {
        toast.warning(t('parkedItemsUnavailable', { count: droppedCount }));
      }
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setResumingId(null);
      refocus();
    }
  }

  async function discardCart(id: string) {
    try {
      await discardParkedSale(id);
      setParkedSales((current) => current.filter((row) => row.id !== id));
    } catch (caught) {
      setError(translateError(caught));
    }
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

  function updateSplitLine(index: number, patch: Partial<(typeof splitLines)[number]>) {
    setSplitLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  function addSplitLine() {
    // 6 is the server's own cap — a split beyond that is almost certainly a
    // mistake, not a real till scenario.
    if (splitLines.length >= 6) return;
    setSplitLines((current) => [...current, { method: 'cash', amount: '', tendered: '' }]);
  }

  function removeSplitLine(index: number) {
    // Never below two — one entry is the single-payment path wearing the
    // split shape, which the server refuses outright.
    if (splitLines.length <= 2) return;
    setSplitLines((current) => current.filter((_, i) => i !== index));
  }

  const splitTotal = useMemo(
    () => splitLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
    [splitLines],
  );

  async function takePayment() {
    if (lines.length === 0 || isSelling) return;

    setIsSelling(true);
    setError(null);

    try {
      const checkoutInput: CheckoutInput = {
        lines: lines.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          ...(line.discountPercent !== null ? { discountPercent: line.discountPercent } : {}),
        })),
        // Exactly one shape, never both — matches the server's own rule.
        ...(isSplitting
          ? {
              splitPayments: splitLines.map((line) => ({
                method: line.method,
                amount: line.amount.trim(),
                ...(line.method === 'cash' && line.tendered.trim() !== ''
                  ? { tendered: line.tendered.trim() }
                  : {}),
              })),
            }
          : {
              method,
              ...(method === 'cash' && tendered.trim() !== '' ? { tendered: tendered.trim() } : {}),
              ...(method === 'card' && reference.trim() !== ''
                ? { reference: reference.trim() }
                : {}),
            }),
        ...(overrideToken ? { overrideToken } : {}),
        ...(pendingExchangeReturnId ? { exchangeReturnId: pendingExchangeReturnId } : {}),
      };
      const intent = requestIntentFor(checkoutInput, checkoutIntentRef.current);
      checkoutIntentRef.current = intent;

      const result = await checkout(checkoutInput, intent.key);

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
      setLastSaleOrderId(result.orderId);
      toast.success(t('sold', { total: result.total }));

      setLines([]);
      setTendered('');
      setReference('');
      setIsSplitting(false);
      setSplitLines([
        { method: 'cash', amount: '', tendered: '' },
        { method: 'card', amount: '', tendered: '' },
      ]);
      setConfirmOpen(false);
      // The approval is for THIS sale only — the next customer's discount
      // (if any) needs its own manager, never inherited from the last one.
      setOverrideToken(null);
      // The exchange it was linked to is done — the next sale is ordinary
      // again, not another leg of the same exchange.
      setPendingExchangeReturnId(null);
      checkoutIntentRef.current = null;
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

  /**
   * Void the sale just rung up (O9 Tier 3) — same register, moments later,
   * distinct from a return (which needs an actual customer bringing
   * something back, and its own Sheet — `till-return-sheet.tsx`).
   */
  async function voidLastSale(overrideToken?: string) {
    if (!lastSaleOrderId || isVoiding) return;

    setIsVoiding(true);
    setError(null);

    try {
      await voidSale(lastSaleOrderId, overrideToken);
      toast.success(t('voided'));
      setLastSale(null);
      setLastSaleOrderId(null);
      setSaleNote('');
      setNoteSaved(false);
      setGridRefreshKey((n) => n + 1);
    } catch (caught) {
      // Same recognition the till return sheet uses: a 403 here means a
      // cashier hit the manager-required path, not a genuine failure — the
      // fix is the override dialog, not a raw error message.
      if (caught instanceof ApiError && caught.status === 403) {
        setVoidOverrideOpen(true);
        return;
      }

      setError(translateError(caught));
    } finally {
      setIsVoiding(false);
    }
  }

  /** Adds to the SAME thread the order-detail page reads, via the existing
   *  `addOrderNote` — no new model, no second thread to keep in sync. */
  async function saveSaleNote() {
    if (!lastSaleOrderId || saleNote.trim() === '' || isSavingNote) return;

    setIsSavingNote(true);
    setError(null);

    try {
      await addOrderNote(lastSaleOrderId, saleNote.trim());
      setSaleNote('');
      setNoteSaved(true);
      toast.success(t('noteSaved'));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSavingNote(false);
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

        <div className="flex flex-wrap gap-2">
          {/* Independent of any sale in progress — a customer bringing
              something back is not part of building the CURRENT cart, so
              this stays reachable regardless of what is in it (O9.7). */}
          <Button variant="outline" size="sm" onClick={() => setReturnSheetOpen(true)}>
            <RotateCcw className="size-4" aria-hidden />
            {t('processReturn')}
          </Button>

          {/* The customer forgot their wallet (O9.12b) — set the cart aside
              rather than deleting it and re-scanning everything later. */}
          {lines.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setParkDialogOpen(true)}
              disabled={isSelling}
            >
              <ArchiveRestore className="size-4" aria-hidden />
              {t('park')}
            </Button>
          ) : null}
        </div>

        <TillReturnSheet
          open={returnSheetOpen}
          onOpenChange={setReturnSheetOpen}
          onProcessed={({ returnId, resolution }: {
            returnId: string;
            resolution: ReturnResolution;
          }) => {
            if (resolution === 'REPLACEMENT') {
              setPendingExchangeReturnId(returnId);
              toast.info(t('exchangeStarted'));
            }
          }}
        />

        <AlertDialog open={parkDialogOpen} onOpenChange={setParkDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('parkTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('parkBody')}</AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-2 text-start">
              <Label htmlFor="park-label">{t('parkLabel')}</Label>
              <Input
                id="park-label"
                value={parkLabel}
                onChange={(event) => setParkLabel(event.target.value)}
                placeholder={t('parkLabelPlaceholder')}
                autoFocus
                disabled={isParking}
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isParking}>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void submitPark()} disabled={isParking}>
                <ArchiveRestore className="size-4" aria-hidden />
                {t('park')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {parkedSales.length > 0 ? (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-muted-foreground text-sm font-medium">
              {t('parkedCarts', { count: parkedSales.length })}
            </p>
            <ul className="space-y-1.5">
              {parkedSales.map((parked) => (
                <li
                  key={parked.id}
                  className="bg-muted/40 flex items-center justify-between gap-2 rounded-md px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {parked.label || t('parkedUntitled')}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t('parkedItemCount', { count: parked.lines.length })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void resumeCart(parked)}
                      disabled={resumingId !== null}
                    >
                      {t('resume')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void discardCart(parked.id)}
                      disabled={resumingId !== null}
                      aria-label={t('discardParked', { label: parked.label || t('parkedUntitled') })}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
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

        {/* Exchange in progress (O9.8) — the return already happened;
            whatever gets rung up next links back to it. Visible so the
            cashier does not lose track of WHY a plain-looking sale needs to
            complete before moving on to a regular customer. */}
        {pendingExchangeReturnId ? (
          <div className="bg-primary/10 flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm">
            <span>{t('exchangeInProgress')}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPendingExchangeReturnId(null)}
            >
              {t('cancelExchange')}
            </Button>
          </div>
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

        <div className="flex items-center gap-2">
          <Checkbox
            id="pos-split"
            checked={isSplitting}
            onCheckedChange={(checked) => setIsSplitting(checked === true)}
          />
          <Label htmlFor="pos-split">{t('splitPayment')}</Label>
        </div>

        {!isSplitting ? (
          <>
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
          </>
        ) : (
          <div className="space-y-2">
            {splitLines.map((line, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Select
                  value={line.method}
                  onValueChange={(value) => updateSplitLine(index, { method: value })}
                >
                  <SelectTrigger
                    className="w-28"
                    aria-label={t('splitMethodLabel', { index: index + 1 })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t('methods.cash')}</SelectItem>
                    <SelectItem value="card">{t('methods.card')}</SelectItem>
                    <SelectItem value="transfer">{t('methods.transfer')}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={line.amount}
                  onChange={(event) => updateSplitLine(index, { amount: event.target.value })}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="force-ltr"
                  aria-label={t('splitAmountLabel', { index: index + 1 })}
                />
                {splitLines.length > 2 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSplitLine(index)}
                    aria-label={t('removeSplitLine', { index: index + 1 })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
            ))}

            {splitLines.length < 6 ? (
              <Button variant="ghost" size="sm" onClick={addSplitLine}>
                <Plus className="size-4" aria-hidden />
                {t('addSplitLine')}
              </Button>
            ) : null}

            {/* Shown as context, not enforced client-side — the server is
                the one that refuses a mismatched sum, the same "warn, don't
                block" split every other till check in this file follows. */}
            <p className="text-muted-foreground text-xs tabular-nums">
              {t('splitTotal', { total: splitTotal.toFixed(2), estimate })}
            </p>
          </div>
        )}

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

            {/* Same thread the order-detail page reads (OrderNote, C5.7) —
                the till is a new entry point into it, not a second one. */}
            <div className="space-y-1.5">
              <Label htmlFor="pos-sale-note" className="text-xs">
                {t('noteLabel')}
              </Label>
              <div className="flex gap-1.5">
                <Input
                  id="pos-sale-note"
                  value={saleNote}
                  onChange={(event) => {
                    setSaleNote(event.target.value);
                    setNoteSaved(false);
                  }}
                  placeholder={t('notePlaceholder')}
                  className="h-8 text-sm"
                  disabled={isSavingNote}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void saveSaleNote()}
                  disabled={isSavingNote || saleNote.trim() === ''}
                >
                  {isSavingNote ? t('savingNote') : t('saveNote')}
                </Button>
              </div>
              {noteSaved ? (
                <p className="text-muted-foreground text-xs">{t('noteSaved')}</p>
              ) : null}
            </div>

            {/* Same-register, moments-later undo — distinct from a return,
                which needs an actual customer and lives in its own Sheet. */}
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive w-full"
              onClick={() => void voidLastSale()}
              disabled={isVoiding}
            >
              {isVoiding ? t('voiding') : t('voidSale')}
            </Button>
          </div>
        ) : null}

        <ManagerOverrideDialog
          open={voidOverrideOpen}
          onOpenChange={setVoidOverrideOpen}
          reason={t('managerOverride.voidReason')}
          onApproved={(result: ManagerOverrideResult) => {
            void voidLastSale(result.overrideToken);
          }}
        />
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
