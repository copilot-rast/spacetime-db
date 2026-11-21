import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, cleanKey, fail, normalizePhone, requireAccount, requireRole } from '@stg/base';
import { promoRows, type PromoSchema } from './schema';
import {
  addDays,
  base,
  checkRate,
  checkTags,
  cleanAbsoluteUrl,
  cleanColor,
  cleanDay,
  cleanUrl,
  countSponsor,
  dayOf,
  nowUs,
  promoSettings,
  sponsorLive,
  tr,
  type PTx,
  type SponsorRow,
} from './engine';

const SponsorItem = t.object('PromoSponsorItem', {
  id: t.u64(),
  key: t.string(),
  name: Translations,
  description: Translations,
  logoUrl: t.string(),
  color: t.string(),
  websiteUrl: t.string(),
  endsAt: t.u64(),
});
const SponsorViewResult = t.object('PromoSponsorViewResult', { counted: t.array(t.u64()), already: t.array(t.u64()), skipped: t.array(t.u64()), day: t.string() });
const SponsorClickResult = t.object('PromoSponsorClickResult', { counted: t.bool(), sponsorId: t.u64(), url: t.string() });
const ReportDay = t.object('PromoSponsorReportDay', { day: t.string(), views: t.u32(), clicks: t.u32(), players: t.u32(), ctrPercent: t.f64() });
const ReportBanner = t.object('PromoSponsorReportBanner', { bannerId: t.u64(), key: t.string(), name: t.string(), placementKey: t.string(), views: t.u32(), clicks: t.u32(), ctrPercent: t.f64() });
const ReportTotals = t.object('PromoSponsorReportTotals', { views: t.u32(), clicks: t.u32(), players: t.u32(), ctrPercent: t.f64() });
const Report = t.object('PromoSponsorReport', {
  sponsorId: t.u64(),
  key: t.string(),
  from: t.string(),
  to: t.string(),
  live: t.bool(),
  days: t.array(ReportDay),
  totals: ReportTotals,
  allTimeViews: t.u64(),
  allTimeClicks: t.u64(),
  allTimePlayers: t.u32(),
  targetViews: t.u32(),
  targetClicks: t.u32(),
  budgetToman: t.i64(),
  banners: t.array(ReportBanner),
  placements: t.array(t.string()),
});
const Csv = t.object('PromoSponsorCsv', { filename: t.string(), contentType: t.string(), header: t.array(t.string()), rows: t.array(t.array(t.string())), csv: t.string() });

const ctr = (views: number, clicks: number) => (views ? Math.round((clicks / views) * 10000) / 100 : 0);

function liveSponsor(ctx: PTx, id: bigint, now: bigint) {
  const s = ctx.db.sponsor.id.find(id);
  return s && sponsorLive(ctx, s, now) ? s : undefined;
}

function itemOf(s: SponsorRow) {
  return { id: s.id, key: s.key, name: s.name, description: s.description, logoUrl: s.logoUrl, color: s.color, websiteUrl: s.websiteUrl, endsAt: s.endsAt };
}

function range(ctx: PTx, from: string, to: string) {
  const today = dayOf(nowUs(ctx));
  const end = to.trim() ? cleanDay(to) : today;
  const start = from.trim() ? cleanDay(from) : addDays(end, -29);
  if (start > end) fail('INVALID_DATE_RANGE');
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > 366) fail('INVALID_DATE_RANGE');
  }
  return { start, end, days };
}

