import { apiFetch } from '@/lib/api';

export interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  note: string | null;
  isActive: boolean;
  receiptCount: number;
  productCount: number;
  lastReceivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
  note?: string | null;
  isActive?: boolean;
}

export async function fetchSuppliers(params: {
  page?: number; pageSize?: number; search?: string; active?: boolean;
} = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return apiFetch<{ suppliers: Supplier[]; total: number; page: number; pageSize: number; totalPages: number }>(`/suppliers?${query}`);
}

export async function createSupplier(input: SupplierInput) {
  return apiFetch<Supplier>('/suppliers', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateSupplier(id: string, input: Partial<SupplierInput>) {
  return apiFetch<Supplier>(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export interface ProductSupplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  isActive: boolean;
  lastReceivedAt: string;
}

export async function fetchProductSuppliers(productId: string) {
  return apiFetch<{ product: { id: string; name: string }; suppliers: ProductSupplier[] }>(`/inventory/${productId}/suppliers`);
}

export async function sendSupplierOutreach(productId: string, input: { supplierId: string; subject: string; message: string }) {
  return apiFetch<{ sent: true; supplier: { id: string; name: string; email: string } }>(`/inventory/${productId}/supplier-outreach`, {
    method: 'POST', body: JSON.stringify(input),
  });
}
