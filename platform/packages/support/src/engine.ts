import type { InferSchema, ProcedureCtx, ReducerCtx } from 'spacetimedb/server';
import { fail, hasRole, isPanelAccount, sign, signHex, translate, type ActivityEntry, type Tr, type Tx } from '@stg/base';
import { sendNotification } from '@stg/publication';
import type { SupportSchema } from './schema';

export type SS = InferSchema<SupportSchema>;
export type STx = ReducerCtx<SS>;
export type SProc = ProcedureCtx<SS>;
export type SDb = { db: STx['db'] };
export type TicketRow = NonNullable<ReturnType<STx['db']['supTicket']['id']['find']>>;
export type ChatRow = NonNullable<ReturnType<STx['db']['supChat']['id']['find']>>;
export type ReferralRow = NonNullable<ReturnType<STx['db']['referral']['id']['find']>>;
export type ConfigRow = NonNullable<ReturnType<STx['db']['configKey']['key']['find']>>;

export const MIN_US = 60_000_000n;
export const HOUR_US = 3_600_000_000n;
export const DAY_US = 86_400_000_000n;
export const TEHRAN_US = 12_600_000_000n;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const STATUSES = ['open', 'awaiting_staff', 'awaiting_player', 'resolved', 'closed'];
export const WAITING_STAFF = ['open', 'awaiting_staff'];
export const FINISHED = ['resolved', 'closed'];
export const PLAYER_EVENTS = ['status_changed', 'rated', 'created_from_chat', 'auto_closed', 'created_by_staff'];
export const ATTACHMENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function base(ctx: unknown) {
  return ctx as Tx;
}

