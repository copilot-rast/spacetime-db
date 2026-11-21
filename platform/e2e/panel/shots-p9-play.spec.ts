import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ECONOMY_QUERIES, GAMES_QUERIES, PLAYER_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, open, prefs, stamp, test, uniquePhone } from './fixtures.ts';

const DIR = '../.local/shots/panel9';
mkdirSync(DIR, { recursive: true });
const S = stamp();
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMES_QUERIES];
const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];
const rows = <T>(it: Iterable<T>) => [...it];
const CUR = `gs${S}`;
const BOARD = `champ${S}`;
const NAMES = ['سارا رضایی', 'امیر کاظمی', 'نگار احمدی', 'رضا موسوی', 'مینا صادقی', 'کیان نوری'];

type P = { c: Client; id: bigint };

test.describe.configure({ mode: 'serial' });

let owner: Client;
let duelId = 0n;
const players: P[] = [];
const made = { currency: 0n, prize: 0n, rooms: [] as bigint[], board: 0n, finished: 0n, waiting: 0n };

async function settle(page: Page) {
  await page.waitForTimeout(500);
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 30000 });
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: `${DIR}/play-${name}.png` });
}

async function player(name: string) {
  const c = await connect(undefined, Q);
  const r = await login(c, uniquePhone('0935'));
  await c.conn.reducers.updateProfile({ displayName: name, lang: 'fa' });
  return { c, id: r.accountId };
}

async function room(key: string, name: string, p: Record<string, unknown>) {
  await owner.conn.reducers.adminSaveGameRoom({
    id: 0n, gameId: duelId, key, name: tr(name, name), entryCurrency: '', entryFee: 0n, prizeId: 0n, prizeGroupId: 0n, minLevel: 0, isLocked: false, isHidden: true, isActive: true, inheritGame: false,
    requirements: { itemKeys: [], itemsMode: 'any', consumeItems: false, tagIds: [], tagsMode: 'any', excludeTagIds: [], minLevel: 0, metas: [], productIds: [], paths: [], refund: 'return', lock: 'show', message: [] },
    sort: 99, ...p,
  } as never);
  await waitFor(() => rows(owner.conn.db.adminGameRooms.iter()).some(r => r.gameId === duelId && r.key === key));
  const id = rows(owner.conn.db.adminGameRooms.iter()).find(r => r.gameId === duelId && r.key === key)!.id;
  made.rooms.push(id);
}

