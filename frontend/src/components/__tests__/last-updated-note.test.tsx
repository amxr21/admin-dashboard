import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';

import { render, screen } from '@/test/render';
import { LastUpdatedNote } from '../last-updated-note';

/**
 * C5.3 — "Updated {when} by {who}", shared across every mutable record's
 * detail page (currently orders and couriers). Deliberately dumb: given
 * `{ when, who }`, it renders and optionally links to the audit trail — it
 * fetches nothing itself, since what counts as "last touched" differs per
 * caller (see order-detail.tsx's own merge of status history + audit).
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('who is known', () => {
  it('names who made the change', () => {
    render(<LastUpdatedNote when="2026-08-08T10:00:00.000Z" who="owner@example.test" />);

    expect(screen.getByText(/owner@example\.test/)).toBeInTheDocument();
    expect(screen.getByText(/2 hours ago/)).toBeInTheDocument();
  });
});

describe('who is unknown', () => {
  it('renders without a name rather than fabricating one, when the actor is null', () => {
    render(<LastUpdatedNote when="2026-08-08T10:00:00.000Z" who={null} />);

    expect(screen.getByText(/2 hours ago/)).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });
});

describe('linking to the audit trail', () => {
  it('links to the given href when provided', () => {
    render(
      <LastUpdatedNote
        when="2026-08-08T10:00:00.000Z"
        who="owner@example.test"
        auditHref="/admin/audit?entity=orders&entityId=o1"
      />,
    );

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/admin/audit?entity=orders&entityId=o1',
    );
  });

  it('renders as plain text, not a link, when no audit route exists yet', () => {
    render(<LastUpdatedNote when="2026-08-08T10:00:00.000Z" who="owner@example.test" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
