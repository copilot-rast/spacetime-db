import { t } from 'spacetimedb/server';
import { Translations, audit, cleanTranslations, fail, profileValidators, requireAccount, requireRole, type Tr, type Tx } from '@stg/base';
import { StoreLink, playersRows, type PlayersSchema } from './schema';
import { PLATFORMS, STORES, cleanVersion, compareVersions, tr, type PTx } from './util';

const STORE_NAMES: Record<string, [string, string]> = {
  google_play: ['گوگل‌پلی', 'Google Play'],
  app_store: ['اپ‌استور', 'App Store'],
  bazaar: ['کافه‌بازار', 'Cafe Bazaar'],
  myket: ['مایکت', 'Myket'],
  microsoft_store: ['مایکروسافت استور', 'Microsoft Store'],
  steam: ['استیم', 'Steam'],
  web: ['وب', 'Web'],
  direct: ['دانلود مستقیم', 'Direct download'],
};

const AppVersionResult = t.object('AppVersionResult', {
  platform: t.string(),
  current: t.string(),
  status: t.string(),
  latest: t.string(),
  minimum: t.string(),
  message: t.string(),
  storeUrl: t.string(),
  stores: t.array(t.object('AppVersionStore', { store: t.string(), name: t.string(), url: t.string() })),
});

const LATIN = /^[A-Za-z0-9_. -]+$/;
const PERSIAN = /^[؀-ۿ‌0-9۰-۹ _.-]+$/;

function normName(s: string) {
  return s.trim().toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, '').replace(/\s+/g, ' ');
}

export function validateDisplayName(raw: unknown, accountId: bigint, name: string) {
  const ctx = raw as PTx;
  const r = ctx.db.accountRules.id.find(0);
  if (!r) return;
  const len = [...name].length;
  if (len < r.displayNameMin) fail('DISPLAY_NAME_TOO_SHORT');
  if (len > r.displayNameMax) fail('DISPLAY_NAME_TOO_LONG');
  if (name && r.displayNameCharset === 'latin' && !LATIN.test(name)) fail('DISPLAY_NAME_INVALID_CHARACTERS');
  if (name && r.displayNameCharset === 'persian' && !PERSIAN.test(name)) fail('DISPLAY_NAME_INVALID_CHARACTERS');
  if (name && r.displayNameUnique) {
    const n = normName(name);
    for (const a of ctx.db.account.iter()) {
      if (a.id !== accountId && a.displayName && normName(a.displayName) === n) fail('DISPLAY_NAME_TAKEN');
    }
  }
}

function cleanStoreLinks(ctx: PTx, links: { store: string; url: string; label: Tr[] }[]) {
  if (links.length > 8) fail('TOO_MANY_LINKS');
  const seen = new Set<string>();
  return links.map(l => {
    if (!(STORES as readonly string[]).includes(l.store)) fail('INVALID_STORE');
    if (seen.has(l.store)) fail('DUPLICATE_STORE');
    seen.add(l.store);
    const url = l.url.trim();
    if (!/^(https?:\/\/|market:\/\/|bazaar:\/\/|myket:\/\/|itms-apps:\/\/)\S+$/.test(url)) fail('INVALID_URL');
    return { store: l.store, url, label: cleanTranslations(l.label, ctx as unknown as Tx, false) };
  });
}

