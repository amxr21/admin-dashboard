'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';

import {
  OrderStatusTimeline,
  type ActivityFilter,
} from '@/components/orders/order-status-timeline';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { addOrderNote, type OrderDetail } from '@/lib/orders-api';

/**
 * One feed for everything that happened to the order: status moves, staff
 * notes, courier updates and return decisions — with the note composer on top.
 *
 * ─── WHY NOTES LIVE HERE NOW ─────────────────────────────────────────
 * Notes used to have their own card AND appear again in History, so the same
 * text was on screen twice. The timeline already carries every note with its
 * author (C5.4), so the composer moved into it and the separate list went.
 *
 * Notes are still a THREAD (C5.7): each one is added, never overwritten, and
 * keeps its own author and time — `addOrderNote` appends. Staff-only, never
 * shown to the customer, which the composer says in so many words.
 */

interface OrderActivityProps {
  order: OrderDetail;
  onChanged: (order: OrderDetail) => void;
}

const FILTERS: ActivityFilter[] = ['all', 'status', 'notes', 'delivery'];

export function OrderActivity({ order, onChanged }: OrderActivityProps) {
  const t = useTranslations('orders.activity');
  const tNotes = useTranslations('orders.notes');
  const translateError = useTranslatedApiError();
  const noteId = useId();
  const hintId = useId();

  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anything the feed shows that this page can change. When one moves, the
  // feed refetches, so a move or a note made here shows up without a reload.
  const refreshKey = [
    order.status,
    order.statusHistory.length,
    order.notes.length,
    order.assignment?.id ?? '',
    order.assignment?.status ?? '',
  ].join(':');

  async function submit() {
    const body = draft.trim();
    if (!body) return;

    setIsSaving(true);
    setError(null);

    try {
      onChanged(await addOrderNote(order.id, body));
      setDraft('');
    } catch (caught) {
      // The draft is kept — a failed save never throws away what was typed.
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <CollapsibleSection
      title={t('title')}
      action={
        <SegmentedControl
          size="sm"
          // Four segments don't fit beside the title on a phone; the feed
          // simply shows everything there.
          className="w-auto max-sm:hidden"
          aria-label={t('filterLabel')}
          options={FILTERS.map((value) => ({ value, label: t(`filters.${value}`) }))}
          value={filter}
          onChange={(value) => setFilter(value as ActivityFilter)}
        />
      }
    >
      {/* One field surface around the textarea AND its footer, so the focus
          ring (the same one every field uses) wraps the whole composer. */}
      <div className="border-input bg-card focus-within:border-ring focus-within:ring-ring/50 rounded-md border transition-[color,box-shadow] focus-within:ring-[3px]">
        <label htmlFor={noteId} className="sr-only">
          {tNotes('label')}
        </label>
        <Textarea
          id={noteId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={tNotes('placeholder')}
          aria-describedby={hintId}
          rows={2}
          maxLength={2000}
          className="resize-none rounded-b-none border-0 focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-3 border-t py-1.5 ps-3 pe-1.5">
          <p id={hintId} className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Lock aria-hidden className="size-3 shrink-0" />
            {tNotes('staffOnly')}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={!draft.trim() || isSaving}
            onClick={() => void submit()}
          >
            {isSaving ? tNotes('adding') : tNotes('add')}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      ) : null}

      <div className="mt-5">
        <OrderStatusTimeline
          orderId={order.id}
          placedAt={order.placedAt}
          refreshKey={refreshKey}
          filter={filter}
        />
      </div>
    </CollapsibleSection>
  );
}
