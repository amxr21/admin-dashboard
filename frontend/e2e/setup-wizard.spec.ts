import { expect, test, type Page } from '@playwright/test';

test.setTimeout(90_000);

const owner = {
  id: 'setup-owner',
  name: 'Test owner',
  email: 'owner@example.test',
  role: 'OWNER',
};

const featureKeys = [
  'dashboard',
  'pos',
  'orders',
  'inventory',
  'suppliers',
  'delivery',
  'returns',
  'reports',
  'scheduledReports',
  'customerCases',
  'staff',
  'branches',
  'settings',
] as const;

const features = featureKeys.map((key) => ({
  key,
  canDisable: key !== 'dashboard' && key !== 'settings',
  dependsOn:
    key === 'pos'
      ? ['orders', 'inventory']
      : key === 'delivery' || key === 'returns'
        ? ['orders']
        : [],
  routes: [],
}));

const enabledFeatures = Object.fromEntries(featureKeys.map((key) => [key, true]));
const current = {
  businessType: 'OTHER',
  features: enabledFeatures,
  labels: {
    products: '',
    orders: '',
    staff: '',
    inventory: '',
    delivery: '',
    returns: '',
    reports: '',
  },
  defaults: { 'products.defaultHasVariants': false, 'store.taxRate': 5 },
  rolePermissions: {},
};
const cafe = {
  ...current,
  businessType: 'CAFE',
  features: {
    ...enabledFeatures,
    delivery: false,
    returns: false,
    customerCases: false,
    scheduledReports: false,
  },
  defaults: { 'products.defaultHasVariants': true, 'store.taxRate': 5 },
};

async function mockSetup(page: Page, role: 'OWNER' | 'SUPPORT' = 'OWNER') {
  const user = { ...owner, role };
  let saved = structuredClone(current);
  let completedAt = '';
  let applyCount = 0;
  let setupRequests = 0;

  await page.addInitScript((sessionUser) => {
    localStorage.setItem('admin-dashboard:token', 'setup-browser-test');
    localStorage.setItem('admin-dashboard:user', JSON.stringify(sessionUser));
    localStorage.setItem('admin-dashboard:onboarding-welcome-seen', 'true');
  }, user);

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split('/api/v1')[1];
    let data: unknown = { rows: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

    if (path === '/auth/me') data = user;
    if (path === '/r/_schema') data = { resources: [] };
    if (path === '/branches') data = [];
    if (path === '/roles') data = { roles: [], areas: [] };
    if (path === '/settings') {
      data = {
        settings: completedAt
          ? [
              { key: 'setup.completedAt', value: completedAt },
              ...featureKeys.map((key) => ({
                key: `features.${key}.enabled`,
                value: saved.features[key],
              })),
            ]
          : [],
      };
    }

    if (path === '/setup' || path === '/setup/preview' || path === '/setup/skip') {
      setupRequests += 1;
      if (role !== 'OWNER') {
        await route.fulfill({
          status: 403,
          json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        });
        return;
      }

      if (path === '/setup' && request.method() === 'GET') {
        data = {
          completedAt: completedAt || null,
          skippedAt: null,
          current: saved,
          templates: [current, cafe],
          features,
          defaultDefinitions: [
            {
              key: 'products.defaultHasVariants',
              type: 'boolean',
              default: false,
            },
            { key: 'store.taxRate', type: 'number', min: 0, max: 100, default: 5 },
          ],
          roles: [
            { role: 'OWNER', areas: [], isLocked: true, isCustomised: false },
            {
              role: 'CASHIER',
              areas: ['orders'],
              isLocked: false,
              isCustomised: false,
            },
          ],
        };
      }

      if (path === '/setup/preview') {
        const draft = request.postDataJSON();
        data = {
          normalized: draft,
          enabledFeatures: featureKeys.filter((key) => draft.features[key]),
          disabledFeatures: featureKeys.filter((key) => !draft.features[key]),
          labelChanges: draft.labels,
          settingChanges: draft.defaults,
          permissionChanges: [],
          warnings: [{ code: 'existingData', feature: 'returns', severity: 'warning' }],
        };
      }

      if (path === '/setup' && request.method() === 'PUT') {
        saved = request.postDataJSON();
        completedAt = new Date().toISOString();
        applyCount += 1;
        data = { completedAt };
      }

      if (path === '/setup/skip') data = { skippedAt: new Date().toISOString() };
    }

    await route.fulfill({ json: { data } });
  });

  return {
    get applyCount() {
      return applyCount;
    },
    get setupRequests() {
      return setupRequests;
    },
  };
}

async function advance(page: Page) {
  await page
    .getByRole('button', {
      name: /^(Start setup|Next|Review changes|بدء الإعداد|التالي|مراجعة التغييرات)$/,
    })
    .click();
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

test('owner completes setup, sees retained-data warning, and can rerun it', async ({ page }) => {
  const state = await mockSetup(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/en/admin/setup', { waitUntil: 'domcontentloaded' });
  await advance(page);
  await page.getByRole('combobox', { name: 'Business type' }).click();
  await page.getByRole('option', { name: 'Cafe' }).click();
  await advance(page);
  await expect(page.getByRole('checkbox', { name: 'Delivery' })).not.toBeChecked();

  await advance(page);
  await expect(page.getByLabel('Products', { exact: true })).toHaveCount(0);
  await advance(page);
  await advance(page);
  await advance(page);

  await expect(page.getByLabel('Products', { exact: true })).toHaveValue('Menu items');
  await expect(page.getByText(/Returns has existing data/)).toBeVisible();
  expect(state.applyCount).toBe(0);

  await page.getByRole('button', { name: 'Apply setup' }).click();
  await expect(page.getByRole('heading', { name: 'Setup preferences saved' })).toBeVisible();
  expect(state.applyCount).toBe(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Start setup' })).toBeVisible();
  expect(state.setupRequests).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

for (const { locale, width, height } of [
  { locale: 'en', width: 375, height: 812 },
  { locale: 'en', width: 768, height: 900 },
  { locale: 'en', width: 1440, height: 900 },
  { locale: 'ar', width: 375, height: 812 },
] as const) {
  test(`wizard stays usable at ${width}px in ${locale}`, async ({ page }) => {
    await mockSetup(page);
    await page.setViewportSize({ width, height });
    await page.goto(`/${locale}/admin/setup`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    for (let step = 0; step < 7; step += 1) {
      await expect(page.locator('main').getByRole('heading', { level: 2 }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (step < 6) await advance(page);
    }

    await expect(
      page.getByRole('button', { name: locale === 'ar' ? 'تطبيق الإعداد' : 'Apply setup' }),
    ).toBeVisible();
  });
}

test('support user cannot load the owner setup API', async ({ page }) => {
  const state = await mockSetup(page, 'SUPPORT');
  await page.goto('/en/admin/setup', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('alert').filter({ hasText: 'Only an owner' })).toBeVisible();
  expect(state.setupRequests).toBe(0);
});
