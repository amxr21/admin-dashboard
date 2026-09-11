import { Prisma } from '@prisma/client';

import { AppError } from '../errors/AppError.js';
import { getSettingValue } from './settings.service.js';

/**
 * Accepting a currency other than the store's own at the till.
 *
 * ─── WHAT IS STORED, AND IN WHICH CURRENCY ───────────────────────────
 * `Payment.amount` stays in the STORE currency, always. Every existing
 * revenue, shift and report query sums that column, and letting a foreign
 * amount into it would silently add dirhams to dollars — so multi-currency
 * needed no change to any of them. `tenderAmount`/`tenderCurrency` record what
 * the customer actually handed over, and `tenderRate` snapshots the rate used.
 *
 * ─── WHY THE RATE IS SNAPSHOTTED, NOT LOOKED UP ──────────────────────
 * The receipt prints the rate. Re-deriving it from the configured value later
 * would make a reprinted receipt disagree with the one in the customer's hand
 * the moment an owner edits the setting. Same rule as `OrderItem.cost` and
 * `Order.total`: a figure describing a past event reads a snapshot.
 *
 * ─── CHANGE IS GIVEN IN THE TENDERED CURRENCY ────────────────────────
 * Owner decision. It means a drawer can hold several currencies, which is why
 * shift close counts each one separately rather than converting to a single
 * expected total — a conversion there would make variance indistinguishable
 * from rate movement during the shift.
 */

/** The currencies `store.currency` can be, and therefore the only ones a rate
 *  may be configured for. Mirrors the enum in settings.config.ts. */
export const TENDER_CURRENCIES = ['AED', 'SAR', 'USD', 'EUR', 'GBP'] as const;
export type TenderCurrency = (typeof TENDER_CURRENCIES)[number];

function isTenderCurrency(value: string): value is TenderCurrency {
  return (TENDER_CURRENCIES as readonly string[]).includes(value);
}

export interface AcceptedTender {
  currency: TenderCurrency;
  /** How many of this currency equal one unit of the store currency. The base
   *  currency is always present with a rate of exactly 1. */
  rate: string;
  isBase: boolean;
}

/**
 * Which currencies this till accepts right now.
 *
 * The store currency is always first and always accepted — a shop can never
 * refuse its own money, and it needs no configured rate. Everything else
 * appears only if its rate is above zero, so an install that never touches
 * these settings behaves exactly as it did before they existed.
 */
export async function listAcceptedTenders(): Promise<AcceptedTender[]> {
  const base = await getSettingValue('store.currency');
  const baseCurrency = typeof base === 'string' && isTenderCurrency(base) ? base : 'AED';

  const rates = await Promise.all(
    TENDER_CURRENCIES.map(async (currency) => {
      if (currency === baseCurrency) return { currency, rate: '1', isBase: true };

      const configured = await getSettingValue(`pos.tenderRate.${currency}`);
      const rate = typeof configured === 'number' ? configured : 0;

      return rate > 0 ? { currency, rate: String(rate), isBase: false } : null;
    }),
  );

  return rates.filter((entry): entry is AcceptedTender => entry !== null);
}

/**
 * The rate to apply for a named currency, or null when it IS the store
 * currency (the ordinary case, which needs no conversion and stores no tender
 * columns).
 *
 * Refuses an unaccepted code rather than falling back to the base currency: a
 * silent fallback would record a sale in dirhams that the customer paid in
 * dollars, and nothing downstream could ever detect it.
 */
export async function resolveTenderRate(
  currency: string,
): Promise<{ currency: TenderCurrency; rate: Prisma.Decimal } | null> {
  const accepted = await listAcceptedTenders();
  const match = accepted.find((entry) => entry.currency === currency.toUpperCase());

  if (!match) {
    throw AppError.badRequest('That currency is not accepted at this till', {
      field: 'tenderCurrency',
    });
  }

  return match.isBase ? null : { currency: match.currency, rate: new Prisma.Decimal(match.rate) };
}

