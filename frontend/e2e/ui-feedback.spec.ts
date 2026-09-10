import { expect, test, type Page } from '@playwright/test';
import reportFixtures from './fixtures/reports.json';

// All API traffic is intercepted: these checks never need a database or a real login.
const user = { id: 'ui-owner', name: 'Test owner', email: 'owner@example.test', role: 'OWNER' };
const branches = ['Marina', 'Downtown'].map((name, index) => ({
  id: `branch-${index}`, name, businessId: 'business-1', businessName: 'Test business',
  code: null, city: null, isSellingPoint: true, isActive: true, isDefault: index === 0, staffCount: 0,
}));

async function mockWorkspace(page: Page) {
  await page.addInitScript((user) => {
    localStorage.setItem('admin-dashboard:token', 'ui-test-token');
    localStorage.setItem('admin-dashboard:user', JSON.stringify(user));
    localStorage.setItem('admin-dashboard:onboarding-welcome-seen', 'true');
  }, user);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/api/v1')[1];
    let data: unknown = { rows: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    if (path === '/auth/me') data = user;
    if (path === '/r/_schema') data = { resources: [] };
    if (path === '/settings') data = { settings: [] };
    if (path === '/branches') data = branches;
    if (path === '/branches/_brand') data = { storeName: 'Test business', storeCurrency: 'AED' };
    if (path === '/businesses') data = [{ id: 'business-1', name: 'Test business', branches }];
    if (path?.startsWith('/reports/')) {
      await route.fulfill({ status: 400, json: { error: { code: 'BAD_REQUEST', message: 'Choose a range of 731 days or fewer' } } });
      return;
    }
    await route.fulfill({ json: { data } });
  });
}

test.beforeEach(async ({ page }) => { await mockWorkspace(page); });

test('an empty business list offers a working creation action', async ({ page }) => {
  await page.route('**/api/v1/businesses', route => route.fulfill({ json: { data: [] } }));
  await page.goto('/en/admin/branches');
  await page.getByRole('link', { name: 'Add business' }).click();
  await expect(page).toHaveURL(/\/admin\/branches\/new$/, { timeout: 15000 });
});

test('a branch drawer has one scrollable surface and keeps its actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.route('**/api/v1/businesses', route => route.fulfill({ json: { data:
    Array.from({ length: 10 }, (_, index) => ({ id: `business-${index}`, name: `Business ${index}`, branches })),
  } }));
  await page.goto('/en/admin/branches');
  await page.getByRole('button', { name: 'Add branch', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const scroll = await dialog.evaluate((element) => {
    const surfaces = [element, ...element.querySelectorAll('*')].filter(el =>
      /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1,
    );
    return { count: surfaces.length, bodyOverflows: document.documentElement.scrollHeight > innerHeight + 1 };
  });
  expect(scroll.count).toBe(1);
  expect(scroll.bodyOverflows).toBe(false);
  await expect(page.locator('main')).toHaveCSS('overflow-y', 'hidden');
  await dialog.getByRole('button', { name: 'Save', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('main')).toHaveCSS('overflow-y', 'auto');
});

test('branch switching displays feedback before the reload', async ({ page }) => {
  await page.goto('/en/admin/branches');
  await page.getByRole('combobox', { name: /branch/i }).click();
  // Pause frame callbacks so the pre-reload UI can be inspected deterministically.
  await page.evaluate(() => {
    const browser = window as typeof window & { resumeFrames?: () => void };
    const original = window.requestAnimationFrame;
    const callbacks: FrameRequestCallback[] = [];
    window.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
    browser.resumeFrames = () => {
      window.requestAnimationFrame = original;
      callbacks.forEach(callback => original(callback));
    };
  });
  await page.getByRole('option', { name: 'Marina', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Switching branches' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('admin-dashboard:branch'))).toBe('branch-0');
  const reload = page.waitForRequest(request => request.isNavigationRequest());
  await page.evaluate(() => (window as typeof window & { resumeFrames?: () => void }).resumeFrames?.());
  await reload;
});

test('a report shows loading feedback, preserves range errors and retries', async ({ page }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/v1/reports/customer-geography?*', async route => {
    requests += 1;
    await pending;
    await route.fulfill({ status: 400, json: { error: { code: 'BAD_REQUEST', message: 'Choose a range of 731 days or fewer' } } });
  });
  await page.goto('/en/admin/reports/customer-geography');
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible();
  release?.();
  await expect(page.getByText('Choose a range of 731 days or fewer')).toBeVisible();
  const beforeRetry = requests;
  await page.getByRole('button', { name: /try again/i }).click();
  await expect.poll(() => requests).toBeGreaterThan(beforeRetry);
});

// Populated fixtures mirror the unit-test API contracts and exercise real chart layout.
const reportPages = ["audit-activity-by-entity","audit-outcome-trend","category-breakdown","courier-performance","courier-workload-snapshot","customer-geography","customer-lifetime-value","customer-new-vs-returning","customer-order-frequency","delivery-cycle-time","delivery-zone-breakdown","explorer","guest-vs-registered","inventory-turnover","low-stock-snapshot","overview","payment-method-breakdown","product-margin","product-review-summary","products-without-reviews","refund-rate-trend","return-reasons","return-resolution-breakdown","review-moderation-throughput","staff-activity","stock-adjustment-reasons","variant-stock-movement"];
for (const report of reportPages) {
  test('report renders and exports: ' + report, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/api/v1/reports/**', async route => {
      const url = new URL(route.request().url());
      const slug = url.pathname.split('/').pop() ?? '';
      if (url.searchParams.has('format')) {
        await route.fulfill({ contentType: 'text/csv', body: 'name,value\nTest,1\n' });
        return;
      }
      const key = 'fetch' + slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
      const fixtures: Record<string, unknown> = reportFixtures;
      expect(fixtures[key], 'Missing fixture for ' + slug).toBeDefined();
      await route.fulfill({ json: { data: fixtures[key] } });
    });
    await page.goto('/en/admin/reports/' + report + '?from=2026-01-01&to=2026-01-31&compare=none');
    const main = page.locator('main');
    await expect(main.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const tileReports = ['customer-new-vs-returning', 'delivery-cycle-time', 'guest-vs-registered', 'review-moderation-throughput'];
    if (tileReports.includes(report)) {
      await expect(main.locator('.tabular-nums').first()).toBeVisible();
    } else {
      await expect(main.getByRole('table').or(main.locator('.recharts-surface')).first()).toBeVisible();
    }
    const charts = main.locator('.recharts-surface');
    for (const chart of await charts.all()) {
      const bounds = await chart.boundingBox();
      expect(bounds?.width).toBeGreaterThan(0);
      expect(bounds?.height).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
    const exportButton = main.getByRole('button', { name: /^export/i }).first();
    if (await exportButton.count()) {
      const download = page.waitForEvent('download');
      await exportButton.click();
      if (report !== 'overview') await page.getByRole('menuitem', { name: /csv/i }).click();
      expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    }
  });
}
