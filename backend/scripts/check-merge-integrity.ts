/**
 * Guards against the silent-merge failures this repo has hit repeatedly when
 * many sibling feature branches (split from one shared checkpoint commit)
 * independently touch the same file region:
 *
 *   1. `backend/src/routes/v1/index.ts` — a 3-way merge sees two
 *      non-conflicting insertions (two different new routers added near each
 *      other) and silently keeps only one side's `v1Router.use(...)` line, or
 *      keeps an import with no matching registration. Both compile: an unused
 *      import is a lint warning at worst, and the route just silently 404s in
 *      production. (Real incident: PR #105.)
 *   2. `backend/prisma/schema.prisma` — the same shape, but on an enum/model
 *      block: two branches independently touch the same enum, git keeps both
 *      copies, and `prisma generate` fails with P1012 in CI, 3+ jobs deep,
 *      with no line number pointing at the actual repo problem.
 *      (Real incident: PR #106, and again as `ProductRedirect` on
 *      feat/resource-import-export — that one auto-merged with NO conflict
 *      markers at all, so git alone can't be trusted to flag this class.)
 *   3. `frontend/messages/{en,ar}.json` — two branches each add a new
 *      top-level section to the same object; a bad manual resolution can
 *      duplicate a JSON key. `JSON.parse` silently keeps the LAST of two
 *      duplicate keys with no warning, so this is invisible until someone
 *      notices a string that should be there isn't.
 *
 * Run via `pnpm --filter ./backend check:merge` — wired into the pre-push
 * hook and as a dedicated fast CI job so this surfaces in seconds, before
 * Build/Lint/Typecheck/Tests all fail downstream for the same root cause.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const WORKSPACE_ROOT = join(ROOT, '..');

let failed = false;

function fail(message: string): void {
  failed = true;
  console.error(`✖ ${message}`);
}

function checkRouterRegistrations(): void {
  const path = join(ROOT, 'src/routes/v1/index.ts');
  const src = readFileSync(path, 'utf8');

  const imported = new Set<string>();
  for (const m of src.matchAll(/^import\s*\{\s*(\w+)\s*\}\s*from\s*'\.\//gm)) {
    imported.add(m[1]);
  }

  const registered: string[] = [];
  for (const m of src.matchAll(/^v1Router\.use\((\w+)\);/gm)) {
    registered.push(m[1]);
  }
  const registeredCount = new Map<string, number>();
  for (const name of registered) {
    registeredCount.set(name, (registeredCount.get(name) ?? 0) + 1);
  }

  for (const name of imported) {
    const count = registeredCount.get(name) ?? 0;
    if (count === 0) {
      fail(
        `routes/v1/index.ts: '${name}' is imported but never registered with v1Router.use(...) — ` +
          `a merge likely dropped its registration line while a sibling router was added nearby. ` +
          `The route silently 404s; TypeScript will not catch this on its own.`,
      );
    } else if (count > 1) {
      fail(
        `routes/v1/index.ts: '${name}' is registered ${count} times — a merge likely duplicated it.`,
      );
    }
  }
}

function checkPrismaDuplicateBlocks(): void {
  const path = join(ROOT, 'prisma/schema.prisma');
  const src = readFileSync(path, 'utf8');

  const seen = new Map<string, number>();
  for (const m of src.matchAll(/^(enum|model)\s+(\w+)\s*\{/gm)) {
    const name = m[2];
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }

  for (const [name, count] of seen) {
    if (count > 1) {
      fail(
        `schema.prisma: '${name}' is defined ${count} times — two branches independently touched ` +
          `the same block and a merge kept both copies. \`prisma generate\` will fail with P1012 ` +
          `for this exact reason.`,
      );
    }
  }
}

/**
 * Sibling-level duplicate object keys in a JSON file. `JSON.parse` accepts
 * this silently (last write wins) so it never surfaces as a parse error —
 * only as content that mysteriously isn't there.
 */
function findDuplicateJsonKeys(src: string): string[] {
  const duplicates: string[] = [];
  const stack: Array<Set<string>> = [new Set()];

  for (const line of src.split('\n')) {
    const keyMatch = line.match(/^\s*"([^"]+)"\s*:/);
    if (keyMatch) {
      const key = keyMatch[1];
      const currentLevel = stack[stack.length - 1];
      if (currentLevel.has(key)) {
        duplicates.push(key);
      }
      currentLevel.add(key);
    }

    // Approximate: counts braces per line, which is fine for these
    // pretty-printed, one-key-per-line catalogue files.
    for (const ch of line) {
      if (ch === '{') stack.push(new Set());
      else if (ch === '}') stack.pop();
    }
  }

  return duplicates;
}

function checkMessageCatalogues(): void {
  for (const locale of ['en', 'ar']) {
    const path = join(WORKSPACE_ROOT, 'frontend/messages', `${locale}.json`);
    const src = readFileSync(path, 'utf8');

    const duplicates = findDuplicateJsonKeys(src);
    for (const key of duplicates) {
      fail(
        `frontend/messages/${locale}.json: '${key}' appears twice as a sibling key — ` +
          `a merge likely duplicated a block. JSON.parse silently keeps the LAST copy and drops ` +
          `the first, with no error.`,
      );
    }
  }
}

checkRouterRegistrations();
checkPrismaDuplicateBlocks();
checkMessageCatalogues();

if (failed) {
  console.error(
    '\ncheck:merge failed — see above. This usually means a recent merge from dev (or into dev) ' +
      'silently dropped or duplicated a block. Fix the file directly; do not re-run the merge.',
  );
  process.exit(1);
}

console.log('✓ check:merge — no dropped/duplicated router or schema blocks found');
