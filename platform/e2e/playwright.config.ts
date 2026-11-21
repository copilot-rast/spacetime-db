import { defineConfig } from '@playwright/test';

process.env.STG_DB ??= 'stg-panel';

export default defineConfig({
  testDir: './panel',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  outputDir: '../.local/test-results',
  use: {
    baseURL: process.env.PANEL_URL ?? 'http://127.0.0.1:7510',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'fa-IR',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'login', testMatch: /login\.setup\.ts/ },
    { name: 'panel', testMatch: /\.spec\.ts/, testIgnore: /mobile\.spec\.ts/, dependencies: ['login'] },
    { name: 'mobile', testMatch: /mobile\.spec\.ts/, dependencies: ['login'], use: { viewport: { width: 390, height: 844 } } },
  ],
});
