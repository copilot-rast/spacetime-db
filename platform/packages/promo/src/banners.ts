import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, cleanKey, fail, requireAccount, requireRole } from '@stg/base';
import { promoRows, promoTables, type PromoSchema } from './schema';
import {
  bannerBlock,
  base,
  checkRate,
  checkTags,
  cleanAbsoluteUrl,
  cleanColor,
  cleanUrl,
  countBanner,
  countSponsor,
  dayOf,
  nowUs,
  promoSettings,
  sortBanners,
  sponsorLive,
  tr,
  type BannerRow,
  type PDb,
  type PTx,
  type PlacementRow,
} from './engine';

export const LAYOUTS = ['carousel', 'single', 'grid', 'strip'];
export const ACTIONS = ['none', 'screen', 'product', 'achievement', 'url', 'sponsor'];
export const PLAYER_AGES = ['all', 'new', 'returning'];

const SponsorBrief = t.object('PromoSponsorBrief', { id: t.u64(), key: t.string(), name: Translations, logoUrl: t.string(), color: t.string(), websiteUrl: t.string() });
const BannerAction = t.object('PromoBannerAction', { type: t.string(), value: t.string(), url: t.string(), label: Translations, sponsorId: t.u64() });
const BannerItem = t.object('PromoBannerItem', {
  id: t.u64(),
  key: t.string(),
  title: Translations,
  subtitle: Translations,
  description: Translations,
  imageUrl: t.string(),
  bgColor: t.string(),
  priority: t.i32(),
  endsAt: t.u64(),
  action: BannerAction,
  sponsor: t.option(SponsorBrief),
});
const PlacementInfo = t.object('PromoPlacementInfo', { key: t.string(), name: Translations, layout: t.string(), maxItems: t.u8(), rotateSeconds: t.u8(), sponsor: t.option(SponsorBrief) });
const BannerList = t.object('PromoBannerList', { placement: PlacementInfo, items: t.array(BannerItem), now: t.u64() });
const ViewResult = t.object('PromoBannerViewResult', { counted: t.array(t.u64()), already: t.array(t.u64()), skipped: t.array(t.u64()), sponsorsCounted: t.array(t.u64()), day: t.string() });
const ClickResult = t.object('PromoBannerClickResult', { counted: t.bool(), bannerId: t.u64(), action: BannerAction, sponsorCounted: t.bool() });
const PreviewLine = t.object('PromoPreviewLine', { bannerId: t.u64(), key: t.string(), shown: t.bool(), reason: t.string() });
const DayLine = t.object('PromoBannerDayLine', { day: t.string(), views: t.u32(), clicks: t.u32() });
const BannerStats = t.object('PromoBannerStats', { bannerId: t.u64(), views: t.u32(), clicks: t.u32(), days: t.array(DayLine) });

export function sponsorBrief(ctx: PDb, id: bigint, now: bigint) {
  if (!id) return undefined;
  const s = ctx.db.sponsor.id.find(id);
  if (!s || !sponsorLive(ctx, s, now)) return undefined;
  return { id: s.id, key: s.key, name: s.name, logoUrl: s.logoUrl, color: s.color, websiteUrl: s.websiteUrl };
}

function actionOf(ctx: PDb, b: BannerRow) {
  const sp = b.sponsorId ? ctx.db.sponsor.id.find(b.sponsorId) : undefined;
  const url = b.actionType === 'url' ? b.actionValue : b.actionType === 'sponsor' ? sp?.websiteUrl ?? '' : '';
  return { type: b.actionType, value: b.actionType === 'url' || b.actionType === 'sponsor' ? '' : b.actionValue, url, label: b.actionLabel, sponsorId: b.actionType === 'sponsor' ? b.sponsorId : 0n };
}

