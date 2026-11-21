import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import {
  Translations,
  accountGuards,
  logActivity,
  audit,
  cleanKey,
  cleanTranslations,
  fail,
  hasRole,
  requireAccount,
  requireRole,
  roleOf,
  toLatinDigits,
  type Tr,
  type Tx,
} from '@stg/base';
import { playersRows, playersTables, type PlayersSchema } from './schema';
import { RESTRICTION_KINDS, activeRestriction, cleanContext, hourKey, isoOf, nowMicros, pageOf, tr, type PTx } from './util';

const MAX_MINUTES = 10 * 365 * 24 * 60;
const HOUR = 3_600_000_000n;

const Notice = t.object('RestrictionNotice', { id: t.u64(), kind: t.string(), until: t.timestamp(), reason: t.string() });
const MyStatus = t.row('MyStatusRow', {
  accountId: t.u64().primaryKey(),
  suspension: t.option(Notice),
  mute: t.option(Notice),
  warnings: t.array(t.object('WarningNotice', { id: t.u64(), reason: t.string(), createdAt: t.timestamp() })),
});

const MyTag = t.row('MyTagRow', { tagId: t.u64().primaryKey(), key: t.string(), title: Translations, color: t.string() });

const TagRef = t.object('TagRef', { id: t.u64(), key: t.string(), title: Translations, isPublic: t.bool() });
const RestrictionRef = t.object('RestrictionRef', { id: t.u64(), endsAt: t.timestamp(), reason: Translations });

const PlayerRow = t.object('PlayerRow', {
  id: t.u64(),
  phone: t.string(),
  displayName: t.string(),
  status: t.string(),
  role: t.string(),
  countryCode: t.string(),
  createdAt: t.timestamp(),
  lastLoginAt: t.timestamp(),
  tags: t.array(TagRef),
  suspension: t.option(RestrictionRef),
  mute: t.option(RestrictionRef),
});
const PlayerPage = t.object('PlayerPage', { total: t.u32(), rows: t.array(PlayerRow) });

const PlayerDetail = t.object('PlayerDetail', {
  player: PlayerRow,
  history: t.array(playersRows.restriction),
  reportsAgainst: t.u32(),
  reportsBy: t.u32(),
  reportsOpen: t.u32(),
});

const RestrictionListRow = t.object('RestrictionListRow', {
  restriction: playersRows.restriction,
  phone: t.string(),
  displayName: t.string(),
  createdByPhone: t.string(),
  effectiveStatus: t.string(),
});
const RestrictionPage = t.object('RestrictionPage', { total: t.u32(), activeTotal: t.u32(), rows: t.array(RestrictionListRow) });

const ReportResult = t.object('ReportPlayerResult', { reportId: t.u64(), duplicate: t.bool() });
const MyReport = t.object('MyReport', {
  id: t.u64(),
  targetId: t.u64(),
  targetName: t.string(),
  titleKey: t.string(),
  title: t.string(),
  note: t.string(),
  matchId: t.string(),
  contentId: t.string(),
  gameKey: t.string(),
  status: t.string(),
  createdAt: t.timestamp(),
  closedAt: t.option(t.timestamp()),
});
const MyReportsPage = t.object('MyReportsPage', {
  total: t.u32(),
  rows: t.array(MyReport),
  perHour: t.u32(),
  remaining: t.option(t.u32()),
  trusted: t.bool(),
  noteRequired: t.bool(),
  minAccountHours: t.u32(),
  duplicateHours: t.u32(),
});

const ReportListRow = t.object('ReportListRow', {
  report: playersRows.report,
  targetPhone: t.string(),
  targetName: t.string(),
  reporterPhone: t.string(),
  reporterName: t.string(),
  againstTarget: t.u32(),
});
const ReportPage = t.object('ReportPage', { total: t.u32(), activeTotal: t.u32(), rows: t.array(ReportListRow) });
const ReportDetail = t.object('ReportDetail', {
  row: ReportListRow,
  others: t.array(playersRows.report),
  target: PlayerRow,
  warns: t.u32(),
  mutes: t.u32(),
  suspends: t.u32(),
});

const ModerationSummary = t.object('ModerationSummary', {
  suspended: t.u32(),
  muted: t.u32(),
  reportsOpen: t.u32(),
  reportsReviewing: t.u32(),
  tagged: t.u32(),
});

