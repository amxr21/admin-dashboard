import type { SetupFeature } from './setup-api';

export type EnabledFeatures = Partial<Record<SetupFeature, boolean>>;
const FEATURE_PATHS: [string, SetupFeature][] = [
  ['/admin/reports/scheduled', 'scheduledReports'], ['/admin/settings/organization', 'branches'],
  ['/admin/pos', 'pos'], ['/admin/orders', 'orders'], ['/admin/inventory', 'inventory'],
  ['/admin/r/suppliers', 'suppliers'], ['/admin/delivery', 'delivery'], ['/admin/returns', 'returns'],
  ['/admin/reports', 'reports'], ['/admin/customer-cases', 'customerCases'], ['/admin/staff', 'staff'],
  ['/admin/shifts', 'staff'], ['/admin/login-history', 'staff'], ['/admin/branches', 'branches'],
];
export function featureForPath(path: string): SetupFeature | undefined {
  const pathname = path.split(/[?#]/)[0] ?? path;
  return FEATURE_PATHS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
}
export function isSetupPathEnabled(path: string, features: EnabledFeatures = {}): boolean {
  const feature = featureForPath(path);
  return !feature || features[feature] !== false;
}
