import { apiFetch } from '@/lib/api';
import type { Area, StaffRole } from '@/config/areas';
import type { BusinessType } from '@/lib/business-types';
import type { Setting } from '@/lib/settings-api';

// Mirrors backend setup-features.config.ts; contract tests cover the keys/routes.
export const SETUP_FEATURE_KEYS = ['dashboard', 'pos', 'orders', 'inventory', 'suppliers', 'delivery', 'returns', 'reports', 'scheduledReports', 'customerCases', 'staff', 'branches', 'settings'] as const;
export type SetupFeature = (typeof SETUP_FEATURE_KEYS)[number];
export type SetupValue = string | boolean | number;
export interface SetupDraft {
  businessType: BusinessType;
  features: Record<SetupFeature, boolean>;
  labels: Record<string, string>;
  defaults: Record<string, SetupValue>;
  rolePermissions: Partial<Record<StaffRole, Area[]>>;
}
export interface SetupRegistryFeature {
  key: SetupFeature;
  area?: Area;
  canDisable: boolean;
  dependsOn: SetupFeature[];
  routes: string[];
}
export interface SetupState {
  completedAt: string | null;
  skippedAt: string | null;
  current: SetupDraft;
  features: SetupRegistryFeature[];
  templates: SetupDraft[];
  defaultDefinitions: (Pick<Setting, 'key' | 'type' | 'min' | 'max' | 'options'> & { default: SetupValue })[];
  roles: { role: StaffRole; areas: Area[]; isLocked: boolean; isCustomised: boolean }[];
}
export interface SetupPreview {
  normalized: SetupDraft;
  enabledFeatures: SetupFeature[];
  disabledFeatures: SetupFeature[];
  labelChanges: Record<string, string>;
  settingChanges: Record<string, SetupValue>;
  permissionChanges: { role: StaffRole; grant: Area[]; revoke: Area[] }[];
  warnings: { code: 'existingData' | 'dependencyEnabled'; feature: SetupFeature; severity: 'warning' | 'info' }[];
}
export const fetchSetup = () => apiFetch<SetupState>('/setup');
export const previewSetup = (draft: SetupDraft) => apiFetch<SetupPreview>('/setup/preview', { method: 'POST', body: JSON.stringify(draft) });
export const applySetup = (draft: SetupDraft) => apiFetch<SetupPreview>('/setup', { method: 'PUT', body: JSON.stringify(draft) });
export const resetSetup = () => apiFetch<{ reset: boolean }>('/setup/reset', { method: 'POST', body: '{}' });
export const skipSetup = () => apiFetch<{ skippedAt: string }>('/setup/skip', { method: 'POST', body: '{}' });
