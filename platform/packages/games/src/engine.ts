import type { InferSchema, ProcedureCtx, ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { fail, logActivity, sign, type Tx } from '@stg/base';
import { addMeta, changeBalance, grantPrize, pickFromGroup, type ETx } from '@stg/economy';
import { playerLevel, recordEvent } from '@stg/gamification';
import { addItem, invRow, takeItem } from '@stg/items';
import type { GamesSchema } from './schema';

export type GS = InferSchema<GamesSchema>;
export type GTx = ReducerCtx<GS>;
export type GProc = ProcedureCtx<GS>;
export type GDb = { db: GTx['db'] };
export type GameRow = NonNullable<ReturnType<GTx['db']['game']['id']['find']>>;
export type RoomRow = NonNullable<ReturnType<GTx['db']['gameRoom']['id']['find']>>;
export type TicketRow = NonNullable<ReturnType<GTx['db']['gameTicket']['id']['find']>>;
export type MatchRow = NonNullable<ReturnType<GTx['db']['gameMatch']['id']['find']>>;
export type BoardRow = NonNullable<ReturnType<GTx['db']['leaderboard']['id']['find']>>;
export type SettingsRow = NonNullable<ReturnType<GTx['db']['gamesSettings']['id']['find']>>;
export type Req = GameRow['requirements'];

export const PATHS = ['matchmaking', 'bot', 'friend'];
export const OPERATORS = ['gt', 'gte', 'eq', 'lte', 'lt'];
export const SYSTEM_EVENTS: [string, string, string][] = [
  ['game_played', 'بازی انجام شد', 'Game played'],
  ['game_won', 'بردن بازی', 'Game won'],
];
export const SEC = 1_000_000n;
export const DAY_MS = 86_400_000;
export const TEHRAN_MS = 12_600_000;

export function base(ctx: unknown) {
  return ctx as Tx;
}

export function econ(ctx: unknown) {
  return ctx as ETx;
}

export function gamesSettings(ctx: GDb): SettingsRow {
  const s = ctx.db.gamesSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function nowUs(ctx: GTx) {
  const s = ctx.db.gamesSettings.id.find(0);
  return ctx.timestamp.microsSinceUnixEpoch + BigInt(s?.clockOffsetSec ?? 0n) * SEC;
}

export function emptyReq(): Req {
  return { itemKeys: [], itemsMode: 'any', consumeItems: false, tagIds: [], tagsMode: 'any', excludeTagIds: [], minLevel: 0, metas: [], productIds: [], paths: [], refund: 'return', lock: 'show', message: [] };
}

export function isEmptyReq(r: Req) {
  return !r.itemKeys.length && !r.tagIds.length && !r.excludeTagIds.length && !r.minLevel && !r.metas.length;
}

export type GameDef = { key: string; name: string; realtime?: boolean; settingsSchema?: unknown; minPlayers?: number; maxPlayers?: number };
export const gameRegistry = new Map<string, { key: string; name: string; realtime: boolean; settingsSchema: string; minPlayers: number; maxPlayers: number }>();

export function registerGame(def: GameDef) {
  const key = def.key.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(key)) throw new Error(`invalid game key ${def.key}`);
  const raw = def.settingsSchema === undefined ? '' : typeof def.settingsSchema === 'string' ? def.settingsSchema : JSON.stringify(def.settingsSchema);
  if (raw) {
    const err = schemaShapeError(raw);
    if (err) throw new Error(`invalid settings schema for ${key}: ${err}`);
  }
  const minPlayers = Math.min(Math.max(def.minPlayers ?? 2, 1), 100);
  const maxPlayers = Math.min(Math.max(def.maxPlayers ?? minPlayers, minPlayers), 100);
  gameRegistry.set(key, { key, name: def.name.slice(0, 100), realtime: !!def.realtime, settingsSchema: raw, minPlayers, maxPlayers });
  return key;
}

type Sch = {
  type?: string;
  properties?: Record<string, Sch>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Sch;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  default?: unknown;
};

const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean'];

function shapeError(s: unknown, path: string, depth: number): string {
  if (depth > 6) return `${path}:too_deep`;
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return `${path}:not_object`;
  const x = s as Sch;
  if (x.type !== undefined && !TYPES.includes(x.type)) return `${path}:bad_type`;
  if (x.enum !== undefined && !Array.isArray(x.enum)) return `${path}:bad_enum`;
  if (x.required !== undefined && (!Array.isArray(x.required) || x.required.some(r => typeof r !== 'string'))) return `${path}:bad_required`;
  for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (x[k] !== undefined && typeof x[k] !== 'number') return `${path}:bad_${k}`;
  }
  if (x.pattern !== undefined) {
    if (typeof x.pattern !== 'string') return `${path}:bad_pattern`;
    try {
      new RegExp(x.pattern);
    } catch {
      return `${path}:bad_pattern`;
    }
  }
  if (x.properties !== undefined) {
    if (typeof x.properties !== 'object' || x.properties === null) return `${path}:bad_properties`;
    for (const [k, v] of Object.entries(x.properties)) {
      const e = shapeError(v, path ? `${path}.${k}` : k, depth + 1);
      if (e) return e;
    }
  }
  if (x.items !== undefined) {
    const e = shapeError(x.items, `${path}[]`, depth + 1);
    if (e) return e;
  }
  if (x.default !== undefined) {
    const e = valueError(x, x.default, path);
    if (e) return `${path}:bad_default`;
  }
  return '';
}

