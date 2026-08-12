'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

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
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  assignCourier,
  fetchCouriers,
  unassignCourier,
  updateAssignment,
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
 *
 * ─── THE ADDRESS IS CAPTURED HERE OR NOWHERE ─────────────────────────
 * `Order` has no address column: the assignment's `address`/`city` are the
 * ONLY place a delivery address is ever recorded, and they are what the
 * courier portal renders. This form used to post `{ orderId, driverId }` only,
 * so every assignment was created with a null address and couriers were
 * dispatched to a blank — there is nothing upstream to fall back to and
 * nothing to prefill from. On reassignment the existing values are seeded so
 * changing courier doesn't silently wipe the address the last one had.
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
  // Seeded from the current assignment so a reassignment keeps the address
  // already on file rather than blanking it.
  const [address, setAddress] = useState(assignment?.address ?? '');
  const [city, setCity] = useState(assignment?.city ?? '');
  const [note, setNote] = useState('');
  const [isReassigning, setIsReassigning] = useState(false);
  // B4.1 — separate from reassigning: this corrects address/city on the SAME
  // courier via `PATCH /assignments/:id`, which does not reset `status` back
  // to ASSIGNED the way `assignCourier`'s upsert does.
  const [isEditingAddress, setIsEditingAddress] = useState(false);
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
      // Trimmed, and omitted entirely when blank — the backend treats these as
      // optional, and sending "" would record an empty address as if it were a
      // real one.
      const trimmedAddress = address.trim();
      const trimmedCity = city.trim();
      const trimmedNote = note.trim();

      const result = await assignCourier({
        orderId,
        driverId,
        ...(trimmedAddress ? { address: trimmedAddress } : {}),
        ...(trimmedCity ? { city: trimmedCity } : {}),
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      onChanged(result);
      setDriverId('');
      setNote('');
      setIsReassigning(false);
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  async function submitAddressEdit() {
    if (!assignment) return;

    setIsSaving(true);
    setError(null);

    try {
      const result = await updateAssignment(assignment.id, {
        address: address.trim(),
        city: city.trim(),
      });
      onChanged(result);
      setIsEditingAddress(false);
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
  const showAddressEdit = Boolean(assignment) && isEditingAddress && !isReassigning;

  return (
    <div className="space-y-2 border-t pt-3">
      {showAddressEdit ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="edit-assignment-address">{t('addressLabel')}</Label>
              <Input
                id="edit-assignment-address"
                value={address}
                placeholder={t('addressPlaceholder')}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="edit-assignment-city">{t('cityLabel')}</Label>
              <Input
                id="edit-assignment-city"
                value={city}
                placeholder={t('cityPlaceholder')}
                onChange={(event) => setCity(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button disabled={isSaving} onClick={() => void submitAddressEdit()}>
              {isSaving ? t('saving') : t('saveAddress')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={() => {
                setIsEditingAddress(false);
                setAddress(assignment?.address ?? '');
                setCity(assignment?.city ?? '');
                setError(null);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : showPicker ? (
        <div className="space-y-3">
          <div className="min-w-0 space-y-2">
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="assign-courier-address">{t('addressLabel')}</Label>
              <Input
                id="assign-courier-address"
                value={address}
                placeholder={t('addressPlaceholder')}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="assign-courier-city">{t('cityLabel')}</Label>
              <Input
                id="assign-courier-city"
                value={city}
                placeholder={t('cityPlaceholder')}
                onChange={(event) => setCity(event.target.value)}
              />
            </div>
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor="assign-courier-note">{t('noteLabel')}</Label>
            <Input
              id="assign-courier-note"
              value={note}
              placeholder={t('notePlaceholder')}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <p className="text-muted-foreground text-xs">{t('addressHint')}</p>

          <div className="flex items-center gap-2">
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
                  setAddress(assignment?.address ?? '');
                  setCity(assignment?.city ?? '');
                  setNote('');
                  setError(null);
                }}
              >
                {t('cancel')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={assignment.status === 'DELIVERED'}
            onClick={() => setIsEditingAddress(true)}
          >
            {t('editAddress')}
          </Button>
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
