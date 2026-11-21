import type { InferSchema, ProcedureCtx, ReducerCtx } from 'spacetimedb/server';
import { cleanTranslations, fail, sign, type Tr, type Tx } from '@stg/base';
import type { ETx } from '@stg/economy';
import { playerLevel } from '@stg/gamification';
import type { PromoSchema } from './schema';

export type PS = InferSchema<PromoSchema>;
export type PTx = ReducerCtx<PS>;
export type PProc = ProcedureCtx<PS>;
export type PDb = { db: PTx['db'] };
export type BannerRow = NonNullable<ReturnType<PTx['db']['banner']['id']['find']>>;
export type PlacementRow = NonNullable<ReturnType<PTx['db']['placement']['id']['find']>>;
export type SponsorRow = NonNullable<ReturnType<PTx['db']['sponsor']['id']['find']>>;
export type GameRow = NonNullable<ReturnType<PTx['db']['chanceGame']['id']['find']>>;

export const DAY_US = 86_400_000_000n;
export const TEHRAN_US = 12_600_000_000n;

export function base(ctx: unknown) {
  return ctx as Tx;
}

export function econ(ctx: unknown) {
  return ctx as ETx;
}

export function promoSettings(ctx: PDb) {
  const s = ctx.db.promoSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function nowUs(ctx: PTx) {
  const s = ctx.db.promoSettings.id.find(0);
  return ctx.timestamp.microsSinceUnixEpoch + BigInt(s?.clockOffsetSec ?? 0n) * 1_000_000n;
}

export function tehranDayNumber(us: bigint) {
  return Number((us + TEHRAN_US) / DAY_US);
}

export function dayOf(us: bigint) {
  return new Date(tehranDayNumber(us) * 86_400_000).toISOString().slice(0, 10);
}

export function weekdayOf(us: bigint) {
  return (tehranDayNumber(us) + 4) % 7;
}

export function minuteOfDay(us: bigint) {
  return Number(((us + TEHRAN_US) % DAY_US) / 60_000_000n);
}

export function dayStartUs(day: string) {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return BigInt(ms) * 1000n - TEHRAN_US;
}

export function cleanDay(raw: string) {
  const v = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) fail('INVALID_DATE');
  return v;
}

export function addDays(day: string, n: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function tr(ctx: unknown, list: unknown, required = true) {
  return cleanTranslations(list as Tr[], base(ctx), required);
}

export function cleanUrl(s: string) {
  const v = s.trim();
  if (v && !/^(https?:\/\/|\/)/.test(v)) fail('INVALID_URL');
  return v.slice(0, 500);
}

export function cleanAbsoluteUrl(s: string) {
  const v = s.trim();
  if (v && !/^https?:\/\/[^\s]+$/.test(v)) fail('INVALID_URL');
  return v.slice(0, 500);
}

export function cleanColor(s: string) {
  const v = s.trim();
  if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) fail('INVALID_COLOR');
  return v.toLowerCase();
}

export function checkTags(ctx: PDb, ids: bigint[], kinds: string[]) {
  if (ids.length > 20) fail('TOO_MANY_TAGS');
  for (const id of ids) {
    const tag = ctx.db.tag.id.find(id);
    if (!tag) fail('TAG_NOT_FOUND');
    if (!kinds.includes(tag.keyType)) fail('TAG_KIND_MISMATCH');
  }
  return [...new Set(ids)];
}

export function sessionAccount(ctx: { db: PTx['db']; sender: PTx['sender'] }) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  return a && a.status === 'active' ? a : undefined;
}

export function checkRate(ctx: PTx, accountId: bigint, bucket: string, limit: number) {
  if (!limit) return;
  const minute = ctx.timestamp.microsSinceUnixEpoch / 60_000_000n;
  const key = `${accountId}|${bucket}|${minute}`;
  const r = ctx.db.promoRate.key.find(key);
  if (r && r.count >= limit) fail('TOO_MANY_REQUESTS');
  if (r) ctx.db.promoRate.key.update({ ...r, count: r.count + 1 });
  else ctx.db.promoRate.insert({ key, minute, count: 1 });
}

