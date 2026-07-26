import { createServer } from 'node:net';

/**
 * Refuses to start a production build while a dev server is running.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────
 * `next dev` and `next build` both write to `.next`. A build started while a
 * dev server is up replaces the dev chunk graph, and the running dev server
 * keeps serving manifests that point at chunk files the build just deleted:
 *
 *   Cannot find module './vendor-chunks/@sentry+core@10.68.0.js'
 *
 * The dev server does not recover — it has to be stopped and `.next` deleted
 * by hand. Worse, NOTHING catches it: typecheck, lint, the test suite, and the
 * build itself all pass, because the damage is to a directory none of them
 * read. The only symptom is the browser, which no automated check opens.
 *
 * ─── WHY A PORT CHECK, NOT A PROCESS SCAN ────────────────────────────
 * Process scanning is per-platform and fragile. Binding the port is the same
 * question the dev server itself answers, works identically everywhere, and
 * has no dependencies. It costs a few milliseconds.
 *
 * CI and Vercel have nothing on this port, so this is a no-op there.
 *
 * Escape hatch: ALLOW_BUILD_WITH_DEV_SERVER=1 for the rare case where the
 * port is held by something unrelated.
 */

const PORT = Number(process.env.PORT ?? 3000);

if (process.env.ALLOW_BUILD_WITH_DEV_SERVER === '1') {
  process.exit(0);
}

const server = createServer();

server.once('error', (err) => {
  if (err.code !== 'EADDRINUSE') {
    // Anything else (permissions, bad port) is not what this guard is about —
    // don't block a legitimate build over it.
    process.exit(0);
  }

  process.stderr.write(
    `\n  Refusing to build: something is listening on port ${PORT}.\n\n` +
      `  If that's \`next dev\`, this build would overwrite the .next directory\n` +
      `  it is serving from and break it with a "Cannot find module\n` +
      `  ./vendor-chunks/..." error that no test or lint check can detect.\n\n` +
      `  Stop the dev server, then build. To recover a dev server already in\n` +
      `  this state, stop it, delete .next, and start it again.\n\n` +
      `  If the port is held by something unrelated:\n` +
      `    ALLOW_BUILD_WITH_DEV_SERVER=1 pnpm build\n\n`,
  );
  process.exit(1);
});

server.once('listening', () => {
  server.close(() => process.exit(0));
});

server.listen(PORT, '127.0.0.1');