function asBase(ctx: PTx) {
  return ctx as unknown as Tx;
}

function tagsOf(ctx: PTx, accountId: bigint) {
  return [...ctx.db.userTag.byAccountTag.filter(accountId)].flatMap(ut => {
    const tag = ctx.db.tag.id.find(ut.tagId);
    if (!tag) return [];
    return [{ id: tag.id, key: tag.key, title: tag.title, isPublic: ctx.db.tagMeta.tagId.find(tag.id)?.isPublic ?? false }];
  });
}

function ref(r: ReturnType<typeof activeRestriction>) {
  return r ? { id: r.id, endsAt: r.endsAt, reason: r.reason } : undefined;
}

function playerRow(ctx: PTx, accountId: bigint) {
  const a = ctx.db.account.id.find(accountId);
  if (!a) fail('USER_NOT_FOUND');
  return {
    id: a.id,
    phone: a.phone,
    displayName: a.displayName,
    status: a.status,
    role: roleOf(asBase(ctx), a.id) ?? '',
    countryCode: ctx.db.profile.accountId.find(a.id)?.countryCode ?? '',
    createdAt: a.createdAt,
    lastLoginAt: a.lastLoginAt,
    tags: tagsOf(ctx, a.id),
    suspension: ref(activeRestriction(ctx, a.id, 'suspend')),
    mute: ref(activeRestriction(ctx, a.id, 'mute')),
  };
}

function guardTarget(ctx: PTx, meId: bigint, targetId: bigint) {
  if (!ctx.db.account.id.find(targetId)) fail('USER_NOT_FOUND');
  if (targetId === meId) fail('CANNOT_CHANGE_SELF');
  const targetRole = roleOf(asBase(ctx), targetId);
  if (targetRole === 'owner') fail('CANNOT_RESTRICT_OWNER');
  if (targetRole && !hasRole(roleOf(asBase(ctx), meId), 'owner')) fail('FORBIDDEN');
}

function endOf(ctx: PTx, minutes: number, endsAt: bigint) {
  const now = nowMicros(ctx);
  let end: bigint;
  if (endsAt > 0n) end = endsAt;
  else if (minutes > 0) end = now + BigInt(minutes) * 60_000_000n;
  else fail('END_REQUIRED');
  if (end <= now) fail('END_IN_PAST');
  if (end > now + BigInt(MAX_MINUTES) * 60_000_000n) fail('END_TOO_FAR');
  return new Timestamp(end);
}

export function restrict(
  ctx: PTx,
  meId: bigint,
  a: { accountId: bigint; kind: string; minutes: number; endsAt: bigint; reason: Tr[]; note: string },
  reportId: bigint
) {
  if (!(RESTRICTION_KINDS as readonly string[]).includes(a.kind)) fail('INVALID_RESTRICTION_KIND');
  guardTarget(ctx, meId, a.accountId);
  const reason = cleanTranslations(a.reason, asBase(ctx));
  const now = ctx.timestamp;
  const endsAt = a.kind === 'warn' ? now : endOf(ctx, a.minutes, a.endsAt);
  if (a.kind !== 'warn') {
    const old = activeRestriction(ctx, a.accountId, a.kind);
    if (old) ctx.db.restriction.id.update({ ...old, status: 'lifted', liftedBy: meId, liftedAt: now, liftNote: 'replaced' });
  }
  const row = ctx.db.restriction.insert({
    id: 0n,
    accountId: a.accountId,
    kind: a.kind,
    status: a.kind === 'warn' ? 'expired' : 'active',
    startsAt: now,
    endsAt,
    reason,
    note: a.note.trim().slice(0, 1000),
    reportId,
    createdBy: meId,
    createdAt: now,
    liftedBy: 0n,
    liftedAt: undefined,
    liftNote: '',
  });
  if (a.kind === 'suspend') {
    for (const s of [...ctx.db.session.accountId.filter(a.accountId)]) ctx.db.session.identity.delete(s.identity);
  }
  audit(asBase(ctx), meId, `restriction.${a.kind}`, String(a.accountId), `id=${row.id} until=${isoOf(endsAt)}`);
  logActivity(ctx, a.accountId, { kind: 'restriction', action: a.kind, refId: String(row.id), data: JSON.stringify({ until: String(endsAt.microsSinceUnixEpoch) }), actor: `admin:${meId}` });
  return row;
}

