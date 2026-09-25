import { OrderStatus, Prisma, type CampaignChannel } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { getSettingValue } from './settings.service.js';

/**
 * Who a campaign goes to.
 *
 * ─── TWO QUESTIONS, ANSWERED SEPARATELY ─────────────────────────────
 * The FILTER picks customers by what they did (branch, purchases, activity,
 * spend) or by hand. ELIGIBILITY then removes everyone the business may not
 * or cannot message on this channel: no marketing consent, no usable
 * address, or an address on the suppression list. The preview reports both
 * numbers and why the difference exists, so "why only 40 of 300?" has an
 * answer on screen.
 */

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

export const audienceSchema = z
  .object({
    /** `manual` sends to `customerIds` only; `filter` applies everything else. */
    mode: z.enum(['filter', 'manual']),
    branchId: z.string().min(1).max(64).optional(),
    productIds: z.array(z.string().min(1)).max(200).optional(),
    categoryIds: z.array(z.string().min(1)).max(200).optional(),
    /** No order in the last N days (but at least one order ever). */
    inactiveDays: z.number().int().min(1).max(3650).optional(),
    /** `new`: at most one order. `returning`: two or more. */
    customerType: z.enum(['new', 'returning']).optional(),
    minSpend: z.string().regex(MONEY).optional(),
    maxSpend: z.string().regex(MONEY).optional(),
    customerIds: z.array(z.string().min(1)).max(5000).optional(),
  })
  .strict()
  .refine((audience) => audience.mode !== 'manual' || (audience.customerIds?.length ?? 0) > 0, {
    message: 'Choose at least one customer',
    path: ['customerIds'],
  });

export type Audience = z.infer<typeof audienceSchema>;

/** Orders that count as a customer's activity and spend. */
const COUNTED = { status: { not: OrderStatus.CANCELED } } satisfies Prisma.OrderWhereInput;

async function customersMatching(audience: Audience): Promise<Prisma.CustomerWhereInput> {
  if (audience.mode === 'manual') return { id: { in: audience.customerIds ?? [] } };

  const and: Prisma.CustomerWhereInput[] = [];

  if (audience.branchId) and.push({ orders: { some: { ...COUNTED, branchId: audience.branchId } } });

  if (audience.productIds?.length) {
    and.push({ orders: { some: { ...COUNTED, items: { some: { productId: { in: audience.productIds } } } } } });
  }
  if (audience.categoryIds?.length) {
    and.push({
      orders: { some: { ...COUNTED, items: { some: { product: { categoryId: { in: audience.categoryIds } } } } } },
    });
  }

  if (audience.inactiveDays) {
    const cutoff = new Date(Date.now() - audience.inactiveDays * 24 * 60 * 60 * 1000);
    and.push({ orders: { some: COUNTED, none: { ...COUNTED, placedAt: { gte: cutoff } } } });
  }

  // Order counts and lifetime spend are aggregates — resolved to an id list.
  if (audience.customerType || audience.minSpend || audience.maxSpend) {
    const groups = await prisma.order.groupBy({
      by: ['customerId'],
      where: { ...COUNTED, customerId: { not: null } },
      _count: { _all: true },
      _sum: { total: true },
    });
    const min = audience.minSpend ? new Prisma.Decimal(audience.minSpend) : null;
    const max = audience.maxSpend ? new Prisma.Decimal(audience.maxSpend) : null;

    const ids = groups
      .filter((group) => {
        const count = group._count._all;
        const spend = group._sum.total ?? new Prisma.Decimal(0);
        if (audience.customerType === 'returning' && count < 2) return false;
        if (min && spend.lt(min)) return false;
        if (max && spend.gt(max)) return false;
        return true;
      })
      .map((group) => group.customerId as string);

    if (audience.customerType === 'new') {
      // At most one order — which includes customers with none at all.
      const repeat = groups.filter((group) => group._count._all >= 2).map((group) => group.customerId as string);
      and.push({ id: { notIn: repeat } });
      if (min || max) and.push({ id: { in: ids } });
    } else {
      and.push({ id: { in: ids } });
    }
  }

  return and.length > 0 ? { AND: and } : {};
}

/** E.164 from the digits-only phone the customer record keeps. */
export function toE164(digits: string | null, countryCode: string): string | null {
  if (!digits) return null;
  let value = digits;
  if (value.startsWith('00')) value = value.slice(2);
  else if (value.startsWith('0')) value = countryCode + value.slice(1);
  else if (value.length <= 9) value = countryCode + value;
  return /^[1-9]\d{7,14}$/.test(value) ? `+${value}` : null;
}

export function normaliseAddress(channel: CampaignChannel, address: string): string {
  return channel === 'EMAIL' ? address.trim().toLowerCase() : address;
}

export interface AudienceMember {
  customerId: string;
  name: string;
  address: string;
}

export interface AudienceResult {
  matched: number;
  eligible: AudienceMember[];
  excluded: { noConsent: number; noAddress: number; suppressed: number };
}

/** Upper bound on one campaign's audience — a guard, not a business rule. */
const AUDIENCE_LIMIT = 50_000;

export async function resolveAudience(channel: CampaignChannel, audience: Audience): Promise<AudienceResult> {
  const where = await customersMatching(audience);
  const countryCode = String(await getSettingValue('campaigns.defaultCountryCode')).replace(/\D/g, '') || '971';

  const customers = await prisma.customer.findMany({
    where,
    take: AUDIENCE_LIMIT,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNormalized: true,
      emailMarketingConsent: true,
      smsMarketingConsent: true,
    },
  });

  const suppressed = new Set(
    (await prisma.marketingSuppression.findMany({ where: { channel }, select: { address: true } })).map(
      (row) => row.address,
    ),
  );

  const excluded = { noConsent: 0, noAddress: 0, suppressed: 0 };
  const eligible: AudienceMember[] = [];

  for (const customer of customers) {
    const consent = channel === 'EMAIL' ? customer.emailMarketingConsent : customer.smsMarketingConsent;
    if (!consent) {
      excluded.noConsent += 1;
      continue;
    }

    const raw = channel === 'EMAIL' ? customer.email : toE164(customer.phoneNormalized, countryCode);
    if (!raw) {
      excluded.noAddress += 1;
      continue;
    }

    const address = normaliseAddress(channel, raw);
    if (suppressed.has(address)) {
      excluded.suppressed += 1;
      continue;
    }

    eligible.push({ customerId: customer.id, name: customer.name, address });
  }

  return { matched: customers.length, eligible, excluded };
}