function buildReport(ctx: PTx, sponsorId: bigint, from: string, to: string) {
  const s = ctx.db.sponsor.id.find(sponsorId);
  if (!s) fail('NOT_FOUND');
  const r = range(ctx, from, to);
  const byDay = new Map([...ctx.db.sponsorDay.sponsorId.filter(s.id)].map(d => [d.day, d]));
  const days = r.days.map(day => {
    const d = byDay.get(day);
    const views = d?.views ?? 0;
    const clicks = d?.clicks ?? 0;
    return { day, views, clicks, players: d?.players ?? 0, ctrPercent: ctr(views, clicks) };
  });
  const players = new Set([...ctx.db.sponsorSeen.sponsorId.filter(s.id)].filter(x => x.day >= r.start && x.day <= r.end).map(x => x.accountId)).size;
  const views = days.reduce((a, d) => a + d.views, 0);
  const clicks = days.reduce((a, d) => a + d.clicks, 0);
  const total = ctx.db.sponsorTotal.sponsorId.find(s.id);
  const banners = [...ctx.db.banner.sponsorId.filter(s.id)]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(b => {
      const ds = [...ctx.db.bannerDay.bannerId.filter(b.id)].filter(d => d.day >= r.start && d.day <= r.end);
      const v = ds.reduce((a, d) => a + d.views, 0);
      const c = ds.reduce((a, d) => a + d.clicks, 0);
      return { bannerId: b.id, key: b.key, name: b.name, placementKey: ctx.db.placement.id.find(b.placementId)?.key ?? '', views: v, clicks: c, ctrPercent: ctr(v, c) };
    });
  return {
    sponsorId: s.id,
    key: s.key,
    from: r.start,
    to: r.end,
    live: sponsorLive(ctx, s, nowUs(ctx)),
    days,
    totals: { views, clicks, players, ctrPercent: ctr(views, clicks) },
    allTimeViews: total?.views ?? 0n,
    allTimeClicks: total?.clicks ?? 0n,
    allTimePlayers: [...ctx.db.sponsorPlayer.sponsorId.filter(s.id)].length,
    targetViews: s.targetViews,
    targetClicks: s.targetClicks,
    budgetToman: s.budgetToman,
    banners,
    placements: [...ctx.db.placement.iter()].filter(p => p.sponsorId === s.id).map(p => p.key),
  };
}

function cell(v: string) {
  const x = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
}

