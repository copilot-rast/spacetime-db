import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ECONOMY_QUERIES, ITEMS_QUERIES, PLAYER_QUERIES, SOCIAL_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, open, prefs, stamp, test, uniquePhone } from './fixtures.ts';

const DIR = '../.local/shots/panel8';
mkdirSync(DIR, { recursive: true });
const S = stamp();
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...ITEMS_QUERIES, ...SOCIAL_QUERIES];
const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];
const rows = <T>(it: Iterable<T>) => [...it];
const CUR = `gem${S}`;
const ITEM = `crown${S}`;

type QuotaArgs = Parameters<Client['conn']['reducers']['adminSaveQuotaSettings']>[0];
type GiftArgs = Parameters<Client['conn']['reducers']['adminSaveGiftSettings']>[0];

test.describe.configure({ mode: 'serial' });

let owner: Client;
const players: { c: Client; id: bigint }[] = [];
let quota0: QuotaArgs;
let gift0: GiftArgs;
const made = { tags: [] as bigint[], currency: 0n, item: 0n, quotaRules: [] as bigint[], giftRules: [] as bigint[], gift: 0n };

async function settle(page: Page) {
  await page.waitForTimeout(500);
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 30000 });
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: `${DIR}/gifts-${name}.png` });
}

async function player(name: string) {
  const c = await connect(undefined, Q);
  const r = await login(c, uniquePhone('0936'));
  await c.conn.reducers.updateProfile({ displayName: name, lang: 'fa' });
  const p = { c, id: r.accountId };
  players.push(p);
  return p;
}

async function befriend(a: { c: Client; id: bigint }, b: { c: Client; id: bigint }) {
  await a.c.conn.procedures.friendRequest({ targetIds: [b.id] });
  await b.c.conn.reducers.friendAccept({ accountId: a.id });
  await waitFor(() => rows(a.c.conn.db.myFriends.iter()).some(f => f.accountId === b.id));
}

const gift = (from: { c: Client }, to: { id: bigint }, a: Partial<Parameters<Client['conn']['procedures']['giftSend']>[0]>) =>
  from.c.conn.procedures.giftSend({ friendId: to.id, itemKey: '', quantity: 0, currencyKey: '', amount: 0n, productId: 0n, method: '', giftCode: '', message: '', requestId: '', ...a });

