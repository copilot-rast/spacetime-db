import { t } from 'spacetimedb/server';
import { Translations, audit, fail, loginHooks, requireAccount, requireRole, adminOrNull } from '@stg/base';
import { metaHooks, paymentHooks, prizeUseChecks, metaUseChecks } from '@stg/economy';
import { LevelStep, RelationTarget, StreakDay, gamRows, gamificationTables, type GamificationSchema } from './schema';
import {
  MEASURES,
  chain,
  floorOf,
  gamSettings,
  grantReady,
  hasAudience,
  inWindow,
  measureOf,
  nowMicros,
  onMetaChange,
  recordEvent as record,
  streakAfterMiss,
  streakRow,
  tryGrant,
  dayNumber,
  windowEnd,
  windowOf,
  type GProc,
  type GTx,
  type Outcome,
} from './engine';
import { base, checkAudience, checkEventKey, checkMeta, checkMode, checkPrize, checkWindow, lockedKey, page, tr } from './valid';

const EVENT_KEY = /^[a-z][a-z0-9_.]{1,47}$/;

export const GamReward = t.object('GamReward', { type: t.string(), key: t.string(), action: t.string(), value: t.f64(), prizeKey: t.string() });
export const ClaimResult = t.object('GamClaimResult', { claimId: t.u64(), kind: t.string(), prizeId: t.u64(), grantMode: t.string(), status: t.string(), error: t.string(), rewards: t.array(GamReward) });
const RecordResult = t.object('GamRecordResult', {
  eventId: t.u64(),
  claims: t.array(ClaimResult),
  streaks: t.array(t.object('GamStreakStep', { key: t.string(), count: t.u32(), advanced: t.bool(), floor: t.u32(), fell: t.bool() })),
  tasks: t.array(t.object('GamTaskStep', { key: t.string(), scope: t.string(), value: t.f64(), target: t.f64(), status: t.string() })),
  achievements: t.array(t.object('GamAchievementStep', { key: t.string(), from: t.u32(), to: t.u32() })),
});

const MilestoneView = t.object('GamMilestoneView', { day: t.u32(), reached: t.bool(), safe: t.bool(), prizeId: t.u64(), grantMode: t.string(), status: t.string(), claimId: t.u64() });
const StreakView = t.object('GamStreakView', {
  streakId: t.u64(),
  key: t.string(),
  name: Translations,
  description: Translations,
  eventKey: t.string(),
  periodDays: t.u8(),
  count: t.u32(),
  storedCount: t.u32(),
  best: t.u32(),
  peak: t.u32(),
  run: t.u32(),
  falls: t.u32(),
  floor: t.u32(),
  nextMilestone: t.u32(),
  countedThisPeriod: t.bool(),
  broken: t.bool(),
  floored: t.bool(),
  graceLeft: t.u32(),
  gracePeriods: t.u8(),
  missAction: t.string(),
  cycleLength: t.u32(),
  repayAfterFall: t.bool(),
  nextPeriodAt: t.u64(),
  rewards: t.array(StreakDay),
  milestones: t.array(MilestoneView),
  claimable: t.array(t.u64()),
});

const RuleView = t.object('GamRuleView', {
  ruleId: t.u64(),
  key: t.string(),
  name: Translations,
  description: Translations,
  eventKey: t.string(),
  measure: t.string(),
  period: t.string(),
  repeat: t.string(),
  threshold: t.f64(),
  current: t.f64(),
  claims: t.u32(),
  maxClaims: t.u32(),
  prizeId: t.u64(),
  grantMode: t.string(),
  periodEndsAt: t.u64(),
  endsAt: t.u64(),
  claimable: t.array(t.u64()),
});

const LevelEntry = t.row('GamLevelEntry', {
  tableId: t.u64().primaryKey(),
  key: t.string(),
  name: Translations,
  description: Translations,
  metaKey: t.string(),
  level: t.u32(),
  steps: t.array(LevelStep),
});

const RelationEntry = t.row('GamRelationEntry', {
  relationId: t.u64().primaryKey(),
  key: t.string(),
  name: Translations,
  description: Translations,
  repeat: t.string(),
  fires: t.u32(),
  maxFires: t.u32(),
  completed: t.bool(),
  prizeId: t.u64(),
  grantMode: t.string(),
});

