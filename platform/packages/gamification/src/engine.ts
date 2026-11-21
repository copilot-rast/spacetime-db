import type { InferSchema, ProcedureCtx, ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { fail, sign } from '@stg/base';
import { addMeta, grantPrize, metaValue, setMeta, type ETx, type Reward } from '@stg/economy';
import type { GamificationSchema } from './schema';

export type GS = InferSchema<GamificationSchema>;
export type GTx = ReducerCtx<GS>;
export type GProc = ProcedureCtx<GS>;

export const GRANT_MODES = ['auto', 'claim'];
export const MEASURES = ['count', 'sum', 'max'];
export const SYSTEM_EVENTS: [string, string, string][] = [
  ['login', 'ورود', 'Login'],
  ['purchase_completed', 'خرید', 'Purchase completed'],
  ['level_up', 'سطح تازه', 'Level up'],
  ['task_completed', 'تسک انجام شد', 'Task completed'],
  ['achievement_unlocked', 'دستاورد باز شد', 'Achievement unlocked'],
  ['meta_relation_completed', 'رابطهٔ متا انجام شد', 'Meta relation completed'],
];

export const chain = { base: 0, created: [] as bigint[] };

export type Outcome = {
  eventId: bigint;
  claims: bigint[];
  streaks: { key: string; count: number; advanced: boolean; floor: number; fell: boolean }[];
  tasks: { key: string; scope: string; value: number; target: number; status: string }[];
  achievements: { key: string; from: number; to: number }[];
};

export function econ(ctx: GTx) {
  return ctx as unknown as ETx;
}

export function gamSettings(ctx: { db: GTx['db'] }) {
  const s = ctx.db.gamSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function nowMicros(ctx: GTx) {
  const s = ctx.db.gamSettings.id.find(0);
  return ctx.timestamp.microsSinceUnixEpoch + BigInt(s?.clockOffsetSec ?? 0n) * 1_000_000n;
}

export function dayNumber(micros: bigint) {
  return Math.floor((Number(micros / 1000n) + 12_600_000) / 86_400_000);
}

export function dayKeyOf(n: number) {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export function weekStartDay(n: number, weekStart: number) {
  const dow = (n + 4) % 7;
  return n - ((dow - weekStart + 7) % 7);
}

export function windowOf(period: string, micros: bigint, weekStart: number) {
  const n = dayNumber(micros);
  if (period === 'day') return `d${dayKeyOf(n)}`;
  if (period === 'week') return `w${dayKeyOf(weekStartDay(n, weekStart))}`;
  return 'all';
}

export function windowEnd(period: string, micros: bigint, weekStart: number) {
  const n = dayNumber(micros);
  const end = period === 'day' ? n + 1 : period === 'week' ? weekStartDay(n, weekStart) + 7 : 0;
  return end ? BigInt(end * 86_400_000 - 12_600_000) * 1000n : 0n;
}

export function inWindow(startsAt: bigint, endsAt: bigint, now: bigint) {
  return (!startsAt || now >= startsAt) && (!endsAt || now < endsAt);
}

export function hasAudience(ctx: { db: GTx['db'] }, accountId: bigint, tags: bigint[]) {
  if (!tags.length) return true;
  return [...ctx.db.userTag.byAccountTag.filter(accountId)].some(ut => tags.includes(ut.tagId));
}

export function measureOf(m: string, r: { count: number; sum: number; max: number }) {
  return m === 'count' ? r.count : m === 'sum' ? r.sum : r.max;
}

export function inRange(v: number, min: number | undefined, max: number | undefined) {
  return (min === undefined || v >= min) && (max === undefined || v <= max);
}

export function scheduleGrants(ctx: GTx) {
  if (ctx.db.grantTimer.count() === 0n) ctx.db.grantTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch) });
}

export function createClaim(ctx: GTx, accountId: bigint, kind: string, ownerId: bigint, refId: bigint, scope: string, prizeId: bigint, grantMode: string, depth: number) {
  if (!prizeId) return undefined;
  const uniq = `${kind}|${ownerId}|${refId}|${accountId}|${scope}`;
  if (ctx.db.claim.uniq.find(uniq)) return undefined;
  const row = ctx.db.claim.insert({
    id: 0n,
    uniq,
    accountId,
    kind,
    ownerId,
    refId,
    scope,
    prizeId,
    grantMode,
    status: 'ready',
    depth: Math.min(depth, 255),
    attempts: 0,
    error: '',
    rewards: '[]',
    createdAt: ctx.timestamp,
    grantedAt: undefined,
  });
  if (grantMode === 'auto') {
    scheduleGrants(ctx);
    if (chain.created.length < 500) chain.created.push(row.id);
  }
  return row;
}

