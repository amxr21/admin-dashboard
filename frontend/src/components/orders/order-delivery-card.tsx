'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ellipsis, Truck } from 'lucide-react';

import { useAppSettings } from '@/components/providers/settings-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  assignCourier,
  fetchCouriers,
  unassignCourier,
  updateAssignment,
  type Assignment,
  type Courier,
} from '@/lib/delivery-api';
import type { OrderDetail, OrderStatus } from '@/lib/orders-api';

/**
 * Who is carrying the order, and the controls to change that.
 *
 * The card shows the assignment; the forms open in a sheet. They used to sit
 * inline in the card — a courier picker, address, city and note field — which
 * made Delivery the tallest thing in the sidebar on every unassigned order.
 * Now the card is one line until someone actually assigns.
 *
 * ─── VISIBILITY MIRRORS THE SERVER'S OWN RULE, NOT A SEPARATE COPY ───
 * `assignOrder` refuses once an order is DELIVERED/CANCELED/RETURNED, so no
 * control renders past that point (same convention as "Request return", which
 * is gated on `nextStatuses`). Editing the address or unassigning a DELIVERED
 * assignment is refused the same way, mirrored by disabling the menu item.
 *
 * ─── THE ADDRESS IS CAPTURED HERE OR NOWHERE ─────────────────────────
 * `Order` has no address column: the assignment's `address`/`city` are the
 * ONLY place a delivery address is recorded, and they are what the courier
 * portal renders. On reassignment the existing values are seeded so changing
 * courier doesn't silently wipe the address the last one had.
 */

const FINISHED_ORDER_STATUSES: OrderStatus[] = ['DELIVERED', 'CANCELED', 'RETURNED'];

type SheetMode = 'assign' | 'reassign' | 'address';

interface OrderDeliveryCardProps {
  order: OrderDetail;
  onAssignmentChanged: (assignment: Assignment | null) => void;
}

