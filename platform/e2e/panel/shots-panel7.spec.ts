import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ECONOMY_QUERIES, PLAYER_QUERIES, PUBLICATION_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, open, prefs, stamp, test, uniquePhone } from './fixtures.ts';

const DIR = '../.local/shots/panel7';
mkdirSync(DIR, { recursive: true });
const S = stamp();
const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];

let owner: Client;
let player: Client;
const made = { campaign: 0n, rule: 0n, news: [] as bigint[], source: 0n, faq: [] as bigint[] };

async function settle(page: Page) {
  await page.waitForTimeout(450);
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 8000 });
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

const msg = (title: string, en: string) => ({ categoryKey: 'offers', channels: ['inbox', 'push'], title: tr(title, en), body: tr('سلام {player}، یک هدیهٔ تازه در صندوق بازی منتظرت است.', 'Hi {player}, a new gift is waiting in your inbox.'), imageUrl: '', actionType: 'screen', actionValue: 'shop', actionLabel: tr('برو به فروشگاه', 'Open shop'), prizeId: 0n });

test.beforeAll(async () => {
  owner = await connect(undefined, [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...PUBLICATION_QUERIES]);
  await loginOwner(owner);
  player = await connect(undefined, PUBLICATION_QUERIES);
  const me = await login(player, uniquePhone('0938'));
  await player.conn.procedures.pushRegister({ token: `sandbox-ok-shot-${S}-bbbbbbbbbbbb`, platform: 'ios', appVersion: '2.4.1', deviceKey: `shot${S}` });
  const r = owner.conn.reducers;
  const base = { target: 'players', accountIds: [me.accountId], tagIds: [], excludeTagIds: [], levelTableId: 0n, minLevel: 0, maxLevel: 0, countries: [], inactiveDays: 0, scheduledAt: 0n, repeatMinutes: 0, repeatUntil: 0n, quietStart: 0, quietEnd: 0 };
  await r.adminSaveCampaign({ id: 0n, name: `جشنواره پاییز ${S}`, ...msg('جشنوارهٔ پاییز شروع شد', 'The autumn festival is on'), ...base, schedule: 'now', quietStart: 1380, quietEnd: 480 });
  await waitFor(() => [...owner.conn.db.adminCampaigns.iter()].some(c => c.name === `جشنواره پاییز ${S}`));
  made.campaign = [...owner.conn.db.adminCampaigns.iter()].find(c => c.name === `جشنواره پاییز ${S}`)!.id;
  await r.adminSendCampaign({ id: made.campaign });
  await owner.conn.procedures.adminPublicationRun({});
  await r.adminSaveAutoRule({ id: 0n, key: `welcome${S}`, name: 'خوش‌آمد بازیکن تازه', trigger: 'first_login', eventKey: '', matchField: '', matchValue: '', inactiveDays: 0, ...msg('به بازی خوش آمدی', 'Welcome to the game'), categoryKey: 'rewards', cooldownMinutes: 0, quietStart: 0, quietEnd: 0, isActive: true });
  await waitFor(() => [...owner.conn.db.adminAutoRules.iter()].some(x => x.key === `welcome${S}`));
  made.rule = [...owner.conn.db.adminAutoRules.iter()].find(x => x.key === `welcome${S}`)!.id;
  const news = (slug: string, title: string, en: string, status: string) =>
    r.adminSaveNews({
      id: 0n,
      slug,
      status,
      categoryId: 0n,
      tagIds: [],
      title: tr(title, en),
      summary: tr('خلاصهٔ کوتاه این خبر برای فهرست خبرها.', 'A short summary for the news list.'),
      body: tr('<h2>چه چیزهایی تازه است</h2><p>این نسخه <b>سه نقشهٔ تازه</b> و یک حالت گروهی دارد.</p><ul><li>نقشهٔ کویر</li><li>نقشهٔ جنگل</li></ul>', '<h2>What is new</h2><p>This version has <b>three new maps</b>.</p>'),
      coverUrl: '',
      isPinned: status === 'published',
      publishedAt: 0n,
      expiresAt: 0n,
      allowComment: true,
      freeComment: false,
      allowReaction: true,
      notifyMode: 'none',
      notifyTagIds: [],
      metaTitle: [],
      metaDescription: [],
      keywords: [],
      canonicalUrl: '',
      ogImage: '',
      noindex: false,
    });
  await news(`season-${S}`, 'فصل تازه با سه نقشهٔ جدید', 'A new season with three new maps', 'published');
  await news(`event-${S}`, 'مسابقهٔ آخر هفته', 'Weekend tournament', 'pending_review');
  await news(`draft-${S}`, 'یادداشت سازندگان', 'Notes from the makers', 'draft');
  await waitFor(() => [...owner.conn.db.adminNews.iter()].filter(n => n.slug.endsWith(`-${S}`)).length === 3);
  made.news = [...owner.conn.db.adminNews.iter()].filter(n => n.slug.endsWith(`-${S}`)).map(n => n.id);
  const pub = [...owner.conn.db.adminNews.iter()].find(n => n.slug === `season-${S}`)!;
  await player.conn.procedures.newsReact({ newsId: pub.id, reaction: 'like' });
  await player.conn.procedures.newsComment({ newsId: pub.id, message: 'نقشهٔ کویر عالی است، ممنون!', parentId: 0n });
  await r.adminSaveNewsSource({
    id: 0n,
    key: `blog${S}`,
    name: 'وبلاگ بازی',
    isActive: true,
    authMode: 'hmac',
    tokenHeader: 'x-news-token',
    signatureHeader: 'x-news-signature',
    timestampHeader: 'x-news-timestamp',
    skewSeconds: 300,
    secret: `shot-secret-${S}-abcdefgh`,
    itemsPath: 'data.items',
    mapping: '{}',
    bodyFormat: 'auto',
    defaultCategoryId: 0n,
    defaultLang: 'fa',
    defaultTagIds: [],
    publishMode: 'review',
    updateMode: 'update',
    rateLimitPerMinute: 60,
    notifyMode: 'none',
    allowComment: true,
    allowReaction: true,
  });
  await waitFor(() => [...owner.conn.db.adminNewsSources.iter()].some(x => x.key === `blog${S}`));
  made.source = [...owner.conn.db.adminNewsSources.iter()].find(x => x.key === `blog${S}`)!.id;
  await r.adminSaveFaq({ id: 0n, categoryId: 0n, question: tr('چطور سکه بگیرم؟', 'How do I get coins?'), answer: tr('با **بازی روزانه** و [فروشگاه](https://example.com).', 'Play **daily** or visit the [shop](https://example.com).'), isActive: true, sort: 1 });
  await r.adminSaveFaq({ id: 0n, categoryId: 0n, question: tr('رمزم را فراموش کرده‌ام', 'I forgot my password'), answer: tr('با شمارهٔ موبایل دوباره وارد شوید.', 'Sign in again with your phone.'), isActive: false, sort: 2 });
  await waitFor(() => [...owner.conn.db.adminFaqs.iter()].some(f => f.question.some(q => q.text === 'رمزم را فراموش کرده‌ام')));
  made.faq = [...owner.conn.db.adminFaqs.iter()].filter(f => f.createdAt.microsSinceUnixEpoch > BigInt(Date.now() - 120_000) * 1000n).map(f => f.id);
});