export function schemaShapeError(raw: string) {
  let s: unknown;
  try {
    s = JSON.parse(raw);
  } catch {
    return 'not_json';
  }
  if ((s as Sch)?.type !== undefined && (s as Sch).type !== 'object') return 'root_not_object';
  return shapeError(s, '', 0);
}

function typeOk(type: string | undefined, v: unknown) {
  if (!type) return true;
  if (type === 'object') return typeof v === 'object' && v !== null && !Array.isArray(v);
  if (type === 'array') return Array.isArray(v);
  if (type === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeof v === type;
}

export function valueError(s: Sch, v: unknown, path: string): string {
  const at = path || '$';
  if (!typeOk(s.type, v)) return `${at}:type`;
  if (s.enum && !s.enum.some(e => JSON.stringify(e) === JSON.stringify(v))) return `${at}:enum`;
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) return `${at}:minimum`;
    if (s.maximum !== undefined && v > s.maximum) return `${at}:maximum`;
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && [...v].length < s.minLength) return `${at}:minLength`;
    if (s.maxLength !== undefined && [...v].length > s.maxLength) return `${at}:maxLength`;
    if (s.pattern && !new RegExp(s.pattern).test(v)) return `${at}:pattern`;
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) return `${at}:minItems`;
    if (s.maxItems !== undefined && v.length > s.maxItems) return `${at}:maxItems`;
    if (s.items) {
      for (let i = 0; i < v.length; i++) {
        const e = valueError(s.items, v[i], `${path}[${i}]`);
        if (e) return e;
      }
    }
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const r of s.required ?? []) if (!(r in o)) return `${path ? `${path}.` : ''}${r}:required`;
    for (const [k, val] of Object.entries(o)) {
      const sub = s.properties?.[k];
      if (!sub) {
        if (s.additionalProperties === false) return `${path ? `${path}.` : ''}${k}:unknown`;
        continue;
      }
      const e = valueError(sub, val, path ? `${path}.${k}` : k);
      if (e) return e;
    }
  }
  return '';
}

export function defaultsOf(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const s = JSON.parse(raw) as Sch;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties ?? {})) if (v.default !== undefined) out[k] = v.default;
    return out;
  } catch {
    return {};
  }
}

export function cleanSettings(schemaRaw: string, raw: string) {
  const text = raw.trim() || '{}';
  if (text.length > 8000) fail('SETTINGS_TOO_LARGE');
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    fail('INVALID_SETTINGS:$:json');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('INVALID_SETTINGS:$:type');
  const merged = { ...defaultsOf(schemaRaw), ...(v as Record<string, unknown>) };
  if (schemaRaw) {
    const err = valueError(JSON.parse(schemaRaw) as Sch, merged, '');
    if (err) fail(`INVALID_SETTINGS:${err}`);
  }
  return JSON.stringify(merged);
}

