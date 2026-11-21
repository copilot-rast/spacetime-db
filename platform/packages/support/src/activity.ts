import { t } from 'spacetimedb/server';
import { activityWriters, fail, loginHooks, requireAccount, requireRole, toLatinDigits } from '@stg/base';
import { paymentHooks } from '@stg/economy';
import { eventHooks } from '@stg/gamification';
import { supRows, type SupportSchema } from './schema';
import { DAY_US, base, nowUs, page, writeActivity, type STx } from './engine';

const SYSTEM_KINDS: Record<string, string> = { level_up: 'level', achievement_unlocked: 'achievement', task_completed: 'task' };

const ActivityLine = t.row('ActivityLine', { id: t.u64().primaryKey(), kind: t.string(), action: t.string(), refId: t.string(), data: t.string(), actor: t.string(), platform: t.string(), country: t.string(), at: t.u64() });
const MinePage = t.object('ActivityMinePage', { rows: t.array(supRows.activity), next: t.u64() });
const AdminPage = t.object('ActivityAdminPage', { total: t.u32(), rows: t.array(supRows.activity) });
const KindCount = t.object('ActivityKindCount', { kind: t.string(), total: t.u32(), today: t.u32() });
const Summary = t.object('ActivitySummary', { total: t.u32(), today: t.u32(), players: t.u32(), kinds: t.array(KindCount), retentionDays: t.u32() });

export function defineActivity(st: SupportSchema) {
  activityWriters.push((raw, accountId, e) => writeActivity(raw as unknown as STx, accountId, e));
  loginHooks.push((raw, accountId, isNew) => {
    const ctx = raw as unknown as STx;
    const a = ctx.db.account.id.find(accountId);
    writeActivity(ctx, accountId, { kind: 'login', action: isNew ? 'signup' : 'login', actor: a?.phone.startsWith('admin:') ? 'admin' : 'player' });
  });
  paymentHooks.push((raw, accountId, paymentId) => {
    const ctx = raw as unknown as STx;
    const p = ctx.db.payment.id.find(paymentId);
    writeActivity(ctx, accountId, { kind: 'purchase', action: 'completed', refId: String(paymentId), data: JSON.stringify({ productId: String(p?.productId ?? 0n), method: p?.method ?? '', toman: String(p?.finalToman ?? 0n) }), actor: 'player' });
  });
  eventHooks.push((raw, accountId, key, value) => {
    const kind = SYSTEM_KINDS[key];
    if (!kind) return;
    writeActivity(raw as unknown as STx, accountId, { kind, action: key, data: JSON.stringify({ value }), actor: 'system' });
  });

  const myActivity = st.view({ name: 'my_activity', public: true }, t.array(ActivityLine), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return [];
    return [...ctx.db.playerActivity.accountId.filter(s.accountId)]
      .sort((x, y) => (x.id < y.id ? 1 : -1))
      .slice(0, 200)
      .map(r => ({ id: r.id, kind: r.kind, action: r.action, refId: r.refId, data: r.data, actor: r.actor.startsWith('admin:') ? 'admin' : r.actor, platform: r.platform, country: r.country, at: r.at }));
  });

  const activityMine = st.procedure({ kind: t.string(), before: t.u64(), limit: t.u32() }, MinePage, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const limit = Math.min(Math.max(a.limit || 50, 1), 200);
      const list = [...tx.db.playerActivity.accountId.filter(me.id)]
        .filter(r => (!a.kind || r.kind === a.kind) && (!a.before || r.id < a.before))
        .sort((x, y) => (x.id < y.id ? 1 : -1));
      const rows = list.slice(0, limit).map(r => ({ ...r, device: '', actor: r.actor.startsWith('admin:') ? 'admin' : r.actor }));
      return { rows, next: list.length > limit ? rows[rows.length - 1].id : 0n };
    })
  );

  const adminActivity = st.procedure(
    { accountId: t.u64(), kinds: t.array(t.string()), action: t.string(), country: t.string(), platform: t.string(), from: t.u64(), to: t.u64(), q: t.string(), page: t.u32(), pageSize: t.u32() },
    AdminPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(base(tx), 'support');
        if (a.from && a.to && a.from > a.to) fail('INVALID_RANGE');
        const q = toLatinDigits(a.q).trim().toLowerCase();
        const src = a.accountId ? [...tx.db.playerActivity.accountId.filter(a.accountId)] : [...tx.db.playerActivity.iter()];
        const list = src
          .filter(r => {
            if (a.kinds.length && !a.kinds.includes(r.kind)) return false;
            if (a.action && r.action !== a.action) return false;
            if (a.country && r.country !== a.country.toUpperCase()) return false;
            if (a.platform && r.platform !== a.platform) return false;
            if (a.from && r.at < a.from) return false;
            if (a.to && r.at > a.to) return false;
            if (q && !(r.data.toLowerCase().includes(q) || r.refId.toLowerCase().includes(q) || r.actor.toLowerCase().includes(q))) return false;
            return true;
          })
          .sort((x, y) => (x.id < y.id ? 1 : -1));
        return page(list, a.page, a.pageSize);
      })
  );

  const adminActivitySummary = st.procedure(Summary, ctx =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'support');
      const since = nowUs(tx) - DAY_US;
      const kinds = new Map<string, { total: number; today: number }>();
      const players = new Set<bigint>();
      let total = 0;
      let today = 0;
      for (const r of tx.db.playerActivity.iter()) {
        total++;
        players.add(r.accountId);
        const k = kinds.get(r.kind) ?? { total: 0, today: 0 };
        k.total++;
        if (r.at >= since) {
          k.today++;
          today++;
        }
        kinds.set(r.kind, k);
      }
      return {
        total,
        today,
        players: players.size,
        kinds: [...kinds.entries()].sort((x, y) => y[1].total - x[1].total).map(([kind, v]) => ({ kind, ...v })),
        retentionDays: tx.db.supSettings.id.find(0)?.activityRetentionDays ?? 0,
      };
    })
  );

  return {
    myActivity,
    activityMine,
    adminActivity,
    adminActivitySummary,
  };
}
