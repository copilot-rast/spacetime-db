import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { Identity } from 'spacetimedb';
import { ECONOMY_QUERIES, GAMES_QUERIES, ITEMS_QUERIES, PLAYER_QUERIES, connect, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, open, prefs, stamp, test } from './fixtures.ts';

const DIR = '../.local/shots/panel9';
mkdirSync(DIR, { recursive: true });
const S = stamp();
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...ITEMS_QUERIES, ...GAMES_QUERIES];
const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];
const rows = <T>(it: Iterable<T>) => [...it];
const TAG = `vip${S}`;
const META = `ticket${S}`;
const CUR = `coin${S}`;
const PRIZE = `win${S}`;
const ROOM = `gold${S}`;
const UG = `puzzle${S}`;
const HEX = (S.padStart(8, '0') + 'c2'.repeat(28)).slice(0, 64);

type GameArgs = Parameters<Client['conn']['reducers']['adminSaveGame']>[0];
type GameRow = ReturnType<typeof game>;

test.describe.configure({ mode: 'serial' });

let owner: Client;
let duel0: GameArgs;
let party0: GameArgs;
let duelId = 0n;
const made = { tag: 0n, meta: 0n, currency: 0n, prize: 0n };

const game = (key: string) => rows(owner.conn.db.adminGames.iter()).find(g => g.key === key)!;

function argsOf(g: GameRow): GameArgs {
  const { registered: _r, realtime: _rt, codeName: _c, settingsSchema: _s, createdAt: _ca, updatedAt: _u, ...rest } = g;
  return rest;
}

async function settle(page: Page) {
  await page.waitForTimeout(500);
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 30000 });
}

async function shot(page: Page, name: string, full = false) {
  await settle(page);
  await page.screenshot({ path: `${DIR}/games-${name}.png`, fullPage: full });
}

