import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, cleanKey, cleanTranslations, fail, requireAccount, requireRole, translate, type Tr } from '@stg/base';
import { PLATFORMS, parseVersion, compareVersions } from '@stg/players';
import { changeBalance, currencyUseChecks, metaUseChecks, prizeGroupUseChecks, prizeUseChecks } from '@stg/economy';
import { playerLevel } from '@stg/gamification';
import { itemUseChecks } from '@stg/items';
import { MatchResult, MinVersion, Requirements, gamesRows, gamesTables, type GamesSchema } from './schema';
import {
  PATHS,
  OPERATORS,
  SEC,
  activity,
  base,
  cancelMatch,
  cleanSettings,
  consumeTickets,
  defaultsOf,
  emptyReq,
  entryCheck,
  finishMatch,
  formMatch,
  gameRegistry,
  gamesSettings,
  hmacInt,
  isEmptyReq,
  matchRoom,
  metaHave,
  nowUs,
  page,
  refundTicket,
  rollover,
  runPayouts,
  startMatchRow,
  type GDb,
  type GProc,
  type GTx,
  type GameRow,
  type Missing,
  type Offer,
  type Req,
  type RoomRow,
} from './engine';

const MissingRow = t.object('GameMissing', {
  type: t.string(),
  mode: t.string(),
  keys: t.array(t.string()),
  key: t.string(),
  operator: t.string(),
  value: t.f64(),
  have: t.f64(),
  consume: t.f64(),
  minLevel: t.u32(),
  level: t.u32(),
});
const OfferRow = t.object('GameOffer', { productId: t.u64(), key: t.string(), satisfies: t.array(t.string()) });
const PathState = t.object('GamePathState', { path: t.string(), available: t.bool(), eligible: t.bool(), missing: t.array(MissingRow), products: t.array(OfferRow) });
const RoomEntry = t.object('GameRoomEntry', {
  roomId: t.u64(),
  key: t.string(),
  name: Translations,
  entryCurrency: t.string(),
  entryFee: t.i64(),
  prizeId: t.u64(),
  prizeGroupId: t.u64(),
  minLevel: t.u32(),
  levelLocked: t.bool(),
  isLocked: t.bool(),
  inheritsGame: t.bool(),
  requirements: Requirements,
  consumes: t.bool(),
  eligible: t.bool(),
  paths: t.array(PathState),
  message: Translations,
  sort: t.i32(),
});
const GameEntry = t.row('GameListEntry', {
  id: t.u64().primaryKey(),
  key: t.string(),
  name: Translations,
  description: Translations,
  iconUrl: t.string(),
  realtime: t.bool(),
  maintenance: t.bool(),
  maintenanceMessage: Translations,
  sort: t.i32(),
  categoryId: t.u64(),
  tagIds: t.array(t.u64()),
  minPlayers: t.u8(),
  maxPlayers: t.u8(),
  turnSeconds: t.u32(),
  matchSeconds: t.u32(),
  botsAllowed: t.bool(),
  friendAllowed: t.bool(),
  platforms: t.array(t.string()),
  minVersions: t.array(MinVersion),
  settings: t.string(),
  requirements: Requirements,
  eligible: t.bool(),
  paths: t.array(PathState),
  rooms: t.array(RoomEntry),
});
const TicketLine = t.row('GameTicketLine', {
  id: t.u64().primaryKey(),
  gameKey: t.string(),
  roomKey: t.string(),
  path: t.string(),
  code: t.string(),
  host: t.bool(),
  status: t.string(),
  matchId: t.u64(),
  feeCurrency: t.string(),
  fee: t.i64(),
  createdAt: t.u64(),
});
const MatchPlayer = t.object('GameMatchPlayer', { name: t.string(), me: t.bool(), ready: t.bool(), left: t.bool(), rank: t.u32(), score: t.f64(), outcome: t.string() });
const MatchLine = t.row('GameMatchLine', {
  id: t.u64().primaryKey(),
  gameKey: t.string(),
  roomKey: t.string(),
  path: t.string(),
  state: t.string(),
  bots: t.u8(),
  players: t.array(MatchPlayer),
  myRank: t.u32(),
  myOutcome: t.string(),
  reason: t.string(),
  createdAt: t.u64(),
  startedAt: t.u64(),
  endedAt: t.u64(),
});
const JoinResult = t.object('GameJoinResult', {
  ticketId: t.u64(),
  matchId: t.u64(),
  status: t.string(),
  existing: t.bool(),
  code: t.string(),
  feeCurrency: t.string(),
  fee: t.i64(),
  consumedItems: t.array(t.string()),
  consumedMetas: t.array(t.string()),
});
const CheckResult = t.object('GameCheckResult', { eligible: t.bool(), error: t.string(), missing: t.array(MissingRow), products: t.array(OfferRow), message: t.string() });
const MatchPage = t.object('GameMatchPage', { total: t.u32(), rows: t.array(gamesRows.match) });
const MatchDetail = t.object('GameMatchDetail', { match: gamesRows.match, tickets: t.array(gamesRows.ticket), payouts: t.array(gamesRows.payout) });
const PayoutPage = t.object('GamePayoutPage', { total: t.u32(), rows: t.array(gamesRows.payout) });
const PlayerGames = t.object('GamePlayerHistory', { tickets: t.array(gamesRows.ticket), payouts: t.array(gamesRows.payout) });
const RunResult = t.object('GamesRunResult', { matches: t.u32(), expired: t.u32(), cancelled: t.u32(), boards: t.u32(), paid: t.u32() });

type Db = { db: GTx['db']; sender: GTx['sender'] };

function tr(ctx: GTx, list: unknown, required = true) {
  return cleanTranslations(list as Tr[], base(ctx), required);
}

function cleanUrl(s: string) {
  const v = s.trim();
  if (v && !/^(https?:\/\/|\/)/.test(v)) fail('INVALID_URL');
  return v.slice(0, 500);
}

function sessionAccount(ctx: Db) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  return a && a.status === 'active' ? a : undefined;
}

function langOf(ctx: GDb, accountId: bigint) {
  const def = ctx.db.settings.id.find(0)?.defaultLang ?? 'fa';
  return { lang: ctx.db.account.id.find(accountId)?.lang ?? def, def };
}

