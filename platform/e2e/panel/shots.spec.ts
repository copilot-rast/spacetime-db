import { type Page } from '@playwright/test';
import { expect, freshPage, open, prefs, test } from './fixtures.ts';
import { mkdirSync } from 'node:fs';

const DIR = '../.local/shots';
mkdirSync(DIR, { recursive: true });

const SECTIONS = ['brand', 'languages', 'setup', 'key-types', 'categories', 'tags', 'sms', 'test-phones', 'sandbox', 'otp'];

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
  await page.reload();
}

test.describe('screenshots', () => {
  test('fa light pages and sections', async ({ page }) => {
    await setPrefs(page, 'fa', 'light');
    await open(page, 'dashboard');
    await expect(page.getByTestId('page-dashboard')).toBeVisible();
    await shot(page, 'fa-dashboard');
    await open(page, 'players');
    await expect(page.getByTestId('pl-table')).toBeVisible();
    await shot(page, 'fa-players');
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
    await page.getByTestId('connect-go').click();
    await expect(page.getByTestId('login-phone')).toBeVisible();
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
  });
});
