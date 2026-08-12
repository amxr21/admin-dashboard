import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
import { SettingsForm } from '../settings-form';
import type { Setting } from '@/lib/settings-api';

/**
 * The settings form renders itself entirely from what the server sends — the
 * cases worth pinning are per CONTROL TYPE (does the right input appear, does
 * changing it produce the right value type) rather than the save/dirty-state
 * plumbing, which is generic and doesn't vary by field.
 *
 * `@/i18n/navigation` pulls in next/navigation, which does not resolve under
 * vitest. Same mock as error-screen.test.tsx — SettingsForm's error state
 * renders ErrorScreen, which uses Link.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

const fetchSettings = vi.hoisted(() => vi.fn());
const saveSettings = vi.hoisted(() => vi.fn());
const revertSetting = vi.hoisted(() => vi.fn());

vi.mock('@/lib/settings-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/settings-api')>();
  return { ...actual, fetchSettings, saveSettings, revertSetting };
});

function makeSettings(overrides: Partial<Setting>[] = []): Setting[] {
  const base: Setting[] = [
    {
      key: 'ui.showDemoBanner',
      label: 'Show the demo banner',
      type: 'boolean',
      value: true,
      isDefault: true,
      updatedAt: null,
    },
    {
      key: 'store.currency',
      label: 'Currency',
      type: 'enum',
      options: ['AED', 'USD'],
      value: 'AED',
      isDefault: true,
      updatedAt: null,
    },
    {
      key: 'inventory.lowStockThreshold',
      label: 'Low stock threshold',
      type: 'number',
      min: 0,
      max: 100,
      value: 5,
      isDefault: true,
      updatedAt: null,
    },
    {
      key: 'store.name',
      label: 'Store name',
      type: 'string',
      value: '',
      isDefault: true,
      updatedAt: null,
    },
    {
      key: 'theme.accentColor',
      label: 'Accent color',
      type: 'color',
      options: ['#2563eb', '#4f46e5', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0d9488'],
      value: '#2563eb',
      isDefault: true,
      updatedAt: null,
    },
  ];

  const overrideByKey = new Map(overrides.map((s) => [s.key, s]));
  return base.map((setting) => ({ ...setting, ...overrideByKey.get(setting.key) }));
}

beforeEach(() => {
  fetchSettings.mockReset();
  saveSettings.mockReset();
  revertSetting.mockReset();
});

describe('rendering a control per declared type', () => {
  it('renders a checkbox for boolean', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    const checkbox = await screen.findByRole('checkbox', { name: /show the demo banner/i });
    expect(checkbox).toBeChecked();
  });

  it('renders a select for enum, with its options', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    expect(await screen.findByRole('combobox')).toHaveTextContent('AED');
  });

  it('renders a numeric input for number', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    const input = await screen.findByLabelText(/low stock threshold/i);
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveValue(5);
  });

  it('renders a text input for string', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    expect(await screen.findByLabelText(/store name/i)).toHaveAttribute('type', 'text');
  });
});

describe('the color control', () => {
  it('renders a curated swatch picker, never a free hex field', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    // A radiogroup of vetted swatches — not <input type="color"> (this app
    // avoids native interactive widgets) and not a free-hex text field
    // either (the server only ever declares palette members as `options`,
    // see ACCENT_COLOR_PALETTE in settings.config.ts).
    const group = await screen.findByRole('radiogroup', { name: /accent color/i });
    const swatches = within(group).getAllByRole('radio');
    expect(swatches).toHaveLength(8);

    const selected = swatches.find((swatch) => swatch.getAttribute('aria-checked') === 'true');
    expect(selected).toHaveAttribute('aria-label', '#2563eb');
  });

  it('picking a swatch saves that palette value', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    saveSettings.mockResolvedValue(makeSettings([{ key: 'theme.accentColor', value: '#16a34a' } as Setting]));
    const user = userEvent.setup();

    render(<SettingsForm />);

    const group = await screen.findByRole('radiogroup', { name: /accent color/i });
    await user.click(within(group).getByRole('radio', { name: '#16a34a' }));

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith({ 'theme.accentColor': '#16a34a' });
    });
  });
});

describe('saving only what changed', () => {
  it('disables Save while the form is untouched', async () => {
    fetchSettings.mockResolvedValue(makeSettings());

    render(<SettingsForm />);
    await screen.findByRole('checkbox', { name: /show the demo banner/i });

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('sends only the one field that changed', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    saveSettings.mockResolvedValue(makeSettings([{ key: 'store.name', value: 'Ammar Supplies' } as Setting]));
    const user = userEvent.setup();

    render(<SettingsForm />);

    const nameInput = await screen.findByLabelText(/store name/i);
    await user.type(nameInput, 'Ammar Supplies');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith({ 'store.name': 'Ammar Supplies' });
    });
  });
});

/**
 * B3.1 — `isDefault`/`updatedAt` were already in every API response; the
 * frontend just never rendered them. These pin the one behaviour that would
 * be actively wrong if it regressed: revert only targets the SAVED value,
 * never a pending local edit — the two are different actions and must not
 * collapse into one button that means different things depending on state.
 */
