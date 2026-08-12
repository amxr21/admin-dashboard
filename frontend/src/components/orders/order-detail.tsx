'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ChevronLeft, ChevronRight, Printer, RotateCcw } from 'lucide-react';

import { AssignCourierControl } from '@/components/orders/assign-courier-control';
import { Breadcrumb } from '@/components/shell/breadcrumb';
import { useAppSettings } from '@/components/providers/settings-provider';
import { ErrorScreen } from '@/components/errors/error-screen';
import { LastUpdatedNote } from '@/components/last-updated-note';
import { OrderNotesSection } from '@/components/orders/order-notes-section';
import { OrderStatusControl } from '@/components/orders/order-status-control';
import { OrderStatusTimeline } from '@/components/orders/order-status-timeline';
import { RequestReturnSheet } from '@/components/orders/request-return-sheet';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { ApiError } from '@/lib/api';
import { fetchAudit } from '@/lib/audit-api';
import {
  fetchOrder,
  fetchOrderNeighbors,
  type OrderDetail as Order,
  type OrderListParams,
  type OrderNeighbors,
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
 */

export function OrderDetail({ id }: { id: string }) {
  const t = useTranslations('orders');
  const tNav = useTranslations('nav');
  const tErrors = useTranslations('errorPages.notFound');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();
  const searchParams = useSearchParams();
  const { navLabels } = useAppSettings();
  const ordersLabel = navLabels.orders ?? tNav('orders');

  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [returnSheetOpen, setReturnSheetOpen] = useState(false);
  const [returnMessage, setReturnMessage] = useState<string | null>(null);
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
        <Skeleton className="h-32 w-full" />
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

  return (
    <div className="space-y-6">
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

      {hasListContext ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          {neighbors?.prev ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={{ pathname: `/admin/orders/${neighbors.prev.id}`, query: listFilters }}>
                <PrevArrow />
                <span className="force-ltr">{neighbors.prev.orderNumber}</span>
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {neighbors?.next ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={{ pathname: `/admin/orders/${neighbors.next.id}`, query: listFilters }}>
                <span className="force-ltr">{neighbors.next.orderNumber}</span>
                <NextArrow />
              </Link>
            </Button>
          ) : (
            <span />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            <span className="force-ltr">{order.orderNumber}</span>
            <StatusBadge kind="orderStatus" value={order.status} />
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('placedOn', {
              date: formatter.dateTime(new Date(order.placedAt), 'long'),
            })}
          </p>
          {lastActivity ? (
            <div className="mt-1">
              <LastUpdatedNote
                when={lastActivity.when}
                who={lastActivity.who}
                auditHref={`/admin/audit?entity=orders&entityId=${order.id}`}
              />
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/admin/orders/${order.id}/invoice`}>
              <Printer aria-hidden />
              {t('invoice.action')}
            </Link>
          </Button>

          {/* Same truth the status control uses: only offered when the
              server would actually accept moving this order to RETURNED. */}
          {order.nextStatuses.includes('RETURNED') ? (
            <Button variant="outline" onClick={() => setReturnSheetOpen(true)}>
              <RotateCcw aria-hidden />
              {t('requestReturn')}
            </Button>
          ) : null}

          <OrderStatusControl
            orderId={order.id}
            status={order.status}
            nextStatuses={order.nextStatuses}
            onChanged={setOrder}
          />
        </div>
      </div>

      {returnMessage ? (
        <p role="status" className="bg-success/10 text-success rounded-md px-3 py-2 text-sm">
          {returnMessage}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="bg-card rounded-lg border">
            <h2 className="border-b px-4 py-3 font-medium">{t('items.title')}</h2>
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
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {money(item.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between border-t px-4 py-3">
              <span className="font-medium">{t('items.total')}</span>
              <span className="text-lg font-semibold tabular-nums">
                {money(order.total)}
              </span>
            </div>
          </section>

          <section className="bg-card rounded-lg border p-4">
            <h2 className="mb-3 font-medium">{t('timeline.title')}</h2>
            <OrderStatusTimeline orderId={order.id} placedAt={order.placedAt} />
          </section>
        </div>

        <div className="space-y-6">
          <section className="bg-card rounded-lg border p-4">
            <h2 className="mb-3 font-medium">{t('customer.title')}</h2>
            {order.customer ? (
              <dl className="space-y-2 text-sm">
                <Field label={t('customer.name')} value={order.customer.name} />
                <Field label={t('customer.email')} value={order.customer.email} ltr />
                <Field label={t('customer.phone')} value={order.customer.phone} ltr />
                <Field
                  label={t('customer.location')}
                  value={[order.customer.city, order.customer.country]
                    .filter(Boolean)
                    .join(', ')}
                />
              </dl>
            ) : (
              // SetNull on delete, so an order can outlive its customer.
              <p className="text-muted-foreground text-sm">{t('customer.removed')}</p>
            )}
          </section>

          <section className="bg-card rounded-lg border p-4">
            <h2 className="mb-3 font-medium">{t('delivery.title')}</h2>
            {order.assignment ? (
              <dl className="space-y-2 text-sm">
                <Field
                  label={t('delivery.courier')}
                  value={order.assignment.driver?.name ?? null}
                />
                <Field
                  label={t('delivery.phone')}
                  value={order.assignment.driver?.phone ?? null}
                  ltr
                />
                <Field
                  label={t('delivery.address')}
                  value={[order.assignment.address, order.assignment.city]
                    .filter(Boolean)
                    .join(', ')}
                />
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('delivery.status')}</dt>
                  <dd>
                    <StatusBadge kind="deliveryStatus" value={order.assignment.status} />
                  </dd>
                </div>
                {order.assignment.attemptCount > 0 ? (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-muted-foreground">{t('delivery.attemptCount')}</dt>
                      <dd className="text-destructive font-medium">
                        {order.assignment.attemptCount}
                      </dd>
                    </div>
                    {order.assignment.failureReason ? (
                      <Field
                        label={t('delivery.failureReason')}
                        value={order.assignment.failureReason}
                      />
                    ) : null}
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">{t('delivery.unassigned')}</p>
            )}

            <AssignCourierControl
              orderId={order.id}
              orderStatus={order.status}
              assignment={order.assignment}
              onChanged={(assignment) =>
                setOrder((current) => (current ? { ...current, assignment } : current))
              }
            />
          </section>

          <section className="bg-card rounded-lg border p-4">
            <h2 className="mb-3 font-medium">{t('payment.title')}</h2>
            <p className="text-sm">{order.paymentMethod ?? t('payment.unknown')}</p>
          </section>

          <OrderNotesSection order={order} onChanged={setOrder} />
        </div>
      </div>

      <RequestReturnSheet
        order={order}
        open={returnSheetOpen}
        onOpenChange={setReturnSheetOpen}
        onCreated={(message) => {
          setReturnMessage(message);
          setReturnSheetOpen(false);
        }}
      />
    </div>
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

function Field({
  label,
  value,
  ltr,
}: {
  label: string;
  value: string | null | undefined;
  /** Codes, emails and phone numbers must not reorder in an RTL layout. */
  ltr?: boolean;
}) {
  if (!value) return null;

  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className={ltr ? 'force-ltr text-end' : 'text-end'}>{value}</dd>
    </div>
  );
}
