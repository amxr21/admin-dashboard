import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/render';
import { SettingsProvider, useAppSettings } from '../settings-provider';
import type { Setting } from '@/lib/settings-api';

/**
 * The provider's whole job is a side effect (CSS custom properties on
 * <html>) plus a few typed values consumers read via the hook. Both are
 * pinned here, separately from any one consumer, so a future consumer
 * doesn't have to re-prove the CSS override actually works.
 */

const fetchSettings = vi.hoisted(() => vi.fn());

vi.mock('@/lib/settings-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/settings-api')>();
  return { ...actual, fetchSettings };
});

function setting(key: string, value: string | boolean | number): Setting {
  return { key, label: key, type: 'string', value, isDefault: false, updatedAt: null };
}

function Consumer() {
  const { isLoading, tablePageSize, editPanelMode, logoUrl } = useAppSettings();
  if (isLoading) return <p>loading</p>;
  return (
    <p>
      {tablePageSize}/{editPanelMode}/{logoUrl || 'no-logo'}
    </p>
  );
}

function CurrencyConsumer() {
  const { isLoading, storeCurrency } = useAppSettings();
  if (isLoading) return <p>loading</p>;
  return <p>currency:{storeCurrency}</p>;
}

beforeEach(() => {
  fetchSettings.mockReset();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-density');
});

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-density');
});

describe('applying the theme as a side effect', () => {
  it('overrides --primary and --primary-foreground for a non-default accent', async () => {
    fetchSettings.mockResolvedValue([setting('theme.accentColor', '#16a34a')]);

    render(
      <SettingsProvider>
        <Consumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#16a34a');
    });
    expect(document.documentElement.style.getPropertyValue('--primary-foreground')).toBe('#ffffff');
  });

  it('leaves --primary alone for the default accent', async () => {
    fetchSettings.mockResolvedValue([setting('theme.accentColor', '#2563eb')]);

    render(
      <SettingsProvider>
        <Consumer />
      </SettingsProvider>,
    );

    await screen.findByText(/no-logo/);
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
  });

  it('maps corner radius options to a --radius override, and leaves default alone', async () => {
    fetchSettings.mockResolvedValue([setting('ui.cornerRadius', 'round')]);

    render(
      <SettingsProvider>
        <Consumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--radius')).toBe('1rem');
    });
  });

  it('sets data-density="compact" only when the setting says so', async () => {
    fetchSettings.mockResolvedValue([setting('ui.density', 'compact')]);

    render(
      <SettingsProvider>
        <Consumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset.density).toBe('compact');
    });
  });
});

describe('values exposed to consumers', () => {
  it('falls back to sane defaults on a fetch failure, and still renders', async () => {
    fetchSettings.mockRejectedValue(new Error('network'));

    render(
      <SettingsProvider>
        <Consumer />
      </SettingsProvider>,
    );

    expect(await screen.findByText('20/drawer/no-logo')).toBeInTheDocument();
  });

  it('exposes tablePageSize, editPanelMode and logoUrl from the registry', async () => {
    fetchSettings.mockResolvedValue([
      setting('dashboard.tablePageSize', 50),
      setting('ui.editPanelMode', 'modal'),
      setting('store.logoUrl', 'https://cdn.example.test/logo.png'),
    ]);

    render(
      <SettingsProvider>
        <Consumer />
      </SettingsProvider>,
    );

    expect(
      await screen.findByText('50/modal/https://cdn.example.test/logo.png'),
    ).toBeInTheDocument();
  });

  it('exposes the live store.currency', async () => {
    fetchSettings.mockResolvedValue([setting('store.currency', 'SAR')]);

    render(
      <SettingsProvider>
        <CurrencyConsumer />
      </SettingsProvider>,
    );

    expect(await screen.findByText('currency:SAR')).toBeInTheDocument();
  });

  it('falls back to AED when store.currency is missing or malformed', async () => {
    // Format-only guard, not an allowlist of real ISO codes — the server
    // (settings.config.ts) is the one place that enum is declared. This only
    // catches a value shaped nothing like a currency code from ever reaching
    // Intl.NumberFormat.
    fetchSettings.mockResolvedValue([setting('store.currency', 'not-a-code')]);

    render(
      <SettingsProvider>
        <CurrencyConsumer />
      </SettingsProvider>,
    );

    expect(await screen.findByText('currency:AED')).toBeInTheDocument();
  });

  it('falls back to AED when store.currency is absent entirely', async () => {
    fetchSettings.mockResolvedValue([]);

    render(
      <SettingsProvider>
        <CurrencyConsumer />
      </SettingsProvider>,
    );

    expect(await screen.findByText('currency:AED')).toBeInTheDocument();
  });
});

describe('live preview, before Save', () => {
  function PreviewConsumer() {
    const { isLoading, editPanelMode, previewSetting, clearPreview } = useAppSettings();
    if (isLoading) return <p>loading</p>;
    return (
      <div>
        <p>mode:{editPanelMode}</p>
        <button onClick={() => previewSetting('ui.editPanelMode', 'modal')}>preview modal</button>
        <button onClick={() => clearPreview()}>revert</button>
      </div>
    );
  }

  it('applies an unsaved value everywhere the setting is consumed, not just the CSS-driven ones', async () => {
    fetchSettings.mockResolvedValue([setting('ui.editPanelMode', 'drawer')]);

    render(
      <SettingsProvider>
        <PreviewConsumer />
      </SettingsProvider>,
    );

    await screen.findByText('mode:drawer');

    screen.getByText('preview modal').click();

    expect(await screen.findByText('mode:modal')).toBeInTheDocument();
  });

  it('reverts to the last-fetched registry on clearPreview()', async () => {
    fetchSettings.mockResolvedValue([setting('ui.editPanelMode', 'drawer')]);

    render(
      <SettingsProvider>
        <PreviewConsumer />
      </SettingsProvider>,
    );

    await screen.findByText('mode:drawer');
    screen.getByText('preview modal').click();
    await screen.findByText('mode:modal');

    screen.getByText('revert').click();

    expect(await screen.findByText('mode:drawer')).toBeInTheDocument();
  });

  it('does not cache a still-unsaved preview for the next page load', async () => {
    fetchSettings.mockResolvedValue([setting('theme.accentColor', '#2563eb')]);

    render(
      <SettingsProvider>
        <PreviewConsumer />
      </SettingsProvider>,
    );

    await screen.findByText('mode:drawer');
    localStorage.removeItem('admin.appearance');

    screen.getByText('preview modal').click();
    await screen.findByText('mode:modal');

    expect(localStorage.getItem('admin.appearance')).toBeNull();
  });
});
