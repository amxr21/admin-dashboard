import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';

/**
 * Deletes `.next` so the next `pnpm dev` starts from a clean cache.
 *
 * ─── WHY THIS EXISTS SEPARATELY FROM THE OTHER TWO GUARDS ────────────
 * Two scripts already defend the dev/build collision at its known EDGES:
 *   - assert-no-dev-server.mjs — refuses `next build` while dev is running
 *   - clean-prod-build.mjs     — clears a production `.next` before dev starts
 *
 * Neither helps once a dev server is ALREADY corrupted mid-session, which is
 * how this failure is usually met in practice:
 *
 *   Cannot find module './vendor-chunks/@sentry+core@10.68.0.js'
 *
 * It surfaces on a route change, a branch switch, or a static-paths worker —
 * long after startup, so the startup-time guard has already run and passed.
 * The recovery has always been the same three manual steps (stop dev, delete
 * .next, restart), documented in a comment nobody reads while a page is 500ing.
 * This is that recovery as one command: `pnpm dev:reset`.
 *
 * ─── IT REFUSES TO RUN WHILE A DEV SERVER IS UP ──────────────────────
 * Deleting `.next` under a LIVE dev server is the second failure direction the
 * header of clean-prod-build.mjs lists — it produces the same broken state
 * this script is meant to repair. Same port-bind check as
 * assert-no-dev-server.mjs, for the same reasons given there (portable, no
 * dependencies, no per-platform process scanning).
 */

const PORT = Number(process.env.PORT ?? 3000);
const distDir = new URL('../.next', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function removeCache() {
  if (!existsSync(distDir)) {
    process.stdout.write('  .next is already gone — nothing to reset.\n');
    return;
  }

  rmSync(distDir, { recursive: true, force: true });
  process.stdout.write('  Deleted .next. Start the dev server again with `pnpm dev`.\n');
}

const server = createServer();

server.once('error', (err) => {
  if (err.code !== 'EADDRINUSE') {
    // Anything other than "port taken" says nothing about a dev server, so it
    // must not block a legitimate reset.
    removeCache();
    process.exit(0);
  }

  process.stderr.write(
    `\n  Refusing to delete .next: something is listening on port ${PORT}.\n\n` +
      `  If that's \`next dev\`, deleting its build directory underneath it\n` +
      `  causes the very "Cannot find module ./vendor-chunks/..." error this\n` +
      `  command exists to fix.\n\n` +
      `  Stop the dev server first, then run \`pnpm dev:reset\` again.\n\n`,
  );
  process.exit(1);
});

server.once('listening', () => {
  server.close(() => {
    removeCache();
    process.exit(0);
  });
});

server.listen(PORT, '127.0.0.1');
