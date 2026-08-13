import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { PoliciesPanel } from '../policies-panel';
import type { PolicySummary, PolicyVersion } from '@/lib/policies-api';

/**
 * B3.5 — Policy documents, per locale, versioned.
 *
 * What's worth pinning: publishing never looks like an overwrite (the dirty
 * gate keeps Publish disabled until the text actually changes), the history
 * panel never offers "revert" on the version that's already live (there is
 * nothing to revert TO), and a grid cell with no published version reads as
 * "Not published" rather than a blank/broken row.
 */

const fetchPolicies = vi.hoisted(() => vi.fn());
const fetchPolicyVersions = vi.hoisted(() => vi.fn());
const publishPolicy = vi.hoisted(() => vi.fn());
const revertPolicy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/policies-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/policies-api')>();
  return { ...actual, fetchPolicies, fetchPolicyVersions, publishPolicy, revertPolicy };
});

function makeSummaries(overrides: Partial<PolicySummary> = {}): PolicySummary[] {
  const base: PolicySummary = {
    type: 'RETURN',
    locale: 'en',
    version: 2,
    content: 'Return within 30 days.',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
  const target = { ...base, ...overrides };

  const types: PolicySummary['type'][] = ['RETURN', 'PRIVACY', 'TERMS', 'SHIPPING'];
  const locales: PolicySummary['locale'][] = ['en', 'ar'];

  return types.flatMap((type) =>
    locales.map((locale) =>
      type === target.type && locale === target.locale
        ? target
        : { type, locale, version: null, content: null, updatedAt: null },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchPolicies.mockResolvedValue(makeSummaries());
  fetchPolicyVersions.mockResolvedValue([
    { id: 'v2', type: 'RETURN', locale: 'en', version: 2, content: 'Return within 30 days.', createdById: 'u1', createdAt: '2026-08-01T00:00:00.000Z' },
    { id: 'v1', type: 'RETURN', locale: 'en', version: 1, content: 'Return within 14 days.', createdById: 'u1', createdAt: '2026-07-01T00:00:00.000Z' },
  ] satisfies PolicyVersion[]);
  publishPolicy.mockResolvedValue({
    id: 'v3',
    type: 'RETURN',
    locale: 'en',
    version: 3,
    content: 'Updated text',
    createdById: 'u1',
    createdAt: '2026-08-09T00:00:00.000Z',
  });
  revertPolicy.mockResolvedValue({
    id: 'v3',
    type: 'RETURN',
    locale: 'en',
    version: 3,
    content: 'Return within 14 days.',
    createdById: 'u1',
    createdAt: '2026-08-09T00:00:00.000Z',
  });
});

describe('PoliciesPanel — overview grid', () => {
  it('shows the published version for a (type, locale) pair with content', async () => {
    render(<PoliciesPanel />);
    expect(await screen.findByText('v2')).toBeInTheDocument();
  });

  it('shows "Not published" for a pair with no version yet, not a blank row', async () => {
    render(<PoliciesPanel />);
    const unpublished = await screen.findAllByText(/not published/i);
    // 8 cells total (4 types × 2 locales), only 1 has content in this fixture.
    expect(unpublished).toHaveLength(7);
  });
});

describe('PoliciesPanel — editor', () => {
  it('keeps Publish disabled until the text actually changes', async () => {
    render(<PoliciesPanel />);

    await userEvent.click(await screen.findByText('v2'));
    const textarea = await screen.findByPlaceholderText(/write the policy text/i);
    expect(textarea).toHaveValue('Return within 30 days.');

    const publishButton = screen.getByRole('button', { name: /^publish$/i });
    expect(publishButton).toBeDisabled();

    await userEvent.type(textarea, ' Extra.');
    expect(publishButton).toBeEnabled();
  });

  it('publishes the new content and closes the editor', async () => {
    render(<PoliciesPanel />);

    await userEvent.click(await screen.findByText('v2'));
    const textarea = await screen.findByPlaceholderText(/write the policy text/i);
    await userEvent.type(textarea, ' Extra.');
    await userEvent.click(screen.getByRole('button', { name: /^publish$/i }));

    await waitFor(() =>
      expect(publishPolicy).toHaveBeenCalledWith('RETURN', 'en', 'Return within 30 days. Extra.'),
    );
  });
});

describe('PoliciesPanel — history and revert', () => {
  it('never offers revert on the version that is already live', async () => {
    render(<PoliciesPanel />);

    await userEvent.click(await screen.findByText('v2'));
    await userEvent.click(await screen.findByRole('button', { name: /^history$/i }));

    await waitFor(() => expect(fetchPolicyVersions).toHaveBeenCalled());
    expect(await screen.findByText(/current/i)).toBeInTheDocument();

    // Exactly one revert button — for v1, not for the live v2.
    const revertButtons = screen.getAllByRole('button', { name: /revert/i });
    expect(revertButtons).toHaveLength(1);
  });

  it('requires confirmation before reverting', async () => {
    render(<PoliciesPanel />);

    await userEvent.click(await screen.findByText('v2'));
    await userEvent.click(await screen.findByRole('button', { name: /^history$/i }));
    await screen.findByText(/current/i);

    await userEvent.click(screen.getByRole('button', { name: /revert/i }));
    expect(revertPolicy).not.toHaveBeenCalled();
    expect(await screen.findByText(/revert to v1\?/i)).toBeInTheDocument();
  });

  it('calls revertPolicy with the target version once confirmed', async () => {
    render(<PoliciesPanel />);

    await userEvent.click(await screen.findByText('v2'));
    await userEvent.click(await screen.findByRole('button', { name: /^history$/i }));
    await screen.findByText(/current/i);

    await userEvent.click(screen.getByRole('button', { name: /revert/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^revert$/i }));

    await waitFor(() => expect(revertPolicy).toHaveBeenCalledWith('RETURN', 'en', 'v1'));
  });
});
