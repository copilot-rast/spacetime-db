import type { Page } from '@playwright/test';
import { ECONOMY_QUERIES, GAMES_QUERIES, ITEMS_QUERIES, PLAYER_QUERIES, connect, loginOwner, tr, waitFor, type Client } from '../src/lib.ts';
import { expect, open, stamp, test, toastOk } from './fixtures.ts';

const S = stamp();
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...ITEMS_QUERIES, ...GAMES_QUERIES];
const TAG = `gt${S}`;
const META = `gm${S}`;
const CUR = `gc${S}`;
const PRIZE = `gp${S}`;
const ROOM = `r${S}`;
const UG = `ug${S}`;
const rows = <T>(it: Iterable<T>) => [...it];

type GameArgs = Parameters<Client['conn']['reducers']['adminSaveGame']>[0];
type SetArgs = Parameters<Client['conn']['reducers']['adminSaveGamesSettings']>[0];

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

let owner: Client;
let game0: GameArgs;
let set0: SetArgs;
let gameId = 0n;
const made = { tag: 0n, meta: 0n, currency: 0n, prize: 0n };

const duel = () => rows(owner.conn.db.adminGames.iter()).find(g => g.key === 'sample_duel')!;

function argsOf(g: ReturnType<typeof duel>): GameArgs {
  const { registered: _r, realtime: _rt, codeName: _c, settingsSchema: _s, createdAt: _ca, updatedAt: _u, ...rest } = g;
  return rest;
}

