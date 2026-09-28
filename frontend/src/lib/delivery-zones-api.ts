import { apiFetch } from '@/lib/api';

export interface DeliveryZoneInput {
  code: string;
  name: string;
  fee: string;
  freeDeliveryThreshold: string | null;
  isActive: boolean;
  sortOrder: number;
}
export interface DeliveryZone extends DeliveryZoneInput {
  id: string;
}

export function fetchDeliveryZones(): Promise<DeliveryZone[]> {
  return apiFetch<DeliveryZone[]>('/settings/delivery-zones');
}
export function saveDeliveryZone(input: DeliveryZoneInput, id?: string): Promise<DeliveryZone> {
  return apiFetch<DeliveryZone>(
    id ? `/settings/delivery-zones/${encodeURIComponent(id)}` : '/settings/delivery-zones',
    {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(input),
    },
  );
}

/** Pad decimal text without passing money through floating point. */
export function normalizeDeliveryAmount(value: string): string | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`;
}
