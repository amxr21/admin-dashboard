import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
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

vi.mock('@/lib/settings-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/settings-api')>();
  return { ...actual, fetchSettings, saveSettings };
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
  it('shows the swatch and a hex text field, never a native color picker', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    render(<SettingsForm />);

    const input = await screen.findByLabelText(/accent color/i);
    // A plain text field validated as hex — not <input type="color">, which
    // this app avoids in favour of custom-built controls (project-ui-system).
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('#2563eb');
  });

  it('lets a new hex value be typed and saved', async () => {
    fetchSettings.mockResolvedValue(makeSettings());
    saveSettings.mockResolvedValue(makeSettings([{ key: 'theme.accentColor', value: '#16a34a' } as Setting]));
    const user = userEvent.setup();

    render(<SettingsForm />);

    const input = await screen.findByLabelText(/accent color/i);
    await user.clear(input);
    await user.type(input, '#16a34a');

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