export function grantClaim(ctx: GTx, claimId: bigint, accountId?: bigint): Reward[] {
  const c = ctx.db.claim.id.find(claimId);
  if (!c || (accountId !== undefined && c.accountId !== accountId)) fail('CLAIM_NOT_FOUND');
  if (c.status === 'granted') fail('ALREADY_CLAIMED');
  const prev = chain.base;
  chain.base = c.depth + 1;
  let rewards: Reward[];
  try {
    rewards = grantPrize(econ(ctx), c.accountId, c.prizeId, `gam_${c.kind}`, c.uniq);
  } finally {
    chain.base = prev;
  }
  ctx.db.claim.id.update({ ...c, status: 'granted', error: '', rewards: JSON.stringify(rewards), grantedAt: ctx.timestamp });
  if (c.kind === 'task') {
    for (const ut of ctx.db.userTask.byAccountTask.filter([c.accountId, c.ownerId])) {
      if (ut.claimId === c.id) ctx.db.userTask.id.update({ ...ut, status: 'claimed', claimedAt: ctx.timestamp, error: '' });
    }
  }
  return rewards;
}

export function tryGrant(ctx: GProc, claimId: bigint, accountId?: bigint) {
  try {
    return { rewards: ctx.withTx(tx => grantClaim(tx, claimId, accountId)), error: '' };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    if (accountId === undefined) {
      ctx.withTx(tx => {
        const c = tx.db.claim.id.find(claimId);
        if (c && c.status !== 'granted') tx.db.claim.id.update({ ...c, status: 'failed', error: msg, attempts: Math.min(c.attempts + 1, 255) });
        if (c && c.kind === 'task') {
          for (const ut of tx.db.userTask.byAccountTask.filter([c.accountId, c.ownerId])) if (ut.claimId === c.id) tx.db.userTask.id.update({ ...ut, error: msg });
        }
      });
    }
    return { rewards: [] as Reward[], error: msg };
  }
}

export function grantReady(ctx: GProc, ids?: bigint[]) {
  for (let round = 0; round < 20; round++) {
    const list = ctx.withTx(tx => {
      const ready = ids ?? [...tx.db.claim.status.filter('ready')].filter(c => c.grantMode === 'auto').slice(0, 50).map(c => c.id);
      return ready.filter(id => {
        const c = tx.db.claim.id.find(id);
        return !!c && c.status === 'ready' && c.grantMode === 'auto';
      });
    });
    if (!list.length) return;
    for (const id of list) tryGrant(ctx, id);
    ids = undefined;
  }
}

function emptyOutcome(): Outcome {
  return { eventId: 0n, claims: [], streaks: [], tasks: [], achievements: [] };
}

export function checkRate(ctx: GTx, accountId: bigint, typeKey: string, typeLimit: number, playerLimit: number) {
  const minute = ctx.timestamp.microsSinceUnixEpoch / 60_000_000n;
  const bump = (key: string, limit: number) => {
    if (!limit) return;
    const k = `${accountId}|${key}|${minute}`;
    const r = ctx.db.eventRate.key.find(k);
    if (r && r.count >= limit) fail('TOO_MANY_EVENTS');
    if (r) ctx.db.eventRate.key.update({ ...r, count: r.count + 1 });
    else ctx.db.eventRate.insert({ key: k, minute, count: 1 });
  };
  bump(typeKey, typeLimit);
  bump('*', playerLimit);
}

function bumpCounter(ctx: GTx, accountId: bigint, typeKey: string, window: string, value: number) {
  const key = `${accountId}|${typeKey}|${window}`;
  const r = ctx.db.eventCounter.key.find(key);
  if (r) ctx.db.eventCounter.key.update({ ...r, count: r.count + 1, sum: r.sum + value, max: Math.max(r.max, value) });
  else ctx.db.eventCounter.insert({ key, accountId, typeKey, window, count: 1, sum: value, max: value });
}