const ClaimPage = t.object('GamClaimPage', { total: t.u32(), rows: t.array(gamRows.claim) });
const EventPage = t.object('GamEventPage', { total: t.u32(), rows: t.array(gamRows.playerEvent) });
const Progress = t.object('GamPlayerProgress', {
  levels: t.array(gamRows.userLevel),
  streaks: t.array(gamRows.userStreak),
  relations: t.array(gamRows.userRelation),
  tasks: t.array(gamRows.userTask),
  groups: t.array(gamRows.userTaskGroup),
  achievements: t.array(gamRows.userAchievement),
  totals: t.array(gamRows.eventCounter),
  claims: t.array(gamRows.claim),
});
const Summary = t.object('GamSummary', {
  eventTypes: t.u32(),
  eventRules: t.u32(),
  levelTables: t.u32(),
  streaks: t.u32(),
  metaRelations: t.u32(),
  tasks: t.u32(),
  taskGroups: t.u32(),
  achievements: t.u32(),
  eventsToday: t.u32(),
  claimsReady: t.u32(),
  claimsFailed: t.u32(),
  clockOffsetSec: t.i64(),
});

function accountOfSession(ctx: { db: GTx['db']; sender: GTx['sender'] }) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  return a && a.status === 'active' ? a : undefined;
}

export function claimResults(tx: GTx, ids: bigint[]) {
  return ids
    .map(id => tx.db.claim.id.find(id))
    .filter(c => !!c)
    .map(c => ({ claimId: c!.id, kind: c!.kind, prizeId: c!.prizeId, grantMode: c!.grantMode, status: c!.status, error: c!.error, rewards: JSON.parse(c!.rewards) }));
}

export function outcomeResult(tx: GTx, o: Outcome) {
  return { eventId: o.eventId, claims: claimResults(tx, o.claims), streaks: o.streaks, tasks: o.tasks, achievements: o.achievements };
}

function prizeUsed(ctx: GTx, id: bigint) {
  if ([...ctx.db.eventRule.iter()].some(r => r.prizeId === id)) return true;
  if ([...ctx.db.levelTable.iter()].some(l => l.steps.some(s => s.prizeId === id))) return true;
  if ([...ctx.db.streak.iter()].some(s => s.rewards.some(r => r.prizeId === id) || s.milestones.some(m => m.prizeId === id))) return true;
  if ([...ctx.db.metaRelation.iter()].some(r => r.prizeId === id)) return true;
  if ([...ctx.db.task.iter()].some(x => x.prizeId === id)) return true;
  if ([...ctx.db.achievement.iter()].some(a => a.tiers.some(x => x.prizeId === id))) return true;
  return false;
}

function metaUsed(ctx: GTx, key: string) {
  if ([...ctx.db.levelTable.iter()].some(l => l.metaKey === key || l.levelMetaKey === key)) return true;
  return [...ctx.db.metaRelation.iter()].some(r => r.metaKey === key || r.targets.some(x => x.metaKey === key));
}