export function hmacInt(ctx: PTx, msg: string, mod: number) {
  const mac = sign(ctx.env.OTP_SECRET, msg);
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + mac[i];
  return n % mod;
}

export function cleanRequestId(raw: string) {
  const id = raw.trim();
  if (!id) return '';
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) fail('INVALID_REQUEST_ID');
  return id;
}

export function requestReplay(ctx: PTx, accountId: bigint, requestId: string, action: string, detail: string) {
  if (!requestId) return undefined;
  const r = ctx.db.promoRequest.key.find(`${accountId}|${requestId}`);
  if (!r) return undefined;
  if (r.action !== action || r.detail !== detail) fail('REQUEST_ID_REUSED');
  return r.result;
}

export function requestSave(ctx: PTx, accountId: bigint, requestId: string, action: string, detail: string, result: string) {
  if (!requestId) return;
  const ttl = BigInt(promoSettings(ctx).requestTtlHours || 24) * 3_600_000_000n;
  ctx.db.promoRequest.insert({ key: `${accountId}|${requestId}`, accountId, action, detail, result, expiresAt: ctx.timestamp.microsSinceUnixEpoch + ttl });
}

export function serialize(o: unknown) {
  return JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
}

export function deserialize<T>(s: string): T {
  return JSON.parse(s, (_k, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as T;
}

export function inWindow(startsAt: bigint, endsAt: bigint, now: bigint) {
  return (!startsAt || now >= startsAt) && (!endsAt || now < endsAt);
}

export function sponsorLive(ctx: PDb, s: SponsorRow | undefined | null, now: bigint) {
  if (!s || !s.isActive || !inWindow(s.startsAt, s.endsAt, now)) return false;
  if (s.stopAtTarget && (s.targetViews || s.targetClicks)) {
    const t = ctx.db.sponsorTotal.sponsorId.find(s.id);
    if (s.targetViews && t && t.views >= BigInt(s.targetViews)) return false;
    if (s.targetClicks && t && t.clicks >= BigInt(s.targetClicks)) return false;
  }
  return true;
}

export function accountCreatedUs(ctx: PDb, accountId: bigint) {
  return ctx.db.account.id.find(accountId)?.createdAt.microsSinceUnixEpoch ?? 0n;
}

export function bannerBlock(ctx: PTx, accountId: bigint, b: BannerRow, now: bigint) {
  if (!b.isActive) return 'off';
  if (b.startsAt && now < b.startsAt) return 'scheduled';
  if (b.endsAt && now >= b.endsAt) return 'ended';
  if (b.days.length && !b.days.includes(weekdayOf(now))) return 'day';
  if (b.dayStart || (b.dayEnd && b.dayEnd < 1440)) {
    const m = minuteOfDay(now);
    const end = b.dayEnd || 1440;
    const inside = b.dayStart <= end ? m >= b.dayStart && m < end : m >= b.dayStart || m < end;
    if (!inside) return 'hour';
  }
  const tags = [...ctx.db.userTag.byAccountTag.filter(accountId)].map(u => u.tagId);
  if (b.excludeTagIds.some(t => tags.includes(t))) return 'excluded';
  if (b.audienceTagIds.length && !b.audienceTagIds.some(t => tags.includes(t))) return 'audience';
  if (b.minLevel || b.maxLevel) {
    const lvl = playerLevel(ctx, accountId, b.levelTableId);
    if (b.minLevel && lvl < b.minLevel) return 'level_low';
    if (b.maxLevel && lvl > b.maxLevel) return 'level_high';
  }
  if (b.playerAge !== 'all') {
    const days = promoSettings(ctx).newPlayerDays;
    const isNew = now - accountCreatedUs(ctx, accountId) < BigInt(days) * DAY_US;
    if (b.playerAge === 'new' && !isNew) return 'not_new';
    if (b.playerAge === 'returning' && isNew) return 'not_returning';
  }
  if (b.countries.length) {
    const c = ctx.db.profile.accountId.find(accountId)?.countryCode ?? '';
    if (!b.countries.includes(c)) return 'country';
  }
  if (b.sponsorId && !sponsorLive(ctx, ctx.db.sponsor.id.find(b.sponsorId), now)) return 'sponsor_off';
  if (b.actionType === 'product') {
    const p = ctx.db.product.key.find(b.actionValue);
    if (!p || !p.isActive) return 'product_off';
    if (p.audienceTagIds.length && !p.audienceTagIds.some(t => tags.includes(t))) return 'product_audience';
  }
  return '';
}

export function sortBanners(list: BannerRow[]) {
  return list.sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
}

function bumpSeen(ctx: PTx, table: 'banner' | 'sponsor', id: bigint, accountId: bigint, day: string, now: bigint, what: 'view' | 'click') {
  const key = `${id}|${accountId}|${day}`;
  const t = table === 'banner' ? ctx.db.bannerSeen : ctx.db.sponsorSeen;
  const r = t.key.find(key);
  if (r && (what === 'view' ? r.viewed : r.clicked)) return { counted: false, first: false };
  const first = !r;
  const row = { key, accountId, day, viewed: (r?.viewed ?? false) || what === 'view', clicked: (r?.clicked ?? false) || what === 'click', at: now };
  if (table === 'banner') {
    if (r) ctx.db.bannerSeen.key.update({ ...row, bannerId: id });
    else ctx.db.bannerSeen.insert({ ...row, bannerId: id });
  } else {
    if (r) ctx.db.sponsorSeen.key.update({ ...row, sponsorId: id });
    else ctx.db.sponsorSeen.insert({ ...row, sponsorId: id });
  }
  return { counted: true, first };
}

export function countBanner(ctx: PTx, b: BannerRow, accountId: bigint, now: bigint, what: 'view' | 'click') {
  const day = dayOf(now);
  const s = bumpSeen(ctx, 'banner', b.id, accountId, day, now, what);
  if (!s.counted) return false;
  const key = `${b.id}|${day}`;
  const d = ctx.db.bannerDay.key.find(key);
  const add = { views: what === 'view' ? 1 : 0, clicks: what === 'click' ? 1 : 0 };
  if (d) ctx.db.bannerDay.key.update({ ...d, views: d.views + add.views, clicks: d.clicks + add.clicks });
  else ctx.db.bannerDay.insert({ key, bannerId: b.id, day, ...add });
  return true;
}

export function countSponsor(ctx: PTx, sp: SponsorRow, accountId: bigint, now: bigint, what: 'view' | 'click') {
  if (!sponsorLive(ctx, sp, now)) return false;
  const day = dayOf(now);
  const s = bumpSeen(ctx, 'sponsor', sp.id, accountId, day, now, what);
  if (!s.counted) return false;
  const key = `${sp.id}|${day}`;
  const d = ctx.db.sponsorDay.key.find(key);
  const add = { views: what === 'view' ? 1 : 0, clicks: what === 'click' ? 1 : 0, players: s.first ? 1 : 0 };
  if (d) ctx.db.sponsorDay.key.update({ ...d, views: d.views + add.views, clicks: d.clicks + add.clicks, players: d.players + add.players });
  else ctx.db.sponsorDay.insert({ key, sponsorId: sp.id, day, ...add });
  const t = ctx.db.sponsorTotal.sponsorId.find(sp.id);
  if (t) ctx.db.sponsorTotal.sponsorId.update({ ...t, views: t.views + BigInt(add.views), clicks: t.clicks + BigInt(add.clicks) });
  else ctx.db.sponsorTotal.insert({ sponsorId: sp.id, views: BigInt(add.views), clicks: BigInt(add.clicks) });
  const pk = `${sp.id}|${accountId}`;
  if (!ctx.db.sponsorPlayer.key.find(pk)) ctx.db.sponsorPlayer.insert({ key: pk, sponsorId: sp.id, accountId, firstDay: day });
  return true;
}

export function page<T>(list: T[], pageNo: number, pageSize: number) {
  const size = Math.min(Math.max(pageSize || 20, 1), 100);
  const start = (Math.max(pageNo || 1, 1) - 1) * size;
  return { total: list.length, rows: list.slice(start, start + size) };
}