export function gameSettingsOf(raw: unknown, gameKey: string): Record<string, unknown> {
  const ctx = raw as GDb;
  const g = ctx.db.game.key.find(gameKey);
  if (!g) return {};
  try {
    return { ...defaultsOf(g.settingsSchema), ...(JSON.parse(g.settings || '{}') as Record<string, unknown>) };
  } catch {
    return defaultsOf(g.settingsSchema);
  }
}

export function dayNumber(micros: bigint) {
  return Math.floor((Number(micros / 1000n) + TEHRAN_MS) / DAY_MS);
}

function dateOf(n: number) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function toJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

export function periodKey(period: string, micros: bigint, s: { weekStart: number; monthCalendar: string }) {
  const n = dayNumber(micros);
  if (period === 'daily') return `d${dateOf(n)}`;
  if (period === 'weekly') {
    const dow = (n + 4) % 7;
    return `w${dateOf(n - ((dow - s.weekStart + 7) % 7))}`;
  }
  if (period === 'monthly') {
    const d = dateOf(n);
    if (s.monthCalendar === 'jalali') {
      const [jy, jm] = toJalali(Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10)));
      return `j${jy}-${String(jm).padStart(2, '0')}`;
    }
    return `m${d.slice(0, 7)}`;
  }
  return 'all';
}

export function basePeriod(p: string) {
  return p.split('#')[0];
}

export function hmacInt(ctx: GTx, msg: string, mod: number) {
  const mac = sign(ctx.env.OTP_SECRET, msg);
  return (((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0) % mod;
}

export function activity(ctx: GTx, accountId: bigint, action: string, refId: string, data: Record<string, unknown>, actor = 'player') {
  logActivity(ctx, accountId, { kind: 'game', action, refId, data: JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? String(v) : v)), actor });
}

export function metaHave(ctx: GDb, accountId: bigint, key: string) {
  const m = ctx.db.meta.key.find(key);
  const row = [...ctx.db.userMeta.byAccountMeta.filter([accountId, key])][0];
  return row?.value ?? m?.defaultValue ?? 0;
}

export function compare(op: string, a: number, b: number) {
  const x = Math.round(a * 10000);
  const y = Math.round(b * 10000);
  return op === 'gt' ? x > y : op === 'gte' ? x >= y : op === 'lt' ? x < y : op === 'lte' ? x <= y : x === y;
}

function ownsKey(ctx: GDb, accountId: bigint, key: string) {
  const it = ctx.db.item.key.find(key);
  if (!it) return false;
  const r = invRow(ctx as never, accountId, it.id);
  return !!r && r.quantity > 0;
}

export type Missing = { type: string; mode: string; keys: string[]; key: string; operator: string; value: number; have: number; consume: number; minLevel: number; level: number };
export type Offer = { productId: bigint; key: string; satisfies: string[] };

function miss(p: Partial<Missing>): Missing {
  return { type: '', mode: '', keys: [], key: '', operator: '', value: 0, have: 0, consume: 0, minLevel: 0, level: 0, ...p };
}

export function applies(r: Req, path: string) {
  return !r.paths.length || r.paths.includes(path);
}

export function missingOf(ctx: GDb, accountId: bigint, r: Req): Missing[] {
  const out: Missing[] = [];
  if (r.minLevel) {
    const level = playerLevel(ctx, accountId);
    if (level < r.minLevel) out.push(miss({ type: 'level', minLevel: r.minLevel, level }));
  }
  if (r.itemKeys.length) {
    const lacking = r.itemKeys.filter(k => !ownsKey(ctx, accountId, k));
    if (r.itemsMode === 'all' ? lacking.length > 0 : lacking.length === r.itemKeys.length) out.push(miss({ type: 'item', mode: r.itemsMode === 'all' ? 'all' : 'any', keys: r.itemsMode === 'all' ? lacking : [...r.itemKeys] }));
  }
  const mine = new Set([...ctx.db.userTag.byAccountTag.filter(accountId)].map(u => u.tagId));
  const keyOf = (id: bigint) => ctx.db.tag.id.find(id)?.key ?? String(id);
  if (r.tagIds.length) {
    const lacking = r.tagIds.filter(id => !mine.has(id));
    if (r.tagsMode === 'all' ? lacking.length > 0 : lacking.length === r.tagIds.length) out.push(miss({ type: 'tag', mode: r.tagsMode === 'all' ? 'all' : 'any', keys: (r.tagsMode === 'all' ? lacking : r.tagIds).map(keyOf) }));
  }
  const bad = r.excludeTagIds.filter(id => mine.has(id));
  if (bad.length) out.push(miss({ type: 'excluded_tag', keys: bad.filter(id => ctx.db.tagMeta.tagId.find(id)?.isPublic).map(keyOf) }));
  for (const m of r.metas) {
    const have = metaHave(ctx, accountId, m.metaKey);
    const ok = compare(m.operator, have, m.value) && (!m.consume || have >= m.consume);
    if (!ok) out.push(miss({ type: 'meta', key: m.metaKey, operator: m.operator, value: m.value, have, consume: m.consume }));
  }
  return out;
}

