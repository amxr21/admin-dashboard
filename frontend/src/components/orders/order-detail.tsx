'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  HandCoins,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Printer,
  Store,
  Truck,
} from 'lucide-react';

import { Breadcrumb } from '@/components/shell/breadcrumb';
import { useAppSettings } from '@/components/providers/settings-provider';
import { ErrorScreen } from '@/components/errors/error-screen';
import { LastUpdatedNote } from '@/components/last-updated-note';
import { OrderActivity } from '@/components/orders/order-activity';
import { OrderDeliveryCard } from '@/components/orders/order-delivery-card';
import { OrderStatusDialog } from '@/components/orders/order-status-dialog';
import { OrderStatusActions, OrderStatusStrip } from '@/components/orders/order-status-strip';
import { RefundOrderDialog } from '@/components/orders/refund-order-dialog';
import { RequestReturnSheet } from '@/components/orders/request-return-sheet';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type StaffRole } from '@/config/areas';
import { useCanAccessArea } from '@/components/providers/role-permissions-provider';
import { useAuth } from '@/hooks/useAuth';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useIsMobileViewport } from '@/hooks/useIsMobileViewport';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { ApiError } from '@/lib/api';
import { fetchAudit } from '@/lib/audit-api';
import { initialsOf } from '@/lib/initials';
import { isFinalOrder, planStatusActions } from '@/lib/order-status-flow';
import {
  fetchOrder,
  fetchOrderNeighbors,
  type OrderDetail as Order,
  type OrderListParams,
  type OrderNeighbors,
  type OrderStatus,
} from '@/lib/orders-api';

/**
 * The most recent of the order's status-history entries (a legal lifecycle
 * move) and its most recent audit entry (currently only internal-notes
 * edits — `changeOrderStatus` writes `OrderStatusHistory` instead of calling
 * `audit()`, see orders.service.ts) — whichever actually happened last.
 * Returns `null` when the order has never been touched beyond creation.
 */
function latestActivity(
  order: Order,
  latestAuditEntry: { createdAt: string; actorEmail: string | null } | null,
): { when: string; who: string | null } | null {
  const latestStatusEntry = order.statusHistory.at(-1) ?? null;

  const candidates = [
    latestStatusEntry
      ? { when: latestStatusEntry.createdAt, who: latestStatusEntry.changedByName }
      : null,
    latestAuditEntry
      ? { when: latestAuditEntry.createdAt, who: latestAuditEntry.actorEmail }
      : null,
  ].filter((c): c is { when: string; who: string | null } => c !== null);

  if (candidates.length === 0) return null;

  return candidates.reduce((latest, candidate) =>
    new Date(candidate.when).getTime() > new Date(latest.when).getTime() ? candidate : latest,
  );
}

/** The same 5 filter/sort keys `orders-table.tsx` writes to the URL when it
 *  links into a row — anything else on the query string is ignored. */
const NEIGHBOR_PARAM_KEYS = ['search', 'status', 'from', 'to', 'sort', 'dir'] as const;

/**
 * One order: line items, customer, delivery and the status trail.
 *
 * Everything on this screen is a RECORD of what happened, not a live view of
 * current data. Line prices and the total are the values at the time of the
 * order, so nothing here is recomputed from today's catalogue.
 *
 * ─── LAYOUT: EACH ACTION SITS WITH WHAT IT CHANGES ───────────────────
 * The header holds identity (number, status, when, where) and the one
 * document action, Invoice — no form fields. Status moves live in the status
 * strip under it, Refund on the Payment card, courier changes on the Delivery
 * card, notes in the Activity feed. The status control used to sit in the
 * header's button row and grow a note field in place, which is the layout
 * problem this arrangement exists to fix.
 */

