import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, fail, requireAccount, requireRole } from '@stg/base';
import { extraItemTypes, itemHandlers, itemValidators } from '@stg/economy';
import { AchievementTier, gamRows, type GamificationSchema } from './schema';
import {
  MEASURES,
  chain,
  gamSettings,
  giveAchievement,
  groupRow,
  completeTask,
  hasAudience,
  inWindow,
  measureOf,
  nowMicros,
  openScope,
  refillGroup,
  taskRows,
  taskVisible,
  tryGrant,
  windowEnd,
  type GTx,
  type TaskRow,
} from './engine';
import { ClaimResult, claimResults } from './events';
import { base, checkAudience, checkEventKey, checkMode, checkPrize, checkRange, checkTaxonomy, checkUrl, checkWindow, lockedKey, tr } from './valid';

const KEY = /^[a-z][a-z0-9_.-]{1,63}$/;
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

const TaskView = t.object('GamTaskView', {
  taskId: t.u64(),
  key: t.string(),
  name: Translations,
  description: Translations,
  iconUrl: t.string(),
  categoryId: t.u64(),
  tagIds: t.array(t.u64()),
  condition: t.string(),
  eventKey: t.string(),
  metric: t.string(),
  target: t.f64(),
  value: t.f64(),
  progress: t.f64(),
  state: t.string(),
  scope: t.string(),
  claimable: t.bool(),
  claimId: t.u64(),
  pending: t.u32(),
  grantMode: t.string(),
  prizeId: t.u64(),
  repeat: t.string(),
  repeatMinutes: t.u32(),
  maxCompletions: t.u32(),
  completions: t.u32(),
  periodEndsAt: t.u64(),
  nextAt: t.u64(),
  dependsOn: t.array(t.u64()),
  parentId: t.u64(),
  groupId: t.u64(),
});

const GroupView = t.object('GamTaskGroupView', {
  groupId: t.u64(),
  key: t.string(),
  name: Translations,
  description: Translations,
  iconUrl: t.string(),
  cycle: t.u32(),
  activeCount: t.u8(),
  orderMode: t.string(),
  handout: t.string(),
  handoutMinutes: t.u32(),
  repeatable: t.bool(),
  total: t.u32(),
  done: t.u32(),
  handed: t.array(t.string()),
  nextAt: t.u64(),
  canRequest: t.bool(),
  finished: t.bool(),
});

const TaskList = t.object('GamTaskList', { tasks: t.array(TaskView), groups: t.array(GroupView) });
const HandoutResult = t.object('GamHandoutResult', { groupKey: t.string(), handed: t.array(t.string()) });

const AchievementEntry = t.row('GamAchievementEntry', {
  achievementId: t.u64().primaryKey(),
  key: t.string(),
  name: Translations,
  description: Translations,
  hint: Translations,
  iconUrl: t.string(),
  rarity: t.string(),
  points: t.u32(),
  categoryId: t.u64(),
  hidden: t.bool(),
  state: t.string(),
  source: t.string(),
  tier: t.u32(),
  maxTier: t.u32(),
  value: t.f64(),
  tiers: t.array(AchievementTier),
  claimable: t.array(t.u64()),
});

function finished(status: string) {
  return status === 'completed' || status === 'claimed';
}

function accountOfSession(ctx: { db: GTx['db']; sender: GTx['sender'] }) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  return a && a.status === 'active' ? a : undefined;
}

function dependsCycle(ctx: GTx, id: bigint, deps: bigint[]) {
  const seen = new Set<bigint>();
  const stack = [...deps];
  while (stack.length) {
    const d = stack.pop()!;
    if (d === id) return true;
    if (seen.has(d)) continue;
    seen.add(d);
    const t = ctx.db.task.id.find(d);
    if (t) stack.push(...t.dependsOn);
  }
  return false;
}

