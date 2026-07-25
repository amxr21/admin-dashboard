import { test, expect } from '@playwright/test';

/**
 * One real E2E test so CI has something true to run, rather than an empty
 * suite masquerading as coverage. Delete once real flows have their own specs
 * covering the home route.
 */
test('home page loads and renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'admin-dashboard' })).toBeVisible();
});
