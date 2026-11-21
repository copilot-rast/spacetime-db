import type { Page } from '@playwright/test';
import { ECONOMY_QUERIES, GAMES_QUERIES, PLAYER_QUERIES, connect, login, loginOwner, tr, waitFor, type Client } from '../src/lib.ts';
import { expect, freshPage, open, stamp, test, toastOk, uniquePhone } from './fixtures.ts';

const S = stamp();
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMES_QUERIES];
const CUR = `gx${S}`;
const BOARD = `lb${S}`;
const rows = <T>(it: Iterable<T>) => [...it];
const fa = (n: number | bigint) => String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

type P = { c: Client; id: bigint; name: string };

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

let owner: Client;
let duelId = 0n;
const made = { currency: 0n, prize: 0n, rooms: [] as bigint[], board: 0n, support: 0n };
const ROOM = `pp${S}`;
const FEE_ROOM = `pc${S}`;
let a: P;
let b: P;
let c: P;
let d: P;
let matchId = 0n;
let cancelId = 0n;
let win: P;
let lose: P;
const supUser = `gs${S}`;
const supPass = `Pass${S}x9q`;

const bal = (p: P) => rows(p.c.conn.db.myWallet.iter()).find(w => w.currencyKey === CUR)?.balance ?? -1n;
const matchOf = (p: P, id: bigint) => rows(p.c.conn.db.myMatches.iter()).find(m => m.id === id);

let pn = 0;
async function player(): Promise<P> {
  const cl = await connect(undefined, Q);
  const r = await login(cl, uniquePhone('0936'));
  const name = `بازیکن ${S}-${++pn}`;
  await cl.conn.reducers.updateProfile({ displayName: name, lang: 'fa' });
  return { c: cl, id: r.accountId, name };
}

