import { SenderError, type InferSchema, type ProcedureCtx, type ReducerCtx } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { BaseSchema, Role } from './schema';
import { checkAccountGuards } from './hooks';

export type S = InferSchema<BaseSchema>;
export type Tx = ReducerCtx<S>;
export type Proc = ProcedureCtx<S>;

export type Tr = { lang: string; text: string };

const ROLE_RANK: Record<string, number> = { operator: 1, admin: 2, owner: 3 };

export function fail(code: string): never {
  throw new SenderError(code);
}

export function toLatinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

export function normalizePhone(raw: string): string {
  let d = toLatinDigits(raw).replace(/[^0-9]/g, '');
  if (d.startsWith('0098')) d = '0' + d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = '0' + d.slice(2);
  else if (d.length === 10 && d.startsWith('9')) d = '0' + d;
  if (!/^09\d{9}$/.test(d)) fail('INVALID_PHONE');
  return d;
}

export function sign(secret: string, message: string): Uint8Array {
  return hmac(sha256, utf8ToBytes(secret), utf8ToBytes(message));
}

export function signHex(secret: string, message: string): string {
  return bytesToHex(sign(secret, message));
}

export function digitsFrom(mac: Uint8Array, length: number): string {
  const n = (((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0) % 10 ** length;
  return String(n).padStart(length, '0');
}

export function micros(ts: Timestamp): bigint {
  return ts.microsSinceUnixEpoch;
}

export function addSeconds(ts: Timestamp, sec: number): Timestamp {
  return new Timestamp(ts.microsSinceUnixEpoch + BigInt(sec) * 1_000_000n);
}

export function dayKey(ts: Timestamp): string {
  const tehran = Number(ts.microsSinceUnixEpoch / 1000n) + 3.5 * 3600 * 1000;
  return new Date(tehran).toISOString().slice(0, 10);
}

export function settingsOf(ctx: Tx) {
  const s = ctx.db.settings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function sessionAccount(ctx: Tx) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  return ctx.db.account.id.find(s.accountId) ?? undefined;
}

export function requireAccount(ctx: Tx) {
  const a = sessionAccount(ctx);
  if (!a) fail('NOT_LOGGED_IN');
  if (a.status !== 'active') fail('ACCOUNT_BLOCKED');
  const g = checkAccountGuards(ctx, a.id);
  if (g) fail(g.code);
  return a;
}

export const PANEL_PREFIX = 'admin:';

export function isPanelAccount(a: { phone: string } | null | undefined) {
  return !!a && a.phone.startsWith(PANEL_PREFIX);
}

export function roleOf(ctx: Tx, accountId: bigint): string | undefined {
  if (!isPanelAccount(ctx.db.account.id.find(accountId))) return undefined;
  return ctx.db.admin.accountId.find(accountId)?.role;
}

export function hasRole(role: string | undefined, need: Role): boolean {
  return !!role && (ROLE_RANK[role] ?? 0) >= ROLE_RANK[need];
}

export function requireRole(ctx: Tx, need: Role) {
  const a = requireAccount(ctx);
  if (!hasRole(roleOf(ctx, a.id), need)) fail('FORBIDDEN');
  return a;
}

export function adminOrNull(ctx: { db: Tx['db']; sender: Tx['sender'] }, need: Role = 'operator') {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  if (!a || a.status !== 'active' || !isPanelAccount(a)) return undefined;
  return hasRole(ctx.db.admin.accountId.find(a.id)?.role, need) ? a : undefined;
}

export function audit(ctx: Tx, accountId: bigint, action: string, target: string, detail = '') {
  ctx.db.audit.insert({ id: 0n, accountId, action, target, detail: detail.slice(0, 500), at: ctx.timestamp });
}

export function cleanTranslations(list: Tr[], ctx: Tx, required = true): Tr[] {
  const seen = new Set<string>();
  const out: Tr[] = [];
  for (const item of list) {
    const lang = item.lang.trim();
    const text = item.text.trim();
    if (!lang || !text || seen.has(lang)) continue;
    if (!ctx.db.language.code.find(lang)) fail('UNKNOWN_LANGUAGE');
    seen.add(lang);
    out.push({ lang, text: text.slice(0, 500) });
  }
  if (required && out.length === 0) fail('TITLE_REQUIRED');
  return out;
}

export function translate(list: Tr[], lang: string, fallback: string): string {
  return list.find(x => x.lang === lang)?.text ?? list.find(x => x.lang === fallback)?.text ?? list[0]?.text ?? '';
}

export function cleanKey(raw: string): string {
  const k = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(k)) fail('INVALID_KEY');
  return k;
}

export function maskSecret(s: string): string {
  if (!s) return '';
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}
