import { expect, test, type Page } from '@playwright/test';

test.setTimeout(90_000);

const owner = { id: 'campaign-owner', name: 'Owner', email: 'owner@example.test', role: 'OWNER' };

interface State {
  saved: Record<string, unknown> | null;
  sendBody: Record<string, unknown> | null;
}

async function mockCampaigns(page: Page, readiness = { EMAIL: true, SMS: false }) {
  const state: State = { saved: null, sendBody: null };

  await page.addInitScript((user) => {
    localStorage.setItem('admin-dashboard:token', 'campaign-browser-test');
    localStorage.setItem('admin-dashboard:user', JSON.stringify(user));
    localStorage.setItem('admin-dashboard:onboarding-welcome-seen', 'true');
  }, owner);

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split('/api/v1')[1] ?? '';
    let data: unknown = { rows: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

    if (path === '/auth/me') data = owner;
    else if (path === '/r/_schema') data = { resources: [] };
    else if (path === '/settings') data = { settings: [] };
    else if (path === '/roles') data = { roles: [], areas: [] };
    else if (path === '/shifts/me') data = { shift: null };
    else if (path === '/branches') data = [{ id: 'b1', businessId: 'x', name: 'Marina', code: null, city: null, isSellingPoint: true, isDefault: true, businessName: 'x' }];
    else if (path === '/branches/b1') data = { id: 'b1', name: 'Marina', timezone: 'Asia/Dubai' };
    else if (path === '/branches/_brand') data = { storeName: 'Mariam Bakes', storeCurrency: 'AED' };
    else if (path === '/campaigns/readiness') {
      data = {
        EMAIL: { ready: readiness.EMAIL, problems: readiness.EMAIL ? [] : ['emailNotConfigured'] },
        SMS: { ready: readiness.SMS, problems: readiness.SMS ? [] : ['smsNotConfigured'] },
      };
    } else if (path === '/campaigns' && request.method() === 'GET') data = { campaigns: state.saved ? [state.saved] : [] };
    else if (path === '/campaigns/preview-audience') {
      data = {
        matched: 320,
        eligible: 250,
        excluded: { noConsent: 60, noAddress: 4, suppressed: 6 },
        sample: ['Mariam Ali', 'Omar Saeed'],
        sms: null,
        largeAudienceThreshold: 200,
      };
    } else if ((path === '/campaigns' && request.method() === 'POST') || (path === '/campaigns/c1' && request.method() === 'PUT')) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.saved = {
        ...body,
        id: 'c1',
        status: 'DRAFT',
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        audienceSize: null,
        lastError: null,
        createdAt: '2026-09-25T10:00:00.000Z',
        updatedAt: '2026-09-25T10:00:00.000Z',
        outcomes: { pending: 0, sent: 0, delivered: 0, failed: 0, bounced: 0 },
      };
      data = { campaign: state.saved };
    } else if (path === '/campaigns/c1' && request.method() === 'GET') data = { campaign: state.saved };
    else if (path === '/campaigns/c1/send') {
      state.sendBody = request.postDataJSON() as Record<string, unknown>;
      state.saved = { ...state.saved, status: state.sendBody.sendAt ? 'SCHEDULED' : 'SENDING', scheduledAt: state.sendBody.sendAt ?? null };
      data = { campaign: state.saved };
    }

    await route.fulfill({ json: { data } });
  });

  return state;
}

test('owner drafts an email campaign, sees its reach, and must confirm a large send', async ({ page }) => {
  const state = await mockCampaigns(page);
  await page.goto('/en/admin/campaigns', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Campaigns' })).toBeVisible();
  await page.getByRole('link', { name: 'New campaign' }).click();

  await page.getByLabel('Name (only you see this)').fill('Eid offer');
  await page.getByRole('combobox', { name: 'Start from a template' }).click();
  await page.getByRole('option', { name: 'Discount offer' }).click();
  await expect(page.locator('#campaign-body-en')).toHaveValue(/use.*\{\{discount_code\}\}|code \{\{discount_code\}\}/);
  await expect(page.locator('#campaign-body-ar')).toHaveValue(/\{\{customer_name\}\}/);

  // Reach is counted live and explains who is left out.
  await expect(page.getByText('250', { exact: true })).toBeVisible();
  await expect(page.getByText('Have not agreed to marketing emails')).toBeVisible();

  await page.getByRole('button', { name: 'Send or schedule' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('"Eid offer" will go to 250 customers.')).toBeVisible();
  const sendNow = dialog.getByRole('button', { name: 'Send now' });
  await expect(sendNow).toBeDisabled();
  await dialog.getByLabel(/Type 250 to confirm/).fill('250');
  await sendNow.click();

  await expect.poll(() => state.sendBody).toEqual({ confirmRecipients: 250 });
  expect(state.saved?.bodyEn).toContain('{{discount_code}}');
});

test('scheduling uses the branch time zone', async ({ page }) => {
  const state = await mockCampaigns(page);
  await page.goto('/en/admin/campaigns/new', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Name (only you see this)').fill('Weekend');
  await page.locator('#campaign-subject-en').fill('Weekend');
  await page.locator('#campaign-body-en').fill('Hello');
  await page.getByRole('button', { name: 'Send or schedule' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Later' }).click();
  await expect(dialog.getByText('Times are in Asia/Dubai.')).toBeVisible();
  await dialog.getByLabel(/Type 250 to confirm/).fill('250');
  await dialog.getByRole('button', { name: 'Schedule' }).click();

  await expect.poll(() => typeof state.sendBody?.sendAt).toBe('string');
  // 10:00 in Dubai is 06:00 UTC.
  expect(String(state.sendBody?.sendAt)).toMatch(/T06:00:00\.000Z$/);
});

test('the Arabic editor lays out right-to-left on a phone', async ({ page }) => {
  await mockCampaigns(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/ar/admin/campaigns/new', { waitUntil: 'domcontentloaded' });

  // The first Arabic page load compiles on a dev server; allow for it.
  await expect(page.getByRole('heading', { name: 'حملة جديدة' })).toBeVisible({ timeout: 30_000 });
  expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('campaigns stay out of the sidebar until a channel can send', async ({ page }) => {
  await mockCampaigns(page, { EMAIL: false, SMS: false });
  await page.goto('/en/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Customer service' })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Campaigns' })).toHaveCount(0);
});
