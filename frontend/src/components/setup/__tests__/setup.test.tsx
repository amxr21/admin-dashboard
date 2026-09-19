import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/render';
import { SetupWizard } from '../setup-wizard';
import { SetupPrompt } from '../setup-prompt';
import { SetupFeatureGate } from '../setup-feature-gate';
import { FeatureSettingsLinks } from '@/components/settings/feature-settings-links';
import { SETUP_FEATURE_KEYS, type SetupDraft, type SetupState } from '@/lib/setup-api';
import { isSetupPathEnabled } from '@/lib/setup-visibility';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), preview: vi.fn(), apply: vi.fn(), skip: vi.fn(), refresh: vi.fn(), role: 'OWNER', settings: { isLoading: false, setupCompletedAt: '', setupSkippedAt: '', enabledFeatures: {} as Record<string, boolean> } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: mocks.role } }) }));
vi.mock('@/components/providers/settings-provider', () => ({ useAppSettings: () => ({ ...mocks.settings, refresh: mocks.refresh }) }));
vi.mock('@/lib/setup-api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/setup-api')>(), fetchSetup: mocks.fetch, previewSetup: mocks.preview, applySetup: mocks.apply, skipSetup: mocks.skip }));

function fixture(): SetupState {
  const current: SetupDraft = { businessType: 'OTHER', features: Object.fromEntries(SETUP_FEATURE_KEYS.map(key => [key, true])) as SetupDraft['features'], labels: { products: '', orders: '', staff: '' }, defaults: {}, rolePermissions: {} };
  const cafe = { ...current, businessType: 'CAFE' as const, features: { ...current.features, delivery: false, returns: false, customerCases: false, scheduledReports: false } };
  return { completedAt: null, skippedAt: null, current, templates: [current, cafe], features: SETUP_FEATURE_KEYS.map(key => ({ key, canDisable: !['dashboard', 'settings'].includes(key), dependsOn: [], routes: [] })), defaultDefinitions: [], roles: [{ role: 'OWNER', areas: [], isLocked: true, isCustomised: false }] };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.role = 'OWNER'; mocks.settings = { isLoading: false, setupCompletedAt: '', setupSkippedAt: '', enabledFeatures: {} };
  mocks.fetch.mockResolvedValue(fixture()); mocks.skip.mockResolvedValue({}); mocks.apply.mockResolvedValue({}); mocks.refresh.mockResolvedValue(undefined);
  mocks.preview.mockImplementation(async (draft: SetupDraft) => ({ normalized: draft, enabledFeatures: SETUP_FEATURE_KEYS.filter(key => draft.features[key]), disabledFeatures: SETUP_FEATURE_KEYS.filter(key => !draft.features[key]), labelChanges: draft.labels, settingChanges: draft.defaults, permissionChanges: [], warnings: [{ code: 'existingData', feature: 'returns', severity: 'warning' }] }));
});

describe('business setup', () => {
  it('offers optional setup to owners and skip dismisses it without applying', async () => {
    render(<SetupPrompt role="OWNER" />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument());
    expect(mocks.skip).toHaveBeenCalledOnce(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it.each(['completed', 'skipped', 'staff'])('suppresses the prompt when %s', reason => {
    if (reason === 'completed') mocks.settings.setupCompletedAt = '2026-09-13';
    if (reason === 'skipped') mocks.settings.setupSkippedAt = '2026-09-13';
    render(<SetupPrompt role={reason === 'staff' ? 'SUPPORT' : 'OWNER'} />);
    expect(screen.queryByText('Start setup')).not.toBeInTheDocument();
  });
  it('loads Cafe recommendations, allows overrides, and reviews before apply', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);
    await user.click(await screen.findByRole('button', { name: 'Start setup' }));
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Cafe' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('checkbox', { name: 'Delivery' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Delivery' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // The `names` step is gone; its label inputs now live in Review. Walk
    // products → people → operations (2 Next clicks), then Review.
    for (let i = 0; i < 2; i++) await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(await screen.findByText('Hidden sections')).toBeInTheDocument();
    // The Cafe preset renamed Products → "Menu items"; the editable label
    // input carrying that value now appears in Review.
    expect(screen.getByLabelText('Products')).toHaveValue('Menu items');
    expect(screen.getByText(/Returns has existing data/)).toBeInTheDocument();
    expect(mocks.apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply setup' }));
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ businessType: 'CAFE', features: expect.objectContaining({ delivery: true, returns: false }) }));
    expect(await screen.findByText('Setup preferences saved')).toBeInTheDocument();
  });
  it('shows retry after loading fails', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('offline'));
    render(<SetupWizard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Start setup' })).toBeInTheDocument();
  });
  it('does not fetch owner-only data for support', () => {
    mocks.role = 'SUPPORT'; render(<SetupWizard />);
    expect(screen.getByRole('alert')).toHaveTextContent('Only an owner'); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('keeps the Settings rerun link after completion and hides disabled discovery links', () => {
    mocks.settings.setupCompletedAt = '2026-09-13'; mocks.settings.enabledFeatures = { branches: false, scheduledReports: false };
    render(<FeatureSettingsLinks />);
    expect(screen.getByRole('link', { name: /Business setup/ })).toHaveAttribute('href', '/admin/setup');
    expect(screen.queryByRole('link', { name: /Businesses and branches/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Scheduled reports/ })).not.toBeInTheDocument();
  });
  it.each(['OWNER', 'SUPPORT'] as const)('replaces disabled direct routes for %s', role => {
    mocks.settings.enabledFeatures = { returns: false };
    render(<SetupFeatureGate pathname="/admin/returns/one" role={role}><p>Return details</p></SetupFeatureGate>);
    expect(screen.queryByText('Return details')).not.toBeInTheDocument();
    expect(screen.getByText('This feature is not enabled for this business setup')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Business setup' }) !== null).toBe(role === 'OWNER');
  });
  it('renders Arabic setup with translated controls', async () => {
    render(<SetupWizard />, { locale: 'ar' });
    expect(await screen.findByRole('button', { name: 'بدء الإعداد' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
  it('matches full route segments and defaults to visible on existing installs', () => {
    expect(isSetupPathEnabled('/admin/returns')).toBe(true);
    expect(isSetupPathEnabled('/admin/returns?view=all', { returns: false })).toBe(false);
    expect(isSetupPathEnabled('/admin/returns-other', { returns: false })).toBe(true);
    expect(isSetupPathEnabled('/admin/reports/scheduled', { scheduledReports: false })).toBe(false);
    expect(isSetupPathEnabled('/admin/reports/revenue', { scheduledReports: false })).toBe(true);
  });
});
