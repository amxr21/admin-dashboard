import { defineConfig, devices } from '@playwright/test';

/**
 * In CI this runs against a `next start` of the built app on the runner, with
 * no backend: specs mock their API calls with page.route(). See
 * .github/workflows/e2e.yml. Locally, run it with CI=1 too (1 worker): 8
 * parallel workers starve the server into spurious React #418 errors.
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
