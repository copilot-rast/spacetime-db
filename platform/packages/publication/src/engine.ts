import type { InferSchema, ProcedureCtx, ReducerCtx } from 'spacetimedb/server';
import { fail, isPanelAccount, translate, type Tr, type Tx } from '@stg/base';
import type { ETx } from '@stg/economy';
import { playerLevel } from '@stg/gamification';
import type { PublicationSchema } from './schema';

export type PS = InferSchema<PublicationSchema>;
export type PTx = ReducerCtx<PS>;
export type PProc = ProcedureCtx<PS>;
export type PDb = { db: PTx['db'] };
export type CampaignRow = NonNullable<ReturnType<PTx['db']['campaign']['id']['find']>>;
export type RuleRow = NonNullable<ReturnType<PTx['db']['autoRule']['id']['find']>>;
export type NewsRow = NonNullable<ReturnType<PTx['db']['news']['id']['find']>>;
export type AccountRow = NonNullable<ReturnType<PTx['db']['account']['id']['find']>>;

export const DAY_US = 86_400_000_000n;
export const MIN_US = 60_000_000n;
export const TEHRAN_US = 12_600_000_000n;
export const CHANNELS = ['inbox', 'push', 'sms'];
export const ACTIONS = ['none', 'screen', 'url', 'product', 'achievement', 'news'];
export const PLATFORMS = ['android', 'ios', 'web'];

export function base(ctx: unknown) {
  return ctx as Tx;
}

export function econ(ctx: unknown) {
  return ctx as ETx;
}

export function pubSettings(ctx: PDb) {
  const s = ctx.db.pubSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function newsSettings(ctx: PDb) {
  const s = ctx.db.newsSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function nowUs(ctx: { db: PTx['db']; timestamp: PTx['timestamp'] }) {
  const s = ctx.db.pubSettings.id.find(0);
  return ctx.timestamp.microsSinceUnixEpoch + BigInt(s?.clockOffsetSec ?? 0n) * 1_000_000n;
}

export function tehranDay(us: bigint) {
  return Number((us + TEHRAN_US) / DAY_US);
}

export function minuteOfDay(us: bigint) {
  return Number(((us + TEHRAN_US) % DAY_US) / MIN_US);
}

export function quietUntil(start: number, end: number, now: bigint) {
  if (start === end) return 0n;
  const m = minuteOfDay(now);
  const inside = start < end ? m >= start && m < end : m >= start || m < end;
  if (!inside) return 0n;
  const dayStart = BigInt(tehranDay(now)) * DAY_US - TEHRAN_US;
  let at = dayStart + BigInt(end) * MIN_US;
  if (at <= now) at += DAY_US;
  return at;
}

export function checkQuiet(start: number, end: number) {
  if (start > 1439 || end > 1440) fail('INVALID_QUIET_HOURS');
}

export function checkRate(ctx: PTx, key: string, limit: number, code = 'TOO_MANY_REQUESTS') {
  if (!limit) return;
  const minute = ctx.timestamp.microsSinceUnixEpoch / MIN_US;
  const k = `${key}|${minute}`;
  const r = ctx.db.pubRate.key.find(k);
  if (r && r.count >= limit) fail(code);
  if (r) ctx.db.pubRate.key.update({ ...r, count: r.count + 1 });
  else ctx.db.pubRate.insert({ key: k, minute, count: 1 });
}

export function rateLeft(ctx: PTx, key: string, limit: number) {
  if (!limit) return true;
  const minute = ctx.timestamp.microsSinceUnixEpoch / MIN_US;
  const k = `${key}|${minute}`;
  const r = ctx.db.pubRate.key.find(k);
  if (r && r.count >= limit) return false;
  if (r) ctx.db.pubRate.key.update({ ...r, count: r.count + 1 });
  else ctx.db.pubRate.insert({ key: k, minute, count: 1 });
  return true;
}

export function langList(ctx: PDb) {
  return new Set([...ctx.db.language.iter()].filter(l => l.isActive).map(l => l.code));
}

export function defaultLang(ctx: PDb) {
  return ctx.db.settings.id.find(0)?.defaultLang ?? 'fa';
}

export function langOf(ctx: PDb, accountId: bigint, asked = '') {
  const active = langList(ctx);
  if (asked && active.has(asked)) return asked;
  const a = ctx.db.account.id.find(accountId);
  if (a && active.has(a.lang)) return a.lang;
  return defaultLang(ctx);
}

export function pick(list: Tr[], lang: string, ctx: PDb) {
  return translate(list, lang, defaultLang(ctx));
}

export function cleanText(ctx: PDb, list: Tr[], max: number, required: boolean, code = 'TITLE_REQUIRED') {
  const seen = new Set<string>();
  const out: Tr[] = [];
  for (const item of list) {
    const lang = item.lang.trim();
    const text = item.text.trim();
    if (!lang || !text || seen.has(lang)) continue;
    if (!ctx.db.language.code.find(lang)) fail('UNKNOWN_LANGUAGE');
    if (text.length > max) fail('TEXT_TOO_LONG');
    seen.add(lang);
    out.push({ lang, text });
  }
  if (required && !out.length) fail(code);
  return out;
}

export function fillVars(list: Tr[], vars: Record<string, string>) {
  return list.map(x => ({ lang: x.lang, text: x.text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]{0,40})\}/g, (m, k: string) => (k in vars ? vars[k] : m)) }));
}

