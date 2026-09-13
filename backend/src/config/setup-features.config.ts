import type { Area } from './roles.js';

export const SETUP_FEATURE_KEYS = ['dashboard', 'pos', 'orders', 'inventory', 'suppliers', 'delivery', 'returns', 'reports', 'scheduledReports', 'customerCases', 'staff', 'branches', 'settings'] as const;
export type SetupFeature = (typeof SETUP_FEATURE_KEYS)[number];
export interface SetupFeatureDefinition {
  key: SetupFeature;
  area?: Area;
  canDisable: boolean;
  dependsOn: readonly SetupFeature[];
  routes: readonly string[];
  dataCheck?: 'order' | 'stockMovement' | 'supplier' | 'deliveryAssignment' | 'return' | 'scheduledReport' | 'customerCase' | 'user' | 'branch';
}

/** Visibility only. The existing permission middleware remains authoritative. */
export const SETUP_FEATURES: readonly SetupFeatureDefinition[] = [
  { key: 'dashboard', canDisable: false, dependsOn: [], routes: ['/admin'] },
  { key: 'pos', area: 'orders', canDisable: true, dependsOn: ['orders', 'inventory'], routes: ['/admin/pos'], dataCheck: 'order' },
  { key: 'orders', area: 'orders', canDisable: true, dependsOn: [], routes: ['/admin/orders'], dataCheck: 'order' },
  { key: 'inventory', area: 'inventory', canDisable: true, dependsOn: [], routes: ['/admin/inventory'], dataCheck: 'stockMovement' },
  { key: 'suppliers', area: 'inventory', canDisable: true, dependsOn: ['inventory'], routes: ['/admin/r/suppliers'], dataCheck: 'supplier' },
  { key: 'delivery', area: 'delivery', canDisable: true, dependsOn: ['orders'], routes: ['/admin/delivery'], dataCheck: 'deliveryAssignment' },
  { key: 'returns', area: 'returns', canDisable: true, dependsOn: ['orders'], routes: ['/admin/returns'], dataCheck: 'return' },
  { key: 'reports', area: 'reports', canDisable: true, dependsOn: [], routes: ['/admin/reports'] },
  { key: 'scheduledReports', area: 'reports', canDisable: true, dependsOn: ['reports'], routes: ['/admin/reports/scheduled'], dataCheck: 'scheduledReport' },
  { key: 'customerCases', area: 'customers', canDisable: true, dependsOn: ['orders'], routes: ['/admin/customer-cases'], dataCheck: 'customerCase' },
  { key: 'staff', area: 'staff', canDisable: true, dependsOn: [], routes: ['/admin/staff', '/admin/shifts', '/admin/login-history'], dataCheck: 'user' },
  { key: 'branches', area: 'settings', canDisable: true, dependsOn: [], routes: ['/admin/branches', '/admin/settings/organization'], dataCheck: 'branch' },
  { key: 'settings', area: 'settings', canDisable: false, dependsOn: [], routes: ['/admin/settings'] },
];

export function normalizeFeatures(input: Record<SetupFeature, boolean>): Record<SetupFeature, boolean> {
  const result = { ...input };
  for (const feature of SETUP_FEATURES) if (!feature.canDisable) result[feature.key] = true;
  // Fixed point supports transitive dependencies without relying on registry order.
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of SETUP_FEATURES) {
      if (!result[feature.key]) continue;
      for (const dependency of feature.dependsOn) {
        if (!result[dependency]) { result[dependency] = true; changed = true; }
      }
    }
  }
  return result;
}
