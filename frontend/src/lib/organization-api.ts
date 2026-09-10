import { apiFetch } from '@/lib/api';

export type OrganizationEntity = 'business' | 'branch' | 'staff';
export type CustomValue = string | number | boolean | null;
export interface OrganizationField {
  id: string;
  entityType: OrganizationEntity;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean';
  required: boolean;
  isActive: boolean;
}
export interface OrganizationProfile {
  entityType: OrganizationEntity;
  entityId: string;
  values: Record<string, CustomValue>;
  jobTitle: string | null;
  department: string | null;
  managerId: string | null;
}
export interface OrganizationData {
  fields: OrganizationField[];
  entities: Record<OrganizationEntity, { id: string; name: string; isActive: boolean }[]>;
  staffProfiles: Pick<OrganizationProfile, 'entityId' | 'jobTitle' | 'department' | 'managerId'>[];
}
export const fetchOrganization = () => apiFetch<OrganizationData>('/organization');
export const fetchOrganizationProfile = (type: OrganizationEntity, id: string) =>
  apiFetch<OrganizationProfile>(`/organization/profiles/${type}/${encodeURIComponent(id)}`);
export const saveOrganizationProfile = (profile: OrganizationProfile) =>
  apiFetch<OrganizationProfile>(`/organization/profiles/${profile.entityType}/${encodeURIComponent(profile.entityId)}`, {
    method: 'PUT', body: JSON.stringify({ values: profile.values, jobTitle: profile.jobTitle, department: profile.department, managerId: profile.managerId }),
  });
export const createOrganizationField = (field: Omit<OrganizationField, 'id' | 'isActive'>) =>
  apiFetch<OrganizationField>('/organization/fields', { method: 'POST', body: JSON.stringify(field) });
export const updateOrganizationField = (id: string, field: Pick<OrganizationField, 'label' | 'required' | 'isActive'>) =>
  apiFetch<OrganizationField>(`/organization/fields/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(field) });