export function defineEvents(st: GamificationSchema) {
  loginHooks.push((ctx, accountId) => {
    record(ctx, accountId, 'login', 1, '', 'server');
  });
  paymentHooks.push((ctx, accountId, paymentId) => {
    const p = ctx.db.payment.id.find(paymentId);
    if (!p) return;
    const value = p.method === 'in_app' ? Number(p.coinAmount) : Number(p.finalToman);
    record(ctx, accountId, 'purchase_completed', value, JSON.stringify({ paymentId: String(p.id), productId: String(p.productId), method: p.method }), 'server');
  });
  metaHooks.push((ctx, accountId, key, _before, _after, depth) => {
    onMetaChange(ctx as unknown as GTx, accountId, key, Math.max(depth, chain.base));
  });
  prizeUseChecks.push((ctx, id) => prizeUsed(ctx as unknown as GTx, id));
  metaUseChecks.push((ctx, key) => metaUsed(ctx as unknown as GTx, key));

  const adminGamificationSettings = st.view({ name: 'admin_gamification_settings', public: true }, t.option(gamRows.settings), ctx =>
    adminOrNull(ctx as any) ? ctx.db.gamSettings.id.find(0) ?? undefined : undefined
  );

  const adminSaveGamificationSettings = st.reducer({ weekStart: t.u8(), playerRateLimit: t.u32(), retentionDays: t.u32(), chainDepth: t.u8() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = gamSettings(ctx);
    if (a.weekStart > 6) fail('INVALID_WEEK_START');
    if (a.playerRateLimit > 100_000) fail('INVALID_RATE_LIMIT');
    if (a.retentionDays < 1 || a.retentionDays > 3650) fail('INVALID_RETENTION');
    if (a.chainDepth > 25) fail('INVALID_CHAIN_DEPTH');
    ctx.db.gamSettings.id.update({ ...s, ...a, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'gamification_settings.save', 'settings', JSON.stringify(a));
  });

  const adminSetClockOffset = st.reducer({ seconds: t.i64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = gamSettings(ctx);
    if (a.seconds < -3650n * 86400n || a.seconds > 3650n * 86400n) fail('INVALID_CLOCK_OFFSET');
    ctx.db.gamSettings.id.update({ ...s, clockOffsetSec: a.seconds, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'gamification_settings.clock', 'settings', String(a.seconds));
  });

  const adminSaveEventType = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, description: Translations, clientAllowed: t.bool(), valueMin: t.f64(), valueMax: t.f64(), rateLimit: t.u32(), isActive: t.bool(), sort: t.i32() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = a.key.trim();
      if (!EVENT_KEY.test(key)) fail('INVALID_EVENT_KEY');
      const old = a.id ? ctx.db.eventType.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      lockedKey(old, key);
      const same = ctx.db.eventType.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (old?.isSystem && a.clientAllowed) fail('SYSTEM_EVENT_SERVER_ONLY');
      if (!Number.isFinite(a.valueMin) || !Number.isFinite(a.valueMax) || a.valueMin > a.valueMax) fail('INVALID_RANGE');
      if (a.rateLimit > 10_000) fail('INVALID_RATE_LIMIT');
      const row = {
        id: a.id,
        key,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        clientAllowed: a.clientAllowed,
        valueMin: a.valueMin,
        valueMax: a.valueMax,
        rateLimit: a.rateLimit,
        isActive: a.isActive,
        isSystem: old?.isSystem ?? false,
        sort: a.sort,
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.eventType.id.update(row) : ctx.db.eventType.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'event_type.update' : 'event_type.create', String(saved.id), key);
    }
  );

  const adminDeleteEventType = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const e = ctx.db.eventType.id.find(id);
    if (!e) fail('NOT_FOUND');
    if (e.isSystem) fail('SYSTEM_EVENT');
    const used =
      [...ctx.db.eventRule.eventKey.filter(e.key)].length ||
      [...ctx.db.streak.eventKey.filter(e.key)].length ||
      [...ctx.db.task.eventKey.filter(e.key)].length ||
      [...ctx.db.achievement.eventKey.filter(e.key)].length ||
      [...ctx.db.playerEvent.typeKey.filter(e.key)].length;
    if (used) fail('IN_USE');
    ctx.db.eventType.id.delete(id);
    audit(base(ctx), me.id, 'event_type.delete', String(id), e.key);
  });

  const adminEventRules = st.view({ name: 'admin_event_rules', public: true }, t.array(gamRows.eventRule), ctx => (adminOrNull(ctx as any) ? [...ctx.db.eventRule.iter()] : []));

  const adminSaveEventRule = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      name: Translations,
      description: Translations,
      eventKey: t.string(),
      measure: t.string(),
      period: t.string(),
      threshold: t.f64(),
      repeat: t.string(),
      maxClaims: t.u32(),
      prizeId: t.u64(),
      grantMode: t.string(),
      audienceTagIds: t.array(t.u64()),
      startsAt: t.u64(),
      endsAt: t.u64(),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = a.key.trim();
      if (!EVENT_KEY.test(key)) fail('INVALID_KEY');
      const old = a.id ? ctx.db.eventRule.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      lockedKey(old, key);
      const same = ctx.db.eventRule.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      checkEventKey(ctx, a.eventKey);
      if (!MEASURES.includes(a.measure)) fail('INVALID_MEASURE');
      if (!['total', 'day', 'week'].includes(a.period)) fail('INVALID_PERIOD');
      if (!['once', 'period', 'every'].includes(a.repeat)) fail('INVALID_REPEAT');
      if (a.repeat === 'period' && a.period === 'total') fail('REPEAT_NEEDS_PERIOD');
      if (a.repeat === 'every' && a.measure === 'max') fail('EVERY_NEEDS_TOTAL');
      if (!Number.isFinite(a.threshold) || a.threshold <= 0) fail('INVALID_THRESHOLD');
      checkWindow(a.startsAt, a.endsAt);
      const row = {
        ...a,
        key,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        prizeId: checkPrize(ctx, a.prizeId, true),
        grantMode: checkMode(a.grantMode),
        audienceTagIds: checkAudience(ctx, a.audienceTagIds),
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.eventRule.id.update(row) : ctx.db.eventRule.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'event_rule.update' : 'event_rule.create', String(saved.id), key);
    }
  );

  const adminDeleteEventRule = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const r = ctx.db.eventRule.id.find(id);
    if (!r) fail('NOT_FOUND');
    if ([...ctx.db.claim.ownerId.filter(id)].some(c => c.kind === 'event')) fail('IN_USE');
    for (const p of [...ctx.db.ruleProgress.ruleId.filter(id)]) ctx.db.ruleProgress.key.delete(p.key);
    ctx.db.eventRule.id.delete(id);
    audit(base(ctx), me.id, 'event_rule.delete', String(id), r.key);
  });

  const adminLevelTables = st.view({ name: 'admin_level_tables', public: true }, t.array(gamRows.levelTable), ctx => (adminOrNull(ctx as any) ? [...ctx.db.levelTable.iter()] : []));

  const adminSaveLevelTable = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, description: Translations, metaKey: t.string(), levelMetaKey: t.string(), steps: t.array(LevelStep), isActive: t.bool(), sort: t.i32() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = a.key.trim();
      if (!EVENT_KEY.test(key)) fail('INVALID_KEY');
      const old = a.id ? ctx.db.levelTable.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      lockedKey(old, key);
      const same = ctx.db.levelTable.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      checkMeta(ctx, a.metaKey);
      if (a.levelMetaKey) {
        checkMeta(ctx, a.levelMetaKey);
        if (a.levelMetaKey === a.metaKey) fail('SAME_META');
      }
      if (!a.steps.length) fail('STEPS_REQUIRED');
      if (a.steps.length > 500) fail('TOO_MANY_STEPS');
      const steps = [...a.steps].sort((x, y) => x.level - y.level);
      const seen = new Set<number>();
      let prev = -Infinity;
      for (const s of steps) {
        if (s.level < 1) fail('INVALID_LEVEL');
        if (seen.has(s.level)) fail('DUPLICATE_LEVEL');
        seen.add(s.level);
        if (!Number.isFinite(s.threshold) || s.threshold < prev) fail('THRESHOLDS_NOT_ORDERED');
        prev = s.threshold;
        checkPrize(ctx, s.prizeId);
        checkMode(s.grantMode);
      }
      const row = {
        id: a.id,
        key,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        metaKey: a.metaKey,
        levelMetaKey: a.levelMetaKey,
        steps: steps.map(s => ({ ...s, title: tr(ctx, s.title, false) })),
        isActive: a.isActive,
        sort: a.sort,
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.levelTable.id.update(row) : ctx.db.levelTable.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'level_table.update' : 'level_table.create', String(saved.id), key);
    }
  );

  const adminDeleteLevelTable = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const l = ctx.db.levelTable.id.find(id);
    if (!l) fail('NOT_FOUND');
    if ([...ctx.db.userLevel.tableId.filter(id)].length || [...ctx.db.task.iter()].some(x => x.levelTableId === id)) fail('IN_USE');
    ctx.db.levelTable.id.delete(id);
    audit(base(ctx), me.id, 'level_table.delete', String(id), l.key);
  });

  const adminStreaks = st.view({ name: 'admin_streaks', public: true }, t.array(gamRows.streak), ctx => (adminOrNull(ctx as any) ? [...ctx.db.streak.iter()] : []));

  const adminSaveStreak = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      name: Translations,
      description: Translations,
      eventKey: t.string(),
      periodDays: t.u8(),
      gracePeriods: t.u8(),
      missAction: t.string(),
      cycleLength: t.u32(),
      repayAfterFall: t.bool(),
      rewards: t.array(StreakDay),
      milestones: t.array(StreakDay),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = a.key.trim();
      if (!EVENT_KEY.test(key)) fail('INVALID_KEY');
      const old = a.id ? ctx.db.streak.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      lockedKey(old, key);
      const same = ctx.db.streak.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      checkEventKey(ctx, a.eventKey);
      if (a.periodDays < 1 || a.periodDays > 30) fail('INVALID_PERIOD_DAYS');
      if (a.gracePeriods > 30) fail('INVALID_GRACE');
      if (!['reset', 'step_back'].includes(a.missAction)) fail('INVALID_MISS_ACTION');
      if (a.cycleLength > 3650) fail('INVALID_CYCLE');
      if (a.rewards.length > 400) fail('TOO_MANY_REWARDS');
      const days = new Set<number>();
      for (const r of a.rewards) {
        if (r.day < 1 || r.day > 3650) fail('INVALID_DAY');
        if (a.cycleLength && r.day > a.cycleLength) fail('DAY_OUTSIDE_CYCLE');
        if (days.has(r.day)) fail('DUPLICATE_DAY');
        days.add(r.day);
        checkPrize(ctx, r.prizeId, true);
        checkMode(r.grantMode);
      }
      if (a.milestones.length > 50) fail('TOO_MANY_MILESTONES');
      const ms = new Set<number>();
      for (const m of a.milestones) {
        if (m.day < 1 || m.day > 3650) fail('INVALID_MILESTONE_DAY');
        if (ms.has(m.day)) fail('DUPLICATE_MILESTONE');
        ms.add(m.day);
        checkPrize(ctx, m.prizeId);
        checkMode(m.grantMode);
      }
      const row = {
        ...a,
        key,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        rewards: [...a.rewards].sort((x, y) => x.day - y.day),
        milestones: [...a.milestones].sort((x, y) => x.day - y.day),
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.streak.id.update(row) : ctx.db.streak.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'streak.update' : 'streak.create', String(saved.id), key);
    }
  );

  const adminDeleteStreak = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const s = ctx.db.streak.id.find(id);
    if (!s) fail('NOT_FOUND');
    if ([...ctx.db.userStreak.streakId.filter(id)].length) fail('IN_USE');
    ctx.db.streak.id.delete(id);
    audit(base(ctx), me.id, 'streak.delete', String(id), s.key);
  });

  const adminResetStreak = st.reducer({ accountId: t.u64(), streakId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = ctx.db.streak.id.find(a.streakId);
    if (!s) fail('NOT_FOUND');
    const row = streakRow(ctx, a.accountId, a.streakId);
    if (!row) fail('NOT_STARTED');
    ctx.db.userStreak.id.update({ ...row, run: row.run + 1, count: 0, peak: 0, falls: 0, graceUsed: 0, lastPeriod: -1n, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'streak.reset', String(a.accountId), s.key);
  });

  const adminMetaRelations = st.view({ name: 'admin_meta_relations', public: true }, t.array(gamRows.metaRelation), ctx => (adminOrNull(ctx as any) ? [...ctx.db.metaRelation.iter()] : []));

  const adminSaveMetaRelation = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      name: Translations,
      description: Translations,
      metaKey: t.string(),
      operator: t.string(),
      value: t.f64(),
      targets: t.array(RelationTarget),
      prizeId: t.u64(),
      grantMode: t.string(),
      repeat: t.string(),
      maxFires: t.u32(),
      audienceTagIds: t.array(t.u64()),
      clientVisible: t.bool(),
      startsAt: t.u64(),
      endsAt: t.u64(),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = a.key.trim();
      if (!EVENT_KEY.test(key)) fail('INVALID_KEY');
      const old = a.id ? ctx.db.metaRelation.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      lockedKey(old, key);
      const same = ctx.db.metaRelation.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      checkMeta(ctx, a.metaKey);
      if (!['gt', 'gte', 'lt', 'lte', 'eq'].includes(a.operator)) fail('INVALID_OPERATOR');
      if (!Number.isFinite(a.value)) fail('INVALID_VALUE');
      if (a.targets.length > 20) fail('TOO_MANY_TARGETS');
      const seen = new Set<string>();
      for (const x of a.targets) {
        checkMeta(ctx, x.metaKey);
        if (x.action !== 'add' && x.action !== 'set') fail('INVALID_ACTION');
        if (!Number.isFinite(x.amount)) fail('INVALID_VALUE');
        if (x.action === 'add' && x.amount === 0) fail('ZERO_AMOUNT');
        const k = `${x.metaKey}|${x.action}`;
        if (seen.has(k)) fail('DUPLICATE_TARGET');
        seen.add(k);
      }
      if (!a.targets.length && !a.prizeId) fail('RELATION_NEEDS_RESULT');
      if (!['once', 'rearm', 'every'].includes(a.repeat)) fail('INVALID_REPEAT');
      if (a.repeat === 'once' && a.maxFires > 1) fail('INVALID_MAX_FIRES');
      checkWindow(a.startsAt, a.endsAt);
      const row = {
        ...a,
        key,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        prizeId: checkPrize(ctx, a.prizeId),
        grantMode: checkMode(a.grantMode),
        audienceTagIds: checkAudience(ctx, a.audienceTagIds),
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.metaRelation.id.update(row) : ctx.db.metaRelation.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'meta_relation.update' : 'meta_relation.create', String(saved.id), key);
    }
  );

  const adminDeleteMetaRelation = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const r = ctx.db.metaRelation.id.find(id);
    if (!r) fail('NOT_FOUND');
    if ([...ctx.db.userRelation.relationId.filter(id)].length) fail('IN_USE');
    ctx.db.metaRelation.id.delete(id);
    audit(base(ctx), me.id, 'meta_relation.delete', String(id), r.key);
  });

  const adminForgetRelation = st.reducer({ accountId: t.u64(), relationId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const ur = [...ctx.db.userRelation.byAccountRelation.filter([a.accountId, a.relationId])][0];
    if (!ur) fail('NOT_FOUND');
    ctx.db.userRelation.id.delete(ur.id);
    for (const c of [...ctx.db.claim.ownerId.filter(a.relationId)]) {
      if (c.kind === 'relation' && c.accountId === a.accountId && c.status !== 'granted') ctx.db.claim.id.delete(c.id);
    }
    audit(base(ctx), me.id, 'meta_relation.forget', String(a.accountId), String(a.relationId));
  });

  const recordEvent = st.procedure({ key: t.string(), value: t.f64(), metadata: t.string() }, RecordResult, (ctx, a) => {
    const o = ctx.withTx(tx => {
      chain.created = [];
      const me = requireAccount(base(tx));
      const out = record(tx, me.id, a.key.trim(), a.value, a.metadata, 'client')!;
      out.claims = [...new Set([...out.claims, ...chain.created])];
      chain.created = [];
      return out;
    });
    grantReady(ctx, o.claims);
    return ctx.withTx(tx => outcomeResult(tx, o));
  });

  const adminRecordEvent = st.procedure({ accountId: t.u64(), key: t.string(), value: t.f64(), metadata: t.string() }, RecordResult, (ctx, a) => {
    const o = ctx.withTx(tx => {
      chain.created = [];
      const me = requireRole(base(tx), 'admin');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      const out = record(tx, a.accountId, a.key.trim(), a.value, a.metadata, 'admin')!;
      out.claims = [...new Set([...out.claims, ...chain.created])];
      chain.created = [];
      audit(base(tx), me.id, 'event.record', String(a.accountId), `${a.key} ${a.value}`);
      return out;
    });
    grantReady(ctx, o.claims);
    return ctx.withTx(tx => outcomeResult(tx, o));
  });

  const claimReward = st.procedure({ claimId: t.u64() }, ClaimResult, (ctx, a) => {
    const me = ctx.withTx(tx => requireAccount(base(tx)));
    const r = tryGrant(ctx, a.claimId, me.id);
    if (r.error) fail(r.error);
    return ctx.withTx(tx => claimResults(tx, [a.claimId])[0]);
  });

  const myRewards = st.view({ name: 'my_rewards', public: true }, t.array(gamRows.claim), ctx => {
    const a = accountOfSession(ctx as any);
    if (!a) return [];
    return [...ctx.db.claim.accountId.filter(a.id)].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 200);
  });

  const myLevels = st.view({ name: 'my_levels', public: true }, t.array(LevelEntry), ctx => {
    const a = accountOfSession(ctx as any);
    if (!a) return [];
    return [...ctx.db.levelTable.iter()]
      .filter(l => l.isActive && !ctx.db.meta.key.find(l.metaKey)?.serverOnly)
      .map(l => ({
        tableId: l.id,
        key: l.key,
        name: l.name,
        description: l.description,
        metaKey: l.metaKey,
        level: [...ctx.db.userLevel.byAccountTable.filter([a.id, l.id])][0]?.level ?? 0,
        steps: l.steps,
      }));
  });

  const myMetaRelations = st.view({ name: 'my_meta_relations', public: true }, t.array(RelationEntry), ctx => {
    const a = accountOfSession(ctx as any);
    if (!a) return [];
    const out = [];
    for (const r of ctx.db.metaRelation.iter()) {
      if (!r.clientVisible) continue;
      const ur = [...ctx.db.userRelation.byAccountRelation.filter([a.id, r.id])][0];
      if (!ur && (!r.isActive || !hasAudience(ctx as any, a.id, r.audienceTagIds))) continue;
      out.push({ relationId: r.id, key: r.key, name: r.name, description: r.description, repeat: r.repeat, fires: ur?.fires ?? 0, maxFires: r.maxFires, completed: !!ur && ur.fires > 0, prizeId: r.prizeId, grantMode: r.grantMode });
    }
    return out;
  });

  const myStreaks = st.procedure(t.array(StreakView), ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const now = nowMicros(tx);
      const claims = [...tx.db.claim.accountId.filter(me.id)];
      return [...tx.db.streak.iter()]
        .filter(s => s.isActive)
        .sort((x, y) => x.sort - y.sort)
        .map(s => {
          const period = Math.floor(dayNumber(now) / s.periodDays);
          const row = streakRow(tx, me.id, s.id);
          const count = row?.count ?? 0;
          const peak = row?.peak ?? 0;
          const floor = floorOf(s.milestones, peak);
          let shown = count;
          let broken = false;
          let graceLeft = s.gracePeriods;
          if (row && row.lastPeriod >= 0n && BigInt(period) !== row.lastPeriod) {
            const m = streakAfterMiss(s, row, period);
            broken = m.broken;
            if (broken) shown = m.newRun ? 0 : m.count;
            graceLeft = Math.max(s.gracePeriods - (broken ? 0 : m.graceUsed), 0);
          } else if (row) graceLeft = Math.max(s.gracePeriods - row.graceUsed, 0);
          const mine = claims.filter(c => c.ownerId === s.id && (c.kind === 'streak' || c.kind === 'milestone'));
          return {
            streakId: s.id,
            key: s.key,
            name: s.name,
            description: s.description,
            eventKey: s.eventKey,
            periodDays: s.periodDays,
            count: shown,
            storedCount: count,
            best: row?.best ?? 0,
            peak,
            run: row?.run ?? 0,
            falls: row?.falls ?? 0,
            floor,
            nextMilestone: s.milestones.find(m => m.day > peak)?.day ?? 0,
            countedThisPeriod: !!row && row.lastPeriod === BigInt(period),
            broken,
            floored: broken && floor > 0 && shown === floor,
            graceLeft,
            gracePeriods: s.gracePeriods,
            missAction: s.missAction,
            cycleLength: s.cycleLength,
            repayAfterFall: s.repayAfterFall,
            nextPeriodAt: BigInt((period + 1) * s.periodDays * 86_400_000 - 12_600_000) * 1000n,
            rewards: s.rewards,
            milestones: s.milestones.map(m => {
              const c = mine.find(x => x.kind === 'milestone' && x.refId === BigInt(m.day));
              return {
                day: m.day,
                reached: m.day <= peak,
                safe: m.day === floor,
                prizeId: m.prizeId,
                grantMode: m.grantMode,
                status: c ? (c.status === 'granted' ? 'claimed' : c.grantMode === 'claim' ? 'claimable' : 'pending') : m.day <= peak ? 'reached' : 'locked',
                claimId: c?.id ?? 0n,
              };
            }),
            claimable: mine.filter(c => c.status !== 'granted' && c.grantMode === 'claim').map(c => c.id),
          };
        });
    })
  );

  const myEventRules = st.procedure(t.array(RuleView), ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const s = gamSettings(tx);
      const now = nowMicros(tx);
      return [...tx.db.eventRule.iter()]
        .filter(r => r.isActive && inWindow(r.startsAt, r.endsAt, now) && hasAudience(tx, me.id, r.audienceTagIds))
        .sort((x, y) => x.sort - y.sort)
        .map(r => {
          const window = windowOf(r.period, now, s.weekStart);
          const p = tx.db.ruleProgress.key.find(`${r.id}|${me.id}|${window}`);
          const claims = [...tx.db.claim.ownerId.filter(r.id)].filter(c => c.kind === 'event' && c.accountId === me.id);
          return {
            ruleId: r.id,
            key: r.key,
            name: r.name,
            description: r.description,
            eventKey: r.eventKey,
            measure: r.measure,
            period: r.period,
            repeat: r.repeat,
            threshold: r.threshold,
            current: p ? measureOf(r.measure, p) : 0,
            claims: claims.length,
            maxClaims: r.maxClaims,
            prizeId: r.prizeId,
            grantMode: r.grantMode,
            periodEndsAt: windowEnd(r.period, now, s.weekStart),
            endsAt: r.endsAt,
            claimable: claims.filter(c => c.status !== 'granted' && c.grantMode === 'claim').map(c => c.id),
          };
        });
    })
  );

  const gamGrantWorker = st.procedure({ onSchedule: gamificationTables.grantTimer }, { timer: gamificationTables.grantTimer.rowType }, t.unit(), ctx => {
    grantReady(ctx);
    return {};
  });

  const gamTick = st.procedure({ onSchedule: gamificationTables.tickTimer }, { timer: gamificationTables.tickTimer.rowType }, t.unit(), ctx => {
    grantReady(ctx);
    const retry = ctx.withTx(tx => {
      const cutoff = tx.timestamp.microsSinceUnixEpoch - 60_000_000n;
      return [...tx.db.claim.status.filter('failed')].filter(c => c.grantMode === 'auto' && c.attempts < 8 && c.createdAt.microsSinceUnixEpoch < cutoff).slice(0, 20).map(c => c.id);
    });
    for (const id of retry) tryGrant(ctx, id);
    ctx.withTx(tx => sweep(tx));
    return {};
  });

  const adminRetryClaim = st.procedure({ claimId: t.u64() }, ClaimResult, (ctx, a) => {
    ctx.withTx(tx => {
      const me = requireRole(base(tx), 'admin');
      const c = tx.db.claim.id.find(a.claimId);
      if (!c) fail('CLAIM_NOT_FOUND');
      if (c.status === 'granted') fail('ALREADY_CLAIMED');
      audit(base(tx), me.id, 'claim.retry', String(c.accountId), String(c.id));
    });
    tryGrant(ctx, a.claimId);
    return ctx.withTx(tx => claimResults(tx, [a.claimId])[0]);
  });

  const adminClaims = st.procedure({ accountId: t.u64(), kind: t.string(), status: t.string(), page: t.u32(), pageSize: t.u32() }, ClaimPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const src = a.accountId ? [...tx.db.claim.accountId.filter(a.accountId)] : a.status ? [...tx.db.claim.status.filter(a.status)] : [...tx.db.claim.iter()];
      const list = src.filter(c => (!a.kind || c.kind === a.kind) && (!a.status || c.status === a.status)).sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminEventLog = st.procedure({ accountId: t.u64(), typeKey: t.string(), source: t.string(), page: t.u32(), pageSize: t.u32() }, EventPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const src = a.accountId ? [...tx.db.playerEvent.accountId.filter(a.accountId)] : a.typeKey ? [...tx.db.playerEvent.typeKey.filter(a.typeKey)] : [...tx.db.playerEvent.iter()];
      const list = src.filter(e => (!a.typeKey || e.typeKey === a.typeKey) && (!a.source || e.source === a.source)).sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminPlayerProgress = st.procedure({ accountId: t.u64() }, Progress, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      const id = a.accountId;
      return {
        levels: [...tx.db.userLevel.byAccountTable.filter(id)],
        streaks: [...tx.db.userStreak.byAccountStreak.filter(id)],
        relations: [...tx.db.userRelation.byAccountRelation.filter(id)],
        tasks: [...tx.db.userTask.byAccountTask.filter(id)],
        groups: [...tx.db.userTaskGroup.byAccountGroup.filter(id)],
        achievements: [...tx.db.userAchievement.byAccountAchievement.filter(id)],
        totals: [...tx.db.eventCounter.accountId.filter(id)].filter(c => c.window === 'all'),
        claims: [...tx.db.claim.accountId.filter(id)].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 50),
      };
    })
  );

  const adminGamificationSummary = st.procedure(Summary, ctx =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const s = gamSettings(tx);
      const dayStart = BigInt(dayNumber(tx.timestamp.microsSinceUnixEpoch) * 86_400_000 - 12_600_000) * 1000n;
      return {
        eventTypes: Number(tx.db.eventType.count()),
        eventRules: Number(tx.db.eventRule.count()),
        levelTables: Number(tx.db.levelTable.count()),
        streaks: Number(tx.db.streak.count()),
        metaRelations: Number(tx.db.metaRelation.count()),
        tasks: Number(tx.db.task.count()),
        taskGroups: Number(tx.db.taskGroup.count()),
        achievements: Number(tx.db.achievement.count()),
        eventsToday: [...tx.db.playerEvent.iter()].filter(e => e.at.microsSinceUnixEpoch >= dayStart).length,
        claimsReady: [...tx.db.claim.status.filter('ready')].length,
        claimsFailed: [...tx.db.claim.status.filter('failed')].length,
        clockOffsetSec: s.clockOffsetSec,
      };
    })
  );

  return {
    adminGamificationSettings,
    adminSaveGamificationSettings,
    adminSetClockOffset,
    adminSaveEventType,
    adminDeleteEventType,
    adminEventRules,
    adminSaveEventRule,
    adminDeleteEventRule,
    adminLevelTables,
    adminSaveLevelTable,
    adminDeleteLevelTable,
    adminStreaks,
    adminSaveStreak,
    adminDeleteStreak,
    adminResetStreak,
    adminMetaRelations,
    adminSaveMetaRelation,
    adminDeleteMetaRelation,
    adminForgetRelation,
    recordEvent,
    adminRecordEvent,
    claimReward,
    myRewards,
    myLevels,
    myMetaRelations,
    myStreaks,
    myEventRules,
    gamGrantWorker,
    gamTick,
    adminRetryClaim,
    adminClaims,
    adminEventLog,
    adminPlayerProgress,
    adminGamificationSummary,
  };
}