export function OrderDetail({ id }: { id: string }) {
  const canAccessArea = useCanAccessArea();
  const t = useTranslations('orders');
  const tReturn = useTranslations('returns.detail');
  const tNav = useTranslations('nav');
  const tErrors = useTranslations('errorPages.notFound');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();
  const searchParams = useSearchParams();
  const isMobile = useIsMobileViewport();
  const { navLabels } = useAppSettings();
  const ordersLabel = navLabels.orders ?? tNav('orders');
  const { user } = useAuth();
  // A courtesy only — the server enforces the real `returns` gate on the
  // refund route regardless of what this hides.
  const canRefund = canAccessArea((user?.role ?? 'DEMO') as StaffRole, 'returns');

  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [returnSheetOpen, setReturnSheetOpen] = useState(false);
  const [returnMessage, setReturnMessage] = useState<string | null>(null);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  // Kept after the dialog closes so its content doesn't blank mid-animation.
  const [statusTarget, setStatusTarget] = useState<OrderStatus | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [neighbors, setNeighbors] = useState<OrderNeighbors | null>(null);
  const [latestAuditEntry, setLatestAuditEntry] = useState<{
    createdAt: string;
    actorEmail: string | null;
  } | null>(null);

  // Present only when the row was clicked from the orders table (it stamps
  // these onto the link) — arriving here any other way (a bookmark, a deep
  // link from the dashboard) means there's no "list this came from", so
  // Prev/Next is correctly absent rather than guessing at one.
  const listFilters: Omit<OrderListParams, 'page' | 'pageSize'> = {};
  for (const key of NEIGHBOR_PARAM_KEYS) {
    const value = searchParams.get(key);
    if (value) (listFilters as Record<string, string>)[key] = value;
  }
  const hasListContext = Object.keys(listFilters).length > 0;
  const listFiltersKey = JSON.stringify(listFilters);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      setNotFound(false);
      setNeighbors(null);
      setLatestAuditEntry(null);

      try {
        const loaded = await fetchOrder(id);
        if (!cancelled) setOrder(loaded);
      } catch (caught) {
        if (cancelled) return;
        // A missing order is "doesn't exist", not "something went wrong" —
        // different screens, because only one of them is worth retrying.
        if (caught instanceof ApiError && caught.status === 404) {
          setNotFound(true);
        } else {
          setError(translateError(caught));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }

      // Best-effort, independent of the main load — a neighbor lookup
      // failing must never block the order itself from rendering.
      if (hasListContext) {
        fetchOrderNeighbors(id, listFilters)
          .then((result) => {
            if (!cancelled) setNeighbors(result);
          })
          .catch(() => {
            /* Prev/Next simply doesn't render — see below. */
          });
      }

      // Also best-effort (C5.3) — the newest entry for this order, if any.
      // A failed lookup just means "Updated by" falls back to the status
      // history alone rather than blocking the order from rendering.
      fetchAudit({ entity: 'orders', entityId: id, pageSize: 1 })
        .then((result) => {
          if (cancelled) return;
          const [newest] = result.entries;
          if (newest) {
            setLatestAuditEntry({ createdAt: newest.createdAt, actorEmail: newest.actorEmail });
          }
        })
        .catch(() => {
          /* Falls back to statusHistory alone — see latestActivity(). */
        });
    }

    void load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listFiltersKey stands in for listFilters/hasListContext, both rebuilt fresh from searchParams every render
  }, [id, translateError, listFiltersKey]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound) {
    return <ErrorScreen title={tErrors('title')} description={tErrors('description')} />;
  }

  if (error || !order) {
    return (
      <ErrorScreen
        title={tErrors('title')}
        description={error ?? tErrors('description')}
        onRetry={() => window.location.reload()}
      />
    );
  }

  const money = (value: string | null) => (value === null ? '—' : formatCurrency(Number(value)));
  const lastActivity = latestActivity(order, latestAuditEntry);
  const statusIsFinal = isFinalOrder(planStatusActions(order.nextStatuses));

  function startStatusMove(status: OrderStatus) {
    // RETURNED goes through the returns flow (which items, and why), never a
    // bare status flip — the server refuses that here too.
    if (status === 'RETURNED') {
      setReturnSheetOpen(true);
      return;
    }
    setStatusTarget(status);
    setStatusDialogOpen(true);
  }

  const statusActions = (
    <OrderStatusActions order={order} onStart={startStatusMove} fill={isMobile} />
  );

  return (
    <div className="space-y-5">
      <Breadcrumb
        segments={[
          { label: ordersLabel, href: '/admin/orders' },
          // `force-ltr` isn't available on a plain breadcrumb label string
          // the way it is on the `<h1>` below — the order number is still
          // Western-numeral/Latin-script regardless of locale, so this is a
          // cosmetic gap in RTL only (the number itself is never mangled),
          // not a functional one.
          { label: order.orderNumber },
        ]}
      />

      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex min-w-0 items-center gap-3 text-2xl font-semibold">
            <span className="force-ltr">{order.orderNumber}</span>
            <StatusBadge kind="orderStatus" value={order.status} />
          </h1>

          <div className="flex items-center gap-2">
            {/* Prev/Next share the title row instead of taking a row of
                their own above it. Only when the order was opened from a
                filtered list (C5.1). */}
            {hasListContext && (neighbors?.prev || neighbors?.next) ? (
              <nav aria-label={t('neighbors.label')} className="flex items-center">
                {neighbors.prev ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link
                      href={{ pathname: `/admin/orders/${neighbors.prev.id}`, query: listFilters }}
                      aria-label={t('neighbors.previous', { number: neighbors.prev.orderNumber })}
                    >
                      <PrevArrow />
                      <span className="force-ltr">{neighbors.prev.orderNumber}</span>
                    </Link>
                  </Button>
                ) : null}
                {neighbors.prev && neighbors.next ? (
                  <span aria-hidden className="bg-border mx-0.5 h-4 w-px" />
                ) : null}
                {neighbors.next ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link
                      href={{ pathname: `/admin/orders/${neighbors.next.id}`, query: listFilters }}
                      aria-label={t('neighbors.next', { number: neighbors.next.orderNumber })}
                    >
                      <span className="force-ltr">{neighbors.next.orderNumber}</span>
                      <NextArrow />
                    </Link>
                  </Button>
                ) : null}
              </nav>
            ) : null}

            <Button variant="outline" asChild>
              <Link href={`/admin/orders/${order.id}/invoice`}>
                <Printer aria-hidden />
                {t('invoice.action')}
              </Link>
            </Button>
          </div>
        </div>

        {/* No "·" separators: when this wraps on a phone a separator is
            left dangling at the end of a line. The icons already split it. */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            {t('placedOn', {
              date: formatter.dateTime(new Date(order.placedAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </span>
          {/* Where it was taken (F8). Beside the date because "when and
              where" is one fact, and because on "All branches" two orders
              from different businesses are otherwise indistinguishable
              once opened. Omitted entirely when unattributed — an order
              that predates branches has no branch, and inventing one would
              claim it belongs somewhere it does not. */}
          {order.branch ? (
            <span className="inline-flex items-center gap-1">
              <Store className="size-3.5" aria-hidden />
              {order.branch.name}
              {order.branch.code ? (
                <span className="text-muted-foreground">({order.branch.code})</span>
              ) : null}
            </span>
          ) : null}
          {lastActivity ? (
            <LastUpdatedNote
              when={lastActivity.when}
              who={lastActivity.who}
              auditHref={`/admin/audit?entity=orders&entityId=${order.id}`}
            />
          ) : null}
        </div>
      </header>

      <OrderStatusStrip
        order={order}
        compact={isMobile}
        // On a phone the buttons move to the bar pinned at the bottom of the
        // page; a final order has no buttons, just its closing note, so that
        // stays here.
        actions={isMobile && !statusIsFinal ? null : statusActions}
      />

      {returnMessage ? (
        <p role="status" className="bg-success/10 text-success rounded-md px-3 py-2 text-sm">
          {returnMessage}
        </p>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {/* bodyClassName="": the table is full-bleed and the total row below
              carries its own padding, so the default p-4 would inset both.
              The total stays in the header so it is still visible when the
              section is folded away. */}
          <CollapsibleSection
            title={t('items.title')}
            aside={<span className="tabular-nums">{money(order.total)}</span>}
            bodyClassName=""
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('items.product')}</TableHead>
                  <TableHead className="text-end">{t('items.quantity')}</TableHead>
                  <TableHead className="text-end">{t('items.price')}</TableHead>
                  <TableHead className="text-end">{t('items.lineTotal')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.product ? (
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.product.name}</p>
                          {item.variant ? (
                            <p className="text-muted-foreground truncate text-xs">
                              {item.variant.name}
                              {item.variant.sku ? <span className="force-ltr ms-1">· {item.variant.sku}</span> : null}
                            </p>
                          ) : null}
                          {item.product.sku ? (
                            <p className="text-muted-foreground force-ltr truncate text-xs">
                              {item.product.sku}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        // Line items carry a price snapshot but NOT a name
                        // snapshot, so a hard-deleted product leaves nothing to
                        // show. Saying so beats rendering a blank row.
                        <span className="text-muted-foreground italic">
                          {t('items.productRemoved')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatter.number(item.quantity)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {money(item.price)}
                      {item.discountPercent ? (
                        <span className="text-muted-foreground block text-xs">
                          {t('items.lineDiscount', { percent: Number(item.discountPercent) })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {money(item.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/**
              * Subtotal and tax, not just the grand total.
              *
              * Both were already fetched and then dropped — the order records
              * what tax was charged, and showing one combined figure made that
              * unanswerable from this screen. The POS receipt
              * (`thermal-receipt.tsx`) always printed all three; the admin view
              * was the one lagging behind.
              *
              * Rendered only when a subtotal EXISTS. An order placed before
              * these columns were populated has null for both, and a row of
              * em-dashes above a real total is noise rather than information —
              * such an order keeps rendering exactly as it does today.
              */}
            <div className="flex justify-end border-t">
            <dl className="w-full space-y-1.5 px-4 pt-3 pb-4 text-sm sm:max-w-xs">
              {order.subtotal !== null ? (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">{t('items.subtotal')}</dt>
                    <dd className="tabular-nums">{money(order.subtotal)}</dd>
                  </div>
                  {order.deliveryFee !== undefined &&
                  (order.deliveryZoneName || order.deliveryFee !== '0.00') ? (
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-muted-foreground">{t('items.deliveryFee')}</dt>
                      <dd className="tabular-nums">{money(order.deliveryFee)}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">{t(order.pricesIncludeTax ? 'items.taxIncluded' : 'items.tax')}</dt>
                    <dd className="tabular-nums">{money(order.taxAmount)}</dd>
                  </div>
                </>
              ) : null}
              <div
                className={
                  order.subtotal !== null
                    ? 'flex items-center justify-between gap-4 border-t pt-2.5'
                    : 'flex items-center justify-between gap-4'
                }
              >
                <dt className="font-medium">{t('items.total')}</dt>
                <dd className="text-lg font-semibold tabular-nums">{money(order.total)}</dd>
              </div>
            </dl>
            </div>
          </CollapsibleSection>

          <OrderActivity order={order} onChanged={setOrder} />
        </div>

        <div className="min-w-0 space-y-5">
          <CollapsibleSection title={t('customer.title')}>
            {order.customer ? (
              <div className="space-y-3 text-sm">
                {order.customer.name ? (
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="bg-primary/10 text-primary-strong flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    >
                      {initialsOf(order.customer.name)}
                    </span>
                    <p className="min-w-0 font-semibold">
                      <span className="sr-only">{t('customer.name')}: </span>
                      <bdi>{order.customer.name}</bdi>
                    </p>
                  </div>
                ) : null}
                <ul className="space-y-2">
                  {order.customer.email ? (
                    <ContactRow icon={<Mail aria-hidden className="size-4" />} label={t('customer.email')}>
                      <a href={`mailto:${order.customer.email}`} className="force-ltr block truncate hover:underline">
                        {order.customer.email}
                      </a>
                    </ContactRow>
                  ) : null}
                  {order.customer.phone ? (
                    <ContactRow icon={<Phone aria-hidden className="size-4" />} label={t('customer.phone')}>
                      <a href={`tel:${order.customer.phone}`} className="force-ltr hover:underline">
                        {order.customer.phone}
                      </a>
                    </ContactRow>
                  ) : null}
                  {order.customer.city || order.customer.country ? (
                    <ContactRow icon={<MapPin aria-hidden className="size-4" />} label={t('customer.location')}>
                      {[order.customer.city, order.customer.country].filter(Boolean).join(', ')}
                    </ContactRow>
                  ) : null}
                </ul>
              </div>
            ) : (
              // A guest checkout never had a customer record; otherwise it was
              // deleted (SetNull), since an order can outlive its customer.
              <p className="text-muted-foreground text-sm">
                {order.contact?.name ? t('customer.guest') : t('customer.removed')}
              </p>
            )}
          </CollapsibleSection>

          <FulfillmentSection order={order} />

          <OrderDeliveryCard
            order={order}
            onAssignmentChanged={(assignment) =>
              setOrder((current) => (current ? { ...current, assignment } : current))
            }
          />

          <CollapsibleSection
            title={t('payment.title')}
            // Deliberately NOT gated by nextStatuses (B4.10) — a goodwill
            // refund is not the return transition, and tying it to that would
            // refuse it for exactly the orders (already delivered, already
            // closed) where it's most likely to be the right call. It lives on
            // the Payment card because it changes what was paid.
            action={
              canRefund ? (
                <Button variant="ghost" size="sm" onClick={() => setRefundDialogOpen(true)}>
                  <HandCoins aria-hidden />
                  {t('refund.action')}
                </Button>
              ) : null
            }
          >
            <p className="flex items-center gap-2.5 text-sm">
              <CreditCard aria-hidden className="text-muted-foreground size-4 shrink-0" />
              {order.paymentMethod ?? t('payment.unknown')}
            </p>
            {order.amountPaid !== undefined ? (
              <p className="text-muted-foreground mt-1.5 ps-6.5 text-sm tabular-nums">
                {Number(order.amountPaid) > 0
                  ? t('payment.paid', { amount: money(order.amountPaid) })
                  : t('payment.unpaid')}
              </p>
            ) : null}
            {(order.goodwillRefunds ?? []).map((refund) => (
              <div key={refund.id} className="border-border mt-3 border-t pt-3 text-sm">
                <p className="font-medium">
                  {t('refund.action')} · {money(refund.amount)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatter.dateTime(new Date(refund.paidAt), 'long')}
                </p>
                {refund.refundReason ? (
                  <p className="mt-1">
                    {t('refund.reasonLabel')}: {tReturn(`refundReasons.${refund.refundReason}`)}
                    {refund.refundReasonNote ? <> — <bdi>{refund.refundReasonNote}</bdi></> : null}
                  </p>
                ) : refund.legacyReason ? (
                  <p className="mt-1">
                    {t('refund.reasonLabel')}: <bdi>{refund.legacyReason}</bdi>
                  </p>
                ) : null}
              </div>
            ))}
          </CollapsibleSection>
        </div>
      </div>

      {/* The phone's action bar. Sticky inside <main> (the shell's one
          scroller), so it has to be the LAST thing on the page: a sticky
          element only pins while its natural position is below the fold.
          The negative margins bleed it to <main>'s edges (p-3 below md), and
          `-bottom-3` cancels that same padding — a sticky offset is measured
          from the scroller's padding edge, so `bottom-0` left a 12px strip
          of page showing underneath the bar. */}
      {isMobile && !statusIsFinal ? (
        <div
          role="region"
          aria-label={t('statusControl.actionsLabel')}
          className="bg-card sticky -bottom-3 z-20 -mx-3 -mb-3 flex gap-2 border-t px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          {statusActions}
        </div>
      ) : null}

      <OrderStatusDialog
        order={order}
        target={statusTarget}
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        onChanged={setOrder}
      />

      <RequestReturnSheet
        order={order}
        open={returnSheetOpen}
        onOpenChange={setReturnSheetOpen}
        onCreated={(message) => {
          setReturnMessage(message);
          setReturnSheetOpen(false);
        }}
      />

      <RefundOrderDialog
        order={order}
        open={refundDialogOpen}
        onOpenChange={setRefundDialogOpen}
        onRefunded={setOrder}
      />
    </div>
  );
}

/**
 * How the customer gets the order, and the details they gave at checkout.
 * Nothing to show on a till sale or an order from before these were recorded.
 */
function FulfillmentSection({ order }: { order: Order }) {
  const t = useTranslations('orders');
  const contact = order.contact;
  const place = [order.delivery?.address, order.delivery?.city].filter(Boolean).join(', ');

  if (!order.fulfillment && !contact?.name && !contact?.phone) return null;

  return (
    <CollapsibleSection
      title={t('fulfillment.title')}
      aside={order.fulfillment ? t(`fulfillment.${order.fulfillment}`) : null}
    >
      <ul className="space-y-2 text-sm">
        {order.fulfillment ? (
          <ContactRow
            icon={
              order.fulfillment === 'PICKUP' ? (
                <Store aria-hidden className="size-4" />
              ) : (
                <Truck aria-hidden className="size-4 rtl:-scale-x-100" />
              )
            }
            label={t('fulfillment.title')}
          >
            {t(`fulfillment.${order.fulfillment}`)}
          </ContactRow>
        ) : null}
        {contact?.name ? (
          <ContactRow icon={<span aria-hidden className="block size-4" />} label={t('fulfillment.contact')}>
            <bdi className="font-medium">{contact.name}</bdi>
          </ContactRow>
        ) : null}
        {contact?.phone ? (
          <ContactRow icon={<Phone aria-hidden className="size-4" />} label={t('customer.phone')}>
            <a href={`tel:${contact.phone}`} className="force-ltr hover:underline">
              {contact.phone}
            </a>
          </ContactRow>
        ) : null}
        {contact?.email ? (
          <ContactRow icon={<Mail aria-hidden className="size-4" />} label={t('customer.email')}>
            <a href={`mailto:${contact.email}`} className="force-ltr block truncate hover:underline">
              {contact.email}
            </a>
          </ContactRow>
        ) : null}
        {order.deliveryZoneName ? (
          <ContactRow
            icon={<MapPin aria-hidden className="size-4" />}
            label={t('fulfillment.deliveryArea')}
          >
            <bdi>{order.deliveryZoneName}</bdi>
          </ContactRow>
        ) : null}
        {place ? (
          <ContactRow icon={<MapPin aria-hidden className="size-4" />} label={t('fulfillment.deliverTo')}>
            <bdi dir="auto">{place}</bdi>
          </ContactRow>
        ) : null}
        {order.customerNote ? (
          <ContactRow
            icon={<MessageSquareText aria-hidden className="size-4" />}
            label={t('fulfillment.note')}
          >
            <bdi dir="auto" className="whitespace-pre-wrap">
              {order.customerNote}
            </bdi>
          </ContactRow>
        ) : null}
      </ul>
    </CollapsibleSection>
  );
}

function ContactRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  /** Read out before the value; the icon alone says nothing to a screen reader. */
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2.5">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="sr-only">{label}: </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** "Prev" points toward the reading start, mirroring `order-invoice.tsx`'s
 *  `BackArrow` — a fixed ChevronLeft would point forward in Arabic. */
function PrevArrow() {
  return (
    <>
      <ChevronLeft className="rtl:hidden" aria-hidden />
      <ChevronRight className="hidden rtl:block" aria-hidden />
    </>
  );
}

function NextArrow() {
  return (
    <>
      <ChevronRight className="rtl:hidden" aria-hidden />
      <ChevronLeft className="hidden rtl:block" aria-hidden />
    </>
  );
}
