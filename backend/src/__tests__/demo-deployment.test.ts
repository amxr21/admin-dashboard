import { describe, expect, it } from 'vitest';

import {
  assertDesignatedDemoDeployment,
  parseDemoTarget,
} from '../lib/demo-deployment.js';

/**
 * The guard's job is to refuse everything that is not the one deployment the
 * operator designated. So the accept case is a single test and the refusals
 * are the bulk of the file — each refusal is a way the 2026-09-09 incident
 * (the demo dataset written into the production database) could recur.
 */

const DEMO_URL = 'mysql://user:pass@demo-host:3306/admin_dashboard_demo';

/** The designated-and-agreeing baseline every refusal below perturbs by one field. */
function designated(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: DEMO_URL,
    DEMO_DEPLOYMENT_DATABASE: 'admin_dashboard_demo',
    ...overrides,
  };
}

describe('parseDemoTarget', () => {
  it('reads the database and host, including a password containing @', () => {
    // This project's own passwords contain `@`, which naive string-splitting
    // parses as the host separator and gets wrong.
    expect(parseDemoTarget('mysql://user:p@ss@demo-host:3306/demo_db')).toEqual({
      database: 'demo_db',
      host: 'demo-host',
    });
  });

  it('returns undefined rather than guessing when there is nothing to read', () => {
    expect(parseDemoTarget(undefined)).toBeUndefined();
    expect(parseDemoTarget('   ')).toBeUndefined();
    expect(parseDemoTarget('not-a-url')).toBeUndefined();
    // A URL with no database path is "cannot tell", not "the empty database".
    expect(parseDemoTarget('mysql://user:pass@demo-host:3306/')).toBeUndefined();
  });
});

describe('assertDesignatedDemoDeployment', () => {
  it('accepts the designated deployment and returns its target', () => {
    expect(assertDesignatedDemoDeployment(designated())).toEqual({
      database: 'admin_dashboard_demo',
      host: 'demo-host',
    });
  });

  it('refuses when no demo deployment is designated at all', () => {
    // The important default: a forgotten variable seeds NOTHING, rather than
    // seeding wherever DATABASE_URL happens to point.
    expect(() =>
      assertDesignatedDemoDeployment({ DATABASE_URL: DEMO_URL }),
    ).toThrow(/no demo deployment is designated/i);

    expect(() =>
      assertDesignatedDemoDeployment(designated({ DEMO_DEPLOYMENT_DATABASE: '   ' })),
    ).toThrow(/no demo deployment is designated/i);
  });

  it('refuses a database that is not the designated one', () => {
    expect(() =>
      assertDesignatedDemoDeployment(
        designated({ DATABASE_URL: 'mysql://user:pass@demo-host:3306/some_other_db' }),
      ),
    ).toThrow(/points at "some_other_db".*designates "admin_dashboard_demo"/s);
  });

  it('refuses a matching database name on a different host once a host is declared', () => {
    // A database NAME is not unique across machines: a local and a hosted
    // `admin_dashboard_demo` are different databases with the same name.
    expect(() =>
      assertDesignatedDemoDeployment(
        designated({
          DEMO_DEPLOYMENT_HOST: 'demo-host',
          DATABASE_URL: 'mysql://user:pass@prod-host:3306/admin_dashboard_demo',
        }),
      ),
    ).toThrow(/host "prod-host".*designates "demo-host"/s);
  });

  it('accepts when a declared host agrees', () => {
    expect(() =>
      assertDesignatedDemoDeployment(designated({ DEMO_DEPLOYMENT_HOST: 'demo-host' })),
    ).not.toThrow();
  });

  it('refuses a known production database even when it is designated', () => {
    // The denylist is independent of the allowlist. Naming production as the
    // demo box is the mistake to catch, not a preference to honour — this is
    // the exact bypass that put demo rows into production on 2026-09-09.
    for (const database of ['default', 'defaultdb']) {
      expect(() =>
        assertDesignatedDemoDeployment({
          DATABASE_URL: `mysql://user:pass@prod-host:3306/${database}`,
          DEMO_DEPLOYMENT_DATABASE: database,
          DEMO_DEPLOYMENT_HOST: 'prod-host',
          DEMO_DEPLOYMENT: '1',
        }),
      ).toThrow(/holds live data, not demo data/i);
    }
  });

  it('refuses an unreadable DATABASE_URL instead of seeding blind', () => {
    expect(() =>
      assertDesignatedDemoDeployment(designated({ DATABASE_URL: 'not-a-url' })),
    ).toThrow(/Could not determine the target database/i);
  });

  it('requires a second acknowledgement to seed a production-mode process', () => {
    // A public demo instance legitimately runs NODE_ENV=production, so this is
    // not a refusal of the designation — it is a separate confirmation.
    expect(() =>
      assertDesignatedDemoDeployment(designated({ NODE_ENV: 'production' })),
    ).toThrow(/separate acknowledgement/i);

    expect(() =>
      assertDesignatedDemoDeployment(
        designated({ NODE_ENV: 'production', DEMO_DEPLOYMENT: '1' }),
      ),
    ).not.toThrow();
  });

  it('does not let a stale DEMO_DEPLOYMENT=1 unlock an undesignated database', () => {
    // The old guard's shape: the flag alone named no database, so a copied
    // environment carrying it unlocked whatever host it landed on.
    expect(() =>
      assertDesignatedDemoDeployment({
        DATABASE_URL: 'mysql://user:pass@prod-host:3306/customer_live',
        NODE_ENV: 'production',
        DEMO_DEPLOYMENT: '1',
      }),
    ).toThrow(/no demo deployment is designated/i);
  });
});
