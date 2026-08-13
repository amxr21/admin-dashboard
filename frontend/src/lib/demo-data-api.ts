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
  total: number;
}

/** What a delete WOULD remove — powers the confirmation dialog's copy before anything is touched. */
export async function fetchDemoDataSummary(): Promise<DemoDataSummary> {
  return apiFetch<DemoDataSummary>('/danger-zone/demo-data');
}

export async function deleteDemoData(): Promise<DemoDataSummary> {
  return apiFetch<DemoDataSummary>('/danger-zone/demo-data', { method: 'DELETE' });
}
