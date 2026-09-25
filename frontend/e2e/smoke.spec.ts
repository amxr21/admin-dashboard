import { test, expect } from '@playwright/test';

/**
 * The root has no page of its own: it redirects to the dashboard, which sends
 * a signed-out visitor to sign in. This proves that whole journey renders.
 */
test('home page sends a signed-out visitor to sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
});