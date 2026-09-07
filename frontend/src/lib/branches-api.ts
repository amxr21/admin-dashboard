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

/* ─────────────────────────────────────────────────────────────────────
 * WRITES (O7)
 *
 * Everything above this point reads. F8 shipped a switcher over branches that
 * only a migration or the seeder could create; these are the controls that
 * were missing.
 * ───────────────────────────────────────────────────────────────────── */

export interface BusinessSummary {
  id: string;
  name: string;
  kind: string | null;
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
  isActive: boolean;
  branches: {
    id: string;
    name: string;
    code: string | null;
    city: string | null;
    isSellingPoint: boolean;
    isActive: boolean;
    isDefault: boolean;
    /** How many people hold a per-branch role here (F8.4). */
    staffCount: number;
  }[];
}

/** Every business with its branches — the org chart behind /admin/branches. */
export async function fetchBusinesses(): Promise<BusinessSummary[]> {
  return apiFetch<BusinessSummary[]>('/businesses');
}

export type BusinessInput = {
  name: string;
} & Partial<{
  kind: string | null;
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
  isActive: boolean;
}>;

export async function createBusiness(input: BusinessInput): Promise<BusinessSummary> {
  return apiFetch<BusinessSummary>('/businesses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateBusiness(
  id: string,
  input: Partial<BusinessInput>,
): Promise<BusinessSummary> {
  return apiFetch<BusinessSummary>(`/businesses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export type BranchCreateInput = {
  businessId: string;
  name: string;
} & BranchUpdate & { isDefault?: boolean };

export async function createBranch(input: BranchCreateInput): Promise<BranchDetail> {
  return apiFetch<BranchDetail>('/branches', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Who works at a branch.
 *
 * Both roles are returned on purpose: `role` is what they hold HERE, and
 * `globalRole` is what they hold everywhere else. Rendering only the first
 * would make a SUPPORT-globally / MANAGER-here person read as a manager
 * outright, which is exactly the confusion F8.4's replacement rule avoids.
 */
export interface BranchStaffMember {
  userId: string;
  name: string | null;
  email: string;
  isActive: boolean;
  role: string;
  globalRole: string;
  assignedAt: string;
}

export async function fetchBranchStaff(branchId: string): Promise<BranchStaffMember[]> {
  return apiFetch<BranchStaffMember[]>(`/branches/${branchId}/staff`);
}

/** Upserts — re-assigning somebody already here changes their role. */
export async function assignBranchStaff(
  branchId: string,
  userId: string,
  role: string,
): Promise<unknown> {
  return apiFetch(`/branches/${branchId}/staff`, {
    method: 'POST',
    body: JSON.stringify({ userId, role }),
  });
}

/** They keep their global role — this is "no longer placed here". */
export async function removeBranchStaff(branchId: string, userId: string): Promise<void> {
  await apiFetch(`/branches/${branchId}/staff/${userId}`, { method: 'DELETE' });
}
