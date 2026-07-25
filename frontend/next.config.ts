import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Fail the build on type or lint errors. Both default to "ignore during
  // build" in some setups, which lets broken code reach production — the CI
  // pipeline should never be the only thing standing between you and a bad
  // deploy.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only upload source maps when a token is present, so `pnpm build` works
  // locally and in PR checks without Sentry credentials.
  silent: !process.env.CI,

  // Strip source maps from the client bundle after upload — Sentry can still
  // symbolicate stack traces, but visitors can't read your source.
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Proxy Sentry calls through your own domain so ad blockers don't silently
  // drop error reports.
  tunnelRoute: '/monitoring',

  disableLogger: true,
});
