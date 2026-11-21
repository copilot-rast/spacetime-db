import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { lastSandboxCode, uniquePhone } from '../src/lib.ts';

export { expect, lastSandboxCode, uniquePhone };

export const STATE = '../.local/panel-owner.json';
export const VIEW = { width: 1280, height: 800 };

type Shared = { ctx: BrowserContext; page: Page };

const kept: BrowserContext[] = [];

export async function freshPage(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, ...opts });
  kept.push(ctx);
  return ctx.newPage();
}

export const test = base.extend<{ page: Page }, { shared: Shared }>({
  shared: [
    async ({ browser }, use) => {
      const ctx = await browser.newContext({ viewport: VIEW });
      kept.push(ctx);
      const page = await ctx.newPage();
      const state = JSON.parse(readFileSync(STATE, 'utf8'));
      const items: { name: string; value: string }[] = state.origins?.[0]?.localStorage ?? [];
      await page.goto('/#/dashboard');
      await page.evaluate(list => {
        localStorage.clear();
        for (const x of list) localStorage.setItem(x.name, x.value);
      }, items);
      await page.reload();
      await use({ ctx, page });
    },
    { scope: 'worker' },
  ],
  page: async ({ shared }, use) => {
    const page = shared.page;
    await page.setViewportSize(VIEW);
    await prefs(page, 'fa', 'light');
    await use(page);
  },
});

export async function prefs(page: Page, locale: 'fa' | 'en', theme: 'light' | 'dark') {
  if (!page.url().startsWith('http')) await page.goto('/#/dashboard');
  await page.evaluate(([l, t]) => {
    localStorage.setItem('stg.locale', l);
    localStorage.setItem('stg.theme', t);
  }, [locale, theme] as const);
}

export async function open(page: Page, hash: string) {
  await page.goto(`/#/${hash}`);
  await page.reload();
  await expect(page.locator('.topbar')).toBeVisible();
}

export async function toastOk(page: Page) {
  await expect(page.locator('.toast-ok').last()).toBeVisible();
}

export const stamp = () => String(Date.now() % 1_000_000);