async function room(key: string, p: Record<string, unknown>) {
  await owner.conn.reducers.adminSaveGameRoom({
    id: 0n, gameId: duelId, key, name: tr(`اتاق ${key}`), entryCurrency: '', entryFee: 0n, prizeId: 0n, prizeGroupId: 0n, minLevel: 0, isLocked: false, isHidden: true, isActive: true, inheritGame: false,
    requirements: { itemKeys: [], itemsMode: 'any', consumeItems: false, tagIds: [], tagsMode: 'any', excludeTagIds: [], minLevel: 0, metas: [], productIds: [], paths: [], refund: 'return', lock: 'show', message: [] },
    sort: 99, ...p,
  } as never);
  await waitFor(() => rows(owner.conn.db.adminGameRooms.iter()).some(r => r.gameId === duelId && r.key === key));
  const id = rows(owner.conn.db.adminGameRooms.iter()).find(r => r.gameId === duelId && r.key === key)!.id;
  made.rooms.push(id);
  return id;
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
const run = () => owner.conn.procedures.adminGamesRun({});

async function confirm(page: Page) {
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
}

test.beforeAll(async () => {
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await waitFor(() => rows(owner.conn.db.adminGames.iter()).some(g => g.key === 'sample_duel'));
  duelId = rows(owner.conn.db.adminGames.iter()).find(g => g.key === 'sample_duel')!.id;
  const r = owner.conn.reducers;
  await r.adminSaveCurrency({ id: 0n, key: CUR, name: tr(`ژتون ${S}`), type: 'soft', defaultValue: 100n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(owner.conn.db.currency.iter()).some(x => x.key === CUR));
  made.currency = rows(owner.conn.db.currency.iter()).find(x => x.key === CUR)!.id;
  await r.adminSavePrize({ id: 0n, key: `gp${S}`, name: tr(`جایزهٔ برنده ${S}`), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items: [{ type: 'currency', key: CUR, action: 'add', value: 7 }] });
  await waitFor(() => rows(owner.conn.db.prize.iter()).some(x => x.key === `gp${S}`));
  made.prize = rows(owner.conn.db.prize.iter()).find(x => x.key === `gp${S}`)!.id;
  await room(ROOM, { prizeId: made.prize });
  await room(FEE_ROOM, { entryCurrency: CUR, entryFee: 10n });
  [a, b, c, d] = await Promise.all([player(), player(), player(), player()]);
  await waitFor(() => [a, b, c, d].every(p => bal(p) === 100n));
});

test.afterAll(async () => {
  const r = owner?.conn.reducers;
  if (r) {
    await run().catch(() => {});
    const lb = rows(owner.conn.db.adminLeaderboards.iter()).find(x => x.key === BOARD);
    if (lb) await r.adminDeleteLeaderboard({ id: lb.id }).catch(() => {});
    for (const id of made.rooms) await r.adminDeleteGameRoom({ id }).catch(() => {});
    if (made.prize) await r.adminDeletePrize({ id: made.prize }).catch(() => {});
    if (made.currency) await r.adminDeleteCurrency({ id: made.currency }).catch(() => {});
    if (made.support) await r.adminDeleteUser({ accountId: made.support }).catch(() => {});
  }
  owner?.conn.disconnect();
  for (const p of [a, b, c, d]) p?.c.conn.disconnect();
});

test('create a leaderboard for sample duel with a rank reward', async ({ page }) => {
  await open(page, 'leaderboards');
  await expect(page.getByTestId('page-leaderboards')).toBeVisible();
  await page.getByTestId('gx-b-add').click();
  const dlg = page.getByTestId('gx-board-dialog');
  await dlg.locator('input[name="key"]').fill(BOARD);
  await dlg.locator('input[name="name-fa"]').fill(`قهرمان‌های دوئل ${S}`);
  await dlg.getByRole('button', { name: 'همیشگی' }).click();
  await dlg.getByRole('button', { name: 'تعداد برد' }).click();
  await dlg.getByTestId('dialog-save').click();
  await expect(dlg.locator('.err-box')).toContainText('یک بازی انتخاب کنید');
  await dlg.getByTestId('gx-b-game').selectOption(String(duelId));
  await dlg.getByTestId('gx-b-rewards-add').click();
  await dlg.locator('input[name="rw-0-to"]').fill('۰');
  await dlg.getByTestId('dialog-save').click();
  await expect(dlg.locator('.err-box')).toContainText('یا یک جایزه یا یک گروه');
  await dlg.locator('input[name="rw-0-to"]').fill('۱');
  await dlg.getByTestId('gx-rw-0-prize').selectOption(String(made.prize));
  await dlg.getByTestId('dialog-save').click();
  await expect(dlg).toHaveCount(0);
  await toastOk(page);
  expect(await waitFor(() => rows(owner.conn.db.adminLeaderboards.iter()).some(x => x.key === BOARD))).toBe(true);
  const lb = rows(owner.conn.db.adminLeaderboards.iter()).find(x => x.key === BOARD)!;
  made.board = lb.id;
  expect(lb.source).toBe('wins');
  expect(lb.period).toBe('all');
  expect(lb.rewards).toEqual([{ fromRank: 1, toRank: 1, prizeId: made.prize, prizeGroupId: 0n }]);
  const row = page.getByTestId(`gx-b-row-${BOARD}`);
  await expect(row).toContainText(`قهرمان‌های دوئل ${S}`);
  await expect(row).toContainText('تعداد برد');
  await expect(row).toContainText('همیشگی');
  await expect(row).toContainText('۱ ردیف');
});

test('a real match: lists, detail with winner, loser and payout', async ({ page }) => {
  await join(a, ROOM);
  const jb = await join(b, ROOM);
  matchId = jb.matchId;
  expect(matchId > 0n).toBe(true);
  await a.c.conn.reducers.gamesReady({ matchId });
  await b.c.conn.reducers.gamesReady({ matchId });
  expect(await waitFor(() => matchOf(a, matchId)?.state === 'playing')).toBe(true);
  await a.c.conn.reducers.sampleDuelPlay({ matchId });
  expect(await waitFor(() => matchOf(a, matchId)?.state === 'finished' && matchOf(b, matchId)?.state === 'finished')).toBe(true);
  await run();
  [win, lose] = matchOf(a, matchId)!.myOutcome === 'win' ? [a, b] : [b, a];
  expect(await waitFor(() => bal(win) === 107n)).toBe(true);

  await open(page, `matches?player=${a.id}`);
  await expect(page.getByTestId('gx-m-player')).toHaveValue(String(a.id));
  const row = page.getByTestId(`gx-m-row-${matchId}`);
  await expect(row).toContainText('تمام‌شده');
  await expect(row).toContainText('نتیجه از کد بازی');
  await expect(row).toContainText('۲ بازیکن');
  await page.getByTestId('gx-m-state').selectOption('cancelled');
  await expect(row).toHaveCount(0);
  expect(page.url()).toContain('state=cancelled');
  await page.getByTestId('gx-m-state').selectOption('finished');
  await expect(row).toBeVisible();
  await page.getByTestId(`gx-m-open-${matchId}`).click();
  await expect(page.getByTestId('page-match')).toBeVisible();
  await expect(page.getByTestId('gx-match-title')).toContainText(fa(matchId));
  await expect(page.getByTestId('gx-match-state')).toContainText('تمام‌شده');
  await expect(page.getByTestId(`gx-pl-${win.id}`)).toContainText(win.name);
  await expect(page.getByTestId(`gx-pl-${win.id}`)).toContainText('برد');
  await expect(page.getByTestId(`gx-pl-${lose.id}`)).toContainText(lose.name);
  await expect(page.getByTestId(`gx-pl-${lose.id}`)).toContainText('باخت');
  await expect(page.getByTestId(`gx-po-${win.id}`)).toContainText(`جایزهٔ برنده ${S}`);
  await expect(page.getByTestId(`gx-po-${win.id}`)).toContainText('پرداخت‌شده');
  await expect(page.getByTestId(`gx-po-${lose.id}`)).toHaveCount(0);
  await expect(page.getByTestId('gx-cancel')).toHaveCount(0);
  await expect(page.getByTestId('gx-tickets')).toContainText('تمام‌شده');
});

test('leaderboard: standings, manual score, reset with pay and results', async ({ page }) => {
  await open(page, `leaderboard?id=${made.board}`);
  await expect(page.getByTestId('gx-board-title')).toContainText(`قهرمان‌های دوئل ${S}`);
  await expect(page.getByTestId(`gx-st-${win.id}`)).toContainText(win.name);
  await expect(page.getByTestId(`gx-st-score-${win.id}`)).toHaveText('۱');
  await page.getByTestId('gx-score-add').click();
  const dlg = page.getByTestId('gx-score-dialog');
  await dlg.locator('input[name="accountId"]').fill(fa(lose.id));
  await dlg.locator('input[name="score"]').fill('۵');
  await dlg.getByTestId('dialog-save').click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId(`gx-st-score-${lose.id}`)).toHaveText('۵');
  await expect(page.getByTestId(`gx-st-${lose.id}`)).toContainText('۱');
  await page.getByTestId('gx-score-add').click();
  await dlg.locator('input[name="accountId"]').fill('999999999');
  await dlg.locator('input[name="score"]').fill('3');
  await dlg.getByTestId('dialog-save').click();
  await expect(dlg.locator('.err-box')).toContainText('بازیکنی با این شناسه نیست');
  await dlg.getByRole('button', { name: 'انصراف' }).click();
  await page.getByRole('button', { name: 'شروع دوباره', exact: true }).click();
  await expect(page.getByTestId('gx-reset')).toBeVisible();
  await page.getByTestId('gx-reset-go').click();
  await confirm(page);
  await toastOk(page);
  await expect(page.getByTestId('gx-periods')).toBeVisible();
  const per = page.locator('[data-testid^="gx-per-open-"]').first();
  await expect(per).toBeVisible();
  await per.click();
  const res = page.getByTestId('gx-results');
  await expect(res.getByTestId(`gx-res-${lose.id}`)).toContainText(lose.name);
  await expect(res.getByTestId(`gx-res-${lose.id}`)).toContainText(`جایزهٔ برنده ${S}`);
  await expect(res.getByTestId(`gx-res-pay-${lose.id}`)).toContainText(/در انتظار|پرداخت‌شده/);
  await expect(res.getByTestId(`gx-res-pay-${win.id}`)).toHaveText('—');
  if (await res.getByTestId('gx-pay').count()) {
    await res.getByTestId('gx-pay').click();
    await toastOk(page);
  }
  await run();
  expect(await waitFor(() => bal(lose) === 107n)).toBe(true);
  await res.getByRole('button', { name: 'بستن' }).last().click();
  await per.click();
  await expect(res.getByTestId(`gx-res-pay-${lose.id}`)).toContainText('پرداخت‌شده');
  await res.getByRole('button', { name: 'بستن' }).last().click();
  await page.getByRole('button', { name: 'رتبه‌بندی', exact: true }).click();
  await expect(page.getByTestId('gx-st-table')).toContainText('هنوز امتیازی ثبت نشده');
});

test('payouts page lists match and board prizes, retry only for failed', async ({ page }) => {
  await open(page, `game-payouts?player=${lose.id}`);
  const table = page.getByTestId('gx-p-table');
  await expect(table).toContainText('رتبهٔ جدول');
  await expect(table).toContainText('پرداخت‌شده');
  await expect(table.locator('[data-testid^="gx-retry-"]')).toHaveCount(0);
  await page.getByTestId('gx-p-player').fill(String(win.id));
  await expect(table).toContainText('برد مسابقه');
  await expect(table).toContainText(`مسابقهٔ #${fa(matchId)}`);
  await page.getByTestId('gx-p-kind').selectOption('leaderboard');
  await expect(table).toContainText('جایزه‌ای پیدا نشد');
  expect(page.url()).toContain('kind=leaderboard');
  await page.getByTestId('gx-p-kind').selectOption('');
  await page.getByTestId('gx-p-status').selectOption('failed');
  await expect(table).toContainText('جایزه‌ای پیدا نشد');
});

test('cancel a waiting match with refund from the match page', async ({ page }) => {
  await join(c, FEE_ROOM);
  const jd = await join(d, FEE_ROOM);
  cancelId = jd.matchId;
  expect(cancelId > 0n).toBe(true);
  expect(await waitFor(() => bal(c) === 90n && bal(d) === 90n)).toBe(true);
  await open(page, `match?id=${cancelId}`);
  await expect(page.getByTestId('gx-match-state')).toContainText('در انتظار');
  await expect(page.getByTestId(`gx-tk-${c.id}`)).toContainText('۱۰');
  await expect(page.getByTestId(`gx-tk-${c.id}`)).not.toContainText('ورودی برگشت');
  await page.getByTestId('gx-cancel').click();
  const dlg = page.getByTestId('gx-cancel-dialog');
  await expect(dlg.getByTestId('gx-cancel-refund')).toHaveAttribute('aria-checked', 'true');
  await dlg.locator('input[name="reason"]').fill(`آزمایش ${S}`);
  await dlg.getByTestId('dialog-save').click();
  await expect(dlg).toHaveCount(0);
  await toastOk(page);
  await expect(page.getByTestId('gx-match-state')).toContainText('لغوشده');
  await expect(page.getByTestId('gx-match-reason')).toContainText(`آزمایش ${S}`);
  await expect(page.getByTestId(`gx-tk-${c.id}`)).toContainText('ورودی برگشت');
  await expect(page.getByTestId('gx-cancel')).toHaveCount(0);
  expect(await waitFor(() => bal(c) === 100n && bal(d) === 100n)).toBe(true);
});

test('player card shows the match and links to filtered matches', async ({ page }) => {
  await open(page, `player?id=${win.id}`);
  const card = page.getByTestId('pd-games');
  await expect(card).toBeVisible();
  await expect(card.getByTestId(`pg-m-${matchId}`)).toContainText('برد');
  await expect(card.getByTestId('pg-wins')).toHaveText('۱');
  await expect(card.getByTestId('pg-boards')).toContainText('در هیچ جدولی امتیاز ندارد');
  await card.getByTestId('pg-matches').click();
  await expect(page.getByTestId('page-matches')).toBeVisible();
  await expect(page.getByTestId(`gx-m-row-${matchId}`)).toBeVisible();
});

test('matches list becomes cards on mobile', async ({ page }) => {
  await open(page, `matches?player=${c.id}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('gx-m-table')).toBeHidden();
  const card = page.getByTestId(`gx-mc-${cancelId}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText('لغوشده');
  const box = await card.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await card.click();
  await expect(page.getByTestId('gx-match-title')).toContainText(fa(cancelId));
});

test('support user sees matches without admin actions or player links', async ({ page }) => {
  await owner.conn.reducers.adminCreateUser({ username: supUser, password: supPass, role: 'support' });
  await waitFor(() => rows(owner.conn.db.adminAdmins.iter()).some(x => x.username === supUser));
  made.support = rows(owner.conn.db.adminAdmins.iter()).find(x => x.username === supUser)!.accountId;
  const sp = await freshPage(page.context().browser()!);
  await sp.goto('/');
  await sp.locator('#c-db').fill(process.env.STG_DB!);
  await sp.getByTestId('connect-go').click();
  await sp.locator('#l-user').fill(supUser);
  await sp.locator('#l-pass').fill(supPass);
  await sp.getByTestId('login-pass-go').click();
  await expect(sp.locator('.rail')).toBeVisible();
  await sp.goto(`/#/matches?player=${a.id}`);
  await expect(sp.getByTestId(`gx-m-row-${matchId}`)).toContainText('تمام‌شده');
  await sp.goto(`/#/match?id=${cancelId}`);
  await expect(sp.getByTestId('gx-match-state')).toContainText('لغوشده');
  await expect(sp.getByTestId(`gx-tk-${c.id}`)).toContainText(`#${fa(c.id)}`);
  await expect(sp.locator('[data-testid="page-match"] a[href^="#/player"]')).toHaveCount(0);
  await expect(sp.getByTestId('gx-cancel')).toHaveCount(0);
});

test('delete the leaderboard after its payouts are paid', async ({ page }) => {
  await run();
  await open(page, 'leaderboards');
  await page.getByTestId(`gx-b-del-${BOARD}`).click();
  await confirm(page);
  await toastOk(page);
  await expect(page.getByTestId(`gx-b-row-${BOARD}`)).toHaveCount(0);
  expect(await waitFor(() => !rows(owner.conn.db.adminLeaderboards.iter()).some(x => x.key === BOARD))).toBe(true);
});
