import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against a live preview URL in CI (Vercel FE + Render BE), never
 * against a locally-built app — see .github/workflows/e2e.yml.
 *
 * project-test-gen writes the specs under e2e/; this only configures how
 * they run.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  timeout: 30_000,

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
