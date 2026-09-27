import { expect, test, type Page } from '@playwright/test';

/**
 * The order detail page in a real browser (no backend: every API call is
 * mocked below, same as the other specs).
 *
 * What this pins that jsdom can't: LAYOUT. The page's old status control sat
 * in the header's button row as a labelled select + Apply + a note field that
 * grew in place, so the row held controls of different heights that never
 * lined up. These tests check the replacement geometrically — the status
 * buttons share one height and baseline, the header holds no form fields, the
 * phone's action bar is really pinned to the bottom of the screen, and nothing
 * scrolls sideways in either direction.
 */

test.setTimeout(60_000);

const SETUP_DONE = { key: 'setup.completedAt', value: '2026-09-01T00:00:00.000Z', label: 'completedAt' };

const owner = { id: 'order-owner', name: 'Sara Khalid', email: 'owner@example.test', role: 'OWNER' };

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    orderNumber: 'ORD-10482',
    status: 'PENDING',
    branch: { id: 'branch-1', name: 'Downtown', code: 'DT' },
    total: '234.15',
    subtotal: '223.00',
    taxAmount: '11.15',
    paymentMethod: 'Cash on delivery',
    placedAt: '2026-09-27T10:32:00.000Z',
    notes: [],
    customer: {
      id: 'c1',
      name: 'Layla Hassan',
      email: 'layla.hassan@example.com',
      phone: '+971501234567',
      city: 'Dubai',
      country: 'United Arab Emirates',
    },
    items: [
      { id: 'i1', quantity: 2, price: '45.00', lineTotal: '90.00', productId: 'p1', product: { id: 'p1', name: 'Classic Chocolate Chip — Box of 6', sku: 'CK-CHOC-06', imageUrl: null } },
      { id: 'i2', quantity: 1, price: '48.00', lineTotal: '48.00', productId: 'p2', product: { id: 'p2', name: 'Red Velvet — Box of 6', sku: 'CK-RV-06', imageUrl: null } },
      { id: 'i3', quantity: 1, price: '85.00', lineTotal: '85.00', productId: 'p3', product: { id: 'p3', name: 'Mixed Dozen', sku: 'CK-MIX-12', imageUrl: null } },
    ],
    statusHistory: [],
    assignment: null,
    nextStatuses: ['CONFIRMED', 'CANCELED'],
    goodwillRefunds: [],
    ...overrides,
  };
}

const timeline = [
  {
    id: 'note-n1',
    kind: 'note',
    action: 'order.note.added',
    actorName: 'Sara Khalid',
    createdAt: '2026-09-27T10:38:00.000Z',
    detail: { body: 'Customer called — wants delivery after 6 pm.' },
  },
];

async function mockOrderPage(page: Page, current = order()) {
  let served = current;

  await page.addInitScript((user) => {
    localStorage.setItem('admin-dashboard:token', 'order-browser-test');
    localStorage.setItem('admin-dashboard:user', JSON.stringify(user));
    localStorage.setItem('admin-dashboard:onboarding-welcome-seen', 'true');
  }, owner);

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split('/api/v1')[1] ?? '';
    let data: unknown = [];

    if (path === '/auth/me') data = owner;
    else if (path === '/r/_schema') data = { resources: [] };
    else if (path === '/settings') data = { settings: [SETUP_DONE] };
    else if (path === '/roles') data = { roles: [], areas: [] };
    else if (path === '/shifts/me') data = { shift: null };
    else if (path === '/branches/_brand') data = { storeName: 'Test business', storeCurrency: 'AED' };
    else if (path === '/orders/o1') data = { order: served };
    else if (path === '/orders/o1/timeline') data = { events: timeline };
    else if (path === '/orders/o1/status' && request.method() === 'PATCH') {
      const { to } = request.postDataJSON() as { to: string };
      served = order({
        status: to,
        nextStatuses: to === 'CONFIRMED' ? ['SHIPPED', 'CANCELED', 'RETURNED'] : [],
        statusHistory: [
          {
            id: 'h1',
            fromStatus: 'PENDING',
            toStatus: to,
            note: null,
            changedById: owner.id,
            changedByName: owner.name,
            createdAt: '2026-09-27T10:40:00.000Z',
          },
        ],
      });
      data = { order: served };
    } else if (path === '/audit') {
      data = { entries: [], total: 0, page: 1, pageSize: 1, totalPages: 0, nextCursor: null };
    } else if (path === '/orders') data = { orders: [], total: 0, page: 1, pageSize: 5, totalPages: 0 };
    else if (path === '/r/notifications') data = { rows: [], total: 0, page: 1, pageSize: 5, totalPages: 0 };

    await route.fulfill({ json: { data } });
  });
}

