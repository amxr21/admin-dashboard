'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowLeft } from 'lucide-react';

import { Breadcrumb } from '@/components/shell/breadcrumb';
import { CourierDangerZone } from '@/components/delivery/courier-danger-zone';
import { useAppSettings } from '@/components/providers/settings-provider';
import { ErrorScreen } from '@/components/errors/error-screen';
import { EmptyState } from '@/components/empty-state';
import { LastUpdatedNote } from '@/components/last-updated-note';
import { StatusBadge } from '@/components/status-badge';
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
import { fetchAudit } from '@/lib/audit-api';
import { fetchCourier, type CourierDetail as CourierDetailData } from '@/lib/delivery-api';

/**
 * One courier: contact details, region/country, and recent assignment
 * history — B4.5. `GET /couriers/:id` existed with zero frontend
 * references; `region`/`country` were accepted on create/update and
 * returned by the list endpoint but never rendered anywhere.
 *
 * The assignment table is the same 20-row, newest-first slice the roster's
 * own `getCourier()` has always returned — not a separate paginated view.
 * B4.6 (completed-deliveries tab) is the courier PORTAL's own gap, a
 * different screen entirely; this is the admin side.
 */
export function CourierDetail({ id }: { id: string }) {
  const t = useTranslations('delivery');
  const tDetail = useTranslations('delivery.detail');
  const tNav = useTranslations('nav');
  const tErrors = useTranslations('errorPages.notFound');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { navLabels } = useAppSettings();
  const deliveryLabel = navLabels.delivery ?? tNav('delivery');

  const [courier, setCourier] = useState<CourierDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [lastActivity, setLastActivity] = useState<{
    when: string;
    who: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      setNotFound(false);
      setLastActivity(null);

      try {
        const loaded = await fetchCourier(id);
        if (!cancelled) setCourier(loaded);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setNotFound(true);
        } else {
          setError(translateError(caught));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }

      // Best-effort (C5.3) — courier writes only started calling audit()
      // this session (couriers.service.ts's updateCourier), so an older
      // courier untouched since may have no entries at all yet.
      fetchAudit({ entity: 'couriers', entityId: id, pageSize: 1 })
        .then((result) => {
          if (cancelled) return;
          const [newest] = result.entries;
          if (newest) setLastActivity({ when: newest.createdAt, who: newest.actorEmail });
        })
        .catch(() => {
          /* No note renders — see below. */
        });
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

  if (error || !courier) {
    return (
      <ErrorScreen
        title={tErrors('title')}
        description={error ?? tErrors('description')}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumb
        segments={[
          { label: deliveryLabel, href: '/admin/delivery' },
          { label: courier.name },
        ]}
      />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/delivery"
            className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1 text-sm"
          >
            <ArrowLeft aria-hidden className="size-4" />
            {tDetail('back')}
          </Link>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            {courier.name}
            <StatusBadge kind="deliveryStaffStatus" value={courier.status} />
          </h1>
          {lastActivity ? (
            <div className="mt-1">
              <LastUpdatedNote
                when={lastActivity.when}
                who={lastActivity.who}
                auditHref={`/admin/audit?entity=couriers&entityId=${courier.id}`}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="bg-card/50 grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('columns.zone')} value={courier.zone} />
        <Field label={tDetail('region')} value={courier.region} />
        <Field label={tDetail('country')} value={courier.country} />
        <Field label={tDetail('phone')} value={courier.phone} className="force-ltr" />
        <Field label={tDetail('email')} value={courier.email} />
        <Field label={tDetail('vehicle')} value={courier.vehicleType} />
        <Field label={tDetail('plateNumber')} value={courier.plateNumber} className="force-ltr" />
        <Field
          label={t('columns.code')}
          value={courier.hasAccessCode ? t('code.issued') : t('code.none')}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{tDetail('recentAssignments')}</h2>

        {courier.assignments.length === 0 ? (
          <EmptyState
            title={tDetail('noAssignments.title')}
            description={tDetail('noAssignments.description')}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tDetail('columns.order')}</TableHead>
                  <TableHead>{tDetail('columns.deliveryStatus')}</TableHead>
                  <TableHead>{t('columns.zone')}</TableHead>
                  <TableHead>{tDetail('columns.assignedAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courier.assignments.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      <Link
                        href={`/admin/orders/${assignment.order.id}`}
                        className="text-primary force-ltr hover:underline"
                      >
                        {assignment.order.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind="deliveryStatus" value={assignment.status} />
                    </TableCell>
                    <TableCell>{assignment.city ?? '—'}</TableCell>
                    <TableCell>
                      <time dateTime={assignment.createdAt}>
                        {formatter.dateTime(new Date(assignment.createdAt), 'long')}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <CourierDangerZone courier={courier} onChanged={setCourier} />
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null;
  className?: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={className}>{value ?? '—'}</p>
    </div>
  );
}
