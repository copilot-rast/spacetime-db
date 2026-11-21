import type { InferSchema, ProcedureCtx, ReducerCtx } from 'spacetimedb/server';
import { fail, isPanelAccount, type Tr, type Tx } from '@stg/base';
import type { ETx } from '@stg/economy';
import { sendNotification } from '@stg/publication';
import type { SocialSchema } from './schema';

export type SS = InferSchema<SocialSchema>;
export type STx = ReducerCtx<SS>;
export type SProc = ProcedureCtx<SS>;
export type SDb = { db: STx['db'] };

export const DAY_US = 86_400_000_000n;
export const HOUR_US = 3_600_000_000n;
export const MIN_US = 60_000_000n;
export const TEHRAN_US = 12_600_000_000n;

export function base(ctx: unknown) {
  return ctx as Tx;
}

export function econ(ctx: unknown) {
  return ctx as ETx;
}

export function socialSettings(ctx: SDb) {
  const s = ctx.db.socialSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function nowUs(ctx: { db: STx['db']; timestamp: STx['timestamp'] }) {
  const s = ctx.db.socialSettings.id.find(0);
  return ctx.timestamp.microsSinceUnixEpoch + BigInt(s?.clockOffsetSec ?? 0n) * 1_000_000n;
}

export function tehranDay(us: bigint) {
  return Number((us + TEHRAN_US) / DAY_US);
}

export function tehranDayEnd(day: number) {
  return BigInt(day + 1) * DAY_US - TEHRAN_US;
}

export function sessionId(ctx: { db: STx['db']; sender: STx['sender'] }) {
  return ctx.db.session.identity.find(ctx.sender)?.accountId;
}

export function isPlayer(ctx: SDb, accountId: bigint) {
  const a = ctx.db.account.id.find(accountId);
  return !!a && a.status === 'active' && !isPanelAccount(a);
}

export function nameOf(ctx: SDb, accountId: bigint) {
  return ctx.db.account.id.find(accountId)?.displayName ?? '';
}

export function edgeOf(ctx: SDb, a: bigint, b: bigint) {
  return ctx.db.edge.key.find(`${a}|${b}`) ?? undefined;
}

export function areFriends(ctx: SDb, a: bigint, b: bigint) {
  return edgeOf(ctx, a, b)?.state === 'friend';
}

export function blockedEither(ctx: SDb, a: bigint, b: bigint) {
  return edgeOf(ctx, a, b)?.state === 'blocked' || edgeOf(ctx, b, a)?.state === 'blocked';
}

export function friendIds(ctx: SDb, accountId: bigint) {
  return [...ctx.db.edge.accountId.filter(accountId)].filter(e => e.state === 'friend').map(e => e.otherId);
}

export function tagSet(ctx: SDb, accountId: bigint) {
  return new Set([...ctx.db.userTag.byAccountTag.filter(accountId)].map(u => u.tagId));
}

export function metaBonus(ctx: SDb, accountId: bigint, key: string) {
  if (!key) return 0;
  const m = ctx.db.meta.key.find(key);
  if (!m) return 0;
  const v = [...ctx.db.userMeta.byAccountMeta.filter([accountId, key])][0]?.value ?? m.defaultValue;
  return Number.isFinite(v) ? Math.max(Math.floor(v), 0) : 0;
}

type RuleLike = { id: bigint; name: string; priority: number; tagIds: bigint[]; isActive: boolean };

export function matchingRules<R extends RuleLike>(ctx: SDb, accountId: bigint, rules: Iterable<R>) {
  const tags = tagSet(ctx, accountId);
  return [...rules].filter(r => r.isActive && r.tagIds.some(t => tags.has(t))).sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
}

export function resolveLimits<R extends RuleLike, F extends string>(
  list: R[],
  policy: string,
  defaults: Record<F, number>,
  get: (r: R, f: F) => number | undefined,
  waits: string[] = []
) {
  const out = { ...defaults };
  const top = list[0];
  for (const f of Object.keys(defaults) as F[]) {
    if (policy === 'generous') {
      const vals = list.map(r => get(r, f)).filter((v): v is number => v !== undefined);
      if (!vals.length) continue;
      if (waits.includes(f)) out[f] = Math.min(...vals);
      else out[f] = vals.includes(0) ? 0 : Math.max(...vals);
    } else if (top) {
      const v = get(top, f);
      if (v !== undefined) out[f] = v;
    }
  }
  return { values: out, rule: top ? { id: top.id, name: top.name } : undefined };
}

export function withBonus(limit: number, bonus: number) {
  return limit === 0 ? 0 : limit + bonus;
}

export function checkRate(ctx: STx, key: string, limit: number, code: string) {
  if (!limit) return;
  const minute = ctx.timestamp.microsSinceUnixEpoch / MIN_US;
  const k = `${key}|${minute}`;
  const r = ctx.db.socialRate.key.find(k);
  if (r && r.count >= limit) fail(code);
  if (r) ctx.db.socialRate.key.update({ ...r, count: r.count + 1 });
  else ctx.db.socialRate.insert({ key: k, minute, count: 1 });
}

export function bump(table: { key: { find(k: string): { key: string; count: number } | null | undefined; update(r: { key: string; count: number }): unknown }; insert(r: { key: string; count: number }): unknown }, key: string, delta: number) {
  const r = table.key.find(key);
  const count = Math.max((r?.count ?? 0) + delta, 0);
  if (r) table.key.update({ key, count });
  else if (delta > 0) table.insert({ key, count });
}

export function tagsOk(ctx: SDb, ids: bigint[]) {
  if (!ids.length) fail('TAGS_REQUIRED');
  if (ids.length > 20) fail('TOO_MANY_TAGS');
  const seen = new Set<bigint>();
  for (const id of ids) {
    const t = ctx.db.tag.id.find(id);
    if (!t) fail('TAG_NOT_FOUND');
    if (t.keyType !== 'user') fail('TAG_KIND_MISMATCH');
    seen.add(id);
  }
  return [...seen];
}

export function cleanName(raw: string, max = 80) {
  const n = raw.trim().replace(/\s+/g, ' ');
  if (!n || [...n].length > max) fail('INVALID_NAME');
  return n;
}

export function checkPriority(p: number) {
  if (p < -1000 || p > 1000) fail('INVALID_PRIORITY');
}

export function metaOk(ctx: SDb, key: string) {
  const k = key.trim();
  if (k && !ctx.db.meta.key.find(k)) fail('META_NOT_FOUND');
  return k;
}

export function oneOf(v: string, list: string[], field: string) {
  if (!list.includes(v)) fail(`INVALID_SETTING:${field}`);
  return v;
}

export function notify(ctx: STx, accountId: bigint, channels: string[], kind: string, title: Tr[], body: Tr[], actionValue: string, vars: Record<string, string> = {}) {
  if (!channels.length || !ctx.db.notifyCategory.key.find('social')) return;
  try {
    sendNotification(ctx, accountId, { categoryKey: 'social', kind, channels, title, body, actionType: 'screen', actionValue, vars });
  } catch {}
}

export const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];

export function page<T>(list: T[], pageNo: number, pageSize: number) {
  const size = Math.min(Math.max(pageSize || 20, 1), 100);
  const start = (Math.max(pageNo || 1, 1) - 1) * size;
  return { total: list.length, rows: list.slice(start, start + size) };
}
