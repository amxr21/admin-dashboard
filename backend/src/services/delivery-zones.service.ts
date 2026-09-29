import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { taxInside, type TaxPolicy } from './order-math.service.js';

export interface DeliveryZoneInput {
  code: string;
  name: string;
  fee: string;
  freeDeliveryThreshold: string | null;
  isActive: boolean;
  sortOrder: number;
}

function zoneView(zone: {
  id: string;
  code: string;
  name: string;
  fee: Prisma.Decimal;
  freeDeliveryThreshold: Prisma.Decimal | null;
  isActive: boolean;
  sortOrder: number;
}) {
  return {
    ...zone,
    fee: zone.fee.toFixed(2),
    freeDeliveryThreshold: zone.freeDeliveryThreshold?.toFixed(2) ?? null,
  };
}

export async function listDeliveryZones(publicOnly = false) {
  if (publicOnly) {
    const enabled = await prisma.setting.findUnique({
      where: { key: 'store.deliveryZonesEnabled' },
      select: { value: true },
    });
    if (enabled?.value !== true) return [];
  }
  const zones = await prisma.deliveryZone.findMany({
    where: publicOnly ? { isActive: true } : {},
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return zones.map(zoneView);
}

export async function saveDeliveryZone(input: DeliveryZoneInput, id?: string) {
  const data = {
    ...input,
    fee: new Prisma.Decimal(input.fee),
    freeDeliveryThreshold:
      input.freeDeliveryThreshold === null ? null : new Prisma.Decimal(input.freeDeliveryThreshold),
  };
  try {
    if (id && !(await prisma.deliveryZone.findUnique({ where: { id }, select: { id: true } })))
      throw AppError.notFound('Delivery area not found');
    return zoneView(
      id
        ? await prisma.deliveryZone.update({ where: { id }, data })
        : await prisma.deliveryZone.create({ data }),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw AppError.conflict('A delivery area already uses that code');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
      throw AppError.notFound('Delivery area not found');
    throw error;
  }
}

/** Fees follow the store's price tax basis. Pickup and existing clients remain free. */
export async function priceDelivery(
  tx: Prisma.TransactionClient,
  fulfillment: string | undefined,
  zoneId: string | undefined,
  discountedSubtotal: Prisma.Decimal,
  tax: TaxPolicy,
) {
  const zero = new Prisma.Decimal(0);
  const empty = { fee: zero, taxAmount: zero, total: zero, zoneId: null, zoneName: null };
  if (fulfillment !== 'Delivery') return empty;
  const enabled = await tx.setting.findUnique({
    where: { key: 'store.deliveryZonesEnabled' },
    select: { value: true },
  });
  if (enabled?.value !== true) return empty;
  if (!zoneId) throw AppError.badRequest('Choose a delivery area', { field: 'deliveryZoneId' });
  const zone = await tx.deliveryZone.findFirst({ where: { id: zoneId, isActive: true } });
  if (!zone)
    throw AppError.badRequest('That delivery area is not available', { field: 'deliveryZoneId' });
  const fee =
    zone.freeDeliveryThreshold !== null && discountedSubtotal.gte(zone.freeDeliveryThreshold)
      ? zero
      : zone.fee;
  const taxAmount = tax.pricesIncludeTax
    ? taxInside(fee, tax.rate)
    : fee.times(tax.rate).toDecimalPlaces(2);
  return {
    fee,
    taxAmount,
    total: tax.pricesIncludeTax ? fee : fee.plus(taxAmount),
    zoneId: zone.id,
    zoneName: zone.name,
  };
}