export function recordEvent(raw: unknown, accountId: bigint, key: string, value = 1, metadata = '', source = 'server', depth = 0): Outcome | undefined {
  const ctx = raw as GTx;
  const s = gamSettings(ctx);
  const type = ctx.db.eventType.key.find(key);
  if (source === 'server' && (!type || !type.isActive)) return undefined;
  if (depth > Math.max(s.chainDepth, 6)) return undefined;
  if (!type || !type.isActive) fail('EVENT_TYPE_NOT_FOUND');
  if (!Number.isFinite(value)) fail('VALUE_OUT_OF_RANGE');
  if (source === 'client') {
    if (!type.clientAllowed) fail('EVENT_NOT_ALLOWED');
    if (value < type.valueMin || value > type.valueMax) fail('VALUE_OUT_OF_RANGE');
  }
  if (metadata.length > 2048) fail('METADATA_TOO_LARGE');
  if (metadata) {
    try {
      const m = JSON.parse(metadata);
      if (typeof m !== 'object' || m === null || Array.isArray(m)) fail('INVALID_METADATA');
    } catch {
      fail('INVALID_METADATA');
    }
  }
  if (source === 'client') checkRate(ctx, accountId, key, type.rateLimit, s.playerRateLimit);
  const now = nowMicros(ctx);
  const out = emptyOutcome();
  const ev = ctx.db.playerEvent.insert({ id: 0n, accountId, typeKey: key, value, metadata, source, at: ctx.timestamp });
  out.eventId = ev.id;
  bumpCounter(ctx, accountId, key, 'all', value);
  bumpCounter(ctx, accountId, key, windowOf('day', now, s.weekStart), value);
  bumpCounter(ctx, accountId, key, windowOf('week', now, s.weekStart), value);
  applyRules(ctx, accountId, key, value, now, s.weekStart, depth, out);
  applyTasks(ctx, accountId, key, value, now, depth, out);
  applyAchievements(ctx, accountId, key, value, depth, out);
  applyStreaks(ctx, accountId, key, now, depth, out);
  return out;
}

function claimCount(ctx: GTx, kind: string, ownerId: bigint, accountId: bigint) {
  return [...ctx.db.claim.ownerId.filter(ownerId)].filter(c => c.kind === kind && c.accountId === accountId).length;
}

function applyRules(ctx: GTx, accountId: bigint, key: string, value: number, now: bigint, weekStart: number, depth: number, out: Outcome) {
  for (const rule of ctx.db.eventRule.eventKey.filter(key)) {
    if (!rule.isActive || !inWindow(rule.startsAt, rule.endsAt, now) || !hasAudience(ctx, accountId, rule.audienceTagIds)) continue;
    const window = windowOf(rule.period, now, weekStart);
    const pk = `${rule.id}|${accountId}|${window}`;
    const old = ctx.db.ruleProgress.key.find(pk);
    const next = old
      ? { ...old, count: old.count + 1, sum: old.sum + value, max: Math.max(old.max, value) }
      : { key: pk, ruleId: rule.id, accountId, window, count: 1, sum: value, max: value, steps: 0 };
    const v = measureOf(rule.measure, next);
    const due = rule.repeat === 'every' ? Math.floor(v / rule.threshold + 1e-9) : v >= rule.threshold ? 1 : 0;
    let made = claimCount(ctx, 'event', rule.id, accountId);
    while (next.steps < due) {
      if (rule.maxClaims && made >= rule.maxClaims) break;
      next.steps++;
      const scope = rule.repeat === 'once' ? 'once' : rule.repeat === 'period' ? window : `${window}#${next.steps}`;
      const c = createClaim(ctx, accountId, 'event', rule.id, rule.id, scope, rule.prizeId, rule.grantMode, depth);
      if (c) {
        made++;
        out.claims.push(c.id);
      }
    }
    if (old) ctx.db.ruleProgress.key.update(next);
    else ctx.db.ruleProgress.insert(next);
  }
}

export function streakRow(ctx: GTx, accountId: bigint, streakId: bigint) {
  return [...ctx.db.userStreak.byAccountStreak.filter([accountId, streakId])][0];
}

export function floorOf(milestones: { day: number }[], peak: number) {
  let f = 0;
  for (const m of milestones) if (m.day <= peak && m.day > f) f = m.day;
  return f;
}