export function cleanReq(ctx: GTx, r: Req, field: string): Req {
  const bad = (code: string) => fail(`${code}:${field}`);
  if (r.itemKeys.length > 20 || r.tagIds.length > 20 || r.excludeTagIds.length > 20 || r.metas.length > 10 || r.productIds.length > 10) bad('TOO_MANY_REQUIREMENTS');
  const itemKeys = [...new Set(r.itemKeys.map(k => k.trim().toLowerCase()).filter(Boolean))];
  for (const k of itemKeys) {
    const it = ctx.db.item.key.find(k);
    if (!it) bad('ITEM_NOT_FOUND');
    if (r.consumeItems && it!.isStarter) bad('STARTER_TICKET');
  }
  const itemsMode = r.itemsMode || 'any';
  const tagsMode = r.tagsMode || 'any';
  if (!['any', 'all'].includes(itemsMode) || !['any', 'all'].includes(tagsMode)) bad('INVALID_REQUIREMENT');
  const tagIds = [...new Set(r.tagIds)];
  const excludeTagIds = [...new Set(r.excludeTagIds)];
  for (const id of [...tagIds, ...excludeTagIds]) {
    const tag = ctx.db.tag.id.find(id);
    if (!tag) bad('TAG_NOT_FOUND');
    if (tag!.keyType !== 'user') bad('TAG_KIND_MISMATCH');
  }
  if (tagIds.some(id => excludeTagIds.includes(id))) bad('TAG_BOTH_WAYS');
  const metas = r.metas.map(m => {
    const metaKey = m.metaKey.trim();
    if (!ctx.db.meta.key.find(metaKey)) bad('META_NOT_FOUND');
    if (!OPERATORS.includes(m.operator)) bad('INVALID_OPERATOR');
    if (!Number.isFinite(m.value)) bad('INVALID_VALUE');
    if (!Number.isFinite(m.consume) || m.consume < 0) bad('INVALID_CONSUME');
    return { metaKey, operator: m.operator, value: m.value, consume: m.consume };
  });
  const productIds = [...new Set(r.productIds)];
  for (const id of productIds) if (!ctx.db.product.id.find(id)) bad('PRODUCT_NOT_FOUND');
  let paths = [...new Set(r.paths.map(p => p.trim()))];
  for (const p of paths) if (!PATHS.includes(p)) bad('INVALID_PATH');
  if (paths.length === PATHS.length) paths = [];
  const refund = r.refund || 'return';
  const lock = r.lock || 'show';
  if (!['return', 'keep'].includes(refund) || !['show', 'hide'].includes(lock)) bad('INVALID_REQUIREMENT');
  if (r.minLevel > 10_000) bad('INVALID_LEVEL');
  const out = { itemKeys, itemsMode, consumeItems: r.consumeItems && itemKeys.length > 0, tagIds, tagsMode, excludeTagIds, minLevel: r.minLevel, metas, productIds, paths, refund, lock, message: tr(ctx, r.message, false) };
  return isEmptyReq(out) ? { ...emptyReq(), message: out.message, productIds: out.productIds } : out;
}

function pathAvailable(game: GameRow, path: string) {
  return path === 'matchmaking' || (path === 'bot' && game.botsAllowed) || (path === 'friend' && game.friendAllowed);
}

function toMissing(m: Missing) {
  return { ...m, minLevel: m.minLevel, level: m.level };
}

function pathStates(ctx: GDb, accountId: bigint | undefined, game: GameRow, room: RoomRow | undefined) {
  let hidden = true;
  let anyHide = false;
  const paths = PATHS.map(path => {
    const available = pathAvailable(game, path);
    if (accountId === undefined) return { path, available, eligible: false, missing: [] as Missing[], products: [] as Offer[] };
    const c = entryCheck(ctx, accountId, game, room, path);
    const eligible = available && c.missing.length === 0;
    if (available && (eligible || !c.hide)) hidden = false;
    if (c.hide) anyHide = true;
    return { path, available, eligible, missing: c.missing.map(toMissing), products: c.products };
  });
  return { paths, hidden: anyHide && hidden };
}

function listFor(ctx: GDb, accountId: bigint | undefined) {
  const games = [...ctx.db.game.iter()].filter(g => g.isActive && g.registered).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const level = accountId === undefined ? 0 : playerLevel(ctx, accountId);
  const out = [];
  for (const g of games) {
    const gs = pathStates(ctx, accountId, g, undefined);
    if (gs.hidden) continue;
    const rooms = [];
    const roomRows = [...ctx.db.gameRoom.gameId.filter(g.id)].filter(r => r.isActive && !r.isHidden).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
    for (const r of roomRows) {
      const rs = pathStates(ctx, accountId, g, r);
      if (rs.hidden) continue;
      const levelLocked = !!r.minLevel && level < r.minLevel;
      const c = accountId === undefined ? undefined : entryCheck(ctx, accountId, g, r, 'matchmaking');
      rooms.push({
        roomId: r.id,
        key: r.key,
        name: r.name,
        entryCurrency: r.entryCurrency,
        entryFee: r.entryFee,
        prizeId: r.prizeId,
        prizeGroupId: r.prizeGroupId,
        minLevel: r.minLevel,
        levelLocked,
        isLocked: r.isLocked,
        inheritsGame: r.inheritGame,
        requirements: r.requirements,
        consumes: c?.consumes ?? false,
        eligible: !r.isLocked && !levelLocked && !g.maintenance && rs.paths.some(p => p.eligible),
        paths: rs.paths,
        message: c?.message ?? r.requirements.message,
        sort: r.sort,
      });
    }
    if (roomRows.length && !rooms.length) continue;
    let settings = g.settings;
    if (!settings) settings = JSON.stringify(defaultsOf(g.settingsSchema));
    out.push({
      id: g.id,
      key: g.key,
      name: g.name,
      description: g.description,
      iconUrl: g.iconUrl,
      realtime: g.realtime,
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
      friendAllowed: g.friendAllowed,
      platforms: g.platforms,
      minVersions: g.minVersions,
      settings,
      requirements: g.requirements,
      eligible: !g.maintenance && gs.paths.some(p => p.eligible),
      paths: gs.paths,
      rooms,
    });
  }
  return out;
}

