import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { SavedViewTabs, type SavedView } from '../saved-view-tabs';

type Filters = { status: string };

const VIEWS: SavedView<Filters>[] = [
  { id: 'all', label: 'All', filters: { status: '' } },
  { id: 'pending', label: 'Pending', filters: { status: 'PENDING' } },
  { id: 'shipped', label: 'Shipped', filters: { status: 'SHIPPED' } },
];

describe('which tab is active', () => {
  it('marks the tab matching the current filters as selected', () => {
    render(
      <SavedViewTabs views={VIEWS} currentFilters={{ status: 'PENDING' }} onSelect={vi.fn()} />,
    );

    expect(screen.getByRole('tab', { name: 'Pending' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
  });

  it('treats an empty filter value as the "All" view', () => {
    render(<SavedViewTabs views={VIEWS} currentFilters={{ status: '' }} onSelect={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  });

  it('selects no tab when the current filters match none of them', () => {
    // A status the tab set doesn't cover (e.g. CANCELED, if no tab names it)
    // is a legitimate state reached by the filter dropdown directly — the
    // tab row doesn't have to have an opinion about every possible value.
    render(
      <SavedViewTabs views={VIEWS} currentFilters={{ status: 'CANCELED' }} onSelect={vi.fn()} />,
    );

    for (const view of VIEWS) {
      expect(screen.getByRole('tab', { name: view.label })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    }
  });
});

describe('selecting a tab', () => {
  it('calls onSelect with that view\'s filters', async () => {
    const onSelect = vi.fn();
    render(
      <SavedViewTabs views={VIEWS} currentFilters={{ status: '' }} onSelect={onSelect} />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Shipped' }));

    expect(onSelect).toHaveBeenCalledWith({ status: 'SHIPPED' });
  });
});

describe('multi-key views', () => {
  type MultiFilters = { status: string; from: string };

  it('requires every key to match, not just one', () => {
    const views: SavedView<MultiFilters>[] = [
      { id: 'recent-pending', label: 'Recent pending', filters: { status: 'PENDING', from: '2026-01-01' } },
    ];

    render(
      <SavedViewTabs
        views={views}
        currentFilters={{ status: 'PENDING', from: '' }}
        onSelect={vi.fn()}
      />,
    );

    // status matches but from doesn't — the combined view is not active.
    expect(screen.getByRole('tab', { name: 'Recent pending' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});