export function cleanUrl(s: string, code = 'INVALID_URL') {
  const v = s.trim();
  if (v && !/^(https?:\/\/[^\s<>"']+|\/[^\s<>"']*)$/.test(v)) fail(code);
  if (v.length > 1000) fail(code);
  return v;
}

export function cleanAbsUrl(s: string, code = 'INVALID_URL') {
  const v = s.trim();
  if (v && !/^https?:\/\/[^\s<>"']+$/.test(v)) fail(code);
  if (v.length > 1000) fail(code);
  return v;
}

export function checkTags(ctx: PDb, ids: bigint[], kinds: string[], max = 50) {
  if (ids.length > max) fail('TOO_MANY_TAGS');
  for (const id of ids) {
    const tag = ctx.db.tag.id.find(id);
    if (!tag) fail('TAG_NOT_FOUND');
    if (!kinds.includes(tag.keyType)) fail('TAG_KIND_MISMATCH');
  }
  return [...new Set(ids)];
}

export function cleanAction(ctx: PDb, type: string, value: string) {
  const t = type || 'none';
  if (!ACTIONS.includes(t)) fail('INVALID_ACTION');
  let v = value.trim();
  if (t === 'none') v = '';
  if (t === 'screen' && !/^[A-Za-z0-9_./:-]{1,100}$/.test(v)) fail('INVALID_ACTION_VALUE');
  if (t === 'url') {
    if (!v) fail('INVALID_URL');
    v = cleanAbsUrl(v);
  }
  if (t === 'product' && !ctx.db.product.key.find(v)) fail('PRODUCT_NOT_FOUND');
  if (t === 'achievement' && !ctx.db.achievement.key.find(v)) fail('ACHIEVEMENT_NOT_FOUND');
  if (t === 'news' && !(/^\d+$/.test(v) && ctx.db.news.id.find(BigInt(v)))) fail('NEWS_NOT_FOUND');
  return { actionType: t, actionValue: v };
}

export function cleanChannels(list: string[]) {
  const out = [...new Set(list.map(c => c.trim()))];
  if (!out.length) fail('CHANNEL_REQUIRED');
  for (const c of out) if (!CHANNELS.includes(c)) fail('INVALID_CHANNEL');
  return out;
}

export function sessionAccountId(ctx: { db: PTx['db']; sender: PTx['sender'] }) {
  return ctx.db.session.identity.find(ctx.sender)?.accountId;
}

export function isPlayer(a: AccountRow | undefined | null) {
  return !!a && a.status === 'active' && !isPanelAccount(a);
}

export function playerTags(ctx: PDb, accountId: bigint) {
  return [...ctx.db.userTag.byAccountTag.filter(accountId)].map(u => u.tagId);
}

export type Audience = {
  tagIds: bigint[];
  excludeTagIds: bigint[];
  levelTableId: bigint;
  minLevel: number;
  maxLevel: number;
  countries: string[];
  inactiveDays: number;
};

export function audienceBlock(ctx: PTx, a: AccountRow, f: Audience, now: bigint, needTag: boolean) {
  if (!isPlayer(a)) return 'not_player';
  const tags = f.tagIds.length || f.excludeTagIds.length ? playerTags(ctx, a.id) : [];
  if (f.excludeTagIds.some(t => tags.includes(t))) return 'excluded';
  if (needTag && f.tagIds.length && !f.tagIds.some(t => tags.includes(t))) return 'audience';
  if (f.minLevel || f.maxLevel) {
    const lvl = playerLevel(ctx, a.id, f.levelTableId);
    if (f.minLevel && lvl < f.minLevel) return 'level_low';
    if (f.maxLevel && lvl > f.maxLevel) return 'level_high';
  }
  if (f.countries.length) {
    const c = ctx.db.profile.accountId.find(a.id)?.countryCode ?? '';
    if (!f.countries.includes(c)) return 'country';
  }
  if (f.inactiveDays) {
    const last = a.lastLoginAt.microsSinceUnixEpoch;
    if (now - last < BigInt(f.inactiveDays) * DAY_US) return 'active';
  }
  return '';
}

export function mask(token: string) {
  if (token.length <= 12) return '****';
  return `${token.slice(0, 6)}****${token.slice(-4)}`;
}

export function page<T>(list: T[], pageNo: number, pageSize: number) {
  const size = Math.min(Math.max(pageSize || 20, 1), 100);
  const start = (Math.max(pageNo || 1, 1) - 1) * size;
  return { total: list.length, rows: list.slice(start, start + size) };
}

export function query(url: string) {
  const out: Record<string, string> = {};
  const i = url.indexOf('?');
  if (i < 0) return out;
  for (const part of url.slice(i + 1).split('#')[0].split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = eq < 0 ? part : part.slice(0, eq);
    const v = eq < 0 ? '' : part.slice(eq + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {}
  }
  return out;
}

export function formEncode(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