export function offersFor(ctx: GDb, sets: Req[], missing: Missing[]): Offer[] {
  const chosen = [...new Set(sets.flatMap(s => s.productIds.map(String)))].map(BigInt);
  const needItems = new Set(missing.filter(m => m.type === 'item').flatMap(m => m.keys));
  const needMetas = new Set(missing.filter(m => m.type === 'meta').map(m => m.key));
  const satisfies = (prizeId: bigint) => {
    const p = ctx.db.prize.id.find(prizeId);
    if (!p) return [] as string[];
    const out: string[] = [];
    for (const i of p.items) {
      if (i.type === 'item' && needItems.has(i.key)) out.push(`item:${i.key}`);
      if (i.type === 'meta' && i.action !== 'set' && needMetas.has(i.key)) out.push(`meta:${i.key}`);
    }
    return out;
  };
  const list = chosen.length ? chosen.map(id => ctx.db.product.id.find(id)).filter(p => !!p && p.isActive) : [...ctx.db.product.iter()].filter(p => p.isActive && satisfies(p.prizeId).length > 0);
  return list.slice(0, 10).map(p => ({ productId: p!.id, key: p!.key, satisfies: satisfies(p!.prizeId) }));
}

export function setsFor(game: GameRow, room: RoomRow | undefined, path: string) {
  const sets: Req[] = [];
  if ((!room || room.inheritGame) && !isEmptyReq(game.requirements) && applies(game.requirements, path)) sets.push(game.requirements);
  if (room && !isEmptyReq(room.requirements) && applies(room.requirements, path)) sets.push(room.requirements);
  return sets;
}

export function entryCheck(ctx: GDb, accountId: bigint, game: GameRow, room: RoomRow | undefined, path: string) {
  const sets = setsFor(game, room, path);
  const missing: Missing[] = [];
  let hide = false;
  for (const s of sets) {
    const m = missingOf(ctx, accountId, s);
    if (m.length && s.lock === 'hide') hide = true;
    missing.push(...m);
  }
  const products = missing.length ? offersFor(ctx, sets, missing) : [];
  const roomMsg = room && room.requirements.message.length ? room.requirements.message : [];
  const message = roomMsg.length ? roomMsg : game.requirements.message;
  const consumes = sets.some(s => (s.consumeItems && s.itemKeys.length > 0) || s.metas.some(m => m.consume > 0));
  return { sets, missing, products, message, hide, consumes };
}

export type Consumed = { items: { key: string; qty: number; refund: string }[]; metas: { key: string; amount: number; refund: string }[] };

export function consumeTickets(ctx: GTx, accountId: bigint, sets: Req[]): Consumed {
  const out: Consumed = { items: [], metas: [] };
  for (const s of sets) {
    const refund = s.refund === 'keep' ? 'keep' : 'return';
    if (s.consumeItems && s.itemKeys.length) {
      const keys = s.itemsMode === 'all' ? s.itemKeys : s.itemKeys.filter(k => ownsKey(ctx, accountId, k)).slice(0, 1);
      for (const key of keys) {
        const it = ctx.db.item.key.find(key);
        if (!it) fail('ITEM_NOT_FOUND');
        takeItem(ctx as never, accountId, it, 1);
        out.items.push({ key, qty: 1, refund });
      }
    }
    for (const m of s.metas) {
      if (m.consume > 0) {
        addMeta(econ(ctx), accountId, m.metaKey, -m.consume);
        out.metas.push({ key: m.metaKey, amount: m.consume, refund });
      }
    }
  }
  return out;
}

