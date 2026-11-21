import { expect, open, test } from './fixtures.ts';

const PAGES = ['dashboard', 'players', 'restrictions', 'reports', 'economy', 'currencies', 'metas', 'prizes', 'prize-groups', 'products', 'gifts', 'payments'];
const SECTIONS = ['tags', 'account-rules', 'app-versions', 'countries', 'report-titles', 'report-rules', 'payment-methods', 'economy-settings'];

test('every new page renders without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  for (const p of PAGES) {
    await open(page, p);
    await page.waitForTimeout(700);
    await expect(page.locator('.skel')).toHaveCount(0, { timeout: 8000 });
    await page.screenshot({ path: `../.local/smoke/${p}.png` });
  }
  for (const s of SECTIONS) {
    await open(page, `settings/${s}`);
    await expect(page.getByTestId(`st-${s}`)).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `../.local/smoke/st-${s}.png` });
  }
  await open(page, 'players');
  await page.locator('[data-testid^="pl-open-"]').first().click();
  await expect(page.getByTestId('pd-name')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `../.local/smoke/player.png`, fullPage: true });
  console.log(errors.join('\n'));
  expect(errors).toEqual([]);
});