async function tag(key: string, fa: string, en: string, color: string) {
  await owner.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key, title: tr(fa, en), color, sort: 0, isActive: true });
  await waitFor(() => rows(owner.conn.db.tag.iter()).some(x => x.key === key && x.keyType === 'user'));
  const id = rows(owner.conn.db.tag.iter()).find(x => x.key === key && x.keyType === 'user')!.id;
  made.tags.push(id);
  return id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await waitFor(() => rows(owner.conn.db.adminQuotaSettings.iter()).length > 0 && rows(owner.conn.db.adminGiftSettings.iter()).length > 0);
  const { id: _a, updatedAt: _b, ...q } = rows(owner.conn.db.adminQuotaSettings.iter())[0];
  const { id: _c, updatedAt: _d, ...g } = rows(owner.conn.db.adminGiftSettings.iter())[0];
  quota0 = q;
  gift0 = g;
  const r = owner.conn.reducers;
  const vip = await tag(`vip${S}`, 'ویژه', 'VIP', '#b7791f');
  const fresh = await tag(`new${S}`, 'تازه‌وارد', 'Newcomer', '#2f7d5b');
  await r.adminSaveCurrency({ id: 0n, key: CUR, name: tr('الماس', 'Gems'), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await r.adminSaveItem({
    id: 0n, key: ITEM, typeKey: 'skin', name: tr('تاج طلایی', 'Golden crown'), description: [], iconUrl: '', imageUrl: '', categoryId: 0n, tagIds: [], rarity: 'rare', stackable: false, maxStack: 0, requiresKey: '', isStarter: false, starterQuantity: 0,
    levelTableId: 0n, unlockLevel: 0, price: undefined, upgrades: [], services: [], usePrizeId: 0n, metadata: '', sort: 0, isActive: true,
  });
  await waitFor(() => rows(owner.conn.db.currency.iter()).some(x => x.key === CUR) && rows(owner.conn.db.item.iter()).some(x => x.key === ITEM));
  made.currency = rows(owner.conn.db.currency.iter()).find(x => x.key === CUR)!.id;
  made.item = rows(owner.conn.db.item.iter()).find(x => x.key === ITEM)!.id;
  await r.adminSaveQuotaRule({ id: 0n, name: `بازیکن‌های ویژه ${S}`, tagIds: [vip], priority: 100, unlimited: true, dailyMessages: undefined, dailyConversations: undefined, friendDailyMessages: undefined, friendDailyConversations: undefined, isActive: true });
  await r.adminSaveQuotaRule({ id: 0n, name: `تازه‌واردها ${S}`, tagIds: [fresh], priority: 10, unlimited: false, dailyMessages: 3, dailyConversations: 2, friendDailyMessages: undefined, friendDailyConversations: undefined, isActive: true });
  await r.adminSaveGiftRule({ id: 0n, name: `هدیهٔ بیشتر برای ویژه‌ها ${S}`, tagIds: [vip], priority: 50, perSenderDaily: 20, perRecipientDaily: 0, perPairDaily: 5, canSend: true, isActive: true });
  await r.adminSaveGiftRule({ id: 0n, name: `تازه‌واردها هدیه نفرستند ${S}`, tagIds: [fresh], priority: 10, perSenderDaily: undefined, perRecipientDaily: undefined, perPairDaily: undefined, canSend: false, isActive: true });
  await waitFor(() => rows(owner.conn.db.adminQuotaRules.iter()).filter(x => x.name.includes(S)).length === 2 && rows(owner.conn.db.adminGiftRules.iter()).filter(x => x.name.includes(S)).length === 2);
  made.quotaRules = rows(owner.conn.db.adminQuotaRules.iter()).filter(x => x.name.includes(S)).map(x => x.id);
  made.giftRules = rows(owner.conn.db.adminGiftRules.iter()).filter(x => x.name.includes(S)).map(x => x.id);
  const sara = await player('سارا رحیمی');
  const reza = await player('رضا کاظمی');
  const nima = await player('نیما Gamer');
  await befriend(sara, reza);
  await befriend(sara, nima);
  await befriend(reza, nima);
  await r.adminSetPlayerTags({ accountId: nima.id, tagIds: [fresh] });
  await r.adminSetGiftable({ kind: 'item', key: ITEM, giftable: true });
  for (const p of [sara, reza]) await r.adminAdjust({ accountId: p.id, kind: 'currency', key: CUR, action: 'add', value: 900, note: 'shots' });
  await r.adminGiveItem({ accountId: sara.id, itemId: made.item, quantity: 1, note: 'shots' });
  await r.adminSaveGiftSettings({ ...gift0, enabled: true, currencyEnabled: true, currencies: [{ currencyKey: CUR, min: 10n, max: 500n }], perSenderDaily: 0, perRecipientDaily: 0, perPairDaily: 0 });
  await waitFor(() => rows(owner.conn.db.adminGiftSettings.iter())[0]?.currencies.some(c => c.currencyKey === CUR) ?? false);
  await waitFor(() => rows(sara.c.conn.db.myWallet.iter()).some(w => w.currencyKey === CUR && w.balance === 900n));
  const g1 = await gift(sara, reza, { currencyKey: CUR, amount: 150n, message: 'تولدت مبارک!' });
  await gift(reza, sara, { currencyKey: CUR, amount: 40n, message: 'ممنون رفیق' });
  await gift(sara, nima, { itemKey: ITEM, quantity: 1, message: 'برای مسابقهٔ امشب' });
  const g4 = await gift(reza, nima, { currencyKey: CUR, amount: 300n });
  await r.adminReverseFriendGift({ id: g4.giftId, returnTo: 'sender', note: 'اشتباهی فرستاده شد' });
  made.gift = g1.giftId;
  await r.adminSaveGiftSettings({ ...gift0, enabled: true, delivery: 'accept', currencyEnabled: true, currencies: [{ currencyKey: CUR, min: 10n, max: 500n }], perSenderDaily: 0, perRecipientDaily: 0, perPairDaily: 0 });
  await waitFor(() => rows(owner.conn.db.adminGiftSettings.iter())[0]?.delivery === 'accept');
  await gift(sara, reza, { currencyKey: CUR, amount: 60n, message: 'یک هدیهٔ کوچک' });
  await r.adminSaveGiftSettings(gift0);
  await r.adminSaveQuotaSettings({ ...quota0, enabled: true });
  await waitFor(() => rows(owner.conn.db.adminQuotaSettings.iter())[0]?.enabled === true);
  for (let i = 0; i < 5; i++) await nima.c.conn.procedures.chatSend({ channelId: 0n, peerId: sara.id, text: `سلام ${i}`, replyToId: 0n }).catch(() => undefined);
  for (let i = 0; i < 2; i++) await sara.c.conn.procedures.chatSend({ channelId: 0n, peerId: reza.id, text: `سلام ${i}`, replyToId: 0n }).catch(() => undefined);
  await r.adminQuotaGrant({ accountId: sara.id, amount: 30, expiresInDays: 30, note: 'جبران قطعی سرور' });
  await r.adminQuotaGrant({ accountId: sara.id, amount: 10, expiresInDays: 0, note: '' });
  await r.adminSaveQuotaSettings(quota0);
  await waitFor(() => rows(owner.conn.db.adminQuotaSettings.iter())[0]?.enabled === quota0.enabled);
});