export function refundTicket(ctx: GTx, t: TicketRow, reason: string, fee = true): TicketRow {
  let row = t;
  if (fee && t.fee > 0n && !t.feeRefunded) {
    changeBalance(econ(ctx), t.accountId, t.feeCurrency, t.fee, `game_refund:${reason}`, 'game_refund', `ticket:${t.id}`);
    row = { ...row, feeRefunded: true };
  }
  if (!t.ticketsReturned && t.consumed) {
    const c = JSON.parse(t.consumed) as Consumed;
    let any = false;
    for (const i of c.items) {
      if (i.refund !== 'return') continue;
      const it = ctx.db.item.key.find(i.key);
      if (it) addItem(ctx as never, t.accountId, it, i.qty, 'game', `ticket:${t.id}`);
      any = true;
    }
    for (const m of c.metas) {
      if (m.refund !== 'return' || !ctx.db.meta.key.find(m.key)) continue;
      addMeta(econ(ctx), t.accountId, m.key, m.amount);
      any = true;
    }
    if (any || c.items.length || c.metas.length) row = { ...row, ticketsReturned: true };
  }
  if (row !== t) activity(ctx, t.accountId, 'refunded', String(t.id), { reason, fee: row.feeRefunded && !t.feeRefunded ? t.fee : 0n, currency: t.feeCurrency }, 'system');
  return row;
}

export function bandOf(game: GameRow, waitedSec: number) {
  let b = game.bandSize + (game.widenEverySeconds ? Math.floor(Math.max(waitedSec, 0) / game.widenEverySeconds) * game.widenStep : 0);
  if (game.maxBand && b > game.maxBand) b = game.maxBand;
  return b;
}

function oldest(a: TicketRow, b: TicketRow) {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
}

export function formMatch(ctx: GTx, game: GameRow, room: RoomRow, path: string, group: TicketRow[], bots: number, now: bigint) {
  const skills = group.map(t => t.skill);
  const m = ctx.db.gameMatch.insert({
    id: 0n,
    gameId: game.id,
    roomId: room.id,
    gameKey: game.key,
    roomKey: room.key,
    path,
    state: 'waiting',
    players: group.map(t => t.accountId),
    bots: Math.min(bots, 100),
    skillMin: Math.min(...skills),
    skillMax: Math.max(...skills),
    reason: '',
    createdAt: now,
    startedAt: 0n,
    endedAt: 0n,
  });
  for (const t of group) {
    ctx.db.gameTicket.id.update({ ...t, status: 'matched', matchId: m.id, updatedAt: now });
    activity(ctx, t.accountId, 'matched', String(m.id), { game: game.key, room: room.key, path, bots }, 'system');
  }
  return m;
}

export function matchRoom(ctx: GTx, game: GameRow, room: RoomRow, now: bigint) {
  const made: MatchRow[] = [];
  const waiting = [...ctx.db.gameTicket.byRoomStatus.filter([room.id, 'waiting'])].sort(oldest);
  const used = new Set<bigint>();
  for (const t of waiting.filter(x => x.path === 'bot')) {
    used.add(t.id);
    made.push(formMatch(ctx, game, room, 'bot', [t], Math.max(game.minPlayers - 1, 1), now));
  }
  const codes = new Map<string, TicketRow[]>();
  for (const t of waiting.filter(x => x.path === 'friend')) codes.set(t.code, [...(codes.get(t.code) ?? []), t]);
  for (const list of codes.values()) {
    if (list.length >= game.maxPlayers) {
      const group = list.slice(0, game.maxPlayers);
      group.forEach(t => used.add(t.id));
      made.push(formMatch(ctx, game, room, 'friend', group, 0, now));
    }
  }
  const queue = waiting.filter(x => x.path === 'matchmaking');
  for (const a of queue) {
    if (used.has(a.id)) continue;
    const waited = Number((now - a.createdAt) / SEC);
    const band = bandOf(game, waited);
    const group = [a];
    for (const b of queue) {
      if (group.length >= game.maxPlayers) break;
      if (b.id === a.id || used.has(b.id)) continue;
      if (b.accountId === a.accountId) continue;
      if (Math.abs(b.skill - a.skill) <= band + 1e-9) group.push(b);
    }
    let bots = -1;
    if (group.length >= game.maxPlayers) bots = 0;
    else if (group.length >= game.minPlayers && waited >= game.fillAfterSeconds) bots = 0;
    else if (group.length < game.minPlayers && game.botsAllowed && waited >= game.botAfterSeconds) bots = game.minPlayers - group.length;
    if (bots < 0) continue;
    group.forEach(t => used.add(t.id));
    made.push(formMatch(ctx, game, room, 'matchmaking', group, bots, now));
  }
  return made;
}

