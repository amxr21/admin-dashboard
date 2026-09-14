/**
 * Decides whether a database is THE designated demo deployment.
 *
 * ─── WHY AN ALLOWLIST AND NOT A DENYLIST ─────────────────────────────
 * The previous guard listed two known-bad database names (`default`,
 * `defaultdb`) and let everything else through. Two things went wrong with
 * that shape, and both are recorded rather than theoretical:
 *
 *   1. On 2026-09-09 the list was commented out on the server's checked-out
 *      copy and the demo dataset was written into the real production
 *      database (see TODO.md, "PRODUCTION DB CONTAINS DEMO DATA"). A denylist
 *      is one edit away from allowing everything, and that edit looks small.
 *   2. A denylist cannot know about a database it has never been told about.
 *      A second customer, a restored snapshot under a new name, a renamed
 *      Coolify volume — each is permitted by default, which is the wrong
 *      default for a script that writes 140 fake orders.
 *
 * So the question is inverted. The operator must NAME the demo target, and
 * anything not matching that name is refused. An unset variable seeds nothing
 * anywhere: the failure mode of a forgotten config is a refusal, not a
 * populated production catalogue.
 *
 * ─── WHY `DEMO_DEPLOYMENT=1` IS NO LONGER ENOUGH ─────────────────────
 * It used to be a blanket unlock for `NODE_ENV=production` that named no
 * database at all, so a copied environment carrying a stale `=1` unlocked
 * whatever host it happened to land on. The flag now only states intent; the
 * NAME states the target, and both must agree. Intent without a target is a
 * refusal.
 *
 * This module is deliberately free of Prisma and of any database connection so
 * the decision can be tested directly. `demo-seed.ts` opens a client at import
 * time, which is exactly why the check does not live there any more.
 */

/**
 * Databases that are known to hold live data and can never be a demo target.
 *
 * Checked AFTER the allowlist and independently of it, so naming one of these
 * as `DEMO_DEPLOYMENT_DATABASE` does not unlock it — an operator who genuinely
 * believes production is the demo box has made a mistake this should catch,
 * not a preference this should honour.
 *
 * `default` is the Coolify MySQL database and IS production for this app
 * (owner, 2026-09-05: there is no separate dev database). `defaultdb` was
 * Aiven's shared database holding another project's live tables; Aiven is gone
 * but a copied `.env` is precisely the accident this guards against.
 */
export const FORBIDDEN_DATABASES: readonly string[] = ['defaultdb', 'default'];

export interface DemoTarget {
  /** Database name parsed from the connection string. */
  database: string;
  /** Hostname parsed from the connection string, when it has one. */
  host: string | undefined;
}

/**
 * Parses the target out of a connection string.
 *
 * Uses WHATWG `URL` rather than a regex because this project's own passwords
 * contain `@`, which hand-rolled splitting gets wrong — the same reasoning as
 * `app-mode.ts`'s `databaseHost`. Returns `undefined` when the shape is
 * unrecognised so the caller refuses on "cannot tell" instead of guessing.
 */
export function parseDemoTarget(url: string | undefined): DemoTarget | undefined {
  if (!url?.trim()) return undefined;

  try {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

    if (!database) return undefined;

    return { database, host: parsed.hostname || undefined };
  } catch {
    return undefined;
  }
}

/**
 * Throws unless `url` names the deployment the operator designated for demo
 * data. Returns the resolved target so the caller can print it.
 *
 * Every refusal names the variable to set and the value it saw, because the
 * person hitting this is usually in the wrong terminal and needs to know which
 * one they are actually in.
 */
export function assertDesignatedDemoDeployment(
  variables: NodeJS.ProcessEnv = process.env,
): DemoTarget {
  const target = parseDemoTarget(variables.DATABASE_URL);

  if (!target) {
    throw new Error(
      'Could not determine the target database from DATABASE_URL. ' +
        'Run demo seeding through `pnpm --filter ./backend demo:seed`, which resolves ' +
        'DATABASE_URL from APP_MODE.',
    );
  }

  const expectedDatabase = variables.DEMO_DEPLOYMENT_DATABASE?.trim();

  if (!expectedDatabase) {
    throw new Error(
      'Refusing to seed demo data: no demo deployment is designated. ' +
        `This would have written 140 tagged orders into "${target.database}". ` +
        'Set DEMO_DEPLOYMENT_DATABASE to the database name of the deployment that ' +
        'is meant to hold illustration data — there is deliberately no default.',
    );
  }

  if (expectedDatabase !== target.database) {
    throw new Error(
      `Refusing to seed demo data: DATABASE_URL points at "${target.database}", but ` +
        `DEMO_DEPLOYMENT_DATABASE designates "${expectedDatabase}". ` +
        'Point APP_MODE at the demo deployment, or correct the designation — ' +
        'the two must agree before anything is written.',
    );
  }

  /**
   * The host is optional to declare but enforced once declared.
   *
   * A database NAME is not unique across machines: a local `admin_dashboard`
   * and a hosted `admin_dashboard` are different databases with identical
   * names, and the name check alone cannot separate them. An operator who
   * names the host gets that separation; one who does not is trusting
   * `with-db-url.mjs`'s loopback guard, which is a real guard but a coarser
   * one.
   */
  const expectedHost = variables.DEMO_DEPLOYMENT_HOST?.trim();

  if (expectedHost && expectedHost !== target.host) {
    throw new Error(
      `Refusing to seed demo data: DATABASE_URL points at host "${target.host ?? 'unknown'}", ` +
        `but DEMO_DEPLOYMENT_HOST designates "${expectedHost}". ` +
        'A database name is not unique across machines, so both must agree.',
    );
  }

  /**
   * Checked last and independently of everything above: a known-production
   * name is refused even when it has been designated and even when the host
   * matches. Naming production as the demo box is the mistake, not the
   * instruction.
   */
  if (FORBIDDEN_DATABASES.includes(target.database)) {
    throw new Error(
      `Refusing to seed: \`${target.database}\` holds live data, not demo data. ` +
        'This database is production for this app and cannot be designated as a ' +
        'demo deployment. Create a separate database for the illustration.',
    );
  }

  /**
   * `NODE_ENV=production` on a correctly designated demo deployment is
   * legitimate and expected — a public demo instance runs a production build.
   * It stays an explicit second acknowledgement rather than being implied by
   * the designation, so that a production-mode process needs the operator to
   * have said "yes, this specific one, and yes, in production mode" twice.
   */
  if (variables.NODE_ENV === 'production' && variables.DEMO_DEPLOYMENT !== '1') {
    throw new Error(
      `Refusing to seed demo data with NODE_ENV=production into "${target.database}". ` +
        'The database is designated, but seeding a production-mode process is a ' +
        'separate acknowledgement: set DEMO_DEPLOYMENT=1 if this really is the ' +
        'public demo instance.',
    );
  }

  return target;
}
