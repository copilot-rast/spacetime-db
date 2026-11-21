import { useMemo, useSyncExternalStore } from 'react';
import { DbConnection } from './bindings/index.ts';

export type Cfg = { server: string; db: string };
export type Phase = 'idle' | 'connecting' | 'ready' | 'error' | 'lost';

export type Snap = {
  cfg: Cfg | null;
  phase: Phase;
  error: string;
  conn: DbConnection | null;
  version: number;
  mut: number;
};

const CFG_KEY = 'stg.conn';
const RECENT_KEY = 'stg.recent';

export const QUERIES = [
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
  'SELECT * FROM players_account_rules',
  'SELECT * FROM players_app_version',
  'SELECT * FROM players_country',
  'SELECT * FROM players_tag_meta',
  'SELECT * FROM players_report_title',
  'SELECT * FROM admin_report_rules',
  'SELECT * FROM economy_currency',
  'SELECT * FROM economy_meta',
  'SELECT * FROM economy_prize',
  'SELECT * FROM economy_prize_group',
  'SELECT * FROM admin_payment_methods',
  'SELECT * FROM admin_economy_settings',
  'SELECT * FROM gam_event_type',
  'SELECT * FROM items_item',
  'SELECT * FROM items_product_rule',
  'SELECT * FROM items_type',
  'SELECT * FROM promo_chance_game',
  'SELECT * FROM promo_placement',
  'SELECT * FROM admin_achievements',
  'SELECT * FROM admin_banners',
  'SELECT * FROM admin_event_rules',
  'SELECT * FROM admin_level_tables',
  'SELECT * FROM admin_meta_relations',
  'SELECT * FROM admin_offers',
  'SELECT * FROM admin_sponsors',
  'SELECT * FROM admin_streaks',
  'SELECT * FROM admin_task_groups',
  'SELECT * FROM admin_tasks',
  'SELECT * FROM admin_gamification_settings',
  'SELECT * FROM admin_items_settings',
  'SELECT * FROM admin_offer_settings',
  'SELECT * FROM admin_promo_settings',
];

const TABLES = [
  'me',
  'myRole',
  'brand',
  'language',
  'keyType',
  'category',
  'tag',
  'adminSettings',
  'adminSmsProviders',
  'adminTestPhones',
  'adminSandboxSms',
  'adminAdmins',
  'accountRules',
  'appVersion',
  'country',
  'tagMeta',
  'reportTitle',
  'adminReportRules',
  'currency',
  'meta',
  'prize',
  'prizeGroup',
  'adminPaymentMethods',
  'adminEconomySettings',
  'eventType',
  'item',
  'productRule',
  'itemType',
  'chanceGame',
  'placement',
  'adminAchievements',
  'adminBanners',
  'adminEventRules',
  'adminLevelTables',
  'adminMetaRelations',
  'adminOffers',
  'adminSponsors',
  'adminStreaks',
  'adminTaskGroups',
  'adminTasks',
  'adminGamificationSettings',
  'adminItemsSettings',
  'adminOfferSettings',
  'adminPromoSettings',
] as const;

export function defaultServer() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stdb/`;
}

export function normServer(raw: string) {
  let v = raw.trim();
  if (!v) return defaultServer();
  if (v.startsWith('/')) v = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${v}`;
  if (!/^(wss?|https?):\/\//.test(v)) v = `ws://${v}`;
  v = v.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (!v.endsWith('/')) v += '/';
  return v;
}

function readCfg(): Cfg | null {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) ?? 'null');
    if (c && typeof c.server === 'string' && typeof c.db === 'string' && c.db) return c;
  } catch {}
  return null;
}

function tokenKey(c: Cfg) {
  return `stg.token:${c.server}|${c.db}`;
}

export function recentDbs(): Cfg[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(x => x && x.server && x.db) : [];
  } catch {
    return [];
  }
}

