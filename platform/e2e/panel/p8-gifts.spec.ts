import type { Page } from '@playwright/test';
import { ECONOMY_QUERIES, ITEMS_QUERIES, PLAYER_QUERIES, SOCIAL_QUERIES, connect, login, loginOwner, tr, waitFor, type Client } from '../src/lib.ts';
import { expect, open, stamp, test, toastOk, uniquePhone } from './fixtures.ts';

const S = stamp();
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...ITEMS_QUERIES, ...SOCIAL_QUERIES];
const CUR = `gc${S}`;
const ITEM = `gi${S}`;
const TAG = `qt${S}`;
const rows = <T>(it: Iterable<T>) => [...it];

type QuotaArgs = Parameters<Client['conn']['reducers']['adminSaveQuotaSettings']>[0];
type GiftArgs = Parameters<Client['conn']['reducers']['adminSaveGiftSettings']>[0];

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

let owner: Client;
let a: { c: Client; id: bigint };
let b: { c: Client; id: bigint };
let quota0: QuotaArgs;
let gift0: GiftArgs;
const made = { tag: 0n, currency: 0n, item: 0n };

function quotaArgs(): QuotaArgs {
  const { id: _i, updatedAt: _u, ...rest } = rows(owner.conn.db.adminQuotaSettings.iter())[0];
  return rest;
}

function giftArgs(): GiftArgs {
  const { id: _i, updatedAt: _u, ...rest } = rows(owner.conn.db.adminGiftSettings.iter())[0];
  return rest;
}

async function confirm(page: Page) {
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
}

async function save(page: Page, id: string) {
  await page.getByTestId(id).last().getByTestId('dialog-save').click();
  await expect(page.getByTestId(id)).toHaveCount(0);
}

async function player() {
  const c = await connect(undefined, Q);
  const r = await login(c, uniquePhone('0939'));
  return { c, id: r.accountId };
}

const bal = (c: Client) => rows(c.conn.db.myWallet.iter()).find(w => w.currencyKey === CUR)?.balance ?? 0n;