export function streakAfterMiss(st: { gracePeriods: number; missAction: string; milestones: { day: number }[] }, row: { count: number; peak: number; graceUsed: number; lastPeriod: bigint }, period: number) {
  const gap = period - Number(row.lastPeriod) - 1;
  const graceLeft = Math.max(st.gracePeriods - row.graceUsed, 0);
  if (gap <= graceLeft) return { broken: false, count: row.count, graceUsed: row.graceUsed + Math.max(gap, 0), fell: false, newRun: false };
  const excess = gap - graceLeft;
  const floor = floorOf(st.milestones, row.peak);
  if (st.missAction === 'step_back') {
    const count = Math.max(floor, row.count - excess);
    return { broken: true, count, graceUsed: 0, fell: count < row.count, newRun: count === 0 };
  }
  if (floor > 0) return { broken: true, count: floor, graceUsed: 0, fell: floor < row.count, newRun: false };
  return { broken: true, count: 0, graceUsed: 0, fell: row.count > 0, newRun: true };
}

function applyStreaks(ctx: GTx, accountId: bigint, key: string, now: bigint, depth: number, out: Outcome) {
  for (const st of ctx.db.streak.eventKey.filter(key)) {
    if (!st.isActive) continue;
    const period = Math.floor(dayNumber(now) / st.periodDays);
    const old = streakRow(ctx, accountId, st.id);
    let row = old ?? { id: 0n, accountId, streakId: st.id, count: 0, best: 0, peak: 0, run: 1, falls: 0, graceUsed: 0, lastPeriod: -1n, updatedAt: ctx.timestamp };
    if (row.lastPeriod === BigInt(period)) {
      out.streaks.push({ key: st.key, count: row.count, advanced: false, floor: floorOf(st.milestones, row.peak), fell: false });
      continue;
    }
    let fell = false;
    if (row.lastPeriod >= 0n) {
      const m = streakAfterMiss(st, row, period);
      if (m.newRun) row = { ...row, run: row.run + 1, count: 0, peak: 0, falls: 0, graceUsed: 0 };
      else {
        if (m.fell) row = { ...row, falls: row.falls + 1 };
        row = { ...row, count: m.count, graceUsed: m.graceUsed };
      }
      fell = m.fell;
    }
    const count = row.count + 1;
    row = { ...row, count, peak: Math.max(row.peak, count), best: Math.max(row.best, count), lastPeriod: BigInt(period), updatedAt: ctx.timestamp };
    if (old) ctx.db.userStreak.id.update(row);
    else row = ctx.db.userStreak.insert(row);
    const day = st.cycleLength ? ((count - 1) % st.cycleLength) + 1 : count;
    const reward = st.rewards.find(r => r.day === day);
    if (reward) {
      const scope = st.repayAfterFall && row.falls > 0 ? `r${row.run}f${row.falls}:${count}` : `r${row.run}:${count}`;
      const c = createClaim(ctx, accountId, 'streak', st.id, BigInt(day), scope, reward.prizeId, reward.grantMode, depth);
      if (c) out.claims.push(c.id);
    }
    for (const m of st.milestones) {
      if (!m.prizeId || m.day > count) continue;
      const c = createClaim(ctx, accountId, 'milestone', st.id, BigInt(m.day), `m${m.day}`, m.prizeId, m.grantMode, depth);
      if (c) out.claims.push(c.id);
    }
    out.streaks.push({ key: st.key, count, advanced: true, floor: floorOf(st.milestones, row.peak), fell });
  }
}

export function userLevelOf(ctx: { db: GTx['db'] }, accountId: bigint, tableId: bigint) {
  return [...ctx.db.userLevel.byAccountTable.filter([accountId, tableId])][0]?.level ?? 0;
}

export function mainLevelTable(ctx: { db: GTx['db'] }) {
  return [...ctx.db.levelTable.iter()].filter(l => l.isActive).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1))[0];
}

export function playerLevel(raw: unknown, accountId: bigint, tableId = 0n) {
  const ctx = raw as { db: GTx['db'] };
  const id = tableId || mainLevelTable(ctx)?.id;
  return id ? userLevelOf(ctx, accountId, id) : 0;
}

export function onMetaChange(ctx: GTx, accountId: bigint, key: string, depth: number) {
  const s = ctx.db.gamSettings.id.find(0);
  if (!s || depth > s.chainDepth) return;
  applyRelations(ctx, accountId, key, depth);
  applyLevels(ctx, accountId, key, depth);
}