function rememberDb(c: Cfg) {
  const list = [c, ...recentDbs().filter(x => !(x.server === c.server && x.db === c.db))].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

let snap: Snap = { cfg: readCfg(), phase: 'idle', error: '', conn: null, version: 0, mut: 0 };
const listeners = new Set<() => void>();
let pendingBump = false;
let attempt = 0;
let retryTimer: number | undefined;

function emit(patch: Partial<Snap>) {
  snap = { ...snap, ...patch };
  listeners.forEach(f => f());
}

function bump() {
  if (pendingBump) return;
  pendingBump = true;
  queueMicrotask(() => {
    pendingBump = false;
    emit({ version: snap.version + 1 });
  });
}

export function markMutation() {
  emit({ mut: snap.mut + 1 });
}

function watch(conn: DbConnection) {
  for (const name of TABLES) {
    const tb = (conn.db as unknown as Record<string, any>)[name];
    if (!tb) continue;
    tb.onInsert?.(bump);
    tb.onDelete?.(bump);
    tb.onUpdate?.(bump);
  }
}

export function connect(cfg: Cfg | null = snap.cfg) {
  if (!cfg) return;
  window.clearTimeout(retryTimer);
  const my = ++attempt;
  try {
    snap.conn?.disconnect();
  } catch {}
  emit({ cfg, phase: 'connecting', error: '', conn: null });
  const token = localStorage.getItem(tokenKey(cfg)) ?? undefined;
  let everReady = false;
  const b = DbConnection.builder()
    .withUri(cfg.server)
    .withDatabaseName(cfg.db)
    .onConnect((conn, _identity, tok) => {
      if (my !== attempt) return;
      localStorage.setItem(tokenKey(cfg), tok);
      watch(conn);
      conn
        .subscriptionBuilder()
        .onApplied(() => {
          if (my !== attempt) return;
          everReady = true;
          rememberDb(cfg);
          emit({ phase: 'ready', conn, version: snap.version + 1 });
        })
        .onError(ctx => {
          if (my !== attempt) return;
          emit({ phase: 'error', error: String((ctx as any)?.event?.message ?? (ctx as any)?.event ?? 'subscription failed') });
        })
        .subscribe(QUERIES);
    })
    .onConnectError((_c, e) => {
      if (my !== attempt) return;
      emit({ phase: 'error', error: String((e as Error)?.message ?? e), conn: null });
    })
    .onDisconnect(() => {
      if (my !== attempt) return;
      if (everReady) {
        emit({ phase: 'lost', conn: null });
        retryTimer = window.setTimeout(() => connect(cfg), 1500);
      }
    });
  if (token) b.withToken(token);
  b.build();
}

export function saveCfg(cfg: Cfg) {
  const c = { server: normServer(cfg.server), db: cfg.db.trim() };
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
  connect(c);
}

export function forgetCfg() {
  attempt++;
  try {
    snap.conn?.disconnect();
  } catch {}
  localStorage.removeItem(CFG_KEY);
  emit({ cfg: null, phase: 'idle', conn: null, error: '' });
}

export function resetToken() {
  if (!snap.cfg) return;
  localStorage.removeItem(tokenKey(snap.cfg));
  connect(snap.cfg);
}

export function useSnap(): Snap {
  return useSyncExternalStore(
    f => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => snap
  );
}

export function getConn(): DbConnection {
  if (!snap.conn) throw new Error('NOT_CONNECTED');
  return snap.conn;
}

type Db = DbConnection['db'];
type TableName = (typeof TABLES)[number];
export type RowOf<K extends TableName> = Db[K] extends { iter(): IterableIterator<infer R> } ? R : never;

export function useRows<K extends TableName>(name: K): RowOf<K>[] {
  const s = useSnap();
  return useMemo(() => {
    if (!s.conn) return [];
    return [...((s.conn.db as any)[name].iter() as Iterable<RowOf<K>>)];
  }, [s.conn, s.version, name]);
}

export function useOne<K extends TableName>(name: K): RowOf<K> | undefined {
  return useRows(name)[0];
}

if (snap.cfg) connect(snap.cfg);
