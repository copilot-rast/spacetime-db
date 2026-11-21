import { type Page } from '@playwright/test';
import { expect, freshPage, open, prefs, test } from './fixtures.ts';
import { mkdirSync } from 'node:fs';

const DIR = '../.local/shots';
mkdirSync(DIR, { recursive: true });

const SECTIONS = ['brand', 'languages', 'setup', 'key-types', 'categories', 'tags', 'sms', 'test-phones', 'sandbox', 'otp', 'admin-login', 'account-rules', 'app-versions', 'countries', 'report-titles', 'report-rules', 'payment-methods', 'economy-settings', 'gam-settings', 'items-settings', 'offer-settings', 'promo-settings'];
const PAGES2 = ['players', 'restrictions', 'reports', 'economy', 'currencies', 'metas', 'prizes', 'prize-groups', 'products', 'gifts', 'payments', 'event-types', 'event-log', 'event-rules', 'level-tables', 'meta-relations', 'streaks', 'tasks', 'task-groups', 'achievements', 'claims', 'item-types', 'items', 'offers', 'placements', 'banners', 'sponsors', 'chance-games', 'chance-plays'];

async function settle(page: Page) {
  await page.waitForTimeout(450);
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 8000 });
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

async function setPrefs(page: Page, locale: 'fa' | 'en', theme: 'light' | 'dark') {
  await prefs(page, locale, theme);
}

