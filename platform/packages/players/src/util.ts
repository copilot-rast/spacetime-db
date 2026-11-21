import type { InferSchema, ProcedureCtx, ReducerCtx } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { fail, translate, type Tr } from '@stg/base';
import type { PlayersSchema } from './schema';

export type PS = InferSchema<PlayersSchema>;
export type PTx = ReducerCtx<PS>;
export type PProc = ProcedureCtx<PS>;

export const PLATFORMS = ['android', 'ios', 'web', 'windows', 'macos', 'linux'] as const;
export const STORES = ['google_play', 'app_store', 'bazaar', 'myket', 'microsoft_store', 'steam', 'web', 'direct'] as const;
export const RESTRICTION_KINDS = ['suspend', 'mute', 'warn'] as const;

const VERSION_RE = /^v?(\d+(?:\.\d+){0,3})(?:([-+])([0-9A-Za-z.-]+))?$/;

export function parseVersion(v: string) {
  const m = v.trim().match(VERSION_RE);
  if (!m) return undefined;
  const parts = m[1].split('.').map(Number);
  while (parts.length < 4) parts.push(0);
  return { parts, pre: m[2] === '-' ? m[3] : '' };
}

export function cleanVersion(v: string, required: boolean): string {
  const s = v.trim();
  if (!s) {
    if (required) fail('VERSION_REQUIRED');
    return '';
  }
  if (!parseVersion(s)) fail('INVALID_VERSION');
  return s;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) fail('INVALID_VERSION');
  for (let i = 0; i < 4; i++) {
    if (x.parts[i] !== y.parts[i]) return x.parts[i] < y.parts[i] ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export function nowMicros(ctx: { timestamp: Timestamp }) {
  return ctx.timestamp.microsSinceUnixEpoch;
}

export function isoOf(ts: Timestamp) {
  return new Date(Number(ts.microsSinceUnixEpoch / 1000n)).toISOString();
}

export function langOf(ctx: PTx, accountId: bigint) {
  const def = ctx.db.settings.id.find(0)?.defaultLang ?? 'fa';
  return { lang: ctx.db.account.id.find(accountId)?.lang ?? def, def };
}

export function tr(ctx: PTx, accountId: bigint, list: Tr[]) {
  const { lang, def } = langOf(ctx, accountId);
  return translate(list, lang, def);
}

export function activeRestriction(ctx: PTx, accountId: bigint, kind: string) {
  const now = nowMicros(ctx);
  for (const r of ctx.db.restriction.accountId.filter(accountId)) {
    if (r.kind === kind && r.status === 'active' && r.endsAt.microsSinceUnixEpoch > now) return r;
  }
  return undefined;
}

export function pageOf(p: number, size: number) {
  const pageSize = Math.min(Math.max(size || 20, 1), 100);
  const pageNo = Math.max(p || 1, 1);
  return { start: (pageNo - 1) * pageSize, pageSize };
}

export function hourKey(ctx: PTx) {
  return String(nowMicros(ctx) / 3_600_000_000n);
}

export function cleanContext(s: string, max: number) {
  const v = s.trim();
  if ([...v].length > max || /[\u0000-\u001f\u007f]/.test(v)) fail('INVALID_CONTEXT');
  return v;
}
