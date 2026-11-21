import { execFileSync } from 'node:child_process';
import { DbConnection } from './bindings/index.ts';

export const URI = process.env.STG_URI ?? 'ws://127.0.0.1:7500';
export const DB = process.env.STG_DB ?? 'stg-template';
export const SERVER = process.env.STG_SERVER ?? 'stglocal';

let passed = 0;

export function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) {
    console.error(`FAIL ${name}`, detail ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`ok   ${name}`);
}

export function done(label: string) {
  console.log(`\n${passed} checks passed (${label})`);
  process.exit(0);
}

export type Client = { conn: DbConnection; token: string };

export const ALL_QUERIES = [
  'SELECT * FROM me',
  'SELECT * FROM my_role',
  'SELECT * FROM base_brand',
  'SELECT * FROM base_language',
  'SELECT * FROM base_key_type',
  'SELECT * FROM base_category',
  'SELECT * FROM base_tag',
  'SELECT * FROM admin_settings',
  'SELECT * FROM admin_sms_providers',
  'SELECT * FROM admin_test_phones',
  'SELECT * FROM admin_sandbox_sms',
  'SELECT * FROM admin_admins',
];

export function connect(token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const b = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((conn, _id, tok) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve({ conn, token: tok }))
          .onError(ctx => reject(ctx.event))
          .subscribe(ALL_QUERIES);
      })
      .onConnectError((_c, e) => reject(e));
    if (token) b.withToken(token);
    b.build();
  });
}

export function sql(query: string): string {
  return execFileSync('spacetime', ['sql', DB, '-s', SERVER, '--no-config', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function lastSandboxCode(phone: string): string {
  const out = sql(`SELECT id, text FROM base_sandbox_sms WHERE phone = '${phone}'`);
  const rows = [...out.matchAll(/^\s*(\d+)\s*\|\s*"(.*)"\s*$/gm)].map(m => ({ id: BigInt(m[1]), text: m[2] }));
  if (!rows.length) throw new Error(`no sandbox sms for ${phone}`);
  rows.sort((a, b) => (a.id < b.id ? 1 : -1));
  const m = rows[0].text.match(/(\d{4,8})\s*$/);
  if (!m) throw new Error(`no code in ${rows[0].text}`);
  return m[1];
}

export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (e) {
    return String((e as Error)?.message ?? e);
  }
}

export async function waitFor(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, 30));
  }
  return fn();
}

export async function login(c: Client, phone: string) {
  await c.conn.procedures.requestOtp({ phone });
  const r = await c.conn.procedures.verifyOtp({ phone, code: lastSandboxCode(phone) });
  if (!r.ok) throw new Error(`login failed ${phone}: ${r.error}`);
  await waitFor(() => [...c.conn.db.me.iter()].length === 1);
  return r;
}

export function uniquePhone(prefix = '0935') {
  return `${prefix}${String(Date.now() * 1000 + Math.floor(Math.random() * 1000)).slice(-7)}`;
}

export const tr = (fa: string, en?: string) => (en ? [{ lang: 'fa', text: fa }, { lang: 'en', text: en }] : [{ lang: 'fa', text: fa }]);
