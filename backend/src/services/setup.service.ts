import type { StaffRole } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { SETTINGS } from '../config/settings.config.js';
import { SETUP_FEATURES, SETUP_FEATURE_KEYS, normalizeFeatures, type SetupFeature } from '../config/setup-features.config.js';
import { SETUP_DEFAULT_KEYS, SETUP_LABEL_KEYS, SETUP_TEMPLATES, SETUP_DEFAULT_DEFINITIONS, type SetupDraft } from '../config/setup.config.js';
import { isBusinessType } from '../lib/canonical-values.js';
import { clearRolePermissionCache, listRolePermissions, resolveAreas, setRoleAreas } from './role-permissions.service.js';

type Value = string | boolean | number;

export async function readSetup() {
  const rows = await prisma.setting.findMany();
  const stored = new Map(rows.map(row => [row.key, row.value]));
  const value = (key: keyof typeof SETTINGS): Value => (stored.get(key) ?? SETTINGS[key].default) as Value;
  const businessType = String(value('setup.businessType'));
  const current: SetupDraft = {
    businessType: isBusinessType(businessType) ? businessType : 'OTHER',
    features: Object.fromEntries(SETUP_FEATURE_KEYS.map(key => [key, value(`features.${key}.enabled`) !== false])) as Record<SetupFeature, boolean>,
    labels: Object.fromEntries(SETUP_LABEL_KEYS.map(key => [key, value(`labels.nav.${key}`)])),
    defaults: Object.fromEntries(SETUP_DEFAULT_KEYS.map(key => [key, value(key)])),
    rolePermissions: {},
  };
  return {
    completedAt: value('setup.completedAt') || null, skippedAt: value('setup.skippedAt') || null,
    current, features: SETUP_FEATURES, templates: SETUP_TEMPLATES,
    defaultDefinitions: SETUP_DEFAULT_DEFINITIONS, roles: await listRolePermissions(),
  };
}

/** Existence probes, not full counts: a warning needs only one surviving record. */
async function hasFeatureData(feature: SetupFeature): Promise<boolean> {
  const select = { id: true } as const;
  switch (feature) {
    case 'pos': case 'orders': return Boolean(await prisma.order.findFirst({ select }));
    case 'inventory': return Boolean(await prisma.stockMovement.findFirst({ select }));
    case 'suppliers': return Boolean(await prisma.supplier.findFirst({ select }));
    case 'delivery': return Boolean(await prisma.deliveryAssignment.findFirst({ select }));
    case 'returns': return Boolean(await prisma.return.findFirst({ select }));
    case 'scheduledReports': return Boolean(await prisma.scheduledReport.findFirst({ select }));
    case 'customerCases': return Boolean(await prisma.customerCase.findFirst({ select }));
    case 'staff': return Boolean(await prisma.user.findFirst({ select }));
    case 'branches': return Boolean(await prisma.branch.findFirst({ select }));
    default: return false;
  }
}

export async function previewSetup(draft: SetupDraft) {
  const features = normalizeFeatures(draft.features);
  const normalized = { ...draft, features };
  const enabledFeatures = SETUP_FEATURE_KEYS.filter(key => features[key]);
  const disabledFeatures = SETUP_FEATURE_KEYS.filter(key => !features[key]);
  const warnings: { code: 'existingData' | 'dependencyEnabled'; feature: SetupFeature; severity: 'warning' | 'info' }[] = [];
  const existing = await Promise.all(disabledFeatures.map(async feature => ({ feature, exists: await hasFeatureData(feature) })));
  for (const entry of existing) if (entry.exists) warnings.push({ code: 'existingData', feature: entry.feature, severity: 'warning' });
  for (const feature of enabledFeatures) if (!draft.features[feature]) warnings.push({ code: 'dependencyEnabled', feature, severity: 'info' });
  const permissionChanges = await Promise.all(Object.entries(draft.rolePermissions).map(async ([key, after]) => {
    const role = key as StaffRole;
    const before = await resolveAreas(role);
    return { role, grant: after.filter(area => !before.includes(area)), revoke: before.filter(area => !after.includes(area)) };
  }));
  return { normalized, enabledFeatures, disabledFeatures, labelChanges: draft.labels, settingChanges: draft.defaults, permissionChanges, warnings };
}

export async function applySetup(draft: SetupDraft, actorId: string) {
  const preview = await previewSetup(draft);
  const completedAt = new Date().toISOString();
  const writes: Record<string, Value> = {
    'setup.businessType': draft.businessType, 'setup.completedAt': completedAt, 'setup.skippedAt': '',
    ...Object.fromEntries(SETUP_FEATURE_KEYS.map(key => [`features.${key}.enabled`, preview.normalized.features[key]])),
    ...Object.fromEntries(Object.entries(draft.labels).map(([key, value]) => [`labels.nav.${key}`, value])),
    ...draft.defaults,
  };
  await prisma.$transaction(async tx => {
    for (const [key, value] of Object.entries(writes)) {
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    for (const [role, areas] of Object.entries(draft.rolePermissions)) {
      await setRoleAreas(role as StaffRole, areas, actorId, tx);
    }
  });
  clearRolePermissionCache();
  return { ...preview, completedAt };
}

/**
 * Puts setup back to "never run": the owner sees the setup prompt (and the
 * first-login redirect) again, as on a new account. The choices already
 * applied — features, defaults, labels — stay exactly as they are; the wizard
 * opens pre-filled with them.
 */
export async function resetSetup() {
  await prisma.setting.deleteMany({ where: { key: { in: ['setup.completedAt', 'setup.skippedAt'] } } });
  return { reset: true };
}

export async function skipSetup() {
  const skippedAt = new Date().toISOString();
  await prisma.setting.upsert({ where: { key: 'setup.skippedAt' }, create: { key: 'setup.skippedAt', value: skippedAt }, update: { value: skippedAt } });
  return { skippedAt };
}