function compare(op: string, a: number, b: number) {
  const x = Math.round(a * 10000);
  const y = Math.round(b * 10000);
  return op === 'gt' ? x > y : op === 'gte' ? x >= y : op === 'lt' ? x < y : op === 'lte' ? x <= y : x === y;
}

function applyRelations(ctx: GTx, accountId: bigint, key: string, depth: number) {
  const now = nowMicros(ctx);
  const list = [...ctx.db.metaRelation.metaKey.filter(key)].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  for (const rel of list) {
    if (!rel.isActive || !inWindow(rel.startsAt, rel.endsAt, now) || !hasAudience(ctx, accountId, rel.audienceTagIds)) continue;
    const value = metaValue(econ(ctx), accountId, key);
    const holds = compare(rel.operator, value, rel.value);
    const ur = [...ctx.db.userRelation.byAccountRelation.filter([accountId, rel.id])][0];
    if (!holds) {
      if (ur && rel.repeat === 'rearm' && !ur.armed) ctx.db.userRelation.id.update({ ...ur, armed: true });
      continue;
    }
    const fires = ur?.fires ?? 0;
    if (rel.repeat === 'once' && fires > 0) continue;
    if (rel.maxFires && fires >= rel.maxFires) continue;
    if (rel.repeat === 'rearm' && ur && !ur.armed) continue;
    const n = fires + 1;
    const row = { id: ur?.id ?? 0n, accountId, relationId: rel.id, fires: n, armed: rel.repeat !== 'rearm', firstAt: ur?.firstAt ?? ctx.timestamp, lastAt: ctx.timestamp };
    if (ur) ctx.db.userRelation.id.update(row);
    else ctx.db.userRelation.insert(row);
    for (const t of rel.targets) {
      if (t.action === 'set') setMeta(econ(ctx), accountId, t.metaKey, t.amount, depth + 1);
      else addMeta(econ(ctx), accountId, t.metaKey, t.amount, depth + 1);
    }
    createClaim(ctx, accountId, 'relation', rel.id, rel.id, `F${n}`, rel.prizeId, rel.grantMode, depth);
    recordEvent(ctx, accountId, 'meta_relation_completed', n, JSON.stringify({ key: rel.key, relationId: String(rel.id) }), 'server', depth + 1);
  }
}

function applyLevels(ctx: GTx, accountId: bigint, key: string, depth: number) {
  for (const lt of ctx.db.levelTable.metaKey.filter(key)) {
    if (!lt.isActive) continue;
    const value = metaValue(econ(ctx), accountId, key);
    let lvl = 0;
    for (const s of lt.steps) if (value >= s.threshold && s.level > lvl) lvl = s.level;
    const ul = [...ctx.db.userLevel.byAccountTable.filter([accountId, lt.id])][0];
    const old = ul?.level ?? 0;
    if (lvl <= old) continue;
    if (ul) ctx.db.userLevel.id.update({ ...ul, level: lvl, updatedAt: ctx.timestamp });
    else ctx.db.userLevel.insert({ id: 0n, accountId, tableId: lt.id, level: lvl, updatedAt: ctx.timestamp });
    for (const s of lt.steps) {
      if (s.level > old && s.level <= lvl) createClaim(ctx, accountId, 'level', lt.id, BigInt(s.level), `L${s.level}`, s.prizeId, s.grantMode, depth);
    }
    if (lt.levelMetaKey) setMeta(econ(ctx), accountId, lt.levelMetaKey, lvl, depth + 1);
    recordEvent(ctx, accountId, 'level_up', lvl, JSON.stringify({ key: lt.key }), 'server', depth + 1);
  }
}

export function taskRows(ctx: { db: GTx['db'] }, accountId: bigint, taskId: bigint) {
  return [...ctx.db.userTask.byAccountTask.filter([accountId, taskId])];
}

function finished(status: string) {
  return status === 'completed' || status === 'claimed';
}

export function groupRow(ctx: { db: GTx['db'] }, accountId: bigint, groupId: bigint) {
  return [...ctx.db.userTaskGroup.byAccountGroup.filter([accountId, groupId])][0];
}

export function taskVisible(ctx: GTx, accountId: bigint, task: { isActive: boolean; startsAt: bigint; endsAt: bigint; audienceTagIds: bigint[]; levelTableId: bigint; minLevel: number; maxLevel: number }, now: bigint) {
  if (!task.isActive || !inWindow(task.startsAt, task.endsAt, now) || !hasAudience(ctx, accountId, task.audienceTagIds)) return false;
  if (task.levelTableId) {
    const lvl = userLevelOf(ctx, accountId, task.levelTableId);
    if (lvl < task.minLevel || (task.maxLevel && lvl > task.maxLevel)) return false;
  }
  return true;
}

