import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, fail, requireAccount, requireRole, signHex, type Tr } from '@stg/base';
import { PLATFORMS, compareVersions, parseVersion } from '@stg/players';
import { ConfigRule, supRows, type SupportSchema } from './schema';
import { base, bucketOf, cleanTr, defaultLang, isPlayerAccount, langOf, page, writeActivity, type ConfigRow, type SDb, type STx } from './engine';

export const CONFIG_TYPES = ['string', 'number', 'bool', 'json', 'text'];
const KEY_RE = /^[a-z][a-z0-9_.]{1,63}$/;

type Rule = { name: string; value: string; text: Tr[]; platforms: string[]; minVersion: string; maxVersion: string; tagIds: bigint[]; countries: string[]; percent: number };
export type ClientFacts = { accountId: bigint; platform: string; version: string; country: string; tagIds: bigint[]; lang: string };

const ValueLine = t.object('ConfigValueLine', { key: t.string(), type: t.string(), value: t.string(), variant: t.string() });
const ValueRow = t.row('ConfigValueRow', { key: t.string().primaryKey(), type: t.string(), value: t.string(), variant: t.string() });
const Resolved = t.object('ConfigResolved', { lang: t.string(), values: t.array(ValueLine), hash: t.string(), changed: t.array(t.string()) });
const PreviewLine = t.object('ConfigPreviewLine', { key: t.string(), type: t.string(), value: t.string(), variant: t.string(), bucket: t.u32() });
const Preview = t.object('ConfigPreview', { lang: t.string(), values: t.array(PreviewLine) });
const HistoryPage = t.object('ConfigHistoryPage', { total: t.u32(), rows: t.array(supRows.configHistory) });

function checkValue(ctx: SDb, type: string, value: string, text: Tr[]) {
  if (type === 'text') return { value: '', text: cleanTr(ctx, text, 4000, true, 'VALUE_REQUIRED') };
  const v = value.trim();
  if (v.length > 8000) fail('VALUE_TOO_LONG');
  if (type === 'number' && (v === '' || !Number.isFinite(Number(v)))) fail('INVALID_VALUE');
  if (type === 'bool' && v !== 'true' && v !== 'false') fail('INVALID_VALUE');
  if (type === 'json') {
    try {
      JSON.parse(v);
    } catch {
      fail('INVALID_VALUE');
    }
  }
  return { value: type === 'string' ? value : v, text: [] as Tr[] };
}

function checkRules(ctx: SDb, type: string, rules: Rule[]) {
  if (rules.length > 20) fail('TOO_MANY_RULES');
  const names = new Set<string>();
  return rules.map(r => {
    const name = r.name.trim();
    if (!name || name.length > 60 || name === 'default') fail('INVALID_RULE_NAME');
    if (names.has(name)) fail('DUPLICATE_RULE');
    names.add(name);
    const v = checkValue(ctx, type, r.value, r.text);
    for (const p of r.platforms) if (!(PLATFORMS as readonly string[]).includes(p)) fail('INVALID_PLATFORM');
    const minVersion = r.minVersion.trim();
    const maxVersion = r.maxVersion.trim();
    if (minVersion && !parseVersion(minVersion)) fail('INVALID_VERSION');
    if (maxVersion && !parseVersion(maxVersion)) fail('INVALID_VERSION');
    if (minVersion && maxVersion && compareVersions(minVersion, maxVersion) > 0) fail('INVALID_VERSION_RANGE');
    if (r.tagIds.length > 50) fail('TOO_MANY_TAGS');
    for (const id of r.tagIds) {
      const tag = ctx.db.tag.id.find(id);
      if (!tag) fail('TAG_NOT_FOUND');
      if (tag.keyType !== 'user') fail('TAG_KIND_MISMATCH');
    }
    const countries = [...new Set(r.countries.map(c => c.trim().toUpperCase()))];
    for (const c of countries) if (!ctx.db.country.code.find(c)) fail('COUNTRY_NOT_FOUND');
    if (!Number.isFinite(r.percent) || r.percent < 0 || r.percent > 100) fail('INVALID_PERCENT');
    return { name, value: v.value, text: v.text, platforms: [...new Set(r.platforms)], minVersion, maxVersion, tagIds: [...new Set(r.tagIds)], countries, percent: r.percent };
  });
}

