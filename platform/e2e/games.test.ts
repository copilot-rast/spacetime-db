import { ECONOMY_QUERIES, GAMES_QUERIES, GAMIFICATION_QUERIES, ITEMS_QUERIES, PLAYER_QUERIES, check, connect, done, errorOf, login, loginOwner, panelUser, sql, tr, uniquePhone, waitFor, type Client } from './src/lib.ts';

const R = String(Date.now() % 10_000_000);
const k = (s: string) => `${s}_${R}`;
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMIFICATION_QUERIES, ...ITEMS_QUERIES, ...GAMES_QUERIES];
const c = (token?: string) => connect(token, Q);
const rows = <T>(it: Iterable<T>) => [...it];
const DAY = 86400;

let o: Client;
let T = 0;
type GameArgs = Parameters<Client['conn']['reducers']['adminSaveGame']>[0];
type RoomArgs = Parameters<Client['conn']['reducers']['adminSaveGameRoom']>[0];
type BoardArgs = Parameters<Client['conn']['reducers']['adminSaveLeaderboard']>[0];
type Req = GameArgs['requirements'];
type P = { p: Client; id: bigint; name: string };

const gold = k('gold');
const REQ: Req = { itemKeys: [], itemsMode: 'any', consumeItems: false, tagIds: [], tagsMode: 'any', excludeTagIds: [], minLevel: 0, metas: [], productIds: [], paths: [], refund: 'return', lock: 'show', message: [] };
const TEST_SETTINGS = { ticketTtlSeconds: 3600, startTimeoutSeconds: 3600, playTimeoutSeconds: 0, maxTicketsPerPlayer: 3, payoutMaxTries: 8, weekStart: 6, monthCalendar: 'jalali', historyDays: 0 };
const DEFAULT_SETTINGS = { ticketTtlSeconds: 300, startTimeoutSeconds: 60, playTimeoutSeconds: 3600, maxTicketsPerPlayer: 3, payoutMaxTries: 8, weekStart: 6, monthCalendar: 'jalali', historyDays: 90 };
const bal = (cl: Client) => rows(cl.conn.db.myWallet.iter()).find(w => w.currencyKey === gold)?.balance ?? -1n;
const metaOf = (cl: Client, key: string) => rows(cl.conn.db.myMetas.iter()).find(m => m.metaKey === key)?.value ?? 0;
const inv = (cl: Client, key: string) => rows(cl.conn.db.myInventory.iter()).find(r => r.itemKey === key)?.quantity ?? 0;
const tickets = (cl: Client) => rows(cl.conn.db.myGameTickets.iter());
const matchOf = (cl: Client, id: bigint) => rows(cl.conn.db.myMatches.iter()).find(m => m.id === id);
const gameRow = (key: string) => rows(o.conn.db.adminGames.iter()).find(g => g.key === key)!;
const listed = (cl: Client, key: string) => rows(cl.conn.db.gamesList.iter()).find(g => g.key === key);
const listedRoom = (cl: Client, game: string, room: string) => listed(cl, game)?.rooms.find(r => r.key === room);

async function clock(sec: number) {
  T = sec;
  await o.conn.reducers.adminSetGamesClockOffset({ seconds: BigInt(sec) });
  await waitFor(() => rows(o.conn.db.adminGamesSettings.iter())[0]?.clockOffsetSec === BigInt(sec));
}
const advance = (sec: number) => clock(T + sec);
async function settings(p: Partial<typeof TEST_SETTINGS>) {
  const s = { ...TEST_SETTINGS, ...p };
  await o.conn.reducers.adminSaveGamesSettings(s);
  await waitFor(() => rows(o.conn.db.adminGamesSettings.iter())[0]?.ticketTtlSeconds === s.ticketTtlSeconds && rows(o.conn.db.adminGamesSettings.iter())[0]?.maxTicketsPerPlayer === s.maxTicketsPerPlayer && rows(o.conn.db.adminGamesSettings.iter())[0]?.startTimeoutSeconds === s.startTimeoutSeconds);
}
const run = () => o.conn.procedures.adminGamesRun({});

function argsOf(key: string): GameArgs {
  const g = gameRow(key);
  return {
    id: g.id,
    key: g.key,
    name: g.name,
    description: g.description,
    iconUrl: g.iconUrl,
    isActive: g.isActive,
    maintenance: g.maintenance,
    maintenanceMessage: g.maintenanceMessage,
    sort: g.sort,
    categoryId: g.categoryId,
    tagIds: g.tagIds,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    turnSeconds: g.turnSeconds,
    matchSeconds: g.matchSeconds,
    botsAllowed: g.botsAllowed,
    botAfterSeconds: g.botAfterSeconds,
    friendAllowed: g.friendAllowed,
    platforms: g.platforms,
    minVersions: g.minVersions,
    skillMetaKey: g.skillMetaKey,
    bandSize: g.bandSize,
    widenEverySeconds: g.widenEverySeconds,
    widenStep: g.widenStep,
    maxBand: g.maxBand,
    fillAfterSeconds: g.fillAfterSeconds,
    settings: g.settings,
    requirements: g.requirements,
  };
}
async function saveGame(key: string, p: Partial<GameArgs>) {
  const old = gameRow(key).updatedAt.microsSinceUnixEpoch;
  await o.conn.reducers.adminSaveGame({ ...argsOf(key), ...p });
  await waitFor(() => gameRow(key).updatedAt.microsSinceUnixEpoch > old);
}
const DUEL_DEFAULTS: Partial<GameArgs> = { isActive: true, maintenance: false, maintenanceMessage: [], botsAllowed: false, botAfterSeconds: 20, friendAllowed: true, platforms: [], minVersions: [], skillMetaKey: '', bandSize: 3, widenEverySeconds: 10, widenStep: 2, maxBand: 0, fillAfterSeconds: 30, settings: '{"rounds":3,"theme":"day"}', requirements: REQ };
const PARTY_DEFAULTS: Partial<GameArgs> = { ...DUEL_DEFAULTS, settings: '{}' };

function roomArgs(r: ReturnType<typeof gameRoomRow>): RoomArgs {
  return { id: r.id, gameId: r.gameId, key: r.key, name: r.name, entryCurrency: r.entryCurrency, entryFee: r.entryFee, prizeId: r.prizeId, prizeGroupId: r.prizeGroupId, minLevel: r.minLevel, isLocked: r.isLocked, isHidden: r.isHidden, isActive: r.isActive, inheritGame: r.inheritGame, requirements: r.requirements, sort: r.sort };
}
function gameRoomRow(id: bigint) {
  return rows(o.conn.db.adminGameRooms.iter()).find(r => r.id === id)!;
}
function boardArgs(b: ReturnType<typeof boardRow>): BoardArgs {
  return { id: b.id, key: b.key, gameId: b.gameId, name: b.name, description: b.description, iconUrl: b.iconUrl, period: b.period, scoreMode: b.scoreMode, order: b.order, source: b.source, topN: b.topN, rewards: b.rewards, isActive: b.isActive, sort: b.sort };
}
async function room(gameKey: string, key: string, p: Partial<RoomArgs> = {}) {
  const g = gameRow(gameKey);
  const old = rows(o.conn.db.adminGameRooms.iter()).find(r => r.gameId === g.id && r.key === key);
  await o.conn.reducers.adminSaveGameRoom({ id: old?.id ?? 0n, gameId: g.id, key, name: tr(key), entryCurrency: '', entryFee: 0n, prizeId: 0n, prizeGroupId: 0n, minLevel: 0, isLocked: false, isHidden: false, isActive: true, inheritGame: true, requirements: REQ, sort: 0, ...p });
  await waitFor(() => rows(o.conn.db.adminGameRooms.iter()).some(r => r.gameId === g.id && r.key === key && (!old || r.updatedAt.microsSinceUnixEpoch > old.updatedAt.microsSinceUnixEpoch)));
  return rows(o.conn.db.adminGameRooms.iter()).find(r => r.gameId === g.id && r.key === key)!;
}
let pn = 0;
async function player(): Promise<P> {
  const p = await c();
  const r = await login(p, uniquePhone('0937'));
  const name = `Gamer ${R.slice(-4)}${++pn}`;
  await p.conn.reducers.updateProfile({ displayName: name, lang: 'fa' });
  await waitFor(() => bal(p) === 1000n);
  return { p, id: r.accountId, name };
}
const join = (pl: P, gameKey: string, roomKey: string, x: Partial<{ path: string; code: string; platform: string; appVersion: string }> = {}) =>
  pl.p.conn.procedures.gamesJoin({ gameKey, roomKey, path: 'matchmaking', code: '', platform: '', appVersion: '', ...x });
function refusalOf(err: string) {
  const m = err.match(/REQUIREMENTS_NOT_MET:(\{.*\})/s);
  return m ? (JSON.parse(m[1]) as { game: string; room: string; path: string; message: string; missing: { type: string; mode?: string; keys?: string[]; key?: string; minLevel?: number; level?: number; have?: number; consume?: number }[]; products: { productId: string; key: string; satisfies: string[] }[] }) : undefined;
}
async function prize(key: string, items: { type: string; key: string; action: string; value: number }[], isRepeatable = true) {
  await o.conn.reducers.adminSavePrize({ id: 0n, key, name: tr(key), message: [], categoryId: 0n, tagIds: [], isRepeatable, items });
  await waitFor(() => rows(o.conn.db.prize.iter()).some(x => x.key === key));
  return rows(o.conn.db.prize.iter()).find(x => x.key === key)!.id;
}
async function tag(key: string, keyType = 'user') {
  await o.conn.reducers.adminSaveTag({ id: 0n, keyType, key, title: tr(key), color: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.tag.iter()).some(x => x.key === key && x.keyType === keyType));
  return rows(o.conn.db.tag.iter()).find(x => x.key === key && x.keyType === keyType)!.id;
}
async function item(key: string, p: Record<string, unknown> = {}) {
  await o.conn.reducers.adminSaveItem({ id: 0n, key, typeKey: 'skin', name: tr(key), description: [], iconUrl: '', imageUrl: '', categoryId: 0n, tagIds: [], rarity: 'common', stackable: false, maxStack: 0, requiresKey: '', isStarter: false, starterQuantity: 0, levelTableId: 0n, unlockLevel: 0, price: undefined, upgrades: [], services: [], usePrizeId: 0n, metadata: '', sort: 0, isActive: true, ...p } as never);
  await waitFor(() => rows(o.conn.db.item.iter()).some(x => x.key === key));
  return rows(o.conn.db.item.iter()).find(x => x.key === key)!;
}
async function product(key: string, prizeId: bigint) {
  await o.conn.reducers.adminSaveProduct({ id: 0n, key, name: tr(key), description: [], isActive: true, categoryId: 0n, tagIds: [], audienceTagIds: [], priceToman: 0n, coinCurrency: gold, coinAmount: 10n, discountPercent: 0, paymentMethods: ['in_app'], skuBazaar: '', skuMyket: '', prizeId, iconUrl: '', coverUrl: '', sort: 0 });
  const list = await o.conn.procedures.adminProducts({ query: key, categoryId: 0n, isActive: '', page: 1, pageSize: 50 });
  return list.rows.find(r => r.key === key)!.id;
}
async function board(key: string, p: Partial<BoardArgs>) {
  const old = rows(o.conn.db.adminLeaderboards.iter()).find(b => b.key === key);
  await o.conn.reducers.adminSaveLeaderboard({ id: old?.id ?? 0n, key, gameId: 0n, name: tr(key), description: [], iconUrl: '', period: 'daily', scoreMode: 'best', order: 'desc', source: 'server', topN: 10, rewards: [], isActive: true, sort: 0, ...p });
  await waitFor(() => rows(o.conn.db.adminLeaderboards.iter()).some(b => b.key === key && (!old || b.updatedAt.microsSinceUnixEpoch > old.updatedAt.microsSinceUnixEpoch)));
  return rows(o.conn.db.adminLeaderboards.iter()).find(b => b.key === key)!;
}
const boardRow = (key: string) => rows(o.conn.db.adminLeaderboards.iter()).find(b => b.key === key)!;
async function pair(a: P, b: P, gameKey: string, roomKey: string) {
  const ja = await join(a, gameKey, roomKey);
  const jb = await join(b, gameKey, roomKey);
  return { ja, jb, matchId: jb.matchId };
}
async function play(a: P, b: P, gameKey: string, roomKey: string) {
  const { matchId } = await pair(a, b, gameKey, roomKey);
  await a.p.conn.reducers.gamesReady({ matchId });
  await b.p.conn.reducers.gamesReady({ matchId });
  await waitFor(() => matchOf(a.p, matchId)?.state === 'playing');
  return matchId;
}
const report = (matchId: bigint, results: { accountId: bigint; rank: number; score: number }[], cl: Client = o) => cl.conn.reducers.gamesReportResult({ matchId, results });

