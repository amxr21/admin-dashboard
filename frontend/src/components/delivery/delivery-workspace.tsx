'use client';

import { useTranslations } from 'next-intl';

import { CouriersTable } from '@/components/delivery/couriers-table';
import { DeliveryBoard } from '@/components/delivery/delivery-board';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useUrlState } from '@/hooks/useUrlState';

type DeliveryView = 'board' | 'couriers';

const URL_DEFAULTS = { view: 'board' };

/** Keeps the operational board and courier directory together without asking
 * one table to serve two unrelated workflows. The selected view is shareable. */
export function DeliveryWorkspace() {
  const t = useTranslations('delivery.workspace');
  const { values, setValues } = useUrlState(URL_DEFAULTS);
  const view: DeliveryView = values.view === 'couriers' ? 'couriers' : 'board';

  return (
    <div className="space-y-5">
      <SegmentedControl
        value={view}
        onChange={(next) => setValues({ view: next === 'board' ? null : next })}
        aria-label={t('label')}
        className="max-w-md"
        options={[
          { value: 'board', label: t('board') },
          { value: 'couriers', label: t('couriers') },
        ]}
      />

      {view === 'board' ? <DeliveryBoard /> : <CouriersTable />}
    </div>
  );
}
