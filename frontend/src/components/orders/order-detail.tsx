'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Printer, RotateCcw } from 'lucide-react';

import { ErrorScreen } from '@/components/errors/error-screen';
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
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { ApiError } from '@/lib/api';
import { fetchOrder, type OrderDetail as Order } from '@/lib/orders-api';

/**
 * One order: line items, customer, delivery and the status trail.
 *
 * Everything on this screen is a RECORD of what happened, not a live view of
 * current data. Line prices and the total are the values at the time of the
 * order, so nothing here is recomputed from today's catalogue.
 */

export function OrderDetail({ id }: { id: string }) {
  const t = useTranslations('orders');
  const tErrors = useTranslations('errorPages.notFound');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [returnSheetOpen, setReturnSheetOpen] = useState(false);
  const [returnMessage, setReturnMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      setNotFound(false);

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
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, translateError]);

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

  const money = (value: string | null) =>
    value === null ? '—' : formatter.number(Number(value), 'currency');

  return (
    <div className="space-y-6">
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
            <OrderStatusTimeline entries={order.statusHistory} placedAt={order.placedAt} />
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
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">{t('delivery.unassigned')}</p>
            )}
          </section>

          <section className="bg-card rounded-lg border p-4">
            <h2 className="mb-3 font-medium">{t('payment.title')}</h2>
            <p className="text-sm">{order.paymentMethod ?? t('payment.unknown')}</p>
          </section>
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