async function noSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
}

test('status moves live in the strip, with buttons that line up', async ({ page }, testInfo) => {
  await mockOrderPage(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/en/admin/orders/o1', { waitUntil: 'domcontentloaded' });

  const progress = page.getByRole('region', { name: 'Order progress' });
  await expect(progress).toBeVisible();
  await expect(page.getByText('Customer called — wants delivery after 6 pm.')).toBeVisible();

  // The header holds identity and Invoice — no form fields any more.
  const header = page.locator('main header').first();
  await expect(header.getByRole('combobox')).toHaveCount(0);
  await expect(header.locator('textarea')).toHaveCount(0);

  // The original complaint: controls of different heights side by side.
  const confirm = await progress.getByRole('button', { name: 'Confirm order' }).boundingBox();
  const cancel = await progress.getByRole('button', { name: 'Cancel order' }).boundingBox();
  expect(confirm && cancel).toBeTruthy();
  expect(confirm!.height).toBe(cancel!.height);
  expect(confirm!.y).toBe(cancel!.y);

  await noSidewaysScroll(page);
  await page.screenshot({ path: testInfo.outputPath('order-detail-desktop.png') });
});

test('confirming asks in a dialog, then offers the next step', async ({ page }) => {
  await mockOrderPage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/en/admin/orders/o1', { waitUntil: 'domcontentloaded' });

  const headerBox = await page.locator('main header').first().boundingBox();
  await page.getByRole('button', { name: 'Confirm order' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  // Nothing grows in place any more — the page behind is untouched.
  expect(await page.locator('main header').first().boundingBox()).toEqual(headerBox);

  const patch = page.waitForRequest((request) => request.url().endsWith('/orders/o1/status'));
  await dialog.getByLabel('Note (optional)').fill('Stock checked');
  await dialog.getByRole('button', { name: 'Confirm order' }).click();

  expect((await patch).postDataJSON()).toEqual({ to: 'CONFIRMED', note: 'Stock checked' });
  await expect(page.getByRole('button', { name: 'Mark as shipped' })).toBeVisible();
  // CONFIRMED can also be returned: that third move waits behind "more".
  await expect(page.getByRole('button', { name: 'More status actions' })).toBeVisible();
});

test('cancelling needs a reason first', async ({ page }, testInfo) => {
  await mockOrderPage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/en/admin/orders/o1', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByRole('alertdialog');
  const confirm = dialog.getByRole('button', { name: 'Cancel order' });

  await expect(confirm).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Out of stock' }).click();
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('order-detail-cancel-dialog.png') });
});

test('on a phone the next step is pinned to the bottom of the screen', async ({ page }, testInfo) => {
  await mockOrderPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/admin/orders/o1', { waitUntil: 'domcontentloaded' });

  const bar = page.getByRole('region', { name: 'Order actions' });
  await expect(bar.getByRole('button', { name: 'Confirm order' })).toBeVisible();

  // The bar is the LAST element on a page taller than the screen, so seeing
  // it hug the bottom edge on first load proves it is actually sticky.
  const box = await bar.boundingBox();
  expect(box).toBeTruthy();
  expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(844 - 2);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844 + 1);

  await noSidewaysScroll(page);
  await page.screenshot({ path: testInfo.outputPath('order-detail-phone.png') });
});

test('Arabic, dark: mirrored and still no sideways scroll', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockOrderPage(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/ar/admin/orders/o1', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: 'تأكيد الطلب' })).toBeVisible();
  expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
  await noSidewaysScroll(page);
  await page.screenshot({ path: testInfo.outputPath('order-detail-ar-dark.png') });
});