async function join(p: P, roomKey: string) {
  for (let i = 0; ; i++) {
    try {
      return await p.c.conn.procedures.gamesJoin({ gameKey: 'sample_duel', roomKey, path: 'matchmaking', code: '', platform: 'android', appVersion: '99.0.0' });
    } catch (e) {
      if (i >= 30 || !/GAME_MAINTENANCE|PLATFORM_NOT_SUPPORTED|APP_VERSION_TOO_OLD|GAME_NOT_FOUND/.test(String(e))) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function play(x: P, y: P, roomKey: string) {
  await join(x, roomKey);
  const { matchId } = await join(y, roomKey);
  await x.c.conn.reducers.gamesReady({ matchId });
  await y.c.conn.reducers.gamesReady({ matchId });
  await waitFor(() => rows(x.c.conn.db.myMatches.iter()).find(m => m.id === matchId)?.state === 'playing');
  await x.c.conn.reducers.sampleDuelPlay({ matchId });
  await waitFor(() => rows(x.c.conn.db.myMatches.iter()).find(m => m.id === matchId)?.state === 'finished');
  return matchId;
}

test.beforeAll(async () => {
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await waitFor(() => rows(owner.conn.db.adminGames.iter()).some(g => g.key === 'sample_duel'));
  duelId = rows(owner.conn.db.adminGames.iter()).find(g => g.key === 'sample_duel')!.id;
  const r = owner.conn.reducers;
  await r.adminSaveCurrency({ id: 0n, key: CUR, name: tr('ژتون طلایی', 'Gold token'), type: 'soft', defaultValue: 200n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(owner.conn.db.currency.iter()).some(x => x.key === CUR));
  made.currency = rows(owner.conn.db.currency.iter()).find(x => x.key === CUR)!.id;
  await r.adminSavePrize({ id: 0n, key: `cup${S}`, name: tr('جام طلایی', 'Gold cup'), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items: [{ type: 'currency', key: CUR, action: 'add', value: 50 }] });
  await waitFor(() => rows(owner.conn.db.prize.iter()).some(x => x.key === `cup${S}`));
  made.prize = rows(owner.conn.db.prize.iter()).find(x => x.key === `cup${S}`)!.id;
  await room(`arena${S}`, 'میدان طلایی', { prizeId: made.prize });
  await room(`vip${S}`, 'اتاق ویژه', { entryCurrency: CUR, entryFee: 20n });
  for (const n of NAMES) players.push(await player(n));
  await r.adminSaveLeaderboard({
    id: 0n, key: BOARD, gameId: duelId, name: tr('قهرمان‌های هفته', 'Weekly champions'), description: tr('بیشترین برد در دوئل', 'Most duel wins'), iconUrl: '', period: 'weekly', scoreMode: 'sum', order: 'desc', source: 'wins', topN: 50,
    rewards: [{ fromRank: 1, toRank: 1, prizeId: made.prize, prizeGroupId: 0n }, { fromRank: 2, toRank: 3, prizeId: made.prize, prizeGroupId: 0n }], isActive: true, sort: 0,
  });
  await waitFor(() => rows(owner.conn.db.adminLeaderboards.iter()).some(x => x.key === BOARD));
  made.board = rows(owner.conn.db.adminLeaderboards.iter()).find(x => x.key === BOARD)!.id;
  for (const [i, p] of players.entries()) await r.adminSetLeaderboardScore({ boardId: made.board, accountId: p.id, score: 12 - i * 2, mode: 'set' });
  await r.adminResetLeaderboard({ id: made.board, pay: true });
  await owner.conn.procedures.adminGamesRun({});
  made.finished = await play(players[0], players[1], `arena${S}`);
  await play(players[2], players[3], `arena${S}`);
  await play(players[0], players[4], `arena${S}`);
  await join(players[4], `vip${S}`);
  made.waiting = (await join(players[5], `vip${S}`)).matchId;
  await players[4].c.conn.reducers.gamesReady({ matchId: made.waiting });
  for (const [i, p] of players.entries()) if (i > 1) await r.adminSetLeaderboardScore({ boardId: made.board, accountId: p.id, score: 6 - i, mode: 'add' });
  await owner.conn.procedures.adminGamesRun({});
});

test.afterAll(async () => {
  const r = owner?.conn.reducers;
  if (r) {
    if (made.waiting) await r.adminCancelMatch({ matchId: made.waiting, refund: true, reason: '' }).catch(() => {});
    await owner.conn.procedures.adminGamesRun({}).catch(() => {});
    if (made.board) await r.adminDeleteLeaderboard({ id: made.board }).catch(() => {});
    for (const id of made.rooms) await r.adminDeleteGameRoom({ id }).catch(() => {});
    if (made.prize) await r.adminDeletePrize({ id: made.prize }).catch(() => {});
    if (made.currency) await r.adminDeleteCurrency({ id: made.currency }).catch(() => {});
  }
  owner?.conn.disconnect();
  for (const p of players) p.c.conn.disconnect();
});

test('shots: matches and match pages', async ({ page }) => {
  await open(page, 'matches?game=' + duelId);
  await shot(page, 'matches');
  await open(page, `match?id=${made.finished}`);
  await expect(page.getByTestId('gx-payouts')).toContainText('جام طلایی');
  await shot(page, 'match');
  await open(page, `match?id=${made.waiting}`);
  await expect(page.getByTestId('gx-match-state')).toContainText('در انتظار');
  await shot(page, 'match-waiting');
  await page.getByTestId('gx-cancel').click();
  await shot(page, 'cancel-dialog');
  await page.keyboard.press('Escape');
  await open(page, 'game-payouts');
  await shot(page, 'payouts');
});

test('shots: leaderboards', async ({ page }) => {
  await open(page, 'leaderboards');
  await expect(page.getByTestId(`gx-b-row-${BOARD}`)).toBeVisible();
  await shot(page, 'leaderboards');
  await page.getByTestId(`gx-b-edit-${BOARD}`).click();
  await shot(page, 'board-dialog');
  await page.keyboard.press('Escape');
  await open(page, `leaderboard?id=${made.board}`);
  await expect(page.getByTestId(`gx-st-${players[2].id}`)).toBeVisible();
  await shot(page, 'standings');
  await page.getByTestId('gx-score-add').click();
  await shot(page, 'score-dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'دوره‌ها', exact: true }).click();
  await expect(page.locator('[data-testid^="gx-per-open-"]').first()).toBeVisible();
  await shot(page, 'periods');
  await page.locator('[data-testid^="gx-per-open-"]').first().click();
  await expect(page.getByTestId('gx-res-table')).toBeVisible();
  await shot(page, 'results');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'شروع دوباره', exact: true }).click();
  await shot(page, 'reset');
});

test('shots: player card, english and mobile', async ({ page }) => {
  await open(page, `player?id=${players[0].id}`);
  const card = page.getByTestId('pd-games');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByTestId(`pg-m-${made.finished}`)).toBeVisible();
  await settle(page);
  await card.screenshot({ path: `${DIR}/play-player-card.png` });
  await prefs(page, 'en', 'light');
  await open(page, `match?id=${made.finished}`);
  await shot(page, 'match-en');
  await open(page, `leaderboard?id=${made.board}`);
  await shot(page, 'standings-en');
  await prefs(page, 'fa', 'dark');
  await open(page, 'leaderboards');
  await shot(page, 'leaderboards-dark');
  await prefs(page, 'fa', 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'matches');
  await shot(page, 'matches-mobile');
  await open(page, `match?id=${made.finished}`);
  await shot(page, 'match-mobile');
});
