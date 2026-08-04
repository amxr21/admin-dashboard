'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { LogOut, Package, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { ErrorSection } from '@/components/errors/error-section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { useRouter } from '@/i18n/navigation';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  fetchMyAssignments,
  updateAssignmentStatus,
  type CourierAssignment,
  type DeliveryStatus,
} from '@/lib/courier-api';
import { clearCourierSession, readCourier } from '@/lib/courier-auth-storage';

/**
 * A courier's own job list — self-service, mobile-first, no admin chrome.
 * `COURIER_TRANSITIONS` mirrors the server's table in courier.route.ts: a
 * client-side hint for which buttons to offer, not a control. The server
 * re-validates every transition regardless (and enforces that CANCELED/
 * RETURNED only ever arrive from the order side — see that file).
 */
const COURIER_TRANSITIONS: Partial<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  ASSIGNED: ['PICKED_UP'],
  PICKED_UP: ['OUT_FOR_DELIVERY', 'HANDED_OVER'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'HANDED_OVER'],
};

const TERMINAL: readonly DeliveryStatus[] = ['DELIVERED', 'HANDED_OVER', 'CANCELED', 'RETURNED'];

export function CourierDashboard() {
  const t = useTranslations('courier');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const router = useRouter();

  const [courierName, setCourierName] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<CourierAssignment[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);

    fetchMyAssignments()
      .then(setAssignments)
      .catch((caught: unknown) => setError(translateError(caught)))
      .finally(() => setIsLoading(false));
  }, [translateError]);

  useEffect(() => {
    const courier = readCourier();
    if (!courier) {
      router.replace('/courier/login');
      return;
    }
    setCourierName(courier.name);
    load();
    // Only on mount — `load` itself is stable across renders via useCallback,
    // and re-running this on every `load` identity change would refetch on
    // every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function advance(id: string, status: DeliveryStatus) {
    setUpdatingId(id);
    try {
      const updated = await updateAssignmentStatus(id, status);
      setAssignments(
        (current) => current?.map((item) => (item.id === id ? updated : item)) ?? current,
      );
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setUpdatingId(null);
    }
  }

  function signOut() {
    clearCourierSession();
    router.replace('/courier/login');
  }

  const active = assignments?.filter((item) => !TERMINAL.includes(item.status)) ?? [];
  const money = (value: string | null) =>
    value === null ? null : formatter.number(Number(value), 'currency');

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="bg-card flex items-center gap-2 border-b p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{t('dashboard.greeting', { name: courierName ?? '' })}</p>
          <p className="text-muted-foreground text-sm">
            {t('dashboard.activeCount', { count: active.length })}
          </p>
        </div>
        <LocaleSwitcher />
        <ThemeToggle />
        <Button variant="ghost" size="icon" aria-label={t('dashboard.signOut')} onClick={signOut}>
          <LogOut className="icon-directional" aria-hidden />
        </Button>
      </header>

      <main className="flex-1 space-y-3 p-4">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" disabled={isLoading} onClick={load}>
            <RefreshCw className={isLoading ? 'animate-spin' : ''} aria-hidden />
            {t('dashboard.refresh')}
          </Button>
        </div>

        {error ? (
          <ErrorSection title={t('dashboard.loadFailed')} description={error} onRetry={load} />
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-40 w-full" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <EmptyState icon={Package} title={t('dashboard.empty')} />
        ) : (
          active.map((assignment) => {
            const nextStatuses = COURIER_TRANSITIONS[assignment.status] ?? [];

            return (
              <div key={assignment.id} className="bg-card space-y-3 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="force-ltr font-semibold">{assignment.order.orderNumber}</p>
                    {assignment.customerName ? (
                      <p className="text-sm">{assignment.customerName}</p>
                    ) : null}
                  </div>
                  <StatusBadge kind="deliveryStatus" value={assignment.status} />
                </div>

                <div className="text-muted-foreground space-y-1 text-sm">
                  {assignment.customerPhone ? (
                    <p className="force-ltr">{assignment.customerPhone}</p>
                  ) : null}
                  {assignment.address || assignment.city ? (
                    <p>{[assignment.address, assignment.city].filter(Boolean).join(', ')}</p>
                  ) : null}
                  {money(assignment.total) ? (
                    <p>
                      {t('dashboard.collect')}: <span className="font-medium">{money(assignment.total)}</span>
                    </p>
                  ) : null}
                  {assignment.note ? <p>{assignment.note}</p> : null}
                </div>

                {nextStatuses.length > 0 ? (
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    {nextStatuses.map((status) => (
                      <Button
                        key={status}
                        size="sm"
                        disabled={updatingId === assignment.id}
                        onClick={() => void advance(assignment.id, status)}
                      >
                        {t(`deliveryStatusAction.${status}`)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