export type TaskRow = NonNullable<ReturnType<GTx['db']['task']['id']['find']>>;

export function openScope(ctx: GTx, accountId: bigint, task: TaskRow, now: bigint, s: { weekStart: number }): string | undefined {
  if (task.parentId) {
    const parent = ctx.db.task.id.find(task.parentId);
    if (!parent || !task.isActive) return undefined;
    const ps = openScope(ctx, accountId, parent, now, s);
    if (!ps || taskRows(ctx, accountId, task.id).some(r => r.scope === ps && finished(r.status))) return undefined;
    return ps;
  }
  if (!taskVisible(ctx, accountId, task, now)) return undefined;
  for (const d of task.dependsOn) if (!taskRows(ctx, accountId, d).some(r => finished(r.status))) return undefined;
  const rows = taskRows(ctx, accountId, task.id);
  const done = rows.filter(r => finished(r.status));
  let scope: string;
  if (task.groupId) {
    const g = ctx.db.taskGroup.id.find(task.groupId);
    if (!g || !g.isActive || !inWindow(g.startsAt, g.endsAt, now) || !hasAudience(ctx, accountId, g.audienceTagIds)) return undefined;
    const ug = groupRow(ctx, accountId, g.id);
    if (!ug || !ug.handed.includes(task.id)) return undefined;
    scope = `g${ug.cycle}`;
  } else {
    if (task.maxCompletions && done.length >= task.maxCompletions) return undefined;
    if (task.repeat === 'daily') scope = windowOf('day', now, s.weekStart);
    else if (task.repeat === 'weekly') scope = windowOf('week', now, s.weekStart);
    else if (task.repeat === 'interval') {
      const last = done.reduce((m, r) => (r.completedMicros > m ? r.completedMicros : m), 0n);
      if (last && now < last + BigInt(task.repeatMinutes) * 60_000_000n) return undefined;
      scope = `i${done.length + 1}`;
    } else scope = 'once';
  }
  if (rows.some(r => r.scope === scope && finished(r.status))) return undefined;
  return scope;
}

function applyTasks(ctx: GTx, accountId: bigint, key: string, value: number, now: bigint, depth: number, out: Outcome) {
  const s = gamSettings(ctx);
  const due: { task: TaskRow; scope: string }[] = [];
  for (const task of ctx.db.task.eventKey.filter(key)) {
    if (task.condition !== 'event' || !task.isActive || !inRange(value, task.valueMin, task.valueMax)) continue;
    if (task.groupId && !groupRow(ctx, accountId, task.groupId)) {
      const g = ctx.db.taskGroup.id.find(task.groupId);
      if (g) refillGroup(ctx, accountId, g, now, false);
    }
    const scope = openScope(ctx, accountId, task, now, s);
    if (scope) due.push({ task, scope });
  }
  for (const { task, scope } of due) {
    const row = taskRows(ctx, accountId, task.id).find(r => r.scope === scope);
    if (row && row.status !== 'active') continue;
    const next = row
      ? { ...row, count: row.count + 1, sum: row.sum + value, max: Math.max(row.max, value) }
      : { id: 0n, accountId, taskId: task.id, scope, status: 'active', count: 1, sum: value, max: value, completedAt: undefined, completedMicros: 0n, completedBy: '', claimId: 0n, claimedAt: undefined, error: '' };
    const saved = row ? ctx.db.userTask.id.update(next) : ctx.db.userTask.insert(next);
    const v = measureOf(task.metric, saved);
    let status = 'active';
    if (v >= task.target) status = completeTask(ctx, accountId, task, saved, now, 'player', depth);
    out.tasks.push({ key: task.key, scope, value: v, target: task.target, status });
  }
}