function effectiveStatus(ctx: PTx, r: { status: string; endsAt: Timestamp }) {
  if (r.status === 'active' && r.endsAt.microsSinceUnixEpoch <= nowMicros(ctx)) return 'expired';
  return r.status;
}

function reportRules(ctx: PTx) {
  const r = ctx.db.reportRules.id.find(0);
  if (!r) fail('NOT_INITIALIZED');
  return r;
}

function isTrusted(ctx: PTx, accountId: bigint, ids: bigint[]) {
  if (!ids.length) return false;
  return [...ctx.db.userTag.byAccountTag.filter(accountId)].some(ut => ids.includes(ut.tagId));
}

function reportLimit(ctx: PTx, accountId: bigint) {
  const r = reportRules(ctx);
  const trusted = isTrusted(ctx, accountId, r.trustedTagIds);
  const limit = trusted ? r.trustedPerHour : r.perHour;
  const used = ctx.db.reportRate.key.find(`${accountId}|${hourKey(ctx)}`)?.count ?? 0;
  return { rules: r, trusted, limit, used, remaining: limit === 0 ? undefined : Math.max(limit - used, 0) };
}

function isActiveReport(status: string) {
  return status === 'open' || status === 'reviewing';
}

type ReportRow = NonNullable<ReturnType<PTx['db']['report']['id']['find']>>;

function reportListRow(ctx: PTx, r: ReportRow) {
  const target = ctx.db.account.id.find(r.targetId);
  const reporter = ctx.db.account.id.find(r.reporterId);
  return {
    report: r,
    targetPhone: target?.phone ?? '',
    targetName: target?.displayName ?? '',
    reporterPhone: reporter?.phone ?? '',
    reporterName: reporter?.displayName ?? '',
    againstTarget: [...ctx.db.report.targetId.filter(r.targetId)].length,
  };
}