export function defineRules(st: PlayersSchema) {
  profileValidators.push((ctx, accountId, name) => validateDisplayName(ctx, accountId, name));

  const adminSaveAccountRules = st.reducer(
    { displayNameMin: t.u8(), displayNameMax: t.u8(), displayNameCharset: t.string(), displayNameUnique: t.bool() },
    (ctx, a) => {
      const me = requireRole(ctx as unknown as Tx, 'admin');
      if (a.displayNameMax < 1 || a.displayNameMax > 64) fail('INVALID_RULE:displayNameMax');
      if (a.displayNameMin > a.displayNameMax) fail('INVALID_RULE:displayNameMin');
      if (!['any', 'latin', 'persian'].includes(a.displayNameCharset)) fail('INVALID_RULE:displayNameCharset');
      ctx.db.accountRules.id.update({ id: 0, ...a, updatedAt: ctx.timestamp });
      audit(ctx as unknown as Tx, me.id, 'account_rules.save', 'rules', JSON.stringify(a));
    }
  );

  const adminSaveAppVersion = st.reducer(
    {
      platform: t.string(),
      latestVersion: t.string(),
      minVersion: t.string(),
      storeLinks: t.array(StoreLink),
      updateMessage: Translations,
      forceMessage: Translations,
      isActive: t.bool(),
    },
    (ctx, a) => {
      const me = requireRole(ctx as unknown as Tx, 'admin');
      if (!(PLATFORMS as readonly string[]).includes(a.platform)) fail('INVALID_PLATFORM');
      const latest = cleanVersion(a.latestVersion, true);
      const min = cleanVersion(a.minVersion, false);
      if (min && compareVersions(min, latest) > 0) fail('MIN_ABOVE_LATEST');
      const row = {
        platform: a.platform,
        latestVersion: latest,
        minVersion: min,
        storeLinks: cleanStoreLinks(ctx, a.storeLinks),
        updateMessage: cleanTranslations(a.updateMessage, ctx as unknown as Tx, false),
        forceMessage: cleanTranslations(a.forceMessage, ctx as unknown as Tx, false),
        isActive: a.isActive,
        updatedAt: ctx.timestamp,
      };
      const old = ctx.db.appVersion.platform.find(a.platform);
      if (old) ctx.db.appVersion.platform.update(row);
      else ctx.db.appVersion.insert(row);
      audit(ctx as unknown as Tx, me.id, old ? 'app_version.update' : 'app_version.create', a.platform, `${min}..${latest}`);
    }
  );

  const adminDeleteAppVersion = st.reducer({ platform: t.string() }, (ctx, { platform }) => {
    const me = requireRole(ctx as unknown as Tx, 'admin');
    if (!ctx.db.appVersion.platform.delete(platform)) fail('NOT_FOUND');
    audit(ctx as unknown as Tx, me.id, 'app_version.delete', platform);
  });

  const checkAppVersion = st.procedure(
    { platform: t.string(), version: t.string(), store: t.string(), lang: t.string() },
    AppVersionResult,
    (ctx, a) =>
      ctx.withTx(tx => {
        if (!(PLATFORMS as readonly string[]).includes(a.platform)) fail('INVALID_PLATFORM');
        const current = cleanVersion(a.version, true);
        const row = tx.db.appVersion.platform.find(a.platform);
        const def = tx.db.settings.id.find(0)?.defaultLang ?? 'fa';
        const lang = a.lang || def;
        const pick = (list: Tr[]) => list.find(x => x.lang === lang)?.text ?? list.find(x => x.lang === def)?.text ?? list[0]?.text ?? '';
        if (!row || !row.isActive) {
          return { platform: a.platform, current, status: 'ok', latest: '', minimum: '', message: '', storeUrl: '', stores: [] };
        }
        const status = row.minVersion && compareVersions(current, row.minVersion) < 0 ? 'update_required' : compareVersions(current, row.latestVersion) < 0 ? 'update_available' : 'ok';
        const message = status === 'update_required' ? pick(row.forceMessage) || pick(row.updateMessage) : status === 'update_available' ? pick(row.updateMessage) : '';
        const stores = row.storeLinks.map(l => ({ store: l.store, name: pick(l.label) || (lang === 'fa' ? STORE_NAMES[l.store]?.[0] : STORE_NAMES[l.store]?.[1]) || l.store, url: l.url }));
        const storeUrl = stores.find(s => s.store === a.store)?.url ?? stores[0]?.url ?? '';
        return { platform: a.platform, current, status, latest: row.latestVersion, minimum: row.minVersion, message, storeUrl, stores };
      })
  );

  const adminSaveCountry = st.reducer(
    { code: t.string(), name: Translations, dialCode: t.string(), flagUrl: t.string(), isActive: t.bool(), sort: t.i32() },
    (ctx, a) => {
      const me = requireRole(ctx as unknown as Tx, 'admin');
      const code = a.code.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) fail('INVALID_COUNTRY_CODE');
      if (!/^\+\d{1,4}$/.test(a.dialCode.trim())) fail('INVALID_DIAL_CODE');
      const flag = a.flagUrl.trim();
      if (flag && !/^(https?:\/\/|\/)/.test(flag)) fail('INVALID_URL');
      const row = {
        code,
        name: cleanTranslations(a.name, ctx as unknown as Tx),
        dialCode: a.dialCode.trim(),
        flagUrl: flag,
        isActive: a.isActive,
        sort: a.sort,
      };
      const old = ctx.db.country.code.find(code);
      if (old) ctx.db.country.code.update({ ...row, name: [...row.name, ...old.name.filter(n => !row.name.some(x => x.lang === n.lang) && !ctx.db.language.code.find(n.lang))] });
      else ctx.db.country.insert(row);
      audit(ctx as unknown as Tx, me.id, old ? 'country.update' : 'country.create', code);
    }
  );

  const adminSetCountryActive = st.reducer({ code: t.string(), isActive: t.bool() }, (ctx, a) => {
    const me = requireRole(ctx as unknown as Tx, 'admin');
    const c = ctx.db.country.code.find(a.code);
    if (!c) fail('COUNTRY_NOT_FOUND');
    ctx.db.country.code.update({ ...c, isActive: a.isActive });
    audit(ctx as unknown as Tx, me.id, 'country.active', a.code, String(a.isActive));
  });

  const adminDeleteCountry = st.reducer({ code: t.string() }, (ctx, { code }) => {
    const me = requireRole(ctx as unknown as Tx, 'admin');
    if (!ctx.db.country.code.delete(code)) fail('COUNTRY_NOT_FOUND');
    audit(ctx as unknown as Tx, me.id, 'country.delete', code);
  });

  const setMyCountry = st.reducer({ code: t.string() }, (ctx, { code }) => {
    const acc = requireAccount(ctx as unknown as Tx);
    const c = ctx.db.country.code.find(code.trim().toUpperCase());
    if (!c || !c.isActive) fail('COUNTRY_NOT_AVAILABLE');
    const row = { accountId: acc.id, countryCode: c.code, updatedAt: ctx.timestamp };
    if (ctx.db.profile.accountId.find(acc.id)) ctx.db.profile.accountId.update(row);
    else ctx.db.profile.insert(row);
  });

  const myProfile = st.view({ name: 'my_profile', public: true }, t.option(playersRows.profile), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return undefined;
    return ctx.db.profile.accountId.find(s.accountId) ?? undefined;
  });

  return {
    adminSaveAccountRules,
    adminSaveAppVersion,
    adminDeleteAppVersion,
    checkAppVersion,
    adminSaveCountry,
    adminSetCountryActive,
    adminDeleteCountry,
    setMyCountry,
    myProfile,
  };
}

export { tr };