export function defineSponsors(st: PromoSchema) {
  const adminSponsors = st.view({ name: 'admin_sponsors', public: true }, t.array(promoRows.sponsor), ctx => (adminOrNull(ctx as any) ? [...ctx.db.sponsor.iter()] : []));

  const adminSaveSponsor = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      name: Translations,
      description: Translations,
      logoUrl: t.string(),
      color: t.string(),
      websiteUrl: t.string(),
      tagIds: t.array(t.u64()),
      contactName: t.string(),
      contactEmail: t.string(),
      contactPhone: t.string(),
      notes: t.string(),
      startsAt: t.u64(),
      endsAt: t.u64(),
      budgetToman: t.i64(),
      targetViews: t.u32(),
      targetClicks: t.u32(),
      stopAtTarget: t.bool(),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.sponsor.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      const same = ctx.db.sponsor.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (a.endsAt && a.startsAt && a.endsAt <= a.startsAt) fail('INVALID_WINDOW');
      if (a.budgetToman < 0n) fail('INVALID_BUDGET');
      const email = a.contactEmail.trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('INVALID_EMAIL');
      const phone = a.contactPhone.trim() ? normalizePhone(a.contactPhone) : '';
      if (a.notes.length > 2000 || a.contactName.length > 200) fail('INVALID_CONTACT');
      const row = {
        id: a.id,
        key,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        logoUrl: cleanUrl(a.logoUrl),
        color: cleanColor(a.color),
        websiteUrl: cleanAbsoluteUrl(a.websiteUrl),
        tagIds: checkTags(ctx, a.tagIds, ['sponsor', 'general']),
        contactName: a.contactName.trim(),
        contactEmail: email,
        contactPhone: phone,
        notes: a.notes,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        budgetToman: a.budgetToman,
        targetViews: a.targetViews,
        targetClicks: a.targetClicks,
        stopAtTarget: a.stopAtTarget,
        isActive: a.isActive,
        sort: a.sort,
        createdAt: old?.createdAt ?? ctx.timestamp,
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.sponsor.id.update(row) : ctx.db.sponsor.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'sponsor.update' : 'sponsor.create', String(saved.id), key);
    }
  );

  const adminDeleteSponsor = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const s = ctx.db.sponsor.id.find(id);
    if (!s) fail('NOT_FOUND');
    if ([...ctx.db.banner.sponsorId.filter(id)].length || [...ctx.db.placement.iter()].some(p => p.sponsorId === id)) fail('IN_USE');
    ctx.db.sponsor.id.delete(id);
    audit(base(ctx), me.id, 'sponsor.delete', String(id), s.key);
  });

  const adminSponsorReport = st.procedure({ sponsorId: t.u64(), from: t.string(), to: t.string() }, Report, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      return buildReport(tx, a.sponsorId, a.from, a.to);
    })
  );

  const adminSponsorReportCsv = st.procedure({ sponsorId: t.u64(), from: t.string(), to: t.string() }, Csv, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const r = buildReport(tx, a.sponsorId, a.from, a.to);
      const header = ['day', 'views', 'clicks', 'players', 'ctr_percent'];
      const rows: string[][] = r.days.map(d => [d.day, String(d.views), String(d.clicks), String(d.players), String(d.ctrPercent)]);
      rows.push(['total', String(r.totals.views), String(r.totals.clicks), String(r.totals.players), String(r.totals.ctrPercent)]);
      const bannerHeader = ['banner', 'name', 'placement', 'views', 'clicks', 'ctr_percent'];
      const bannerRows = r.banners.map(b => [b.key, b.name, b.placementKey, String(b.views), String(b.clicks), String(b.ctrPercent)]);
      const lines = [header, ...rows, [], bannerHeader, ...bannerRows].map(l => l.map(cell).join(','));
      return {
        filename: `sponsor-${r.key}-${r.from}-${r.to}.csv`,
        contentType: 'text/csv; charset=utf-8',
        header,
        rows: [...rows, bannerHeader, ...bannerRows].map(l => l.map(v => cell(v))),
        csv: `${lines.join('\r\n')}\r\n`,
      };
    })
  );

  const sponsors = st.procedure({ tagKey: t.string() }, t.array(SponsorItem), (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      checkRate(tx, me.id, 'list', promoSettings(tx).listPerMinute);
      const now = nowUs(tx);
      const tag = a.tagKey.trim() ? [...tx.db.tag.iter()].find(x => x.key === a.tagKey.trim() && (x.keyType === 'sponsor' || x.keyType === 'general')) : undefined;
      if (a.tagKey.trim() && !tag) return [];
      return [...tx.db.sponsor.iter()]
        .filter(s => sponsorLive(tx, s, now) && (!tag || s.tagIds.includes(tag.id)))
        .sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1))
        .map(itemOf);
    })
  );

  const sponsorView = st.procedure({ sponsorIds: t.array(t.u64()) }, SponsorViewResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      if (!a.sponsorIds.length || a.sponsorIds.length > 20) fail('INVALID_SPONSOR_IDS');
      checkRate(tx, me.id, 'count', promoSettings(tx).countPerMinute);
      const now = nowUs(tx);
      const out = { counted: [] as bigint[], already: [] as bigint[], skipped: [] as bigint[], day: dayOf(now) };
      for (const id of [...new Set(a.sponsorIds)]) {
        const s = liveSponsor(tx, id, now);
        if (!s) out.skipped.push(id);
        else if (countSponsor(tx, s, me.id, now, 'view')) out.counted.push(id);
        else out.already.push(id);
      }
      return out;
    })
  );

  const sponsorClick = st.procedure({ sponsorId: t.u64() }, SponsorClickResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      checkRate(tx, me.id, 'count', promoSettings(tx).countPerMinute);
      const now = nowUs(tx);
      const s = liveSponsor(tx, a.sponsorId, now);
      if (!s) fail('SPONSOR_NOT_AVAILABLE');
      const counted = countSponsor(tx, s, me.id, now, 'click');
      return { counted, sponsorId: s.id, url: s.websiteUrl };
    })
  );

  return {
    adminSponsors,
    adminSaveSponsor,
    adminDeleteSponsor,
    adminSponsorReport,
    adminSponsorReportCsv,
    sponsors,
    sponsorView,
    sponsorClick,
  };
}
