import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ECONOMY_QUERIES, PLAYER_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, open, stamp, test, toastOk, uniquePhone } from './fixtures.ts';

const S = stamp();
const fa = (s: string | number) => String(s).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const EV = `ev${S}`;
const CUR = `gc${S}`;
const META = `xp${S}`;
const PRIZE = `gp${S}`;
const PRODUCT = `gk${S}`;
const tr = (fa: string) => [{ lang: 'fa', text: fa }];

test.describe.configure({ mode: 'serial' });

let owner: Client;
let player: { c: Client; phone: string; id: bigint };
let prizeId = 0n;
let productId = 0n;

async function confirm(page: Page) {
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
}

async function save(page: Page, id: string) {
  await page.getByTestId(id).last().getByTestId('dialog-save').click();
  await expect(page.getByTestId(id)).toHaveCount(0);
}

async function badToast(page: Page, text: string | RegExp) {
  await expect(page.locator('.toast-bad').last()).toContainText(text);
}

test.beforeAll(async () => {
  owner = await connect(undefined, [...PLAYER_QUERIES, ...ECONOMY_QUERIES]);
  await loginOwner(owner);
  const r = owner.conn.reducers;
  await r.adminSaveCurrency({ id: 0n, key: CUR, name: tr(`سکهٔ پیشرفت ${S}`), type: 'soft', defaultValue: 100n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await r.adminSaveMeta({ id: 0n, key: META, name: tr(`تجربه ${S}`), defaultValue: 0, serverOnly: false });
  await waitFor(() => [...owner.conn.db.currency.iter()].some(x => x.key === CUR) && [...owner.conn.db.meta.iter()].some(x => x.key === META));
  await r.adminSavePrize({ id: 0n, key: PRIZE, name: tr(`جایزهٔ پیشرفت ${S}`), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items: [{ type: 'currency', key: CUR, action: 'add', value: 5 }] });
  await waitFor(() => [...owner.conn.db.prize.iter()].some(x => x.key === PRIZE));
  prizeId = [...owner.conn.db.prize.iter()].find(x => x.key === PRIZE)!.id;
  await r.adminSaveProduct({
    id: 0n,
    key: PRODUCT,
    name: tr(`بستهٔ پیشرفت ${S}`),
    description: [],
    isActive: true,
    categoryId: 0n,
    tagIds: [],
    audienceTagIds: [],
    priceToman: 0n,
    coinCurrency: CUR,
    coinAmount: 10n,
    discountPercent: 0,
    paymentMethods: ['in_app'],
    skuBazaar: '',
    skuMyket: '',
    prizeId,
    iconUrl: '',
    coverUrl: '',
    sort: 0,
  });
  productId = (await owner.conn.procedures.adminProducts({ query: PRODUCT, categoryId: 0n, isActive: '', page: 1, pageSize: 10 })).rows.find(x => x.key === PRODUCT)!.id;
  const pc = await connect(undefined, [...PLAYER_QUERIES, ...ECONOMY_QUERIES]);
  const phone = uniquePhone('0931');
  const res = await login(pc, phone);
  player = { c: pc, phone, id: res.accountId };
});

test.afterAll(() => {
  owner?.conn.disconnect();
  player?.c.conn.disconnect();
});

test('event types: create, edit, system row is locked', async ({ page }) => {
  await open(page, 'event-types');
  await expect(page.getByTestId('et-del-login')).toHaveCount(0);
  await expect(page.getByTestId('et-row-login')).toContainText('هر مقدار');
  await page.getByTestId('et-add').click();
  const d = page.getByTestId('et-dialog');
  await d.locator('input[name="key"]').fill('Bad Key');
  await d.locator('input[name="name-fa"]').fill(`رویداد ${S}`);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('کلید رویداد');
  await d.locator('input[name="key"]').fill(EV);
  await d.locator('input[name="valueMax"]').fill('۱۰۰');
  await d.locator('input[name="rateLimit"]').fill('۲۰');
  await save(page, 'et-dialog');
  const row = page.getByTestId(`et-row-${EV}`);
  await expect(row).toContainText('۰ – ۱۰۰');
  await expect(row).toContainText('۲۰');
  await page.getByTestId(`et-edit-${EV}`).click();
  await d.locator('input[name="valueMin"]').fill('۵۰۰');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('کمترین مقدار');
  await d.locator('input[name="valueMin"]').fill('۰');
  await d.locator('input[name="name-fa"]').fill(`رویداد ${S} ویرایش`);
  await save(page, 'et-dialog');
  await expect(row).toContainText('ویرایش');
});

test('event rules: create, a granted claim, IN_USE refusals, claims page', async ({ page }) => {
  await open(page, 'event-rules');
  await page.getByTestId('er-add').click();
  const d = page.getByTestId('er-dialog');
  await d.locator('input[name="key"]').fill(`er${S}`);
  await d.locator('input[name="name-fa"]').fill('قانون تست');
  await d.getByTestId('er-event').selectOption(EV);
  await d.locator('select[name="repeat"]').selectOption('period');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('دورهٔ روزانه یا هفتگی');
  await d.locator('select[name="repeat"]').selectOption('once');
  await d.locator('input[name="threshold"]').fill('۱');
  await d.getByTestId('er-prize').selectOption(String(prizeId));
  await save(page, 'er-dialog');
  const row = page.getByTestId(`er-row-er${S}`);
  await expect(row).toContainText('≥ ۱');

  await page.goto(`/#/player?id=${player.id}`);
  await expect(page.getByTestId('pd-progress')).toBeVisible();
  await page.getByTestId('pp-record').click();
  const rec = page.getByTestId('rec-dialog');
  await rec.getByTestId('rec-type').selectOption(EV);
  await rec.locator('input[name="recMetadata"]').fill('{"from":"panel"}');
  await save(page, 'rec-dialog');

  await open(page, 'claims');
  await page.getByTestId('cl-player').fill(String(player.id));
  await expect(page.getByTestId('cl-table').locator('tbody tr').first()).toContainText('داده‌شده');
  await expect(page.getByTestId('cl-table')).toContainText('قانون رویداد');

  await open(page, `event-log?type=${EV}`);
  await expect(page.getByTestId('el-table')).toContainText('panel');
  await expect(page.getByTestId('el-table')).toContainText('مدیر');

  await open(page, 'event-rules');
  await page.getByTestId(`er-del-er${S}`).click();
  await confirm(page);
  await badToast(page, 'حذف نمی‌شود');
  await open(page, 'prizes');
  await page.getByTestId(`pz-del-${PRIZE}`).click();
  await confirm(page);
  await badToast(page, 'حذف نمی‌شود');
});

test('level tables and meta relations: rows editors, create, edit, delete', async ({ page }) => {
  await open(page, 'level-tables');
  await page.getByTestId('lt-add').click();
  const d = page.getByTestId('lt-dialog');
  await d.locator('input[name="key"]').fill(`lt${S}`);
  await d.locator('input[name="name-fa"]').fill('جدول تست');
  await d.getByTestId('lt-meta').selectOption(META);
  await d.locator('input[name="step-0-threshold"]').fill('۰');
  await d.getByTestId('lt-steps-add').click();
  await d.locator('input[name="step-1-threshold"]').fill('۱۰۰');
  await d.getByTestId('step-1-prize').selectOption(String(prizeId));
  await d.getByTestId('lt-steps-add').click();
  await d.locator('input[name="step-2-threshold"]').fill('۵۰');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('آستانه‌ها باید');
  await d.getByTestId('lt-steps-2-del').click();
  await save(page, 'lt-dialog');
  await expect(page.getByTestId(`lt-row-lt${S}`)).toContainText('۲ پله');
  await page.getByTestId(`lt-edit-lt${S}`).click();
  await d.getByTestId('lt-steps-add').click();
  await d.locator('input[name="step-2-threshold"]').fill('۳۰۰');
  await save(page, 'lt-dialog');
  await expect(page.getByTestId(`lt-row-lt${S}`)).toContainText('۳ پله');
  await page.getByTestId(`lt-del-lt${S}`).click();
  await confirm(page);
  await expect(page.getByTestId(`lt-row-lt${S}`)).toHaveCount(0);

  await open(page, 'meta-relations');
  await page.getByTestId('mr-add').click();
  const m = page.getByTestId('mr-dialog');
  await m.locator('input[name="key"]').fill(`mr${S}`);
  await m.locator('input[name="name-fa"]').fill('رابطهٔ تست');
  await m.getByTestId('mr-meta').selectOption(META);
  await m.locator('input[name="conditionValue"]').fill('۱۰۰');
  await m.getByTestId('dialog-save').click();
  await expect(m.locator('.err-box')).toContainText('تغییر یا جایزه');
  await m.getByTestId('mr-targets-add').click();
  await m.getByTestId('mr-target-0-meta').selectOption(META);
  await m.locator('input[name="mr-target-0-amount"]').fill('-100');
  await m.locator('select[name="repeat"]').selectOption('rearm');
  await save(page, 'mr-dialog');
  const row = page.getByTestId(`mr-row-mr${S}`);
  await expect(row).toContainText('≥ ۱۰۰');
  await expect(row).toContainText('-۱۰۰');
  await page.getByTestId(`mr-edit-mr${S}`).click();
  await m.locator('input[name="maxFires"]').fill('۳');
  await save(page, 'mr-dialog');
  await page.getByTestId(`mr-del-mr${S}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('streaks: milestone editor with safe days, duplicate refused', async ({ page }) => {
  await open(page, 'streaks');
  await page.getByTestId('sk-add').click();
  const d = page.getByTestId('sk-dialog');
  await d.locator('input[name="key"]').fill(`sk${S}`);
  await d.locator('input[name="name-fa"]').fill('استریک تست');
  await d.getByTestId('sk-event').selectOption(EV);
  await d.getByTestId('sk-rewards-add').click();
  await d.getByTestId('sk-reward-0-prize').selectOption(String(prizeId));
  await d.getByTestId('sk-milestones-add').click();
  await d.getByTestId('sk-milestones-add').click();
  await d.locator('input[name="sk-milestone-1-day"]').fill('۷');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('دو بار');
  await d.locator('input[name="sk-milestone-1-day"]').fill('۳۰');
  await d.getByTestId('sk-milestone-1-prize').selectOption(String(prizeId));
  await expect(d.getByTestId('sk-safe')).toContainText('۷، ۳۰');
  await d.locator('select[name="missAction"]').selectOption('step_back');
  await d.getByTestId('sk-repay').click();
  await save(page, 'sk-dialog');
  const row = page.getByTestId(`sk-row-sk${S}`);
  await expect(row).toContainText('۷، ۳۰');
  await page.getByTestId(`sk-edit-sk${S}`).click();
  await expect(d.getByTestId('sk-safe')).toContainText('۷، ۳۰');
  await d.getByTestId('sk-milestones-0-del').click();
  await save(page, 'sk-dialog');
  await expect(row).not.toContainText('۷،');
  await page.getByTestId(`sk-del-sk${S}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('tasks, sub-tasks, dependencies and task groups', async ({ page }) => {
  await open(page, 'tasks');
  const d = page.getByTestId('tk-dialog');
  await page.getByTestId('tk-add').click();
  await d.locator('input[name="key"]').fill(`tp${S}`);
  await d.locator('input[name="name-fa"]').fill('تسک والد');
  await d.getByTestId('tk-condition').selectOption('children');
  await save(page, 'tk-dialog');
  await page.getByTestId('tk-add').click();
  await d.locator('input[name="key"]').fill(`tc${S}`);
  await d.locator('input[name="name-fa"]').fill('زیرتسک');
  await d.getByTestId('tk-event').selectOption(EV);
  await d.locator('input[name="target"]').fill('۳');
  await d.getByTestId('tk-parent').selectOption({ label: 'تسک والد' });
  await save(page, 'tk-dialog');
  await page.getByTestId('tk-add').click();
  await d.locator('input[name="key"]').fill(`td${S}`);
  await d.locator('input[name="name-fa"]').fill('تسک وابسته');
  await d.getByTestId('tk-event').selectOption(EV);
  await d.getByTestId(`tk-dep-tp${S}`).click();
  await d.locator('select[name="repeat"]').selectOption('interval');
  await d.locator('input[name="repeatMinutes"]').fill('۶۰');
  await d.getByTestId('tk-prize').selectOption(String(prizeId));
  await save(page, 'tk-dialog');
  const dep = page.getByTestId(`tk-row-td${S}`);
  await expect(dep).toContainText('بعد از تسک والد');
  await expect(dep).toContainText('هر ۶۰ دقیقه');
  const rows = await page.getByTestId('tk-table').locator('tbody tr').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  expect(rows.indexOf(`tk-row-tc${S}`)).toBe(rows.indexOf(`tk-row-tp${S}`) + 1);
  await page.getByTestId(`tk-del-tp${S}`).click();
  await confirm(page);
  await badToast(page, 'زیرتسک دارد');

  await open(page, 'task-groups');
  await page.getByTestId('tgr-add').click();
  const g = page.getByTestId('tgr-dialog');
  await g.locator('input[name="key"]').fill(`tg${S}`);
  await g.locator('input[name="name-fa"]').fill('گروه تست');
  await g.locator('select[name="handout"]').selectOption('timer');
  await g.locator('input[name="handoutMinutes"]').fill('۳۰');
  await g.getByTestId('tgr-tasks-add').click();
  await g.getByTestId('tgr-task-0').selectOption({ label: 'تسک وابسته' });
  await save(page, 'tgr-dialog');
  await expect(page.getByTestId(`tgr-row-tg${S}`)).toContainText('هر ۳۰ دقیقه');
  await page.getByTestId(`tgr-edit-tg${S}`).click();
  await g.locator('input[name="activeCount"]').fill('۲');
  await save(page, 'tgr-dialog');
  await expect(page.getByTestId(`tgr-row-tg${S}`)).toContainText('۲ هم‌زمان');
  await page.getByTestId(`tgr-del-tg${S}`).click();
  await confirm(page);
  await expect(page.getByTestId(`tgr-row-tg${S}`)).toHaveCount(0);

  await open(page, 'tasks');
  for (const k of [`td${S}`, `tc${S}`, `tp${S}`]) {
    await page.getByTestId(`tk-del-${k}`).click();
    await confirm(page);
    await expect(page.getByTestId(`tk-row-${k}`)).toHaveCount(0);
  }
});

test('achievements: tiers, give and revoke on the player page', async ({ page }) => {
  await open(page, 'achievements');
  await page.getByTestId('ach-add').click();
  const d = page.getByTestId('ach-dialog');
  await d.locator('input[name="key"]').fill(`ac${S}`);
  await d.locator('input[name="name-fa"]').fill('دستاورد تست');
  await d.getByTestId('ach-event').selectOption(EV);
  await d.getByTestId('ach-tiers-add').click();
  await d.locator('input[name="tier-1-threshold"]').fill('۱');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('به ترتیب بالا');
  await d.locator('input[name="tier-1-threshold"]').fill('۵');
  await d.getByTestId('tier-1-prize').selectOption(String(prizeId));
  await d.locator('select[name="rarity"]').selectOption('epic');
  await d.getByTestId('ach-hidden').click();
  await d.locator('input[name="hint-fa"]').fill('راهنمای پنهان');
  await save(page, 'ach-dialog');
  const row = page.getByTestId(`ach-row-ac${S}`);
  await expect(row).toContainText('حماسی');
  await expect(row).toContainText('پنهان');

  await page.goto(`/#/player?id=${player.id}`);
  await page.getByTestId('pp-give-ach').click();
  const gd = page.getByTestId('give-ach-dialog');
  await gd.getByTestId('give-ach').selectOption({ label: 'دستاورد تست' });
  await save(page, 'give-ach-dialog');
  const achId = (await page.locator('[data-testid^="pp-ach-"]').first().getAttribute('data-testid'))!.replace('pp-ach-', '');
  await expect(page.getByTestId(`pp-ach-${achId}`)).toContainText('مرحلهٔ ۱');
  await page.getByTestId(`pp-revoke-${achId}`).click();
  await confirm(page);
  await expect(page.getByTestId(`pp-ach-${achId}`)).toHaveCount(0);

  await open(page, 'achievements');
  await page.getByTestId(`ach-del-ac${S}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('items: types, stackable and unique items, give and take, IN_USE', async ({ page }) => {
  await open(page, 'item-types');
  await expect(page.getByTestId('ityp-del-avatar')).toHaveCount(0);
  await page.getByTestId('ityp-add').click();
  const t = page.getByTestId('ityp-dialog');
  await t.locator('input[name="key"]').fill(`ty${S}`);
  await t.locator('input[name="name-fa"]').fill('نوع تست');
  await t.locator('input[name="slots"]').fill('۲');
  await save(page, 'ityp-dialog');
  await expect(page.getByTestId(`ityp-row-ty${S}`)).toContainText('۲ جا');
  await page.getByTestId(`ityp-edit-ty${S}`).click();
  await t.locator('input[name="slots"]').fill('۰');
  await save(page, 'ityp-dialog');
  await expect(page.getByTestId(`ityp-row-ty${S}`)).toContainText('پوشیدنی نیست');
  await page.getByTestId(`ityp-del-ty${S}`).click();
  await confirm(page);
  await expect(page.getByTestId(`ityp-row-ty${S}`)).toHaveCount(0);

  await open(page, 'items');
  const d = page.getByTestId('im-dialog');
  await page.getByTestId('im-add').click();
  await d.locator('input[name="key"]').fill(`hat${S}`);
  await d.locator('input[name="name-fa"]').fill(`کلاه ${S}`);
  await d.getByTestId('im-for-sale').click();
  await d.getByTestId('im-price-currency').selectOption(CUR);
  await d.locator('input[name="priceAmount"]').fill('۲۰');
  await d.getByTestId('im-upgrades-add').click();
  await d.getByTestId('im-upgrade-0-currency').selectOption(CUR);
  await d.getByTestId('im-upgrades-add').click();
  await save(page, 'im-dialog');
  await page.getByTestId('im-add').click();
  await d.locator('input[name="key"]').fill(`gem${S}`);
  await d.locator('input[name="name-fa"]').fill(`الماس ${S}`);
  await d.getByTestId('im-type').selectOption('booster');
  await d.getByTestId('im-stackable').click();
  await expect(d.getByTestId('im-upgrades')).toHaveCount(0);
  await d.locator('input[name="maxStack"]').fill('۹۹');
  await save(page, 'im-dialog');
  await page.getByTestId('im-search').fill(`${S}`);
  await expect(page.getByTestId(`im-row-hat${S}`)).toContainText('۲۰');
  await expect(page.getByTestId(`im-row-gem${S}`)).toContainText('≤۹۹');

  await page.goto(`/#/player?id=${player.id}`);
  await page.getByTestId('inv-give').click();
  const g = page.getByTestId('inv-dialog');
  await g.getByTestId('inv-item').selectOption({ label: `الماس ${S} (gem${S})` });
  await g.locator('input[name="invQty"]').fill('۵');
  await save(page, 'inv-dialog');
  await expect(page.getByTestId(`inv-gem${S}`)).toContainText('×۵');

  await open(page, 'items');
  await page.getByTestId('im-search').fill(`gem${S}`);
  await page.getByTestId(`im-del-gem${S}`).click();
  await confirm(page);
  await badToast(page, 'حذف نمی‌شود');

  await page.goto(`/#/player?id=${player.id}`);
  await page.getByTestId('inv-take').click();
  await g.getByTestId('inv-item').selectOption({ label: `الماس ${S} (gem${S})` });
  await g.locator('input[name="invQty"]').fill('۹');
  await g.getByTestId('dialog-save').click();
  await expect(g.locator('.err-box')).toContainText('کافی نیست');
  await g.locator('input[name="invQty"]').fill('۵');
  await save(page, 'inv-dialog');
  await expect(page.getByTestId(`inv-gem${S}`)).toHaveCount(0);

  await open(page, 'items');
  await page.getByTestId('im-search').fill(`${S}`);
  for (const k of [`gem${S}`, `hat${S}`]) {
    await page.getByTestId(`im-del-${k}`).click();
    await confirm(page);
    await expect(page.getByTestId(`im-row-${k}`)).toHaveCount(0);
  }
});

test('product rules, offers and offer settings', async ({ page }) => {
  await open(page, 'products');
  await page.getByTestId('pr-search').fill(PRODUCT);
  await page.getByTestId(`pr-edit-${PRODUCT}`).click();
  const d = page.getByTestId('pr-dialog');
  await d.getByTestId('pr-rules-on').click();
  await d.getByTestId('pr-one-time').click();
  await d.locator('input[name="purchaseMessage-fa"]').fill('فقط یک بار');
  await save(page, 'pr-dialog');
  await page.getByTestId(`pr-edit-${PRODUCT}`).click();
  await expect(d.getByTestId('pr-rules-on')).toHaveAttribute('aria-checked', 'true');
  await expect(d.getByTestId('pr-one-time')).toHaveAttribute('aria-checked', 'true');
  await d.getByTestId('pr-rules-on').click();
  await save(page, 'pr-dialog');

  await open(page, 'offers');
  await page.getByTestId('of-add').click();
  const o = page.getByTestId('of-dialog');
  await o.locator('input[name="key"]').fill(`of${S}`);
  await o.getByTestId('of-product').selectOption(String(productId));
  await o.locator('input[name="badge-fa"]').fill('ویژه');
  await o.locator('input[name="discountPercent"]').fill('۲۵');
  await o.locator('input[name="weight"]').fill('۵');
  await save(page, 'of-dialog');
  const row = page.getByTestId(`of-row-of${S}`);
  await expect(row).toContainText('۲۵٪');
  await expect(row).toContainText('وزن ۵');
  await page.getByTestId(`of-edit-of${S}`).click();
  await expect(o.getByTestId('of-kind')).toBeDisabled();
  await o.locator('select[name="priceMode"]').selectOption('price');
  await o.locator('input[name="offerPriceToman"]').fill('50');
  await o.getByTestId('dialog-save').click();
  await expect(o.locator('.err-box')).toBeVisible();
  await o.locator('input[name="offerPriceToman"]').fill('-1');
  await o.locator('input[name="offerCoinAmount"]').fill('۵');
  await save(page, 'of-dialog');
  await expect(row).toContainText('قیمت ثابت');
  await page.getByTestId(`of-del-of${S}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
  await page.getByTestId('of-add').click();
  await o.locator('input[name="key"]').fill(`oe${S}`);
  await o.getByTestId('of-kind').selectOption('entry');
  await o.getByTestId('of-product').selectOption(String(productId));
  await o.getByTestId('of-trigger').selectOption('lapsed');
  await o.locator('input[name="triggerValue"]').fill('۷');
  await save(page, 'of-dialog');
  await expect(page.getByTestId(`of-row-oe${S}`)).toContainText('برگشت پس از غیبت');
  await page.getByTestId(`of-del-oe${S}`).click();
  await confirm(page);

  await open(page, 'settings/offer-settings');
  const st = page.getByTestId('st-offer-settings');
  const count = st.locator('input[name="count"]');
  const old = await count.inputValue();
  await count.fill('۴');
  await page.getByTestId('os-save').click();
  await toastOk(page);
  await st.locator('input[name="periodDays"]').fill('۹۹');
  await page.getByTestId('os-save').click();
  await expect(st.locator('.err-box')).toBeVisible();
  await st.locator('input[name="periodDays"]').fill('۱');
  await count.fill(old);
  await page.getByTestId('os-save').click();
  await toastOk(page);
});

test('placements and banners: schedule, preview reasons, stats, IN_USE', async ({ page }) => {
  await open(page, 'placements');
  await page.getByTestId('plc-add').click();
  const p = page.getByTestId('plc-dialog');
  await p.locator('input[name="key"]').fill(`home${S}`);
  await p.locator('input[name="name-fa"]').fill(`صفحهٔ اول ${S}`);
  await save(page, 'plc-dialog');
  await expect(page.getByTestId(`plc-row-home${S}`)).toContainText('اسلایدر');

  await open(page, 'banners');
  await page.getByTestId('bn-add').click();
  const d = page.getByTestId('bn-dialog');
  await d.locator('input[name="key"]').fill(`bn${S}`);
  await d.getByTestId('bn-placement').selectOption({ label: `صفحهٔ اول ${S}` });
  await d.locator('input[name="internalName"]').fill(`بنر ${S}`);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('الزامی');
  await d.locator('input[name="title-fa"]').fill('تخفیف ویژه');
  await d.getByTestId('bn-action').selectOption('url');
  await d.locator('input[name="actionValue"]').fill('not a url');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('https://');
  await d.locator('input[name="actionValue"]').fill('https://example.com/sale');
  const today = (new Date(Date.now() + 3.5 * 3600 * 1000).getUTCDay() + 1) % 7;
  await d.getByTestId(`bn-day-${today}`).click();
  await d.locator('input[name="priority"]').fill('۵۰');
  await save(page, 'bn-dialog');
  const row = page.getByTestId(`bn-row-bn${S}`);
  await expect(row).toContainText('۵۰');

  await page.getByTestId('bn-preview-open').click();
  const pv = page.getByTestId('bn-preview');
  await pv.getByTestId('bn-preview-placement').selectOption(`home${S}`);
  await pv.getByTestId('bn-preview-player').fill(fa(String(player.id)));
  await pv.getByTestId('bn-preview-go').click();
  await expect(pv.getByTestId(`bn-preview-bn${S}`)).toContainText('امروز نیست');
  await page.keyboard.press('Escape');

  await page.getByTestId(`bn-edit-bn${S}`).click();
  await d.getByTestId(`bn-day-${today}`).click();
  await save(page, 'bn-dialog');
  await page.getByTestId('bn-preview-open').click();
  await pv.getByTestId('bn-preview-placement').selectOption(`home${S}`);
  await pv.getByTestId('bn-preview-player').fill(fa(String(player.id)));
  await pv.getByTestId('bn-preview-go').click();
  await expect(pv.getByTestId(`bn-preview-bn${S}`)).toContainText('نمایش داده می‌شود');
  await page.keyboard.press('Escape');

  await page.getByTestId(`bn-stats-bn${S}`).click();
  await expect(page.getByTestId('bn-stats-views')).toHaveText('۰');
  await page.keyboard.press('Escape');

  await open(page, 'placements');
  await page.getByTestId(`plc-del-home${S}`).click();
  await confirm(page);
  await badToast(page, 'حذف نمی‌شود');
  await open(page, 'banners');
  await page.getByTestId(`bn-del-bn${S}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
  await open(page, 'placements');
  await page.getByTestId(`plc-del-home${S}`).click();
  await confirm(page);
  await expect(page.getByTestId(`plc-row-home${S}`)).toHaveCount(0);
});

test('sponsors: create, edit, report and CSV download with BOM', async ({ page }) => {
  await open(page, 'sponsors');
  await page.getByTestId('sp-add').click();
  const d = page.getByTestId('sp-dialog');
  await d.locator('input[name="key"]').fill(`sp${S}`);
  await d.locator('input[name="name-fa"]').fill('اسپانسر تست');
  await d.locator('input[name="websiteUrl"]').fill('https://sponsor.example.com');
  await d.locator('input[name="contactEmail"]').fill('bad-email');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('ایمیل');
  await d.locator('input[name="contactEmail"]').fill('Ads@Example.com');
  await d.locator('input[name="budgetToman"]').fill('۵۰۰۰۰۰');
  await d.locator('input[name="targetViews"]').fill('۱۰۰۰');
  await save(page, 'sp-dialog');
  const row = page.getByTestId(`sp-row-sp${S}`);
  await expect(row).toContainText('۵۰۰٬۰۰۰');
  await page.getByTestId(`sp-edit-sp${S}`).click();
  await expect(d.locator('input[name="contactEmail"]')).toHaveValue('ads@example.com');
  await d.locator('input[name="targetClicks"]').fill('۵۰');
  await save(page, 'sp-dialog');
  await expect(row).toContainText('۵۰ کلیک');

  await page.getByTestId(`sp-report-sp${S}`).click();
  await expect(page.getByTestId('page-sponsor-report')).toBeVisible();
  await expect(page.getByTestId('sp-live')).toHaveText('در حال پخش');
  await expect(page.getByTestId('sp-chart')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('sp-csv').click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const path = await download.path();
  const buf = readFileSync(path!);
  expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);
  expect(buf.toString('utf8')).toContain('day,views,clicks,players,ctr_percent');

  await open(page, 'sponsors');
  await page.getByTestId(`sp-del-sp${S}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('chance games: live total must be 100, ticket, edit, delete; plays page', async ({ page }) => {
  await open(page, 'chance-games');
  await page.getByTestId('cg-add').click();
  const d = page.getByTestId('cg-dialog');
  await d.locator('input[name="key"]').fill(`wh${S}`);
  await d.locator('input[name="name-fa"]').fill('گردونهٔ تست');
  await d.locator('input[name="cg-slot-0-chance"]').fill('30');
  await d.getByTestId('cg-slot-0-prize').selectOption(String(prizeId));
  await d.getByTestId('cg-slots-add').click();
  await d.locator('input[name="cg-slot-1-chance"]').fill('30');
  await expect(d.getByTestId('cg-total')).toHaveText('جمع: ۶۰٪');
  await expect(d.getByTestId('cg-total')).toHaveClass(/b-bad/);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('دقیقاً ۱۰۰');
  await d.locator('input[name="cg-slot-1-chance"]').fill('۶۹٫۵'.replace('٫', '.'));
  await d.getByTestId('cg-slots-add').click();
  await expect(d.locator('input[name="cg-slot-2-chance"]')).toHaveValue('۰.۵');
  await expect(d.getByTestId('cg-total')).toHaveText('جمع: ۱۰۰٪');
  await expect(d.getByTestId('cg-total')).toHaveClass(/b-ok/);
  await d.getByTestId('cg-ticket').selectOption('currency');
  await d.getByTestId('cg-ticket-key').selectOption(CUR);
  await d.locator('input[name="ticketAmount"]').fill('۱۰');
  await save(page, 'cg-dialog');
  const row = page.getByTestId(`cg-row-wh${S}`);
  await expect(row).toContainText('۳ خانه');
  await expect(row).toContainText('بلیت: ۱۰');
  await page.getByTestId(`cg-edit-wh${S}`).click();
  await expect(d.locator('input[name="key"]')).toBeDisabled();
  await d.locator('input[name="intervalTime"]').fill('۰');
  await d.getByTestId('cg-ticket').selectOption('none');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('نوبت رایگان یا بلیت');
  await d.locator('input[name="intervalTime"]').fill('۶۰');
  await save(page, 'cg-dialog');
  await expect(row).toContainText('رایگان هر ۶۰ دقیقه');
  await open(page, 'chance-plays');
  await expect(page.getByTestId('cp-table')).toBeVisible();
  await open(page, 'chance-games');
  await page.getByTestId(`cg-del-wh${S}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('package settings and test clocks', async ({ page }) => {
  await open(page, 'settings/gam-settings');
  const g = page.getByTestId('st-gam-settings');
  const chain = g.locator('input[name="chainDepth"]');
  const old = await chain.inputValue();
  await chain.fill('۹۹');
  await page.getByTestId('gs-save').click();
  await expect(g.locator('.err-box')).toContainText('۲۵');
  await chain.fill(old);
  await page.getByTestId('gs-save').click();
  await toastOk(page);
  await page.getByTestId('gs-clock-fwd').click();
  await expect(page.getByTestId('gs-clock-now')).toContainText('+۱ روز');
  await open(page, 'dashboard');
  await expect(page.getByTestId('tiles-gam')).toBeVisible();
  await expect(page.getByTestId('page-dashboard')).toContainText('ساعت آزمایشی');
  await open(page, 'settings/gam-settings');
  await page.getByTestId('gs-clock-reset').click();
  await expect(page.getByTestId('gs-clock-now')).toHaveText('ساعت واقعی');

  await open(page, 'settings/items-settings');
  await page.getByTestId('is-save').click();
  await toastOk(page);
  await page.getByTestId('is-clock-back').click();
  await expect(page.getByTestId('is-clock-now')).toContainText('−۱ روز');
  await page.getByTestId('is-clock-reset').click();
  await expect(page.getByTestId('is-clock-now')).toHaveText('ساعت واقعی');

  await open(page, 'settings/promo-settings');
  const p = page.getByTestId('st-promo-settings');
  await p.locator('input[name="keepDays"]').fill('۳');
  await page.getByTestId('ps-save').click();
  await expect(p.locator('.err-box')).toContainText('keepDays');
  await p.locator('input[name="keepDays"]').fill('۴۵');
  await page.getByTestId('ps-save').click();
  await toastOk(page);
  await page.getByTestId('ps-clock-fwd').click();
  await page.getByTestId('ps-clock-reset').click();
  await expect(page.getByTestId('ps-clock-now')).toHaveText('ساعت واقعی');
});

test('palette finds the new pages; cleanup', async ({ page }) => {
  await open(page, 'dashboard');
  await page.keyboard.press('Control+k');
  await page.locator('.pal-input').fill('استریک');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-streaks')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('.pal-input').fill('sponsors');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-sponsors')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('.pal-input').fill('تنظیمات پیشنهادها');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('st-offer-settings')).toBeVisible();
  await page.keyboard.press('Escape');

  await open(page, 'event-rules');
  await page.getByTestId(`er-edit-er${S}`).click();
  await page.getByTestId('er-dialog').getByTestId('active-switch').click();
  await save(page, 'er-dialog');
  await expect(page.getByTestId(`er-row-er${S}`)).toContainText('غیرفعال');
});
