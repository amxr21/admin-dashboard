'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  assignCourier,
  fetchCouriers,
  unassignCourier,
  type Assignment,
  type Courier,
} from '@/lib/delivery-api';
import type { OrderStatus } from '@/lib/orders-api';

/**
 * Assign, reassign, or unassign the courier carrying this order.
 *
 * `POST /assignments` and `DELETE /assignments/:id` have existed since the
 * delivery API shipped, but nothing in the admin frontend ever called them —
 * assigning a courier was API-only. This is that missing UI.
 *
 * ─── VISIBILITY MIRRORS THE SERVER'S OWN RULE, NOT A SEPARATE COPY ───
 * `assignOrder` refuses once an order is DELIVERED/CANCELED/RETURNED; the
 * control simply doesn't render past that point, same convention as the
 * "Request return" button on the order detail page (gated on `nextStatuses`,
 * not a second hardcoded status list). Unassigning a DELIVERED assignment is
 * refused the same way, mirrored by disabling rather than hiding the button.
 */

const FINISHED_ORDER_STATUSES: OrderStatus[] = ['DELIVERED', 'CANCELED', 'RETURNED'];

interface AssignCourierControlProps {
  orderId: string;
  orderStatus: OrderStatus;
  assignment: Assignment | null;
  onChanged: (assignment: Assignment | null) => void;
}

export function AssignCourierControl({
  orderId,
  orderStatus,
  assignment,
  onChanged,
}: AssignCourierControlProps) {
  const t = useTranslations('orders.delivery');
  const translateError = useTranslatedApiError();

  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [driverId, setDriverId] = useState('');
  const [isReassigning, setIsReassigning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchCouriers({ pageSize: 100 })
      .then((result) => {
        if (!cancelled) {
          setCouriers(result.couriers.filter((courier) => courier.status !== 'INACTIVE'));
        }
      })
      .catch(() => {
        // The section still shows the current assignment (if any); an empty
        // picker with nothing to choose from is its own honest signal.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (FINISHED_ORDER_STATUSES.includes(orderStatus)) return null;

  async function submitAssign() {
    if (!driverId) return;

    setIsSaving(true);
    setError(null);

    try {
      const result = await assignCourier({ orderId, driverId });
      onChanged(result);
      setDriverId('');
      setIsReassigning(false);
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  async function submitUnassign() {
    if (!assignment) return;

    setIsSaving(true);
    setError(null);

    try {
      await unassignCourier(assignment.id);
      onChanged(null);
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  const showPicker = !assignment || isReassigning;

  return (
    <div className="space-y-2 border-t pt-3">
      {showPicker ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="assign-courier-select">{t('assignLabel')}</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger id="assign-courier-select">
                <SelectValue placeholder={t('assignPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {couriers.map((courier) => (
                  <SelectItem key={courier.id} value={courier.id}>
                    {courier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button disabled={!driverId || isSaving} onClick={() => void submitAssign()}>
            {isSaving ? t('assigning') : t('assign')}
          </Button>

          {isReassigning ? (
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={() => {
                setIsReassigning(false);
                setDriverId('');
                setError(null);
              }}
            >
              {t('cancel')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsReassigning(true)}
          >
            {t('reassign')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving || assignment.status === 'DELIVERED'}
            onClick={() => void submitUnassign()}
          >
            {t('unassign')}
          </Button>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