export function cancelMatch(ctx: GTx, m: MatchRow, reason: string, refund: boolean, now: bigint) {
  if (m.state === 'finished' || m.state === 'cancelled') fail('MATCH_CLOSED');
  for (const t of [...ctx.db.gameTicket.matchId.filter(m.id)]) {
    const row = refund ? refundTicket(ctx, t, reason) : t;
    ctx.db.gameTicket.id.update({ ...row, status: t.status === 'left' ? 'left' : 'cancelled', updatedAt: now });
  }
  return ctx.db.gameMatch.id.update({ ...m, state: 'cancelled', reason: reason.slice(0, 100), endedAt: now });
}

export function startMatchRow(ctx: GTx, m: MatchRow, now: bigint) {
  if (m.state !== 'waiting') fail(m.state === 'playing' ? 'MATCH_ALREADY_STARTED' : 'MATCH_CLOSED');
  return ctx.db.gameMatch.id.update({ ...m, state: 'playing', startedAt: now });
}

export function startMatch(raw: unknown, matchId: bigint) {
  const ctx = raw as GTx;
  const m = ctx.db.gameMatch.id.find(matchId);
  if (!m) fail('MATCH_NOT_FOUND');
  return startMatchRow(ctx, m, nowUs(ctx));
}

export function schedulePayouts(ctx: GTx) {
  if (ctx.db.gamesPayoutTimer.count() === 0n) ctx.db.gamesPayoutTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch) });
}

export function createPayout(ctx: GTx, kind: string, refId: bigint, accountId: bigint, prizeId: bigint, prizeGroupId: bigint, uniq: string) {
  if (!prizeId && !prizeGroupId) return undefined;
  if (ctx.db.gamePayout.uniq.find(uniq)) return undefined;
  const row = ctx.db.gamePayout.insert({ id: 0n, uniq, kind, refId, accountId, prizeId, prizeGroupId, status: 'pending', attempts: 0, error: '', rewards: '[]', createdAt: ctx.timestamp, grantedAt: undefined });
  schedulePayouts(ctx);
  return row;
}

export function grantPayout(ctx: GTx, id: bigint) {
  const p = ctx.db.gamePayout.id.find(id);
  if (!p || p.status === 'granted') return;
  const prizeId = p.prizeId || pickFromGroup(econ(ctx), p.prizeGroupId, p.uniq);
  const rewards = grantPrize(econ(ctx), p.accountId, prizeId, p.kind === 'match' ? 'game' : 'leaderboard', p.uniq);
  ctx.db.gamePayout.id.update({ ...p, prizeId, status: 'granted', error: '', attempts: Math.min(p.attempts + 1, 255), rewards: JSON.stringify(rewards), grantedAt: ctx.timestamp });
  activity(ctx, p.accountId, 'prize', String(p.id), { kind: p.kind, refId: p.refId, prizeId }, 'system');
}

export function runPayouts(ctx: GProc, only?: bigint[]) {
  let done = 0;
  for (let round = 0; round < 10; round++) {
    const ids = ctx.withTx(tx => (only ?? [...tx.db.gamePayout.status.filter('pending')].slice(0, 50).map(p => p.id)).filter(id => tx.db.gamePayout.id.find(id)?.status === 'pending'));
    if (!ids.length) break;
    for (const id of ids) {
      try {
        ctx.withTx(tx => grantPayout(tx, id));
        done++;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        ctx.withTx(tx => {
          const p = tx.db.gamePayout.id.find(id);
          if (p && p.status !== 'granted') tx.db.gamePayout.id.update({ ...p, status: 'failed', error: msg, attempts: Math.min(p.attempts + 1, 255) });
        });
      }
    }
    if (only) break;
  }
  return done;
}

