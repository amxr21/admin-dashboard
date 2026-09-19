/**
 * Which shape the dashboard's live band takes.
 *
 * ─── WHY THIS IS A PREFERENCE AND NOT A SETTING ──────────────────────
 * An owner watching four tills wants faces and drawers; a finance manager
 * wants six figures and nothing else; someone opening the page between other
 * tasks wants only what is broken. These are the same data answering
 * different questions, so the choice belongs to the PERSON, not the install —
 * it is deliberately not in `Setting`, which is business-wide configuration.
 *
 * ─── WHY localStorage AND NOT THE DATABASE ───────────────────────────
 * Per-user layout has no schema today, and adding a column plus an endpoint
 * to remember a radio button is a poor trade. Stored per browser instead,
 * which is honest about what it is: a convenience that follows the machine.
 * If it later needs to follow the account, `readTemplate`/`writeTemplate` are
 * the only two functions that change.
 */

export const DASHBOARD_TEMPLATES = [
  'combo',
  'tills',
  'figures',
  'roster',
  'triage',
] as const;

export type DashboardTemplate = (typeof DASHBOARD_TEMPLATES)[number];

/** Totals over the tills — answers "how is today going" and "who is doing it"
 *  in that order, which is the question most people open this page with. */
export const DEFAULT_DASHBOARD_TEMPLATE: DashboardTemplate = 'combo';

const STORAGE_KEY = 'dashboard.template';

const KNOWN = new Set<string>(DASHBOARD_TEMPLATES);

export function isDashboardTemplate(value: unknown): value is DashboardTemplate {
  return typeof value === 'string' && KNOWN.has(value);
}

/**
 * The stored choice, or the default.
 *
 * Every access is wrapped: `localStorage` throws in a private window and on a
 * blocked-cookies profile, and reads empty after the viewer clears site data.
 * A dashboard must render in all three cases, so a failure here is never
 * fatal — it just means the default.
 */
export function readTemplate(): DashboardTemplate {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isDashboardTemplate(stored) ? stored : DEFAULT_DASHBOARD_TEMPLATE;
  } catch {
    return DEFAULT_DASHBOARD_TEMPLATE;
  }
}

export function writeTemplate(template: DashboardTemplate): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, template);
  } catch {
    // A preference that cannot be saved is not an error worth surfacing —
    // the page still works, it just forgets the choice on reload.
  }
}
