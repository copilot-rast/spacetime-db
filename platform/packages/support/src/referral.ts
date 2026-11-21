import { t } from 'spacetimedb/server';
import { adminOrNull, audit, fail, loginHooks, requireAccount, requireRole, signHex, toLatinDigits } from '@stg/base';
import { prizeUseChecks } from '@stg/economy';
import { createClaim, eventHooks, grantReady } from '@stg/gamification';
import { supRows, type SupportSchema } from './schema';
import { DAY_US, HOUR_US, base, bump, deviceOf, isPlayerAccount, langOf, nameOf, nowUs, page, pick, randomCode, tehranDay, writeActivity, type ReferralRow, type SDb, type STx } from './engine';

const MEASURES = ['count', 'sum', 'max'];

const InfoRow = t.row('ReferralInfoRow', {
  accountId: t.u64().primaryKey(),
  code: t.string(),
  enabled: t.bool(),
  enterUntil: t.u64(),
  referredByName: t.string(),
  referredStatus: t.string(),
  total: t.u32(),
  completed: t.u32(),
  pending: t.u32(),
  held: t.u32(),
});
const InviteRow = t.row('ReferralInviteRow', { id: t.u64().primaryKey(), name: t.string(), status: t.string(), createdAt: t.u64(), completedAt: t.u64() });
const Invite = t.object('ReferralInviteLine', { name: t.string(), status: t.string(), createdAt: t.u64() });
const Me = t.object('ReferralMe', {
  code: t.string(),
  enabled: t.bool(),
  canEnter: t.bool(),
  enterUntil: t.u64(),
  newAccountDays: t.u32(),
  referredByName: t.string(),
  referredStatus: t.string(),
  total: t.u32(),
  completed: t.u32(),
  pending: t.u32(),
  recent: t.array(Invite),
  referrerPrizeId: t.u64(),
  refereePrizeId: t.u64(),
  goalEventKey: t.string(),
  goalEventName: t.string(),
  goalMeasure: t.string(),
  goalValue: t.f64(),
});
const EnterResult = t.object('ReferralEntered', { referralId: t.u64(), status: t.string(), claims: t.array(t.u64()) });
const AdminLine = t.object('ReferralAdminLine', { referral: supRows.referral, referrerName: t.string(), refereeName: t.string(), progress: t.f64(), flagged: t.bool() });
const AdminPage = t.object('ReferralAdminPage', { total: t.u32(), rows: t.array(AdminLine) });
const TopLine = t.object('ReferralTopLine', { accountId: t.u64(), name: t.string(), total: t.u32(), completed: t.u32() });
const Summary = t.object('ReferralSummary', { total: t.u32(), pending: t.u32(), held: t.u32(), completed: t.u32(), rejected: t.u32(), flagged: t.u32(), top: t.array(TopLine) });
const TreeLine = t.object('ReferralTreeLine', { accountId: t.u64(), name: t.string(), status: t.string(), createdAt: t.u64() });
const Tree = t.object('ReferralTree', { accountId: t.u64(), code: t.string(), up: t.array(TreeLine), down: t.array(TreeLine) });

