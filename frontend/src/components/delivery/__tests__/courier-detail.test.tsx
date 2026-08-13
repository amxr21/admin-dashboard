import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { BreadcrumbProvider, useBreadcrumbSegments } from '@/components/shell/breadcrumb';
import { CourierDetail } from '../courier-detail';
import type { CourierDetail as CourierDetailData } from '@/lib/delivery-api';

/**
 * B4.5 — one courier: contact details, region/country, and recent
 * assignments. `GET /couriers/:id` existed with zero frontend references;
 * `region`/`country` were accepted on create/update and returned by the
 * list endpoint but never rendered anywhere at all.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

const fetchCourier = vi.hoisted(() => vi.fn());
const updateCourier = vi.hoisted(() => vi.fn());
const fetchAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/delivery-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/delivery-api')>();
  return { ...actual, fetchCourier, updateCourier };
});

vi.mock('@/lib/audit-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit-api')>();
  return { ...actual, fetchAudit };
});

function makeCourier(overrides: Partial<CourierDetailData> = {}): CourierDetailData {
  return {
    id: 'c1',
    name: 'Sami',
    email: 'sami@example.test',
    phone: '+971500000000',
    vehicleType: 'Van',
    plateNumber: 'A12345',
    zone: 'Marina',
    region: 'Dubai',
    country: 'UAE',
    status: 'ACTIVE',
    createdAt: '2026-07-01T00:00:00.000Z',
    hasAccessCode: true,
    activeAssignments: 1,
    assignments: [],
    ...overrides,
  };
}

beforeEach(() => {
  fetchCourier.mockReset();
  updateCourier.mockReset();
  fetchAudit.mockReset();
  fetchAudit.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 1, totalPages: 0, nextCursor: null });
});

describe('"Updated by" (C5.3)', () => {
  it('renders nothing when the courier has no audit history yet', async () => {
    fetchCourier.mockResolvedValue(makeCourier());

    render(<CourierDetail id="c1" />);

    await screen.findByText('Sami');
    expect(screen.queryByRole('link', { name: /admin\/audit/i })).not.toBeInTheDocument();
  });

  it('shows who last touched the record, linked to its audit history', async () => {
    fetchCourier.mockResolvedValue(makeCourier());
    fetchAudit.mockResolvedValue({
      entries: [
        {
          id: 'a1',
          action: 'courier.updated',
          entity: 'couriers',
          entityId: 'c1',
          actorId: 'u1',
          actorEmail: 'owner@example.test',
          actorRole: 'OWNER',
          changes: { zone: { from: null, to: 'Marina' } },
          outcome: 'SUCCESS',
          requestId: null,
          ip: null,
          userAgent: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 1,
      totalPages: 1,
      nextCursor: null,
    });

    render(<CourierDetail id="c1" />);

    const link = await screen.findByRole('link', { name: /owner@example\.test/ });
    expect(link).toHaveAttribute('href', '/admin/audit?entity=couriers&entityId=c1');
  });

  it('does not block the courier from rendering when the audit lookup fails', async () => {
    fetchCourier.mockResolvedValue(makeCourier());
    fetchAudit.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CourierDetail id="c1" />);

    expect(await screen.findByText('Sami')).toBeInTheDocument();
  });
});

describe('danger zone (C5.2)', () => {
  it('offers deactivation for an active courier', async () => {
    fetchCourier.mockResolvedValue(makeCourier({ status: 'ACTIVE' }));

    render(<CourierDetail id="c1" />);

    expect(await screen.findByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('shows a plain notice, not the button, for an already-inactive courier', async () => {
    fetchCourier.mockResolvedValue(makeCourier({ status: 'INACTIVE' }));

    render(<CourierDetail id="c1" />);

    await screen.findByText('Sami');
    expect(screen.getByText(/already deactivated/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });
});

describe('breadcrumb (C4.4)', () => {
  it('registers Delivery → courier name with the shell', async () => {
    fetchCourier.mockResolvedValue(makeCourier({ name: 'Sami' }));

    function Consumer() {
      const segments = useBreadcrumbSegments();
      return <div data-testid="crumbs">{segments ? JSON.stringify(segments) : 'none'}</div>;
    }

    render(
      <BreadcrumbProvider>
        <CourierDetail id="c1" />
        <Consumer />
      </BreadcrumbProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('crumbs').textContent).toContain('/admin/delivery');
    });
    expect(screen.getByTestId('crumbs').textContent).toContain('Sami');
  });
});

describe('CourierDetail — contact and region fields', () => {
  it('renders region and country, previously never shown anywhere', async () => {
    fetchCourier.mockResolvedValue(makeCourier({ region: 'Dubai', country: 'UAE' }));

    render(<CourierDetail id="c1" />);

    expect(await screen.findByText('Dubai')).toBeInTheDocument();
    expect(screen.getByText('UAE')).toBeInTheDocument();
  });

  it('shows a placeholder rather than a blank field when region is unset', async () => {
    fetchCourier.mockResolvedValue(makeCourier({ region: null, country: null }));

    render(<CourierDetail id="c1" />);

    await screen.findByText('Sami');
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('states whether an access code exists, without ever showing the code itself', async () => {
    fetchCourier.mockResolvedValue(makeCourier({ hasAccessCode: true }));

    render(<CourierDetail id="c1" />);

    expect(await screen.findByText(/issued/i)).toBeInTheDocument();
  });
});

describe('CourierDetail — recent assignments', () => {
  it('shows an empty state when the courier has no assignment history', async () => {
    fetchCourier.mockResolvedValue(makeCourier({ assignments: [] }));

    render(<CourierDetail id="c1" />);

    expect(await screen.findByText(/no assignments yet/i)).toBeInTheDocument();
  });

  it('lists an assignment with its order, status and city', async () => {
    fetchCourier.mockResolvedValue(
      makeCourier({
        region: 'Abu Dhabi',
        assignments: [
          {
            id: 'a1',
            status: 'DELIVERED',
            address: '123 Main St',
            city: 'Sharjah',
            createdAt: '2026-08-01T00:00:00.000Z',
            order: { id: 'o1', orderNumber: 'ORD-1024', status: 'DELIVERED' },
          },
        ],
      }),
    );

    render(<CourierDetail id="c1" />);

    expect(await screen.findByText('ORD-1024')).toBeInTheDocument();
    expect(screen.getByText('Sharjah')).toBeInTheDocument();
  });

  it('links each assignment row to the underlying order', async () => {
    fetchCourier.mockResolvedValue(
      makeCourier({
        assignments: [
          {
            id: 'a1',
            status: 'ASSIGNED',
            address: null,
            city: null,
            createdAt: '2026-08-01T00:00:00.000Z',
            order: { id: 'o1', orderNumber: 'ORD-1024', status: 'CONFIRMED' },
          },
        ],
      }),
    );

    render(<CourierDetail id="c1" />);

    const link = await screen.findByRole('link', { name: 'ORD-1024' });
    expect(link).toHaveAttribute('href', '/admin/orders/o1');
  });
});

describe('CourierDetail — failure states', () => {
  it('shows the not-found screen for a missing courier', async () => {
    fetchCourier.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Courier not found'));

    render(<CourierDetail id="nope" />);

    expect(await screen.findByText(/doesn't exist/i)).toBeInTheDocument();
    expect(screen.queryByText(/server had a problem/i)).not.toBeInTheDocument();
  });

  it('shows a retryable error for a server failure', async () => {
    fetchCourier.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CourierDetail id="c1" />);

    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument();
  });
});

describe('CourierDetail — back link', () => {
  it('links back to the courier roster', async () => {
    fetchCourier.mockResolvedValue(makeCourier());

    render(<CourierDetail id="c1" />);

    await screen.findByText('Sami');
    const backLink = screen.getByRole('link', { name: /back to couriers/i });
    expect(backLink).toHaveAttribute('href', '/admin/delivery');
  });
});