export function rerank(ctx: GTx, lb: BoardRow) {
  const rows = [...ctx.db.lbScore.byBoardPeriod.filter([lb.id, lb.currentPeriod])];
  const desc = lb.order !== 'asc';
  rows.sort((a, b) => (a.score !== b.score ? (desc ? b.score - a.score : a.score - b.score) : a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1));
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) ctx.db.lbScore.id.update({ ...r, rank: i + 1 });
  });
  return rows.length;
}

export function rewardFor(lb: BoardRow, rank: number) {
  return lb.rewards.find(r => rank >= r.fromRank && (r.toRank === 0 || rank <= r.toRank));
}

export function archiveBoard(ctx: GTx, lb: BoardRow, reason: string, pay: boolean, next: string, now: bigint): BoardRow {
  const players = rerank(ctx, lb);
  if (players > 0) {
    const uniq = `${lb.id}|${lb.currentPeriod}`;
    if (!ctx.db.lbPeriod.uniq.find(uniq)) {
      const per = ctx.db.lbPeriod.insert({ id: 0n, uniq, boardId: lb.id, period: lb.currentPeriod, reason, paid: pay, players, rewarded: 0, startedAt: lb.periodStartedAt, endedAt: now });
      let rewarded = 0;
      for (const r of [...ctx.db.lbScore.byBoardPeriod.filter([lb.id, lb.currentPeriod])]) {
        const rw = pay ? rewardFor(lb, r.rank) : undefined;
        ctx.db.lbResult.insert({ id: 0n, periodId: per.id, boardId: lb.id, accountId: r.accountId, rank: r.rank, score: r.score, prizeId: rw?.prizeId ?? 0n, prizeGroupId: rw?.prizeGroupId ?? 0n });
        if (rw && createPayout(ctx, 'leaderboard', per.id, r.accountId, rw.prizeId, rw.prizeGroupId, `lb|${per.id}|${r.accountId}`)) rewarded++;
        ctx.db.lbScore.id.delete(r.id);
      }
      ctx.db.lbPeriod.id.update({ ...per, rewarded });
    }
  }
  return ctx.db.leaderboard.id.update({ ...lb, currentPeriod: next, periodStartedAt: now, resets: reason === 'reset' ? lb.resets : lb.resets + 1, updatedAt: ctx.timestamp });
}

export function rollover(ctx: GTx, lb: BoardRow, now: bigint): BoardRow {
  const key = periodKey(lb.period, now, gamesSettings(ctx));
  if (basePeriod(lb.currentPeriod) === key) return lb;
  return archiveBoard(ctx, lb, 'reset', true, key, now);
}

export function writeScore(ctx: GTx, lbIn: BoardRow, accountId: bigint, value: number, mode: string, now: bigint) {
  if (!Number.isFinite(value)) fail('INVALID_SCORE');
  const lb = rollover(ctx, lbIn, now);
  const uniq = `${lb.id}|${lb.currentPeriod}|${accountId}`;
  const old = ctx.db.lbScore.uniq.find(uniq);
  const desc = lb.order !== 'asc';
  let score = value;
  if (old) {
    if (mode === 'sum') score = old.score + value;
    else if (mode === 'best') score = desc ? Math.max(old.score, value) : Math.min(old.score, value);
  }
  if (old) {
    if (old.score !== score) ctx.db.lbScore.id.update({ ...old, score, writes: old.writes + 1, updatedAt: now });
    else ctx.db.lbScore.id.update({ ...old, writes: old.writes + 1 });
  } else ctx.db.lbScore.insert({ id: 0n, uniq, boardId: lb.id, period: lb.currentPeriod, accountId, score, rank: 0, writes: 1, updatedAt: now });
  rerank(ctx, lb);
  return ctx.db.lbScore.uniq.find(uniq)!;
}

