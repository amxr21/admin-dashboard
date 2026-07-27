import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A required env var has to be declared in FOUR places, and three of them have
 * no local symptom when you forget.
 *
 * ─── THE BUG THIS EXISTS TO PREVENT ──────────────────────────────────
 * `DELIVERY_CODE_SECRET` was added to env.ts as required, and to `.env` — which
 * is gitignored. Everything passed locally. CI then failed every backend test
 * with `Invalid environment configuration`, and a Render deploy would have
 * failed to BOOT, because `env.ts` parses at import time and exits(1).
 *
 * The local machine is the one place that cannot detect the mistake, because
 * it is the only one with the value.
 *
 * So: parse env.ts for required vars, and assert each is declared in
 * .env.example (so a human knows to set it), ci.yml (so tests can run) and
 * render.yaml (so production can boot).
 */

const backend = resolve(process.cwd());
const repo = resolve(backend, '..');

const read = (path: string) => readFileSync(path, 'utf8');

const envSource = read(resolve(backend, 'src/config/env.ts'));
const example = read(resolve(backend, '.env.example'));
const ci = read(resolve(repo, '.github/workflows/ci.yml'));
const render = read(resolve(backend, 'render.yaml'));

/**
 * Vars with no `.default(...)` and no `.optional()` — the ones whose absence
 * kills the process rather than falling back.
 */
function requiredVars(): string[] {
  const withoutComments = envSource.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const body = withoutComments.slice(
    withoutComments.indexOf('z.object({'),
    withoutComments.indexOf('});'),
  );

  // Split on top-level `NAME: z...` declarations.
  const declarations = [...body.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*([\s\S]*?)(?=^\s{2}[A-Z][A-Z0-9_]*:|$)/gm)];

  return declarations
    .filter(([, , definition]) => {
      const text = definition ?? '';
      return !text.includes('.default(') && !text.includes('.optional()');
    })
    .map(([, name]) => name ?? '');
}

describe('every required env var is declared everywhere it is needed', () => {
  it('finds the required vars in env.ts', () => {
    const required = requiredVars();

    // Sanity: if the parse breaks, the assertions below would vacuously pass.
    expect(required).toContain('DATABASE_URL');
    expect(required).toContain('JWT_SECRET');
  });

  it.each(requiredVars())('%s is documented in .env.example', (name) => {
    // Otherwise nobody setting the project up knows it exists.
    expect(example).toContain(name);
  });

  it.each(requiredVars())('%s is set for CI in ci.yml', (name) => {
    // env.ts exits(1) at import, so a miss fails every backend test at once
    // with a message that does not name the file that caused it.
    expect(ci).toContain(name);
  });

  it.each(requiredVars())('%s is declared in render.yaml', (name) => {
    // A miss here is not a degraded service — the process never boots.
    expect(render).toContain(name);
  });
});

describe('secrets are never given a fallback value', () => {
  it.each(['JWT_SECRET', 'DELIVERY_CODE_SECRET'])('%s has no default', (name) => {
    // A secret that ships with the code is not a secret. Anyone who reads the
    // repo can forge a token, or compute a valid courier access code.
    const declaration = new RegExp(`${name}:[\\s\\S]*?(?=^\\s{2}[A-Z][A-Z0-9_]*:|\\}\\);)`, 'm');
    const match = declaration.exec(envSource.replace(/\/\/.*$/gm, ''));

    expect(match).not.toBeNull();
    expect(match?.[0]).not.toContain('.default(');
  });

  it('does not commit a real-looking secret to the workflow', () => {
    // CI values must be obviously throwaway. This catches a paste of a real
    // secret into ci.yml, which git history would then keep forever.
    const values = [...ci.matchAll(/^\s*(JWT_SECRET|DELIVERY_CODE_SECRET):\s*(.+)$/gm)];

    expect(values.length).toBeGreaterThan(0);

    for (const [, , value] of values) {
      expect(value ?? '').toMatch(/ci|test|not-used/i);
    }
  });
});