function sweep(tx: GTx) {
  const s = gamSettings(tx);
  const now = tx.timestamp.microsSinceUnixEpoch;
  const minute = now / 60_000_000n;
  for (const r of [...tx.db.eventRate.iter()]) if (r.minute + 2n < minute) tx.db.eventRate.key.delete(r.key);
  const cutoff = now - BigInt(s.retentionDays) * 86_400_000_000n;
  let n = 0;
  for (const e of [...tx.db.playerEvent.iter()]) {
    if (e.at.microsSinceUnixEpoch < cutoff) {
      tx.db.playerEvent.id.delete(e.id);
      if (++n >= 5000) break;
    }
  }
  const keep = Math.max(s.retentionDays, 35);
  const oldDay = `d${new Date(Number((nowMicros(tx) - BigInt(keep) * 86_400_000_000n) / 1000n)).toISOString().slice(0, 10)}`;
  const oldWeek = `w${oldDay.slice(1)}`;
  for (const c of [...tx.db.eventCounter.iter()]) {
    if ((c.window.startsWith('d') && c.window < oldDay) || (c.window.startsWith('w') && c.window < oldWeek)) tx.db.eventCounter.key.delete(c.key);
  }
  for (const p of [...tx.db.ruleProgress.iter()]) {
    if ((p.window.startsWith('d') && p.window < oldDay) || (p.window.startsWith('w') && p.window < oldWeek)) tx.db.ruleProgress.key.delete(p.key);
  }
}