function findGame(ctx: GTx, key: string) {
  const g = ctx.db.game.key.find(key.trim().toLowerCase());
  if (!g || !g.isActive || !g.registered) fail('GAME_NOT_FOUND');
  return g;
}

function findRoom(ctx: GTx, game: GameRow, key: string) {
  const k = key.trim().toLowerCase();
  const room = k
    ? [...ctx.db.gameRoom.byGameKey.filter([game.id, k])][0]
    : [...ctx.db.gameRoom.gameId.filter(game.id)].filter(r => r.isActive && !r.isHidden && !r.isLocked).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1))[0];
  if (!room || !room.isActive) fail('ROOM_NOT_FOUND');
  return room;
}

function checkClient(game: GameRow, platform: string, appVersion: string) {
  const p = platform.trim().toLowerCase();
  if (game.platforms.length && !game.platforms.includes(p)) fail('PLATFORM_NOT_SUPPORTED');
  const min = game.minVersions.find(v => v.platform === p);
  if (min) {
    const v = appVersion.trim();
    if (!v || !parseVersion(v) || compareVersions(v, min.version) < 0) fail(`APP_VERSION_TOO_OLD:${min.version}`);
  }
}

function refusal(ctx: GTx, accountId: bigint, game: GameRow, room: RoomRow | undefined, path: string) {
  const c = entryCheck(ctx, accountId, game, room, path);
  if (!c.missing.length) return c;
  const { lang, def } = langOf(ctx, accountId);
  const detail = {
    game: game.key,
    room: room?.key ?? '',
    path,
    message: translate(c.message, lang, def),
    missing: c.missing.map(m => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== '' && v !== 0 && !(Array.isArray(v) && !v.length)))),
    products: c.products.map(p => ({ productId: String(p.productId), key: p.key, satisfies: p.satisfies })),
  };
  fail(`REQUIREMENTS_NOT_MET:${JSON.stringify(detail)}`);
}

function preCheck(ctx: GTx, accountId: bigint, game: GameRow, room: RoomRow, path: string, platform: string, appVersion: string) {
  if (!PATHS.includes(path)) fail('INVALID_PATH');
  if (game.maintenance) fail('GAME_MAINTENANCE');
  checkClient(game, platform, appVersion);
  if (room.isLocked) fail('ROOM_LOCKED');
  if (path === 'bot' && !game.botsAllowed) fail('BOTS_DISABLED');
  if (path === 'friend' && !game.friendAllowed) fail('FRIEND_ROOMS_DISABLED');
  if (room.minLevel && playerLevel(ctx, accountId) < room.minLevel) fail('LEVEL_TOO_LOW');
  return refusal(ctx, accountId, game, room, path)!;
}

function activeMatchOf(ctx: GTx, accountId: bigint, gameId: bigint) {
  for (const t of ctx.db.gameTicket.accountId.filter(accountId)) {
    if (t.gameId !== gameId || t.status !== 'matched') continue;
    const m = ctx.db.gameMatch.id.find(t.matchId);
    if (m && (m.state === 'waiting' || m.state === 'playing')) return m;
  }
  return undefined;
}

function friendCode(ctx: GTx, accountId: bigint, now: bigint) {
  for (let i = 0; i < 20; i++) {
    const code = String(100000 + hmacInt(ctx, `friend|${accountId}|${now}|${i}`, 900000));
    if (![...ctx.db.gameTicket.code.filter(code)].some(t => t.status === 'waiting')) return code;
  }
  fail('CODE_UNAVAILABLE');
}

function myTicketMatch(ctx: GTx, accountId: bigint, matchId: bigint) {
  const m = ctx.db.gameMatch.id.find(matchId);
  if (!m) fail('MATCH_NOT_FOUND');
  const t = [...ctx.db.gameTicket.matchId.filter(matchId)].find(x => x.accountId === accountId);
  if (!t) fail('NOT_IN_MATCH');
  return { m, t };
}

export function authority(ctx: GTx) {
  if (ctx.sender.isEqual(ctx.identity)) return 'module';
  const s = ctx.db.gameServer.identity.find(ctx.sender);
  if (s?.isActive) return 'server';
  const a = adminOrNull(ctx as never, 'admin');
  if (a) return `admin:${a.id}`;
  fail('FORBIDDEN');
}

export function runTick(ctx: GTx, prune = false) {
  const now = nowUs(ctx);
  const s = gamesSettings(ctx);
  const out = { matches: 0, expired: 0, cancelled: 0, boards: 0 };
  const waiting = [...ctx.db.gameTicket.status.filter('waiting')];
  for (const t of waiting) {
    if (s.ticketTtlSeconds && now - t.createdAt >= BigInt(s.ticketTtlSeconds) * SEC) {
      const row = refundTicket(ctx, t, 'expired');
      ctx.db.gameTicket.id.update({ ...row, status: 'expired', updatedAt: now });
      out.expired++;
    }
  }
  const rooms = new Set([...ctx.db.gameTicket.status.filter('waiting')].map(t => t.roomId));
  for (const id of rooms) {
    const room = ctx.db.gameRoom.id.find(id);
    const game = room ? ctx.db.game.id.find(room.gameId) : undefined;
    if (!room || !game) continue;
    out.matches += matchRoom(ctx, game, room, now).length;
  }
  for (const m of [...ctx.db.gameMatch.state.filter('waiting')]) {
    if (s.startTimeoutSeconds && now - m.createdAt >= BigInt(s.startTimeoutSeconds) * SEC) {
      cancelMatch(ctx, m, 'start_timeout', true, now);
      out.cancelled++;
    }
  }
  for (const m of [...ctx.db.gameMatch.state.filter('playing')]) {
    if (s.playTimeoutSeconds && now - m.startedAt >= BigInt(s.playTimeoutSeconds) * SEC) {
      cancelMatch(ctx, m, 'play_timeout', false, now);
      out.cancelled++;
    }
  }
  for (const lb of [...ctx.db.leaderboard.iter()]) {
    if (!lb.isActive) continue;
    const after = rollover(ctx, lb, now);
    if (after.currentPeriod !== lb.currentPeriod) out.boards++;
  }
  if (s.historyDays && (prune || (ctx.timestamp.microsSinceUnixEpoch / SEC) % 300n < 2n)) {
    const cutoff = now - BigInt(s.historyDays) * 86_400n * SEC;
    let n = 0;
    for (const state of ['finished', 'cancelled']) {
      for (const m of [...ctx.db.gameMatch.state.filter(state)]) {
        if (n >= 200 || m.endedAt >= cutoff) continue;
        for (const tk of [...ctx.db.gameTicket.matchId.filter(m.id)]) ctx.db.gameTicket.id.delete(tk.id);
        ctx.db.gameMatch.id.delete(m.id);
        n++;
      }
    }
  }
  return out;
}