test.describe('screenshots', () => {
  test('fa light pages and sections', async ({ page }) => {
    await setPrefs(page, 'fa', 'light');
    await open(page, 'dashboard');
    await expect(page.getByTestId('page-dashboard')).toBeVisible();
    await shot(page, 'fa-dashboard');
    for (const p of PAGES2) {
      await open(page, p);
      await shot(page, `fa-${p}`);
    }
    await open(page, 'restrictions?status=all');
    await shot(page, 'fa-restrictions-all');
    await open(page, 'reports?status=all');
    await settle(page);
    const rp = page.locator('[data-testid^="rp-open-"]').first();
    if (await rp.count()) {
      await rp.click();
      await shot(page, 'fa-dialog-report');
      await page.keyboard.press('Escape');
    }
    await open(page, 'payments');
    await settle(page);
    const py = page.locator('[data-testid^="py-row-"]').first();
    if (await py.count()) {
      await py.click();
      await shot(page, 'fa-dialog-payment');
      await page.keyboard.press('Escape');
    }
    await open(page, 'players?status=tagged');
    await settle(page);
    const pl = page.locator('[data-testid^="pl-open-"]').first();
    if (await pl.count()) {
      await pl.click();
      await expect(page.getByTestId('pd-name')).toBeVisible();
      await shot(page, 'fa-player');
      await page.getByTestId('pd-suspend').click();
      await shot(page, 'fa-dialog-restrict');
      await page.keyboard.press('Escape');
    }
    await open(page, 'prizes');
    await page.getByTestId('pz-add').click();
    await page.getByTestId('item-add').click();
    await shot(page, 'fa-dialog-prize');
    await page.keyboard.press('Escape');
    await open(page, 'products');
    await page.getByTestId('pr-add').click();
    await page.getByTestId('pr-method-in_app').click();
    await shot(page, 'fa-dialog-product');
    await page.keyboard.press('Escape');
    await open(page, 'streaks');
    await page.getByTestId('sk-add').click();
    await page.getByTestId('sk-rewards-add').click();
    await page.getByTestId('sk-milestones-add').click();
    await page.getByTestId('sk-milestones-add').click();
    await page.locator('input[name="sk-milestone-1-day"]').fill('۳۰');
    await page.getByTestId('sk-dialog').locator('.dialog-body').evaluate(e => (e.scrollTop = e.scrollHeight));
    await shot(page, 'fa-dialog-streak');
    await page.keyboard.press('Escape');
    await open(page, 'chance-games');
    await page.getByTestId('cg-add').click();
    await page.locator('input[name="cg-slot-0-chance"]').fill('40');
    await page.getByTestId('cg-slots-add').click();
    await page.getByTestId('cg-slots-add').click();
    await page.locator('input[name="cg-slot-2-chance"]').fill('10');
    await page.getByTestId('cg-dialog').locator('.dialog-body').evaluate(e => (e.scrollTop = 260));
    await shot(page, 'fa-dialog-chance');
    await page.keyboard.press('Escape');
    await open(page, 'banners');
    await page.getByTestId('bn-add').click();
    await page.getByTestId('bn-dialog').locator('.dialog-body').evaluate(e => (e.scrollTop = 620));
    await shot(page, 'fa-dialog-banner');
    await page.keyboard.press('Escape');
    await open(page, 'tasks');
    await page.getByTestId('tk-add').click();
    await shot(page, 'fa-dialog-task');
    await page.keyboard.press('Escape');
    await open(page, 'offers');
    await page.getByTestId('of-add').click();
    await shot(page, 'fa-dialog-offer');
    await page.keyboard.press('Escape');
    await open(page, 'items');
    await page.getByTestId('im-add').click();
    await page.getByTestId('im-upgrades-add').click();
    await page.getByTestId('im-services-add').click();
    await page.getByTestId('im-dialog').locator('.dialog-body').evaluate(e => (e.scrollTop = 520));
    await shot(page, 'fa-dialog-item');
    await page.keyboard.press('Escape');
    await open(page, 'sponsors');
    await page.getByTestId('sp-add').click();
    await page.getByTestId('sp-dialog').locator('input[name="key"]').fill(`shot${Date.now() % 100000}`);
    await page.getByTestId('sp-dialog').locator('input[name="name-fa"]').fill('اسپانسر نمونه');
    await page.getByTestId('sp-dialog').getByTestId('dialog-save').click();
    await expect(page.getByTestId('sp-dialog')).toHaveCount(0);
    await page.locator('[data-testid^="sp-report-shot"]').first().click();
    await shot(page, 'fa-sponsor-report');
    await open(page, 'admins');
    await shot(page, 'fa-admins');
    await open(page, 'audit');
    await shot(page, 'fa-audit');
    for (const s of SECTIONS) {
      await open(page, `settings/${s}`);
      await expect(page.getByTestId(`st-${s}`)).toBeVisible();
      await shot(page, `fa-settings-${s}`);
    }
    await open(page, 'dashboard');
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('palette')).toBeVisible();
    await shot(page, 'fa-palette');
    await page.keyboard.press('Escape');
    await page.getByTestId('profile-btn').click();
    await shot(page, 'fa-profile-menu');
    await page.keyboard.press('Escape');
    await page.getByTestId('db-btn').click();
    await shot(page, 'fa-db-menu');
    await page.keyboard.press('Escape');
    await open(page, 'settings/categories');
    await page.getByTestId('ct-add').click();
    await shot(page, 'fa-dialog-category');
    await page.keyboard.press('Escape');
    await open(page, 'settings/sms');
    await page.getByTestId('sm-add').click();
    await shot(page, 'fa-dialog-sms');
    await page.keyboard.press('Escape');
    await open(page, 'dashboard');
    await open(page, 'settings/setup');
    await page.getByTestId('st-open-wizard').click();
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const step of ['brand', 'languages', 'sms', 'otp', 'review']) {
      await expect(page.getByTestId(`wz-body-${step}`)).toBeVisible();
      await shot(page, `fa-wizard-${step}`);
      if (step !== 'review') await page.getByTestId('wz-next').click();
    }
    await page.getByTestId('wz-close').click();
  });

  test('login and connect screens', async ({ browser }) => {
    const page = await freshPage(browser);
    await page.goto('/');
    await shot(page, 'fa-connect');
    await page.locator('#c-db').fill(process.env.STG_DB!);
  await page.getByTestId('connect-go').click();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await shot(page, 'fa-login');
  });

  test('en and dark and mobile', async ({ page }) => {
    await setPrefs(page, 'en', 'light');
    await open(page, 'dashboard');
    await shot(page, 'en-dashboard');
    await open(page, 'players');
    await shot(page, 'en-players');
    await open(page, 'settings/brand');
    await shot(page, 'en-settings-brand');
    await open(page, 'settings/sms');
    await shot(page, 'en-settings-sms');
    await open(page, 'economy');
    await shot(page, 'en-economy');
    await open(page, 'reports?status=all');
    await shot(page, 'en-reports');
    await open(page, 'settings/payment-methods');
    await shot(page, 'en-settings-payment-methods');
    await open(page, 'event-types');
    await shot(page, 'en-event-types');
    await open(page, 'chance-games');
    await shot(page, 'en-chance-games');
  });

  test('dark', async ({ page }) => {
    await setPrefs(page, 'fa', 'dark');
    await open(page, 'dashboard');
    await shot(page, 'dark-dashboard');
    await open(page, 'players');
    await shot(page, 'dark-players');
    await open(page, 'settings/categories');
    await shot(page, 'dark-settings-categories');
    await open(page, 'settings/sandbox');
    await shot(page, 'dark-settings-sandbox');
    await open(page, 'products');
    await shot(page, 'dark-products');
    await open(page, 'restrictions?status=all');
    await shot(page, 'dark-restrictions');
    await open(page, 'streaks');
    await shot(page, 'dark-streaks');
    await open(page, 'settings/promo-settings');
    await shot(page, 'dark-settings-promo-settings');
  });

  test('mobile', async ({ page }) => {
    await setPrefs(page, 'fa', 'light');
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'dashboard');
    await shot(page, 'mobile-dashboard');
    await open(page, 'players');
    await shot(page, 'mobile-players');
    await page.getByTestId('menu-btn').click();
    await shot(page, 'mobile-drawer');
    await open(page, 'settings/');
    await shot(page, 'mobile-settings-list');
    await open(page, 'settings/languages');
    await shot(page, 'mobile-settings-languages');
    await open(page, 'payments');
    await shot(page, 'mobile-payments');
    await open(page, 'economy');
    await shot(page, 'mobile-economy');
    await open(page, 'tasks');
    await shot(page, 'mobile-tasks');
    await open(page, 'banners');
    await shot(page, 'mobile-banners');
    await open(page, 'players?status=tagged');
    await settle(page);
    const pl = page.locator('[data-testid^="pl-card-"] a').first();
    if (await pl.count()) {
      await pl.click();
      await shot(page, 'mobile-player');
    }
  });
});