function tehranDate(sec: number) {
  return new Date(Date.now() + sec * 1000 + 3.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function jalaliMonth(sec: number) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric' }).formatToParts(new Date(Date.now() + sec * 1000));
  return `j${parts.find(x => x.type === 'year')!.value}-${parts.find(x => x.type === 'month')!.value.padStart(2, '0')}`;
}
function weekStartOf(sec: number) {
  const d = new Date(`${tehranDate(sec)}T00:00:00Z`);
  const back = (d.getUTCDay() - 6 + 7) % 7;
  return new Date(d.getTime() - back * DAY * 1000).toISOString().slice(0, 10);
}

async function main() {
  o = await c();
  await loginOwner(o);
  await clock(0);
  await settings({});
  await waitFor(() => !!rows(o.conn.db.adminGames.iter()).find(g => g.key === 'sample_duel'));
  await saveGame('sample_duel', { ...DUEL_DEFAULTS, bandSize: 1000 });
  await saveGame('sample_party', { ...PARTY_DEFAULTS, bandSize: 1000 });

  const duel = gameRow('sample_duel');
  const party = gameRow('sample_party');
  check('sample game registered from src/game', duel.registered && duel.realtime && duel.codeName === 'Sample Duel' && duel.minPlayers === 2 && duel.maxPlayers === 2, duel);
  check('second sample game registered', party.registered && !party.realtime && party.minPlayers === 2 && party.maxPlayers === 4, party);
  check('settings schema stored from code', JSON.parse(duel.settingsSchema).properties.rounds.maximum === 9);
  check('settings filled with schema defaults', JSON.parse(duel.settings).rounds === 3 && JSON.parse(duel.settings).theme === 'day', duel.settings);
  check('main room seeded for a registered game', rows(o.conn.db.adminGameRooms.iter()).some(r => r.gameId === duel.id && r.key === 'main'));
  check('game key type seeded', rows(o.conn.db.keyType.iter()).some(x => x.key === 'game' && x.forCategory && x.forTag));
  check('game events seeded server only', ['game_played', 'game_won'].every(key => rows(o.conn.db.eventType.iter()).some(x => x.key === key && x.isSystem && !x.clientAllowed)));
  const defaults = rows(o.conn.db.adminGamesSettings.iter())[0];
  check('games settings row present', !!defaults && defaults.weekStart === 6 && defaults.monthCalendar === 'jalali' && defaults.payoutMaxTries === 8, defaults);
  check('tick timer scheduled', /\d/.test(sql('SELECT scheduled_id FROM games_tick_timer')));

  await o.conn.reducers.adminSaveCurrency({ id: 0n, key: gold, name: tr('طلا'), type: 'soft', defaultValue: 1000n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.currency.iter()).some(x => x.key === gold));
  const xp = k('xp');
  const gems = k('gems');
  const skill = k('skill');
  for (const m of [xp, gems, skill]) {
    await o.conn.reducers.adminSaveMeta({ id: 0n, key: m, name: tr(m), defaultValue: 0, serverOnly: false });
    await waitFor(() => rows(o.conn.db.meta.iter()).some(x => x.key === m));
  }
  await o.conn.reducers.adminSaveLevelTable({ id: 0n, key: k('lt'), name: tr('سطح'), description: [], metaKey: xp, levelMetaKey: '', steps: [{ level: 1, threshold: 10, title: [], prizeId: 0n, grantMode: 'auto' }, { level: 2, threshold: 100, title: [], prizeId: 0n, grantMode: 'auto' }, { level: 3, threshold: 1000, title: [], prizeId: 0n, grantMode: 'auto' }], isActive: true, sort: Math.min(0, ...rows(o.conn.db.adminLevelTables.iter()).map(x => x.sort)) - 1 });
  await waitFor(() => rows(o.conn.db.adminLevelTables.iter()).some(x => x.key === k('lt')));
  const lt = rows(o.conn.db.adminLevelTables.iter()).find(x => x.key === k('lt'))!;

  const pWin = await prize(k('p_win'), [{ type: 'currency', key: gold, action: 'add', value: 200 }]);
  const pSmall = await prize(k('p_small'), [{ type: 'currency', key: gold, action: 'add', value: 20 }]);
  const pOnce = await prize(k('p_once'), [{ type: 'currency', key: gold, action: 'add', value: 5 }], false);
  await o.conn.reducers.adminSavePrizeGroup({ id: 0n, key: k('g_win'), name: tr('گروه'), entries: [{ prizeId: pWin, weight: 1 }, { prizeId: pSmall, weight: 1 }], isActive: true });
  await waitFor(() => rows(o.conn.db.prizeGroup.iter()).some(x => x.key === k('g_win')));
  const gWin = rows(o.conn.db.prizeGroup.iter()).find(x => x.key === k('g_win'))!.id;
  const skinA = await item(k('skin_a'));
  const skinB = await item(k('skin_b'));
  const pass = await item(k('pass'), { typeKey: 'booster', stackable: true, maxStack: 50 });
  const starter = await item(k('starter'), { typeKey: 'booster', stackable: true, isStarter: true, starterQuantity: 1, isActive: false });
  const pSkinA = await prize(k('p_skin_a'), [{ type: 'item', key: skinA.key, action: 'give', value: 1 }]);
  const pGems = await prize(k('p_gems'), [{ type: 'meta', key: gems, action: 'add', value: 5 }]);
  const prodA = await product(k('prod_a'), pSkinA);
  const prodGems = await product(k('prod_gems'), pGems);
  const vip = await tag(k('vip'));
  const member = await tag(k('member'));
  const banned = await tag(k('banned'));
  const secret = await tag(k('secret'));
  const itemTag = await tag(k('itag'), 'item');
  await o.conn.reducers.adminSetTagVisibility({ tagId: banned, isPublic: true });

  const pl = await player();
  check('player sees registered games', await waitFor(() => !!listed(pl.p, 'sample_duel') && !!listed(pl.p, 'sample_party')));
  check('list carries game settings and rooms', listed(pl.p, 'sample_duel')!.settings.includes('rounds') && !!listedRoom(pl.p, 'sample_duel', 'main'));
  check('list shows per-path availability', (() => {
    const g = listed(pl.p, 'sample_duel')!;
    return g.paths.find(x => x.path === 'matchmaking')!.eligible && !g.paths.find(x => x.path === 'bot')!.available && g.paths.find(x => x.path === 'friend')!.available;
  })());
  check('player sees no admin game views', rows(pl.p.conn.db.adminGames.iter()).length === 0 && rows(pl.p.conn.db.adminGameRooms.iter()).length === 0 && rows(pl.p.conn.db.adminGamesSettings.iter()).length === 0 && rows(pl.p.conn.db.adminLeaderboards.iter()).length === 0 && rows(pl.p.conn.db.adminGameServers.iter()).length === 0);
  check('player cannot save games', (await errorOf(pl.p.conn.reducers.adminSaveGame(argsOf('sample_duel')))).includes('FORBIDDEN'));
  check('player cannot save rooms', (await errorOf(pl.p.conn.reducers.adminSaveGameRoom({ id: 0n, gameId: duel.id, key: 'x', name: tr('x'), entryCurrency: '', entryFee: 0n, prizeId: 0n, prizeGroupId: 0n, minLevel: 0, isLocked: false, isHidden: false, isActive: true, inheritGame: true, requirements: REQ, sort: 0 }))).includes('FORBIDDEN'));
  check('player cannot move the games clock', (await errorOf(pl.p.conn.reducers.adminSetGamesClockOffset({ seconds: 5n }))).includes('FORBIDDEN'));
  check('player cannot change games settings', (await errorOf(pl.p.conn.reducers.adminSaveGamesSettings(TEST_SETTINGS))).includes('FORBIDDEN'));
  check('player cannot run the matcher', (await errorOf(pl.p.conn.procedures.adminGamesRun({}))).includes('FORBIDDEN'));
  check('player cannot list matches', (await errorOf(pl.p.conn.procedures.adminMatches({ gameId: 0n, state: '', accountId: 0n, page: 1, pageSize: 10 }))).includes('FORBIDDEN'));

  const op = await panelUser(o, 'operator', Q);
  check('operator reads admin games', await waitFor(() => rows(op.client.conn.db.adminGames.iter()).some(g => g.key === 'sample_duel')));
  check('operator cannot save games', (await errorOf(op.client.conn.reducers.adminSaveGame(argsOf('sample_duel')))).includes('FORBIDDEN'));
  check('operator cannot cancel matches', (await errorOf(op.client.conn.reducers.adminCancelMatch({ matchId: 1n, refund: true, reason: '' }))).includes('FORBIDDEN'));
  check('operator cannot report results', (await errorOf(report(1n, [], op.client))).includes('FORBIDDEN'));
  const sup = await panelUser(o, 'support', Q);
  check('support reads player game history', !!(await sup.client.conn.procedures.adminPlayerGames({ accountId: pl.id })));
  check('support sees no game settings view', rows(sup.client.conn.db.adminGames.iter()).length === 0);
  check('support cannot read payouts', (await errorOf(sup.client.conn.procedures.adminGamePayouts({ kind: '', status: '', accountId: 0n, page: 1, pageSize: 10 }))).includes('FORBIDDEN'));
  op.client.conn.disconnect();
  sup.client.conn.disconnect();

  check('settings over the schema maximum refused', (await errorOf(saveGame('sample_duel', { settings: '{"rounds":12}' }))).includes('INVALID_SETTINGS:rounds:maximum'));
  check('settings outside an enum refused', (await errorOf(saveGame('sample_duel', { settings: '{"theme":"dusk"}' }))).includes('INVALID_SETTINGS:theme:enum'));
  check('unknown setting refused', (await errorOf(saveGame('sample_duel', { settings: '{"foo":1}' }))).includes('INVALID_SETTINGS:foo:unknown'));
  check('setting of the wrong type refused', (await errorOf(saveGame('sample_duel', { settings: '{"rounds":"three"}' }))).includes('INVALID_SETTINGS:rounds:type'));
  check('non integer refused', (await errorOf(saveGame('sample_duel', { settings: '{"rounds":2.5}' }))).includes('INVALID_SETTINGS:rounds:type'));
  check('settings must be JSON', (await errorOf(saveGame('sample_duel', { settings: 'nope' }))).includes('INVALID_SETTINGS'));
  await saveGame('sample_duel', { settings: '{"rounds":5}' });
  check('valid settings merge with defaults', JSON.parse(gameRow('sample_duel').settings).rounds === 5 && JSON.parse(gameRow('sample_duel').settings).theme === 'day');
  check('game key is locked', (await errorOf(o.conn.reducers.adminSaveGame({ ...argsOf('sample_duel'), key: 'other_key' }))).includes('KEY_LOCKED'));
  check('min players above max refused', (await errorOf(saveGame('sample_duel', { minPlayers: 3, maxPlayers: 2 }))).includes('INVALID_PLAYERS'));
  check('unknown platform refused', (await errorOf(saveGame('sample_duel', { platforms: ['amiga'] }))).includes('INVALID_PLATFORM'));
  check('bad minimum version refused', (await errorOf(saveGame('sample_duel', { minVersions: [{ platform: 'android', version: 'x.y' }] }))).includes('INVALID_VERSION'));
  check('unknown skill meta refused', (await errorOf(saveGame('sample_duel', { skillMetaKey: 'nope_meta' }))).includes('META_NOT_FOUND'));
  check('item tag on a game refused', (await errorOf(saveGame('sample_duel', { tagIds: [itemTag] }))).includes('TAG_KIND_MISMATCH'));
  const gtag = await tag(k('gtag'), 'game');
  await saveGame('sample_duel', { tagIds: [gtag] });
  check('game tag accepted', gameRow('sample_duel').tagIds.includes(gtag));
  await saveGame('sample_duel', { tagIds: [] });

  const ext = k('ext');
  await o.conn.reducers.adminSaveGame({ ...argsOf('sample_party'), id: 0n, key: ext, name: tr('بیرونی', 'External') });
  await waitFor(() => !!rows(o.conn.db.adminGames.iter()).find(g => g.key === ext));
  check('a game not in code is stored unregistered', gameRow(ext).registered === false && gameRow(ext).settingsSchema === '');
  check('an unregistered game is not listed', !listed(pl.p, ext));
  check('an unregistered game cannot be joined', (await errorOf(join(pl, ext, ''))).includes('GAME_NOT_FOUND'));
  check('a registered game cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteGame({ id: duel.id }))).includes('GAME_REGISTERED'));
  await o.conn.reducers.adminDeleteGame({ id: gameRow(ext).id });
  check('unregistered game deleted', await waitFor(() => !rows(o.conn.db.adminGames.iter()).some(g => g.key === ext)));

  check('fee in an unknown currency refused', (await errorOf(room('sample_duel', k('bad'), { entryFee: 5n, entryCurrency: 'nope' }))).includes('CURRENCY_NOT_FOUND'));
  check('negative fee refused', (await errorOf(room('sample_duel', k('bad'), { entryFee: -1n, entryCurrency: gold }))).includes('INVALID_FEE'));
  check('prize and group together refused', (await errorOf(room('sample_duel', k('bad'), { prizeId: pWin, prizeGroupId: gWin }))).includes('PRIZE_AND_GROUP'));
  check('unknown prize refused', (await errorOf(room('sample_duel', k('bad'), { prizeId: 999999999n }))).includes('PRIZE_NOT_FOUND'));
  const bad = (p: Partial<Req>) => errorOf(room('sample_duel', k('bad'), { requirements: { ...REQ, ...p } }));
  check('requirement with unknown item refused', (await bad({ itemKeys: ['nope_item'] })).includes('ITEM_NOT_FOUND:room.requirements'));
  check('starter item as a ticket refused', (await bad({ itemKeys: [starter.key], consumeItems: true })).includes('STARTER_TICKET'));
  check('item tag in a player requirement refused', (await bad({ tagIds: [itemTag] })).includes('TAG_KIND_MISMATCH'));
  check('tag wanted and excluded refused', (await bad({ tagIds: [vip], excludeTagIds: [vip] })).includes('TAG_BOTH_WAYS'));
  check('unknown meta refused', (await bad({ metas: [{ metaKey: 'nope_meta', operator: 'gte', value: 1, consume: 0 }] })).includes('META_NOT_FOUND'));
  check('bad operator refused', (await bad({ metas: [{ metaKey: gems, operator: 'about', value: 1, consume: 0 }] })).includes('INVALID_OPERATOR'));
  check('negative consume refused', (await bad({ metas: [{ metaKey: gems, operator: 'gte', value: 1, consume: -1 }] })).includes('INVALID_CONSUME'));
  check('unknown path refused', (await bad({ minLevel: 1, paths: ['teleport'] })).includes('INVALID_PATH'));
  check('unknown product refused', (await bad({ minLevel: 1, productIds: [999999999n] })).includes('PRODUCT_NOT_FOUND'));
  check('bad mode refused', (await bad({ itemKeys: [skinA.key], itemsMode: 'some' })).includes('INVALID_REQUIREMENT'));
  check('too many requirements refused', (await bad({ tagIds: Array.from({ length: 21 }, (_, i) => BigInt(i + 1)) })).includes('TOO_MANY_REQUIREMENTS'));
  const allPaths = await room('sample_duel', k('allpaths'), { requirements: { ...REQ, minLevel: 1, paths: ['matchmaking', 'bot', 'friend'] } });
  check('all three paths are stored as none', allPaths.requirements.paths.length === 0 && allPaths.requirements.minLevel === 1);
  await room('sample_duel', k('allpaths'), { isActive: false });

  const feeRoom = await room('sample_duel', k('fee'), { entryFee: 50n, entryCurrency: gold, prizeId: pWin, sort: 1 });
  check('room saved with fee and prize', feeRoom.entryFee === 50n && feeRoom.prizeId === pWin);
  check('room key unique per game', (await errorOf(o.conn.reducers.adminSaveGameRoom({ ...roomArgs(feeRoom), id: 0n }))).includes('KEY_TAKEN'));
  check('currency used as a fee cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteCurrency({ id: rows(o.conn.db.currency.iter()).find(x => x.key === gold)!.id }))).includes('IN_USE'));
  check('room prize cannot be deleted', (await errorOf(o.conn.reducers.adminDeletePrize({ id: pWin }))).includes('IN_USE'));
  check('fee room listed for players', await waitFor(() => listedRoom(pl.p, 'sample_duel', feeRoom.key)?.entryFee === 50n));

  const p1 = await player();
  const p2 = await player();
  const j1 = await join(p1, 'sample_duel', feeRoom.key);
  check('join answers a waiting ticket', j1.status === 'waiting' && !j1.existing && j1.fee === 50n && j1.feeCurrency === gold, j1);
  check('entry fee taken on join', await waitFor(() => bal(p1.p) === 950n));
  check('ticket visible to its owner', await waitFor(() => tickets(p1.p).some(x => x.id === j1.ticketId && x.status === 'waiting')));
  const j1b = await join(p1, 'sample_duel', feeRoom.key);
  check('a second join answers the same ticket', j1b.existing && j1b.ticketId === j1.ticketId);
  check('a second join charges nothing', bal(p1.p) === 950n && (await waitFor(() => bal(p1.p) === 950n)));
  check('other player sees nothing of that ticket', tickets(p2.p).length === 0);
  check('player cannot cancel another ticket', (await errorOf(p2.p.conn.reducers.gamesCancel({ ticketId: j1.ticketId }))).includes('TICKET_NOT_FOUND'));
  const par = await Promise.allSettled(Array.from({ length: 5 }, () => join(p2, 'sample_duel', feeRoom.key)));
  const ok = par.filter(x => x.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof join>>>[];
  check('parallel joins: one entry made', ok.filter(x => !x.value.existing).length === 1, par.map(x => (x.status === 'fulfilled' ? x.value : String(x.reason))));
  check('parallel joins: the rest refused or answered the same ticket', par.every(x => x.status === 'fulfilled' || String(x.reason).includes('ALREADY_IN_MATCH')));
  check('parallel joins: fee charged once', await waitFor(() => bal(p2.p) === 950n), bal(p2.p));
  const mid = ok.find(x => !x.value.existing)!.value.matchId;
  check('two tickets form a match at once', mid > 0n && (await waitFor(() => matchOf(p1.p, mid)?.state === 'waiting' && matchOf(p2.p, mid)?.players.length === 2)));
  check('match shows the other name, never an account id', (() => {
    const m = matchOf(p1.p, mid)!;
    return m.players.some(x => x.name === p2.name && !x.me) && m.players.some(x => x.me) && !('accountId' in m.players[0]);
  })());
  check('joining again while in the match refused', (await errorOf(join(p1, 'sample_duel', feeRoom.key))).includes('ALREADY_IN_MATCH'));
  check('cannot finish a match that has not started', (await errorOf(p1.p.conn.reducers.sampleDuelPlay({ matchId: mid }))).includes('MATCH_NOT_STARTED'));
  await p1.p.conn.reducers.gamesReady({ matchId: mid });
  check('one ready player does not start the match', (await waitFor(() => matchOf(p1.p, mid)?.players.some(x => x.me && x.ready) === true)) && matchOf(p1.p, mid)?.state === 'waiting');
  await p2.p.conn.reducers.gamesReady({ matchId: mid });
  check('all ready players start the match', await waitFor(() => matchOf(p1.p, mid)?.state === 'playing'));
  check('a player cannot report its own win', (await errorOf(report(mid, [{ accountId: p1.id, rank: 1, score: 9 }], p1.p))).includes('FORBIDDEN'));
  const p3 = await player();
  check('an outsider cannot play the match', (await errorOf(p3.p.conn.reducers.sampleDuelPlay({ matchId: mid }))).includes('NOT_IN_MATCH'));
  check('results for an outsider refused', (await errorOf(report(mid, [{ accountId: p3.id, rank: 1, score: 1 }]))).includes('NOT_IN_MATCH'));
  check('duplicate results refused', (await errorOf(report(mid, [{ accountId: p1.id, rank: 1, score: 1 }, { accountId: p1.id, rank: 2, score: 1 }]))).includes('DUPLICATE_RESULT'));
  check('rank zero refused', (await errorOf(report(mid, [{ accountId: p1.id, rank: 0, score: 1 }]))).includes('INVALID_RANK'));
  await p1.p.conn.reducers.sampleDuelPlay({ matchId: mid });
  check('game code finished the match', await waitFor(() => matchOf(p1.p, mid)?.state === 'finished'));
  const mm = matchOf(p1.p, mid)!;
  const winnerIsP1 = mm.myOutcome === 'win';
  const [win, lose] = winnerIsP1 ? [p1, p2] : [p2, p1];
  check('exactly one winner', await waitFor(() => matchOf(win.p, mid)?.myOutcome === 'win' && matchOf(lose.p, mid)?.myOutcome === 'loss'));
  check('winner score comes from the game settings', matchOf(win.p, mid)!.players.find(x => x.me)!.score === 5);
  check('winner prize granted by the worker', await waitFor(() => bal(win.p) === 1150n, 8000), bal(win.p));
  check('loser gets no prize', bal(lose.p) === 950n);
  check('a second result is refused', (await errorOf(report(mid, [{ accountId: lose.id, rank: 1, score: 99 }]))).includes('MATCH_FINISHED'));
  check('playing again after the end refused', (await errorOf(p1.p.conn.reducers.sampleDuelPlay({ matchId: mid }))).includes('MATCH_FINISHED'));
  await run();
  check('prize granted once', bal(win.p) === 1150n && bal(lose.p) === 950n);
  const det = await o.conn.procedures.adminMatch({ matchId: mid });
  check('admin match detail has tickets and one granted payout', det.tickets.length === 2 && det.payouts.length === 1 && det.payouts[0].status === 'granted' && det.payouts[0].accountId === win.id, det.payouts);
  check('tickets are done after the match', det.tickets.every(x => x.status === 'done'));
  const evWon = await o.conn.procedures.adminEventLog({ accountId: win.id, typeKey: 'game_won', source: '', page: 1, pageSize: 10 });
  const evLost = await o.conn.procedures.adminEventLog({ accountId: lose.id, typeKey: 'game_won', source: '', page: 1, pageSize: 10 });
  const evPlayed = await o.conn.procedures.adminEventLog({ accountId: lose.id, typeKey: 'game_played', source: '', page: 1, pageSize: 10 });
  check('game_won recorded for the winner only', evWon.total === 1 && evLost.total === 0 && JSON.parse(evWon.rows[0].metadata).matchId === String(mid));
  check('game_played recorded for every player', evPlayed.total === 1 && evPlayed.rows[0].source === 'server');
  const act = await win.p.conn.procedures.activityMine({ kind: 'game', before: 0n, limit: 50 });
  check('activity log has join, match, play and prize', ['joined', 'matched', 'played', 'prize'].every(a => act.rows.some(r => r.action === a)), act.rows.map(r => r.action));
  const ml = await o.conn.procedures.adminMatches({ gameId: duel.id, state: 'finished', accountId: 0n, page: 1, pageSize: 50 });
  check('admin match list filters by game and state', ml.rows.some(m => m.id === mid) && ml.rows.every(m => m.state === 'finished' && m.gameId === duel.id));
  const mlp = await o.conn.procedures.adminMatches({ gameId: 0n, state: '', accountId: win.id, page: 1, pageSize: 50 });
  check('admin match list filters by player', mlp.rows.length === 1 && mlp.rows[0].id === mid);

  const partyFee = await room('sample_party', k('pfee'), { entryFee: 30n, entryCurrency: gold });
  const q1 = await player();
  const burst = await Promise.allSettled(Array.from({ length: 6 }, () => join(q1, 'sample_party', partyFee.key)));
  const qok = burst.filter(x => x.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof join>>>[];
  check('six parallel joins all answer', qok.length === 6, burst);
  check('six parallel joins make one ticket', new Set(qok.map(x => String(x.value.ticketId))).size === 1 && qok.filter(x => !x.value.existing).length === 1);
  check('six parallel joins charge once', await waitFor(() => bal(q1.p) === 970n) && tickets(q1.p).length === 1);
  await q1.p.conn.reducers.gamesCancel({ ticketId: qok[0].value.ticketId });
  check('cancel refunds the fee', await waitFor(() => bal(q1.p) === 1000n));
  check('cancelled ticket leaves the list', await waitFor(() => tickets(q1.p).length === 0));
  check('a second cancel is refused', (await errorOf(q1.p.conn.reducers.gamesCancel({ ticketId: qok[0].value.ticketId }))).includes('TICKET_NOT_WAITING'));
  check('the refund happened once', bal(q1.p) === 1000n);

  const r2 = await player();
  const r3 = await player();
  const lm = (await pair(r2, r3, 'sample_duel', feeRoom.key)).matchId;
  await waitFor(() => bal(r2.p) === 950n && bal(r3.p) === 950n);
  await r2.p.conn.reducers.gamesLeave({ matchId: lm });
  check('leaving before the start cancels the match', await waitFor(() => matchOf(r3.p, lm)?.state === 'cancelled' && matchOf(r3.p, lm)?.reason === 'player_left'));
  check('leaving before the start refunds everyone', await waitFor(() => bal(r2.p) === 1000n && bal(r3.p) === 1000n));
  check('leaving a closed match refused', (await errorOf(r2.p.conn.reducers.gamesLeave({ matchId: lm }))).includes('MATCH_CLOSED'));
  check('ready on a cancelled match refused', (await errorOf(r3.p.conn.reducers.gamesReady({ matchId: lm }))).includes('MATCH_CLOSED'));
  const pm = await play(r2, r3, 'sample_duel', feeRoom.key);
  await r2.p.conn.reducers.gamesLeave({ matchId: pm });
  check('leaving a started match keeps the fee', (await waitFor(() => matchOf(r2.p, pm)?.players.some(x => x.me && x.left) === true)) && bal(r2.p) === 950n && matchOf(r2.p, pm)?.state === 'playing');
  await r3.p.conn.reducers.gamesLeave({ matchId: pm });
  check('when everyone leaves the match is abandoned', await waitFor(() => matchOf(r3.p, pm)?.state === 'cancelled' && matchOf(r3.p, pm)?.reason === 'abandoned'));
  check('abandoned match refunds nothing', bal(r2.p) === 950n && bal(r3.p) === 950n);
  const am = (await pair(r2, r3, 'sample_duel', feeRoom.key)).matchId;
  await o.conn.reducers.adminCancelMatch({ matchId: am, refund: true, reason: 'test' });
  check('admin cancel with refund gives the fees back', await waitFor(() => bal(r2.p) === 950n && bal(r3.p) === 950n && matchOf(r2.p, am)?.state === 'cancelled'));
  check('admin cancel twice refused', (await errorOf(o.conn.reducers.adminCancelMatch({ matchId: am, refund: true, reason: '' }))).includes('MATCH_CLOSED'));
  const am2 = await play(r2, r3, 'sample_duel', feeRoom.key);
  await o.conn.reducers.adminCancelMatch({ matchId: am2, refund: false, reason: 'cheat' });
  check('admin cancel without refund keeps the fees', (await waitFor(() => matchOf(r2.p, am2)?.state === 'cancelled')) && bal(r2.p) === 900n && bal(r3.p) === 900n);
  const am3 = await play(r2, r3, 'sample_duel', feeRoom.key);
  await o.conn.reducers.adminCancelMatch({ matchId: am3, refund: true, reason: 'server down' });
  check('admin cancel of a started match can refund', await waitFor(() => bal(r2.p) === 900n && bal(r3.p) === 900n && matchOf(r2.p, am3)?.state === 'cancelled'));

  const grpRoom = await room('sample_duel', k('grp'), { prizeGroupId: gWin });
  const d1 = await player();
  const d2 = await player();
  const dm = await play(d1, d2, 'sample_duel', grpRoom.key);
  await report(dm, [{ accountId: d1.id, rank: 1, score: 3 }, { accountId: d2.id, rank: 1, score: 3 }]);
  check('a draw gives every first place a win', await waitFor(() => matchOf(d1.p, dm)?.myOutcome === 'win' && matchOf(d2.p, dm)?.myOutcome === 'win'));
  check('prize group pays one prize to each winner', await waitFor(() => [1200n, 1020n].includes(bal(d1.p)) && [1200n, 1020n].includes(bal(d2.p)), 8000), [bal(d1.p), bal(d2.p)]);
  const dpay = (await o.conn.procedures.adminMatch({ matchId: dm })).payouts;
  check('group payouts store the drawn prize', dpay.length === 2 && dpay.every(x => x.status === 'granted' && [pWin, pSmall].includes(x.prizeId) && x.prizeGroupId === gWin));
  check('admin report is audited', (await o.conn.procedures.adminAudit({ action: 'game_match.finish', page: 1, pageSize: 5 })).rows.some(x => x.target === String(dm)));

  const onceRoom = await room('sample_duel', k('once'), { prizeId: pOnce });
  const om1 = await play(d1, d2, 'sample_duel', onceRoom.key);
  await report(om1, [{ accountId: d1.id, rank: 1, score: 1 }, { accountId: d2.id, rank: 2, score: 0 }]);
  const b1 = await waitFor(() => (bal(d1.p) - 5n === 1200n || bal(d1.p) - 5n === 1020n), 8000);
  check('one-time prize paid the first time', b1);
  const before = bal(d1.p);
  const om2 = await play(d1, d2, 'sample_duel', onceRoom.key);
  await report(om2, [{ accountId: d1.id, rank: 1, score: 1 }, { accountId: d2.id, rank: 2, score: 0 }]);
  await run();
  const fp = (await o.conn.procedures.adminMatch({ matchId: om2 })).payouts[0];
  check('a prize the player already has fails the payout', fp?.status === 'failed' && fp.error.includes('PRIZE_ALREADY_GRANTED') && fp.attempts === 1, fp);
  check('failed payout moves nothing', bal(d1.p) === before);
  const retried = await o.conn.procedures.adminRetryGamePayout({ payoutId: fp.id });
  check('admin retry runs it again', retried.status === 'failed' && retried.attempts === 2);
  const fails = await o.conn.procedures.adminGamePayouts({ kind: 'match', status: 'failed', accountId: 0n, page: 1, pageSize: 50 });
  check('payout list filters failed ones', fails.rows.some(x => x.id === fp.id) && fails.rows.every(x => x.status === 'failed'));

  const srv = await connect();
  const sm = (await pair(d1, d2, 'sample_duel', onceRoom.key)).matchId;
  check('an unknown connection cannot start a match', (await errorOf(srv.conn.reducers.gamesStartMatch({ matchId: sm }))).includes('FORBIDDEN'));
  check('an unknown connection cannot report', (await errorOf(srv.conn.reducers.gamesReportResult({ matchId: sm, results: [] }))).includes('FORBIDDEN'));
  check('player cannot register a game server', (await errorOf(d1.p.conn.reducers.adminSaveGameServer({ identity: srv.conn.identity!, note: 'x', isActive: true }))).includes('FORBIDDEN'));
  await o.conn.reducers.adminSaveGameServer({ identity: srv.conn.identity!, note: 'match server', isActive: true });
  check('game server listed for admins', await waitFor(() => rows(o.conn.db.adminGameServers.iter()).some(s => s.identity.isEqual(srv.conn.identity!) && s.isActive)));
  await srv.conn.reducers.gamesStartMatch({ matchId: sm });
  check('registered server starts the match', await waitFor(() => matchOf(d1.p, sm)?.state === 'playing'));
  check('starting twice refused', (await errorOf(srv.conn.reducers.gamesStartMatch({ matchId: sm }))).includes('MATCH_ALREADY_STARTED'));
  await srv.conn.reducers.gamesReportResult({ matchId: sm, results: [{ accountId: d2.id, rank: 1, score: 7 }, { accountId: d1.id, rank: 2, score: 2 }] });
  check('registered server reports the result', await waitFor(() => matchOf(d2.p, sm)?.myOutcome === 'win' && matchOf(d2.p, sm)?.state === 'finished'));
  await o.conn.reducers.adminSaveGameServer({ identity: srv.conn.identity!, note: 'match server', isActive: false });
  await waitFor(() => rows(o.conn.db.adminGameServers.iter()).some(s => s.identity.isEqual(srv.conn.identity!) && !s.isActive));
  const sm2 = (await pair(d1, d2, 'sample_duel', onceRoom.key)).matchId;
  check('a switched off server is refused', (await errorOf(srv.conn.reducers.gamesStartMatch({ matchId: sm2 }))).includes('FORBIDDEN'));
  await o.conn.reducers.adminDeleteGameServer({ identity: srv.conn.identity! });
  await o.conn.reducers.adminCancelMatch({ matchId: sm2, refund: true, reason: '' });
  srv.conn.disconnect();

  const e1 = await player();
  const reqItems = await room('sample_duel', k('ritems'), { requirements: { ...REQ, itemKeys: [skinA.key, skinB.key], message: tr('آیتم لازم است', 'Item needed') } });
  const re1 = refusalOf(await errorOf(join(e1, 'sample_duel', reqItems.key)));
  check('refusal says REQUIREMENTS_NOT_MET with details', !!re1 && re1.game === 'sample_duel' && re1.room === reqItems.key && re1.path === 'matchmaking');
  check('missing items in any mode list the whole set', re1!.missing[0].type === 'item' && re1!.missing[0].mode === 'any' && re1!.missing[0].keys!.length === 2);
  check('refusal message in the player language', re1!.message === 'آیتم لازم است');
  check('refusal offers products that give a missing item', re1!.products.some(p => p.key === k('prod_a') && p.satisfies.includes(`item:${skinA.key}`)));
  check('nothing charged or queued on refusal', bal(e1.p) === 1000n && tickets(e1.p).length === 0);
  check('item in a requirement cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteItem({ id: skinB.id }))).includes('IN_USE'));
  const chk = await e1.p.conn.procedures.gamesCheck({ gameKey: 'sample_duel', roomKey: reqItems.key, path: 'matchmaking', platform: '', appVersion: '' });
  check('games_check answers the refusal without joining', !chk.eligible && chk.error === 'REQUIREMENTS_NOT_MET' && chk.missing.length === 1 && chk.message === 'آیتم لازم است');
  check('games list marks the room not eligible', await waitFor(() => listedRoom(e1.p, 'sample_duel', reqItems.key)?.eligible === false && listedRoom(e1.p, 'sample_duel', reqItems.key)!.paths.find(x => x.path === 'matchmaking')!.missing[0]?.type === 'item'));
  await o.conn.reducers.adminGiveItem({ accountId: e1.id, itemId: skinB.id, quantity: 1, note: '' });
  await waitFor(() => inv(e1.p, skinB.key) === 1);
  check('games list follows the inventory', await waitFor(() => listedRoom(e1.p, 'sample_duel', reqItems.key)?.eligible === true));
  const ej = await join(e1, 'sample_duel', reqItems.key);
  check('one owned item is enough in any mode', ej.status === 'waiting');
  check('queued in one room, another room of the game refused', (await errorOf(join(e1, 'sample_duel', feeRoom.key))).includes('ALREADY_QUEUED'));
  await e1.p.conn.reducers.gamesCancel({ ticketId: ej.ticketId });
  await waitFor(() => tickets(e1.p).length === 0);
  const reqAll = await room('sample_duel', k('rall'), { requirements: { ...REQ, itemKeys: [skinA.key, skinB.key], itemsMode: 'all', productIds: [prodGems] } });
  const re2 = refusalOf(await errorOf(join(e1, 'sample_duel', reqAll.key)));
  check('all mode lists only the lacking items', re2!.missing[0].mode === 'all' && re2!.missing[0].keys!.length === 1 && re2!.missing[0].keys![0] === skinA.key);
  check('chosen products replace the automatic ones', re2!.products.length === 1 && re2!.products[0].key === k('prod_gems'));

  await o.conn.reducers.adminSetPlayerTags({ accountId: e1.id, tagIds: [member] });
  const reqTags = await room('sample_duel', k('rtags'), { requirements: { ...REQ, tagIds: [vip, member], tagsMode: 'all', excludeTagIds: [banned, secret] } });
  const re3 = refusalOf(await errorOf(join(e1, 'sample_duel', reqTags.key)));
  check('all-tags mode lists only the missing tag', re3!.missing.length === 1 && re3!.missing[0].type === 'tag' && re3!.missing[0].keys!.length === 1 && re3!.missing[0].keys![0] === k('vip'));
  await o.conn.reducers.adminSetPlayerTags({ accountId: e1.id, tagIds: [member, vip, banned, secret] });
  const re4 = refusalOf(await errorOf(join(e1, 'sample_duel', reqTags.key)));
  check('excluded tags refuse the player', re4!.missing.length === 1 && re4!.missing[0].type === 'excluded_tag');
  check('only public excluded tags are named', re4!.missing[0].keys!.length === 1 && re4!.missing[0].keys![0] === k('banned'));
  await o.conn.reducers.adminSetPlayerTags({ accountId: e1.id, tagIds: [member, vip] });
  const xreqTags = await join(e1, 'sample_duel', reqTags.key);
  check('tags satisfied, join passes', xreqTags.status === 'waiting');
  await e1.p.conn.reducers.gamesCancel({ ticketId: xreqTags.ticketId });
  await waitFor(() => tickets(e1.p).length === 0);

  const reqLvl = await room('sample_duel', k('rlvl'), { requirements: { ...REQ, minLevel: 2 } });
  const re5 = refusalOf(await errorOf(join(e1, 'sample_duel', reqLvl.key)));
  check('lowest level in the set reports level and need', re5!.missing[0].type === 'level' && re5!.missing[0].minLevel === 2 && (re5!.missing[0].level ?? 0) === 0);
  await o.conn.reducers.adminAdjust({ accountId: e1.id, kind: 'meta', key: xp, action: 'set', value: 150, note: '' });
  await waitFor(() => metaOf(e1.p, xp) === 150);
  const xreqLvl = await join(e1, 'sample_duel', reqLvl.key);
  check('enough level passes the set', xreqLvl.status === 'waiting');
  await e1.p.conn.reducers.gamesCancel({ ticketId: xreqLvl.ticketId });
  await waitFor(() => tickets(e1.p).length === 0);
  const lvlRoom = await room('sample_duel', k('lvl3'), { minLevel: 3 });
  check('room lowest level refuses with LEVEL_TOO_LOW', (await errorOf(join(e1, 'sample_duel', lvlRoom.key))).includes('LEVEL_TOO_LOW'));
  check('games list marks the room level locked', await waitFor(() => listedRoom(e1.p, 'sample_duel', lvlRoom.key)?.levelLocked === true && listedRoom(e1.p, 'sample_duel', lvlRoom.key)?.eligible === false));

  const reqMeta = await room('sample_duel', k('rmeta'), { requirements: { ...REQ, metas: [{ metaKey: gems, operator: 'gte', value: 5, consume: 0 }] } });
  const re6 = refusalOf(await errorOf(join(e1, 'sample_duel', reqMeta.key)));
  check('meta condition reports have and need', re6!.missing[0].type === 'meta' && re6!.missing[0].key === gems && (re6!.missing[0].have ?? 0) === 0);
  check('automatic products cover a missing meta', re6!.products.some(p => p.key === k('prod_gems')));
  check('meta in a requirement cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteMeta({ id: rows(o.conn.db.meta.iter()).find(x => x.key === gems)!.id }))).includes('IN_USE'));
  await o.conn.reducers.adminAdjust({ accountId: e1.id, kind: 'meta', key: gems, action: 'set', value: 5, note: '' });
  await waitFor(() => metaOf(e1.p, gems) === 5);
  const xreqMeta = await join(e1, 'sample_duel', reqMeta.key);
  check('meta condition met', xreqMeta.status === 'waiting');
  check('a plain condition takes nothing', metaOf(e1.p, gems) === 5);
  await e1.p.conn.reducers.gamesCancel({ ticketId: xreqMeta.ticketId });
  await waitFor(() => tickets(e1.p).length === 0);

  const tMeta = await room('sample_duel', k('tmeta'), { requirements: { ...REQ, metas: [{ metaKey: gems, operator: 'gte', value: 0, consume: 2 }] } });
  const tj = await join(e1, 'sample_duel', tMeta.key);
  check('a counted meta ticket is taken on entry', tj.consumedMetas.includes(gems) && (await waitFor(() => metaOf(e1.p, gems) === 3)));
  await e1.p.conn.reducers.gamesCancel({ ticketId: tj.ticketId });
  check('a cancelled entry returns the meta ticket', await waitFor(() => metaOf(e1.p, gems) === 5));
  const tKeep = await room('sample_duel', k('tkeep'), { requirements: { ...REQ, metas: [{ metaKey: gems, operator: 'gte', value: 0, consume: 2 }], refund: 'keep' } });
  const tk2 = await join(e1, 'sample_duel', tKeep.key);
  await waitFor(() => metaOf(e1.p, gems) === 3);
  await e1.p.conn.reducers.gamesCancel({ ticketId: tk2.ticketId });
  await waitFor(() => tickets(e1.p).length === 0);
  check('keep policy does not return the ticket', metaOf(e1.p, gems) === 3);
  await o.conn.reducers.adminAdjust({ accountId: e1.id, kind: 'meta', key: gems, action: 'set', value: 1, note: '' });
  await waitFor(() => metaOf(e1.p, gems) === 1);
  const re7 = refusalOf(await errorOf(join(e1, 'sample_duel', tMeta.key)));
  check('a ticket needs at least its amount', re7!.missing[0].type === 'meta' && re7!.missing[0].consume === 2);
  const tItem = await room('sample_duel', k('titem'), { requirements: { ...REQ, itemKeys: [pass.key], consumeItems: true } });
  await o.conn.reducers.adminGiveItem({ accountId: e1.id, itemId: pass.id, quantity: 3, note: '' });
  await waitFor(() => inv(e1.p, pass.key) === 3);
  const ti = await join(e1, 'sample_duel', tItem.key);
  check('an item ticket is used up on entry', ti.consumedItems.includes(pass.key) && (await waitFor(() => inv(e1.p, pass.key) === 2)));
  check('listed room says it consumes a ticket', await waitFor(() => listedRoom(e1.p, 'sample_duel', tItem.key)?.consumes === true));
  const e2 = await player();
  await o.conn.reducers.adminGiveItem({ accountId: e2.id, itemId: pass.id, quantity: 1, note: '' });
  await waitFor(() => inv(e2.p, pass.key) === 1);
  const tim = await join(e2, 'sample_duel', tItem.key);
  check('ticket rooms still match players', tim.matchId > 0n && (await waitFor(() => inv(e2.p, pass.key) === 0)));
  await e2.p.conn.reducers.gamesLeave({ matchId: tim.matchId });
  check('a match cancelled before the start returns item tickets', await waitFor(() => inv(e2.p, pass.key) === 1 && inv(e1.p, pass.key) === 3));
  check('item used as a ticket cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteItem({ id: pass.id }))).includes('IN_USE'));

  await saveGame('sample_duel', { botsAllowed: true, botAfterSeconds: 3600 });
  const reqPath = await room('sample_duel', k('rpath'), { requirements: { ...REQ, minLevel: 99, paths: ['matchmaking'] } });
  check('matchmaking path checks its set', !!refusalOf(await errorOf(join(e1, 'sample_duel', reqPath.key))));
  check('list shows eligibility per path', await waitFor(() => {
    const r = listedRoom(e1.p, 'sample_duel', reqPath.key);
    return !!r && !r.paths.find(x => x.path === 'matchmaking')!.eligible && r.paths.find(x => x.path === 'bot')!.eligible && r.paths.find(x => x.path === 'friend')!.eligible;
  }));
  const bj = await join(e1, 'sample_duel', reqPath.key, { path: 'bot' });
  check('bot path skips a matchmaking-only set and starts a bot match', bj.matchId > 0n && (await waitFor(() => matchOf(e1.p, bj.matchId)?.bots === 1 && matchOf(e1.p, bj.matchId)?.path === 'bot')));
  await e1.p.conn.reducers.gamesLeave({ matchId: bj.matchId });
  await saveGame('sample_duel', { botsAllowed: false });
  check('bot path refused when bots are off', (await errorOf(join(e1, 'sample_duel', reqPath.key, { path: 'bot' }))).includes('BOTS_DISABLED'));
  check('unknown path refused on join', (await errorOf(join(e1, 'sample_duel', 'main', { path: 'portal' }))).includes('INVALID_PATH'));

  const e3 = await player();
  await saveGame('sample_party', { requirements: { ...REQ, tagIds: [vip] } });
  const inh = await room('sample_party', k('inh'));
  const noinh = await room('sample_party', k('noinh'), { inheritGame: false });
  check('rooms inherit the game set', !!refusalOf(await errorOf(join(e3, 'sample_party', inh.key))));
  const nj = await join(e3, 'sample_party', noinh.key);
  check('a room can switch the game set off', nj.status === 'waiting');
  await e3.p.conn.reducers.gamesCancel({ ticketId: nj.ticketId });
  check('game list shows the game set as not met', await waitFor(() => listed(e3.p, 'sample_party')?.paths.find(x => x.path === 'matchmaking')?.missing[0]?.type === 'tag'));
  await saveGame('sample_party', { requirements: REQ });
  const hide = await room('sample_duel', k('hide'), { requirements: { ...REQ, tagIds: [vip], lock: 'hide' } });
  check('hide rooms are left out for players who do not qualify', await waitFor(() => !!listed(e3.p, 'sample_duel') && !listedRoom(e3.p, 'sample_duel', hide.key)));
  check('show rooms stay listed as locked', !!listedRoom(e3.p, 'sample_duel', reqItems.key));
  await o.conn.reducers.adminSetPlayerTags({ accountId: e3.id, tagIds: [vip] });
  check('hide room appears once the player qualifies', await waitFor(() => !!listedRoom(e3.p, 'sample_duel', hide.key)));
  const locked = await room('sample_duel', k('locked'), { isLocked: true });
  check('locked room refused', (await errorOf(join(e3, 'sample_duel', locked.key))).includes('ROOM_LOCKED'));
  check('locked room listed as locked', await waitFor(() => listedRoom(e3.p, 'sample_duel', locked.key)?.isLocked === true));
  const hidden = await room('sample_duel', k('hidden'), { isHidden: true });
  check('hidden room not listed', !listedRoom(e3.p, 'sample_duel', hidden.key));
  const hj = await join(e3, 'sample_duel', hidden.key);
  check('hidden room joinable by key', hj.status === 'waiting');
  await e3.p.conn.reducers.gamesCancel({ ticketId: hj.ticketId });
  await room('sample_duel', k('off'), { isActive: false });
  check('inactive room refused', (await errorOf(join(e3, 'sample_duel', k('off')))).includes('ROOM_NOT_FOUND'));
  check('unknown game refused', (await errorOf(join(e3, 'no_such_game', ''))).includes('GAME_NOT_FOUND'));

  await saveGame('sample_party', { maintenance: true, maintenanceMessage: tr('تعمیر', 'Repair') });
  check('maintenance refuses joins', (await errorOf(join(e3, 'sample_party', noinh.key))).includes('GAME_MAINTENANCE'));
  check('maintenance shown in the list', await waitFor(() => listed(e3.p, 'sample_party')?.maintenance === true && listed(e3.p, 'sample_party')?.eligible === false));
  await saveGame('sample_party', { maintenance: false, platforms: ['android', 'ios'], minVersions: [{ platform: 'android', version: '2.0.0' }] });
  check('a platform outside the list refused', (await errorOf(join(e3, 'sample_party', noinh.key, { platform: 'web' }))).includes('PLATFORM_NOT_SUPPORTED'));
  check('an old app version refused', (await errorOf(join(e3, 'sample_party', noinh.key, { platform: 'android', appVersion: '1.9.9' }))).includes('APP_VERSION_TOO_OLD:2.0.0'));
  check('a missing app version refused', (await errorOf(join(e3, 'sample_party', noinh.key, { platform: 'android' }))).includes('APP_VERSION_TOO_OLD'));
  const vj = await join(e3, 'sample_party', noinh.key, { platform: 'android', appVersion: '2.1.0' });
  check('a new enough version joins', vj.status === 'waiting');
  await settings({ maxTicketsPerPlayer: 1 });
  check('ticket cap across games', (await errorOf(join(e3, 'sample_duel', 'main'))).includes('TOO_MANY_TICKETS'));
  await settings({});
  await e3.p.conn.reducers.gamesCancel({ ticketId: vj.ticketId });
  await saveGame('sample_party', { platforms: [], minVersions: [] });

  await saveGame('sample_duel', { bandSize: 1, widenEverySeconds: 10, widenStep: 1, maxBand: 0, skillMetaKey: skill });
  check('skill meta used by a game cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteMeta({ id: rows(o.conn.db.meta.iter()).find(x => x.key === skill)!.id }))).includes('IN_USE'));
  const band = await room('sample_duel', k('band'));
  const sk = async (pp: P, v: number) => {
    await o.conn.reducers.adminAdjust({ accountId: pp.id, kind: 'meta', key: skill, action: 'set', value: v, note: '' });
    await waitFor(() => metaOf(pp.p, skill) === v);
  };
  const y1 = await player();
  const y2 = await player();
  await sk(y1, 5);
  await sk(y2, 9);
  const yj1 = await join(y1, 'sample_duel', band.key);
  const yj2 = await join(y2, 'sample_duel', band.key);
  check('skills too far apart do not match at first', yj1.status === 'waiting' && yj2.status === 'waiting');
  await advance(20);
  await run();
  check('band not wide enough yet after 20 s', tickets(y1.p).every(x => x.status === 'waiting') && (await waitFor(() => tickets(y2.p)[0]?.status === 'waiting')));
  await advance(10);
  await run();
  check('band widens over time until they match', await waitFor(() => tickets(y1.p)[0]?.status === 'matched' && tickets(y1.p)[0]?.matchId === tickets(y2.p)[0]?.matchId));
  const ym = tickets(y1.p)[0].matchId;
  await y1.p.conn.reducers.gamesLeave({ matchId: ym });
  const z1 = await player();
  const z2 = await player();
  const z3 = await player();
  await sk(z1, 0);
  await sk(z2, 10);
  await sk(z3, 5);
  await join(z1, 'sample_duel', band.key);
  await join(z2, 'sample_duel', band.key);
  await advance(50);
  await run();
  check('two far tickets stay apart', await waitFor(() => tickets(z1.p)[0]?.status === 'waiting' && tickets(z2.p)[0]?.status === 'waiting'));
  const zj3 = await join(z3, 'sample_duel', band.key);
  check('the oldest ticket is matched first', zj3.matchId > 0n && (await waitFor(() => tickets(z1.p)[0]?.matchId === zj3.matchId)));
  check('the younger ticket keeps waiting', tickets(z2.p)[0]?.status === 'waiting');
  await z2.p.conn.reducers.gamesCancel({ ticketId: tickets(z2.p)[0].id });
  await z1.p.conn.reducers.gamesLeave({ matchId: zj3.matchId });
  await saveGame('sample_duel', { maxBand: 2 });
  const w1 = await player();
  const w2 = await player();
  await sk(w1, 0);
  await sk(w2, 10);
  await join(w1, 'sample_duel', band.key);
  await join(w2, 'sample_duel', band.key);
  await advance(1000);
  await run();
  check('the band never passes its cap', await waitFor(() => tickets(w1.p)[0]?.status === 'waiting' && tickets(w2.p)[0]?.status === 'waiting'));
  await w1.p.conn.reducers.gamesCancel({ ticketId: tickets(w1.p)[0].id });
  await w2.p.conn.reducers.gamesCancel({ ticketId: tickets(w2.p)[0].id });
  await saveGame('sample_duel', { bandSize: 1000, maxBand: 0, skillMetaKey: '' });

  const fill = await room('sample_party', k('fill'));
  const f1 = await player();
  const f2 = await player();
  await join(f1, 'sample_party', fill.key);
  await join(f2, 'sample_party', fill.key);
  await run();
  check('a 4-seat room waits for more players', await waitFor(() => tickets(f1.p)[0]?.status === 'waiting' && tickets(f2.p)[0]?.status === 'waiting'));
  await advance(31);
  await run();
  check('after the fill wait it starts with the players it has', await waitFor(() => tickets(f1.p)[0]?.status === 'matched' && matchOf(f1.p, tickets(f1.p)[0].matchId)?.players.length === 2 && matchOf(f1.p, tickets(f1.p)[0].matchId)?.bots === 0));
  await f1.p.conn.reducers.gamesLeave({ matchId: tickets(f1.p)[0].matchId });

  await saveGame('sample_party', { botsAllowed: true, botAfterSeconds: 20 });
  const botf = await room('sample_party', k('botf'));
  const b1p = await player();
  const bt = await join(b1p, 'sample_party', botf.key);
  await run();
  check('a lone player waits before bots', await waitFor(() => tickets(b1p.p)[0]?.status === 'waiting'));
  await advance(21);
  await run();
  check('bots fill the match after the wait', await waitFor(() => tickets(b1p.p)[0]?.status === 'matched' && matchOf(b1p.p, tickets(b1p.p)[0].matchId)?.bots === 1));
  const botMatch = tickets(b1p.p)[0].matchId;
  void bt;
  await b1p.p.conn.reducers.gamesReady({ matchId: botMatch });
  check('a bot match starts when the human is ready', await waitFor(() => matchOf(b1p.p, botMatch)?.state === 'playing'));
  await report(botMatch, [{ accountId: b1p.id, rank: 2, score: 1 }]);
  check('a bot can beat the human', await waitFor(() => matchOf(b1p.p, botMatch)?.myOutcome === 'loss'));
  await saveGame('sample_party', { botsAllowed: false });

  const fr = await room('sample_duel', k('friend'));
  const h1 = await player();
  const g1 = await player();
  const hj1 = await join(h1, 'sample_duel', fr.key, { path: 'friend' });
  check('a friend room gets a six-digit code', /^\d{6}$/.test(hj1.code) && hj1.status === 'waiting');
  check('the host joining again gets the same room', (await join(h1, 'sample_duel', fr.key, { path: 'friend' })).code === hj1.code);
  check('a wrong code refused', (await errorOf(join(g1, 'sample_duel', fr.key, { path: 'friend', code: '000000' }))).includes('INVALID_CODE'));
  const gj1 = await join(g1, 'sample_duel', '', { path: 'friend', code: hj1.code });
  check('a friend with the code joins the host', gj1.matchId > 0n && (await waitFor(() => tickets(h1.p)[0]?.matchId === gj1.matchId && matchOf(h1.p, gj1.matchId)?.path === 'friend')));
  await h1.p.conn.reducers.gamesLeave({ matchId: gj1.matchId });
  const pfr = await room('sample_party', k('pfriend'));
  const h2 = await player();
  const g2 = await player();
  const hj2 = await join(h2, 'sample_party', pfr.key, { path: 'friend' });
  await join(g2, 'sample_party', pfr.key, { path: 'friend', code: hj2.code });
  check('a 4-seat friend room waits for more', await waitFor(() => tickets(g2.p)[0]?.status === 'waiting'));
  check('only the host starts early', (await errorOf(g2.p.conn.reducers.gamesFriendStart({ code: hj2.code }))).includes('NOT_HOST'));
  await h2.p.conn.reducers.gamesFriendStart({ code: hj2.code });
  check('the host starts with the friends there', await waitFor(() => tickets(g2.p)[0]?.status === 'matched' && matchOf(g2.p, tickets(g2.p)[0].matchId)?.players.length === 2));
  await h2.p.conn.reducers.gamesLeave({ matchId: tickets(h2.p)[0].matchId });
  await saveGame('sample_duel', { friendAllowed: false });
  check('friend rooms can be switched off', (await errorOf(join(g1, 'sample_duel', fr.key, { path: 'friend' }))).includes('FRIEND_ROOMS_DISABLED'));
  await saveGame('sample_duel', { friendAllowed: true });

  await settings({ startTimeoutSeconds: 60, ticketTtlSeconds: 120 });
  const tm1 = await player();
  const tm2 = await player();
  const tmm = (await pair(tm1, tm2, 'sample_duel', feeRoom.key)).matchId;
  await waitFor(() => bal(tm1.p) === 950n);
  await advance(61);
  await run();
  check('a match not started in time is cancelled', await waitFor(() => matchOf(tm1.p, tmm)?.state === 'cancelled' && matchOf(tm1.p, tmm)?.reason === 'start_timeout'));
  check('a timed out match refunds the fees', await waitFor(() => bal(tm1.p) === 1000n && bal(tm2.p) === 1000n));
  const ex = await join(tm1, 'sample_duel', feeRoom.key);
  await waitFor(() => bal(tm1.p) === 950n);
  await advance(121);
  await run();
  check('a ticket waiting too long expires', await waitFor(() => !tickets(tm1.p).some(x => x.id === ex.ticketId)));
  check('an expired ticket is refunded', await waitFor(() => bal(tm1.p) === 1000n));
  await settings({});
  check('settings validation', (await errorOf(o.conn.reducers.adminSaveGamesSettings({ ...TEST_SETTINGS, monthCalendar: 'lunar' }))).includes('INVALID_RULE:monthCalendar'));
  check('week start validation', (await errorOf(o.conn.reducers.adminSaveGamesSettings({ ...TEST_SETTINGS, weekStart: 7 }))).includes('INVALID_RULE:weekStart'));
  check('clock offset is capped', (await errorOf(o.conn.reducers.adminSetGamesClockOffset({ seconds: 4000n * 86400n }))).includes('INVALID_CLOCK_OFFSET'));

  check('board period validation', (await errorOf(board(k('bad'), { period: 'hourly' }))).includes('INVALID_PERIOD'));
  check('board score mode validation', (await errorOf(board(k('bad'), { scoreMode: 'avg' }))).includes('INVALID_SCORE_MODE'));
  check('board order validation', (await errorOf(board(k('bad'), { order: 'up' }))).includes('INVALID_ORDER'));
  check('match score source needs a game', (await errorOf(board(k('bad'), { source: 'score' }))).includes('SOURCE_NEEDS_GAME'));
  check('reward rank range validation', (await errorOf(board(k('bad'), { rewards: [{ fromRank: 3, toRank: 2, prizeId: pWin, prizeGroupId: 0n }] }))).includes('INVALID_RANK_RANGE'));
  check('reward needs a prize or a group', (await errorOf(board(k('bad'), { rewards: [{ fromRank: 1, toRank: 1, prizeId: pWin, prizeGroupId: gWin }] }))).includes('PRIZE_OR_GROUP'));
  check('player cannot save boards', (await errorOf(pl.p.conn.reducers.adminSaveLeaderboard({ id: 0n, key: k('x'), gameId: 0n, name: tr('x'), description: [], iconUrl: '', period: 'all', scoreMode: 'best', order: 'desc', source: 'server', topN: 10, rewards: [], isActive: true, sort: 0 }))).includes('FORBIDDEN'));

  const lbd = await board(k('lbd'), { gameId: duel.id, source: 'score', period: 'daily', scoreMode: 'best', topN: 2, rewards: [{ fromRank: 1, toRank: 1, prizeId: pWin, prizeGroupId: 0n }, { fromRank: 2, toRank: 3, prizeId: pSmall, prizeGroupId: 0n }] });
  const lba = await board(k('lba'), { gameId: duel.id, source: 'score', period: 'all', scoreMode: 'best', order: 'asc' });
  const lbw = await board(k('lbw'), { gameId: duel.id, source: 'wins', period: 'all', scoreMode: 'sum' });
  const lbs = await board(k('lbs'), { source: 'server', period: 'weekly', scoreMode: 'sum', rewards: [{ fromRank: 1, toRank: 0, prizeGroupId: gWin, prizeId: 0n }] });
  const lbm = await board(k('lbm'), { source: 'server', period: 'monthly', scoreMode: 'last' });
  check('daily period key in Tehran time', lbd.currentPeriod === `d${tehranDate(T)}`, [lbd.currentPeriod, tehranDate(T)]);
  check('weekly period starts on Saturday', lbs.currentPeriod === `w${weekStartOf(T)}`, [lbs.currentPeriod, weekStartOf(T)]);
  check('monthly period uses the Jalali month', lbm.currentPeriod === jalaliMonth(T), [lbm.currentPeriod, jalaliMonth(T)]);
  check('all-time period key', lba.currentPeriod === 'all');
  check('board reward prize cannot be deleted', (await errorOf(o.conn.reducers.adminDeletePrize({ id: pSmall }))).includes('IN_USE'));

  const lbRoom = await room('sample_duel', k('lbroom'));
  const l1 = await player();
  const l2 = await player();
  const l3 = await player();
  const l4 = await player();
  const m1 = await play(l1, l2, 'sample_duel', lbRoom.key);
  await report(m1, [{ accountId: l1.id, rank: 1, score: 50 }, { accountId: l2.id, rank: 2, score: 30 }]);
  const m2 = await play(l3, l4, 'sample_duel', lbRoom.key);
  await report(m2, [{ accountId: l3.id, rank: 1, score: 40 }, { accountId: l4.id, rank: 2, score: 10 }]);
  const m3 = await play(l1, l2, 'sample_duel', lbRoom.key);
  await report(m3, [{ accountId: l1.id, rank: 1, score: 20 }, { accountId: l2.id, rank: 2, score: 25 }]);
  const lbOf = (cl: Client, key: string) => rows(cl.conn.db.leaderboards.iter()).find(b => b.key === key);
  check('match scores reach the game board', await waitFor(() => lbOf(l4.p, k('lbd'))?.players === 4));
  check('best mode keeps the best score', await waitFor(() => lbOf(l1.p, k('lbd'))!.myScore === 50 && lbOf(l1.p, k('lbd'))!.myRank === 1));
  check('ranks are precomputed for every player', await waitFor(() => lbOf(l3.p, k('lbd'))!.myRank === 2 && lbOf(l2.p, k('lbd'))!.myRank === 3 && lbOf(l4.p, k('lbd'))!.myRank === 4));
  check('ascending best keeps the lowest score', await waitFor(() => lbOf(l1.p, k('lba'))!.myScore === 20 && lbOf(l4.p, k('lba'))!.myRank === 1));
  check('wins board counts wins', await waitFor(() => lbOf(l1.p, k('lbw'))!.myScore === 2 && lbOf(l3.p, k('lbw'))!.myScore === 1 && lbOf(l2.p, k('lbw'))!.myRank === 0));
  const top4 = rows(l4.p.conn.db.leaderboardTop.iter()).filter(x => x.boardKey === k('lbd')).sort((a, b) => a.rank - b.rank);
  check('top view shows the top N and my own row', top4.length === 3 && top4[0].rank === 1 && top4[1].rank === 2 && top4[2].rank === 4 && top4[2].me && !top4[0].me, top4);
  check('top view names players and hides account ids', top4[0].name === l1.name && !('accountId' in top4[0]));
  const top1 = rows(l1.p.conn.db.leaderboardTop.iter()).filter(x => x.boardKey === k('lbd'));
  check('a top player sees just the top N', top1.length === 2 && top1.some(x => x.me && x.rank === 1));
  check('anonymous view still lists boards', await (async () => {
    const anon = await connect(undefined, GAMES_QUERIES);
    const okv = await waitFor(() => rows(anon.conn.db.leaderboards.iter()).some(b => b.key === k('lbd') && b.myRank === 0 && b.players === 4));
    anon.conn.disconnect();
    return okv;
  })());

  await o.conn.reducers.adminSetLeaderboardScore({ boardId: lbs.id, accountId: l2.id, score: 5, mode: 'set' });
  await o.conn.reducers.adminSetLeaderboardScore({ boardId: lbs.id, accountId: l2.id, score: 3, mode: 'add' });
  await o.conn.reducers.adminSetLeaderboardScore({ boardId: lbs.id, accountId: l4.id, score: 4, mode: 'set' });
  check('admin set and add on a server board', await waitFor(() => lbOf(l2.p, k('lbs'))?.myScore === 8 && lbOf(l2.p, k('lbs'))?.myRank === 1));
  await o.conn.reducers.adminSetLeaderboardScore({ boardId: lbs.id, accountId: l4.id, score: 0, mode: 'remove' });
  check('admin remove drops the row', await waitFor(() => lbOf(l4.p, k('lbs'))?.myRank === 0 && lbOf(l2.p, k('lbs'))?.players === 1));
  check('bad score mode refused', (await errorOf(o.conn.reducers.adminSetLeaderboardScore({ boardId: lbs.id, accountId: l2.id, score: 1, mode: 'mul' }))).includes('INVALID_MODE'));
  check('score change audited', (await o.conn.procedures.adminAudit({ action: 'leaderboard.score', page: 1, pageSize: 5 })).rows.some(x => x.target === String(lbs.id)));
  const st = await o.conn.procedures.adminLeaderboardStandings({ boardId: lbd.id, page: 1, pageSize: 10 });
  check('admin standings list ranks with account ids', st.total === 4 && st.rows[0].accountId === l1.id && st.rows[0].rank === 1 && st.period === lbd.currentPeriod);
  check('player cannot read standings', (await errorOf(l1.p.conn.procedures.adminLeaderboardStandings({ boardId: lbd.id, page: 1, pageSize: 10 }))).includes('FORBIDDEN'));
  await o.conn.reducers.adminSetLeaderboardScore({ boardId: lbm.id, accountId: l3.id, score: 9, mode: 'set' });
  await o.conn.reducers.adminSetLeaderboardScore({ boardId: lbm.id, accountId: l3.id, score: 4, mode: 'set' });
  check('set mode on a last board keeps the last value', await waitFor(() => lbOf(l3.p, k('lbm'))?.myScore === 4));

  const b2now = bal(l2.p);
  await o.conn.reducers.adminResetLeaderboard({ id: lbs.id, pay: true });
  await run();
  check('paid manual reset pays every rank in an open range', await waitFor(() => [b2now + 200n, b2now + 20n].includes(bal(l2.p)), 8000));
  const lbsPer = await o.conn.procedures.adminLeaderboardPeriods({ boardId: lbs.id, page: 1, pageSize: 10 });
  const lbsRes = await o.conn.procedures.adminLeaderboardResults({ periodId: lbsPer.rows[0].id });
  check('group reward resolved to one prize', lbsRes.length === 1 && lbsRes[0].result.prizeGroupId === gWin && lbsRes[0].payoutStatus === 'granted');
  check('reset audited', (await o.conn.procedures.adminAudit({ action: 'leaderboard.reset', page: 1, pageSize: 5 })).rows.some(x => x.target === String(lbs.id)));

  const before4 = [bal(l1.p), bal(l2.p), bal(l3.p), bal(l4.p)];
  await advance(DAY);
  await run();
  const per = await o.conn.procedures.adminLeaderboardPeriods({ boardId: lbd.id, page: 1, pageSize: 10 });
  check('day end archives the daily board', per.total === 1 && per.rows[0].reason === 'reset' && per.rows[0].players === 4 && per.rows[0].rewarded === 3, per.rows);
  check('a new daily period starts empty', (await waitFor(() => lbOf(l1.p, k('lbd'))?.players === 0)) && boardRow(k('lbd')).currentPeriod === `d${tehranDate(T)}`);
  check('all-time boards are not reset by the day', lbOf(l1.p, k('lbw'))?.players === 2 && lbOf(l1.p, k('lba'))?.players === 4);
  check('rank rewards paid by range', await waitFor(() => bal(l1.p) === before4[0] + 200n && bal(l3.p) === before4[2] + 20n && bal(l2.p) === before4[1] + 20n, 8000), [before4, bal(l1.p), bal(l2.p), bal(l3.p)]);
  check('ranks outside every range get nothing', bal(l4.p) === before4[3]);
  const results = await o.conn.procedures.adminLeaderboardResults({ periodId: per.rows[0].id });
  check('archived results keep rank, score and payout state', results.length === 4 && results[0].result.rank === 1 && results[0].result.score === 50 && results[0].payoutStatus === 'granted' && results[3].payoutStatus === '');
  await run();
  await advance(60);
  await run();
  check('rewards are paid once', bal(l1.p) === before4[0] + 200n && bal(l2.p) === before4[1] + 20n);
  const hist = await l1.p.conn.procedures.leaderboardHistory({ boardKey: k('lbd'), limit: 10 });
  check('player history shows the closed period', hist.length === 1 && hist[0].rank === 1 && hist[0].score === 50 && hist[0].payoutStatus === 'granted' && hist[0].players === 4);
  const wn = await l4.p.conn.procedures.leaderboardWinners({ boardKey: k('lbd'), periodId: 0n, limit: 3 });
  check('winners list the last period without account ids', wn.winners.length === 3 && wn.winners[0].name === l1.name && !wn.winners.some(x => x.me) && !('accountId' in wn.winners[0]));
  check('winners of an unknown board refused', (await errorOf(l4.p.conn.procedures.leaderboardWinners({ boardKey: 'nope', periodId: 0n, limit: 3 }))).includes('LEADERBOARD_NOT_FOUND'));

  const m4 = await play(l1, l2, 'sample_duel', lbRoom.key);
  await report(m4, [{ accountId: l1.id, rank: 1, score: 7 }, { accountId: l2.id, rank: 2, score: 3 }]);
  check('new period counts new matches', await waitFor(() => lbOf(l1.p, k('lbd'))?.myScore === 7 && lbOf(l1.p, k('lbd'))?.players === 2));
  const b1now = bal(l1.p);
  await o.conn.reducers.adminResetLeaderboard({ id: lbd.id, pay: false });
  check('manual reset starts a new numbered period', await waitFor(() => boardRow(k('lbd')).currentPeriod === `d${tehranDate(T)}#1` && lbOf(l1.p, k('lbd'))?.players === 0));
  const per2 = await o.conn.procedures.adminLeaderboardPeriods({ boardId: lbd.id, page: 1, pageSize: 10 });
  check('manual reset without pay archives without rewards', per2.total === 2 && per2.rows[0].reason === 'manual' && !per2.rows[0].paid && per2.rows[0].rewarded === 0);
  await run();
  check('no prize for an unpaid reset', bal(l1.p) === b1now);
  await o.conn.reducers.adminSetLeaderboardScore({ boardId: lbs.id, accountId: l3.id, score: 2, mode: 'set' });
  const wkBefore = boardRow(k('lbs')).currentPeriod;
  const dow = new Date(`${tehranDate(T)}T00:00:00Z`).getUTCDay();
  const toSat = ((6 - dow + 7) % 7) || 7;
  if (toSat > 1) {
    await advance((toSat - 1) * DAY);
    await run();
  }
  check('a weekly board keeps its period inside the week', boardRow(k('lbs')).currentPeriod === wkBefore, [wkBefore, boardRow(k('lbs')).currentPeriod]);
  await advance(DAY);
  await run();
  check('a weekly board resets on Saturday', await waitFor(() => boardRow(k('lbs')).currentPeriod === `w${tehranDate(T)}`), [boardRow(k('lbs')).currentPeriod, tehranDate(T)]);
  check('the weekly period was archived', (await o.conn.procedures.adminLeaderboardPeriods({ boardId: lbs.id, page: 1, pageSize: 10 })).rows[0].reason === 'reset');

  await o.conn.reducers.adminSetLeaderboardScore({ boardId: lbw.id, accountId: l4.id, score: 1, mode: 'add' });
  await board(k('lbw'), { gameId: duel.id, source: 'wins', period: 'daily', scoreMode: 'sum' });
  const restarted = boardRow(k('lbw'));
  check('changing the period restarts the board', restarted.currentPeriod.startsWith(`d${tehranDate(T)}#`) && (await o.conn.procedures.adminLeaderboardPeriods({ boardId: lbw.id, page: 1, pageSize: 10 })).rows[0].reason === 'restart');
  check('restart pays nothing', (await o.conn.procedures.adminLeaderboardPeriods({ boardId: lbw.id, page: 1, pageSize: 10 })).rows[0].paid === false);
  check('board key is locked', (await errorOf(o.conn.reducers.adminSaveLeaderboard({ ...boardArgs(restarted), key: 'other' }))).includes('KEY_LOCKED'));
  await board(k('lbm'), { source: 'server', period: 'monthly', scoreMode: 'last', isActive: false });
  check('inactive boards leave the player list', await waitFor(() => !lbOf(l1.p, k('lbm'))));
  await o.conn.reducers.adminDeleteLeaderboard({ id: lbm.id });
  check('board deleted', await waitFor(() => !rows(o.conn.db.adminLeaderboards.iter()).some(b => b.key === k('lbm'))));

  const pg = await o.conn.procedures.adminPlayerGames({ accountId: l1.id });
  check('admin player history has tickets and payouts', pg.tickets.length >= 3 && pg.payouts.some(x => x.kind === 'leaderboard' && x.status === 'granted'));
  check('player sees only own matches', rows(l3.p.conn.db.myMatches.iter()).every(m => m.players.some(x => x.me)));
  check('game changes audited', (await o.conn.procedures.adminAudit({ action: 'game.update', page: 1, pageSize: 5 })).total > 0 && (await o.conn.procedures.adminAudit({ action: 'games_settings.clock', page: 1, pageSize: 5 })).total > 0);
  check('room changes audited', (await o.conn.procedures.adminAudit({ action: 'game_room.create', page: 1, pageSize: 5 })).total > 0);

  await cleanup();
  check('games clock back at zero', rows(o.conn.db.adminGamesSettings.iter())[0]?.clockOffsetSec === 0n);
  check('games settings back to defaults', rows(o.conn.db.adminGamesSettings.iter())[0]?.ticketTtlSeconds === 300 && rows(o.conn.db.adminGamesSettings.iter())[0]?.historyDays === 90);
  void lt;
  void prodA;
  done('games');
}

async function cleanup() {
  for (const b of rows(o.conn.db.adminLeaderboards.iter()).filter(b => b.key.endsWith(`_${R}`) && b.isActive)) {
    await o.conn.reducers.adminSaveLeaderboard({ ...boardArgs(b), isActive: false });
  }
  for (const r of rows(o.conn.db.adminGameRooms.iter()).filter(r => r.key.endsWith(`_${R}`) && r.isActive)) {
    await o.conn.reducers.adminSaveGameRoom({ ...roomArgs(r), isActive: false });
  }
  const lt = rows(o.conn.db.adminLevelTables.iter()).find(x => x.key === k('lt'));
  if (lt) await o.conn.reducers.adminSaveLevelTable({ id: lt.id, key: lt.key, name: lt.name, description: lt.description, metaKey: lt.metaKey, levelMetaKey: lt.levelMetaKey, steps: lt.steps, isActive: false, sort: lt.sort });
  await saveGame('sample_duel', DUEL_DEFAULTS);
  await saveGame('sample_party', PARTY_DEFAULTS);
  await o.conn.reducers.adminSaveGamesSettings(DEFAULT_SETTINGS);
  await clock(0);
  await waitFor(() => rows(o.conn.db.adminGamesSettings.iter())[0]?.ticketTtlSeconds === 300);
}

main().catch(async e => {
  console.error('ERROR', e);
  try {
    await cleanup();
  } catch {}
  process.exit(1);
});