test.afterAll(async () => {
  const r = owner?.conn.reducers;
  if (r) {
    await r.adminSaveQuotaSettings(quota0).catch(() => {});
    await r.adminSaveGiftSettings(gift0).catch(() => {});
    await r.adminSetGiftable({ kind: 'item', key: ITEM, giftable: undefined }).catch(() => {});
    for (const id of made.quotaRules) await r.adminDeleteQuotaRule({ id }).catch(() => {});
    for (const id of made.giftRules) await r.adminDeleteGiftRule({ id }).catch(() => {});
  }
  owner?.conn.disconnect();
  for (const p of players) p.c.conn.disconnect();
});

test('quota pages, settings and player card', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 'quota-rules');
  await shot(page, 'quota-rules');
  await page.getByTestId(`qr-edit-${made.quotaRules.find(id => rows(owner.conn.db.adminQuotaRules.iter()).find(x => x.id === id)?.unlimited === false)}`).click();
  await shot(page, 'dialog-quota-rule');
  await page.keyboard.press('Escape');
  await open(page, 'quota-report');
  await shot(page, 'quota-report');
  await open(page, 'settings/quota-settings');
  await settle(page);
  const f = page.getByTestId('qs-form');
  await f.locator('select[name="friendPolicy"]').selectOption('separate');
  await shot(page, 'settings-quota');
  await f.locator('section').nth(3).scrollIntoViewIfNeeded();
  await shot(page, 'settings-quota-2');
  await f.locator('section').nth(6).scrollIntoViewIfNeeded();
  await shot(page, 'settings-quota-3');
  await page.getByTestId('st-close').click();
  await open(page, `player?id=${players[0].id}`);
  const card = page.getByTestId('pq-card');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByTestId('pq-lots')).toBeVisible({ timeout: 30000 });
  await settle(page);
  await card.screenshot({ path: `${DIR}/gifts-player-quota-card.png` });
  await card.getByTestId('pq-grant').click();
  await page.getByTestId('pq-grant-dialog').getByRole('button', { name: 'چند روز' }).click();
  await shot(page, 'dialog-grant');
  await page.keyboard.press('Escape');
});

test('gift pages, settings and dialogs', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, 'gift-rules');
  await shot(page, 'gift-rules');
  await page.getByTestId(`gr-edit-${made.giftRules[0]}`).click();
  await shot(page, 'dialog-gift-rule');
  await page.keyboard.press('Escape');
  await open(page, 'giftables');
  await shot(page, 'giftables');
  await open(page, 'friend-gifts');
  await shot(page, 'friend-gifts');
  await open(page, `friend-gift?id=${made.gift}`);
  await expect(page.getByTestId('fgd-trail')).toBeVisible();
  await shot(page, 'friend-gift');
  await page.getByTestId('fgd-reverse').click();
  await shot(page, 'dialog-reverse');
  await page.keyboard.press('Escape');
  await open(page, 'gift-report');
  await shot(page, 'gift-report');
  await open(page, 'settings/gift-settings');
  await settle(page);
  const f = page.getByTestId('gs-form');
  if (!(await f.getByTestId('gs-cur').count())) await f.getByTestId('gs-currency').click();
  await f.getByTestId('gs-cur-add').click();
  await f.getByRole('button', { name: 'با قبول گیرنده' }).click();
  await shot(page, 'settings-gift');
  await f.locator('section').nth(2).scrollIntoViewIfNeeded();
  await shot(page, 'settings-gift-2');
  await f.locator('section').nth(5).scrollIntoViewIfNeeded();
  await shot(page, 'settings-gift-3');
  await page.getByTestId('st-close').click();
});

test('english and mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await prefs(page, 'en', 'light');
  await open(page, 'friend-gifts');
  await shot(page, 'en-friend-gifts');
  await open(page, 'gift-report');
  await shot(page, 'en-gift-report');
  await open(page, 'settings/quota-settings');
  await shot(page, 'en-settings-quota');
  await page.getByTestId('st-close').click();
  await open(page, `friend-gift?id=${made.gift}`);
  await shot(page, 'en-friend-gift');
  await prefs(page, 'fa', 'dark');
  await open(page, 'quota-report');
  await shot(page, 'dark-quota-report');
  await prefs(page, 'fa', 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'friend-gifts');
  await shot(page, 'mobile-friend-gifts');
  await open(page, 'giftables');
  await shot(page, 'mobile-giftables');
  await open(page, 'quota-rules');
  await shot(page, 'mobile-quota-rules');
  await page.setViewportSize({ width: 1280, height: 800 });
});
