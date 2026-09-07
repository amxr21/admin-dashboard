'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { LoginHistoryTable } from '@/components/staff/login-history-table';
import { ShiftsTable } from '@/components/staff/shifts-table';

/**
 * One surface for "what have staff been doing" (F6.5).
 *
 * ─── WHY THESE SHARE A PAGE ──────────────────────────────────────────
 * Sign-ins and shifts answer the same question from two angles, are guarded
 * by the same `staff` area, and are read by the same person in the same
 * sitting. Two near-identical pages would mean whoever is looking has to
 * already know which one holds the answer — the same reasoning the
 * login-history page applies to itself about not being a saved filter on the
 * audit trail.
 *
 * They are NOT merged into one table. A sign-in is an instant the system
 * recorded; a shift is a span the person declared. Interleaving them would
 * imply a relationship that does not exist — somebody can be signed in
 * without being on shift, and on shift on somebody else's till.
 *
 * ─── "ON NOW" IS ITS OWN TAB, NOT A FILTER ───────────────────────────
 * It is the question a manager actually walks up to this page to ask, and a
 * filter control set to a non-default value is not discoverable by anyone who
 * does not already know to look for it.
 */

type Tab = 'onNow' | 'shifts' | 'logins';

export function StaffActivityView() {
  const t = useTranslations('staffActivity');
  const [tab, setTab] = useState<Tab>('onNow');

  return (
    <div className="space-y-6">
      <SegmentedControl
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        aria-label={t('switchLabel')}
        options={[
          { value: 'onNow', label: t('tabs.onNow') },
          { value: 'shifts', label: t('tabs.shifts') },
          { value: 'logins', label: t('tabs.logins') },
        ]}
      />

      {tab === 'onNow' ? <ShiftsTable openOnly /> : null}
      {tab === 'shifts' ? <ShiftsTable /> : null}
      {tab === 'logins' ? <LoginHistoryTable /> : null}
    </div>
  );
}
