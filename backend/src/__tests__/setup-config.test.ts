import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES } from '../lib/canonical-values.js';
import { SETUP_TEMPLATES, setupDraftSchema, setupTemplate } from '../config/setup.config.js';
import { normalizeFeatures, SETUP_FEATURE_KEYS } from '../config/setup-features.config.js';

describe('setup templates and boundary', () => {
  it('declares one valid template per canonical business type', () => {
    expect(SETUP_TEMPLATES.map(template => template.businessType)).toEqual([...BUSINESS_TYPES]);
    for (const template of SETUP_TEMPLATES) expect(setupDraftSchema.safeParse(template).success).toBe(true);
  });
  it.each(['CAFE', 'BAKERY', 'RESTAURANT'] as const)('%s recommends a till without returns or delivery', type => {
    expect(setupTemplate(type).features).toMatchObject({ pos: true, inventory: true, orders: true, returns: false, delivery: false });
  });
  it('allows the owner to override a template and never preselects permission changes', () => {
    const draft = setupTemplate('CAFE');
    draft.features.delivery = true;
    expect(setupDraftSchema.parse(draft).features.delivery).toBe(true);
    expect(draft.rolePermissions).toEqual({});
  });
  it('resolves dependencies transitively and keeps recovery pages enabled', () => {
    const features = { ...setupTemplate('OTHER').features };
    for (const key of SETUP_FEATURE_KEYS) features[key] = false;
    features.pos = true; features.suppliers = true; features.scheduledReports = true;
    expect(normalizeFeatures(features)).toMatchObject({ dashboard: true, settings: true, orders: true, inventory: true, reports: true });
    expect(features.orders).toBe(false);
  });
  it.each([
    { businessType: 'UNKNOWN' }, { features: { ...setupTemplate('CAFE').features, unknown: true } },
    { labels: { users: 'Team' } }, { defaults: { 'system.maintenanceMode': true } },
    { defaults: { 'store.taxRate': 101 } }, { defaults: { 'store.currency': 'XYZ' } },
    { rolePermissions: { OWNER: [] } }, { rolePermissions: { CASHIER: ['unknown'] } },
    { unexpected: true },
  ])('rejects unsupported input %j', patch => {
    expect(setupDraftSchema.safeParse({ ...setupTemplate('CAFE'), ...patch }).success).toBe(false);
  });
});
