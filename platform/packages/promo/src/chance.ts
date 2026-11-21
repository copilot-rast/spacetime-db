import { t } from 'spacetimedb/server';
import { Translations, audit, cleanKey, fail, requireAccount, requireRole } from '@stg/base';
import { addMeta, balanceOf, changeBalance, currencyUseChecks, grantPrize, metaUseChecks, metaValue, pickFromGroup, prizeGroupUseChecks, prizeUseChecks, type Reward } from '@stg/economy';
import { recordEvent } from '@stg/gamification';
import { invRow, itemUseChecks, takeItem } from '@stg/items';
import { ChanceSlot, TicketPrice, promoRows, promoTables, type PromoSchema } from './schema';
import { DAY_US, TEHRAN_US, base, checkRate, cleanRequestId, dayOf, deserialize, econ, hmacInt, nowUs, page, promoSettings, requestReplay, requestSave, serialize, tehranDayNumber, tr, type GameRow, type PProc, type PTx } from './engine';

export const KINDS = ['wheel', 'loot_box', 'slot'];
export const PRIZE_TYPES = ['prize', 'prizeGroup'];
export const FREE_PERIODS = ['day', 'week'];
export const PRICE_TYPES = ['currency', 'meta', 'item'];
export const CHANCE_STATUS: Record<string, number> = {
  SUCCESS: 200,
  INTERVAL_TIME_IS_NULL: 400,
  TICKET_PLAY_IS_NOT_SUPPORT: 400,
  TOTAL_CHANCE_MUST_BE_100: 400,
  WAITING_FOR_TURN: 403,
  FREE_PLAYS_USED: 403,
  DAILY_LIMIT_REACHED: 403,
  TOTAL_LIMIT_REACHED: 403,
  CHANCE_GAME_NOT_FOUND: 404,
  CURRENCY_IS_NOT_ENOUGH: 409,
  META_IS_NOT_ENOUGH: 409,
  ITEM_IS_NOT_ENOUGH: 409,
};

const UNITS = 1_000_000;
const MIN_US = 60_000_000n;

const RewardLine = t.object('ChanceReward', { type: t.string(), key: t.string(), action: t.string(), value: t.f64(), prizeKey: t.string() });
const PlayResult = t.object('ChancePlayResult', {
  code: t.string(),
  status: t.u16(),
  playId: t.u64(),
  gameId: t.u64(),
  gameKey: t.string(),
  mode: t.string(),
  slot: t.i32(),
  roll: t.f64(),
  won: t.bool(),
  prizeId: t.u64(),
  prizeGroupId: t.u64(),
  alreadyOwned: t.bool(),
  rewards: t.array(RewardLine),
  spent: t.option(TicketPrice),
  nextPlayTime: t.u64(),
  nextPlayAt: t.u64(),
  replayed: t.bool(),
});
const Turn = t.object('ChanceTurn', { code: t.string(), status: t.u16(), canPlay: t.bool(), nextPlayTime: t.u64(), nextPlayAt: t.u64() });
const GameLine = t.object('ChanceGameLine', {
  game: promoTables.chanceGame.rowType,
  plays: t.u64(),
  todayPlays: t.u32(),
  hasFreeTurn: t.bool(),
  canPlay: t.bool(),
  nextPlayTime: t.u64(),
  nextPlayAt: t.u64(),
  freeLeft: t.i32(),
  lastPlayAt: t.u64(),
});
const PlayEntry = t.row('ChancePlayEntry', {
  id: t.u64().primaryKey(),
  gameId: t.u64(),
  gameKey: t.string(),
  mode: t.string(),
  status: t.string(),
  roll: t.u32(),
  slot: t.i32(),
  prizeId: t.u64(),
  prizeGroupId: t.u64(),
  spent: t.string(),
  rewards: t.string(),
  error: t.string(),
  at: t.timestamp(),
});
const PlayPage = t.object('ChancePlayPage', { total: t.u32(), rows: t.array(promoRows.chancePlay) });