function taskState(tx: GTx, accountId: bigint, task: TaskRow, now: bigint) {
  const s = gamSettings(tx);
  const top = task.parentId ? tx.db.task.id.find(task.parentId) : task;
  if (!top || !task.isActive || !taskVisible(tx, accountId, top, now)) return undefined;
  if (top.groupId) {
    const ug = groupRow(tx, accountId, top.groupId);
    if (!ug || !ug.handed.includes(top.id)) return undefined;
  }
  const rows = taskRows(tx, accountId, task.id);
  const done = rows.filter(r => finished(r.status));
  const pending = rows.filter(r => r.status === 'completed').sort((a, b) => (a.id < b.id ? -1 : 1));
  const locked = top.dependsOn.some(d => !taskRows(tx, accountId, d).some(r => finished(r.status)));
  const scope = locked ? undefined : openScope(tx, accountId, task, now, s);
  const row = scope ? rows.find(r => r.scope === scope) : pending[0] ?? done[done.length - 1];
  let state: string;
  let nextAt = 0n;
  if (locked) state = 'locked';
  else if (pending.length) state = 'completed';
  else if (scope) state = 'active';
  else if (task.repeat === 'interval' && !task.parentId && (!task.maxCompletions || done.length < task.maxCompletions)) {
    state = 'cooldown';
    const last = done.reduce((m, r) => (r.completedMicros > m ? r.completedMicros : m), 0n);
    nextAt = last + BigInt(task.repeatMinutes) * 60_000_000n;
  } else state = done.some(r => r.status === 'claimed') ? 'claimed' : 'done';
  const value = scope ? (row ? measureOf(task.metric, row) : 0) : row ? measureOf(task.metric, row) : 0;
  const period = task.repeat === 'daily' ? 'day' : task.repeat === 'weekly' ? 'week' : 'total';
  return {
    taskId: task.id,
    key: task.key,
    name: task.name,
    description: task.description,
    iconUrl: task.iconUrl,
    categoryId: task.categoryId,
    tagIds: task.tagIds,
    condition: task.condition,
    eventKey: task.eventKey,
    metric: task.metric,
    target: task.target,
    value,
    progress: task.target ? Math.min(value / task.target, 1) : 0,
    state,
    scope: scope ?? row?.scope ?? '',
    claimable: pending.length > 0,
    claimId: pending[0]?.claimId ?? 0n,
    pending: pending.length,
    grantMode: task.grantMode,
    prizeId: task.prizeId,
    repeat: task.repeat,
    repeatMinutes: task.repeatMinutes,
    maxCompletions: task.maxCompletions,
    completions: done.length,
    periodEndsAt: windowEnd(period, now, s.weekStart),
    nextAt,
    dependsOn: task.dependsOn,
    parentId: task.parentId,
    groupId: task.groupId,
  };
}