function setArgs(): SetArgs {
  const { id: _i, clockOffsetSec: _c, updatedAt: _u, ...rest } = rows(owner.conn.db.adminGamesSettings.iter())[0];
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

async function tab(page: Page, name: string) {
  await page.getByTestId('gm-tabs').getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

async function saveGame(page: Page) {
  await page.getByTestId('gm-save').click();
  await expect(page.getByTestId('gm-savebar').locator('.err-box')).toHaveCount(0);
  await expect(page.getByTestId('gm-savebar')).toContainText('همهٔ تغییرها ذخیره شده‌اند');
}

test.beforeAll(async () => {
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await waitFor(() => rows(owner.conn.db.adminGamesSettings.iter()).length > 0 && rows(owner.conn.db.adminGames.iter()).some(g => g.key === 'sample_duel'), 8000);
  set0 = setArgs();
  game0 = argsOf(duel());
  gameId = duel().id;
  const r = owner.conn.reducers;
  await r.adminSaveTag({ id: 0n, keyType: 'user', key: TAG, title: tr(`تازه‌کار ${S}`), color: '#b4542d', sort: 0, isActive: true });
  await r.adminSaveMeta({ id: 0n, key: META, name: tr(`بلیت دوئل ${S}`), defaultValue: 0, serverOnly: false });
  await r.adminSaveCurrency({ id: 0n, key: CUR, name: tr(`سکهٔ بازی ${S}`), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(owner.conn.db.currency.iter()).some(x => x.key === CUR));
  await r.adminSavePrize({ id: 0n, key: PRIZE, name: tr(`جایزهٔ برنده ${S}`), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items: [{ type: 'currency', key: CUR, action: 'add', value: 10 }] });
  await waitFor(() => rows(owner.conn.db.tag.iter()).some(x => x.key === TAG) && rows(owner.conn.db.meta.iter()).some(x => x.key === META) && rows(owner.conn.db.prize.iter()).some(x => x.key === PRIZE));
  made.tag = rows(owner.conn.db.tag.iter()).find(x => x.key === TAG && x.keyType === 'user')!.id;
  made.meta = rows(owner.conn.db.meta.iter()).find(x => x.key === META)!.id;
  made.currency = rows(owner.conn.db.currency.iter()).find(x => x.key === CUR)!.id;
  made.prize = rows(owner.conn.db.prize.iter()).find(x => x.key === PRIZE)!.id;
});

test.afterAll(async () => {
  const r = owner?.conn.reducers;
  if (r) {
    if (game0) await r.adminSaveGame(game0).catch(() => {});
    if (set0) await r.adminSaveGamesSettings(set0).catch(() => {});
    await r.adminSetGamesClockOffset({ seconds: 0n }).catch(() => {});
    for (const x of rows(owner.conn.db.adminGameRooms.iter()).filter(x => x.key === ROOM)) await r.adminDeleteGameRoom({ id: x.id }).catch(() => {});
    for (const x of rows(owner.conn.db.adminGames.iter()).filter(x => x.key === UG)) await r.adminDeleteGame({ id: x.id }).catch(() => {});
    await r.adminDeletePrize({ id: made.prize }).catch(() => {});
    await r.adminDeleteCurrency({ id: made.currency }).catch(() => {});
    await r.adminDeleteMeta({ id: made.meta }).catch(() => {});
    await r.adminDeleteTag({ id: made.tag }).catch(() => {});
  }
  owner?.conn.disconnect();
});

test('games settings: save, translated rule error, run now, restore', async ({ page }) => {
  await open(page, 'settings/games-settings');
  const f = page.getByTestId('gst-form');
  await expect(f).toBeVisible();
  await f.locator('input[name="ticketTtlSeconds"]').fill('99999');
  await page.getByTestId('gst-save').click();
  await expect(f.locator('.err-box')).toContainText('عمر بلیت در صف');
  await f.locator('input[name="ticketTtlSeconds"]').fill('۶۰۰');
  await f.getByRole('button', { name: 'میلادی' }).click();
  await page.getByTestId('gst-save').click();
  await toastOk(page);
  expect(await waitFor(() => rows(owner.conn.db.adminGamesSettings.iter())[0]?.ticketTtlSeconds === 600 && rows(owner.conn.db.adminGamesSettings.iter())[0]?.monthCalendar === 'gregorian')).toBe(true);
  await page.getByTestId('gst-run').click();
  await expect(page.getByTestId('gst-run-result')).toContainText('مسابقه ساخته شد');
  await f.locator('input[name="ticketTtlSeconds"]').fill(String(set0.ticketTtlSeconds));
  await f.getByRole('button', { name: set0.monthCalendar === 'gregorian' ? 'میلادی' : 'شمسی' }).click();
  await page.getByTestId('gst-save').click();
  await toastOk(page);
  expect(await waitFor(() => rows(owner.conn.db.adminGamesSettings.iter())[0]?.ticketTtlSeconds === set0.ticketTtlSeconds && rows(owner.conn.db.adminGamesSettings.iter())[0]?.monthCalendar === set0.monthCalendar)).toBe(true);
  await page.getByTestId('st-close').click();
});

test('catalog lists sample_duel as registered', async ({ page }) => {
  await open(page, 'games-catalog');
  const row = page.getByTestId('gcl-row-sample_duel');
  await expect(row).toContainText('ثبت‌شده در کد');
  await expect(row).toContainText('۲');
  await expect(page.getByTestId('gcl-del-sample_duel')).toHaveCount(0);
  await page.getByTestId('gcl-open-sample_duel').first().click();
  await expect(page.getByTestId('page-game')).toBeVisible();
  await expect(page.getByTestId('gm-name')).toBeVisible();
});

test('edit sample_duel: name, maintenance, matchmaking, settings form with client and server errors', async ({ page }) => {
  await open(page, `game?id=${gameId}`);
  await expect(page.getByTestId('gm-name')).toBeVisible();
  await page.locator('input[name="name-fa"]').fill(`دوئل نمونه ${S}`);
  await saveGame(page);
  await expect(page.getByTestId('gm-name')).toHaveText(`دوئل نمونه ${S}`);
  expect(await waitFor(() => duel().name.some(x => x.lang === 'fa' && x.text === `دوئل نمونه ${S}`))).toBe(true);

  await tab(page, 'تعمیر');
  await page.getByTestId('gm-maintenance').click();
  await page.locator('textarea[name="maintenanceMessage-fa"]').fill(`تا ساعت ۱۸ برمی‌گردیم ${S}`);
  await saveGame(page);
  await expect(page.getByTestId('gm-maint-badge')).toBeVisible();
  await expect(page.locator('.notice-warn')).toContainText(`تا ساعت ۱۸ برمی‌گردیم ${S}`);
  expect(await waitFor(() => duel().maintenance)).toBe(true);
  await page.getByTestId('gm-maintenance').click();
  await saveGame(page);
  await expect(page.getByTestId('gm-maint-badge')).toHaveCount(0);
  expect(await waitFor(() => !duel().maintenance)).toBe(true);

  await tab(page, 'جفت‌یابی');
  await page.locator('input[name="bandSize"]').fill('5');
  await page.locator('input[name="widenEverySeconds"]').fill('15');
  await page.locator('input[name="fillAfterSeconds"]').fill('40');
  await expect(page.getByTestId('gm-band-preview')).toContainText('±۹');
  await saveGame(page);
  expect(await waitFor(() => duel().bandSize === 5 && duel().widenEverySeconds === 15 && duel().fillAfterSeconds === 40)).toBe(true);

  await tab(page, 'تنظیمات بازی');
  const box = page.getByTestId('gm-settings');
  await expect(box.locator('input[name="set-rounds"]')).toBeVisible();
  await expect(box).toContainText('از ۱ تا ۹');
  await box.locator('input[name="set-rounds"]').fill('5');
  await box.locator('select[name="set-theme"]').selectOption('night');
  await saveGame(page);
  expect(await waitFor(() => JSON.parse(duel().settings).rounds === 5 && JSON.parse(duel().settings).theme === 'night')).toBe(true);
  await box.locator('input[name="set-rounds"]').fill('12');
  await expect(box.locator('.field-err')).toContainText('بیشتر از ۹ نباشد');
  await page.getByTestId('gm-save').click();
  await expect(page.getByTestId('gm-savebar').locator('.err-box')).toContainText('rounds');
  await expect(page.getByTestId('gm-savebar').locator('.err-box')).toContainText('بیشتر از ۹ نباشد');
  await box.locator('input[name="set-rounds"]').fill('4');
  await expect(box.locator('.field-err')).toHaveCount(0);
  await page.getByTestId('gm-raw').click();
  await box.locator('textarea[name="settingsRaw"]').fill('{"rounds": 12, "theme": "day"}');
  await page.getByTestId('gm-save').click();
  await expect(page.getByTestId('gm-savebar').locator('.err-box')).toContainText('بیشتر از ۹ نباشد');
  await expect(page.getByTestId('gm-settings-errors')).toContainText('rounds');
  expect(JSON.parse(duel().settings).rounds).toBe(5);
  await box.locator('textarea[name="settingsRaw"]').fill('{"rounds": 3, "theme": "day"}');
  await saveGame(page);
  expect(await waitFor(() => JSON.parse(duel().settings).rounds === 3 && JSON.parse(duel().settings).theme === 'day')).toBe(true);
  await expect(box.locator('input[name="set-rounds"]')).toBeVisible();

  await owner.conn.reducers.adminSaveGame(game0);
  expect(await waitFor(() => duel().bandSize === game0.bandSize && duel().settings === game0.settings && !duel().name.some(x => x.text.includes(S)))).toBe(true);
});

test('requirements: meta with consume and a tag exclusion, reload, remove', async ({ page }) => {
  await open(page, `game?id=${gameId}&tab=requirements`);
  const req = page.getByTestId('gm-req');
  await expect(req).toBeVisible();
  await req.getByTestId('gm-req-metas-add').click();
  await req.getByTestId('gm-req-metas-0-key').selectOption(META);
  await req.getByTestId('gm-req-metas-0-op').selectOption('gte');
  await req.getByTestId('gm-req-metas-0').locator('input[name="metaValue"]').fill('2');
  await req.getByTestId('gm-req-metas-0').locator('input[name="metaConsume"]').fill('1');
  await req.getByTestId('gm-req-ex-add').selectOption(String(made.tag));
  await expect(req.getByTestId(`gm-req-ex-${made.tag}`)).toContainText(`تازه‌کار ${S}`);
  await expect(req.getByTestId('gm-req-in-add').locator(`option[value="${made.tag}"]`)).toHaveCount(0);
  await saveGame(page);
  expect(
    await waitFor(() => {
      const r = duel().requirements;
      return r.metas.length === 1 && r.metas[0].metaKey === META && r.metas[0].value === 2 && r.metas[0].consume === 1 && r.excludeTagIds.includes(made.tag);
    })
  ).toBe(true);
  await page.reload();
  await expect(req.getByTestId('gm-req-metas-0-key')).toHaveValue(META);
  await expect(req.getByTestId(`gm-req-ex-${made.tag}`)).toBeVisible();
  await expect(page.getByTestId('gm-tabs')).toContainText('شرط ورود ۲');
  await req.getByTestId('gm-req-metas-0-del').click();
  await req.getByTestId(`gm-req-ex-${made.tag}`).getByRole('button').click();
  await saveGame(page);
  expect(await waitFor(() => duel().requirements.metas.length === 0 && duel().requirements.excludeTagIds.length === 0)).toBe(true);
});

test('rooms: create with fee and prize, edit, delete', async ({ page }) => {
  await open(page, `game?id=${gameId}&tab=rooms`);
  await expect(page.getByTestId('grm-row-main')).toBeVisible();
  await page.getByTestId('grm-add').click();
  const d = page.getByTestId('grm-dialog');
  await d.locator('input[name="key"]').fill(ROOM);
  await d.locator('input[name="name-fa"]').fill(`اتاق طلایی ${S}`);
  await d.locator('input[name="entryFee"]').fill('50');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('ارز را انتخاب کنید');
  await d.getByTestId('grm-currency').selectOption(CUR);
  await d.getByRole('button', { name: 'جایزه', exact: true }).click();
  await d.getByTestId('grm-prize').selectOption(String(made.prize));
  await save(page, 'grm-dialog');
  const row = page.getByTestId(`grm-row-${ROOM}`);
  await expect(row).toContainText('۵۰');
  await expect(row).toContainText(`سکهٔ بازی ${S}`);
  await expect(row).toContainText(`جایزهٔ برنده ${S}`);
  const room = rows(owner.conn.db.adminGameRooms.iter()).find(x => x.key === ROOM)!;
  expect(room.entryFee).toBe(50n);
  expect(room.prizeId).toBe(made.prize);
  await page.getByTestId(`grm-edit-${ROOM}`).click();
  await d.locator('input[name="entryFee"]').fill('75');
  await d.getByTestId('grm-locked').click();
  await save(page, 'grm-dialog');
  await expect(row).toContainText('۷۵');
  await expect(row).toContainText('قفل');
  await page.getByTestId(`grm-del-${ROOM}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('create and delete an unregistered game', async ({ page }) => {
  await open(page, 'games-catalog');
  await page.getByTestId('gcl-add').click();
  const d = page.getByTestId('gcl-new-dialog');
  await d.locator('input[name="key"]').fill(UG);
  await d.locator('input[name="name-fa"]').fill(`بازی آینده ${S}`);
  await d.locator('input[name="maxPlayers"]').fill('1');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('تعداد بازیکن درست نیست');
  await d.locator('input[name="maxPlayers"]').fill('4');
  await save(page, 'gcl-new-dialog');
  const row = page.getByTestId(`gcl-row-${UG}`);
  await expect(row).toContainText('ثبت‌نشده');
  await expect(row).toContainText('از ۲ تا ۴');
  await page.getByTestId(`gcl-del-${UG}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('game servers: invalid identity, add, edit, delete', async ({ page }) => {
  await open(page, 'game-servers');
  await expect(page.getByTestId('page-game-servers')).toContainText('شناسهٔ SpacetimeDB');
  await page.getByTestId('gsv-add').click();
  const d = page.getByTestId('gsv-dialog');
  await d.locator('input[name="identity"]').fill('abc123');
  await expect(d.locator('.field-err')).toContainText('۶۴');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('۶۴');
  const hex = (S.padStart(8, '0') + 'ab'.repeat(28)).slice(0, 64);
  await d.locator('input[name="identity"]').fill(hex.toUpperCase());
  await d.locator('input[name="note"]').fill(`سرور تهران ${S}`);
  await save(page, 'gsv-dialog');
  const row = page.getByTestId(`gsv-row-${hex.slice(0, 16)}`);
  await expect(row).toContainText(`سرور تهران ${S}`);
  expect(await waitFor(() => rows(owner.conn.db.adminGameServers.iter()).some(x => x.identity.toHexString() === hex))).toBe(true);
  await page.getByTestId(`gsv-edit-${hex.slice(0, 16)}`).click();
  await expect(d.locator('input[name="identity"]')).toBeDisabled();
  await d.locator('input[name="note"]').fill(`سرور شیراز ${S}`);
  await d.getByTestId('gsv-active').click();
  await save(page, 'gsv-dialog');
  await expect(row).toContainText(`سرور شیراز ${S}`);
  await expect(row).toContainText('غیرفعال');
  await page.getByTestId(`gsv-del-${hex.slice(0, 16)}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('mobile: the catalog becomes cards without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'games-catalog');
  await expect(page.getByTestId('gcl-table')).toBeHidden();
  await expect(page.locator('.cards .pcard').filter({ hasText: 'sample_duel' })).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  await open(page, `game?id=${gameId}`);
  await expect(page.getByTestId('gm-name')).toBeVisible();
  const over2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over2).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
});
