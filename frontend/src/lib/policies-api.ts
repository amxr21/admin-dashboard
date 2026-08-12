import { apiFetch } from '@/lib/api';
import type { Locale } from '@/i18n/routing';

/** Client for `/api/v1/policies` (B3.5). */

export type PolicyType = 'RETURN' | 'PRIVACY' | 'TERMS' | 'SHIPPING';

export const POLICY_TYPES: PolicyType[] = ['RETURN', 'PRIVACY', 'TERMS', 'SHIPPING'];

export interface PolicySummary {
  type: PolicyType;
  locale: Locale;
  /** Null when nothing has ever been published for this (type, locale). */
  version: number | null;
  content: string | null;
  updatedAt: string | null;
}

export interface PolicyVersion {
  id: string;
  type: PolicyType;
  locale: Locale;
  version: number;
  content: string;
  createdById: string | null;
  createdAt: string;
}

export async function fetchPolicies(): Promise<PolicySummary[]> {
  return apiFetch<PolicySummary[]>('/policies');
}

export async function fetchPolicyVersions(
  type: PolicyType,
  locale: Locale,
): Promise<PolicyVersion[]> {
  return apiFetch<PolicyVersion[]>(`/policies/${type}/${locale}/versions`);
}

/** Publishes new text as the next version — never overwrites, always appends. */
export async function publishPolicy(
  type: PolicyType,
  locale: Locale,
  content: string,
): Promise<PolicyVersion> {
  return apiFetch<PolicyVersion>(`/policies/${type}/${locale}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

/** Republishes an older version's content as a brand new version. */
export async function revertPolicy(
  type: PolicyType,
  locale: Locale,
  versionId: string,
): Promise<PolicyVersion> {
  return apiFetch<PolicyVersion>(`/policies/${type}/${locale}/revert`, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });
}