export function defineModeration(st: PlayersSchema) {
  accountGuards.push((raw, accountId) => {
    const ctx = raw as unknown as PTx;
    const s = activeRestriction(ctx, accountId, 'suspend');
    if (!s) return undefined;
    const reason = tr(ctx, accountId, s.reason);
    return { code: 'ACCOUNT_SUSPENDED', detail: JSON.stringify({ kind: 'suspend', until: isoOf(s.endsAt), reason }) };
  });

  const expireRestrictions = st.reducer({ onSchedule: playersTables.expireTimer }, { timer: playersTables.expireTimer.rowType }, ctx => {
    const now = nowMicros(ctx);
    for (const r of [...ctx.db.restriction.status.filter('active')]) {
      if (r.endsAt.microsSinceUnixEpoch <= now) ctx.db.restriction.id.update({ ...r, status: 'expired' });
    }
    for (const k of [...ctx.db.reportRate.iter()]) {
      if (BigInt(k.key.split('|')[1] ?? '0') < now / HOUR - 2n) ctx.db.reportRate.key.delete(k.key);
    }
  });

  const myStatus = st.view({ name: 'my_status', public: true }, t.option(MyStatus), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return undefined;
    const c = ctx as unknown as PTx;
    const mine = [...ctx.db.restriction.accountId.filter(s.accountId)].sort((x, y) => (x.id < y.id ? 1 : -1));
    const notice = (kind: string) => {
      const r = mine.find(x => x.kind === kind && x.status === 'active');
      return r ? { id: r.id, kind, until: r.endsAt, reason: tr(c, s.accountId, r.reason) } : undefined;
    };
    const warnings = mine
      .filter(r => r.kind === 'warn')
      .slice(0, 5)
      .map(r => ({ id: r.id, reason: tr(c, s.accountId, r.reason), createdAt: r.createdAt }));
    return { accountId: s.accountId, suspension: notice('suspend'), mute: notice('mute'), warnings };
  });

  const myTags = st.view({ name: 'my_tags', public: true }, t.array(MyTag), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return [];
    return [...ctx.db.userTag.byAccountTag.filter(s.accountId)].flatMap(ut => {
      const tag = ctx.db.tag.id.find(ut.tagId);
      if (!tag || !tag.isActive || !ctx.db.tagMeta.tagId.find(tag.id)?.isPublic) return [];
      return [{ tagId: tag.id, key: tag.key, title: tag.title, color: tag.color }];
    });
  });

  const adminSetTagVisibility = st.reducer({ tagId: t.u64(), isPublic: t.bool() }, (ctx, a) => {
    const me = requireRole(asBase(ctx), 'admin');
    const tag = ctx.db.tag.id.find(a.tagId);
    if (!tag) fail('NOT_FOUND');
    if (tag.keyType !== 'user') fail('TAG_KIND_MISMATCH');
    const row = { tagId: a.tagId, isPublic: a.isPublic };
    if (ctx.db.tagMeta.tagId.find(a.tagId)) ctx.db.tagMeta.tagId.update(row);
    else ctx.db.tagMeta.insert(row);
    audit(asBase(ctx), me.id, 'tag.visibility', String(a.tagId), String(a.isPublic));
  });

  const userTagIds = (ctx: PTx, ids: bigint[]) => {
    for (const id of ids) {
      const tag = ctx.db.tag.id.find(id);
      if (!tag) fail('TAG_NOT_FOUND');
      if (tag.keyType !== 'user') fail('TAG_KIND_MISMATCH');
    }
    return [...new Set(ids)];
  };

  const adminSetPlayerTags = st.reducer({ accountId: t.u64(), tagIds: t.array(t.u64()) }, (ctx, a) => {
    const me = requireRole(asBase(ctx), 'operator');
    if (!ctx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
    if (a.tagIds.length > 50) fail('TOO_MANY_TAGS');
    const want = userTagIds(ctx, a.tagIds);
    const have = [...ctx.db.userTag.byAccountTag.filter(a.accountId)];
    for (const ut of have) if (!want.includes(ut.tagId)) ctx.db.userTag.id.delete(ut.id);
    for (const id of want) {
      if (!have.some(h => h.tagId === id)) ctx.db.userTag.insert({ id: 0n, accountId: a.accountId, tagId: id, createdBy: me.id, createdAt: ctx.timestamp });
    }
    audit(asBase(ctx), me.id, 'player.tags', String(a.accountId), want.join(','));
  });

  const adminBulkPlayerTags = st.reducer({ accountIds: t.array(t.u64()), tagIds: t.array(t.u64()), op: t.string() }, (ctx, a) => {
    const me = requireRole(asBase(ctx), 'operator');
    if (a.op !== 'add' && a.op !== 'remove') fail('INVALID_OP');
    if (!a.tagIds.length) fail('TAGS_REQUIRED');
    if (!a.accountIds.length || a.accountIds.length > 1000) fail('USERS_REQUIRED');
    const tags = userTagIds(ctx, a.tagIds);
    let changed = 0;
    for (const accountId of new Set(a.accountIds)) {
      if (!ctx.db.account.id.find(accountId)) fail('USERS_NOT_FOUND');
      for (const tagId of tags) {
        const existing = [...ctx.db.userTag.byAccountTag.filter([accountId, tagId])][0];
        if (a.op === 'add' && !existing) {
          ctx.db.userTag.insert({ id: 0n, accountId, tagId, createdBy: me.id, createdAt: ctx.timestamp });
          changed++;
        } else if (a.op === 'remove' && existing) {
          ctx.db.userTag.id.delete(existing.id);
          changed++;
        }
      }
    }
    audit(asBase(ctx), me.id, `player.tags.${a.op}`, `${a.accountIds.length} players`, `tags=${tags.join(',')} changed=${changed}`);
  });

  const adminRestrict = st.reducer(
    { accountId: t.u64(), kind: t.string(), minutes: t.u32(), endsAt: t.u64(), reason: Translations, note: t.string() },
    (ctx, a) => {
      const me = requireRole(asBase(ctx), 'operator');
      restrict(ctx, me.id, a, 0n);
    }
  );

  const adminLiftRestriction = st.reducer({ id: t.u64(), note: t.string() }, (ctx, a) => {
    const me = requireRole(asBase(ctx), 'operator');
    const r = ctx.db.restriction.id.find(a.id);
    if (!r) fail('NOT_FOUND');
    if (effectiveStatus(ctx, r) !== 'active') fail('NOT_ACTIVE');
    guardTarget(ctx, me.id, r.accountId);
    ctx.db.restriction.id.update({ ...r, status: 'lifted', liftedBy: me.id, liftedAt: ctx.timestamp, liftNote: a.note.trim().slice(0, 500) });
    audit(asBase(ctx), me.id, 'restriction.lift', String(r.accountId), `id=${r.id}`);
    logActivity(ctx, r.accountId, { kind: 'restriction', action: 'lifted', refId: String(r.id), data: JSON.stringify({ kind: r.kind }), actor: `admin:${me.id}` });
  });

  const adminPlayers = st.procedure(
    { query: t.string(), tagId: t.u64(), status: t.string(), page: t.u32(), pageSize: t.u32() },
    PlayerPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(asBase(tx), 'operator');
        const q = toLatinDigits(a.query).trim().toLowerCase();
        const tagged = a.tagId ? new Set([...tx.db.userTag.tagId.filter(a.tagId)].map(x => x.accountId)) : undefined;
        const anyTag = a.status === 'tagged' ? new Set([...tx.db.userTag.iter()].map(x => x.accountId)) : undefined;
        const list = [...tx.db.account.iter()]
          .filter(x => !q || x.phone.includes(q) || x.displayName.toLowerCase().includes(q) || String(x.id) === q)
          .filter(x => !tagged || tagged.has(x.id))
          .filter(x => {
            if (!a.status) return true;
            if (a.status === 'blocked') return x.status === 'blocked';
            if (a.status === 'tagged') return anyTag!.has(x.id);
            if (a.status === 'suspended') return !!activeRestriction(tx, x.id, 'suspend');
            if (a.status === 'muted') return !!activeRestriction(tx, x.id, 'mute');
            return true;
          })
          .sort((x, y) => (x.id < y.id ? 1 : -1));
        const { start, pageSize } = pageOf(a.page, a.pageSize);
        return { total: list.length, rows: list.slice(start, start + pageSize).map(x => playerRow(tx, x.id)) };
      })
  );

  const adminPlayer = st.procedure({ accountId: t.u64() }, PlayerDetail, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(asBase(tx), 'operator');
      const player = playerRow(tx, a.accountId);
      const history = [...tx.db.restriction.accountId.filter(a.accountId)]
        .sort((x, y) => (x.id < y.id ? 1 : -1))
        .slice(0, 50)
        .map(r => ({ ...r, status: effectiveStatus(tx, r) }));
      const against = [...tx.db.report.targetId.filter(a.accountId)];
      return {
        player,
        history,
        reportsAgainst: against.length,
        reportsBy: [...tx.db.report.reporterId.filter(a.accountId)].length,
        reportsOpen: against.filter(r => isActiveReport(r.status)).length,
      };
    })
  );

  const adminRestrictions = st.procedure(
    { query: t.string(), kind: t.string(), status: t.string(), accountId: t.u64(), page: t.u32(), pageSize: t.u32() },
    RestrictionPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(asBase(tx), 'operator');
        const q = toLatinDigits(a.query).trim().toLowerCase();
        let activeTotal = 0;
        const list = [...(a.accountId ? tx.db.restriction.accountId.filter(a.accountId) : tx.db.restriction.iter())]
          .map(r => ({ r, eff: effectiveStatus(tx, r) }))
          .filter(({ r, eff }) => {
            if (eff === 'active') activeTotal++;
            if (a.kind && r.kind !== a.kind) return false;
            if (a.status && eff !== a.status) return false;
            if (q) {
              const acc = tx.db.account.id.find(r.accountId);
              if (!acc || !(acc.phone.includes(q) || acc.displayName.toLowerCase().includes(q) || String(acc.id) === q)) return false;
            }
            return true;
          })
          .sort((x, y) => (x.r.id < y.r.id ? 1 : -1));
        const { start, pageSize } = pageOf(a.page, a.pageSize);
        return {
          total: list.length,
          activeTotal,
          rows: list.slice(start, start + pageSize).map(({ r, eff }) => {
            const acc = tx.db.account.id.find(r.accountId);
            return {
              restriction: { ...r, status: eff },
              phone: acc?.phone ?? '',
              displayName: acc?.displayName ?? '',
              createdByPhone: tx.db.account.id.find(r.createdBy)?.phone ?? '',
              effectiveStatus: eff,
            };
          }),
        };
      })
  );

  const adminSaveReportTitle = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, description: Translations, isActive: t.bool(), sort: t.i32() },
    (ctx, a) => {
      const me = requireRole(asBase(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.reportTitle.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const same = ctx.db.reportTitle.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      const row = {
        id: a.id,
        key,
        name: cleanTranslations(a.name, asBase(ctx)),
        description: cleanTranslations(a.description, asBase(ctx), false),
        isActive: a.isActive,
        sort: a.sort,
      };
      const saved = old ? ctx.db.reportTitle.id.update(row) : ctx.db.reportTitle.insert({ ...row, id: 0n });
      audit(asBase(ctx), me.id, old ? 'report_title.update' : 'report_title.create', String(saved.id), key);
    }
  );

  const adminDeleteReportTitle = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(asBase(ctx), 'admin');
    if (!ctx.db.reportTitle.id.find(id)) fail('NOT_FOUND');
    if ([...ctx.db.report.iter()].some(r => r.titleId === id)) fail('IN_USE');
    ctx.db.reportTitle.id.delete(id);
    audit(asBase(ctx), me.id, 'report_title.delete', String(id));
  });

  const adminReportRules = st.view({ name: 'admin_report_rules', public: true }, t.option(playersRows.reportRules), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s || !hasRole(ctx.db.admin.accountId.find(s.accountId)?.role, 'operator')) return undefined;
    return ctx.db.reportRules.id.find(0) ?? undefined;
  });

  const adminSaveReportRules = st.reducer(
    { perHour: t.u32(), duplicateHours: t.u32(), minAccountHours: t.u32(), noteRequired: t.bool(), trustedTagIds: t.array(t.u64()), trustedPerHour: t.u32() },
    (ctx, a) => {
      const me = requireRole(asBase(ctx), 'admin');
      if (a.perHour > 1000 || a.trustedPerHour > 1000) fail('INVALID_RULE:perHour');
      if (a.duplicateHours > 24 * 30) fail('INVALID_RULE:duplicateHours');
      if (a.minAccountHours > 24 * 365) fail('INVALID_RULE:minAccountHours');
      const trustedTagIds = userTagIds(ctx, a.trustedTagIds);
      ctx.db.reportRules.id.update({ id: 0, ...a, trustedTagIds, updatedAt: ctx.timestamp });
      audit(asBase(ctx), me.id, 'report_rules.save', 'rules', JSON.stringify({ ...a, trustedTagIds: trustedTagIds.map(String) }));
    }
  );

  const reportPlayer = st.procedure(
    { targetId: t.u64(), titleKey: t.string(), note: t.string(), matchId: t.string(), contentId: t.string(), gameKey: t.string() },
    ReportResult,
    (ctx, a) =>
      ctx.withTx(tx => {
        const me = requireAccount(asBase(tx));
        if (a.targetId === me.id) fail('CANNOT_REPORT_SELF');
        if (!tx.db.account.id.find(a.targetId)) fail('USER_NOT_FOUND');
        const title = tx.db.reportTitle.key.find(a.titleKey);
        if (!title || !title.isActive) fail('REPORT_TITLE_NOT_FOUND');
        const note = a.note.trim();
        if ([...note].length > 1000) fail('NOTE_TOO_LONG');
        const matchId = cleanContext(a.matchId, 128);
        const contentId = cleanContext(a.contentId, 128);
        const gameKey = cleanContext(a.gameKey, 64);
        const lim = reportLimit(tx, me.id);
        if (lim.rules.noteRequired && !note) fail('NOTE_REQUIRED');
        if (lim.rules.minAccountHours && nowMicros(tx) - me.createdAt.microsSinceUnixEpoch < BigInt(lim.rules.minAccountHours) * HOUR) fail('ACCOUNT_TOO_NEW');
        if (lim.rules.duplicateHours) {
          const since = nowMicros(tx) - BigInt(lim.rules.duplicateHours) * HOUR;
          const dup = [...tx.db.report.reporterId.filter(me.id)].find(
            r => r.targetId === a.targetId && r.titleId === title.id && isActiveReport(r.status) && r.createdAt.microsSinceUnixEpoch >= since
          );
          if (dup) return { reportId: dup.id, duplicate: true };
        }
        if (lim.limit && lim.used >= lim.limit) fail('TOO_MANY_REPORTS');
        const key = `${me.id}|${hourKey(tx)}`;
        if (tx.db.reportRate.key.find(key)) tx.db.reportRate.key.update({ key, count: lim.used + 1 });
        else tx.db.reportRate.insert({ key, count: 1 });
        const r = tx.db.report.insert({
          id: 0n,
          reporterId: me.id,
          targetId: a.targetId,
          titleId: title.id,
          titleKey: title.key,
          titleName: title.name,
          note,
          matchId,
          contentId,
          gameKey,
          status: 'open',
          reviewerId: 0n,
          reviewStartedAt: undefined,
          notes: [],
          action: '',
          restrictionId: 0n,
          resolvedBy: 0n,
          resolvedAt: undefined,
          resolutionNote: '',
          createdAt: tx.timestamp,
        });
        return { reportId: r.id, duplicate: false };
      })
  );

  const myReports = st.procedure({ page: t.u32(), pageSize: t.u32() }, MyReportsPage, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(asBase(tx));
      const list = [...tx.db.report.reporterId.filter(me.id)].sort((x, y) => (x.id < y.id ? 1 : -1));
      const { start, pageSize } = pageOf(a.page, Math.min(a.pageSize || 20, 50));
      const lim = reportLimit(tx, me.id);
      return {
        total: list.length,
        rows: list.slice(start, start + pageSize).map(r => {
          const target = tx.db.account.id.find(r.targetId);
          return {
            id: r.id,
            targetId: r.targetId,
            targetName: target?.displayName ?? '',
            titleKey: r.titleKey,
            title: tr(tx, me.id, r.titleName),
            note: r.note,
            matchId: r.matchId,
            contentId: r.contentId,
            gameKey: r.gameKey,
            status: r.status === 'reviewing' ? 'open' : r.status,
            createdAt: r.createdAt,
            closedAt: r.resolvedAt,
          };
        }),
        perHour: lim.limit,
        remaining: lim.remaining,
        trusted: lim.trusted,
        noteRequired: lim.rules.noteRequired,
        minAccountHours: lim.rules.minAccountHours,
        duplicateHours: lim.rules.duplicateHours,
      };
    })
  );

  const adminReports = st.procedure(
    { query: t.string(), status: t.string(), titleId: t.u64(), targetId: t.u64(), reporterId: t.u64(), gameKey: t.string(), page: t.u32(), pageSize: t.u32() },
    ReportPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(asBase(tx), 'operator');
        const q = toLatinDigits(a.query).trim().toLowerCase();
        let activeTotal = 0;
        const list = [...tx.db.report.iter()]
          .filter(r => {
            if (isActiveReport(r.status)) activeTotal++;
            if (a.status === 'active' ? !isActiveReport(r.status) : a.status && r.status !== a.status) return false;
            if (a.titleId && r.titleId !== a.titleId) return false;
            if (a.targetId && r.targetId !== a.targetId) return false;
            if (a.reporterId && r.reporterId !== a.reporterId) return false;
            if (a.gameKey && r.gameKey !== a.gameKey) return false;
            if (q && !(r.note.toLowerCase().includes(q) || String(r.id) === q || tx.db.account.id.find(r.targetId)?.phone.includes(q))) return false;
            return true;
          })
          .sort((x, y) => (x.id < y.id ? 1 : -1));
        const { start, pageSize } = pageOf(a.page, a.pageSize);
        return { total: list.length, activeTotal, rows: list.slice(start, start + pageSize).map(r => reportListRow(tx, r)) };
      })
  );

  const adminReport = st.procedure({ id: t.u64() }, ReportDetail, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(asBase(tx), 'operator');
      const r = tx.db.report.id.find(a.id);
      if (!r) fail('NOT_FOUND');
      const history = [...tx.db.restriction.accountId.filter(r.targetId)];
      return {
        row: reportListRow(tx, r),
        others: [...tx.db.report.targetId.filter(r.targetId)].filter(x => x.id !== r.id).sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 20),
        target: playerRow(tx, r.targetId),
        warns: history.filter(h => h.kind === 'warn').length,
        mutes: history.filter(h => h.kind === 'mute').length,
        suspends: history.filter(h => h.kind === 'suspend').length,
      };
    })
  );

  const adminReportStatus = st.reducer({ id: t.u64(), status: t.string() }, (ctx, a) => {
    const me = requireRole(asBase(ctx), 'operator');
    const r = ctx.db.report.id.find(a.id);
    if (!r) fail('NOT_FOUND');
    if (!isActiveReport(r.status)) fail('REPORT_CLOSED');
    if (a.status === 'reviewing') ctx.db.report.id.update({ ...r, status: 'reviewing', reviewerId: me.id, reviewStartedAt: ctx.timestamp });
    else if (a.status === 'open') ctx.db.report.id.update({ ...r, status: 'open', reviewerId: 0n, reviewStartedAt: undefined });
    else fail('INVALID_REPORT_STATUS');
    audit(asBase(ctx), me.id, 'report.status', String(r.id), a.status);
  });

  const adminReportNote = st.reducer({ id: t.u64(), text: t.string() }, (ctx, a) => {
    const me = requireRole(asBase(ctx), 'operator');
    const r = ctx.db.report.id.find(a.id);
    if (!r) fail('NOT_FOUND');
    const text = a.text.trim();
    if (!text) fail('TEXT_REQUIRED');
    if ([...text].length > 1000) fail('NOTE_TOO_LONG');
    if (r.notes.length >= 50) fail('TOO_MANY_NOTES');
    ctx.db.report.id.update({ ...r, notes: [...r.notes, { by: me.id, at: ctx.timestamp, text }] });
  });

  const adminResolveReport = st.reducer(
    { id: t.u64(), action: t.string(), minutes: t.u32(), endsAt: t.u64(), reason: Translations, note: t.string(), closeOthers: t.bool() },
    (ctx, a) => {
      const me = requireRole(asBase(ctx), 'operator');
      const r = ctx.db.report.id.find(a.id);
      if (!r) fail('NOT_FOUND');
      if (!isActiveReport(r.status)) fail('REPORT_CLOSED');
      if (!['dismiss', 'warn', 'mute', 'suspend'].includes(a.action)) fail('INVALID_MOD_ACTION');
      let restrictionId = 0n;
      if (a.action !== 'dismiss') {
        restrictionId = restrict(ctx, me.id, { accountId: r.targetId, kind: a.action, minutes: a.minutes, endsAt: a.endsAt, reason: a.reason, note: a.note }, r.id).id;
      }
      const close = (x: ReportRow) =>
        ctx.db.report.id.update({
          ...x,
          status: a.action === 'dismiss' ? 'dismissed' : 'resolved',
          action: a.action,
          restrictionId,
          resolvedBy: me.id,
          resolvedAt: ctx.timestamp,
          resolutionNote: a.note.trim().slice(0, 1000),
        });
      close(r);
      if (a.closeOthers) {
        for (const o of [...ctx.db.report.targetId.filter(r.targetId)]) if (o.id !== r.id && isActiveReport(o.status)) close(o);
      }
      audit(asBase(ctx), me.id, 'report.resolve', String(r.id), `${a.action} closeOthers=${a.closeOthers}`);
    }
  );

  const adminModerationSummary = st.procedure(ModerationSummary, ctx =>
    ctx.withTx(tx => {
      requireRole(asBase(tx), 'operator');
      const now = nowMicros(tx);
      const suspended = new Set<bigint>();
      const muted = new Set<bigint>();
      for (const r of tx.db.restriction.status.filter('active')) {
        if (r.endsAt.microsSinceUnixEpoch <= now) continue;
        if (r.kind === 'suspend') suspended.add(r.accountId);
        if (r.kind === 'mute') muted.add(r.accountId);
      }
      let open = 0;
      let reviewing = 0;
      for (const r of tx.db.report.iter()) {
        if (r.status === 'open') open++;
        if (r.status === 'reviewing') reviewing++;
      }
      return { suspended: suspended.size, muted: muted.size, reportsOpen: open, reportsReviewing: reviewing, tagged: new Set([...tx.db.userTag.iter()].map(x => x.accountId)).size };
    })
  );

  return {
    expireRestrictions,
    myStatus,
    myTags,
    adminSetTagVisibility,
    adminSetPlayerTags,
    adminBulkPlayerTags,
    adminRestrict,
    adminLiftRestriction,
    adminPlayers,
    adminPlayer,
    adminRestrictions,
    adminSaveReportTitle,
    adminDeleteReportTitle,
    adminReportRules,
    adminSaveReportRules,
    reportPlayer,
    myReports,
    adminReports,
    adminReport,
    adminReportStatus,
    adminReportNote,
    adminResolveReport,
    adminModerationSummary,
  };
}
