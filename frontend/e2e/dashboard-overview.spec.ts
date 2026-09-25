import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

const owner = {
  id: 'dashboard-owner',
  name: 'Dashboard Owner',
  email: 'owner@example.test',
  role: 'OWNER',
};

const range = { from: '2026-09-01', to: '2026-09-30' };

async function mockDashboard(page: Page) {
  await page.addInitScript((user) => {
    localStorage.setItem('admin-dashboard:token', 'dashboard-browser-test');
    localStorage.setItem('admin-dashboard:user', JSON.stringify(user));
    localStorage.setItem('admin-dashboard:onboarding-welcome-seen', 'true');
  }, owner);

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/api/v1')[1] ?? '';
    let data: unknown = null;

    if (path === '/auth/me') data = owner;
    else if (path === '/r/_schema') data = { resources: [] };
    else if (path === '/settings') data = { settings: [] };
    else if (path === '/policies') data = [];
    else if (path === '/roles') data = { roles: [], areas: [] };
    else if (path === '/shifts/me') data = { shift: null };
    else if (path === '/branches') {
      data = [
        { id: 'branch-1', businessId: 'business-1', name: 'Marina', code: 'MAR', isSellingPoint: true, isActive: true, isDefault: true },
        { id: 'branch-2', businessId: 'business-1', name: 'Downtown', code: 'DTN', isSellingPoint: true, isActive: true, isDefault: false },
      ];
    } else if (path === '/branches/_brand') data = { storeName: 'Test business', storeCurrency: 'AED' };
    else if (path === '/reports/overview') {
      data = {
        range,
        revenue: '18250.00',
        orders: 86,
        canceledOrders: 3,
        newCustomers: 14,
        lowStockProducts: 4,
        unitsSold: 137,
        averageOrderValue: '212.21',
        cogs: '8200.00',
        grossProfit: '10050.00',
        grossMarginPercent: 0.5507,
        costedRevenue: '18250.00',
        costCoverage: { costedLines: 86, totalLines: 86 },
      };
    } else if (path === '/reports/revenue') {
      data = {
        range,
        granularity: 'day',
        points: [
          { date: '2026-09-01', revenue: '620.00', orders: 4, profit: '330.00', costedLines: 4, totalLines: 4 },
          { date: '2026-09-02', revenue: '780.00', orders: 5, profit: '420.00', costedLines: 5, totalLines: 5 },
        ],
      };
    } else if (path === '/reports/branch-comparison') {
      data = {
        range,
        branches: [
          { id: 'branch-1', name: 'Marina', code: 'MAR', isSellingPoint: true, businessId: 'business-1', businessName: 'Test business', revenue: '10250.00', orderCount: 48, unitsSold: 75 },
          { id: 'branch-2', name: 'Downtown', code: 'DTN', isSellingPoint: true, businessId: 'business-1', businessName: 'Test business', revenue: '8000.00', orderCount: 38, unitsSold: 62 },
        ],
      };
    } else if (path === '/reports/top-products') data = { range, products: [] };
    else if (path === '/reports/status-breakdown') data = { range, statuses: [] };
    else if (path === '/reports/fulfillment-health') data = { range, avgHoursInStatus: [], needsAttention: [] };
    else if (path === '/reports/returns-summary') data = { range, returnCount: 0, orderCount: 86, returnRate: 0, refundValue: '0.00', unitsReturned: 0, topReturnedProducts: [] };
    else if (path === '/reports/order-value-distribution') data = { range, buckets: [] };
    else if (path === '/reports/needs-attention') {
      data = {
        returnsAwaitingApproval: { count: 0, items: [] },
        reviewsAwaitingModeration: { count: 0, items: [] },
        unassignedDeliveries: { count: 0, items: [] },
        outOfStockWithOpenOrders: { count: 0, items: [] },
      };
    } else if (path === '/reports/floor-status') {
      data = {
        openShifts: [],
        recentlyClosed: [],
        totals: { onShift: 0, branches: 0, taken: '0.00', salesCount: 0, expectedInDrawers: '0.00', noSaleCount: 0, voidCount: 0 },
      };
    } else if (path === '/reports/low-stock-snapshot') data = { threshold: 5, products: [] };
    else if (path === '/reports/day-timeline') data = { range, events: [], truncated: false };
    else if (path === '/orders') data = { orders: [], total: 0, page: 1, pageSize: 5, totalPages: 0 };
    else if (path === '/r/notifications') data = { rows: [], total: 0, page: 1, pageSize: 5, totalPages: 0 };
    else data = [];

    await route.fulfill({ json: { data } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockDashboard(page);
});

for (const scenario of [
  { locale: 'en', width: 375, height: 812, title: 'Advanced insights', fulfillment: 'Fulfillment health' },
  { locale: 'ar', width: 1440, height: 1000, title: 'تحليلات متقدمة', fulfillment: 'صحة التنفيذ' },
] as const) {
  test(`keeps the ${scenario.locale} dashboard focused and responsive`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.goto(`/${scenario.locale}/admin`, { waitUntil: 'domcontentloaded' });

    const toggle = page.getByRole('button', { name: new RegExp(scenario.title) });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('region', { name: scenario.title })).toHaveCount(0);

    const fulfillment = page.getByRole('region', { name: scenario.fulfillment });
    await expect(fulfillment).toBeVisible();
    await expect(fulfillment).toHaveClass(/bg-card/);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await page.locator('html').getAttribute('dir')).toBe(scenario.locale === 'ar' ? 'rtl' : 'ltr');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: scenario.title })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

async function asHomeBusiness(page: Page) {
  await page.route('**/api/v1/settings', (route) =>
    route.fulfill({ json: { data: { settings: [{ key: 'setup.businessType', value: 'HOME_BUSINESS', label: 'businessType' }] } } }),
  );
  await page.route('**/api/v1/r/customers**', (route) =>
    route.fulfill({
      json: {
        data: {
          rows: [{ id: 'customer-1', name: 'Mariam Ali', email: 'mariam@example.test', phone: null, createdAt: '2026-09-24T09:00:00.000Z' }],
          total: 1,
          page: 1,
          pageSize: 5,
          totalPages: 1,
        },
      },
    }),
  );
}

test('a Home Business starts on the Simple view and remembers a switch to Detailed', async ({ page }) => {
  await asHomeBusiness(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/en/admin', { waitUntil: 'domcontentloaded' });

  const simple = page.getByRole('button', { name: 'Simple', exact: true });
  await expect(simple).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText("Today's sales")).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New sale' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mariam Ali' })).toBeVisible();
  // No chart or advanced analysis on the simple view.
  await expect(page.getByRole('button', { name: /Advanced insights/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole('button', { name: 'Detailed', exact: true }).click();
  await expect(page.getByRole('button', { name: /Advanced insights/ })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Detailed', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('the Arabic Simple view fits a phone right-to-left', async ({ page }) => {
  await asHomeBusiness(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/ar/admin', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: 'مبسّطة', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('مبيعات اليوم')).toBeVisible();
  expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});