type Price = { type: string; key: string; amount: bigint };
type Out = {
  code: string;
  status: number;
  playId: bigint;
  gameId: bigint;
  gameKey: string;
  mode: string;
  slot: number;
  roll: number;
  won: boolean;
  prizeId: bigint;
  prizeGroupId: bigint;
  alreadyOwned: boolean;
  rewards: Reward[];
  spent: Price | undefined;
  nextPlayTime: bigint;
  nextPlayAt: bigint;
  replayed: boolean;
};

function units(chance: number) {
  return Math.round(chance * 10000);
}

function weekStartDay(n: number, weekStart: number) {
  const dow = (n + 4) % 7;
  return n - ((dow - weekStart + 7) % 7);
}

function freeWindow(ctx: PTx, game: GameRow, now: bigint) {
  const n = tehranDayNumber(now);
  if (game.freePeriod === 'week') {
    const ws = ctx.db.gamSettings.id.find(0)?.weekStart ?? 6;
    const start = weekStartDay(n, ws);
    return { key: `w${start}`, endsAt: BigInt(start + 7) * DAY_US - TEHRAN_US };
  }
  return { key: `d${n}`, endsAt: BigInt(n + 1) * DAY_US - TEHRAN_US };
}

function stateOf(ctx: PTx, gameId: bigint, accountId: bigint) {
  const key = `${gameId}|${accountId}`;
  return ctx.db.chanceState.key.find(key) ?? { key, gameId, accountId, plays: 0n, lastFreeAt: 0n, lastPlayAt: 0n, day: '', dayPlays: 0, freeWindow: '', freeWindowPlays: 0 };
}

function secondsUntil(at: bigint, now: bigint) {
  return at > now ? (at - now + 999_999n) / 1_000_000n : 0n;
}

function turnOf(ctx: PTx, game: GameRow, accountId: bigint, now: bigint) {
  const s = stateOf(ctx, game.id, accountId);
  const today = dayOf(now);
  const todayPlays = s.day === today ? s.dayPlays : 0;
  let waitUntil = 0n;
  let reason = '';
  if (game.intervalTime && s.lastFreeAt) {
    const at = s.lastFreeAt + BigInt(game.intervalTime) * MIN_US;
    if (at > now) {
      waitUntil = at;
      reason = 'WAITING_FOR_TURN';
    }
  }
  const w = freeWindow(ctx, game, now);
  const used = s.freeWindow === w.key ? s.freeWindowPlays : 0;
  const freeLeft = game.freePlays ? Math.max(game.freePlays - used, 0) : -1;
  if (game.freePlays && used >= game.freePlays && w.endsAt > waitUntil) {
    waitUntil = w.endsAt;
    reason = 'FREE_PLAYS_USED';
  }
  if (game.dailyLimit && todayPlays >= game.dailyLimit) {
    const end = BigInt(tehranDayNumber(now) + 1) * DAY_US - TEHRAN_US;
    if (end > waitUntil) waitUntil = end;
    reason = reason || 'DAILY_LIMIT_REACHED';
  }
  const totalDone = !!game.totalLimit && s.plays >= BigInt(game.totalLimit);
  if (totalDone) reason = 'TOTAL_LIMIT_REACHED';
  return { state: s, todayPlays, freeLeft, reason, waitUntil, nextPlayTime: secondsUntil(waitUntil, now), canPlay: !!game.intervalTime && !reason, window: w };
}

function findGame(ctx: PTx, key: string) {
  const k = key.trim().toLowerCase();
  const g = ctx.db.chanceGame.key.find(k) ?? (/^\d+$/.test(k) ? ctx.db.chanceGame.id.find(BigInt(k)) : undefined);
  if (!g || !g.isActive) fail('CHANCE_GAME_NOT_FOUND');
  return g;
}