export function OrderDeliveryCard({ order, onAssignmentChanged }: OrderDeliveryCardProps) {
  const t = useTranslations('orders.delivery');
  const translateError = useTranslatedApiError();
  const { assignment } = order;
  const canManage = !FINISHED_ORDER_STATUSES.includes(order.status);
  const isDelivered = assignment?.status === 'DELIVERED';

  // `key` remounts the sheet's form on every open, so each opening starts
  // from the assignment as it is now rather than from a half-typed old draft.
  const [sheet, setSheet] = useState<{ mode: SheetMode; open: boolean; key: number }>({
    mode: 'assign',
    open: false,
    key: 0,
  });
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openSheet(mode: SheetMode) {
    setError(null);
    setSheet((current) => ({ mode, open: true, key: current.key + 1 }));
  }

  async function unassign() {
    if (!assignment) return;

    setIsUnassigning(true);
    setError(null);

    try {
      await unassignCourier(assignment.id);
      onAssignmentChanged(null);
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsUnassigning(false);
    }
  }

  return (
    <CollapsibleSection
      title={t('title')}
      aside={assignment ? <StatusBadge kind="deliveryStatus" value={assignment.status} /> : null}
      action={
        assignment && canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" aria-label={t('actions')}>
                <Ellipsis aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={isDelivered} onSelect={() => openSheet('address')}>
                {t('editAddress')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openSheet('reassign')}>{t('reassign')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isDelivered || isUnassigning}
                className="text-destructive focus:text-destructive"
                onSelect={() => void unassign()}
              >
                {t('unassign')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
    >
      {assignment ? (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">{t('courier')}</dt>
            <dd className="mt-0.5">
              <bdi className="font-medium">{assignment.driver?.name ?? '—'}</bdi>
              {assignment.driver?.phone ? (
                <>
                  <span className="text-muted-foreground"> · </span>
                  <a href={`tel:${assignment.driver.phone}`} className="text-primary-strong force-ltr hover:underline">
                    {assignment.driver.phone}
                  </a>
                </>
              ) : null}
            </dd>
          </div>

          {assignment.address || assignment.city ? (
            <div>
              <dt className="text-muted-foreground text-xs">{t('address')}</dt>
              <dd className="mt-0.5">
                <bdi dir="auto">
                  {[assignment.address, assignment.city].filter(Boolean).join(', ')}
                </bdi>
              </dd>
            </div>
          ) : null}

          {assignment.attemptCount > 0 ? (
            <div>
              <dt className="text-muted-foreground text-xs">{t('attemptCount')}</dt>
              <dd className="text-destructive mt-0.5 font-medium">
                {assignment.attemptCount}
                {assignment.failureReason ? (
                  <span className="text-foreground font-normal">
                    {' · '}
                    <bdi dir="auto">{assignment.failureReason}</bdi>
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">{t('unassigned')}</p>
          {canManage ? (
            <Button variant="outline" size="sm" onClick={() => openSheet('assign')}>
              <Truck aria-hidden className="rtl:-scale-x-100" />
              {t('assignCourier')}
            </Button>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      ) : null}

      <CourierSheet
        key={sheet.key}
        order={order}
        mode={sheet.mode}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        onSaved={(saved) => {
          onAssignmentChanged(saved);
          setSheet((current) => ({ ...current, open: false }));
        }}
      />
    </CollapsibleSection>
  );
}

interface CourierSheetProps {
  order: OrderDetail;
  mode: SheetMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (assignment: Assignment) => void;
}

function CourierSheet({ order, mode, open, onOpenChange, onSaved }: CourierSheetProps) {
  const t = useTranslations('orders.delivery');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();
  const { assignment } = order;
  const ids = {
    courier: useId(),
    address: useId(),
    city: useId(),
    note: useId(),
  };

  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [driverId, setDriverId] = useState('');
  // Seeded from the current assignment so a reassignment keeps the address
  // already on file rather than blanking it.
  const [address, setAddress] = useState(assignment?.address ?? '');
  const [city, setCity] = useState(assignment?.city ?? '');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picksCourier = mode !== 'address';

  useEffect(() => {
    if (!open || !picksCourier) return;
    let cancelled = false;

    fetchCouriers({ pageSize: 100 })
      .then((result) => {
        if (!cancelled) {
          setCouriers(result.couriers.filter((courier) => courier.status !== 'INACTIVE'));
        }
      })
      .catch(() => {
        // An empty picker with nothing to choose from is its own honest signal.
      });

    return () => {
      cancelled = true;
    };
  }, [open, picksCourier]);

  async function submit() {
    setIsSaving(true);
    setError(null);

    try {
      if (mode === 'address') {
        if (!assignment) return;
        // B4.1 — corrects address/city on the SAME courier via PATCH, which
        // does not reset `status` back to ASSIGNED the way reassigning does.
        onSaved(await updateAssignment(assignment.id, { address: address.trim(), city: city.trim() }));
        return;
      }

      if (!driverId) return;
      // Trimmed, and omitted entirely when blank — the backend treats these as
      // optional, and sending "" would record an empty address as if real.
      const trimmedAddress = address.trim();
      const trimmedCity = city.trim();
      const trimmedNote = note.trim();

      onSaved(
        await assignCourier({
          orderId: order.id,
          driverId,
          ...(trimmedAddress ? { address: trimmedAddress } : {}),
          ...(trimmedCity ? { city: trimmedCity } : {}),
          ...(trimmedNote ? { note: trimmedNote } : {}),
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  const title =
    mode === 'address' ? t('editAddress') : mode === 'reassign' ? t('reassignTitle') : t('assignTitle');

  return (
    <Sheet open={open} onOpenChange={(next) => (isSaving ? undefined : onOpenChange(next))}>
      <SheetContent side="end" variant={editPanelMode} className="max-w-md overflow-y-auto" title={title}>
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('addressHint')}</p>
          </div>

          {picksCourier ? (
            <div className="space-y-2">
              <Label htmlFor={ids.courier}>{t('assignLabel')}</Label>
              <Select value={driverId} onValueChange={setDriverId} disabled={isSaving}>
                <SelectTrigger id={ids.courier}>
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
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2 sm:col-span-2">
              <Label htmlFor={ids.address}>{t('addressLabel')}</Label>
              <Input
                id={ids.address}
                value={address}
                placeholder={t('addressPlaceholder')}
                onChange={(event) => setAddress(event.target.value)}
                disabled={isSaving}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor={ids.city}>{t('cityLabel')}</Label>
              <Input
                id={ids.city}
                value={city}
                placeholder={t('cityPlaceholder')}
                onChange={(event) => setCity(event.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          {picksCourier ? (
            <div className="space-y-2">
              <Label htmlFor={ids.note}>{t('noteLabel')}</Label>
              <Input
                id={ids.note}
                value={note}
                placeholder={t('notePlaceholder')}
                onChange={(event) => setNote(event.target.value)}
                disabled={isSaving}
              />
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" disabled={isSaving} onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={isSaving || (picksCourier && !driverId)} onClick={() => void submit()}>
              {mode === 'address'
                ? isSaving
                  ? t('saving')
                  : t('saveAddress')
                : isSaving
                  ? t('assigning')
                  : t('assign')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
