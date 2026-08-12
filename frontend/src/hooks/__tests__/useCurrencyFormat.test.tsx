import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { SettingsProvider, useAppSettings } from '@/components/providers/settings-provider';
import { useCurrencyFormat } from '../useCurrencyFormat';
import type { Setting } from '@/lib/settings-api';

const fetchSettings = vi.hoisted(() => vi.fn());

vi.mock('@/lib/settings-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/settings-api')>();
  return { ...actual, fetchSettings };
});

function setting(key: string, value: string): Setting {
  return { key, label: key, type: 'string', value, isDefault: false, updatedAt: null };
}

beforeEach(() => {
  fetchSettings.mockReset();
});

/**
 * `useCurrencyFormat` — the one place the shared `'currency'` FORMAT (shape:
 * grouping, decimal places, numbering system) meets the live `store.currency`
 * setting (the CODE). The property that matters most: the format shape
 * itself must come from the same `i18n/formats.ts` definition every other
 * formatted number in the app uses, not a second hand-typed copy that could
 * drift — pinned here by asserting Western Arabic numerals under the Arabic
 * locale too, the same guarantee `FORMATS.number.currency.numberingSystem:
 * 'latn'` makes everywhere else.
 */

function Consumer({ value }: { value: number }) {
  const formatCurrency = useCurrencyFormat();
  return <p>{formatCurrency(value)}</p>;
}

describe('without a SettingsProvider', () => {
  it('falls back to AED — the context default, not a crash', () => {
    render(<Consumer value={19.99} />);

    expect(screen.getByText(/AED/)).toBeInTheDocument();
  });
});

describe('with a live store.currency', () => {
  it('formats in the store currency, not the hardcoded default', async () => {
    fetchSettings.mockResolvedValue([setting('store.currency', 'SAR')]);

    render(
      <SettingsProvider>
        <Consumer value={19.99} />
      </SettingsProvider>,
    );

    expect(await screen.findByText(/SAR/)).toBeInTheDocument();
    // The old hardcoded default must genuinely be gone, not just SAR
    // appearing ALONGSIDE it.
    expect(screen.queryByText(/AED/)).not.toBeInTheDocument();
  });

  it('reflects a changed currency after refresh() re-fetches the registry, without remounting', async () => {
    // Same SettingsProvider instance throughout — proves the hook reads
    // LIVE context state on every render, not a value captured once at
    // mount, the same guarantee every other consumer (tablePageSize,
    // editPanelMode, ...) already depends on. Reassigning the resolved
    // value mid-test (rather than queuing two `mockResolvedValueOnce`
    // calls up front) keeps the mock's return tied to when `fetchSettings`
    // is ACTUALLY called, not to call order assumed in advance.
    fetchSettings.mockResolvedValue([setting('store.currency', 'SAR')]);

    function ConsumerWithRefreshButton() {
      const { refresh } = useAppSettings();
      return (
        <>
          <Consumer value={19.99} />
          <button
            onClick={() => {
              fetchSettings.mockResolvedValue([setting('store.currency', 'USD')]);
              void refresh();
            }}
          >
            refresh
          </button>
        </>
      );
    }

    render(
      <SettingsProvider>
        <ConsumerWithRefreshButton />
      </SettingsProvider>,
    );

    expect(await screen.findByText(/SAR/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));

    // USD has a recognised symbol in ICU, so it renders as "$19.99" rather
    // than the literal text "USD" — confirmed directly against
    // Intl.NumberFormat before relying on it here, since SAR/AED render as
    // their 3-letter code but USD does not.
    expect(await screen.findByText('$19.99')).toBeInTheDocument();
    expect(screen.queryByText(/SAR/)).not.toBeInTheDocument();
  });
});

describe('Arabic locale', () => {
  it('renders the currency amount with Western Arabic numerals, matching every other formatted number', () => {
    render(<Consumer value={1234.5} />, { locale: 'ar' });

    // Same rule as formats.ts's own numberingSystem: 'latn' — Eastern
    // Arabic-Indic digits (١٬٢٣٤) would mean this hook built its OWN format
    // shape instead of reusing the shared one.
    expect(screen.getByText(/1,234\.50/)).toBeInTheDocument();
  });
});
