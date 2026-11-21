import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PUBLICATION_QUERIES, connect, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { STATE, open, stamp } from './fixtures.ts';

const MOBILE = { width: 390, height: 844 };
const S = stamp();

const test = base.extend<{ page: Page }, { mobile: { ctx: BrowserContext; page: Page } }>({
  mobile: [
    async ({ browser }, use) => {
      const ctx = await browser.newContext({ viewport: MOBILE });
      const page = await ctx.newPage();
      const items: { name: string; value: string }[] = JSON.parse(readFileSync(STATE, 'utf8')).origins?.[0]?.localStorage ?? [];
      await page.goto('/#/dashboard');
      await page.evaluate(list => {
        localStorage.clear();
        for (const x of list) localStorage.setItem(x.name, x.value);
        localStorage.setItem('stg.locale', 'fa');
        localStorage.setItem('stg.theme', 'light');
      }, items);
      await page.reload();
      await use({ ctx, page });
    },
    { scope: 'worker' },
  ],
  page: async ({ mobile }, use) => {
    await use(mobile.page);
  },
});

let owner: Client;
let campaignId = 0n;

test.beforeAll(async () => {
  owner = await connect(undefined, PUBLICATION_QUERIES);
  await loginOwner(owner);
  const tr = (t: string) => [{ lang: 'fa', text: t }];
  await owner.conn.reducers.adminSaveCampaign({
    id: 0n,
    name: `موبایل ${S}`,
    categoryKey: 'offers',
    channels: ['inbox'],
    title: tr(`پیام موبایل ${S}`),
    body: tr('متن'),
    imageUrl: '',
    actionType: 'none',
    actionValue: '',
    actionLabel: [],
    prizeId: 0n,
    target: 'all',
    accountIds: [],
    tagIds: [],
    excludeTagIds: [],
    levelTableId: 0n,
    minLevel: 0,
    maxLevel: 0,
    countries: [],
    inactiveDays: 0,
    schedule: 'now',
    scheduledAt: 0n,
    repeatMinutes: 0,
    repeatUntil: 0n,
    quietStart: 0,
    quietEnd: 0,
  });
  await waitFor(() => [...owner.conn.db.adminCampaigns.iter()].some(c => c.name === `موبایل ${S}`));
  campaignId = [...owner.conn.db.adminCampaigns.iter()].find(c => c.name === `موبایل ${S}`)!.id;
});

test.afterAll(async () => {
  if (campaignId) await owner.conn.reducers.adminDeleteCampaign({ id: campaignId }).catch(() => {});
  owner?.conn.disconnect();
});

test('mobile width uses cards and a drawer', async ({ page }) => {
  await open(page, 'players');
  await expect(page.getByTestId('pl-cards')).toBeVisible();
  await expect(page.getByTestId('pl-table')).toBeHidden();
  await expect(page.locator('.side')).toBeHidden();
  await page.getByTestId('menu-btn').click();
  await expect(page.locator('.side')).toBeVisible();
  await page.getByTestId('rail-access').click();
  await expect(page.getByTestId('page-admins')).toBeVisible();
  await expect(page.locator('.side')).toBeVisible();
  await page.getByTestId('side-admins').click();
  await expect(page.getByTestId('page-admins')).toBeVisible();
  await expect(page.locator('.side')).toBeHidden();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test('mobile publication pages: campaigns become cards and the drawer reaches the menu', async ({ page }) => {
  await open(page, 'dashboard');
  await page.getByTestId('menu-btn').click();
  await page.getByTestId('rail-publication').click();
  await expect(page.getByTestId('page-messages')).toBeVisible();
  await expect(page.locator('.side')).toBeVisible();
  await page.getByTestId('side-campaigns').click();
  await expect(page.getByTestId('page-campaigns')).toBeVisible();
  await expect(page.locator('.side')).toBeHidden();
  await expect(page.getByTestId('cm-table')).toBeHidden();
  const card = page.locator('.cards .pcard').filter({ hasText: `موبایل ${S}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText('پیش‌نویس');
  await expect(page.getByTestId(`cmc-send-${campaignId}`)).toBeVisible();
  await page.getByTestId(`cmc-edit-${campaignId}`).click();
  await expect(page.getByTestId('cm-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  for (const p of ['campaigns', 'messages', 'news', 'news-comments', 'faq']) {
    await open(page, p);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, p).toBeLessThanOrEqual(390);
  }
});
