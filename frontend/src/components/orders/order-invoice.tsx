'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, ArrowRight, Printer } from 'lucide-react';

import { ErrorScreen } from '@/components/errors/error-screen';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchOrder, type OrderDetail } from '@/lib/orders-api';

/**
 * Printable invoice.
 *
 * ─── WHY THIS IS ITS OWN ROUTE AND NOT A MODAL ───────────────────────
 * It has to be printable on its own, linkable, and free of the dashboard
 * chrome. `@media print` in globals.css hides the shell's landmarks, so what
 * reaches paper is this document and nothing else.
 *
 * Everything is a snapshot. Line prices and the total are the values at the
 * time of the order — an invoice that changed when someone edited a price
 * would be a different document with the same number, which is the one thing
 * an invoice must never be.
 */

export function OrderInvoice({ id }: { id: string }) {
  const t = useTranslations('orders.invoice');
  const tOrders = useTranslations('orders');
  const tErrors = useTranslations('errorPages.notFound');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchOrder(id)
      .then((loaded) => {
        if (!cancelled) setOrder(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(translateError(caught));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, translateError]);

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  if (error || !order) {
    return (
      <ErrorScreen title={tErrors('title')} description={error ?? tErrors('description')} />
    );
  }

  const money = (value: string | null) =>
    value === null ? '—' : formatter.number(Number(value), 'currency');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Controls are screen-only — a printed page with a "Print" button on it
          is the classic tell that nobody tried printing it. */}
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" asChild>
          <Link href={`/admin/orders/${order.id}`}>
            <BackArrow />
            {t('back')}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer aria-hidden />
          {t('print')}
        </Button>
      </div>

      <article className="bg-card space-y-6 rounded-lg border p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div>
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="text-muted-foreground force-ltr mt-1 text-sm">
              {order.orderNumber}
            </p>
          </div>
          <div className="text-end text-sm">
            <p className="text-muted-foreground">{t('issued')}</p>
            <p>{formatter.dateTime(new Date(order.placedAt), 'long')}</p>
          </div>
        </header>

        {order.customer ? (
          <section>
            <h2 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
              {t('billedTo')}
            </h2>
            <p className="font-medium">{order.customer.name ?? tOrders('guest')}</p>
            {order.customer.email ? (
              <p className="text-muted-foreground force-ltr text-sm">
                {order.customer.email}
              </p>
            ) : null}
            {order.customer.phone ? (
              <p className="text-muted-foreground force-ltr text-sm">
                {order.customer.phone}
              </p>
            ) : null}
          </section>
        ) : null}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-start">
              <th className="pb-2 text-start font-medium">{tOrders('items.product')}</th>
              <th className="pb-2 text-end font-medium">{tOrders('items.quantity')}</th>
              <th className="pb-2 text-end font-medium">{tOrders('items.price')}</th>
              <th className="pb-2 text-end font-medium">{tOrders('items.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b last:border-0">
                <td className="py-2">
                  {item.product?.name ?? (
                    <span className="text-muted-foreground italic">
                      {tOrders('items.productRemoved')}
                    </span>
                  )}
                </td>
                <td className="py-2 text-end tabular-nums">
                  {formatter.number(item.quantity)}
                </td>
                <td className="py-2 text-end tabular-nums">{money(item.price)}</td>
                <td className="py-2 text-end tabular-nums">{money(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-end font-medium">
                {tOrders('items.total')}
              </td>
              <td className="pt-3 text-end text-lg font-semibold tabular-nums">
                {money(order.total)}
              </td>
            </tr>
          </tfoot>
        </table>

        {order.paymentMethod ? (
          <p className="text-muted-foreground text-sm">
            {t('paidBy', { method: order.paymentMethod })}
          </p>
        ) : null}
      </article>
    </div>
  );
}

/**
 * "Back" points toward the reading start, so it mirrors with the language.
 * A fixed ArrowLeft would point forward in Arabic.
 */
function BackArrow() {
  return (
    <>
      <ArrowLeft className="rtl:hidden" aria-hidden />
      <ArrowRight className="hidden rtl:block" aria-hidden />
    </>
  );
}
