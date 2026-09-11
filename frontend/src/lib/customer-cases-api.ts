import { apiFetch } from '@/lib/api';

export const CASE_STATUSES = ['OPEN', 'WAITING', 'RESOLVED', 'CLOSED'] as const;
export const CASE_PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'] as const;
export type CustomerCaseStatus = typeof CASE_STATUSES[number];
export type CustomerCasePriority = typeof CASE_PRIORITIES[number];

interface PersonRef { id: string; name: string | null; email: string; }
interface CustomerRef extends PersonRef { name: string; phone: string | null; }
interface OrderRef { id: string; orderNumber: string; status?: string; customerId?: string | null; }

export interface CustomerCaseSummary {
  id: string;
  caseNumber: string;
  title: string;
  status: CustomerCaseStatus;
  priority: CustomerCasePriority;
  branchId: string | null;
  updatedAt: string;
  customer: CustomerRef | null;
  order: OrderRef | null;
  assignedTo: PersonRef | null;
  noteCount: number;
}

export interface CustomerCaseDetail extends CustomerCaseSummary {
  description: string | null;
  createdAt: string;
  resolvedAt: string | null;
  notes: { id: string; body: string; authorId: string; createdAt: string; author: PersonRef | null }[];
}

export interface CustomerCaseListResult {
  cases: CustomerCaseSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  return search.toString();
}

export async function fetchCustomerCases(params: Record<string, string | number | undefined>) {
  return apiFetch<CustomerCaseListResult>(`/customer-cases?${query(params)}`);
}

export async function fetchCustomerCase(id: string) {
  const result = await apiFetch<{ case: CustomerCaseDetail }>(`/customer-cases/${id}`);
  return result.case;
}

export async function createCustomerCase(input: {
  title: string; description?: string; priority: CustomerCasePriority;
  customerId?: string; orderId?: string; assignedToId?: string;
}) {
  const result = await apiFetch<{ case: CustomerCaseDetail }>('/customer-cases', { method: 'POST', body: JSON.stringify(input) });
  return result.case;
}

export async function updateCustomerCase(id: string, input: Partial<{
  title: string; description: string | null; status: CustomerCaseStatus;
  priority: CustomerCasePriority; assignedToId: string | null;
}>) {
  const result = await apiFetch<{ case: CustomerCaseDetail }>(`/customer-cases/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  return result.case;
}

export async function addCustomerCaseNote(id: string, body: string) {
  const result = await apiFetch<{ case: CustomerCaseDetail }>(`/customer-cases/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) });
  return result.case;
}

export interface CaseLinkOptions {
  customers: CustomerRef[];
  orders: OrderRef[];
  assignees: PersonRef[];
}

export async function searchCaseLinkOptions(term: string) {
  return apiFetch<CaseLinkOptions>(`/customer-cases/link-options?q=${encodeURIComponent(term.trim())}`);
}
