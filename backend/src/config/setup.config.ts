import { z } from 'zod';
import { BUSINESS_TYPES, type BusinessType } from '../lib/canonical-values.js';
import { AREAS } from './roles.js';
import { SETTINGS, validateSetting } from './settings.config.js';
import { normalizeFeatures, SETUP_FEATURE_KEYS, type SetupFeature } from './setup-features.config.js';

export const SETUP_LABEL_KEYS = ['products', 'orders', 'staff', 'inventory', 'delivery', 'returns', 'reports'] as const;
export const SETUP_DEFAULT_KEYS = ['products.defaultHasVariants', 'products.defaultHasColors', 'products.defaultHasBarcode', 'store.currency', 'store.taxRate', 'returns.windowDays', 'inventory.lowStockThreshold', 'pos.maxCashierDiscountPercent', 'pos.tenderRate.AED', 'pos.tenderRate.SAR', 'pos.tenderRate.USD', 'pos.tenderRate.EUR', 'pos.tenderRate.GBP'] as const;
export const EDITABLE_SETUP_ROLES = ['MANAGER', 'FULFILLMENT', 'CASHIER', 'SUPPORT', 'DEMO'] as const;
export const setupDraftSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES),
  features: z.record(z.enum(SETUP_FEATURE_KEYS), z.boolean()),
  labels: z.partialRecord(z.enum(SETUP_LABEL_KEYS), z.string().trim().max(40)),
  defaults: z.partialRecord(z.enum(SETUP_DEFAULT_KEYS), z.union([z.string(), z.number(), z.boolean()])),
  // Only explicitly edited roles are sent. Templates never grant/revoke access.
  rolePermissions: z.partialRecord(z.enum(EDITABLE_SETUP_ROLES), z.array(z.enum(AREAS)).max(AREAS.length)).default({}),
}).strict().superRefine((draft, ctx) => {
  for (const key of SETUP_DEFAULT_KEYS) {
    if (draft.defaults[key] === undefined) continue;
    const result = validateSetting(key, draft.defaults[key]);
    if (!result.ok) ctx.addIssue({ code: 'custom', path: ['defaults', key], message: result.message });
  }
});
export type SetupDraft = z.infer<typeof setupDraftSchema>;

export function setupTemplate(businessType: BusinessType): SetupDraft {
  const food = ['CAFE', 'BAKERY', 'RESTAURANT', 'FOOD_TRUCK'].includes(businessType);
  const service = ['SALON', 'SPA', 'BARBERSHOP', 'GYM', 'LAUNDRY'].includes(businessType);
  const retail = !food && !service;
  const features = Object.fromEntries(SETUP_FEATURE_KEYS.map(key => [key, true])) as Record<SetupFeature, boolean>;
  Object.assign(features, {
    pos: businessType !== 'LAUNDRY', delivery: false, scheduledReports: false,
    returns: retail, customerCases: ['ELECTRONICS', 'LAUNDRY', 'OTHER'].includes(businessType),
    suppliers: !service, inventory: businessType !== 'LAUNDRY',
  });
  return {
    businessType, features: normalizeFeatures(features),
    labels: {}, // Display recommendations are localized by the client before review.
    defaults: {
      'products.defaultHasVariants': ['CAFE', 'RESTAURANT', 'CLOTHING'].includes(businessType),
      'products.defaultHasColors': businessType === 'CLOTHING',
      'products.defaultHasBarcode': retail,
    },
    rolePermissions: {},
  };
}
export const SETUP_TEMPLATES = BUSINESS_TYPES.map(setupTemplate);
export const SETUP_DEFAULT_DEFINITIONS = SETUP_DEFAULT_KEYS.map(key => ({ key, ...SETTINGS[key] }));