export function completeTask(ctx: GTx, accountId: bigint, task: TaskRow, row: { id: bigint }, now: bigint, by: string, depth: number): string {
  const cur = ctx.db.userTask.id.find(row.id);
  if (!cur || cur.status !== 'active') return cur?.status ?? 'active';
  const c = createClaim(ctx, accountId, 'task', task.id, task.id, cur.scope, task.prizeId, task.grantMode, depth);
  const status = c ? 'completed' : 'claimed';
  ctx.db.userTask.id.update({ ...cur, status, completedAt: ctx.timestamp, completedMicros: now, completedBy: by, claimId: c?.id ?? 0n, claimedAt: c ? undefined : ctx.timestamp });
  if (task.parentId) {
    const parent = ctx.db.task.id.find(task.parentId);
    if (parent && parent.condition === 'children') {
      const kids = [...ctx.db.task.parentId.filter(parent.id)].filter(k => k.isActive);
      const allDone = kids.every(k => taskRows(ctx, accountId, k.id).some(r => r.scope === cur.scope && finished(r.status)));
      if (allDone) {
        let pr = taskRows(ctx, accountId, parent.id).find(r => r.scope === cur.scope);
        if (!pr) pr = ctx.db.userTask.insert({ id: 0n, accountId, taskId: parent.id, scope: cur.scope, status: 'active', count: 0, sum: 0, max: 0, completedAt: undefined, completedMicros: 0n, completedBy: '', claimId: 0n, claimedAt: undefined, error: '' });
        completeTask(ctx, accountId, parent, pr, now, by, depth);
      }
    }
  }
  for (const a of ctx.db.achievement.iter()) {
    if (a.isActive && a.source === 'task' && a.taskId === task.id) giveAchievement(ctx, accountId, a.id, 1, 'task', task.key, depth);
  }
  if (task.groupId) {
    const g = ctx.db.taskGroup.id.find(task.groupId);
    const ug = g && groupRow(ctx, accountId, g.id);
    if (g && ug) {
      if (g.handout === 'timer') ctx.db.userTaskGroup.id.update({ ...ug, nextAt: now + BigInt(g.handoutMinutes) * 60_000_000n });
      const members = groupMembers(ctx, g);
      if (members.length && members.every(m => taskRows(ctx, accountId, m.id).some(r => r.scope === `g${ug.cycle}` && finished(r.status)))) {
        for (const a of ctx.db.achievement.iter()) {
          if (a.isActive && a.source === 'task' && a.taskGroupId === g.id) giveAchievement(ctx, accountId, a.id, 1, 'task', g.key, depth);
        }
      }
      refillGroup(ctx, accountId, g, now, false);
    }
  }
  recordEvent(ctx, accountId, 'task_completed', 1, JSON.stringify({ key: task.key }), 'server', depth + 1);
  return status;
}

export type GroupRow = NonNullable<ReturnType<GTx['db']['taskGroup']['id']['find']>>;

export function groupMembers(ctx: GTx, g: GroupRow) {
  return g.taskIds.map(id => ctx.db.task.id.find(id)).filter((x): x is TaskRow => !!x && x.isActive && !x.parentId);
}

export function refillGroup(ctx: GTx, accountId: bigint, g: GroupRow, now: bigint, request: boolean): string[] {
  if (!g.isActive || !inWindow(g.startsAt, g.endsAt, now) || !hasAudience(ctx, accountId, g.audienceTagIds)) {
    if (request) fail('TASK_GROUP_NOT_FOUND');
    return [];
  }
  let ug = groupRow(ctx, accountId, g.id) ?? ctx.db.userTaskGroup.insert({ id: 0n, accountId, groupId: g.id, cycle: 1, handed: [], nextAt: 0n });
  const members = groupMembers(ctx, g);
  const isDone = (id: bigint, cycle: number) => taskRows(ctx, accountId, id).some(r => r.scope === `g${cycle}` && finished(r.status));
  if (members.length && members.every(m => isDone(m.id, ug.cycle))) {
    if (!g.isRepeatable) {
      if (request) fail('TASK_GROUP_FINISHED');
      return [];
    }
    ug = ctx.db.userTaskGroup.id.update({ ...ug, cycle: ug.cycle + 1, handed: [], nextAt: 0n });
  }
  const open = ug.handed.filter(id => members.some(m => m.id === id) && !isDone(id, ug.cycle));
  let candidates = members.filter(m => !ug.handed.includes(m.id));
  if (g.orderMode === 'random') {
    const secret = ctx.env.OTP_SECRET;
    const rank = (id: bigint) => {
      const mac = sign(secret, `task-group|${g.id}|${accountId}|${ug.cycle}|${id}`);
      return ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0;
    };
    candidates = [...candidates].sort((a, b) => rank(a.id) - rank(b.id));
  }
  const free = g.activeCount - open.length;
  if (request) {
    if (g.handout === 'auto') fail('HANDOUT_AUTOMATIC');
    if (free <= 0) fail('CURRENT_TASK_MUST_BE_DONE');
    if (!candidates.length) fail('NO_TASK_AVAILABLE');
    if (g.handout === 'timer' && ug.handed.length && now < ug.nextAt) fail('DURATION_NOT_ELAPSED');
  } else {
    if (g.handout === 'request' && ug.handed.length) return [];
    if (g.handout === 'timer' && ug.handed.length && now < ug.nextAt) return [];
  }
  const count = request || g.handout === 'request' ? Math.min(1, free) : free;
  const pick = candidates.slice(0, Math.max(count, 0));
  if (!pick.length) return [];
  ctx.db.userTaskGroup.id.update({ ...ug, handed: [...ug.handed, ...pick.map(p => p.id)] });
  return pick.map(p => p.key);
}