function versionIn(version: string, min: string, max: string) {
  if (!min && !max) return true;
  if (!parseVersion(version)) return false;
  if (min && (!parseVersion(min) || compareVersions(version, min) < 0)) return false;
  if (max && (!parseVersion(max) || compareVersions(version, max) > 0)) return false;
  return true;
}

function fits(secret: string, key: string, r: Rule, f: ClientFacts) {
  if (r.platforms.length && !r.platforms.includes(f.platform)) return false;
  if (!versionIn(f.version, r.minVersion, r.maxVersion)) return false;
  if (r.tagIds.length && !r.tagIds.some(x => f.tagIds.includes(x))) return false;
  if (r.countries.length && !r.countries.includes(f.country)) return false;
  if (r.percent < 100 && bucketOf(secret, key, f.accountId) >= Math.round(r.percent * 100)) return false;
  return true;
}

function textOf(list: Tr[], lang: string, fallback: string) {
  return list.find(x => x.lang === lang)?.text ?? list.find(x => x.lang === fallback)?.text ?? list[0]?.text ?? '';
}

export function resolveKey(secret: string, k: ConfigRow, f: ClientFacts, fallback: string) {
  for (const r of k.rules) {
    if (fits(secret, k.key, r, f)) return { key: k.key, type: k.type, value: k.type === 'text' ? textOf(r.text, f.lang, fallback) : r.value, variant: r.name };
  }
  return { key: k.key, type: k.type, value: k.type === 'text' ? textOf(k.text, f.lang, fallback) : k.value, variant: 'default' };
}

export function factsOf(ctx: SDb, accountId: bigint, platform: string, version: string, lang: string): ClientFacts {
  const c = ctx.db.supClient.accountId.find(accountId);
  return {
    accountId,
    platform: platform || c?.platform || '',
    version: version || c?.appVersion || '',
    country: ctx.db.profile.accountId.find(accountId)?.countryCode ?? '',
    tagIds: [...ctx.db.userTag.byAccountTag.filter(accountId)].map(u => u.tagId),
    lang,
  };
}

function snapshot(k: ConfigRow) {
  return JSON.stringify({ type: k.type, description: k.description, value: k.value, text: k.text, rules: k.rules.map(r => ({ ...r, tagIds: r.tagIds.map(String) })), isActive: k.isActive, version: k.version });
}

function revive(s: string): { type: string; description: string; value: string; text: Tr[]; rules: Rule[]; isActive: boolean } {
  const j = JSON.parse(s);
  return { ...j, rules: (j.rules ?? []).map((r: Rule & { tagIds: string[] }) => ({ ...r, tagIds: r.tagIds.map((x: string) => BigInt(x)) })) };
}

function history(ctx: STx, k: ConfigRow, action: string, by: bigint) {
  ctx.db.configHistory.insert({ id: 0n, key: k.key, version: k.version, action, snapshot: snapshot(k), by, at: ctx.timestamp });
}

function cleanPlatform(p: string) {
  const v = p.trim().toLowerCase();
  if (v && !(PLATFORMS as readonly string[]).includes(v)) fail('INVALID_PLATFORM');
  return v;
}