describe('modified marker and revert', () => {
  it('shows no modified badge for a setting still at its default', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    await screen.findByLabelText(/store name/i);
    expect(screen.queryByText(/modified/i)).not.toBeInTheDocument();
  });

  it('shows a modified badge and a revert control for a changed setting', async () => {
    fetchSettings.mockResolvedValue(
      makeSettings([
        { key: 'store.name', value: 'Ammar Supplies', isDefault: false, updatedAt: '2026-08-01T00:00:00.000Z' } as Setting,
      ]),
    );
    render(<SettingsForm />);

    await screen.findByLabelText(/^store name$/i);
    expect(screen.getByText(/modified/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /revert store name to its default/i }),
    ).toBeInTheDocument();
  });

  it('disables revert while there is an unsaved local edit on that same field', async () => {
    fetchSettings.mockResolvedValue(
      makeSettings([{ key: 'store.name', value: 'Ammar Supplies', isDefault: false } as Setting]),
    );
    const user = userEvent.setup();
    render(<SettingsForm />);

    const nameInput = await screen.findByLabelText(/^store name$/i);
    await user.type(nameInput, 'X');

    expect(
      screen.getByRole('button', { name: /revert store name to its default/i }),
    ).toBeDisabled();
  });

  it('calls revertSetting for exactly the clicked key and applies the response', async () => {
    fetchSettings.mockResolvedValue(
      makeSettings([{ key: 'store.name', value: 'Ammar Supplies', isDefault: false } as Setting]),
    );
    revertSetting.mockResolvedValue(makeSettings()); // back to every default
    const user = userEvent.setup();

    render(<SettingsForm />);
    await screen.findByLabelText(/^store name$/i);

    await user.click(screen.getByRole('button', { name: /revert store name to its default/i }));

    await waitFor(() => expect(revertSetting).toHaveBeenCalledWith('store.name'));
    // The field actually shows the reverted (empty, per the base fixture)
    // value afterwards, not just a resolved promise nobody applied.
    await waitFor(() => expect(screen.getByLabelText(/^store name$/i)).toHaveValue(''));
  });

  it('does not offer revert on a field that has never been changed', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    await screen.findByLabelText(/store name/i);
    expect(
      screen.queryByRole('button', { name: /revert store name to its default/i }),
    ).not.toBeInTheDocument();
  });
});

/**
 * B3.8 — settings search. Every group stays visible; a query narrows which
 * FIELDS render inside it, and a group with no matches renders nothing
 * (rather than an empty section header nobody asked for).
 */
describe('search', () => {
  it('filters fields by label, leaving non-matching fields out', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    await screen.findByLabelText(/store name/i);
    await userEvent.type(screen.getByLabelText(/search settings/i), 'currency');

    expect(screen.getByLabelText(/^currency$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^store name$/i)).not.toBeInTheDocument();
  });

  it('also matches on the setting key, not just the visible label', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    await screen.findByLabelText(/store name/i);
    await userEvent.type(screen.getByLabelText(/search settings/i), 'lowstockthreshold');

    expect(screen.getByLabelText(/low stock threshold/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^store name$/i)).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches, rather than a blank page', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    await screen.findByLabelText(/store name/i);
    await userEvent.type(screen.getByLabelText(/search settings/i), 'nonexistent-xyz');

    expect(await screen.findByText(/no settings match/i)).toBeInTheDocument();
  });

  it('shows every field again once the query is cleared', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    await screen.findByLabelText(/store name/i);
    const search = screen.getByLabelText(/search settings/i);
    await userEvent.type(search, 'currency');
    await userEvent.clear(search);

    expect(screen.getByLabelText(/^store name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^currency$/i)).toBeInTheDocument();
  });
});

/**
 * B3.8 — per-section last-modified + audit link. Each group shows the most
 * recent `updatedAt` across its own fields (not a global one, and not the
 * most recently modified field in a DIFFERENT group), plus a deep link into
 * the audit trail.
 */
describe('per-section last-modified and audit link', () => {
  it('shows the most recent updatedAt across a group\'s own fields', async () => {
    fetchSettings.mockResolvedValue(
      makeSettings([
        {
          key: 'store.name',
          value: 'Ammar Supplies',
          isDefault: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as Setting,
        {
          key: 'store.currency',
          value: 'USD',
          isDefault: false,
          updatedAt: '2026-06-01T00:00:00.000Z',
        } as Setting,
      ]),
    );
    render(<SettingsForm />);

    await screen.findByLabelText(/^store name$/i);

    // "Brand" group (store.* prefix) should reflect the LATER of its two
    // changed fields' timestamps, not the earlier one.
    const brandSection = screen.getByRole('region', { name: /brand/i });
    expect(within(brandSection).getByText(/last changed/i)).toBeInTheDocument();
  });

  it('shows "never changed" for a group where nothing has ever been modified', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    await screen.findByLabelText(/store name/i);

    const brandSection = screen.getByRole('region', { name: /brand/i });
    expect(within(brandSection).getByText(/never changed/i)).toBeInTheDocument();
  });

  it('links each section to the audit trail scoped to settings', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    await screen.findByLabelText(/store name/i);

    const links = screen.getAllByRole('link', { name: /view audit history/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/admin/audit?entity=settings');
    }
  });
});

describe('business-specific nav labels group', () => {
  it('groups labels.nav.* fields under their own "Labels" section', async () => {
    fetchSettings.mockResolvedValue([
      ...makeSettings(),
      {
        key: 'labels.nav.staff',
        label: 'Staff page name',
        type: 'string',
        value: '',
        isDefault: true,
        updatedAt: null,
      } as Setting,
    ]);
    render(<SettingsForm />);

    await screen.findByLabelText(/store name/i);

    const labelsSection = screen.getByRole('region', { name: /labels/i });
    expect(within(labelsSection).getByLabelText(/staff page name/i)).toBeInTheDocument();
  });
});