export function defineMissions(st: GamificationSchema) {
  extraItemTypes.push('achievement');
  itemValidators.push((ctx, item) => {
    if (item.type !== 'achievement') return;
    if (!(ctx as unknown as GTx).db.achievement.key.find(item.key)) fail('ACHIEVEMENT_NOT_FOUND');
  });
  itemHandlers.push((ctx, accountId, item, prizeKey, sourceType, sourceId) => {
    if (item.type !== 'achievement') return undefined;
    const g = ctx as unknown as GTx;
    const a = g.db.achievement.key.find(item.key);
    if (!a) fail('ACHIEVEMENT_NOT_FOUND');
    const tier = giveAchievement(g, accountId, a.id, Math.max(Math.trunc(item.value) || 1, 1), 'prize', `${sourceType}:${sourceId}`.slice(0, 200), chain.base);
    return { type: 'achievement', key: a.key, action: 'give', value: tier, prizeKey };
  });

  const adminTasks = st.view({ name: 'admin_tasks', public: true }, t.array(gamRows.task), ctx => (adminOrNull(ctx as any) ? [...ctx.db.task.iter()] : []));

  const adminSaveTask = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      name: Translations,
      description: Translations,
      iconUrl: t.string(),
      categoryId: t.u64(),
      tagIds: t.array(t.u64()),
      condition: t.string(),
      eventKey: t.string(),
      metric: t.string(),
      target: t.f64(),
      valueMin: t.option(t.f64()),
      valueMax: t.option(t.f64()),
      repeat: t.string(),
      repeatMinutes: t.u32(),
      maxCompletions: t.u32(),
      parentId: t.u64(),
      dependsOn: t.array(t.u64()),
      groupId: t.u64(),
      prizeId: t.u64(),
      grantMode: t.string(),
      audienceTagIds: t.array(t.u64()),
      levelTableId: t.u64(),
      minLevel: t.u32(),
      maxLevel: t.u32(),
      startsAt: t.u64(),
      endsAt: t.u64(),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = a.key.trim();
      if (!KEY.test(key)) fail('INVALID_KEY');
      const old = a.id ? ctx.db.task.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      lockedKey(old, key);
      const same = ctx.db.task.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (a.condition !== 'event' && a.condition !== 'children') fail('INVALID_CONDITION');
      const row = { ...a, valueMin: a.valueMin as number | undefined, valueMax: a.valueMax as number | undefined, key, name: tr(ctx, a.name), description: tr(ctx, a.description, false), iconUrl: checkUrl(a.iconUrl), createdAt: old?.createdAt ?? ctx.timestamp };
      if (a.condition === 'event') {
        checkEventKey(ctx, a.eventKey);
        if (!MEASURES.includes(a.metric)) fail('INVALID_METRIC');
        if (!Number.isFinite(a.target) || a.target <= 0) fail('INVALID_TARGET');
        checkRange(a.valueMin, a.valueMax);
        if (old && [...ctx.db.task.parentId.filter(old.id)].length) fail('HAS_SUBTASKS');
      } else {
        Object.assign(row, { eventKey: '', metric: 'count', target: 1, valueMin: undefined, valueMax: undefined });
      }
      if (!['once', 'daily', 'weekly', 'interval'].includes(a.repeat)) fail('INVALID_REPEAT');
      if (a.repeat === 'interval' && (a.repeatMinutes < 1 || a.repeatMinutes > 525_600)) fail('INVALID_REPEAT_MINUTES');
      if (a.repeat !== 'interval') row.repeatMinutes = 0;
      if (a.parentId) {
        if (a.parentId === a.id) fail('SELF_PARENT');
        const p = ctx.db.task.id.find(a.parentId);
        if (!p) fail('PARENT_NOT_FOUND');
        if (p.condition !== 'children') fail('PARENT_NOT_GROUPING');
        if (p.parentId) fail('NESTED_SUBTASK');
        if (a.condition !== 'event') fail('SUBTASK_NEEDS_EVENT');
        if (a.groupId) fail('SUBTASK_IN_GROUP');
        Object.assign(row, { repeat: 'once', repeatMinutes: 0, maxCompletions: 0, dependsOn: [], audienceTagIds: [], levelTableId: 0n, minLevel: 0, maxLevel: 0, startsAt: 0n, endsAt: 0n });
      }
      if (a.dependsOn.length > 10) fail('TOO_MANY_DEPENDENCIES');
      for (const d of a.dependsOn) {
        if (d === a.id) fail('SELF_DEPENDENCY');
        if (!ctx.db.task.id.find(d)) fail('TASK_NOT_FOUND');
      }
      row.dependsOn = [...new Set(row.dependsOn)];
      if (a.id && dependsCycle(ctx, a.id, row.dependsOn)) fail('DEPENDENCY_CYCLE');
      if (a.groupId) {
        const g = ctx.db.taskGroup.id.find(a.groupId);
        if (!g) fail('TASK_GROUP_NOT_FOUND');
        if (a.repeat !== 'once') fail('GROUP_TASK_REPEAT');
      }
      if (row.levelTableId) {
        if (!ctx.db.levelTable.id.find(row.levelTableId)) fail('LEVEL_TABLE_REQUIRED');
        if (row.maxLevel && row.minLevel > row.maxLevel) fail('INVALID_LEVEL_RANGE');
      } else if (row.minLevel || row.maxLevel) fail('LEVEL_TABLE_REQUIRED');
      checkWindow(row.startsAt, row.endsAt);
      row.prizeId = checkPrize(ctx, a.prizeId);
      row.grantMode = checkMode(a.grantMode);
      row.audienceTagIds = checkAudience(ctx, row.audienceTagIds);
      row.tagIds = checkTaxonomy(ctx, 'task', a.categoryId, a.tagIds);
      const saved = old ? ctx.db.task.id.update(row) : ctx.db.task.insert({ ...row, id: 0n });
      if (saved.groupId) {
        const g = ctx.db.taskGroup.id.find(saved.groupId)!;
        if (!g.taskIds.includes(saved.id)) ctx.db.taskGroup.id.update({ ...g, taskIds: [...g.taskIds, saved.id] });
      }
      if (old?.groupId && old.groupId !== saved.groupId) {
        const g = ctx.db.taskGroup.id.find(old.groupId);
        if (g) ctx.db.taskGroup.id.update({ ...g, taskIds: g.taskIds.filter(x => x !== saved.id) });
      }
      audit(base(ctx), me.id, old ? 'task.update' : 'task.create', String(saved.id), key);
    }
  );

  const adminDeleteTask = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const task = ctx.db.task.id.find(id);
    if (!task) fail('NOT_FOUND');
    if ([...ctx.db.task.parentId.filter(id)].length) fail('HAS_SUBTASKS');
    if ([...ctx.db.userTask.taskId.filter(id)].length) fail('IN_USE');
    if ([...ctx.db.achievement.iter()].some(x => x.taskId === id)) fail('IN_USE');
    ctx.db.task.id.delete(id);
    for (const o of [...ctx.db.task.iter()]) if (o.dependsOn.includes(id)) ctx.db.task.id.update({ ...o, dependsOn: o.dependsOn.filter(x => x !== id) });
    if (task.groupId) {
      const g = ctx.db.taskGroup.id.find(task.groupId);
      if (g) ctx.db.taskGroup.id.update({ ...g, taskIds: g.taskIds.filter(x => x !== id) });
    }
    audit(base(ctx), me.id, 'task.delete', String(id), task.key);
  });

  const adminTaskGroups = st.view({ name: 'admin_task_groups', public: true }, t.array(gamRows.taskGroup), ctx => (adminOrNull(ctx as any) ? [...ctx.db.taskGroup.iter()] : []));

  const adminSaveTaskGroup = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      name: Translations,
      description: Translations,
      iconUrl: t.string(),
      categoryId: t.u64(),
      activeCount: t.u8(),
      orderMode: t.string(),
      handout: t.string(),
      handoutMinutes: t.u32(),
      isRepeatable: t.bool(),
      taskIds: t.array(t.u64()),
      audienceTagIds: t.array(t.u64()),
      startsAt: t.u64(),
      endsAt: t.u64(),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = a.key.trim();
      if (!KEY.test(key)) fail('INVALID_KEY');
      const old = a.id ? ctx.db.taskGroup.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      lockedKey(old, key);
      const same = ctx.db.taskGroup.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (a.activeCount < 1 || a.activeCount > 20) fail('INVALID_ACTIVE_COUNT');
      if (!['ordered', 'random'].includes(a.orderMode)) fail('INVALID_ORDER_MODE');
      if (!['auto', 'request', 'timer'].includes(a.handout)) fail('INVALID_HANDOUT');
      if (a.handout === 'timer' && (a.handoutMinutes < 1 || a.handoutMinutes > 525_600)) fail('INVALID_HANDOUT_MINUTES');
      checkWindow(a.startsAt, a.endsAt);
      const ids = [...new Set(a.taskIds)];
      if (ids.length > 200) fail('TOO_MANY_TASKS');
      for (const id of ids) {
        const x = ctx.db.task.id.find(id);
        if (!x) fail('TASK_NOT_FOUND');
        if (x.parentId) fail('SUBTASK_IN_GROUP');
      }
      checkTaxonomy(ctx, 'task', a.categoryId, []);
      const row = {
        ...a,
        key,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        iconUrl: checkUrl(a.iconUrl),
        handoutMinutes: a.handout === 'timer' ? a.handoutMinutes : 0,
        taskIds: ids,
        audienceTagIds: checkAudience(ctx, a.audienceTagIds),
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.taskGroup.id.update(row) : ctx.db.taskGroup.insert({ ...row, id: 0n });
      for (const x of [...ctx.db.task.groupId.filter(saved.id)]) if (!ids.includes(x.id)) ctx.db.task.id.update({ ...x, groupId: 0n });
      for (const id of ids) {
        const x = ctx.db.task.id.find(id)!;
        if (x.groupId && x.groupId !== saved.id) {
          const og = ctx.db.taskGroup.id.find(x.groupId);
          if (og) ctx.db.taskGroup.id.update({ ...og, taskIds: og.taskIds.filter(y => y !== id) });
        }
        if (x.groupId !== saved.id || x.repeat !== 'once') ctx.db.task.id.update({ ...x, groupId: saved.id, repeat: 'once', repeatMinutes: 0 });
      }
      audit(base(ctx), me.id, old ? 'task_group.update' : 'task_group.create', String(saved.id), key);
    }
  );

  const adminDeleteTaskGroup = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const g = ctx.db.taskGroup.id.find(id);
    if (!g) fail('NOT_FOUND');
    if ([...ctx.db.userTaskGroup.groupId.filter(id)].length) fail('IN_USE');
    if ([...ctx.db.achievement.iter()].some(x => x.taskGroupId === id)) fail('IN_USE');
    for (const x of [...ctx.db.task.groupId.filter(id)]) ctx.db.task.id.update({ ...x, groupId: 0n });
    ctx.db.taskGroup.id.delete(id);
    audit(base(ctx), me.id, 'task_group.delete', String(id), g.key);
  });

  const myTasks = st.procedure(TaskList, ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const now = nowMicros(tx);
      const groups = [...tx.db.taskGroup.iter()].filter(g => g.isActive && inWindow(g.startsAt, g.endsAt, now) && hasAudience(tx, me.id, g.audienceTagIds));
      for (const g of groups) if (g.handout !== 'request' || !groupRow(tx, me.id, g.id)) refillGroup(tx, me.id, g, now, false);
      const tasks = [...tx.db.task.iter()]
        .sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1))
        .map(x => taskState(tx, me.id, x, now))
        .filter(x => !!x);
      return {
        tasks: tasks as NonNullable<(typeof tasks)[number]>[],
        groups: groups.map(g => {
          const ug = groupRow(tx, me.id, g.id);
          const cycle = ug?.cycle ?? 1;
          const members = g.taskIds.map(id => tx.db.task.id.find(id)).filter(x => !!x && x.isActive && !x.parentId);
          const done = members.filter(m => taskRows(tx, me.id, m!.id).some(r => r.scope === `g${cycle}` && finished(r.status))).length;
          const handed = ug?.handed ?? [];
          const open = handed.filter(id => !taskRows(tx, me.id, id).some(r => r.scope === `g${cycle}` && finished(r.status))).length;
          const isFinished = members.length > 0 && done === members.length && !g.isRepeatable;
          return {
            groupId: g.id,
            key: g.key,
            name: g.name,
            description: g.description,
            iconUrl: g.iconUrl,
            cycle,
            activeCount: g.activeCount,
            orderMode: g.orderMode,
            handout: g.handout,
            handoutMinutes: g.handoutMinutes,
            repeatable: g.isRepeatable,
            total: members.length,
            done,
            handed: handed.map(id => tx.db.task.id.find(id)?.key ?? ''),
            nextAt: ug?.nextAt ?? 0n,
            canRequest: g.handout !== 'auto' && !isFinished && open < g.activeCount && handed.length < members.length && (g.handout !== 'timer' || now >= (ug?.nextAt ?? 0n)),
            finished: isFinished,
          };
        }),
      };
    })
  );

  const claimTask = st.procedure({ taskId: t.u64() }, ClaimResult, (ctx, a) => {
    const plan = ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const task = tx.db.task.id.find(a.taskId);
      if (!task) fail('TASK_NOT_FOUND');
      const rows = taskRows(tx, me.id, task.id);
      const pending = rows.filter(r => r.status === 'completed' && r.claimId).sort((x, y) => (x.id < y.id ? -1 : 1));
      if (!pending.length) fail(rows.some(r => r.status === 'claimed') && !rows.some(r => r.status === 'active') ? 'ALREADY_CLAIMED' : 'TASK_NOT_COMPLETED');
      return { me: me.id, claimId: pending[0].claimId };
    });
    const r = tryGrant(ctx, plan.claimId, plan.me);
    if (r.error) fail(r.error);
    return ctx.withTx(tx => claimResults(tx, [plan.claimId])[0]);
  });

  const taskGroupNext = st.procedure({ groupKey: t.string() }, HandoutResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const g = tx.db.taskGroup.key.find(a.groupKey);
      if (!g) fail('TASK_GROUP_NOT_FOUND');
      return { groupKey: g.key, handed: refillGroup(tx, me.id, g, nowMicros(tx), true) };
    })
  );

  const adminCompleteTask = st.reducer({ accountId: t.u64(), taskId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const task = ctx.db.task.id.find(a.taskId);
    if (!task) fail('TASK_NOT_FOUND');
    if (!ctx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
    const now = nowMicros(ctx);
    const scope = openScope(ctx, a.accountId, task, now, gamSettings(ctx));
    if (!scope) fail('TASK_NOT_AVAILABLE');
    let row = taskRows(ctx, a.accountId, task.id).find(r => r.scope === scope);
    if (row && row.status !== 'active') fail('TASK_ALREADY_COMPLETED');
    if (!row) row = ctx.db.userTask.insert({ id: 0n, accountId: a.accountId, taskId: task.id, scope, status: 'active', count: 0, sum: 0, max: 0, completedAt: undefined, completedMicros: 0n, completedBy: '', claimId: 0n, claimedAt: undefined, error: '' });
    completeTask(ctx, a.accountId, task, row, now, 'admin', 0);
    audit(base(ctx), me.id, 'task.complete', String(a.accountId), task.key);
  });

  const adminResetTask = st.reducer({ accountId: t.u64(), taskId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const task = ctx.db.task.id.find(a.taskId);
    if (!task) fail('TASK_NOT_FOUND');
    const rows = taskRows(ctx, a.accountId, task.id).sort((x, y) => (x.id < y.id ? 1 : -1));
    if (!rows.length) fail('TASK_NOT_STARTED');
    const last = rows[0];
    if (last.status === 'claimed') fail('TASK_ALREADY_CLAIMED');
    if (last.claimId) {
      const c = ctx.db.claim.id.find(last.claimId);
      if (c && c.status !== 'granted') ctx.db.claim.id.delete(c.id);
    }
    ctx.db.userTask.id.delete(last.id);
    for (const kid of ctx.db.task.parentId.filter(task.id)) {
      for (const r of taskRows(ctx, a.accountId, kid.id)) {
        if (r.scope !== last.scope || r.status === 'claimed') continue;
        if (r.claimId) {
          const c = ctx.db.claim.id.find(r.claimId);
          if (c && c.status !== 'granted') ctx.db.claim.id.delete(c.id);
        }
        ctx.db.userTask.id.delete(r.id);
      }
    }
    audit(base(ctx), me.id, 'task.reset', String(a.accountId), task.key);
  });

  const adminAchievements = st.view({ name: 'admin_achievements', public: true }, t.array(gamRows.achievement), ctx => (adminOrNull(ctx as any) ? [...ctx.db.achievement.iter()] : []));

  const adminSaveAchievement = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      name: Translations,
      description: Translations,
      hint: Translations,
      iconUrl: t.string(),
      lockedIconUrl: t.string(),
      categoryId: t.u64(),
      tagIds: t.array(t.u64()),
      rarity: t.string(),
      points: t.u32(),
      isHidden: t.bool(),
      source: t.string(),
      eventKey: t.string(),
      metric: t.string(),
      valueMin: t.option(t.f64()),
      valueMax: t.option(t.f64()),
      taskId: t.u64(),
      taskGroupId: t.u64(),
      tiers: t.array(AchievementTier),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = a.key.trim();
      if (!KEY.test(key)) fail('INVALID_KEY');
      const old = a.id ? ctx.db.achievement.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      lockedKey(old, key);
      const same = ctx.db.achievement.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (!RARITIES.includes(a.rarity)) fail('INVALID_RARITY');
      if (a.points > 100_000) fail('INVALID_POINTS');
      if (!['event', 'task', 'manual'].includes(a.source)) fail('INVALID_SOURCE');
      const row = {
        ...a,
        valueMin: a.valueMin as number | undefined,
        valueMax: a.valueMax as number | undefined,
        key,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        hint: tr(ctx, a.hint, false),
        iconUrl: checkUrl(a.iconUrl),
        lockedIconUrl: checkUrl(a.lockedIconUrl),
        tagIds: checkTaxonomy(ctx, 'achievement', a.categoryId, a.tagIds),
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      if (a.source === 'event') {
        checkEventKey(ctx, a.eventKey);
        if (!MEASURES.includes(a.metric)) fail('INVALID_METRIC');
        checkRange(a.valueMin, a.valueMax);
      } else Object.assign(row, { eventKey: '', metric: 'count', valueMin: undefined, valueMax: undefined });
      if (a.source === 'task') {
        if (a.taskId && a.taskGroupId) fail('TASK_AND_GROUP');
        if (!a.taskId && !a.taskGroupId) fail('TASK_REQUIRED');
        if (a.taskId && !ctx.db.task.id.find(a.taskId)) fail('TASK_NOT_FOUND');
        if (a.taskGroupId && !ctx.db.taskGroup.id.find(a.taskGroupId)) fail('TASK_GROUP_NOT_FOUND');
      } else Object.assign(row, { taskId: 0n, taskGroupId: 0n });
      let tiers = [...a.tiers].sort((x, y) => x.tier - y.tier);
      if (a.source !== 'event') {
        if (tiers.length > 1) fail('TIERS_NEED_EVENT');
        tiers = [{ tier: 1, threshold: 1, name: tiers[0]?.name ?? [], iconUrl: tiers[0]?.iconUrl ?? '', prizeId: tiers[0]?.prizeId ?? 0n, grantMode: tiers[0]?.grantMode ?? 'auto' }];
      }
      if (!tiers.length) fail('TIERS_REQUIRED');
      if (tiers.length > 10) fail('TOO_MANY_TIERS');
      let prev = -Infinity;
      tiers.forEach((x, i) => {
        if (x.tier !== i + 1) fail('TIERS_NOT_CONSECUTIVE');
        if (!Number.isFinite(x.threshold) || x.threshold <= 0) fail('INVALID_THRESHOLD');
        if (x.threshold <= prev) fail('THRESHOLDS_NOT_ORDERED');
        prev = x.threshold;
        checkPrize(ctx, x.prizeId);
        checkMode(x.grantMode);
      });
      if (old) {
        const max = tiers.length;
        if ([...ctx.db.claim.ownerId.filter(old.id)].some(c => c.kind === 'achievement' && Number(c.refId) > max)) fail('TIER_IN_USE');
      }
      row.tiers = tiers.map(x => ({ ...x, name: tr(ctx, x.name, false), iconUrl: checkUrl(x.iconUrl) }));
      const saved = old ? ctx.db.achievement.id.update(row) : ctx.db.achievement.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'achievement.update' : 'achievement.create', String(saved.id), key);
    }
  );

  const adminDeleteAchievement = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const a = ctx.db.achievement.id.find(id);
    if (!a) fail('NOT_FOUND');
    if ([...ctx.db.userAchievement.achievementId.filter(id)].some(u => u.tier > 0)) fail('IN_USE');
    if ([...ctx.db.claim.ownerId.filter(id)].some(c => c.kind === 'achievement')) fail('IN_USE');
    if ([...ctx.db.prize.iter()].some(p => p.items.some(i => i.type === 'achievement' && i.key === a.key))) fail('IN_USE');
    for (const u of [...ctx.db.userAchievement.achievementId.filter(id)]) ctx.db.userAchievement.id.delete(u.id);
    ctx.db.achievement.id.delete(id);
    audit(base(ctx), me.id, 'achievement.delete', String(id), a.key);
  });

  const adminGiveAchievement = st.reducer({ accountId: t.u64(), achievementId: t.u64(), tier: t.u32() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
    const ach = ctx.db.achievement.id.find(a.achievementId);
    if (!ach) fail('ACHIEVEMENT_NOT_FOUND');
    const want = a.tier || 1;
    if (!ach.tiers.some(x => x.tier === want)) fail('TIER_NOT_FOUND');
    const cur = [...ctx.db.userAchievement.byAccountAchievement.filter([a.accountId, ach.id])][0]?.tier ?? 0;
    if (cur >= want) fail('ALREADY_UNLOCKED');
    giveAchievement(ctx, a.accountId, ach.id, want, 'admin', String(me.id));
    audit(base(ctx), me.id, 'achievement.give', String(a.accountId), `${ach.key} t${want}`);
  });

  const adminRevokeAchievement = st.reducer({ accountId: t.u64(), achievementId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const ach = ctx.db.achievement.id.find(a.achievementId);
    if (!ach) fail('ACHIEVEMENT_NOT_FOUND');
    const ua = [...ctx.db.userAchievement.byAccountAchievement.filter([a.accountId, ach.id])][0];
    if (!ua || !ua.tier) fail('NOT_UNLOCKED');
    ctx.db.userAchievement.id.delete(ua.id);
    for (const c of [...ctx.db.claim.ownerId.filter(ach.id)]) {
      if (c.kind === 'achievement' && c.accountId === a.accountId && c.status !== 'granted') ctx.db.claim.id.delete(c.id);
    }
    audit(base(ctx), me.id, 'achievement.revoke', String(a.accountId), ach.key);
  });

  const myAchievements = st.view({ name: 'my_achievements', public: true }, t.array(AchievementEntry), ctx => {
    const me = accountOfSession(ctx as any);
    if (!me) return [];
    const claims = [...ctx.db.claim.accountId.filter(me.id)].filter(c => c.kind === 'achievement');
    return [...ctx.db.achievement.iter()]
      .filter(a => a.isActive)
      .sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1))
      .map(a => {
        const ua = [...ctx.db.userAchievement.byAccountAchievement.filter([me.id, a.id])][0];
        const tier = ua?.tier ?? 0;
        const secret = a.isHidden && tier === 0;
        return {
          achievementId: a.id,
          key: secret ? '' : a.key,
          name: secret ? [] : a.name,
          description: secret ? [] : a.description,
          hint: a.hint,
          iconUrl: secret || tier === 0 ? a.lockedIconUrl : a.iconUrl,
          rarity: a.rarity,
          points: a.points,
          categoryId: a.categoryId,
          hidden: a.isHidden,
          state: secret ? 'hidden' : tier === 0 ? 'locked' : tier >= a.tiers.length ? 'completed' : 'unlocked',
          source: secret ? '' : a.source,
          tier,
          maxTier: a.tiers.length,
          value: secret ? 0 : ua ? measureOf(a.metric, ua) : 0,
          tiers: secret ? [] : a.tiers,
          claimable: claims.filter(c => c.ownerId === a.id && c.status !== 'granted' && c.grantMode === 'claim').map(c => c.id),
        };
      });
  });

  const claimAchievement = st.procedure({ achievementId: t.u64(), tier: t.u32() }, t.array(ClaimResult), (ctx, a) => {
    const plan = ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const ach = tx.db.achievement.id.find(a.achievementId);
      if (!ach || !ach.isActive) fail('ACHIEVEMENT_NOT_FOUND');
      const ua = [...tx.db.userAchievement.byAccountAchievement.filter([me.id, ach.id])][0];
      if (!ua || !ua.tier) fail('ACHIEVEMENT_LOCKED');
      const mine = [...tx.db.claim.ownerId.filter(ach.id)].filter(c => c.kind === 'achievement' && c.accountId === me.id);
      if (a.tier) {
        const def = ach.tiers.find(x => x.tier === a.tier);
        if (!def) fail('TIER_NOT_FOUND');
        if (a.tier > ua.tier) fail('TIER_NOT_REACHED');
        if (!def.prizeId) fail('TIER_HAS_NO_PRIZE');
        const c = mine.find(x => Number(x.refId) === a.tier);
        if (!c) fail('TIER_HAS_NO_PRIZE');
        if (c.status === 'granted') fail('ALREADY_CLAIMED');
        return { me: me.id, ids: [c.id] };
      }
      const ids = mine.filter(c => c.status !== 'granted').map(c => c.id);
      if (!ids.length) fail('NOTHING_TO_CLAIM');
      return { me: me.id, ids };
    });
    for (const id of plan.ids) {
      const r = tryGrant(ctx, id, plan.me);
      if (r.error && plan.ids.length === 1) fail(r.error);
    }
    return ctx.withTx(tx => claimResults(tx, plan.ids));
  });

  return {
    adminTasks,
    adminSaveTask,
    adminDeleteTask,
    adminTaskGroups,
    adminSaveTaskGroup,
    adminDeleteTaskGroup,
    myTasks,
    claimTask,
    taskGroupNext,
    adminCompleteTask,
    adminResetTask,
    adminAchievements,
    adminSaveAchievement,
    adminDeleteAchievement,
    adminGiveAchievement,
    adminRevokeAchievement,
    myAchievements,
    claimAchievement,
  };
}