async function tab(page: Page, name: string) {
  await page.getByTestId('gm-tabs').getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

test.beforeAll(async () => {
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await waitFor(() => rows(owner.conn.db.adminGames.iter()).some(g => g.key === 'sample_duel') && rows(owner.conn.db.adminGames.iter()).some(g => g.key === 'sample_party'), 8000);
  duel0 = argsOf(game('sample_duel'));
  party0 = argsOf(game('sample_party'));
  duelId = game('sample_duel').id;
  const r = owner.conn.reducers;
  await r.adminSaveTag({ id: 0n, keyType: 'user', key: TAG, title: tr('بازیکن ویژه', 'VIP player'), color: '#7c4dbd', sort: 0, isActive: true });
  await r.adminSaveMeta({ id: 0n, key: META, name: tr('بلیت مسابقه', 'Match ticket'), defaultValue: 0, serverOnly: false });
  await r.adminSaveCurrency({ id: 0n, key: CUR, name: tr('سکه', 'Coin'), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(owner.conn.db.currency.iter()).some(x => x.key === CUR));
  await r.adminSavePrize({ id: 0n, key: PRIZE, name: tr('جایزهٔ برنده', 'Winner prize'), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items: [{ type: 'currency', key: CUR, action: 'add', value: 100 }] });
  await waitFor(() => rows(owner.conn.db.tag.iter()).some(x => x.key === TAG) && rows(owner.conn.db.meta.iter()).some(x => x.key === META) && rows(owner.conn.db.prize.iter()).some(x => x.key === PRIZE));
  made.tag = rows(owner.conn.db.tag.iter()).find(x => x.key === TAG && x.keyType === 'user')!.id;
  made.meta = rows(owner.conn.db.meta.iter()).find(x => x.key === META)!.id;
  made.currency = rows(owner.conn.db.currency.iter()).find(x => x.key === CUR)!.id;
  made.prize = rows(owner.conn.db.prize.iter()).find(x => x.key === PRIZE)!.id;
  await r.adminSaveGame({
    ...duel0,
    name: tr('دوئل', 'Duel'),
    description: tr('نبرد دونفره در چند دور', 'A two-player fight over a few rounds'),
    botsAllowed: true,
    platforms: ['android', 'ios'],
    minVersions: [{ platform: 'android', version: '1.4.0' }],
    requirements: { ...duel0.requirements, metas: [{ metaKey: META, operator: 'gte', value: 1, consume: 1 }], excludeTagIds: [], tagIds: [made.tag], message: tr('برای ورود یک بلیت مسابقه لازم است.', 'You need a match ticket to join.') },
  });
  await r.adminSaveGame({ ...party0, name: tr('مهمانی', 'Party'), maintenance: true, maintenanceMessage: tr('تا ساعت ۱۸ برمی‌گردیم.', 'Back at 18:00.') });
  await r.adminSaveGameRoom({ id: 0n, gameId: duelId, key: ROOM, name: tr('اتاق طلایی', 'Gold room'), entryCurrency: CUR, entryFee: 50n, prizeId: made.prize, prizeGroupId: 0n, minLevel: 5, isLocked: false, isHidden: false, isActive: true, inheritGame: true, requirements: { ...duel0.requirements, metas: [], tagIds: [], excludeTagIds: [] }, sort: 1 });
  await r.adminSaveGame({ ...duel0, id: 0n, key: UG, name: tr('پازل', 'Puzzle'), minPlayers: 1, maxPlayers: 1, settings: '{}', requirements: { ...duel0.requirements, metas: [], tagIds: [], excludeTagIds: [] } });
  await r.adminSaveGameServer({ identity: Identity.fromString(HEX), note: 'سرور تهران', isActive: true });
  await waitFor(() => rows(owner.conn.db.adminGameRooms.iter()).some(x => x.key === ROOM) && rows(owner.conn.db.adminGames.iter()).some(x => x.key === UG) && rows(owner.conn.db.adminGameServers.iter()).length > 0);
});

test.afterAll(async () => {
  const r = owner?.conn.reducers;
  if (r) {
    if (duel0) await r.adminSaveGame(duel0).catch(() => {});
    if (party0) await r.adminSaveGame(party0).catch(() => {});
    for (const x of rows(owner.conn.db.adminGameRooms.iter()).filter(x => x.key === ROOM)) await r.adminDeleteGameRoom({ id: x.id }).catch(() => {});
    for (const x of rows(owner.conn.db.adminGames.iter()).filter(x => x.key === UG)) await r.adminDeleteGame({ id: x.id }).catch(() => {});
    await r.adminDeleteGameServer({ identity: Identity.fromString(HEX) }).catch(() => {});
    await r.adminDeletePrize({ id: made.prize }).catch(() => {});
    await r.adminDeleteCurrency({ id: made.currency }).catch(() => {});
    await r.adminDeleteMeta({ id: made.meta }).catch(() => {});
    await r.adminDeleteTag({ id: made.tag }).catch(() => {});
  }
  owner?.conn.disconnect();
});

test('catalog and new game dialog', async ({ page }) => {
  await open(page, 'games-catalog');
  await expect(page.getByTestId('gcl-row-sample_duel')).toBeVisible();
  await shot(page, 'catalog');
  await page.getByTestId('gcl-add').click();
  await shot(page, 'new-dialog');
  await page.keyboard.press('Escape');
});

test('game page tabs', async ({ page }) => {
  await open(page, `game?id=${duelId}`);
  await expect(page.getByTestId('gm-name')).toBeVisible();
  await shot(page, 'game-general', true);
  await tab(page, 'تعمیر');
  await shot(page, 'game-maintenance');
  await tab(page, 'جفت‌یابی');
  await shot(page, 'game-matchmaking', true);
  await tab(page, 'تنظیمات بازی');
  await shot(page, 'game-settings');
  await page.locator('input[name="set-rounds"]').fill('12');
  await page.getByTestId('gm-save').click();
  await shot(page, 'game-settings-error');
  await page.getByTestId('gm-reset').click();
  await page.getByTestId('gm-raw').click();
  await shot(page, 'game-settings-raw');
  await page.getByTestId('gm-raw').click();
  await tab(page, 'شرط ورود');
  await shot(page, 'game-requirements', true);
  await tab(page, 'اتاق‌ها');
  await expect(page.getByTestId(`grm-row-${ROOM}`)).toBeVisible();
  await shot(page, 'game-rooms');
  await page.getByTestId(`grm-edit-${ROOM}`).click();
  await shot(page, 'room-dialog');
  await page.keyboard.press('Escape');
});

test('maintenance game and unregistered game', async ({ page }) => {
  await open(page, `game?id=${game('sample_party').id}&tab=maintenance`);
  await expect(page.getByTestId('gm-maint-badge')).toBeVisible();
  await shot(page, 'game-maintenance-on');
  await open(page, `game?id=${game(UG).id}&tab=settings`);
  await shot(page, 'game-unregistered');
});

test('servers and settings', async ({ page }) => {
  await open(page, 'game-servers');
  await expect(page.getByTestId('gsv-table')).toBeVisible();
  await shot(page, 'servers');
  await page.getByTestId('gsv-add').click();
  await page.getByTestId('gsv-dialog').locator('input[name="identity"]').fill('abc');
  await shot(page, 'server-dialog');
  await page.keyboard.press('Escape');
  await open(page, 'settings/games-settings');
  await expect(page.getByTestId('gst-form')).toBeVisible();
  await shot(page, 'settings');
  await page.getByTestId('st-close').click();
});

test('english and mobile', async ({ page }) => {
  await prefs(page, 'en', 'light');
  await open(page, 'games-catalog');
  await shot(page, 'catalog-en');
  await open(page, `game?id=${duelId}&tab=requirements`);
  await shot(page, 'game-requirements-en');
  await prefs(page, 'fa', 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'games-catalog');
  await shot(page, 'catalog-mobile', true);
  await open(page, `game?id=${duelId}`);
  await shot(page, 'game-mobile');
  await page.setViewportSize({ width: 1280, height: 800 });
});
