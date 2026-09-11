import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listAcceptedTenders, resolveTenderRate } from '../services/tender-currency.service.js';
import { AppError } from '../errors/AppError.js';

/**
 * Accepting a second currency at the till.
 *
 * The properties worth pinning are the REFUSALS. A rate of zero means "not
 * accepted", and an unaccepted code must throw rather than quietly fall back
 * to the store currency — a fallback would record a sale in dirhams that the
 * customer paid in dollars, and no report downstream could detect it.
 *
 * Settings are mocked rather than written: these are pure resolution rules,
 * and a real settings row would make the test depend on whatever the shared
 * database happens to hold.
 */

const getSettingValue = vi.fn();

vi.mock('../services/settings.service.js', () => ({
  getSettingValue: (key: string) => getSettingValue(key) as unknown,
}));

/** A store in AED that also takes USD at 0.27 and nothing else. */
function configure(values: Record<string, string | number>) {
  getSettingValue.mockImplementation((key: string) => Promise.resolve(values[key] ?? 0));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listAcceptedTenders', () => {
  it('returns only the store currency when nothing is configured', async () => {
    // The default state for every existing install: shipping this feature
    // must not make a till start offering currencies nobody set up.
    configure({ 'store.currency': 'AED' });

    const tenders = await listAcceptedTenders();

    expect(tenders).toEqual([{ currency: 'AED', rate: '1', isBase: true }]);
  });

  it('includes a currency once its rate is above zero', async () => {
    configure({ 'store.currency': 'AED', 'pos.tenderRate.USD': 0.27 });

    const tenders = await listAcceptedTenders();

    expect(tenders).toHaveLength(2);
    expect(tenders).toContainEqual({ currency: 'USD', rate: '0.27', isBase: false });
  });

  it('treats a rate of zero as not accepted, not as a free conversion', async () => {
    configure({ 'store.currency': 'AED', 'pos.tenderRate.USD': 0 });

    const tenders = await listAcceptedTenders();

    expect(tenders.map((entry) => entry.currency)).toEqual(['AED']);
  });

  it('always accepts the store currency, even with a rate configured for it', async () => {
    // A shop can never refuse its own money, and its rate is 1 by definition —
    // a stray configured value must not override that.
    configure({ 'store.currency': 'USD', 'pos.tenderRate.USD': 99 });

    const tenders = await listAcceptedTenders();

    expect(tenders).toContainEqual({ currency: 'USD', rate: '1', isBase: true });
  });
});

describe('resolveTenderRate', () => {
  it('returns null for the store currency, so no tender columns are written', async () => {
    configure({ 'store.currency': 'AED' });

    expect(await resolveTenderRate('AED')).toBeNull();
  });

  it('returns the configured rate for an accepted currency', async () => {
    configure({ 'store.currency': 'AED', 'pos.tenderRate.USD': 0.27 });

    const resolved = await resolveTenderRate('USD');

    expect(resolved?.currency).toBe('USD');
    expect(resolved?.rate.toString()).toBe('0.27');
  });

  it('REFUSES an unconfigured currency rather than falling back to the base', async () => {
    configure({ 'store.currency': 'AED' });

    await expect(resolveTenderRate('USD')).rejects.toBeInstanceOf(AppError);
  });

  it('accepts a lowercase code, since a client may send either', async () => {
    configure({ 'store.currency': 'AED', 'pos.tenderRate.USD': 0.27 });

    expect((await resolveTenderRate('usd'))?.currency).toBe('USD');
  });
});
