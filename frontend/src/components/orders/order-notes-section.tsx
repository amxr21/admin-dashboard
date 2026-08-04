'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { updateOrderNotes, type OrderDetail } from '@/lib/orders-api';

/**
 * Internal notes — staff-only, never surfaced to the customer. Distinct from
 * `OrderStatusHistory.note`, which is tied to one specific status transition;
 * this is a free-standing annotation ("called twice, no answer") that can be
 * edited independently of the order's lifecycle.
 *
 * Save is disabled until the text actually differs from what's saved — the
 * dirty-state signal this app's Phase 6 backlog flags as generally missing,
 * applied here since this is the one write surface built after that note.
 */

interface OrderNotesSectionProps {
  order: OrderDetail;
  onChanged: (order: OrderDetail) => void;
}

export function OrderNotesSection({ order, onChanged }: OrderNotesSectionProps) {
  const t = useTranslations('orders.notes');
  const translateError = useTranslatedApiError();

  const [value, setValue] = useState(order.internalNotes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = value !== (order.internalNotes ?? '');

  async function save() {
    setIsSaving(true);
    setError(null);

    try {
      onChanged(await updateOrderNotes(order.id, value));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="mb-3 font-medium">{t('title')}</h2>

      <div className="space-y-2">
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('placeholder')}
          rows={3}
          maxLength={2000}
        />

        <div className="flex justify-end">
          <Button size="sm" disabled={!isDirty || isSaving} onClick={() => void save()}>
            {isSaving ? t('saving') : t('save')}
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