function spend(ctx: PTx, accountId: bigint, price: Price, game: GameRow, playKey: string) {
  if (price.type === 'currency') {
    const balance = balanceOf(econ(ctx), accountId, price.key);
    if (balance < price.amount) fail(`CURRENCY_IS_NOT_ENOUGH:${price.amount}:${balance}`);
    changeBalance(econ(ctx), accountId, price.key, -price.amount, `chance:${game.key}`, 'chance_ticket', playKey);
  } else if (price.type === 'meta') {
    const v = metaValue(econ(ctx), accountId, price.key);
    if (v < Number(price.amount)) fail(`META_IS_NOT_ENOUGH:${price.amount}:${v}`);
    addMeta(econ(ctx), accountId, price.key, -Number(price.amount));
  } else {
    const it = ctx.db.item.key.find(price.key);
    if (!it) fail('ITEM_NOT_FOUND');
    const have = invRow(ctx as never, accountId, it.id)?.quantity ?? 0;
    if (have < Number(price.amount)) fail(`ITEM_IS_NOT_ENOUGH:${price.amount}:${have}`);
    takeItem(ctx as never, accountId, it, Number(price.amount));
  }
}

function pick(game: GameRow, roll: number) {
  let acc = 0;
  for (let i = 0; i < game.prize.length; i++) {
    acc += units(game.prize[i].chance);
    if (roll < acc) return i;
  }
  return game.prize.length - 1;
}

function resultOf(o: Out) {
  return { ...o, rewards: o.rewards.map(r => ({ ...r, value: Number(r.value) })) };
}

function play(ctx: PProc, rawKey: string, mode: 'free' | 'ticket', rawRequestId: string) {
  let failed: { gameId: bigint; gameKey: string; accountId: bigint; requestId: string; roll: number; slot: number; prizeId: bigint; prizeGroupId: bigint; spent: string } | undefined;
  try {
    return ctx.withTx(tx => {
      failed = undefined;
      const me = requireAccount(base(tx));
      const rid = cleanRequestId(rawRequestId);
      const game = findGame(tx, rawKey);
      const detail = `${game.id}|${mode}`;
      const replay = requestReplay(tx, me.id, rid, 'chance_play', detail);
      if (replay) return resultOf({ ...deserialize<Out>(replay), replayed: true });
      checkRate(tx, me.id, 'play', promoSettings(tx).playPerMinute);
      const now = nowUs(tx);
      if (mode === 'free' && !game.intervalTime) fail('INTERVAL_TIME_IS_NULL');
      if (mode === 'ticket' && !game.price) fail('TICKET_PLAY_IS_NOT_SUPPORT');
      const turn = turnOf(tx, game, me.id, now);
      const s = turn.state;
      if (game.totalLimit && s.plays >= BigInt(game.totalLimit)) fail('TOTAL_LIMIT_REACHED');
      if (game.dailyLimit && turn.todayPlays >= game.dailyLimit) fail(`DAILY_LIMIT_REACHED:${secondsUntil(BigInt(tehranDayNumber(now) + 1) * DAY_US - TEHRAN_US, now)}`);
      if (mode === 'free') {
        if (game.intervalTime && s.lastFreeAt) {
          const at = s.lastFreeAt + BigInt(game.intervalTime) * MIN_US;
          if (at > now) fail(`WAITING_FOR_TURN:${secondsUntil(at, now)}`);
        }
        const used = s.freeWindow === turn.window.key ? s.freeWindowPlays : 0;
        if (game.freePlays && used >= game.freePlays) fail(`FREE_PLAYS_USED:${secondsUntil(turn.window.endsAt, now)}`);
      }
      const playKey = `${me.id}|${game.id}|${s.plays}|${rid}`;
      const price = mode === 'ticket' ? (game.price as Price) : undefined;
      if (price) spend(tx, me.id, price, game, playKey);
      const roll = hmacInt(tx, `chance|${playKey}`, UNITS);
      const slot = pick(game, roll);
      const row = game.prize[slot];
      const playRow = tx.db.chancePlay.insert({
        id: 0n,
        gameId: game.id,
        gameKey: game.key,
        accountId: me.id,
        mode,
        status: 'done',
        requestId: rid,
        roll,
        slot,
        prizeId: 0n,
        prizeGroupId: row?.prizeGroupId ?? 0n,
        spent: price ? serialize(price) : '',
        rewards: '[]',
        error: '',
        at: tx.timestamp,
      });
      let prizeId = game.prizeType === 'prizeGroup' ? (row?.prizeGroupId ? pickFromGroup(econ(tx), row.prizeGroupId, `chance|${playRow.id}`) : 0n) : row?.prizeId ?? 0n;
      let alreadyOwned = false;
      failed = { gameId: game.id, gameKey: game.key, accountId: me.id, requestId: rid, roll, slot, prizeId, prizeGroupId: playRow.prizeGroupId, spent: playRow.spent };
      let rewards: Reward[] = [];
      if (prizeId) {
        const p = tx.db.prize.id.find(prizeId);
        if (p && !p.isRepeatable && [...tx.db.userPrize.accountId.filter(me.id)].some(u => u.prizeId === prizeId)) {
          alreadyOwned = true;
          prizeId = 0n;
        } else rewards = grantPrize(econ(tx), me.id, prizeId, 'chance', String(playRow.id));
      }
      tx.db.chancePlay.id.update({ ...playRow, prizeId, rewards: JSON.stringify(rewards), error: alreadyOwned ? 'ALREADY_OWNED' : '' });
      const today = dayOf(now);
      const next = {
        ...s,
        plays: s.plays + 1n,
        lastPlayAt: now,
        lastFreeAt: mode === 'free' ? now : s.lastFreeAt,
        day: today,
        dayPlays: (s.day === today ? s.dayPlays : 0) + 1,
        freeWindow: mode === 'free' ? turn.window.key : s.freeWindow,
        freeWindowPlays: mode === 'free' ? (s.freeWindow === turn.window.key ? s.freeWindowPlays : 0) + 1 : s.freeWindowPlays,
      };
      if (tx.db.chanceState.key.find(s.key)) tx.db.chanceState.key.update(next);
      else tx.db.chanceState.insert(next);
      recordEvent(tx, me.id, 'chance_played', 1, JSON.stringify({ entityId: String(game.id), mode, playId: String(playRow.id) }), 'server');
      const after = turnOf(tx, game, me.id, now);
      const out: Out = {
        code: 'SUCCESS',
        status: 200,
        playId: playRow.id,
        gameId: game.id,
        gameKey: game.key,
        mode,
        slot,
        roll: roll / 10000,
        won: !!prizeId,
        prizeId,
        prizeGroupId: playRow.prizeGroupId,
        alreadyOwned,
        rewards,
        spent: price,
        nextPlayTime: game.intervalTime ? after.nextPlayTime : 0n,
        nextPlayAt: game.intervalTime ? after.waitUntil : 0n,
        replayed: false,
      };
      requestSave(tx, me.id, rid, 'chance_play', detail, serialize(out));
      return resultOf(out);
    });
  } catch (e) {
    const f = failed;
    if (f) {
      const error = String((e as Error)?.message ?? e).slice(0, 200);
      ctx.withTx(tx => {
        tx.db.chancePlay.insert({ id: 0n, gameId: f.gameId, gameKey: f.gameKey, accountId: f.accountId, mode, status: 'failed', requestId: f.requestId, roll: f.roll, slot: f.slot, prizeId: f.prizeId, prizeGroupId: f.prizeGroupId, spent: '', rewards: '[]', error, at: tx.timestamp });
      });
    }
    throw e;
  }
}