export function supSettings(ctx: SDb) {
  const s = ctx.db.supSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function nowUs(ctx: { db: STx['db']; timestamp: STx['timestamp'] }) {
  const s = ctx.db.supSettings.id.find(0);
  return ctx.timestamp.microsSinceUnixEpoch + BigInt(s?.clockOffsetSec ?? 0n) * 1_000_000n;
}

export function tehranDay(us: bigint) {
  return (us + TEHRAN_US) / DAY_US;
}

export function bump(ctx: STx, key: string, limit: number, windowUs: bigint, code: string) {
  if (!limit) return;
  const bucket = ctx.timestamp.microsSinceUnixEpoch / windowUs;
  const k = `${key}|${windowUs}|${bucket}`;
  const r = ctx.db.supRate.key.find(k);
  if (r && r.count >= limit) fail(code);
  if (r) ctx.db.supRate.key.update({ ...r, count: r.count + 1 });
  else ctx.db.supRate.insert({ key: k, bucket: ctx.timestamp.microsSinceUnixEpoch / MIN_US, count: 1 });
}

export function defaultLang(ctx: SDb) {
  return ctx.db.settings.id.find(0)?.defaultLang ?? 'fa';
}

export function langOf(ctx: SDb, accountId: bigint, asked = '') {
  const active = new Set([...ctx.db.language.iter()].filter(l => l.isActive).map(l => l.code));
  if (asked && active.has(asked)) return asked;
  const a = ctx.db.account.id.find(accountId);
  if (a && active.has(a.lang)) return a.lang;
  return defaultLang(ctx);
}

export function pick(ctx: SDb, list: Tr[], lang: string) {
  return translate(list, lang, defaultLang(ctx));
}

export function cleanTr(ctx: SDb, list: Tr[], max: number, required: boolean, code = 'TITLE_REQUIRED') {
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

export function cleanBody(raw: string, max = 5000, required = true) {
  const v = raw.trim();
  if (required && !v) fail('BODY_REQUIRED');
  if (v.length > max) fail('BODY_TOO_LONG');
  return v;
}

export type AttachmentIn = { url: string; name: string; type: string; size: number };

export function cleanAttachments(ctx: SDb, list: AttachmentIn[]) {
  const s = supSettings(ctx);
  if (list.length > s.maxAttachments) fail('TOO_MANY_ATTACHMENTS');
  return list.map(a => {
    const url = a.url.trim();
    if (!/^https:\/\/[^\s<>"']+$/.test(url) || url.length > 1000) fail('INVALID_URL');
    const path = url.split('?')[0].split('#')[0];
    const ext = (path.match(/\.([A-Za-z0-9]{2,5})$/)?.[1] ?? '').toLowerCase();
    const type = ATTACHMENT_TYPES[ext];
    if (!type) fail('ATTACHMENT_TYPE');
    if (a.type && a.type !== type) fail('ATTACHMENT_TYPE');
    if (a.size > s.maxAttachmentKb * 1024) fail('ATTACHMENT_TOO_LARGE');
    const name = (a.name.trim() || path.split('/').pop() || 'file').slice(0, 120);
    return { url, name, type, size: a.size };
  });
}

export function isAgent(ctx: SDb, accountId: bigint) {
  const a = ctx.db.account.id.find(accountId);
  if (!a || a.status !== 'active' || !isPanelAccount(a)) return false;
  return hasRole(ctx.db.admin.accountId.find(accountId)?.role, 'support');
}

export function nameOf(ctx: SDb, accountId: bigint) {
  if (!accountId) return '';
  const a = ctx.db.account.id.find(accountId);
  if (!a) return '';
  return a.displayName || `#${accountId}`;
}

export function isPlayerAccount(a: { phone: string; status: string } | undefined | null) {
  return !!a && a.status === 'active' && !isPanelAccount(a);
}

export function randomCode(secret: string, label: string, length: number) {
  const mac = sign(secret, label);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[mac[i] % CODE_ALPHABET.length];
  return out;
}

export function bucketOf(secret: string, key: string, accountId: bigint) {
  const mac = sign(secret, `config|${key}|${accountId}`);
  return (((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0) % 10000;
}

export function deviceOf(ctx: { env: { OTP_SECRET: string }; sender: STx['sender'] }) {
  return signHex(ctx.env.OTP_SECRET, `device|${ctx.sender.toHexString()}`).slice(0, 24);
}

export function writeActivity(ctx: STx, accountId: bigint, e: ActivityEntry) {
  if (!ctx.db.supSettings.id.find(0)) return;
  ctx.db.playerActivity.insert({
    id: 0n,
    accountId,
    kind: e.kind.slice(0, 40),
    action: e.action.slice(0, 40),
    refId: (e.refId ?? '').slice(0, 64),
    data: (e.data ?? '').slice(0, 1000),
    actor: (e.actor ?? 'system').slice(0, 64),
    device: deviceOf(ctx),
    platform: ctx.db.supClient.accountId.find(accountId)?.platform ?? '',
    country: ctx.db.profile.accountId.find(accountId)?.countryCode ?? '',
    at: nowUs(ctx),
  });
}

export function recordActivity(raw: unknown, accountId: bigint, e: ActivityEntry) {
  writeActivity(raw as STx, accountId, e);
}

export function notifyPlayer(ctx: STx, accountId: bigint, title: Tr[], body: Tr[], actionValue: string) {
  const key = ctx.db.supSettings.id.find(0)?.notifyCategoryKey ?? '';
  const cat = key ? ctx.db.notifyCategory.key.find(key) : undefined;
  if (!cat || !cat.isActive) return 'skipped:category_off';
  const r = sendNotification(ctx, accountId, { kind: 'support', categoryKey: key, channels: ['inbox'], title, body, actionType: 'screen', actionValue });
  return r.status === 'sent' ? 'sent' : `skipped:${r.reason}`;
}

export function page<T>(list: T[], pageNo: number, pageSize: number) {
  const size = Math.min(Math.max(pageSize || 20, 1), 100);
  const start = (Math.max(pageNo || 1, 1) - 1) * size;
  return { total: list.length, rows: list.slice(start, start + size) };
}

export function cleanKeyOf(raw: string, re: RegExp, code = 'INVALID_KEY') {
  const k = raw.trim().toLowerCase();
  if (!re.test(k)) fail(code);
  return k;
}