export function defineConfig(st: SupportSchema) {
  const adminConfigKeys = st.view({ name: 'admin_config_keys', public: true }, t.array(supRows.configKey), ctx => (adminOrNull(ctx as any) ? [...ctx.db.configKey.iter()] : []));

  const adminSaveConfigKey = st.reducer(
    { key: t.string(), version: t.u32(), type: t.string(), description: t.string(), value: t.string(), text: Translations, rules: t.array(ConfigRule), isActive: t.bool() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = a.key.trim();
      if (!KEY_RE.test(key)) fail('INVALID_KEY');
      if (!CONFIG_TYPES.includes(a.type)) fail('INVALID_TYPE');
      const old = ctx.db.configKey.key.find(key);
      if (!a.version && old) fail('KEY_TAKEN');
      if (a.version && !old) fail('NOT_FOUND');
      if (old && old.version !== a.version) fail('VERSION_CONFLICT');
      if (old && old.type !== a.type) fail('TYPE_LOCKED');
      const v = checkValue(ctx, a.type, a.value, a.text);
      const rules = checkRules(ctx, a.type, a.rules);
      const lastVersion = Math.max(0, ...[...ctx.db.configHistory.key.filter(key)].map(h => h.version));
      const row = { key, type: a.type, description: a.description.trim().slice(0, 500), value: v.value, text: v.text, rules, isActive: a.isActive, version: Math.max(old?.version ?? 0, lastVersion) + 1, updatedBy: me.id, updatedAt: ctx.timestamp };
      const saved = old ? ctx.db.configKey.key.update(row) : ctx.db.configKey.insert(row);
      history(ctx, saved, old ? 'update' : 'create', me.id);
      audit(base(ctx), me.id, old ? 'config.update' : 'config.create', key, `v${saved.version}`);
    }
  );

  const adminDeleteConfigKey = st.reducer({ key: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const k = ctx.db.configKey.key.find(a.key);
    if (!k) fail('NOT_FOUND');
    ctx.db.configKey.key.delete(k.key);
    history(ctx, k, 'delete', me.id);
    audit(base(ctx), me.id, 'config.delete', k.key, `v${k.version}`);
  });

  const adminRollbackConfig = st.reducer({ key: t.string(), version: t.u32() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const h = [...ctx.db.configHistory.key.filter(a.key)].filter(x => x.version === a.version && x.action !== 'delete').sort((x, y) => (x.id < y.id ? 1 : -1))[0];
    if (!h) fail('VERSION_NOT_FOUND');
    const snap = revive(h.snapshot);
    const old = ctx.db.configKey.key.find(a.key);
    if (old && old.type !== snap.type) fail('TYPE_LOCKED');
    const lastVersion = Math.max(0, ...[...ctx.db.configHistory.key.filter(a.key)].map(x => x.version));
    const row = { key: a.key, type: snap.type, description: snap.description, value: snap.value, text: snap.text, rules: snap.rules, isActive: snap.isActive, version: Math.max(old?.version ?? 0, lastVersion) + 1, updatedBy: me.id, updatedAt: ctx.timestamp };
    const saved = old ? ctx.db.configKey.key.update(row) : ctx.db.configKey.insert(row);
    ctx.db.configHistory.insert({ id: 0n, key: saved.key, version: saved.version, action: 'rollback', snapshot: snapshot(saved), by: me.id, at: ctx.timestamp });
    audit(base(ctx), me.id, 'config.rollback', a.key, `v${a.version}->v${saved.version}`);
  });

  const adminConfigHistory = st.procedure({ key: t.string(), page: t.u32(), pageSize: t.u32() }, HistoryPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const list = (a.key ? [...tx.db.configHistory.key.filter(a.key)] : [...tx.db.configHistory.iter()]).sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminConfigPreview = st.procedure(
    { accountId: t.u64(), platform: t.string(), version: t.string(), country: t.string(), tagIds: t.array(t.u64()), lang: t.string() },
    Preview,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(base(tx), 'operator');
        if (a.accountId && !tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
        const lang = a.accountId ? langOf(tx, a.accountId, a.lang) : a.lang || defaultLang(tx);
        const real = a.accountId ? factsOf(tx, a.accountId, a.platform, a.version, lang) : undefined;
        const f: ClientFacts = {
          accountId: a.accountId,
          platform: cleanPlatform(a.platform) || real?.platform || '',
          version: a.version.trim() || real?.version || '',
          country: a.country.trim().toUpperCase() || real?.country || '',
          tagIds: a.tagIds.length ? a.tagIds : real?.tagIds ?? [],
          lang,
        };
        const fallback = defaultLang(tx);
        const values = [...tx.db.configKey.iter()]
          .filter(k => k.isActive)
          .sort((x, y) => (x.key < y.key ? -1 : 1))
          .map(k => ({ ...resolveKey(tx.env.OTP_SECRET, k, f, fallback), bucket: bucketOf(tx.env.OTP_SECRET, k.key, a.accountId) }));
        return { lang, values };
      })
  );

  const setMyClient = st.reducer({ platform: t.string(), appVersion: t.string() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const platform = cleanPlatform(a.platform);
    const appVersion = a.appVersion.trim().slice(0, 40);
    if (appVersion && !parseVersion(appVersion)) fail('INVALID_VERSION');
    const old = ctx.db.supClient.accountId.find(me.id);
    const row = { accountId: me.id, platform, appVersion, updatedAt: ctx.timestamp };
    if (old) ctx.db.supClient.accountId.update(row);
    else ctx.db.supClient.insert(row);
  });

  const myRemoteConfig = st.view({ name: 'my_remote_config', public: true }, t.array(ValueRow), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return [];
    const acc = ctx.db.account.id.find(s.accountId);
    if (!acc || acc.status !== 'active') return [];
    const lang = langOf(ctx as any, acc.id);
    const f = factsOf(ctx as any, acc.id, '', '', lang);
    const fallback = defaultLang(ctx as any);
    return [...ctx.db.configKey.iter()].filter(k => k.isActive).map(k => resolveKey(ctx.env.OTP_SECRET, k, f, fallback));
  });

  const remoteConfig = st.procedure({ platform: t.string(), version: t.string(), keys: t.array(t.string()), lang: t.string() }, Resolved, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const platform = cleanPlatform(a.platform);
      const version = a.version.trim().slice(0, 40);
      if (version && !parseVersion(version)) fail('INVALID_VERSION');
      if (platform || version) {
        const old = tx.db.supClient.accountId.find(me.id);
        const row = { accountId: me.id, platform: platform || old?.platform || '', appVersion: version || old?.appVersion || '', updatedAt: tx.timestamp };
        if (old) tx.db.supClient.accountId.update(row);
        else tx.db.supClient.insert(row);
      }
      const lang = langOf(tx, me.id, a.lang);
      const f = factsOf(tx, me.id, platform, version, lang);
      const fallback = defaultLang(tx);
      const want = new Set(a.keys.map(k => k.trim()).filter(Boolean));
      const values = [...tx.db.configKey.iter()]
        .filter(k => k.isActive && (!want.size || want.has(k.key)))
        .sort((x, y) => (x.key < y.key ? -1 : 1))
        .map(k => resolveKey(tx.env.OTP_SECRET, k, f, fallback));
      const variants = values.map(v => `${v.key}:${v.variant}:${signHex(tx.env.OTP_SECRET, v.value).slice(0, 8)}`).join(',');
      const hash = signHex(tx.env.OTP_SECRET, `cfg|${values.map(v => `${v.key}=${v.variant}=${v.value}`).join('\n')}`).slice(0, 16);
      let changed: string[] = [];
      if (!want.size && isPlayerAccount(me)) {
        const seen = tx.db.configSeen.accountId.find(me.id);
        if (seen && seen.hash !== hash) {
          const before = new Set(seen.variants.split(',').filter(Boolean));
          changed = values.filter(v => !before.has(`${v.key}:${v.variant}:${signHex(tx.env.OTP_SECRET, v.value).slice(0, 8)}`)).map(v => `${v.key}:${v.variant}`);
          writeActivity(tx, me.id, { kind: 'config', action: 'changed', refId: hash, data: JSON.stringify({ changed }), actor: 'system' });
        }
        const row = { accountId: me.id, hash, variants };
        if (seen) tx.db.configSeen.accountId.update(row);
        else tx.db.configSeen.insert(row);
      }
      return { lang, values, hash, changed };
    })
  );

  return {
    adminConfigKeys,
    adminSaveConfigKey,
    adminDeleteConfigKey,
    adminRollbackConfig,
    adminConfigHistory,
    adminConfigPreview,
    setMyClient,
    myRemoteConfig,
    remoteConfig,
  };
}