function gameUses(ctx: PTx, test: (g: GameRow) => boolean) {
  return [...ctx.db.chanceGame.iter()].some(test);
}

export function defineChance(st: PromoSchema) {
  prizeUseChecks.push((ctx, id) => gameUses(ctx as unknown as PTx, g => g.prize.some(p => p.prizeId === id)));
  prizeGroupUseChecks.push((ctx, id) => gameUses(ctx as unknown as PTx, g => g.prize.some(p => p.prizeGroupId === id)) || [...(ctx as unknown as PTx).db.chancePlay.iter()].some(p => p.prizeGroupId === id));
  currencyUseChecks.push((ctx, key) => gameUses(ctx as unknown as PTx, g => g.price?.type === 'currency' && g.price.key === key));
  metaUseChecks.push((ctx, key) => gameUses(ctx as unknown as PTx, g => g.price?.type === 'meta' && g.price.key === key));
  itemUseChecks.push((ctx, key) => gameUses(ctx as unknown as PTx, g => g.price?.type === 'item' && g.price.key === key));

  const myChancePlays = st.view({ name: 'my_chance_plays', public: true }, t.array(PlayEntry), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return [];
    return [...ctx.db.chancePlay.accountId.filter(s.accountId)].map(p => ({ id: p.id, gameId: p.gameId, gameKey: p.gameKey, mode: p.mode, status: p.status, roll: p.roll, slot: p.slot, prizeId: p.prizeId, prizeGroupId: p.prizeGroupId, spent: p.spent, rewards: p.rewards, error: p.error, at: p.at }));
  });

  const adminSaveChanceGame = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      kind: t.string(),
      name: Translations,
      description: Translations,
      metadata: t.string(),
      prizeType: t.string(),
      prize: t.array(ChanceSlot),
      intervalTime: t.u32(),
      freePlays: t.u32(),
      freePeriod: t.string(),
      price: t.option(TicketPrice),
      dailyLimit: t.u32(),
      totalLimit: t.u32(),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.chanceGame.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_IMMUTABLE');
      const same = ctx.db.chanceGame.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (!KINDS.includes(a.kind)) fail('INVALID_KIND');
      if (!PRIZE_TYPES.includes(a.prizeType)) fail('INVALID_PRIZE_TYPE');
      if (!a.prize.length) fail('PRIZE_LIST_REQUIRED');
      if (a.prize.length > 50) fail('TOO_MANY_PRIZES');
      let total = 0;
      const prize = a.prize.map((p, i) => {
        if (!Number.isFinite(p.chance) || p.chance < 0 || p.chance > 100 || Math.abs(p.chance * 10000 - units(p.chance)) > 1e-6) fail(`INVALID_PRIZE_CHANCE:${i}`);
        total += units(p.chance);
        if (a.prizeType === 'prize' && p.prizeGroupId) fail(`PRIZE_TYPE_MISMATCH:${i}`);
        if (a.prizeType === 'prizeGroup' && p.prizeId) fail(`PRIZE_TYPE_MISMATCH:${i}`);
        if (p.prizeId && !ctx.db.prize.id.find(p.prizeId)) fail(`PRIZE_NOT_FOUND:${i}`);
        if (p.prizeGroupId) {
          const g = ctx.db.prizeGroup.id.find(p.prizeGroupId);
          if (!g) fail(`PRIZE_GROUP_NOT_FOUND:${i}`);
          if (!g.entries.some(e => e.weight > 0)) fail(`PRIZE_GROUP_EMPTY:${i}`);
        }
        return { chance: units(p.chance) / 10000, prizeId: p.prizeId, prizeGroupId: p.prizeGroupId };
      });
      if (total !== UNITS) fail(`TOTAL_CHANCE_MUST_BE_100:${total / 10000}`);
      if (a.intervalTime > 525_600) fail('INVALID_INTERVAL_TIME');
      let price: Price | undefined;
      if (a.price) {
        const type = a.price.type.trim();
        const pk = a.price.key.trim();
        if (!PRICE_TYPES.includes(type) || !pk) fail('INVALID_PRICE_PAYLOAD');
        if (a.price.amount < 1n || a.price.amount > 1_000_000_000n) fail('INVALID_PRICE_AMOUNT');
        if (type === 'currency' && !ctx.db.currency.key.find(pk)) fail('CURRENCY_NOT_FOUND');
        if (type === 'meta' && !ctx.db.meta.key.find(pk)) fail('META_NOT_FOUND');
        if (type === 'item') {
          const it = ctx.db.item.key.find(pk);
          if (!it) fail('ITEM_NOT_FOUND');
          if (!it.stackable && a.price.amount !== 1n) fail('INVALID_PRICE_AMOUNT');
        }
        price = { type, key: pk, amount: a.price.amount };
      }
      if (!a.intervalTime && !price) fail('INTERVAL_OR_PRICE_REQUIRED');
      if (a.freePlays && !a.intervalTime) fail('INTERVAL_TIME_IS_NULL');
      if (a.freePlays > 1000) fail('INVALID_FREE_PLAYS');
      const freePeriod = a.freePeriod || 'day';
      if (!FREE_PERIODS.includes(freePeriod)) fail('INVALID_FREE_PERIOD');
      if (a.totalLimit && a.dailyLimit > a.totalLimit) fail('INVALID_LIMITS');
      if (a.metadata.length > 4000) fail('METADATA_TOO_LARGE');
      if (a.metadata) {
        let m: unknown;
        try {
          m = JSON.parse(a.metadata);
        } catch {
          fail('INVALID_METADATA');
        }
        if (typeof m !== 'object' || m === null || Array.isArray(m)) fail('INVALID_METADATA');
      }
      const row = {
        id: a.id,
        key,
        kind: a.kind,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        metadata: a.metadata,
        prizeType: a.prizeType,
        prize,
        intervalTime: a.intervalTime,
        freePlays: a.freePlays,
        freePeriod,
        price,
        dailyLimit: a.dailyLimit,
        totalLimit: a.totalLimit,
        isActive: a.isActive,
        sort: a.sort,
        createdAt: old?.createdAt ?? ctx.timestamp,
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.chanceGame.id.update(row) : ctx.db.chanceGame.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'chance_game.update' : 'chance_game.create', String(saved.id), key);
    }
  );

  const adminDeleteChanceGame = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const g = ctx.db.chanceGame.id.find(id);
    if (!g) fail('NOT_FOUND');
    if ([...ctx.db.chancePlay.gameId.filter(id)].length) fail('IN_USE');
    for (const s of [...ctx.db.chanceState.gameId.filter(id)]) ctx.db.chanceState.key.delete(s.key);
    ctx.db.chanceGame.id.delete(id);
    audit(base(ctx), me.id, 'chance_game.delete', String(id), g.key);
  });

  const adminChancePlays = st.procedure({ gameId: t.u64(), accountId: t.u64(), status: t.string(), page: t.u32(), pageSize: t.u32() }, PlayPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const src = a.accountId ? [...tx.db.chancePlay.accountId.filter(a.accountId)] : a.gameId ? [...tx.db.chancePlay.gameId.filter(a.gameId)] : [...tx.db.chancePlay.iter()];
      const list = src.filter(p => (!a.gameId || p.gameId === a.gameId) && (!a.status || p.status === a.status)).sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const chanceGames = st.procedure(t.array(GameLine), ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const now = nowUs(tx);
      return [...tx.db.chanceGame.iter()]
        .filter(g => g.isActive)
        .sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1))
        .map(game => {
          const tn = turnOf(tx, game, me.id, now);
          return { game, plays: tn.state.plays, todayPlays: tn.todayPlays, hasFreeTurn: !!game.intervalTime, canPlay: tn.canPlay, nextPlayTime: tn.nextPlayTime, nextPlayAt: tn.waitUntil, freeLeft: tn.freeLeft, lastPlayAt: tn.state.lastPlayAt };
        });
    })
  );

  const chanceCanPlay = st.procedure({ key: t.string() }, Turn, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const game = findGame(tx, a.key);
      if (!game.intervalTime) fail('INTERVAL_TIME_IS_NULL');
      const tn = turnOf(tx, game, me.id, nowUs(tx));
      return { code: 'SUCCESS', status: 200, canPlay: tn.canPlay, nextPlayTime: tn.nextPlayTime, nextPlayAt: tn.waitUntil };
    })
  );

  const chanceNextPlayTime = st.procedure({ key: t.string() }, Turn, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const game = findGame(tx, a.key);
      if (!game.intervalTime) fail('INTERVAL_TIME_IS_NULL');
      const tn = turnOf(tx, game, me.id, nowUs(tx));
      return { code: 'SUCCESS', status: 200, canPlay: tn.canPlay, nextPlayTime: tn.nextPlayTime, nextPlayAt: tn.waitUntil };
    })
  );

  const chancePlay = st.procedure({ key: t.string(), requestId: t.string() }, PlayResult, (ctx, a) => play(ctx as PProc, a.key, 'free', a.requestId));

  const chancePlayWithTicket = st.procedure({ key: t.string(), requestId: t.string() }, PlayResult, (ctx, a) => play(ctx as PProc, a.key, 'ticket', a.requestId));

  return {
    myChancePlays,
    adminSaveChanceGame,
    adminDeleteChanceGame,
    adminChancePlays,
    chanceGames,
    chanceCanPlay,
    chanceNextPlayTime,
    chancePlay,
    chancePlayWithTicket,
  };
}

