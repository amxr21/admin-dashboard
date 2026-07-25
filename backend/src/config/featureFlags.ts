import { env } from './env.js';

/**
 * Simple feature-flag skeleton.
 *
 * Goals for v1:
 *  - Ship features behind a flag → deploy without releasing
 *  - Enable/disable per-environment without a code deploy
 *  - Optional per-user targeting for gradual rollout
 *
 * NOT in v1 (add when you outgrow this):
 *  - Runtime updates without redeploy → LaunchDarkly / ConfigCat / Unleash
 *  - Percentage rollouts → LaunchDarkly / Unleash
 *  - A/B experiments → LaunchDarkly / Statsig / GrowthBook
 *
 * Rule: delete a flag from this file once it's fully rolled out. Dead flags rot.
 */

type FlagRule =
  | { enabled: boolean }                      // simple on/off for the whole env
  | { enabledForUserIds: string[] };          // enabled only for these user IDs

type Flags = Record<string, FlagRule>;

// ─── Flags per environment ────────────────────────────────────────
// These are placeholders showing both rule shapes. Replace with real flags;
// an empty object is a perfectly good starting point.
const FLAGS_BY_ENV: Record<string, Flags> = {
  development: {
    // Devs get everything enabled by default in local.
    exampleNewFlow: { enabled: true },
  },
  preview: {
    exampleNewFlow: { enabled: true },
  },
  production: {
    exampleNewFlow: { enabled: false },
  },
};

/**
 * Check if a flag is enabled for the current context.
 *
 * @example
 *   if (isEnabled('exampleNewFlow', { userId: req.user.id })) {
 *     return newHandler(req, res);
 *   }
 *   return legacyHandler(req, res);
 */
export function isEnabled(
  flagName: string,
  context: { userId?: string } = {},
): boolean {
  const flags = FLAGS_BY_ENV[env.NODE_ENV] ?? {};
  const rule = flags[flagName];

  if (!rule) return false; // unknown flag → default off (safe)
  if ('enabled' in rule) return rule.enabled;
  if ('enabledForUserIds' in rule) {
    return context.userId ? rule.enabledForUserIds.includes(context.userId) : false;
  }
  return false;
}