function applyAchievements(ctx: GTx, accountId: bigint, key: string, value: number, depth: number, out: Outcome) {
  for (const a of ctx.db.achievement.eventKey.filter(key)) {
    if (!a.isActive || a.source !== 'event' || !inRange(value, a.valueMin, a.valueMax)) continue;
    const ua = [...ctx.db.userAchievement.byAccountAchievement.filter([accountId, a.id])][0];
    const next = ua
      ? { ...ua, count: ua.count + 1, sum: ua.sum + value, max: Math.max(ua.max, value) }
      : { id: 0n, accountId, achievementId: a.id, count: 1, sum: value, max: value, tier: 0, unlockedAt: undefined, tierAt: undefined, source: '', sourceRef: '' };
    const saved = ua ? ctx.db.userAchievement.id.update(next) : ctx.db.userAchievement.insert(next);
    const v = measureOf(a.metric, saved);
    let tier = 0;
    for (const t of a.tiers) if (v >= t.threshold && t.tier > tier) tier = t.tier;
    if (tier > saved.tier) {
      out.achievements.push({ key: a.key, from: saved.tier, to: tier });
      setTier(ctx, accountId, a.id, tier, saved.tier ? saved.source : 'progress', String(out.eventId), depth, out);
    }
  }
}

function setTier(ctx: GTx, accountId: bigint, achievementId: bigint, tier: number, source: string, ref: string, depth: number, out?: Outcome) {
  const a = ctx.db.achievement.id.find(achievementId);
  if (!a) fail('ACHIEVEMENT_NOT_FOUND');
  const ua = [...ctx.db.userAchievement.byAccountAchievement.filter([accountId, a.id])][0];
  const old = ua?.tier ?? 0;
  if (tier <= old) return old;
  const unlocking = old === 0;
  const row = {
    id: ua?.id ?? 0n,
    accountId,
    achievementId: a.id,
    count: ua?.count ?? 0,
    sum: ua?.sum ?? 0,
    max: ua?.max ?? 0,
    tier,
    unlockedAt: ua?.unlockedAt ?? ctx.timestamp,
    tierAt: ctx.timestamp,
    source: unlocking ? source : ua!.source,
    sourceRef: unlocking ? ref : ua!.sourceRef,
  };
  if (ua) ctx.db.userAchievement.id.update(row);
  else ctx.db.userAchievement.insert(row);
  for (const t of a.tiers) {
    if (t.tier > old && t.tier <= tier) {
      const c = createClaim(ctx, accountId, 'achievement', a.id, BigInt(t.tier), `t${t.tier}`, t.prizeId, t.grantMode, depth);
      if (c && out) out.claims.push(c.id);
    }
  }
  if (unlocking) recordEvent(ctx, accountId, 'achievement_unlocked', a.points, JSON.stringify({ key: a.key }), 'server', depth + 1);
  return tier;
}

export function giveAchievement(ctx: GTx, accountId: bigint, achievementId: bigint, tier: number, source: string, ref: string, depth = 0) {
  const a = ctx.db.achievement.id.find(achievementId);
  if (!a) fail('ACHIEVEMENT_NOT_FOUND');
  const max = a.tiers.reduce((m, t) => Math.max(m, t.tier), 1);
  return setTier(ctx, accountId, achievementId, Math.min(Math.max(tier, 1), max), source, ref, depth);
}