function itemOf(ctx: PDb, b: BannerRow, now: bigint) {
  return {
    id: b.id,
    key: b.key,
    title: b.title,
    subtitle: b.subtitle,
    description: b.description,
    imageUrl: b.imageUrl,
    bgColor: b.bgColor,
    priority: b.priority,
    endsAt: b.endsAt,
    action: actionOf(ctx, b),
    sponsor: sponsorBrief(ctx, b.sponsorId, now),
  };
}

function activePlacement(ctx: PTx, key: string): PlacementRow {
  const p = ctx.db.placement.key.find(key.trim().toLowerCase());
  if (!p || !p.isActive) fail('BANNER_LIST_NOT_FOUND');
  return p;
}

export function visibleBanners(ctx: PTx, accountId: bigint, p: PlacementRow, now: bigint) {
  return sortBanners([...ctx.db.banner.placementId.filter(p.id)].filter(b => !bannerBlock(ctx, accountId, b, now))).slice(0, p.maxItems);
}

export function defineBanners(st: PromoSchema) {
  const adminPromoSettings = st.view({ name: 'admin_promo_settings', public: true }, t.option(promoRows.settings), ctx => (adminOrNull(ctx as any) ? ctx.db.promoSettings.id.find(0) ?? undefined : undefined));

  const adminBanners = st.view({ name: 'admin_banners', public: true }, t.array(promoRows.banner), ctx => (adminOrNull(ctx as any) ? [...ctx.db.banner.iter()] : []));

  const adminSavePromoSettings = st.reducer(
    { listPerMinute: t.u32(), countPerMinute: t.u32(), playPerMinute: t.u32(), newPlayerDays: t.u32(), requestTtlHours: t.u32(), keepDays: t.u32() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const s = promoSettings(ctx);
      if (a.listPerMinute > 10_000) fail('INVALID_SETTING:listPerMinute');
      if (a.countPerMinute > 10_000) fail('INVALID_SETTING:countPerMinute');
      if (a.playPerMinute > 10_000) fail('INVALID_SETTING:playPerMinute');
      if (a.newPlayerDays < 1 || a.newPlayerDays > 3650) fail('INVALID_SETTING:newPlayerDays');
      if (a.requestTtlHours < 1 || a.requestTtlHours > 24 * 30) fail('INVALID_SETTING:requestTtlHours');
      if (a.keepDays < 7 || a.keepDays > 3650) fail('INVALID_SETTING:keepDays');
      ctx.db.promoSettings.id.update({ ...s, ...a, updatedAt: ctx.timestamp });
      audit(base(ctx), me.id, 'promo_settings.save', 'settings', JSON.stringify(a));
    }
  );

  const adminSetPromoClockOffset = st.reducer({ seconds: t.i64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = promoSettings(ctx);
    if (a.seconds < -3650n * 86400n || a.seconds > 3650n * 86400n) fail('INVALID_CLOCK_OFFSET');
    ctx.db.promoSettings.id.update({ ...s, clockOffsetSec: a.seconds, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'promo_settings.clock', 'settings', String(a.seconds));
  });

  const adminSavePlacement = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, description: Translations, layout: t.string(), maxItems: t.u8(), rotateSeconds: t.u8(), sponsorId: t.u64(), isActive: t.bool(), sort: t.i32() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(key)) fail('INVALID_KEY');
      const old = a.id ? ctx.db.placement.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      const same = ctx.db.placement.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (!LAYOUTS.includes(a.layout)) fail('INVALID_LAYOUT');
      if (a.maxItems < 1 || a.maxItems > 20) fail('INVALID_MAX_ITEMS');
      if (a.rotateSeconds > 60) fail('INVALID_ROTATE_SECONDS');
      if (a.sponsorId && !ctx.db.sponsor.id.find(a.sponsorId)) fail('SPONSOR_NOT_FOUND');
      const row = { ...a, key, name: tr(ctx, a.name), description: tr(ctx, a.description, false), createdAt: old?.createdAt ?? ctx.timestamp, updatedAt: ctx.timestamp };
      const saved = old ? ctx.db.placement.id.update(row) : ctx.db.placement.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'placement.update' : 'placement.create', String(saved.id), key);
    }
  );

  const adminDeletePlacement = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const p = ctx.db.placement.id.find(id);
    if (!p) fail('NOT_FOUND');
    if ([...ctx.db.banner.placementId.filter(id)].length) fail('IN_USE');
    ctx.db.placement.id.delete(id);
    audit(base(ctx), me.id, 'placement.delete', String(id), p.key);
  });

  const adminSaveBanner = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      placementId: t.u64(),
      name: t.string(),
      tagIds: t.array(t.u64()),
      title: Translations,
      subtitle: Translations,
      description: Translations,
      imageUrl: t.string(),
      bgColor: t.string(),
      actionType: t.string(),
      actionValue: t.string(),
      actionLabel: Translations,
      priority: t.i32(),
      startsAt: t.u64(),
      endsAt: t.u64(),
      days: t.array(t.i32()),
      dayStart: t.u16(),
      dayEnd: t.u16(),
      audienceTagIds: t.array(t.u64()),
      excludeTagIds: t.array(t.u64()),
      levelTableId: t.u64(),
      minLevel: t.u32(),
      maxLevel: t.u32(),
      playerAge: t.string(),
      countries: t.array(t.string()),
      sponsorId: t.u64(),
      isActive: t.bool(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.banner.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      const same = ctx.db.banner.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (!ctx.db.placement.id.find(a.placementId)) fail('PLACEMENT_NOT_FOUND');
      if (a.name.length > 200) fail('INVALID_NAME');
      if (a.priority < -1000 || a.priority > 1000) fail('INVALID_PRIORITY');
      if (a.endsAt && a.startsAt && a.endsAt <= a.startsAt) fail('INVALID_WINDOW');
      if (a.days.length > 7 || a.days.some(d => d < 0 || d > 6)) fail('INVALID_DAYS');
      if (a.dayStart > 1439 || a.dayEnd > 1440) fail('INVALID_HOURS');
      if (!PLAYER_AGES.includes(a.playerAge)) fail('INVALID_PLAYER_AGE');
      if (a.maxLevel && a.minLevel > a.maxLevel) fail('INVALID_LEVEL_RANGE');
      if (a.levelTableId && !ctx.db.levelTable.id.find(a.levelTableId)) fail('LEVEL_TABLE_NOT_FOUND');
      const audience = checkTags(ctx, a.audienceTagIds, ['user']);
      const exclude = checkTags(ctx, a.excludeTagIds, ['user']);
      if (audience.some(x => exclude.includes(x))) fail('DUPLICATE_TAG');
      const tagIds = checkTags(ctx, a.tagIds, ['banner', 'general']);
      if (a.countries.length > 50) fail('TOO_MANY_COUNTRIES');
      const countries = [...new Set(a.countries.map(c => c.trim().toUpperCase()))];
      for (const c of countries) if (!ctx.db.country.code.find(c)) fail('COUNTRY_NOT_FOUND');
      const sp = a.sponsorId ? ctx.db.sponsor.id.find(a.sponsorId) : undefined;
      if (a.sponsorId && !sp) fail('SPONSOR_NOT_FOUND');
      if (!ACTIONS.includes(a.actionType)) fail('INVALID_ACTION');
      let actionValue = a.actionValue.trim();
      if (a.actionType === 'none' || a.actionType === 'sponsor') actionValue = '';
      if (a.actionType === 'screen' && !/^[A-Za-z0-9_./:-]{1,100}$/.test(actionValue)) fail('INVALID_ACTION_VALUE');
      if (a.actionType === 'product' && !ctx.db.product.key.find(actionValue)) fail('PRODUCT_NOT_FOUND');
      if (a.actionType === 'achievement' && !ctx.db.achievement.key.find(actionValue)) fail('ACHIEVEMENT_NOT_FOUND');
      if (a.actionType === 'url') {
        if (!actionValue) fail('INVALID_URL');
        actionValue = cleanAbsoluteUrl(actionValue);
      }
      if (a.actionType === 'sponsor') {
        if (!sp) fail('SPONSOR_REQUIRED');
        if (!sp.websiteUrl) fail('SPONSOR_NO_WEBSITE');
      }
      const row = {
        id: a.id,
        key,
        placementId: a.placementId,
        name: a.name.trim(),
        tagIds,
        title: tr(ctx, a.title),
        subtitle: tr(ctx, a.subtitle, false),
        description: tr(ctx, a.description, false),
        imageUrl: cleanUrl(a.imageUrl),
        bgColor: cleanColor(a.bgColor),
        actionType: a.actionType,
        actionValue,
        actionLabel: tr(ctx, a.actionLabel, false),
        priority: a.priority,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        days: [...new Set(a.days)].sort((x, y) => x - y),
        dayStart: a.dayStart,
        dayEnd: a.dayEnd,
        audienceTagIds: audience,
        excludeTagIds: exclude,
        levelTableId: a.levelTableId,
        minLevel: a.minLevel,
        maxLevel: a.maxLevel,
        playerAge: a.playerAge,
        countries,
        sponsorId: a.sponsorId,
        isActive: a.isActive,
        createdAt: old?.createdAt ?? ctx.timestamp,
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.banner.id.update(row) : ctx.db.banner.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'banner.update' : 'banner.create', String(saved.id), key);
    }
  );

  const adminDeleteBanner = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const b = ctx.db.banner.id.find(id);
    if (!b) fail('NOT_FOUND');
    ctx.db.banner.id.delete(id);
    audit(base(ctx), me.id, 'banner.delete', String(id), b.key);
  });

  const adminBannerStats = st.procedure({ bannerId: t.u64(), days: t.u32() }, BannerStats, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      if (!tx.db.banner.id.find(a.bannerId)) fail('NOT_FOUND');
      const n = Math.min(Math.max(a.days || 14, 1), 366);
      const now = nowUs(tx);
      const byDay = new Map([...tx.db.bannerDay.bannerId.filter(a.bannerId)].map(d => [d.day, d]));
      const days = [];
      for (let i = n - 1; i >= 0; i--) {
        const day = dayOf(now - BigInt(i) * 86_400_000_000n);
        const d = byDay.get(day);
        days.push({ day, views: d?.views ?? 0, clicks: d?.clicks ?? 0 });
      }
      const all = [...byDay.values()];
      return { bannerId: a.bannerId, views: all.reduce((s, d) => s + d.views, 0), clicks: all.reduce((s, d) => s + d.clicks, 0), days };
    })
  );

  const adminBannerPreview = st.procedure({ placementKey: t.string(), accountId: t.u64() }, t.array(PreviewLine), (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const p = tx.db.placement.key.find(a.placementKey.trim().toLowerCase());
      if (!p) fail('BANNER_LIST_NOT_FOUND');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      const now = nowUs(tx);
      const shown = new Set(visibleBanners(tx, a.accountId, p, now).map(b => b.id));
      return sortBanners([...tx.db.banner.placementId.filter(p.id)]).map(b => {
        const reason = bannerBlock(tx, a.accountId, b, now);
        return { bannerId: b.id, key: b.key, shown: shown.has(b.id), reason: reason || (shown.has(b.id) ? '' : 'max_items') };
      });
    })
  );

  const banners = st.procedure({ placement: t.string() }, BannerList, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      checkRate(tx, me.id, 'list', promoSettings(tx).listPerMinute);
      const p = activePlacement(tx, a.placement);
      const now = nowUs(tx);
      return {
        placement: { key: p.key, name: p.name, layout: p.layout, maxItems: p.maxItems, rotateSeconds: p.rotateSeconds, sponsor: sponsorBrief(tx, p.sponsorId, now) },
        items: visibleBanners(tx, me.id, p, now).map(b => itemOf(tx, b, now)),
        now,
      };
    })
  );

  const bannerView = st.procedure({ bannerIds: t.array(t.u64()) }, ViewResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      if (!a.bannerIds.length || a.bannerIds.length > 20) fail('INVALID_BANNER_IDS');
      checkRate(tx, me.id, 'count', promoSettings(tx).countPerMinute);
      const now = nowUs(tx);
      const out = { counted: [] as bigint[], already: [] as bigint[], skipped: [] as bigint[], sponsorsCounted: [] as bigint[], day: dayOf(now) };
      const shown = new Map<bigint, Set<bigint>>();
      for (const id of [...new Set(a.bannerIds)]) {
        const b = tx.db.banner.id.find(id);
        const p = b ? tx.db.placement.id.find(b.placementId) : undefined;
        if (p && !shown.has(p.id)) shown.set(p.id, new Set(visibleBanners(tx, me.id, p, now).map(x => x.id)));
        if (!b || !p || !p.isActive || !shown.get(p.id)!.has(b.id)) {
          out.skipped.push(id);
          continue;
        }
        if (countBanner(tx, b, me.id, now, 'view')) out.counted.push(id);
        else out.already.push(id);
        for (const sid of [b.sponsorId, p.sponsorId]) {
          if (!sid || out.sponsorsCounted.includes(sid)) continue;
          const sp = tx.db.sponsor.id.find(sid);
          if (sp && countSponsor(tx, sp, me.id, now, 'view')) out.sponsorsCounted.push(sid);
        }
      }
      return out;
    })
  );

  const bannerClick = st.procedure({ bannerId: t.u64() }, ClickResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      checkRate(tx, me.id, 'count', promoSettings(tx).countPerMinute);
      const now = nowUs(tx);
      const b = tx.db.banner.id.find(a.bannerId);
      const p = b ? tx.db.placement.id.find(b.placementId) : undefined;
      if (!b || !p || !p.isActive || !visibleBanners(tx, me.id, p, now).some(x => x.id === b.id)) fail('BANNER_NOT_AVAILABLE');
      const counted = countBanner(tx, b, me.id, now, 'click');
      const sp = b.sponsorId ? tx.db.sponsor.id.find(b.sponsorId) : undefined;
      const sponsorCounted = !!sp && countSponsor(tx, sp, me.id, now, 'click');
      return { counted, bannerId: b.id, action: actionOf(tx, b), sponsorCounted };
    })
  );

  const promoTick = st.procedure({ onSchedule: promoTables.promoTickTimer }, { timer: promoTables.promoTickTimer.rowType }, t.unit(), ctx => {
    ctx.withTx(tx => {
      const realNow = tx.timestamp.microsSinceUnixEpoch;
      for (const r of [...tx.db.promoRequest.iter()].filter(r => r.expiresAt < realNow).slice(0, 500)) tx.db.promoRequest.key.delete(r.key);
      const minute = realNow / 60_000_000n;
      for (const r of [...tx.db.promoRate.iter()].filter(r => r.minute < minute - 2n).slice(0, 2000)) tx.db.promoRate.key.delete(r.key);
      const keep = BigInt(promoSettings(tx).keepDays) * 86_400_000_000n;
      const cut = nowUs(tx) - keep;
      for (const r of [...tx.db.bannerSeen.iter()].filter(r => r.at < cut).slice(0, 2000)) tx.db.bannerSeen.key.delete(r.key);
      for (const r of [...tx.db.sponsorSeen.iter()].filter(r => r.at < cut).slice(0, 2000)) tx.db.sponsorSeen.key.delete(r.key);
    });
    return {};
  });

  return {
    promoTick,
    adminPromoSettings,
    adminBanners,
    adminSavePromoSettings,
    adminSetPromoClockOffset,
    adminSavePlacement,
    adminDeletePlacement,
    adminSaveBanner,
    adminDeleteBanner,
    adminBannerStats,
    adminBannerPreview,
    banners,
    bannerView,
    bannerClick,
  };
}
