'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  changeOrderStatus,
  type OrderDetail,
  type OrderStatus,
} from '@/lib/orders-api';

/**
 * Moves an order to its next status.
 *
 * ─── THE OPTIONS COME FROM THE SERVER ────────────────────────────────
 * `nextStatuses` is computed from the transition table in orders.config.ts and
 * sent with the order. Keeping a second copy of that table here would mean two
 * sources of truth that drift, and the drift shows up as a button that looks
 * legal and returns 400. An illegal move is simply never offered.
 *
 * When the list is empty the order is terminal, so the control renders nothing
 * at all rather than a disabled dropdown — a dead control is noise.
 */

interface OrderStatusControlProps {
  orderId: string;
  status: OrderStatus;
  nextStatuses: OrderStatus[];
  onChanged: (order: OrderDetail) => void;
}

export function OrderStatusControl({
  orderId,
  status,
  nextStatuses,
  onChanged,
}: OrderStatusControlProps) {
  const t = useTranslations('orders.statusControl');
  const tStatus = useTranslations('orderStatus');
  const translateError = useTranslatedApiError();

  const [target, setTarget] = useState<OrderStatus | ''>('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (nextStatuses.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('terminal', { status: tStatus(status) })}
      </p>
    );
  }

  async function submit() {
    if (!target) return;

    setIsSaving(true);
    setError(null);

    try {
      onChanged(await changeOrderStatus(orderId, target, note.trim() || undefined));
      setTarget('');
      setNote('');
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="w-44 space-y-2">
          <Label htmlFor="order-next-status">{t('label')}</Label>
          <Select value={target} onValueChange={(value) => setTarget(value as OrderStatus)}>
            <SelectTrigger id="order-next-status">
              <SelectValue placeholder={t('placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {nextStatuses.map((next) => (
                <SelectItem key={next} value={next}>
                  {tStatus(next)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button disabled={!target || isSaving} onClick={() => void submit()}>
          {isSaving ? t('saving') : t('apply')}
        </Button>
      </div>

      {target ? (
        <div className="space-y-1">
          <Label htmlFor="order-status-note">{t('note')}</Label>
          <Textarea
            id="order-status-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            // Matches the column width, so the server never truncates silently.
            maxLength={255}
            placeholder={t('notePlaceholder')}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
