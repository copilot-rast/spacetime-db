import { test } from '@playwright/test';
import { ADMIN_USER, adminPassword, expect, freshPage, STATE } from './fixtures.ts';

test('admin logs in with username and password', async ({ browser }) => {
  const page = await freshPage(browser);
  await page.goto('/');
  await expect(page.getByTestId('connect')).toBeVisible();
  await expect(page.locator('#c-server')).toHaveValue(/\/stdb\/$/);
  await expect(page.locator('#c-db')).toHaveValue('stg-template');
  await page.locator('#c-db').fill(process.env.STG_DB!);
  await page.getByTestId('connect-go').click();
  await expect(page.getByTestId('login-password')).toBeVisible();
  await expect(page.getByTestId('brand-name')).not.toBeEmpty();
  await page.locator('#l-user').fill(ADMIN_USER);
  await page.locator('#l-pass').fill(adminPassword());
  await expect(page.locator('#l-pass')).toHaveAttribute('type', 'password');
  await page.getByTestId('login-pass-toggle').click();
  await expect(page.locator('#l-pass')).toHaveAttribute('type', 'text');
  await page.getByTestId('login-pass-toggle').click();
  await page.getByTestId('login-pass-go').click();
  await expect(page.locator('.rail')).toBeVisible();
  const wizard = page.getByTestId('wizard');
  await expect(page.getByTestId('page-dashboard')).toBeVisible();
  await page.waitForTimeout(800);
  if (await wizard.isVisible()) await page.getByTestId('wz-later').click();
  await expect(wizard).toHaveCount(0);
  await page.context().storageState({ path: STATE });
});