export function retryFailed(ctx: GProc) {
  const ids = ctx.withTx(tx => {
    const max = gamesSettings(tx).payoutMaxTries;
    const cutoff = tx.timestamp.microsSinceUnixEpoch - 30n * SEC;
    return [...tx.db.gamePayout.status.filter('failed')].filter(p => p.attempts < max && p.createdAt.microsSinceUnixEpoch < cutoff).slice(0, 20).map(p => p.id);
  });
  if (!ids.length) return 0;
  ctx.withTx(tx => {
    for (const id of ids) {
      const p = tx.db.gamePayout.id.find(id);
      if (p && p.status === 'failed') tx.db.gamePayout.id.update({ ...p, status: 'pending' });
    }
  });
  return runPayouts(ctx, ids);
}

function used(ctx: GDb, test: (r: Req) => boolean) {
  return [...ctx.db.game.iter()].some(g => test(g.requirements)) || [...ctx.db.gameRoom.iter()].some(r => test(r.requirements));
}

export function defineCatalog(st: GamesSchema) {
  itemUseChecks.push((ctx, key) => used(ctx as unknown as GDb, r => r.itemKeys.includes(key)));
  metaUseChecks.push((ctx, key) => used(ctx as unknown as GDb, r => r.metas.some(m => m.metaKey === key)) || [...(ctx as unknown as GDb).db.game.iter()].some(g => g.skillMetaKey === key));
  currencyUseChecks.push((ctx, key) => [...(ctx as unknown as GDb).db.gameRoom.iter()].some(r => r.entryCurrency === key));
  prizeUseChecks.push((ctx, id) => [...(ctx as unknown as GDb).db.gameRoom.iter()].some(r => r.prizeId === id));
  prizeGroupUseChecks.push((ctx, id) => [...(ctx as unknown as GDb).db.gameRoom.iter()].some(r => r.prizeGroupId === id));

  const gamesList = st.view({ name: 'games_list', public: true }, t.array(GameEntry), ctx => {
    try {
      const a = sessionAccount(ctx as any);
      return listFor(ctx as any, a?.id);
    } catch {
      return [];
    }
  });

  const myGameTickets = st.view({ name: 'my_game_tickets', public: true }, t.array(TicketLine), ctx => {
    try {
      const a = sessionAccount(ctx as any);
      if (!a) return [];
      return [...ctx.db.gameTicket.accountId.filter(a.id)]
        .filter(tk => tk.status === 'waiting' || (tk.status === 'matched' && ['waiting', 'playing'].includes(ctx.db.gameMatch.id.find(tk.matchId)?.state ?? '')))
        .map(tk => ({
          id: tk.id,
          gameKey: ctx.db.game.id.find(tk.gameId)?.key ?? '',
          roomKey: ctx.db.gameRoom.id.find(tk.roomId)?.key ?? '',
          path: tk.path,
          code: tk.code,
          host: tk.host,
          status: tk.status,
          matchId: tk.matchId,
          feeCurrency: tk.feeCurrency,
          fee: tk.fee,
          createdAt: tk.createdAt,
        }));
    } catch {
      return [];
    }
  });

  const myMatches = st.view({ name: 'my_matches', public: true }, t.array(MatchLine), ctx => {
    try {
      const a = sessionAccount(ctx as any);
      if (!a) return [];
      const ids = [...new Set([...ctx.db.gameTicket.accountId.filter(a.id)].filter(tk => tk.matchId).map(tk => tk.matchId))].sort((x, y) => (x < y ? 1 : -1)).slice(0, 50);
      const out = [];
      for (const id of ids) {
        const m = ctx.db.gameMatch.id.find(id);
        if (!m) continue;
        const tickets = [...ctx.db.gameTicket.matchId.filter(id)];
        const mine = tickets.find(tk => tk.accountId === a.id);
        out.push({
          id: m.id,
          gameKey: m.gameKey,
          roomKey: m.roomKey,
          path: m.path,
          state: m.state,
          bots: m.bots,
          players: tickets.map(tk => ({ name: ctx.db.account.id.find(tk.accountId)?.displayName ?? '', me: tk.accountId === a.id, ready: tk.ready, left: tk.status === 'left', rank: tk.rank, score: tk.score, outcome: tk.outcome })),
          myRank: mine?.rank ?? 0,
          myOutcome: mine?.outcome ?? '',
          reason: m.reason,
          createdAt: m.createdAt,
          startedAt: m.startedAt,
          endedAt: m.endedAt,
        });
      }
      return out;
    } catch {
      return [];
    }
  });

  const gamesCheck = st.procedure({ gameKey: t.string(), roomKey: t.string(), path: t.string(), platform: t.string(), appVersion: t.string() }, CheckResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const empty = { eligible: true, error: '', missing: [] as Missing[], products: [] as Offer[], message: '' };
      try {
        const game = findGame(tx, a.gameKey);
        const room = findRoom(tx, game, a.roomKey);
        const path = a.path.trim() || 'matchmaking';
        const c = entryCheck(tx, me.id, game, room, path);
        const { lang, def } = langOf(tx, me.id);
        if (c.missing.length) return { eligible: false, error: 'REQUIREMENTS_NOT_MET', missing: c.missing, products: c.products, message: translate(c.message, lang, def) };
        preCheck(tx, me.id, game, room, path, a.platform, a.appVersion);
        return empty;
      } catch (e) {
        return { ...empty, eligible: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
      }
    })
  );

  const gamesJoin = st.procedure({ gameKey: t.string(), roomKey: t.string(), path: t.string(), code: t.string(), platform: t.string(), appVersion: t.string() }, JoinResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const now = nowUs(tx);
      const path = a.path.trim() || 'matchmaking';
      if (!PATHS.includes(path)) fail('INVALID_PATH');
      const game = findGame(tx, a.gameKey);
      const code = a.code.trim();
      let room: RoomRow;
      let host = undefined as undefined | ReturnType<GTx['db']['gameTicket']['id']['find']>;
      if (path === 'friend' && code) {
        host = [...tx.db.gameTicket.code.filter(code)].find(x => x.status === 'waiting' && x.host && x.gameId === game.id);
        if (!host) fail('INVALID_CODE');
        room = tx.db.gameRoom.id.find(host.roomId)!;
        if (a.roomKey.trim() && a.roomKey.trim().toLowerCase() !== room.key) fail('INVALID_CODE');
      } else room = findRoom(tx, game, a.roomKey);
      const result = (tk: NonNullable<typeof host>, existing: boolean) => {
        const c = tk.consumed ? (JSON.parse(tk.consumed) as { items: { key: string }[]; metas: { key: string }[] }) : { items: [], metas: [] };
        return { ticketId: tk.id, matchId: tk.matchId, status: tk.status, existing, code: tk.code, feeCurrency: tk.feeCurrency, fee: tk.fee, consumedItems: c.items.map(i => i.key), consumedMetas: c.metas.map(m => m.key) };
      };
      const mine = [...tx.db.gameTicket.accountId.filter(me.id)];
      const same = mine.find(x => x.status === 'waiting' && x.gameId === game.id);
      if (same) {
        if (same.roomId === room.id && same.path === path && (path !== 'friend' || !code || code === same.code)) return result(same, true);
        fail('ALREADY_QUEUED');
      }
      if (activeMatchOf(tx, me.id, game.id)) fail('ALREADY_IN_MATCH');
      const s = gamesSettings(tx);
      if (s.maxTicketsPerPlayer && mine.filter(x => x.status === 'waiting').length >= s.maxTicketsPerPlayer) fail('TOO_MANY_TICKETS');
      if (host) {
        if (host.accountId === me.id) fail('OWN_ROOM');
        if ([...tx.db.gameTicket.code.filter(code)].filter(x => x.status === 'waiting').length >= game.maxPlayers) fail('ROOM_FULL');
      }
      const check = preCheck(tx, me.id, game, room, path, a.platform, a.appVersion);
      const skill = game.skillMetaKey ? metaHave(tx, me.id, game.skillMetaKey) : playerLevel(tx, me.id);
      const fee = room.entryFee > 0n ? room.entryFee : 0n;
      let tk = tx.db.gameTicket.insert({
        id: 0n,
        accountId: me.id,
        gameId: game.id,
        roomId: room.id,
        path,
        code: path === 'friend' ? (host ? code : friendCode(tx, me.id, now)) : '',
        host: path === 'friend' && !host,
        status: 'waiting',
        skill,
        matchId: 0n,
        feeCurrency: fee > 0n ? room.entryCurrency : '',
        fee,
        feeRefunded: false,
        consumed: '',
        refund: '',
        ticketsReturned: false,
        ready: false,
        rank: 0,
        score: 0,
        outcome: '',
        createdAt: now,
        updatedAt: now,
      });
      if (fee > 0n) changeBalance(tx as never, me.id, room.entryCurrency, -fee, `game:${game.key}:${room.key}`, 'game_entry', `ticket:${tk.id}`);
      const consumed = consumeTickets(tx, me.id, check.sets);
      if (consumed.items.length || consumed.metas.length) {
        const kinds = new Set([...consumed.items, ...consumed.metas].map(x => x.refund));
        tk = tx.db.gameTicket.id.update({ ...tk, consumed: JSON.stringify(consumed), refund: kinds.size > 1 ? 'mixed' : [...kinds][0] });
      }
      activity(tx, me.id, 'joined', String(tk.id), { game: game.key, room: room.key, path, fee, currency: tk.feeCurrency, tickets: consumed.items.length + consumed.metas.length });
      matchRoom(tx, game, room, now);
      return result(tx.db.gameTicket.id.find(tk.id)!, false);
    })
  );

  const gamesCancel = st.reducer({ ticketId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const tk = ctx.db.gameTicket.id.find(a.ticketId);
    if (!tk || tk.accountId !== me.id) fail('TICKET_NOT_FOUND');
    if (tk.status !== 'waiting') fail('TICKET_NOT_WAITING');
    const now = nowUs(ctx);
    const row = refundTicket(ctx, tk, 'cancelled');
    ctx.db.gameTicket.id.update({ ...row, status: 'cancelled', updatedAt: now });
    activity(ctx, me.id, 'cancelled', String(tk.id), { path: tk.path });
  });

  const gamesFriendStart = st.reducer({ code: t.string() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const list = [...ctx.db.gameTicket.code.filter(a.code.trim())].filter(x => x.status === 'waiting');
    const host = list.find(x => x.host);
    if (!host || host.accountId !== me.id) fail('NOT_HOST');
    const game = ctx.db.game.id.find(host.gameId)!;
    const room = ctx.db.gameRoom.id.find(host.roomId)!;
    if (list.length < game.minPlayers) fail('NOT_ENOUGH_PLAYERS');
    formMatch(ctx, game, room, 'friend', list.sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1)).slice(0, game.maxPlayers), 0, nowUs(ctx));
  });

  const gamesReady = st.reducer({ matchId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const { m, t: tk } = myTicketMatch(ctx, me.id, a.matchId);
    if (m.state !== 'waiting') fail(m.state === 'playing' ? 'MATCH_ALREADY_STARTED' : 'MATCH_CLOSED');
    if (tk.status === 'left') fail('LEFT_MATCH');
    if (!tk.ready) ctx.db.gameTicket.id.update({ ...tk, ready: true });
    const rest = [...ctx.db.gameTicket.matchId.filter(m.id)].filter(x => x.status !== 'left');
    if (rest.every(x => x.ready)) startMatchRow(ctx, m, nowUs(ctx));
  });

  const gamesLeave = st.reducer({ matchId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const now = nowUs(ctx);
    const { m, t: tk } = myTicketMatch(ctx, me.id, a.matchId);
    if (m.state !== 'waiting' && m.state !== 'playing') fail('MATCH_CLOSED');
    if (tk.status === 'left') fail('LEFT_MATCH');
    if (m.state === 'waiting') {
      const row = refundTicket(ctx, tk, 'left');
      ctx.db.gameTicket.id.update({ ...row, status: 'left', updatedAt: now });
      cancelMatch(ctx, ctx.db.gameMatch.id.find(m.id)!, 'player_left', true, now);
    } else {
      ctx.db.gameTicket.id.update({ ...tk, status: 'left', outcome: 'left', updatedAt: now });
      if ([...ctx.db.gameTicket.matchId.filter(m.id)].every(x => x.status === 'left')) cancelMatch(ctx, m, 'abandoned', false, now);
    }
    activity(ctx, me.id, 'left', String(m.id), { state: m.state });
  });

  const gamesStartMatch = st.reducer({ matchId: t.u64() }, (ctx, a) => {
    const by = authority(ctx);
    const m = ctx.db.gameMatch.id.find(a.matchId);
    if (!m) fail('MATCH_NOT_FOUND');
    startMatchRow(ctx, m, nowUs(ctx));
    if (by.startsWith('admin:')) audit(base(ctx), BigInt(by.slice(6)), 'game_match.start', String(m.id));
  });

  const gamesReportResult = st.reducer({ matchId: t.u64(), results: t.array(MatchResult) }, (ctx, a) => {
    const by = authority(ctx);
    finishMatch(ctx, a.matchId, a.results, by.startsWith('admin:') ? 'admin' : by);
    if (by.startsWith('admin:')) audit(base(ctx), BigInt(by.slice(6)), 'game_match.finish', String(a.matchId), JSON.stringify(a.results.map(x => ({ accountId: String(x.accountId), rank: x.rank, score: x.score }))));
  });

  const adminGamesSettings = st.view({ name: 'admin_games_settings', public: true }, t.option(gamesRows.settings), ctx => (adminOrNull(ctx as any) ? ctx.db.gamesSettings.id.find(0) ?? undefined : undefined));
  const adminGames = st.view({ name: 'admin_games', public: true }, t.array(gamesRows.game), ctx => (adminOrNull(ctx as any) ? [...ctx.db.game.iter()] : []));
  const adminGameRooms = st.view({ name: 'admin_game_rooms', public: true }, t.array(gamesRows.room), ctx => (adminOrNull(ctx as any) ? [...ctx.db.gameRoom.iter()] : []));
  const adminGameServers = st.view({ name: 'admin_game_servers', public: true }, t.array(gamesRows.server), ctx => (adminOrNull(ctx as any, 'admin') ? [...ctx.db.gameServer.iter()] : []));

  const adminSaveGamesSettings = st.reducer(
    { ticketTtlSeconds: t.u32(), startTimeoutSeconds: t.u32(), playTimeoutSeconds: t.u32(), maxTicketsPerPlayer: t.u8(), payoutMaxTries: t.u8(), weekStart: t.u8(), monthCalendar: t.string(), historyDays: t.u32() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const s = gamesSettings(ctx);
      if (a.ticketTtlSeconds > 86_400) fail('INVALID_RULE:ticketTtlSeconds');
      if (a.startTimeoutSeconds > 86_400) fail('INVALID_RULE:startTimeoutSeconds');
      if (a.playTimeoutSeconds > 7 * 86_400) fail('INVALID_RULE:playTimeoutSeconds');
      if (a.maxTicketsPerPlayer > 50) fail('INVALID_RULE:maxTicketsPerPlayer');
      if (a.payoutMaxTries < 1 || a.payoutMaxTries > 50) fail('INVALID_RULE:payoutMaxTries');
      if (a.weekStart > 6) fail('INVALID_RULE:weekStart');
      if (!['gregorian', 'jalali'].includes(a.monthCalendar)) fail('INVALID_RULE:monthCalendar');
      if (a.historyDays > 3650) fail('INVALID_RULE:historyDays');
      ctx.db.gamesSettings.id.update({ ...s, ...a, updatedAt: ctx.timestamp });
      audit(base(ctx), me.id, 'games_settings.save', 'settings', JSON.stringify(a));
    }
  );

  const adminSetGamesClockOffset = st.reducer({ seconds: t.i64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = gamesSettings(ctx);
    if (a.seconds < -3650n * 86400n || a.seconds > 3650n * 86400n) fail('INVALID_CLOCK_OFFSET');
    ctx.db.gamesSettings.id.update({ ...s, clockOffsetSec: a.seconds, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'games_settings.clock', 'settings', String(a.seconds));
  });

  const adminSaveGame = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      name: Translations,
      description: Translations,
      iconUrl: t.string(),
      isActive: t.bool(),
      maintenance: t.bool(),
      maintenanceMessage: Translations,
      sort: t.i32(),
      categoryId: t.u64(),
      tagIds: t.array(t.u64()),
      minPlayers: t.u8(),
      maxPlayers: t.u8(),
      turnSeconds: t.u32(),
      matchSeconds: t.u32(),
      botsAllowed: t.bool(),
      botAfterSeconds: t.u32(),
      friendAllowed: t.bool(),
      platforms: t.array(t.string()),
      minVersions: t.array(MinVersion),
      skillMetaKey: t.string(),
      bandSize: t.u32(),
      widenEverySeconds: t.u32(),
      widenStep: t.u32(),
      maxBand: t.u32(),
      fillAfterSeconds: t.u32(),
      settings: t.string(),
      requirements: Requirements,
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.game.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      const same = ctx.db.game.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (a.categoryId) {
        const c = ctx.db.category.id.find(a.categoryId);
        if (!c) fail('CATEGORY_NOT_FOUND');
        if (c.keyType !== 'game' && c.keyType !== 'general') fail('CATEGORY_KIND_MISMATCH');
      }
      if (a.tagIds.length > 20) fail('TOO_MANY_TAGS');
      for (const id of a.tagIds) {
        const tag = ctx.db.tag.id.find(id);
        if (!tag) fail('TAG_NOT_FOUND');
        if (tag.keyType !== 'game' && tag.keyType !== 'general') fail('TAG_KIND_MISMATCH');
      }
      if (a.minPlayers < 1 || a.maxPlayers < a.minPlayers || a.maxPlayers > 100) fail('INVALID_PLAYERS');
      if (a.turnSeconds > 86_400 || a.matchSeconds > 7 * 86_400) fail('INVALID_TIME');
      if (a.botAfterSeconds > 3600 || a.fillAfterSeconds > 3600 || a.widenEverySeconds > 3600) fail('INVALID_TIME');
      if (a.bandSize > 1_000_000 || a.widenStep > 1_000_000 || a.maxBand > 1_000_000) fail('INVALID_BAND');
      const platforms = [...new Set(a.platforms.map(p => p.trim().toLowerCase()))];
      for (const p of platforms) if (!(PLATFORMS as readonly string[]).includes(p)) fail('INVALID_PLATFORM');
      const seen = new Set<string>();
      const minVersions = a.minVersions.map(v => {
        const platform = v.platform.trim().toLowerCase();
        if (!(PLATFORMS as readonly string[]).includes(platform)) fail('INVALID_PLATFORM');
        if (seen.has(platform)) fail('DUPLICATE_PLATFORM');
        seen.add(platform);
        if (!parseVersion(v.version)) fail('INVALID_VERSION');
        return { platform, version: v.version.trim() };
      });
      const skillMetaKey = a.skillMetaKey.trim();
      if (skillMetaKey && !ctx.db.meta.key.find(skillMetaKey)) fail('META_NOT_FOUND');
      const def = gameRegistry.get(key);
      const settingsSchema = def?.settingsSchema ?? old?.settingsSchema ?? '';
      const row = {
        id: a.id,
        key,
        registered: !!def,
        realtime: def?.realtime ?? old?.realtime ?? false,
        codeName: def?.name ?? old?.codeName ?? '',
        settingsSchema,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        iconUrl: cleanUrl(a.iconUrl),
        isActive: a.isActive,
        maintenance: a.maintenance,
        maintenanceMessage: tr(ctx, a.maintenanceMessage, false),
        sort: a.sort,
        categoryId: a.categoryId,
        tagIds: [...new Set(a.tagIds)],
        minPlayers: a.minPlayers,
        maxPlayers: a.maxPlayers,
        turnSeconds: a.turnSeconds,
        matchSeconds: a.matchSeconds,
        botsAllowed: a.botsAllowed,
        botAfterSeconds: a.botAfterSeconds,
        friendAllowed: a.friendAllowed,
        platforms,
        minVersions,
        skillMetaKey,
        bandSize: a.bandSize,
        widenEverySeconds: a.widenEverySeconds,
        widenStep: a.widenStep,
        maxBand: a.maxBand,
        fillAfterSeconds: a.fillAfterSeconds,
        settings: cleanSettings(settingsSchema, a.settings),
        requirements: cleanReq(ctx, a.requirements, 'requirements'),
        createdAt: old?.createdAt ?? ctx.timestamp,
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.game.id.update(row) : ctx.db.game.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'game.update' : 'game.create', String(saved.id), key);
    }
  );

  const adminDeleteGame = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const g = ctx.db.game.id.find(id);
    if (!g) fail('NOT_FOUND');
    if (g.registered) fail('GAME_REGISTERED');
    if ([...ctx.db.gameRoom.gameId.filter(id)].length || [...ctx.db.gameMatch.gameId.filter(id)].length || [...ctx.db.leaderboard.gameId.filter(id)].length) fail('IN_USE');
    ctx.db.game.id.delete(id);
    audit(base(ctx), me.id, 'game.delete', String(id), g.key);
  });

  const adminSaveGameRoom = st.reducer(
    {
      id: t.u64(),
      gameId: t.u64(),
      key: t.string(),
      name: Translations,
      entryCurrency: t.string(),
      entryFee: t.i64(),
      prizeId: t.u64(),
      prizeGroupId: t.u64(),
      minLevel: t.u32(),
      isLocked: t.bool(),
      isHidden: t.bool(),
      isActive: t.bool(),
      inheritGame: t.bool(),
      requirements: Requirements,
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const game = ctx.db.game.id.find(a.gameId);
      if (!game) fail('GAME_NOT_FOUND');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.gameRoom.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && (old.key !== key || old.gameId !== a.gameId)) fail('KEY_LOCKED');
      const same = [...ctx.db.gameRoom.byGameKey.filter([a.gameId, key])][0];
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (a.entryFee < 0n) fail('INVALID_FEE');
      const currency = a.entryCurrency.trim();
      if (a.entryFee > 0n && !ctx.db.currency.key.find(currency)) fail('CURRENCY_NOT_FOUND');
      if (a.prizeId && a.prizeGroupId) fail('PRIZE_AND_GROUP');
      if (a.prizeId && !ctx.db.prize.id.find(a.prizeId)) fail('PRIZE_NOT_FOUND');
      if (a.prizeGroupId && !ctx.db.prizeGroup.id.find(a.prizeGroupId)) fail('PRIZE_GROUP_NOT_FOUND');
      if (a.minLevel > 10_000) fail('INVALID_LEVEL');
      const row = {
        id: a.id,
        gameId: a.gameId,
        key,
        name: tr(ctx, a.name),
        entryCurrency: a.entryFee > 0n ? currency : '',
        entryFee: a.entryFee,
        prizeId: a.prizeId,
        prizeGroupId: a.prizeGroupId,
        minLevel: a.minLevel,
        isLocked: a.isLocked,
        isHidden: a.isHidden,
        isActive: a.isActive,
        inheritGame: a.inheritGame,
        requirements: cleanReq(ctx, a.requirements, 'room.requirements'),
        sort: a.sort,
        createdAt: old?.createdAt ?? ctx.timestamp,
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.gameRoom.id.update(row) : ctx.db.gameRoom.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'game_room.update' : 'game_room.create', String(saved.id), `${game.key}/${key}`);
    }
  );

  const adminDeleteGameRoom = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const r = ctx.db.gameRoom.id.find(id);
    if (!r) fail('NOT_FOUND');
    if ([...ctx.db.gameTicket.byRoomStatus.filter([id, 'waiting'])].length) fail('IN_USE');
    for (const st of ['waiting', 'playing']) if ([...ctx.db.gameMatch.state.filter(st)].some(m => m.roomId === id)) fail('IN_USE');
    ctx.db.gameRoom.id.delete(id);
    audit(base(ctx), me.id, 'game_room.delete', String(id), r.key);
  });

  const adminSaveGameServer = st.reducer({ identity: t.identity(), note: t.string(), isActive: t.bool() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const old = ctx.db.gameServer.identity.find(a.identity);
    const row = { identity: a.identity, note: a.note.trim().slice(0, 200), isActive: a.isActive, createdBy: old?.createdBy ?? me.id, createdAt: old?.createdAt ?? ctx.timestamp };
    if (old) ctx.db.gameServer.identity.update(row);
    else ctx.db.gameServer.insert(row);
    audit(base(ctx), me.id, old ? 'game_server.update' : 'game_server.create', a.identity.toHexString().slice(0, 16), row.note);
  });

  const adminDeleteGameServer = st.reducer({ identity: t.identity() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.gameServer.identity.find(a.identity)) fail('NOT_FOUND');
    ctx.db.gameServer.identity.delete(a.identity);
    audit(base(ctx), me.id, 'game_server.delete', a.identity.toHexString().slice(0, 16));
  });

  const adminMatches = st.procedure({ gameId: t.u64(), state: t.string(), accountId: t.u64(), page: t.u32(), pageSize: t.u32() }, MatchPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'support');
      let list = a.accountId
        ? [...new Set([...tx.db.gameTicket.accountId.filter(a.accountId)].map(x => x.matchId).filter(Boolean))].map(id => tx.db.gameMatch.id.find(id)!).filter(Boolean)
        : a.gameId
          ? [...tx.db.gameMatch.gameId.filter(a.gameId)]
          : a.state
            ? [...tx.db.gameMatch.state.filter(a.state)]
            : [...tx.db.gameMatch.iter()];
      list = list.filter(m => (!a.gameId || m.gameId === a.gameId) && (!a.state || m.state === a.state)).sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminMatch = st.procedure({ matchId: t.u64() }, MatchDetail, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'support');
      const m = tx.db.gameMatch.id.find(a.matchId);
      if (!m) fail('MATCH_NOT_FOUND');
      return { match: m, tickets: [...tx.db.gameTicket.matchId.filter(m.id)], payouts: [...tx.db.gamePayout.refId.filter(m.id)].filter(p => p.kind === 'match') };
    })
  );

  const adminCancelMatch = st.reducer({ matchId: t.u64(), refund: t.bool(), reason: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const m = ctx.db.gameMatch.id.find(a.matchId);
    if (!m) fail('MATCH_NOT_FOUND');
    cancelMatch(ctx, m, a.reason.trim() || 'admin', a.refund, nowUs(ctx));
    audit(base(ctx), me.id, 'game_match.cancel', String(m.id), JSON.stringify({ refund: a.refund, reason: a.reason }));
  });

  const adminPlayerGames = st.procedure({ accountId: t.u64() }, PlayerGames, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'support');
      return {
        tickets: [...tx.db.gameTicket.accountId.filter(a.accountId)].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 200),
        payouts: [...tx.db.gamePayout.accountId.filter(a.accountId)].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 200),
      };
    })
  );

  const adminGamePayouts = st.procedure({ kind: t.string(), status: t.string(), accountId: t.u64(), page: t.u32(), pageSize: t.u32() }, PayoutPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const src = a.accountId ? [...tx.db.gamePayout.accountId.filter(a.accountId)] : a.status ? [...tx.db.gamePayout.status.filter(a.status)] : [...tx.db.gamePayout.iter()];
      const list = src.filter(p => (!a.kind || p.kind === a.kind) && (!a.status || p.status === a.status)).sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminRetryGamePayout = st.procedure({ payoutId: t.u64() }, gamesRows.payout, (ctx, a) => {
    ctx.withTx(tx => {
      const me = requireRole(base(tx), 'admin');
      const p = tx.db.gamePayout.id.find(a.payoutId);
      if (!p) fail('NOT_FOUND');
      if (p.status === 'granted') fail('ALREADY_GRANTED');
      tx.db.gamePayout.id.update({ ...p, status: 'pending' });
      audit(base(tx), me.id, 'game_payout.retry', String(p.id));
    });
    runPayouts(ctx, [a.payoutId]);
    return ctx.withTx(tx => tx.db.gamePayout.id.find(a.payoutId)!);
  });

  const adminGamesRun = st.procedure(RunResult, ctx => {
    const r = ctx.withTx(tx => {
      const me = requireRole(base(tx), 'admin');
      audit(base(tx), me.id, 'games.run', 'tick');
      return runTick(tx, true);
    });
    const paid = runPayouts(ctx);
    return { ...r, paid };
  });

  const gamesTick = st.procedure({ onSchedule: gamesTables.gamesTickTimer }, { timer: gamesTables.gamesTickTimer.rowType }, t.unit(), ctx => {
    const any = ctx.withTx(tx => [...tx.db.gameTicket.status.filter('waiting')].length > 0 || [...tx.db.gameMatch.state.filter('waiting')].length > 0 || [...tx.db.gameMatch.state.filter('playing')].length > 0 || [...tx.db.leaderboard.iter()].some(l => l.isActive) || (tx.db.gamesSettings.id.find(0)?.historyDays ?? 0) > 0);
    if (any) ctx.withTx(tx => runTick(tx));
    runPayouts(ctx);
    retryFailed(ctx);
    return {};
  });

  const gamesPayoutWorker = st.procedure({ onSchedule: gamesTables.gamesPayoutTimer }, { timer: gamesTables.gamesPayoutTimer.rowType }, t.unit(), ctx => {
    runPayouts(ctx);
    return {};
  });

  return {
    gamesTick,
    gamesPayoutWorker,
    gamesList,
    myGameTickets,
    myMatches,
    gamesCheck,
    gamesJoin,
    gamesCancel,
    gamesFriendStart,
    gamesReady,
    gamesLeave,
    gamesStartMatch,
    gamesReportResult,
    adminGamesSettings,
    adminGames,
    adminGameRooms,
    adminGameServers,
    adminSaveGamesSettings,
    adminSetGamesClockOffset,
    adminSaveGame,
    adminDeleteGame,
    adminSaveGameRoom,
    adminDeleteGameRoom,
    adminSaveGameServer,
    adminDeleteGameServer,
    adminMatches,
    adminMatch,
    adminCancelMatch,
    adminPlayerGames,
    adminGamePayouts,
    adminRetryGamePayout,
    adminGamesRun,
  };
}

