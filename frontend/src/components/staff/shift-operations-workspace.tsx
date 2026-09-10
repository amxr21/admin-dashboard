'use client';

import { useTranslations } from 'next-intl';

import { ShiftApprovalQueue } from '@/components/staff/shift-approval-queue';
import { ShiftsTable } from '@/components/staff/shifts-table';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useUrlState } from '@/hooks/useUrlState';

type ShiftView = 'working' | 'approvals';
const URL_DEFAULTS = { view: 'working' };

/** Operational presence and review are related, but remain distinct views. */
export function ShiftOperationsWorkspace() {
  const t = useTranslations('shifts.workspace');
  const { values, setValues } = useUrlState(URL_DEFAULTS);
  const view: ShiftView = values.view === 'approvals' ? 'approvals' : 'working';

  return (
    <div className="space-y-5">
      <SegmentedControl
        value={view}
        onChange={(next) => setValues({ view: next === 'working' ? null : next })}
        aria-label={t('label')}
        className="max-w-md"
        options={[
          { value: 'working', label: t('working') },
          { value: 'approvals', label: t('approvals') },
        ]}
      />
      {view === 'working' ? <ShiftsTable openOnly /> : <ShiftApprovalQueue />}
    </div>
  );
}
