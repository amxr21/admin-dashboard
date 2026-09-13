import type { SetupFeature } from './setup-api';

export type EnabledFeatures = Partial<Record<SetupFeature, boolean>>;
/**
 * ORDER MATTERS. `featureForPath` returns the FIRST prefix that matches, so a
 * more-specific path must precede the prefix it sits under — `/admin/reports/
 * scheduled` before `/admin/reports`, and `/admin/inventory/suppliers` before
 * `/admin/inventory`. Otherwise the suppliers page would resolve to the
 * `inventory` feature and could never be gated on `suppliers`. (This ordering
 * is why the suppliers page lives at its real path here now, rather than the
 * old collision-avoiding `/admin/r/suppliers`, which pointed at no real page.)
 */
const FEATURE_PATHS: [string, SetupFeature][] = [
  ['/admin/reports/scheduled', 'scheduledReports'], ['/admin/settings/organization', 'branches'],
  ['/admin/pos', 'pos'], ['/admin/orders', 'orders'],
  ['/admin/inventory/suppliers', 'suppliers'], ['/admin/inventory', 'inventory'],
  ['/admin/delivery', 'delivery'], ['/admin/returns', 'returns'],
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
