import { beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ChecklistBoard, type ChecklistGroup } from '../checklist-board';

const groups: ChecklistGroup[] = [
  {
    id: 'launch',
    title: 'Branch launch',
    description: 'Prepare the branch.',
    items: [
      { id: 'launch.timezone', label: 'Set timezone', detail: 'Use the branch local timezone.' },
      { id: 'launch.stock', label: 'Load stock', detail: 'Record opening quantities.' },
    ],
  },
];

const copy = {
  completed: 'Completed',
  completeGroup: 'Complete group',
  resetAll: 'Reset all',
  resetTitle: 'Reset every checklist?',
  resetDescription: 'This removes local progress.',
  cancel: 'Cancel',
  confirmReset: 'Reset checklists',
  savedLocally: 'Saved locally.',
  saveFailed: 'Could not save progress.',
};

beforeEach(() => window.localStorage.clear());

describe('ChecklistBoard', () => {
  it('persists item progress in this browser', async () => {
    const user = userEvent.setup();
    render(<ChecklistBoard groups={groups} copy={copy} />);

    await user.click(screen.getByRole('checkbox', { name: /set timezone/i }));

    expect(window.localStorage.getItem('admin-dashboard:guide-checklist:v1')).toContain('launch.timezone');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('restores saved progress and can clear it with confirmation', async () => {
    window.localStorage.setItem('admin-dashboard:guide-checklist:v1', JSON.stringify(['launch.stock']));
    const user = userEvent.setup();
    render(<ChecklistBoard groups={groups} copy={copy} />);

    expect(await screen.findByRole('checkbox', { name: /load stock/i })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /reset all/i }));
    await user.click(screen.getByRole('button', { name: /reset checklists/i }));

    expect(window.localStorage.getItem('admin-dashboard:guide-checklist:v1')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /load stock/i })).not.toBeChecked();
  });
});
