'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/empty-state';
import { Timestamp } from '@/components/timestamp';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { addOrderNote, type OrderDetail } from '@/lib/orders-api';

/**
 * Internal notes — staff-only, never surfaced to the customer. A THREAD
 * (C5.7), not the single overwritable field this used to be: the old shape
 * (one `internalNotes` string, replaced whole on every save) meant a second
 * staff member's note silently erased the first one's, with no record either
 * ever existed. Every entry keeps its own author and timestamp, the same
 * append-only discipline `OrderStatusHistory` already uses.
 *
 * Distinct from `OrderStatusHistory.note`, which is tied to one specific
 * status transition; these are free-standing annotations ("called twice, no
 * answer") that exist independently of the order's lifecycle.
 */

interface OrderNotesSectionProps {
  order: OrderDetail;
  onChanged: (order: OrderDetail) => void;
}

export function OrderNotesSection({ order, onChanged }: OrderNotesSectionProps) {
  const t = useTranslations('orders.notes');
  const translateError = useTranslatedApiError();

  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const body = draft.trim();
    if (!body) return;

    setIsSaving(true);
    setError(null);

    try {
      onChanged(await addOrderNote(order.id, body));
      setDraft('');
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="mb-3 font-medium">{t('title')}</h2>

      <div className="space-y-3">
        {order.notes.length === 0 ? (
          <EmptyState title={t('empty')} className="py-4" />
        ) : (
          <ol className="max-h-64 space-y-3 overflow-y-auto">
            {order.notes.map((note) => (
              <li key={note.id} className="border-border/60 border-b pb-3 last:border-0 last:pb-0">
                <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {note.authorName ?? t('unknownAuthor')}
                  {' · '}
                  <Timestamp value={note.createdAt} />
                </p>
              </li>
            ))}
          </ol>
        )}

        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('placeholder')}
            rows={2}
            maxLength={2000}
          />

          <div className="flex justify-end">
            <Button size="sm" disabled={!draft.trim() || isSaving} onClick={() => void submit()}>
              {isSaving ? t('adding') : t('add')}
            </Button>
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