test.beforeAll(async () => {
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await waitFor(() => rows(owner.conn.db.adminQuotaSettings.iter()).length > 0 && rows(owner.conn.db.adminGiftSettings.iter()).length > 0);
  quota0 = quotaArgs();
  gift0 = giftArgs();
  const r = owner.conn.reducers;
  await r.adminSaveTag({ id: 0n, keyType: 'user', key: TAG, title: tr(`ویژه ${S}`), color: '#2f7d5b', sort: 0, isActive: true });
  await r.adminSaveCurrency({ id: 0n, key: CUR, name: tr(`الماس ${S}`), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await r.adminSaveItem({
    id: 0n, key: ITEM, typeKey: 'skin', name: tr(`کلاه طلایی ${S}`), description: [], iconUrl: '', imageUrl: '', categoryId: 0n, tagIds: [], rarity: 'common', stackable: false, maxStack: 0, requiresKey: '', isStarter: false, starterQuantity: 0,
    levelTableId: 0n, unlockLevel: 0, price: undefined, upgrades: [], services: [], usePrizeId: 0n, metadata: '', sort: 0, isActive: true,
  });
  await waitFor(() => rows(owner.conn.db.tag.iter()).some(x => x.key === TAG) && rows(owner.conn.db.currency.iter()).some(x => x.key === CUR) && rows(owner.conn.db.item.iter()).some(x => x.key === ITEM));
  made.tag = rows(owner.conn.db.tag.iter()).find(x => x.key === TAG && x.keyType === 'user')!.id;
  made.currency = rows(owner.conn.db.currency.iter()).find(x => x.key === CUR)!.id;
  made.item = rows(owner.conn.db.item.iter()).find(x => x.key === ITEM)!.id;
  a = await player();
  b = await player();
  await a.c.conn.procedures.friendRequest({ targetIds: [b.id] });
  await b.c.conn.reducers.friendAccept({ accountId: a.id });
  await waitFor(() => rows(a.c.conn.db.myFriends.iter()).some(f => f.accountId === b.id));
});

test.afterAll(async () => {
  const r = owner?.conn.reducers;
  if (r) {
    await r.adminSaveQuotaSettings(quota0).catch(() => {});
    await r.adminSaveGiftSettings(gift0).catch(() => {});
    await r.adminSetGiftable({ kind: 'item', key: ITEM, giftable: undefined }).catch(() => {});
    for (const x of rows(owner.conn.db.adminQuotaRules.iter()).filter(x => x.name.includes(S))) await r.adminDeleteQuotaRule({ id: x.id }).catch(() => {});
    for (const x of rows(owner.conn.db.adminGiftRules.iter()).filter(x => x.name.includes(S))) await r.adminDeleteGiftRule({ id: x.id }).catch(() => {});
    await r.adminDeleteItem({ id: made.item }).catch(() => {});
    await r.adminDeleteTag({ id: made.tag }).catch(() => {});
    await r.adminDeleteCurrency({ id: made.currency }).catch(() => {});
  }
  owner?.conn.disconnect();
  a?.c.conn.disconnect();
  b?.c.conn.disconnect();
});

test('quota settings: dependent fields, enable, translated error, back to off', async ({ page }) => {
  await open(page, 'settings/quota-settings');
  const f = page.getByTestId('qs-form');
  await expect(f).toBeVisible();
  await expect(f.locator('input[name="friendDailyMessages"]')).toHaveCount(0);
  await f.locator('select[name="friendPolicy"]').selectOption('separate');
  await expect(f.locator('input[name="friendDailyMessages"]')).toBeVisible();
  await f.locator('select[name="friendPolicy"]').selectOption(quota0.friendPolicy);
  await expect(f.locator('input[name="packExpiryDays"]')).toHaveCount(quota0.packMeta ? 1 : 0);
  await f.getByRole('button', { name: 'گفتگوهای تازه' }).click();
  await expect(f.locator('input[name="dailyMessages"]')).toHaveCount(0);
  await expect(f.locator('input[name="dailyConversations"]')).toBeVisible();
  await f.getByRole('button', { name: 'پیام‌ها', exact: true }).click();
  await expect(f).toContainText('{reset}');
  await page.getByTestId('qs-enabled').click();
  await page.getByTestId('qs-save').click();
  await toastOk(page);
  expect(await waitFor(() => rows(owner.conn.db.adminQuotaSettings.iter())[0]?.enabled === true)).toBe(true);
  await f.locator('input[name="dailyMessages"]').fill('200000');
  await page.getByTestId('qs-save').click();
  await expect(f.locator('.err-box')).toContainText('پیام رایگان در روز');
  await f.locator('input[name="dailyMessages"]').fill(String(quota0.dailyMessages));
  await page.getByTestId('qs-enabled').click();
  await page.getByTestId('qs-save').click();
  await toastOk(page);
  expect(await waitFor(() => rows(owner.conn.db.adminQuotaSettings.iter())[0]?.enabled === quota0.enabled && rows(owner.conn.db.adminQuotaSettings.iter())[0]?.dailyMessages === quota0.dailyMessages)).toBe(true);
  await page.getByTestId('st-close').click();
});

test('quota rules: create with a tag, limit required, edit to unlimited, delete', async ({ page }) => {
  await open(page, 'quota-rules');
  await expect(page.getByTestId('page-quota-rules')).toBeVisible();
  await page.getByTestId('qr-add').click();
  const d = page.getByTestId('qr-dialog');
  await d.locator('input[name="name"]').fill(`ویژه‌ها ${S}`);
  await d.getByTestId(`qr-tags-${TAG}`).click();
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('دست‌کم یک سقف');
  await d.locator('input[name="dailyMessages"]').fill('۵۰');
  await save(page, 'qr-dialog');
  await toastOk(page);
  expect(await waitFor(() => rows(owner.conn.db.adminQuotaRules.iter()).some(x => x.name === `ویژه‌ها ${S}`))).toBe(true);
  const rule = rows(owner.conn.db.adminQuotaRules.iter()).find(x => x.name === `ویژه‌ها ${S}`)!;
  expect(rule.dailyMessages).toBe(50);
  expect(rule.dailyConversations).toBeUndefined();
  const row = page.getByTestId(`qr-row-${rule.id}`);
  await expect(row).toContainText(`ویژه ${S}`);
  await expect(row).toContainText('۵۰');
  await page.getByTestId(`qr-edit-${rule.id}`).click();
  await d.getByTestId('qr-unlimited').click();
  await expect(d.locator('input[name="dailyMessages"]')).toHaveCount(0);
  await save(page, 'qr-dialog');
  await expect(row).toContainText('نامحدود');
  await page.getByTestId(`qr-del-${rule.id}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('player quota card: grant a pack, revoke it, reset today', async ({ page }) => {
  await open(page, `player?id=${a.id}`);
  const card = page.getByTestId('pq-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('pq-packs')).toHaveText('۰', { timeout: 30_000 });
  await card.getByTestId('pq-grant').click();
  const d = page.getByTestId('pq-grant-dialog');
  await d.locator('input[name="amount"]').fill('0');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('مقدار درست نیست');
  await d.locator('input[name="amount"]').fill('7');
  await d.getByRole('button', { name: 'چند روز' }).click();
  await d.locator('input[name="expiresInDays"]').fill('3');
  await d.locator('input[name="note"]').fill(`جبران ${S}`);
  await save(page, 'pq-grant-dialog');
  await toastOk(page);
  await expect(card.getByTestId('pq-packs')).toHaveText('۷');
  await expect(card.getByTestId('pq-lots')).toContainText(`جبران ${S}`);
  await expect(card.getByTestId('pq-lots')).toContainText('۷ از ۷');
  await card.locator('[data-testid^="pq-revoke-"]').first().click();
  await confirm(page);
  await expect(card.getByTestId('pq-packs')).toHaveText('۰', { timeout: 30_000 });
  await expect(card.getByTestId('pq-lots')).toContainText('۰ از ۷');
  await card.getByTestId('pq-reset').click();
  await confirm(page);
  await expect(page.locator('.toast-ok').last()).toContainText('صفر شد');
});

test('gift settings: dependent fields, save, translated error, restore', async ({ page }) => {
  await open(page, 'settings/gift-settings');
  const f = page.getByTestId('gs-form');
  await expect(f).toBeVisible();
  await expect(f.getByTestId('gs-cur')).toHaveCount(gift0.currencyEnabled ? 1 : 0);
  if (!gift0.currencyEnabled) await f.getByTestId('gs-currency').click();
  await expect(f.getByTestId('gs-cur')).toBeVisible();
  await f.getByTestId('gs-cur-add').click();
  const i = gift0.currencies.length;
  await f.getByTestId(`gs-cur-${i}-key`).selectOption(CUR);
  await f.getByTestId(`gs-cur-${i}`).locator('input[name="curMax"]').fill('500');
  await expect(f.locator('input[name="expiryHours"]')).toHaveCount(gift0.delivery === 'accept' ? 1 : 0);
  await f.getByRole('button', { name: 'با قبول گیرنده' }).click();
  await expect(f.locator('input[name="expiryHours"]')).toBeVisible();
  await f.locator('input[name="perSenderDaily"]').fill('20000');
  await page.getByTestId('gs-save').click();
  await expect(f.locator('.err-box')).toContainText('هدیهٔ هر فرستنده در روز');
  await f.locator('input[name="perSenderDaily"]').fill('9');
  await page.getByTestId('gs-save').click();
  await toastOk(page);
  expect(
    await waitFor(() => {
      const s = rows(owner.conn.db.adminGiftSettings.iter())[0];
      return s?.perSenderDaily === 9 && s.delivery === 'accept' && s.currencyEnabled && s.currencies.some(c => c.currencyKey === CUR && c.max === 500n);
    })
  ).toBe(true);
  await owner.conn.reducers.adminSaveGiftSettings(gift0);
  expect(await waitFor(() => rows(owner.conn.db.adminGiftSettings.iter())[0]?.perSenderDaily === gift0.perSenderDaily)).toBe(true);
  await page.getByTestId('st-close').click();
});

test('gift rules: create, edit, delete', async ({ page }) => {
  await open(page, 'gift-rules');
  await page.getByTestId('gr-add').click();
  const d = page.getByTestId('gr-dialog');
  await d.locator('input[name="name"]').fill(`هدیه‌بازها ${S}`);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('برچسب');
  await d.getByTestId(`gr-tags-${TAG}`).click();
  await d.locator('input[name="perPairDaily"]').fill('20000');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('۱۰٬۰۰۰');
  await d.locator('input[name="perPairDaily"]').fill('4');
  await save(page, 'gr-dialog');
  expect(await waitFor(() => rows(owner.conn.db.adminGiftRules.iter()).some(x => x.name === `هدیه‌بازها ${S}`))).toBe(true);
  const rule = rows(owner.conn.db.adminGiftRules.iter()).find(x => x.name === `هدیه‌بازها ${S}`)!;
  expect(rule.perPairDaily).toBe(4);
  const row = page.getByTestId(`gr-row-${rule.id}`);
  await expect(row).toContainText('۴');
  await page.getByTestId(`gr-edit-${rule.id}`).click();
  await d.getByTestId('gr-can-send').click();
  await save(page, 'gr-dialog');
  await expect(row).toContainText('نمی‌تواند هدیه بفرستد');
  await page.getByTestId(`gr-del-${rule.id}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('giftables: set yes, no and back to default on a new item', async ({ page }) => {
  await open(page, `giftables?q=${ITEM}`);
  const row = page.getByTestId(`gb-row-item-${ITEM}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId('gb-table').locator('tbody tr')).toHaveCount(1);
  await expect(row).toContainText('از پیش‌فرض');
  await row.getByTestId(`gb-item-${ITEM}-no`).click();
  await expect(row).toContainText('غیرقابل هدیه');
  await expect(row).toContainText('تنظیم همین ردیف');
  expect(await waitFor(() => rows(owner.conn.db.adminGiftables.iter()).some(x => x.key === `item:${ITEM}` && !x.giftable))).toBe(true);
  await row.getByTestId(`gb-item-${ITEM}-yes`).click();
  await expect(row.locator('.badge')).toHaveText('قابل هدیه');
  await row.getByTestId(`gb-item-${ITEM}-default`).click();
  await expect(row).toContainText('از پیش‌فرض');
  expect(await waitFor(() => !rows(owner.conn.db.adminGiftables.iter()).some(x => x.key === `item:${ITEM}`))).toBe(true);
  await page.getByTestId('gb-kind').selectOption('product');
  await expect(row).toHaveCount(0);
});

test('friend gifts: log, detail, translated reverse error, reverse to the sender', async ({ page }) => {
  await owner.conn.reducers.adminSaveGiftSettings({ ...gift0, enabled: true, recipients: 'friends', delivery: 'instant', currencyEnabled: true, currencies: [{ currencyKey: CUR, min: 1n, max: 0n }], perSenderDaily: 0, perRecipientDaily: 0, perPairDaily: 0 });
  await waitFor(() => rows(owner.conn.db.adminGiftSettings.iter())[0]?.currencies.some(c => c.currencyKey === CUR) ?? false);
  await owner.conn.reducers.adminAdjust({ accountId: a.id, kind: 'currency', key: CUR, action: 'add', value: 500, note: 'test' });
  expect(await waitFor(() => bal(a.c) === 500n)).toBe(true);
  const sent = await a.c.conn.procedures.giftSend({ friendId: b.id, itemKey: '', quantity: 0, currencyKey: CUR, amount: 120n, productId: 0n, method: '', giftCode: '', message: `مبارکه ${S}`, requestId: `p8-${S}` });
  expect(sent.status).toBe('delivered');
  expect(await waitFor(() => bal(b.c) === 120n && bal(a.c) === 380n)).toBe(true);
  const id = sent.giftId;
  await open(page, `friend-gifts?player=${a.id}`);
  const row = page.getByTestId(`fg-row-${id}`);
  await expect(row).toContainText('رسید');
  await expect(row).toContainText(`الماس ${S}`);
  await expect(row).toContainText('۱۲۰');
  await page.getByTestId('fg-status').selectOption('reversed');
  await expect(row).toHaveCount(0);
  await page.getByTestId('fg-status').selectOption('delivered');
  await page.getByTestId('fg-kind').selectOption('currency');
  await expect(row).toBeVisible();
  await page.getByTestId(`fg-open-${id}`).click();
  await expect(page.getByTestId('page-friend-gift')).toBeVisible();
  await expect(page.getByTestId('fgd-status')).toHaveText('رسید');
  await expect(page.getByTestId('fgd-details')).toContainText(`مبارکه ${S}`);
  await expect(page.getByTestId('fgd-trail')).toContainText('فرستادن هدیه');
  await owner.conn.reducers.adminAdjust({ accountId: b.id, kind: 'currency', key: CUR, action: 'set', value: 20, note: 'test' });
  expect(await waitFor(() => bal(b.c) === 20n)).toBe(true);
  await page.getByTestId('fgd-reverse').click();
  const d = page.getByTestId('fgd-reverse-dialog');
  await expect(d.getByTestId('fgd-return-refund')).toBeDisabled();
  await d.locator('textarea[name="note"]').fill(`اشتباه ${S}`);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('موجودی کافی نیست');
  await owner.conn.reducers.adminAdjust({ accountId: b.id, kind: 'currency', key: CUR, action: 'set', value: 120, note: 'test' });
  expect(await waitFor(() => bal(b.c) === 120n)).toBe(true);
  await d.getByTestId('fgd-return-sender').click();
  await save(page, 'fgd-reverse-dialog');
  await expect(page.getByTestId('fgd-status')).toHaveText('برگردانده شد');
  await expect(page.getByTestId('fgd-details')).toContainText('به فرستنده برگشت');
  await expect(page.getByTestId('fgd-details')).toContainText(`اشتباه ${S}`);
  await expect(page.getByTestId('fgd-trail')).toContainText('برگرداندن هدیه از پنل');
  await expect(page.getByTestId('fgd-reverse')).toHaveCount(0);
  expect(await waitFor(() => bal(b.c) === 0n && bal(a.c) === 500n)).toBe(true);
  await page.getByTestId('fgd-back').click();
  await expect(page.getByTestId('page-friend-gifts')).toBeVisible();
  await owner.conn.reducers.adminSaveGiftSettings(gift0);
  expect(await waitFor(() => rows(owner.conn.db.adminGiftSettings.iter())[0]?.currencyEnabled === gift0.currencyEnabled)).toBe(true);
});

test('quota and gift reports render with tiles and charts', async ({ page }) => {
  await open(page, 'gift-report');
  await expect(page.getByTestId('grp-tile-0')).toBeVisible();
  await expect(page.getByTestId('grp-status-list')).toContainText('برگردانده شد');
  await expect(page.getByTestId('grp-senders')).toBeVisible();
  await page.getByTestId('sg-days-7').click();
  await expect(page).toHaveURL(/days=7/);
  await open(page, 'quota-report');
  await expect(page.getByTestId('qrp-tile-0')).toBeVisible();
  await expect(page.getByTestId('qrp-tile-7')).toContainText('بسته از پنل');
});
