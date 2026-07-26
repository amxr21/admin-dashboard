import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Clears `.next` when it holds a PRODUCTION build, before `next dev` starts.
 *
 * ─── THE THIRD VARIANT OF THE SAME BUG ───────────────────────────────
 * `next dev` and `next build` share `.next`. Two failure directions were
 * already handled:
 *   1. build while dev is running   -> assert-no-dev-server.mjs blocks it
 *   2. rm -rf .next while dev runs  -> a rule, checked by hand
 *
 * This is the third: a build finishes (correctly, with no dev server running),
 * leaves production artifacts in `.next`, and the NEXT `next dev` starts on top
 * of them. The dev server then serves manifests that reference production chunk
 * names which do not exist in dev:
 *
 *   Cannot find module './vendor-chunks/@sentry+core@10.68.0.js'
 *
 * Every route 500s. Nothing in typecheck, lint, tests or the build itself can
 * see it, because the damage is to a directory none of them read — and the
 * person who hits it is whoever runs `pnpm dev` next, which is usually not the
 * person who ran the build.
 *
 * `BUILD_ID` is the marker: `next build` writes it, `next dev` never does.
 */

const distDir = new URL('../.next', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const buildIdPath = join(distDir, 'BUILD_ID');

if (existsSync(buildIdPath)) {
  process.stdout.write(
    '  .next holds a production build — clearing it so dev starts clean.\n',
  );
  rmSync(distDir, { recursive: true, force: true });
}