export function submitScore(raw: unknown, boardKey: string, accountId: bigint, score: number) {
  const ctx = raw as GTx;
  const lb = ctx.db.leaderboard.key.find(boardKey);
  if (!lb) fail('LEADERBOARD_NOT_FOUND');
  if (!lb.isActive) fail('LEADERBOARD_NOT_ACTIVE');
  if (!ctx.db.account.id.find(accountId)) fail('ACCOUNT_NOT_FOUND');
  return writeScore(ctx, lb, accountId, score, lb.scoreMode, nowUs(ctx));
}

export type Result = { accountId: bigint; rank: number; score: number };

export function finishMatch(raw: unknown, matchId: bigint, results: Result[], by = 'game') {
  const ctx = raw as GTx;
  const now = nowUs(ctx);
  const m = ctx.db.gameMatch.id.find(matchId);
  if (!m) fail('MATCH_NOT_FOUND');
  if (m.state === 'finished') fail('MATCH_FINISHED');
  if (m.state === 'cancelled') fail('MATCH_CANCELLED');
  if (m.state !== 'playing') fail('MATCH_NOT_STARTED');
  if (results.length > 100) fail('TOO_MANY_RESULTS');
  const seen = new Set<bigint>();
  for (const r of results) {
    if (!m.players.includes(r.accountId)) fail('NOT_IN_MATCH');
    if (seen.has(r.accountId)) fail('DUPLICATE_RESULT');
    seen.add(r.accountId);
    if (!Number.isInteger(r.rank) || r.rank < 1 || r.rank > 1000) fail('INVALID_RANK');
    if (!Number.isFinite(r.score)) fail('INVALID_SCORE');
  }
  const room = ctx.db.gameRoom.id.find(m.roomId);
  const game = ctx.db.game.id.find(m.gameId);
  const winners: bigint[] = [];
  let payouts = 0;
  for (const t of [...ctx.db.gameTicket.matchId.filter(m.id)]) {
    const r = results.find(x => x.accountId === t.accountId);
    const left = t.status === 'left';
    const outcome = !r ? (left ? 'left' : 'none') : r.rank === 1 ? 'win' : 'loss';
    ctx.db.gameTicket.id.update({ ...t, status: left ? 'left' : 'done', rank: r?.rank ?? 0, score: r?.score ?? 0, outcome, updatedAt: now });
    const meta = JSON.stringify({ gameKey: m.gameKey, roomKey: m.roomKey, matchId: String(m.id), rank: String(r?.rank ?? 0) });
    recordEvent(ctx, t.accountId, 'game_played', 1, meta, 'server');
    activity(ctx, t.accountId, 'played', String(m.id), { game: m.gameKey, room: m.roomKey, rank: r?.rank ?? 0, score: r?.score ?? 0, outcome }, 'system');
    if (outcome === 'win') {
      winners.push(t.accountId);
      recordEvent(ctx, t.accountId, 'game_won', 1, meta, 'server');
      if (room && createPayout(ctx, 'match', m.id, t.accountId, room.prizeId, room.prizeGroupId, `match|${m.id}|${t.accountId}`)) payouts++;
    }
  }
  if (game) {
    for (const lb of [...ctx.db.leaderboard.gameId.filter(game.id)]) {
      if (!lb.isActive || (lb.source !== 'score' && lb.source !== 'wins')) continue;
      for (const r of results) {
        if (lb.source === 'wins') {
          if (r.rank === 1) writeScore(ctx, ctx.db.leaderboard.id.find(lb.id)!, r.accountId, 1, 'sum', now);
        } else writeScore(ctx, ctx.db.leaderboard.id.find(lb.id)!, r.accountId, r.score, lb.scoreMode, now);
      }
    }
  }
  ctx.db.gameMatch.id.update({ ...m, state: 'finished', reason: by.slice(0, 100), endedAt: now });
  return { matchId: m.id, winners, payouts };
}

export function page<T>(list: T[], pageNo: number, pageSize: number) {
  const size = Math.min(Math.max(pageSize || 20, 1), 100);
  const start = (Math.max(pageNo || 1, 1) - 1) * size;
  return { total: list.length, rows: list.slice(start, start + size) };
}
