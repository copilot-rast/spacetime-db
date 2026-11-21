import { ECONOMY_QUERIES, GAMIFICATION_QUERIES, ITEMS_QUERIES, PLAYER_QUERIES, PROMO_QUERIES, check, connect, done, errorOf, login, loginOwner, panelUser, sql, tr, uniquePhone, waitFor, type Client } from './src/lib.ts';

const R = String(Date.now() % 10_000_000);
const k = (s: string) => `${s}_${R}`;
const QUERIES = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMIFICATION_QUERIES, ...ITEMS_QUERIES, ...PROMO_QUERIES];
const c = (token?: string) => connect(token, QUERIES);
const rows = <T>(it: Iterable<T>) => [...it];
const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

let o: Client;
let off = 0;
type GameArgs = Parameters<Client['conn']['reducers']['adminSaveChanceGame']>[0];
type BannerArgs = Parameters<Client['conn']['reducers']['adminSaveBanner']>[0];
type SponsorArgs = Parameters<Client['conn']['reducers']['adminSaveSponsor']>[0];
type SettingsArgs = Parameters<Client['conn']['reducers']['adminSavePromoSettings']>[0];

const DEFAULTS: SettingsArgs = { listPerMinute: 60, countPerMinute: 60, playPerMinute: 60, newPlayerDays: 7, requestTtlHours: 24, keepDays: 45 };
const gold = k('gold');
const bal = (cl: Client) => rows(cl.conn.db.myWallet.iter()).find(w => w.currencyKey === gold)?.balance ?? -1n;
const qty = (cl: Client, key: string) => rows(cl.conn.db.myInventory.iter()).find(r => r.itemKey === key)?.quantity ?? 0;
const plays = (cl: Client, gameKey: string) => rows(cl.conn.db.myChancePlays.iter()).filter(p => p.gameKey === gameKey);
const rid = () => `r${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const nowUs = (extraSec = 0) => BigInt(Date.now() + (off + extraSec) * 1000) * 1000n;

function tehranTarget() {
  const now = Date.now();
  const tehran = now + 3.5 * HOUR * 1000;
  const day = Math.floor(tehran / 86_400_000);
  const dow = (day + 4) % 7;
  let d = (1 - dow + 7) % 7;
  if (d > 3) d -= 7;
  const target = (day + d) * 86_400_000 + 10 * HOUR * 1000 - 3.5 * HOUR * 1000;
  return Math.round((target - now) / 1000);
}

async function clock(sec: number) {
  off = sec;
  await o.conn.reducers.adminSetPromoClockOffset({ seconds: BigInt(sec) });
  await waitFor(() => rows(o.conn.db.adminPromoSettings.iter())[0]?.clockOffsetSec === BigInt(sec));
}
async function settings(p: Partial<SettingsArgs>) {
  const want = { ...DEFAULTS, ...p };
  await o.conn.reducers.adminSavePromoSettings(want);
  await waitFor(() => rows(o.conn.db.adminPromoSettings.iter())[0]?.countPerMinute === want.countPerMinute && rows(o.conn.db.adminPromoSettings.iter())[0]?.playPerMinute === want.playPerMinute);
}
async function player(tags: bigint[] = []) {
  const p = await c();
  const phone = uniquePhone('0937');
  const r = await login(p, phone);
  if (tags.length) await o.conn.reducers.adminSetPlayerTags({ accountId: r.accountId, tagIds: tags });
  await waitFor(() => bal(p) === 1000n);
  return { p, id: r.accountId };
}
async function prize(key: string, items: { type: string; key: string; action: string; value: number }[], isRepeatable = true) {
  await o.conn.reducers.adminSavePrize({ id: 0n, key, name: tr(key), message: [], categoryId: 0n, tagIds: [], isRepeatable, items });
  await waitFor(() => rows(o.conn.db.prize.iter()).some(x => x.key === key));
  return rows(o.conn.db.prize.iter()).find(x => x.key === key)!.id;
}
async function group(key: string, entries: { prizeId: bigint; weight: number }[]) {
  await o.conn.reducers.adminSavePrizeGroup({ id: 0n, key, name: tr(key), entries, isActive: true });
  await waitFor(() => rows(o.conn.db.prizeGroup.iter()).some(x => x.key === key));
  return rows(o.conn.db.prizeGroup.iter()).find(x => x.key === key)!.id;
}
async function game(key: string, p: Partial<GameArgs>, by: Client = o) {
  await by.conn.reducers.adminSaveChanceGame({
    id: 0n,
    key,
    kind: 'wheel',
    name: tr(key),
    description: [],
    metadata: '',
    prizeType: 'prize',
    prize: [{ chance: 100, prizeId: 0n, prizeGroupId: 0n }],
    intervalTime: 0,
    freePlays: 0,
    freePeriod: 'day',
    price: undefined,
    dailyLimit: 0,
    totalLimit: 0,
    isActive: true,
    sort: 0,
    ...p,
  });
  await waitFor(() => rows(o.conn.db.chanceGame.iter()).some(x => x.key === key));
  return rows(o.conn.db.chanceGame.iter()).find(x => x.key === key)!;
}
async function placement(key: string, maxItems = 5, sponsorId = 0n) {
  await o.conn.reducers.adminSavePlacement({ id: 0n, key, name: tr(key), description: [], layout: 'carousel', maxItems, rotateSeconds: 5, sponsorId, isActive: true, sort: 0 });
  await waitFor(() => rows(o.conn.db.placement.iter()).some(x => x.key === key));
  return rows(o.conn.db.placement.iter()).find(x => x.key === key)!.id;
}
async function banner(key: string, placementId: bigint, p: Partial<BannerArgs>) {
  await o.conn.reducers.adminSaveBanner({
    id: 0n,
    key,
    placementId,
    name: key,
    tagIds: [],
    title: tr(key),
    subtitle: [],
    description: [],
    imageUrl: 'https://cdn.example.com/b.png',
    bgColor: '#112233',
    actionType: 'none',
    actionValue: '',
    actionLabel: [],
    priority: 0,
    startsAt: 0n,
    endsAt: 0n,
    days: [],
    dayStart: 0,
    dayEnd: 0,
    audienceTagIds: [],
    excludeTagIds: [],
    levelTableId: 0n,
    minLevel: 0,
    maxLevel: 0,
    playerAge: 'all',
    countries: [],
    sponsorId: 0n,
    isActive: true,
    ...p,
  });
  await waitFor(() => rows(o.conn.db.adminBanners.iter()).some(x => x.key === key));
  return rows(o.conn.db.adminBanners.iter()).find(x => x.key === key)!.id;
}
async function sponsor(key: string, p: Partial<SponsorArgs>) {
  await o.conn.reducers.adminSaveSponsor({
    id: 0n,
    key,
    name: tr(key),
    description: [],
    logoUrl: '/logo.png',
    color: '#ff8800',
    websiteUrl: 'https://sponsor.example.com',
    tagIds: [],
    contactName: 'Ali',
    contactEmail: 'Ali@Example.com',
    contactPhone: '۰۹۱۲۱۲۳۴۵۶۷',
    notes: '',
    startsAt: nowUs(-DAY),
    endsAt: nowUs(30 * DAY),
    budgetToman: 5_000_000n,
    targetViews: 0,
    targetClicks: 0,
    stopAtTarget: false,
    isActive: true,
    sort: 0,
    ...p,
  });
  await waitFor(() => rows(o.conn.db.adminSponsors.iter()).some(x => x.key === key));
  return rows(o.conn.db.adminSponsors.iter()).find(x => x.key === key)!.id;
}
async function tag(key: string) {
  await o.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key, title: tr(key), color: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.tag.iter()).some(x => x.key === key && x.keyType === 'user'));
  return rows(o.conn.db.tag.iter()).find(x => x.key === key && x.keyType === 'user')!.id;
}
async function safeMinute() {
  const s = (Date.now() % 60_000) / 1000;
  if (s > 45) await new Promise(r => setTimeout(r, (61 - s) * 1000));
}
const listKeys = async (cl: Client, placementKey: string) => (await cl.conn.procedures.banners({ placement: placementKey })).items.map(i => i.key);

async function main() {
  o = await c();
  await loginOwner(o);
  await settings({});
  await clock(0);

  check('promo settings defaults', await waitFor(() => {
    const s = rows(o.conn.db.adminPromoSettings.iter())[0];
    return !!s && s.listPerMinute === 60 && s.countPerMinute === 60 && s.playPerMinute === 60 && s.newPlayerDays === 7 && s.requestTtlHours === 24 && s.keepDays === 45 && s.clockOffsetSec === 0n;
  }));
  check('banner and sponsor key types seeded', ['banner', 'sponsor'].every(x => rows(o.conn.db.keyType.iter()).some(t => t.key === x && t.system)));
  check('chance_played event type seeded', rows(o.conn.db.eventType.iter()).some(x => x.key === 'chance_played' && x.isSystem && !x.clientAllowed));

  const T0 = tehranTarget();
  await clock(T0);

  await o.conn.reducers.adminSaveCurrency({ id: 0n, key: gold, name: tr('طلا'), type: 'soft', defaultValue: 1000n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.currency.iter()).some(x => x.key === gold));
  const xp = k('xp');
  const tokens = k('tokens');
  for (const m of [xp, tokens]) {
    await o.conn.reducers.adminSaveMeta({ id: 0n, key: m, name: tr(m), defaultValue: 0, serverOnly: false });
    await waitFor(() => rows(o.conn.db.meta.iter()).some(x => x.key === m));
  }
  await o.conn.reducers.adminSaveLevelTable({ id: 0n, key: k('lt'), name: tr('سطح'), description: [], metaKey: xp, levelMetaKey: '', steps: [{ level: 1, threshold: 10, title: [], prizeId: 0n, grantMode: 'auto' }, { level: 2, threshold: 100, title: [], prizeId: 0n, grantMode: 'auto' }], isActive: true, sort: 0 });
  await waitFor(() => rows(o.conn.db.adminLevelTables.iter()).some(x => x.key === k('lt')));
  const lt = rows(o.conn.db.adminLevelTables.iter()).find(x => x.key === k('lt'))!.id;
  const ticketKey = k('ticket');
  await o.conn.reducers.adminSaveItem({ id: 0n, key: ticketKey, typeKey: 'booster', name: tr('بلیت'), description: [], iconUrl: '', imageUrl: '', categoryId: 0n, tagIds: [], rarity: 'common', stackable: true, maxStack: 0, requiresKey: '', isStarter: false, starterQuantity: 0, levelTableId: 0n, unlockLevel: 0, price: undefined, upgrades: [], services: [], usePrizeId: 0n, metadata: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.item.iter()).some(x => x.key === ticketKey));
  const ticketId = rows(o.conn.db.item.iter()).find(x => x.key === ticketKey)!.id;

  const p10 = await prize(k('p10'), [{ type: 'currency', key: gold, action: 'add', value: 10 }]);
  const p20 = await prize(k('p20'), [{ type: 'currency', key: gold, action: 'add', value: 20 }]);
  const p50 = await prize(k('p50'), [{ type: 'currency', key: gold, action: 'add', value: 50 }]);
  const pBad = await prize(k('pbad'), [{ type: 'currency', key: gold, action: 'add', value: -100000 }]);
  const pOnce = await prize(k('ponce'), [{ type: 'meta', key: tokens, action: 'add', value: 1 }], false);
  const gA = await prize(k('ga'), [{ type: 'meta', key: tokens, action: 'add', value: 3 }]);
  const gB = await prize(k('gb'), [{ type: 'meta', key: tokens, action: 'add', value: 7 }]);
  const grp = await group(k('grp'), [{ prizeId: gA, weight: 3 }, { prizeId: gB, weight: 1 }]);

  const slots3 = [{ chance: 50, prizeId: p10, prizeGroupId: 0n }, { chance: 30, prizeId: p20, prizeGroupId: 0n }, { chance: 20, prizeId: 0n, prizeGroupId: 0n }];
  check('chances must sum to 100', (await errorOf(game(k('bad'), { intervalTime: 60, prize: [{ chance: 60, prizeId: p10, prizeGroupId: 0n }, { chance: 30, prizeId: 0n, prizeGroupId: 0n }] }))).includes('TOTAL_CHANCE_MUST_BE_100:90'));
  check('four decimals at most', (await errorOf(game(k('bad'), { intervalTime: 60, prize: [{ chance: 33.33333, prizeId: 0n, prizeGroupId: 0n }, { chance: 66.66667, prizeId: 0n, prizeGroupId: 0n }] }))).includes('INVALID_PRIZE_CHANCE'));
  check('group in a prize game refused', (await errorOf(game(k('bad'), { intervalTime: 60, prize: [{ chance: 100, prizeId: 0n, prizeGroupId: grp }] }))).includes('PRIZE_TYPE_MISMATCH'));
  check('a game needs a free turn or a ticket', (await errorOf(game(k('bad'), {}))).includes('INTERVAL_OR_PRICE_REQUIRED'));
  check('ticket amount must be positive', (await errorOf(game(k('bad'), { price: { type: 'currency', key: gold, amount: 0n } }))).includes('INVALID_PRICE_AMOUNT'));
  check('ticket type checked', (await errorOf(game(k('bad'), { price: { type: 'gem', key: gold, amount: 1n } }))).includes('INVALID_PRICE_PAYLOAD'));
  check('ticket item must exist', (await errorOf(game(k('bad'), { price: { type: 'item', key: 'nope', amount: 1n } }))).includes('ITEM_NOT_FOUND'));
  check('bad metadata refused', (await errorOf(game(k('bad'), { intervalTime: 60, metadata: '[1]' }))).includes('INVALID_METADATA'));

  const { client: op } = await panelUser(o, 'operator', QUERIES);
  check('operator cannot save a chance game', (await errorOf(game(k('bad'), { intervalTime: 60 }, op))).includes('FORBIDDEN'));
  check('operator cannot change promo settings', (await errorOf(op.conn.reducers.adminSavePromoSettings(DEFAULTS))).includes('FORBIDDEN'));
  check('operator cannot move the promo clock', (await errorOf(op.conn.reducers.adminSetPromoClockOffset({ seconds: 5n }))).includes('FORBIDDEN'));
  check('operator reads promo settings', await waitFor(() => rows(op.conn.db.adminPromoSettings.iter()).length === 1));

  const wheel = await game(k('wheel'), { intervalTime: 60, prize: slots3, metadata: '{"color":"red"}' });
  const { p: p1, id: id1 } = await player();
  check('player cannot save a chance game', (await errorOf(game(k('bad'), { intervalTime: 60 }, p1))).includes('FORBIDDEN'));
  check('player cannot move the promo clock', (await errorOf(p1.conn.reducers.adminSetPromoClockOffset({ seconds: 5n }))).includes('FORBIDDEN'));
  check('unknown game', (await errorOf(p1.conn.procedures.chancePlay({ key: 'nope', requestId: '' }))).includes('CHANCE_GAME_NOT_FOUND'));
  const cp0 = await p1.conn.procedures.chanceCanPlay({ key: wheel.key });
  check('can play a fresh free game', cp0.canPlay && cp0.nextPlayTime === 0n && cp0.code === 'SUCCESS');
  check('ticket play on a free-only game', (await errorOf(p1.conn.procedures.chancePlayWithTicket({ key: wheel.key, requestId: '' }))).includes('TICKET_PLAY_IS_NOT_SUPPORT'));
  const w1 = await p1.conn.procedures.chancePlay({ key: wheel.key, requestId: '' });
  const won = w1.prizeId === p10 ? 10n : w1.prizeId === p20 ? 20n : 0n;
  check('free play answers SUCCESS with roll and slot', w1.code === 'SUCCESS' && w1.status === 200 && w1.mode === 'free' && w1.slot >= 0 && w1.slot <= 2 && w1.roll >= 0 && w1.roll < 100, w1);
  check('slot follows the cumulative roll', (w1.roll < 50 ? 0 : w1.roll < 80 ? 1 : 2) === w1.slot, w1);
  check('free play prize granted', await waitFor(() => bal(p1) === 1000n + won), { b: bal(p1), won });
  check('free play logged', await waitFor(() => plays(p1, wheel.key).length === 1 && plays(p1, wheel.key)[0].status === 'done'));
  check('next free play waits about an hour', w1.nextPlayTime > 3590n && w1.nextPlayTime <= 3600n, w1.nextPlayTime);
  const wait = await errorOf(p1.conn.procedures.chancePlay({ key: wheel.key, requestId: '' }));
  const sec = Number(wait.match(/WAITING_FOR_TURN:(\d+)/)?.[1] ?? 0);
  check('cooldown refuses a second free play', sec > 3500 && sec <= 3600, wait);
  const cp1 = await p1.conn.procedures.chanceCanPlay({ key: wheel.key });
  const nt = await p1.conn.procedures.chanceNextPlayTime({ key: wheel.key });
  check('can play and next play time follow the cooldown', !cp1.canPlay && nt.nextPlayTime > 3500n && nt.nextPlayAt > 0n);
  const listed = (await p1.conn.procedures.chanceGames({})).find(g => g.game.key === wheel.key);
  check('games list has the turn', !!listed && listed.hasFreeTurn && !listed.canPlay && listed.plays === 1n && listed.game.metadata === '{"color":"red"}');

  const { p: p2 } = await player();
  const burst = await Promise.allSettled(Array.from({ length: 8 }, () => p2.conn.procedures.chancePlay({ key: wheel.key, requestId: '' })));
  const ok = burst.filter(r => r.status === 'fulfilled').length;
  const waiting = burst.filter(r => r.status === 'rejected' && String((r as PromiseRejectedResult).reason?.message ?? r.reason).includes('WAITING_FOR_TURN')).length;
  check('parallel free plays play once', ok === 1 && waiting === 7, { ok, waiting });
  await clock(T0 + 61 * MIN);
  const w2 = await p1.conn.procedures.chancePlay({ key: wheel.key, requestId: '' });
  check('free play opens after the cooldown', w2.code === 'SUCCESS');

  const freebie = await game(k('freebie'), { intervalTime: 1, freePlays: 2, freePeriod: 'day', prize: [{ chance: 100, prizeId: 0n, prizeGroupId: 0n }] });
  await p1.conn.procedures.chancePlay({ key: freebie.key, requestId: '' });
  await clock(T0 + 63 * MIN);
  await p1.conn.procedures.chancePlay({ key: freebie.key, requestId: '' });
  await clock(T0 + 65 * MIN);
  const fu = await errorOf(p1.conn.procedures.chancePlay({ key: freebie.key, requestId: '' }));
  check('free plays per period are capped', /FREE_PLAYS_USED:\d+/.test(fu), fu);
  const nothing = plays(p1, freebie.key);
  check('an empty slot wins nothing', nothing.every(x => x.prizeId === 0n && x.status === 'done'));

  const box = await game(k('box'), { kind: 'loot_box', price: { type: 'item', key: ticketKey, amount: 1n }, prize: [{ chance: 100, prizeId: p50, prizeGroupId: 0n }] });
  check('no ticket, no play', (await errorOf(p1.conn.procedures.chancePlayWithTicket({ key: box.key, requestId: '' }))).includes('ITEM_IS_NOT_ENOUGH'));
  check('free play on a ticket-only game', (await errorOf(p1.conn.procedures.chancePlay({ key: box.key, requestId: '' }))).includes('INTERVAL_TIME_IS_NULL'));
  check('can play needs a free turn', (await errorOf(p1.conn.procedures.chanceCanPlay({ key: box.key }))).includes('INTERVAL_TIME_IS_NULL'));
  await o.conn.reducers.adminGiveItem({ accountId: id1, itemId: ticketId, quantity: 3, note: '' });
  await waitFor(() => qty(p1, ticketKey) === 3);
  const before = bal(p1);
  const b1 = await p1.conn.procedures.chancePlayWithTicket({ key: box.key, requestId: '' });
  check('ticket spent and prize granted together', b1.won && b1.prizeId === p50 && b1.spent?.type === 'item' && b1.spent.amount === 1n && (await waitFor(() => qty(p1, ticketKey) === 2 && bal(p1) === before + 50n)), { b1, q: qty(p1, ticketKey) });
  check('ticket play logged with the spend', await waitFor(() => plays(p1, box.key).some(x => x.mode === 'ticket' && x.status === 'done' && x.spent.includes(ticketKey))));

  const trap = await game(k('trap'), { kind: 'slot', price: { type: 'item', key: ticketKey, amount: 1n }, prize: [{ chance: 100, prizeId: pBad, prizeGroupId: 0n }] });
  const b2 = bal(p1);
  const fe = await errorOf(p1.conn.procedures.chancePlayWithTicket({ key: trap.key, requestId: '' }));
  check('a failing grant fails the play', fe.includes('INSUFFICIENT_BALANCE'), fe);
  await new Promise(r => setTimeout(r, 300));
  check('a failing grant spends nothing', qty(p1, ticketKey) === 2 && bal(p1) === b2, { q: qty(p1, ticketKey), b: bal(p1) });
  check('a failed play is logged', await waitFor(() => plays(p1, trap.key).length === 1 && plays(p1, trap.key)[0].status === 'failed' && plays(p1, trap.key)[0].error.includes('INSUFFICIENT_BALANCE')));
  const trapState = await p1.conn.procedures.chanceGames({});
  check('a failed play does not count', trapState.find(g => g.game.key === trap.key)?.plays === 0n);

  const pricey = await game(k('pricey'), { price: { type: 'currency', key: gold, amount: 5000n } });
  const ce = await errorOf(p1.conn.procedures.chancePlayWithTicket({ key: pricey.key, requestId: '' }));
  check('short currency is CURRENCY_IS_NOT_ENOUGH with amount and balance', ce.includes(`CURRENCY_IS_NOT_ENOUGH:5000:${bal(p1)}`), ce);
  const metaGame = await game(k('metagame'), { price: { type: 'meta', key: tokens, amount: 2n }, prize: [{ chance: 100, prizeId: 0n, prizeGroupId: 0n }] });
  check('short meta refused', (await errorOf(p1.conn.procedures.chancePlayWithTicket({ key: metaGame.key, requestId: '' }))).includes('META_IS_NOT_ENOUGH'));
  await o.conn.reducers.adminAdjust({ accountId: id1, kind: 'meta', key: tokens, action: 'set', value: 5, note: '' });
  const mg = await p1.conn.procedures.chancePlayWithTicket({ key: metaGame.key, requestId: '' });
  check('meta ticket spent', mg.spent?.type === 'meta' && (await waitFor(() => rows(p1.conn.db.myMetas.iter()).find(m => m.metaKey === tokens)?.value === 3)));

  const once = await game(k('once'), { price: { type: 'currency', key: gold, amount: 1n }, prize: [{ chance: 100, prizeId: pOnce, prizeGroupId: 0n }] });
  const o1 = await p1.conn.procedures.chancePlayWithTicket({ key: once.key, requestId: '' });
  const o2 = await p1.conn.procedures.chancePlayWithTicket({ key: once.key, requestId: '' });
  check('an owned non-repeatable prize wins nothing', o1.won && !o2.won && o2.alreadyOwned && o2.slot === 0, o2);

  const limited = await game(k('limited'), { price: { type: 'currency', key: gold, amount: 1n }, dailyLimit: 3, totalLimit: 5 });
  for (let i = 0; i < 3; i++) await p1.conn.procedures.chancePlayWithTicket({ key: limited.key, requestId: '' });
  const de = await errorOf(p1.conn.procedures.chancePlayWithTicket({ key: limited.key, requestId: '' }));
  check('daily limit', /DAILY_LIMIT_REACHED:\d+/.test(de), de);
  await clock(T0 + DAY);
  await p1.conn.procedures.chancePlayWithTicket({ key: limited.key, requestId: '' });
  await p1.conn.procedures.chancePlayWithTicket({ key: limited.key, requestId: '' });
  check('daily limit resets on the next Tehran day, total limit stops', (await errorOf(p1.conn.procedures.chancePlayWithTicket({ key: limited.key, requestId: '' }))).includes('TOTAL_LIMIT_REACHED'));

  const paid = await game(k('paid'), { price: { type: 'currency', key: gold, amount: 2n }, prize: slots3 });
  const r1 = rid();
  const bb = bal(p1);
  const q1 = await p1.conn.procedures.chancePlayWithTicket({ key: paid.key, requestId: r1 });
  const q2 = await p1.conn.procedures.chancePlayWithTicket({ key: paid.key, requestId: r1 });
  const gain = q1.prizeId === p10 ? 10n : q1.prizeId === p20 ? 20n : 0n;
  check('a repeated request id returns the same result', q2.replayed && !q1.replayed && q2.playId === q1.playId && q2.roll === q1.roll && q2.slot === q1.slot && q2.prizeId === q1.prizeId);
  check('a repeated request id charges once', await waitFor(() => bal(p1) === bb - 2n + gain), { b: bal(p1), bb, gain });
  check('a request id for another game is refused', (await errorOf(p1.conn.procedures.chancePlayWithTicket({ key: limited.key, requestId: r1 }))).includes('REQUEST_ID_REUSED'));
  check('a bad request id is refused', (await errorOf(p1.conn.procedures.chancePlayWithTicket({ key: paid.key, requestId: 'bad id!' }))).includes('INVALID_REQUEST_ID'));

  await settings({ playPerMinute: 0 });
  const dist = await game(k('dist'), { price: { type: 'currency', key: gold, amount: 1n }, prize: slots3 });
  const { p: p3, id: id3 } = await player();
  await o.conn.reducers.adminAdjust({ accountId: id3, kind: 'currency', key: gold, action: 'add', value: 5000, note: '' });
  await waitFor(() => bal(p3) === 6000n);
  const N = 400;
  const counts = [0, 0, 0];
  const rolls = new Set<number>();
  for (let i = 0; i < N; i++) {
    const r = await p3.conn.procedures.chancePlayWithTicket({ key: dist.key, requestId: '' });
    counts[r.slot]++;
    rolls.add(r.roll);
  }
  check('weighted slot distribution over 400 plays', Math.abs(counts[0] - 200) < 45 && Math.abs(counts[1] - 120) < 40 && Math.abs(counts[2] - 80) < 35, counts);
  check('rolls differ from play to play', rolls.size > N * 0.9, rolls.size);
  const gg = await game(k('grpgame'), { kind: 'loot_box', prizeType: 'prizeGroup', price: { type: 'currency', key: gold, amount: 1n }, prize: [{ chance: 100, prizeId: 0n, prizeGroupId: grp }] });
  const gc = new Map<bigint, number>();
  const M = 240;
  for (let i = 0; i < M; i++) {
    const r = await p3.conn.procedures.chancePlayWithTicket({ key: gg.key, requestId: '' });
    gc.set(r.prizeId, (gc.get(r.prizeId) ?? 0) + 1);
    if (i === 0) check('prize group play reports the group', r.prizeGroupId === grp && (r.prizeId === gA || r.prizeId === gB), r);
  }
  check('weighted prize group distribution 3:1', Math.abs((gc.get(gA) ?? 0) - 180) < 35 && (gc.get(gA) ?? 0) + (gc.get(gB) ?? 0) === M, [...gc]);
  check('every play is logged', await waitFor(() => plays(p3, dist.key).length === N && plays(p3, gg.key).length === M, 8000));
  check('chance_played events recorded', Number(sql(`SELECT COUNT(*) AS n FROM gam_player_event WHERE account_id = ${id3} AND type_key = 'chance_played'`).match(/(\d+)\s*$/m)?.[1] ?? 0) === N + M);
  await settings({ playPerMinute: 3 });
  await safeMinute();
  for (let i = 0; i < 3; i++) await p3.conn.procedures.chancePlayWithTicket({ key: dist.key, requestId: '' });
  check('plays are rate-limited per player', (await errorOf(p3.conn.procedures.chancePlayWithTicket({ key: dist.key, requestId: '' }))).includes('TOO_MANY_REQUESTS'));
  await settings({});

  const ap = await op.conn.procedures.adminChancePlays({ gameId: trap.id, accountId: 0n, status: 'failed', page: 1, pageSize: 10 });
  check('operator lists failed plays', ap.total === 1 && ap.rows[0].accountId === id1);
  check('prize in a game cannot be deleted', (await errorOf(o.conn.reducers.adminDeletePrize({ id: p50 }))).includes('IN_USE'));
  check('prize group in a game cannot be deleted', (await errorOf(o.conn.reducers.adminDeletePrizeGroup({ id: grp }))).includes('IN_USE'));
  check('ticket currency cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteCurrency({ id: rows(o.conn.db.currency.iter()).find(x => x.key === gold)!.id }))).includes('IN_USE'));
  check('ticket item cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteItem({ id: ticketId }))).includes('IN_USE'));
  check('ticket meta cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteMeta({ id: rows(o.conn.db.meta.iter()).find(x => x.key === tokens)!.id }))).includes('IN_USE'));
  check('a game with plays cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteChanceGame({ id: wheel.id }))).includes('IN_USE'));
  const unused = await game(k('unused'), { intervalTime: 5 });
  await o.conn.reducers.adminDeleteChanceGame({ id: unused.id });
  check('an unused game can be deleted', await waitFor(() => !rows(o.conn.db.chanceGame.iter()).some(x => x.key === unused.key)));
  const au = await o.conn.procedures.adminAudit({ action: 'chance_game.', page: 1, pageSize: 50 });
  check('chance game changes audited', au.rows.some(r => r.action === 'chance_game.create') && au.rows.some(r => r.action === 'chance_game.delete'));

  await clock(T0);
  check('bad layout refused', (await errorOf(o.conn.reducers.adminSavePlacement({ id: 0n, key: k('pl_bad'), name: tr('x'), description: [], layout: 'tower', maxItems: 3, rotateSeconds: 0, sponsorId: 0n, isActive: true, sort: 0 }))).includes('INVALID_LAYOUT'));
  const home = await placement(k('home'), 3);
  check('bad image url refused', (await errorOf(banner(k('bad'), home, { imageUrl: 'ftp://x' }))).includes('INVALID_URL'));
  check('bad colour refused', (await errorOf(banner(k('bad'), home, { bgColor: 'red' }))).includes('INVALID_COLOR'));
  check('url action needs an absolute url', (await errorOf(banner(k('bad'), home, { actionType: 'url', actionValue: '/shop' }))).includes('INVALID_URL'));
  check('sponsor action needs a sponsor', (await errorOf(banner(k('bad'), home, { actionType: 'sponsor' }))).includes('SPONSOR_REQUIRED'));
  check('product action needs a product', (await errorOf(banner(k('bad'), home, { actionType: 'product', actionValue: 'nope' }))).includes('PRODUCT_NOT_FOUND'));
  check('bad day refused', (await errorOf(banner(k('bad'), home, { days: [7] }))).includes('INVALID_DAYS'));
  check('operator cannot delete a placement', (await errorOf(op.conn.reducers.adminDeletePlacement({ id: home }))).includes('FORBIDDEN'));
  const bA = await banner(k('ba'), home, { priority: 10, actionType: 'url', actionValue: 'https://example.com/a' });
  const bB = await banner(k('bb'), home, { priority: 50, actionType: 'screen', actionValue: 'shop' });
  const bC = await banner(k('bc'), home, { priority: 0 });
  const bD = await banner(k('bd'), home, { priority: 0 });
  const off1 = await banner(k('boff'), home, { priority: 900, isActive: false });
  const { p: p4, id: id4 } = await player();
  const hl = await p4.conn.procedures.banners({ placement: k('home') });
  check('placement order: priority, then oldest, capped at max items', hl.items.map(i => i.id).join() === [bB, bA, bC].join() && hl.placement.layout === 'carousel' && hl.placement.maxItems === 3, hl.items.map(i => i.key));
  check('banner actions come from the server', hl.items[0].action.type === 'screen' && hl.items[0].action.value === 'shop' && hl.items[1].action.url === 'https://example.com/a');
  const pv = await op.conn.procedures.adminBannerPreview({ placementKey: k('home'), accountId: id4 });
  check('preview tells why a banner is hidden', pv.find(x => x.bannerId === bD)?.reason === 'max_items' && pv.find(x => x.bannerId === off1)?.reason === 'off');
  check('unknown placement', (await errorOf(p4.conn.procedures.banners({ placement: 'nope' }))).includes('BANNER_LIST_NOT_FOUND'));
  check('player sees no admin banners', rows(p4.conn.db.adminBanners.iter()).length === 0 && rows(p4.conn.db.adminSponsors.iter()).length === 0 && rows(p4.conn.db.adminPromoSettings.iter()).length === 0);
  check('operator reads banners', await waitFor(() => rows(op.conn.db.adminBanners.iter()).length >= 5));

  const sched = await placement(k('sched'), 10);
  const sMon = await banner(k('s_mon'), sched, { days: [1], dayStart: 9 * 60, dayEnd: 11 * 60 });
  const sTue = await banner(k('s_tue'), sched, { days: [2] });
  const sNoon = await banner(k('s_noon'), sched, { dayStart: 12 * 60, dayEnd: 13 * 60 });
  const sLate = await banner(k('s_late'), sched, { startsAt: nowUs(HOUR) });
  const sGone = await banner(k('s_gone'), sched, { endsAt: nowUs(-HOUR) });
  const sNight = await banner(k('s_night'), sched, { dayStart: 22 * 60, dayEnd: 2 * 60 });
  const ids = async () => (await p4.conn.procedures.banners({ placement: k('sched') })).items.map(i => i.id);
  const at10 = await ids();
  check('Monday 10:00 Tehran shows only the Monday morning banner', at10.join() === [sMon].join(), at10);
  const pv2 = await op.conn.procedures.adminBannerPreview({ placementKey: k('sched'), accountId: id4 });
  const why = (id: bigint) => pv2.find(x => x.bannerId === id)?.reason;
  check('schedule reasons', why(sTue) === 'day' && why(sNoon) === 'hour' && why(sLate) === 'scheduled' && why(sGone) === 'ended' && why(sNight) === 'hour', pv2);
  await clock(T0 + 2.5 * HOUR);
  const at1230 = await ids();
  check('at 12:30 the noon and started banners show, the morning one does not', at1230.includes(sNoon) && at1230.includes(sLate) && !at1230.includes(sMon), at1230);
  await clock(T0 + 13 * HOUR);
  check('a window over midnight shows at 23:00', (await ids()).includes(sNight));
  await clock(T0 + DAY);
  const tue = await ids();
  check('Tuesday shows the Tuesday banner, not the Monday one', tue.includes(sTue) && !tue.includes(sMon), tue);
  await clock(T0);

  const vip = await tag(k('vip'));
  const tgt = await placement(k('target'), 10);
  const tAud = await banner(k('t_aud'), tgt, { audienceTagIds: [vip] });
  const tExc = await banner(k('t_exc'), tgt, { excludeTagIds: [vip] });
  const tLvl = await banner(k('t_lvl'), tgt, { levelTableId: lt, minLevel: 2 });
  const tNew = await banner(k('t_new'), tgt, { playerAge: 'new' });
  const tRet = await banner(k('t_ret'), tgt, { playerAge: 'returning' });
  const tDe = await banner(k('t_de'), tgt, { countries: ['de'] });
  check('a tag cannot be in audience and exclude', (await errorOf(banner(k('bad'), tgt, { audienceTagIds: [vip], excludeTagIds: [vip] }))).includes('DUPLICATE_TAG'));
  check('unknown country refused', (await errorOf(banner(k('bad'), tgt, { countries: ['zz'] }))).includes('COUNTRY_NOT_FOUND'));
  const { p: pv1 } = await player([vip]);
  const { p: pq, id: idq } = await player();
  const tk = async (cl: Client) => (await cl.conn.procedures.banners({ placement: k('target') })).items.map(i => i.id);
  const v1 = await tk(pv1);
  check('vip player: audience and new banners', v1.includes(tAud) && v1.includes(tNew) && !v1.includes(tExc) && !v1.includes(tLvl) && !v1.includes(tRet) && !v1.includes(tDe), v1);
  const q1b = await tk(pq);
  check('other player: exclude banner, not the audience one', q1b.includes(tExc) && !q1b.includes(tAud), q1b);
  await o.conn.reducers.adminAdjust({ accountId: idq, kind: 'meta', key: xp, action: 'set', value: 100, note: '' });
  await pq.conn.reducers.setMyCountry({ code: 'DE' });
  await new Promise(r => setTimeout(r, 300));
  const q2b = await tk(pq);
  check('level range and country targeting', q2b.includes(tLvl) && q2b.includes(tDe), q2b);
  await clock(T0 + 11 * DAY);
  const q3b = await tk(pq);
  check('returning players after the new-player days', q3b.includes(tRet) && !q3b.includes(tNew), q3b);
  await clock(T0);

  const v = await p4.conn.procedures.bannerView({ bannerIds: [bB, bA, bD, 999999n] });
  check('views counted for visible banners only', v.counted.join() === [bB, bA].join() && v.skipped.includes(bD) && v.skipped.includes(999999n), v);
  const v2 = await p4.conn.procedures.bannerView({ bannerIds: [bB] });
  check('a view counts once per player and day', v2.counted.length === 0 && v2.already.join() === String(bB));
  const cl1 = await p4.conn.procedures.bannerClick({ bannerId: bB });
  const cl2 = await p4.conn.procedures.bannerClick({ bannerId: bB });
  check('a click counts once and returns the action', cl1.counted && !cl2.counted && cl1.action.type === 'screen' && cl1.action.value === 'shop');
  check('a hidden banner cannot be clicked', (await errorOf(p4.conn.procedures.bannerClick({ bannerId: bD }))).includes('BANNER_NOT_AVAILABLE'));
  const stB = await op.conn.procedures.adminBannerStats({ bannerId: bB, days: 7 });
  check('banner stats count views and clicks per day', stB.views === 1 && stB.clicks === 1 && stB.days.length === 7 && stB.days[6].views === 1, stB);

  const { p: p5 } = await player();
  await settings({ countPerMinute: 3, listPerMinute: 3 });
  await safeMinute();
  for (let i = 0; i < 3; i++) await p5.conn.procedures.bannerView({ bannerIds: [bA] });
  check('view and click calls are rate-limited', (await errorOf(p5.conn.procedures.bannerClick({ bannerId: bA }))).includes('TOO_MANY_REQUESTS'));
  for (let i = 0; i < 3; i++) await p5.conn.procedures.banners({ placement: k('home') });
  check('list calls are rate-limited', (await errorOf(p5.conn.procedures.banners({ placement: k('home') }))).includes('TOO_MANY_REQUESTS'));
  const { p: p6 } = await player();
  check('the limit is per player', (await p6.conn.procedures.banners({ placement: k('home') })).items.length === 3);
  await settings({});

  check('sponsor email checked', (await errorOf(sponsor(k('sp_bad'), { contactEmail: 'nope' }))).includes('INVALID_EMAIL'));
  check('sponsor website must be absolute', (await errorOf(sponsor(k('sp_bad'), { websiteUrl: '/x' }))).includes('INVALID_URL'));
  check('sponsor window checked', (await errorOf(sponsor(k('sp_bad'), { startsAt: nowUs(DAY), endsAt: nowUs(0) }))).includes('INVALID_WINDOW'));
  const sp = await sponsor(k('sp'), {});
  const spRow = rows(o.conn.db.adminSponsors.iter()).find(x => x.id === sp)!;
  check('sponsor contact cleaned', spRow.contactEmail === 'ali@example.com' && spRow.contactPhone === '09121234567');
  const spOld = await sponsor(k('sp_old'), { startsAt: nowUs(-30 * DAY), endsAt: nowUs(-DAY) });
  const spCap = await sponsor(k('sp_cap'), { targetViews: 1, stopAtTarget: true });
  const spon = await placement(k('spon'), 10, sp);
  const sb1 = await banner(k('sb1'), spon, { sponsorId: sp, name: '=HYPERLINK("http://x")', actionType: 'sponsor', priority: 5 });
  const sb2 = await banner(k('sb2'), spon, { sponsorId: sp });
  const sbOld = await banner(k('sb_old'), spon, { sponsorId: spOld });
  const sbCap = await banner(k('sb_cap'), spon, { sponsorId: spCap });
  const { p: s1, id: sid1 } = await player();
  const { p: s2 } = await player();
  const sl = await s1.conn.procedures.banners({ placement: k('spon') });
  check('sponsored placement and banners carry the sponsor', sl.placement.sponsor?.id === sp && sl.items.find(i => i.id === sb1)?.sponsor?.key === k('sp'));
  check('a sponsor action opens the sponsor website', sl.items.find(i => i.id === sb1)?.action.url === 'https://sponsor.example.com' && sl.items.find(i => i.id === sb1)?.action.sponsorId === sp);
  check('a banner of an ended sponsor is hidden', !sl.items.some(i => i.id === sbOld) && (await op.conn.procedures.adminBannerPreview({ placementKey: k('spon'), accountId: sid1 })).find(x => x.bannerId === sbOld)?.reason === 'sponsor_off');
  const sv1 = await s1.conn.procedures.bannerView({ bannerIds: [sb1, sb2, sbCap] });
  check('banner views count their live sponsors once', sv1.counted.length === 3 && sv1.sponsorsCounted.includes(sp) && sv1.sponsorsCounted.includes(spCap) && sv1.sponsorsCounted.length === 2, sv1);
  check('a sponsor with its target reached stops showing', !(await s2.conn.procedures.banners({ placement: k('spon') })).items.some(i => i.id === sbCap));
  await s2.conn.procedures.bannerView({ bannerIds: [sb1] });
  const sc = await s1.conn.procedures.bannerClick({ bannerId: sb1 });
  check('a sponsored banner click counts the sponsor', sc.counted && sc.sponsorCounted);
  const live = await s1.conn.procedures.sponsors({ tagKey: '' });
  check('client lists live sponsors only', live.some(x => x.id === sp) && !live.some(x => x.id === spOld) && !live.some(x => x.id === spCap));
  check('an ended sponsor cannot be clicked', (await errorOf(s1.conn.procedures.sponsorClick({ sponsorId: spOld }))).includes('SPONSOR_NOT_AVAILABLE'));
  const sv = await s2.conn.procedures.sponsorView({ sponsorIds: [sp, spOld] });
  check('sponsor view counts once a day and skips ended ones', sv.already.includes(sp) && sv.skipped.includes(spOld) && sv.counted.length === 0, sv);
  const spc = await s2.conn.procedures.sponsorClick({ sponsorId: sp });
  check('sponsor click returns the website', spc.counted && spc.url === 'https://sponsor.example.com');

  const rep = await op.conn.procedures.adminSponsorReport({ sponsorId: sp, from: '', to: '' });
  const today = rep.days[rep.days.length - 1];
  check('sponsor report totals', rep.totals.views === 2 && rep.totals.clicks === 2 && rep.totals.players === 2 && rep.totals.ctrPercent === 100 && rep.days.length === 30, rep.totals);
  check('sponsor report per day', today.views === 2 && today.clicks === 2 && today.players === 2 && today.day === rep.to);
  check('sponsor report all time and targets', rep.allTimeViews === 2n && rep.allTimeClicks === 2n && rep.allTimePlayers === 2 && rep.budgetToman === 5_000_000n && rep.live);
  const rb1 = rep.banners.find(b => b.bannerId === sb1);
  check('sponsor report lists its banners and placements', !!rb1 && rb1.views === 2 && rb1.clicks === 1 && rep.banners.find(b => b.bannerId === sb2)?.views === 1 && rep.placements.includes(k('spon')), rep.banners);
  const csv = await op.conn.procedures.adminSponsorReportCsv({ sponsorId: sp, from: rep.to, to: rep.to });
  const lines = csv.csv.split('\r\n');
  check('csv has a header, day and total lines', lines[0] === 'day,views,clicks,players,ctr_percent' && lines[1] === `${rep.to},2,2,2,100` && lines[2] === 'total,2,2,2,100', lines.slice(0, 3));
  check('csv banner rows guard formulas', csv.csv.includes(`${k('sb1')},"'=HYPERLINK(""http://x"")",${k('spon')},2,1,50`), lines);
  check('csv rows are returned too', csv.header.length === 5 && csv.rows[0][0] === rep.to && csv.filename.endsWith('.csv'));
  check('report range checked', (await errorOf(op.conn.procedures.adminSponsorReport({ sponsorId: sp, from: rep.to, to: '2020-01-01' }))).includes('INVALID_DATE_RANGE'));
  check('report date checked', (await errorOf(op.conn.procedures.adminSponsorReport({ sponsorId: sp, from: '2026-02-30', to: '' }))).includes('INVALID_DATE'));
  check('player cannot read a sponsor report', (await errorOf(s1.conn.procedures.adminSponsorReport({ sponsorId: sp, from: '', to: '' }))).includes('FORBIDDEN'));
  check('a sponsor in use cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteSponsor({ id: sp }))).includes('IN_USE'));
  check('a placement with banners cannot be deleted', (await errorOf(o.conn.reducers.adminDeletePlacement({ id: spon }))).includes('IN_USE'));
  const auB = await o.conn.procedures.adminAudit({ action: 'sponsor.', page: 1, pageSize: 50 });
  check('sponsor changes audited', auB.rows.some(r => r.action === 'sponsor.create'));
  const auC = await o.conn.procedures.adminAudit({ action: 'promo_settings.', page: 1, pageSize: 50 });
  check('settings and clock changes audited', auC.rows.some(r => r.action === 'promo_settings.clock') && auC.rows.some(r => r.action === 'promo_settings.save'));

  await clock(0);
  check('promo clock back at zero', rows(o.conn.db.adminPromoSettings.iter())[0]?.clockOffsetSec === 0n);
  void s2;
  done('promo');
}

main().catch(async e => {
  console.error('ERROR', e);
  try {
    await clock(0);
    await settings({});
  } catch {}
  process.exit(1);
});
