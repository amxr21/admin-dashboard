import { apiFetch } from '@/lib/api';

/** Client for `/api/v1/danger-zone/demo-data` (B3.4). */

export interface DemoDataSummary {
  orders: number;
  products: number;
  customers: number;
  couriers: number;
  categories: number;
  discounts: number;
  notifications: number;
  // F8: the seeder now creates these too, and the API counts them. Listed
  // even though only `total` is rendered today — a type that under-describes
  // the response is how a later consumer reads a field that is silently
  // always undefined.
  businesses: number;
  branches: number;
  staff: number;
  returns: number;
  variants: number;
  total: number;
}

/** What a delete WOULD remove — powers the confirmation dialog's copy before anything is touched. */
export async function fetchDemoDataSummary(): Promise<DemoDataSummary> {
  return apiFetch<DemoDataSummary>('/danger-zone/demo-data');
}

export async function deleteDemoData(): Promise<DemoDataSummary> {
  return apiFetch<DemoDataSummary>('/danger-zone/demo-data', { method: 'DELETE' });
}
