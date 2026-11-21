import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ADMIN_PASSWORD, ADMIN_USER, lastSandboxCode, uniquePhone } from '../src/lib.ts';

export { ADMIN_USER, expect, lastSandboxCode, uniquePhone };

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
    for (const [key, value] of [['stg.locale', l], ['stg.theme', t]]) {
      localStorage.setItem(key, value);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    }
  }, [locale, theme] as const);
}

const stale = new WeakSet<Page>();

export function needsReload(page: Page) {
  stale.add(page);
}

export async function open(page: Page, hash: string) {
  if (stale.has(page) || !page.url().startsWith('http')) {
    stale.delete(page);
    await page.goto(`/#/${hash}`);
    await page.reload();
  } else {
    await page.goto(hash.startsWith('dashboard') ? '/#/audit' : '/#/dashboard');
    await page.goto(`/#/${hash}`);
  }
  await expect(page.locator('.topbar')).toBeVisible();
}

export async function toastOk(page: Page) {
  await expect(page.locator('.toast-ok').last()).toBeVisible();
}

export const adminPassword = () => ADMIN_PASSWORD;

export const stamp = () => String(Date.now() % 1_000_000);