test.afterAll(async () => {
  const r = owner.conn.reducers;
  if (made.campaign) await r.adminCancelCampaign({ id: made.campaign }).catch(() => {});
  if (made.campaign) await r.adminDeleteCampaign({ id: made.campaign }).catch(() => {});
  if (made.rule) await r.adminDeleteAutoRule({ id: made.rule }).catch(() => {});
  for (const id of made.news) await r.adminDeleteNews({ id }).catch(() => {});
  if (made.source) await r.adminDeleteNewsSource({ id: made.source }).catch(() => {});
  for (const id of made.faq) await r.adminDeleteFaq({ id }).catch(() => {});
  owner.conn.disconnect();
  player.conn.disconnect();
});

test('panel7 screenshots in Persian, desktop', async ({ page }) => {
  await prefs(page, 'fa', 'light');
  for (const p of ['messages', 'campaigns', 'auto-rules', 'notify-categories', 'push', 'news', 'news-comments', 'news-sources', 'faq']) {
    await open(page, p);
    await shot(page, `fa-${p}`);
  }
  await open(page, 'campaigns');
  await page.getByTestId('cm-add').click();
  await shot(page, 'fa-dialog-campaign');
  await page.keyboard.press('Escape');
  await page.getByTestId(`cm-report-${made.campaign}`).click();
  await shot(page, 'fa-dialog-campaign-report');
  await page.keyboard.press('Escape');
  await open(page, 'news');
  await page.getByTestId(`nw-edit-season-${S}`).click();
  await shot(page, 'fa-dialog-news-content');
  await page.getByTestId('nw-dialog').getByRole('button', { name: 'انتشار', exact: true }).click();
  await shot(page, 'fa-dialog-news-publish');
  await page.getByTestId('nw-dialog').getByRole('button', { name: 'سئو', exact: true }).click();
  await shot(page, 'fa-dialog-news-seo');
  await page.keyboard.press('Escape');
  await page.getByTestId(`nw-status-event-${S}`).click();
  await shot(page, 'fa-news-status-menu');
  await page.keyboard.press('Escape');
  await open(page, 'news-sources');
  await page.getByTestId(`sr-sample-blog${S}`).click();
  await shot(page, 'fa-dialog-source-sample');
  await page.keyboard.press('Escape');
  await page.getByTestId(`sr-edit-blog${S}`).click();
  await shot(page, 'fa-dialog-source');
  await page.keyboard.press('Escape');
  await open(page, 'messages');
  await page.getByTestId('msg-send').click();
  await shot(page, 'fa-dialog-send');
  await page.keyboard.press('Escape');
  await open(page, 'auto-rules');
  await page.getByTestId(`ar-edit-welcome${S}`).click();
  await shot(page, 'fa-dialog-auto-rule');
  await page.keyboard.press('Escape');
  for (const s of ['pub-settings', 'news-settings', 'public-feeds']) {
    await page.goto(`/#/settings/${s}`);
    await expect(page.getByTestId(`st-${s}`)).toBeVisible();
    await shot(page, `fa-settings-${s}`);
  }
  await page.getByTestId('st-close').click();
  await page.goto(`/#/player?id=${[...player.conn.db.me.iter()][0].id}`);
  await expect(page.getByTestId('pd-messages')).toBeVisible();
  await page.getByTestId('pd-messages').scrollIntoViewIfNeeded();
  await settle(page);
  await page.getByTestId('pd-messages').screenshot({ path: `${DIR}/fa-player-messages-card.png` });
});

test('panel7 screenshots in English and dark', async ({ page }) => {
  await prefs(page, 'en', 'light');
  for (const p of ['campaigns', 'news']) {
    await open(page, p);
    await shot(page, `en-${p}`);
  }
  await prefs(page, 'fa', 'dark');
  await open(page, 'news');
  await shot(page, 'fa-dark-news');
  await prefs(page, 'fa', 'light');
});