export function refSettings(ctx: SDb) {
  const s = ctx.db.refSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function ensureCode(ctx: STx, accountId: bigint) {
  const old = ctx.db.refCode.accountId.find(accountId);
  if (old) return old.code;
  for (let i = 0; i < 50; i++) {
    const code = randomCode(ctx.env.OTP_SECRET, `referral|${accountId}|${i}`, 8);
    if (!ctx.db.refCode.code.find(code)) {
      ctx.db.refCode.insert({ accountId, code, createdAt: ctx.timestamp });
      return code;
    }
  }
  fail('CODE_EXHAUSTED');
}

export function normalizeCode(raw: string) {
  return toLatinDigits(raw)
    .toUpperCase()
    .replace(/[\s‌‍_-]+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function progressOf(ctx: SDb, r: { refereeId: bigint; goalEventKey: string; goalMeasure: string }) {
  if (!r.goalEventKey) return 0;
  const c = ctx.db.eventCounter.key.find(`${r.refereeId}|${r.goalEventKey}|all`);
  if (!c) return 0;
  return r.goalMeasure === 'sum' ? c.sum : r.goalMeasure === 'max' ? c.max : c.count;
}

function goalReached(ctx: SDb, r: ReferralRow) {
  if (!r.goalEventKey) return true;
  return progressOf(ctx, r) >= r.goalValue;
}

function complete(ctx: STx, r: ReferralRow) {
  const claims: bigint[] = [];
  const g = ctx as never;
  const a = r.referrerPrizeId && ctx.db.prize.id.find(r.referrerPrizeId) ? createClaim(g, r.referrerId, 'referral', r.id, 0n, 'referrer', r.referrerPrizeId, 'auto', 0) : undefined;
  const b = r.refereePrizeId && ctx.db.prize.id.find(r.refereePrizeId) ? createClaim(g, r.refereeId, 'referral', r.id, 0n, 'referee', r.refereePrizeId, 'auto', 0) : undefined;
  if (a) claims.push(a.id);
  if (b) claims.push(b.id);
  const next = { ...r, status: 'completed', completedAt: nowUs(ctx), referrerClaimId: a?.id ?? 0n, refereeClaimId: b?.id ?? 0n };
  ctx.db.referral.id.update(next);
  const data = JSON.stringify({ referralId: String(r.id) });
  writeActivity(ctx, r.refereeId, { kind: 'referral', action: 'completed', refId: String(r.id), data, actor: 'system' });
  writeActivity(ctx, r.referrerId, { kind: 'referral', action: 'completed', refId: String(r.id), data, actor: 'system' });
  return claims;
}

function settle(ctx: STx, r: ReferralRow) {
  if (r.status !== 'pending') return [];
  if (!goalReached(ctx, r)) return [];
  return complete(ctx, r);
}

export function defineReferral(st: SupportSchema) {
  loginHooks.push((raw, accountId) => {
    const ctx = raw as unknown as STx;
    if (!ctx.db.refSettings.id.find(0)) return;
    const a = ctx.db.account.id.find(accountId);
    if (isPlayerAccount(a)) ensureCode(ctx, accountId);
  });
  eventHooks.push((raw, accountId, key) => {
    const ctx = raw as unknown as STx;
    if (!ctx.db.refSettings.id.find(0)) return;
    const r = ctx.db.referral.refereeId.find(accountId);
    if (!r || r.status !== 'pending' || r.goalEventKey !== key) return;
    settle(ctx, r);
  });
  prizeUseChecks.push((raw, id) => {
    const ctx = raw as unknown as STx;
    const s = ctx.db.refSettings.id.find(0);
    if (s && (s.referrerPrizeId === id || s.refereePrizeId === id)) return true;
    return [...ctx.db.referral.status.filter('pending'), ...ctx.db.referral.status.filter('held')].some(r => r.referrerPrizeId === id || r.refereePrizeId === id);
  });

  const adminReferralSettings = st.view({ name: 'admin_referral_settings', public: true }, t.option(supRows.refSettings), ctx =>
    adminOrNull(ctx as any) ? ctx.db.refSettings.id.find(0) ?? undefined : undefined
  );

  const adminSaveReferralSettings = st.reducer(
    {
      isEnabled: t.bool(),
      newAccountDays: t.u32(),
      referrerPrizeId: t.u64(),
      refereePrizeId: t.u64(),
      goalEventKey: t.string(),
      goalMeasure: t.string(),
      goalValue: t.f64(),
      maxPerReferrer: t.u32(),
      dailyPerReferrer: t.u32(),
      onePerDevice: t.bool(),
      onePerPhone: t.bool(),
      holdFlagged: t.bool(),
      triesPerHour: t.u32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const s = refSettings(ctx);
      if (a.newAccountDays > 365) fail('INVALID_SETTING:newAccountDays');
      if (a.maxPerReferrer > 100_000) fail('INVALID_SETTING:maxPerReferrer');
      if (a.dailyPerReferrer > 100_000) fail('INVALID_SETTING:dailyPerReferrer');
      if (a.triesPerHour > 1000) fail('INVALID_SETTING:triesPerHour');
      if (a.referrerPrizeId) {
        const p = ctx.db.prize.id.find(a.referrerPrizeId);
        if (!p) fail('PRIZE_NOT_FOUND');
        if (!p.isRepeatable) fail('PRIZE_NOT_REPEATABLE');
      }
      if (a.refereePrizeId && !ctx.db.prize.id.find(a.refereePrizeId)) fail('PRIZE_NOT_FOUND');
      const goalEventKey = a.goalEventKey.trim();
      if (!MEASURES.includes(a.goalMeasure)) fail('INVALID_MEASURE');
      if (goalEventKey) {
        const ev = ctx.db.eventType.key.find(goalEventKey);
        if (!ev) fail('EVENT_TYPE_NOT_FOUND');
        if (!Number.isFinite(a.goalValue) || a.goalValue <= 0) fail('INVALID_GOAL');
      }
      ctx.db.refSettings.id.update({ ...s, ...a, goalEventKey, goalValue: goalEventKey ? a.goalValue : 0, updatedAt: ctx.timestamp });
      audit(base(ctx), me.id, 'referral_settings.save', 'settings', JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
    }
  );

  const myReferral = st.view({ name: 'my_referral', public: true }, t.option(InfoRow), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return undefined;
    const acc = ctx.db.account.id.find(s.accountId);
    if (!isPlayerAccount(acc)) return undefined;
    const rs = ctx.db.refSettings.id.find(0);
    const offset = BigInt(ctx.db.supSettings.id.find(0)?.clockOffsetSec ?? 0n) * 1_000_000n;
    const mine = ctx.db.referral.refereeId.find(acc!.id);
    const invited = [...ctx.db.referral.referrerId.filter(acc!.id)];
    return {
      accountId: acc!.id,
      code: ctx.db.refCode.accountId.find(acc!.id)?.code ?? '',
      enabled: !!rs?.isEnabled,
      enterUntil: rs?.newAccountDays ? acc!.createdAt.microsSinceUnixEpoch + BigInt(rs.newAccountDays) * DAY_US - offset : 0n,
      referredByName: mine ? nameOf(ctx as any, mine.referrerId) : '',
      referredStatus: mine ? (mine.status === 'held' ? 'pending' : mine.status) : '',
      total: invited.filter(r => r.status !== 'rejected').length,
      completed: invited.filter(r => r.status === 'completed').length,
      pending: invited.filter(r => r.status === 'pending').length,
      held: invited.filter(r => r.status === 'held').length,
    };
  });

  const myReferrals = st.view({ name: 'my_referrals', public: true }, t.array(InviteRow), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return [];
    return [...ctx.db.referral.referrerId.filter(s.accountId)].map(r => ({ id: r.id, name: nameOf(ctx as any, r.refereeId), status: r.status === 'held' ? 'pending' : r.status, createdAt: r.createdAt, completedAt: r.completedAt }));
  });

  const referralMe = st.procedure({ lang: t.string() }, Me, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      if (!isPlayerAccount(me)) fail('PLAYERS_ONLY');
      const s = refSettings(tx);
      const code = ensureCode(tx, me.id);
      const lang = langOf(tx, me.id, a.lang);
      const mine = tx.db.referral.refereeId.find(me.id);
      const invited = [...tx.db.referral.referrerId.filter(me.id)].sort((x, y) => (x.id < y.id ? 1 : -1));
      const enterUntil = s.newAccountDays ? me.createdAt.microsSinceUnixEpoch + BigInt(s.newAccountDays) * DAY_US : 0n;
      const ev = s.goalEventKey ? tx.db.eventType.key.find(s.goalEventKey) : undefined;
      return {
        code,
        enabled: s.isEnabled,
        canEnter: s.isEnabled && !mine && (!enterUntil || nowUs(tx) <= enterUntil),
        enterUntil,
        newAccountDays: s.newAccountDays,
        referredByName: mine ? nameOf(tx, mine.referrerId) : '',
        referredStatus: mine ? (mine.status === 'held' ? 'pending' : mine.status) : '',
        total: invited.filter(r => r.status !== 'rejected').length,
        completed: invited.filter(r => r.status === 'completed').length,
        pending: invited.filter(r => r.status === 'pending' || r.status === 'held').length,
        recent: invited.slice(0, 10).map(r => ({ name: nameOf(tx, r.refereeId), status: r.status === 'held' ? 'pending' : r.status, createdAt: r.createdAt })),
        referrerPrizeId: s.referrerPrizeId,
        refereePrizeId: s.refereePrizeId,
        goalEventKey: s.goalEventKey,
        goalEventName: ev ? pick(tx, ev.name, lang) : '',
        goalMeasure: s.goalMeasure,
        goalValue: s.goalValue,
      };
    })
  );

  const referralEnter = st.procedure({ code: t.string() }, EnterResult, (ctx, a) => {
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      if (!isPlayerAccount(me)) fail('PLAYERS_ONLY');
      const s = refSettings(tx);
      if (!s.isEnabled) fail('REFERRAL_DISABLED');
      bump(tx, `reftry|${me.id}`, s.triesPerHour, HOUR_US, 'TOO_MANY_TRIES');
    });
    const out = ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const s = refSettings(tx);
      const code = normalizeCode(a.code);
      if (!code) fail('INVALID_CODE');
      const owner = tx.db.refCode.code.find(code);
      const referrer = owner ? tx.db.account.id.find(owner.accountId) : undefined;
      if (!owner || !isPlayerAccount(referrer)) fail('CODE_NOT_FOUND');
      if (owner.accountId === me.id || referrer!.phone === me.phone) fail('SELF_REFERRAL');
      if (tx.db.referral.refereeId.find(me.id)) fail('ALREADY_REFERRED');
      const now = nowUs(tx);
      if (s.newAccountDays && now - me.createdAt.microsSinceUnixEpoch > BigInt(s.newAccountDays) * DAY_US) fail('ACCOUNT_TOO_OLD');
      let up = tx.db.referral.refereeId.find(owner.accountId);
      for (let i = 0; up && i < 20; i++) {
        if (up.referrerId === me.id) fail('REFERRAL_CYCLE');
        up = tx.db.referral.refereeId.find(up.referrerId);
      }
      const theirs = [...tx.db.referral.referrerId.filter(owner.accountId)];
      if (s.maxPerReferrer && theirs.filter(r => r.status !== 'rejected').length >= s.maxPerReferrer) fail('REFERRER_LIMIT');
      const device = deviceOf(tx);
      const deviceKey = `device|${device}`;
      const phoneKey = `phone|${signHex(tx.env.OTP_SECRET, `phone|${me.phone}`).slice(0, 32)}`;
      const flags: string[] = [];
      if (tx.db.refMark.key.find(deviceKey)) {
        if (s.onePerDevice) fail('DEVICE_ALREADY_USED');
        flags.push('shared_device');
      }
      if (tx.db.refMark.key.find(phoneKey)) {
        if (s.onePerPhone) fail('PHONE_ALREADY_USED');
        flags.push('shared_phone');
      }
      const today = tehranDay(now);
      if (s.dailyPerReferrer && theirs.filter(r => tehranDay(r.createdAt) === today).length >= s.dailyPerReferrer) flags.push('burst');
      const since = now - 30n * DAY_US;
      if ([...tx.db.playerActivity.accountId.filter(owner.accountId)].some(x => x.device === device && x.at >= since)) flags.push('same_device');
      const held = flags.length > 0 && s.holdFlagged;
      const r = tx.db.referral.insert({
        id: 0n,
        referrerId: owner.accountId,
        refereeId: me.id,
        code,
        status: held ? 'held' : 'pending',
        flags,
        referrerPrizeId: s.referrerPrizeId,
        refereePrizeId: s.refereePrizeId,
        goalEventKey: s.goalEventKey,
        goalMeasure: s.goalMeasure,
        goalValue: s.goalValue,
        device,
        referrerClaimId: 0n,
        refereeClaimId: 0n,
        decidedBy: 0n,
        decidedAt: 0n,
        note: '',
        createdAt: now,
        completedAt: 0n,
      });
      for (const key of [deviceKey, phoneKey]) if (!tx.db.refMark.key.find(key)) tx.db.refMark.insert({ key, referralId: r.id, at: tx.timestamp });
      writeActivity(tx, me.id, { kind: 'referral', action: 'entered', refId: String(r.id), data: JSON.stringify({ code }), actor: 'player' });
      writeActivity(tx, owner.accountId, { kind: 'referral', action: 'joined', refId: String(r.id), data: JSON.stringify({ refereeId: String(me.id) }), actor: 'system' });
      const claims = settle(tx, r);
      return { referralId: r.id, status: tx.db.referral.id.find(r.id)!.status, claims };
    });
    if (out.claims.length) grantReady(ctx as never, out.claims);
    return { ...out, status: out.status === 'held' ? 'pending' : out.status };
  });

  const adminApproveReferral = st.procedure({ id: t.u64(), note: t.string() }, EnterResult, (ctx, a) => {
    const out = ctx.withTx(tx => {
      const me = requireRole(base(tx), 'admin');
      const r = tx.db.referral.id.find(a.id);
      if (!r) fail('NOT_FOUND');
      if (r.status !== 'held') fail('NOT_HELD');
      const next = { ...r, status: 'pending', decidedBy: me.id, decidedAt: nowUs(tx), note: a.note.trim().slice(0, 500) };
      tx.db.referral.id.update(next);
      writeActivity(tx, r.refereeId, { kind: 'referral', action: 'approved', refId: String(r.id), actor: `admin:${me.id}` });
      audit(base(tx), me.id, 'referral.approve', String(r.id), next.note);
      const claims = settle(tx, next);
      return { referralId: r.id, status: tx.db.referral.id.find(r.id)!.status, claims };
    });
    if (out.claims.length) grantReady(ctx as never, out.claims);
    return out;
  });

  const adminRejectReferral = st.reducer({ id: t.u64(), note: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const r = ctx.db.referral.id.find(a.id);
    if (!r) fail('NOT_FOUND');
    if (r.status === 'completed' || r.status === 'rejected') fail('REFERRAL_DECIDED');
    const note = a.note.trim().slice(0, 500);
    ctx.db.referral.id.update({ ...r, status: 'rejected', decidedBy: me.id, decidedAt: nowUs(ctx), note });
    writeActivity(ctx, r.refereeId, { kind: 'referral', action: 'rejected', refId: String(r.id), actor: `admin:${me.id}` });
    audit(base(ctx), me.id, 'referral.reject', String(r.id), note);
  });

  const adminReferrals = st.procedure(
    { query: t.string(), status: t.string(), flag: t.string(), flagged: t.bool(), referrerId: t.u64(), refereeId: t.u64(), page: t.u32(), pageSize: t.u32() },
    AdminPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(base(tx), 'operator');
        const q = normalizeCode(a.query);
        const qs = toLatinDigits(a.query).trim().toLowerCase();
        const list = [...tx.db.referral.iter()]
          .filter(r => {
            if (a.status && r.status !== a.status) return false;
            if (a.flag && !r.flags.includes(a.flag)) return false;
            if (a.flagged && !r.flags.length) return false;
            if (a.referrerId && r.referrerId !== a.referrerId) return false;
            if (a.refereeId && r.refereeId !== a.refereeId) return false;
            if (qs && !(r.code === q || String(r.referrerId) === qs || String(r.refereeId) === qs || nameOf(tx, r.referrerId).toLowerCase().includes(qs) || nameOf(tx, r.refereeId).toLowerCase().includes(qs))) return false;
            return true;
          })
          .sort((x, y) => (x.id < y.id ? 1 : -1));
        const p = page(list, a.page, a.pageSize);
        return { total: p.total, rows: p.rows.map(r => ({ referral: r, referrerName: nameOf(tx, r.referrerId), refereeName: nameOf(tx, r.refereeId), progress: progressOf(tx, r), flagged: r.flags.length > 0 })) };
      })
  );

  const adminReferralSummary = st.procedure(Summary, ctx =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const all = [...tx.db.referral.iter()];
      const by = new Map<bigint, { total: number; completed: number }>();
      for (const r of all) {
        if (r.status === 'rejected') continue;
        const x = by.get(r.referrerId) ?? { total: 0, completed: 0 };
        x.total++;
        if (r.status === 'completed') x.completed++;
        by.set(r.referrerId, x);
      }
      const top = [...by.entries()]
        .sort((x, y) => y[1].total - x[1].total || y[1].completed - x[1].completed || (x[0] < y[0] ? -1 : 1))
        .slice(0, 10)
        .map(([accountId, v]) => ({ accountId, name: nameOf(tx, accountId), ...v }));
      const n = (s: string) => all.filter(r => r.status === s).length;
      return { total: all.length, pending: n('pending'), held: n('held'), completed: n('completed'), rejected: n('rejected'), flagged: all.filter(r => r.flags.length).length, top };
    })
  );

  const adminReferralTree = st.procedure({ accountId: t.u64() }, Tree, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      const up = [];
      const seen = new Set<bigint>([a.accountId]);
      let r = tx.db.referral.refereeId.find(a.accountId);
      while (r && up.length < 5 && !seen.has(r.referrerId)) {
        seen.add(r.referrerId);
        up.push({ accountId: r.referrerId, name: nameOf(tx, r.referrerId), status: r.status, createdAt: r.createdAt });
        r = tx.db.referral.refereeId.find(r.referrerId);
      }
      const down = [...tx.db.referral.referrerId.filter(a.accountId)].map(x => ({ accountId: x.refereeId, name: nameOf(tx, x.refereeId), status: x.status, createdAt: x.createdAt }));
      return { accountId: a.accountId, code: tx.db.refCode.accountId.find(a.accountId)?.code ?? '', up, down };
    })
  );

  return {
    adminReferralSettings,
    adminSaveReferralSettings,
    myReferral,
    myReferrals,
    referralMe,
    referralEnter,
    adminApproveReferral,
    adminRejectReferral,
    adminReferrals,
    adminReferralSummary,
    adminReferralTree,
  };
}
