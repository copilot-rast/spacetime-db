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

export const PLAYER_QUERIES = [
  'SELECT * FROM players_account_rules',
  'SELECT * FROM players_app_version',
  'SELECT * FROM players_country',
  'SELECT * FROM players_tag_meta',
  'SELECT * FROM players_report_title',
  'SELECT * FROM my_status',
  'SELECT * FROM my_tags',
  'SELECT * FROM my_profile',
  'SELECT * FROM admin_report_rules',
];

export const ECONOMY_QUERIES = [
  'SELECT * FROM economy_currency',
  'SELECT * FROM economy_meta',
  'SELECT * FROM economy_prize',
  'SELECT * FROM economy_prize_group',
  'SELECT * FROM my_wallet',
  'SELECT * FROM my_metas',
  'SELECT * FROM shop',
  'SELECT * FROM admin_payment_methods',
  'SELECT * FROM admin_economy_settings',
];

export const GAMIFICATION_QUERIES = [
  'SELECT * FROM gam_event_type',
  'SELECT * FROM my_rewards',
  'SELECT * FROM my_levels',
  'SELECT * FROM my_meta_relations',
  'SELECT * FROM my_achievements',
  'SELECT * FROM admin_gamification_settings',
  'SELECT * FROM admin_event_rules',
  'SELECT * FROM admin_level_tables',
  'SELECT * FROM admin_streaks',
  'SELECT * FROM admin_meta_relations',
  'SELECT * FROM admin_tasks',
  'SELECT * FROM admin_task_groups',
  'SELECT * FROM admin_achievements',
];

export function connect(token?: string, extra: string[] = []): Promise<Client> {
  return new Promise((resolve, reject) => {
    const b = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((conn, _id, tok) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve({ conn, token: tok }))
          .onError(ctx => reject(ctx.event))
          .subscribe([...ALL_QUERIES, ...extra]);
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
  const err = await errorOf(c.conn.procedures.requestOtp({ phone }));
  const wait = err.match(/RETRY_LATER:(\d+)/);
  if (wait) {
    await new Promise(r => setTimeout(r, Number(wait[1]) * 1000 + 500));
    await c.conn.procedures.requestOtp({ phone });
  } else if (err) throw new Error(err);
  const r = await c.conn.procedures.verifyOtp({ phone, code: lastSandboxCode(phone) });
  if (!r.ok) throw new Error(`login failed ${phone}: ${r.error}`);
  await waitFor(() => [...c.conn.db.me.iter()].length === 1);
  return r;
}

export function uniquePhone(prefix = '0935') {
  return `${prefix}${String(Date.now() * 1000 + Math.floor(Math.random() * 1000)).slice(-7)}`;
}

export const tr = (fa: string, en?: string) => (en ? [{ lang: 'fa', text: fa }, { lang: 'en', text: en }] : [{ lang: 'fa', text: fa }]);
