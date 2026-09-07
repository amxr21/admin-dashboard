import { apiFetch } from '@/lib/api';

/**
 * Branches and the resolved brand (F8.5).
 *
 * The `X-Branch-Id` header is attached centrally by `apiFetch`, so nothing
 * here passes a branch explicitly — every call is already scoped to whatever
 * the switcher last selected.
 */

export interface BranchSummary {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  /** False for a warehouse or prep kitchen — holds stock, takes no orders. */
  isSellingPoint: boolean;
  isDefault: boolean;
  businessId: string;
  businessName: string;
}

/**
 * Every branch this person may switch to.
 *
 * An empty list is a real answer, not an error: a user with a global role and
 * no branch assignments has not been placed anywhere in particular, and works
 * unscoped exactly as they did before F8.
 */
export async function fetchBranches(): Promise<BranchSummary[]> {
  return apiFetch<BranchSummary[]>('/branches');
}

export interface BranchDetail {
  id: string;
  businessId: string;
  name: string;
  code: string | null;
  addressLine: string | null;
  city: string | null;
  phone: string | null;
  timezone: string | null;
  isSellingPoint: boolean;
  isActive: boolean;
  isDefault: boolean;
  business: {
    id: string;
    name: string;
    legalName: string | null;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    addressLine: string | null;
    city: string | null;
    country: string | null;
    currency: string | null;
    timezone: string | null;
    logoUrl: string | null;
  };
}

export async function fetchBranch(id: string): Promise<BranchDetail> {
  return apiFetch<BranchDetail>(`/branches/${id}`);
}

export type BranchUpdate = Partial<{
  name: string;
  code: string | null;
  addressLine: string | null;
  city: string | null;
  phone: string | null;
  timezone: string | null;
  isSellingPoint: boolean;
  isActive: boolean;
}>;

export async function updateBranch(id: string, input: BranchUpdate): Promise<BranchDetail> {
  return apiFetch<BranchDetail>(`/branches/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * The name, address and tax id to PRINT, resolved server-side through
 * branch -> business -> store setting.
 *
 * Deliberately not merged in the client: the fallback chain has one
 * implementation, or the copy that drifts prints a wrong tax id on an invoice
 * without anything failing.
 */
export interface ResolvedBrand {
  storeName: string;
  storeAddress: string;
  storeSupportEmail: string;
  storeSupportPhone: string;
  storeTaxId: string;
  storeLogoUrl: string;
  storeCurrency: string;
}

export async function fetchBrand(): Promise<ResolvedBrand> {
  return apiFetch<ResolvedBrand>('/branches/_brand');
}
