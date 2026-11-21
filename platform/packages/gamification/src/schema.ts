import { schema, table, t } from 'spacetimedb/server';
import { baseTables, baseEnv, Translations } from '@stg/base';
import { playersTables } from '@stg/players';
import { economyTables } from '@stg/economy';

export const LevelStep = t.object('GamLevelStep', { level: t.u32(), threshold: t.f64(), title: Translations, prizeId: t.u64(), grantMode: t.string() });
export const StreakDay = t.object('GamStreakDay', { day: t.u32(), prizeId: t.u64(), grantMode: t.string() });
export const RelationTarget = t.object('GamRelationTarget', { metaKey: t.string(), action: t.string(), amount: t.f64() });
export const AchievementTier = t.object('GamAchievementTier', { tier: t.u32(), threshold: t.f64(), name: Translations, iconUrl: t.string(), prizeId: t.u64(), grantMode: t.string() });

const settings = table(
  { name: 'gam_settings' },
  {
    id: t.u8().primaryKey(),
    weekStart: t.u8(),
    playerRateLimit: t.u32(),
    retentionDays: t.u32(),
    chainDepth: t.u8(),
    clockOffsetSec: t.i64(),
    updatedAt: t.timestamp(),
  }
);

const eventType = table(
  { name: 'gam_event_type', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    clientAllowed: t.bool(),
    valueMin: t.f64(),
    valueMax: t.f64(),
    rateLimit: t.u32(),
    isActive: t.bool(),
    isSystem: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
  }
);

const playerEvent = table(
  { name: 'gam_player_event' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    typeKey: t.string().index('btree'),
    value: t.f64(),
    metadata: t.string(),
    source: t.string(),
    at: t.timestamp(),
  }
);

const eventCounter = table(
  { name: 'gam_event_counter' },
  {
    key: t.string().primaryKey(),
    accountId: t.u64().index('btree'),
    typeKey: t.string(),
    window: t.string(),
    count: t.u32(),
    sum: t.f64(),
    max: t.f64(),
  }
);

const eventRate = table(
  { name: 'gam_event_rate' },
  {
    key: t.string().primaryKey(),
    minute: t.u64(),
    count: t.u32(),
  }
);

const eventRule = table(
  { name: 'gam_event_rule' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    eventKey: t.string().index('btree'),
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
    createdAt: t.timestamp(),
  }
);

const ruleProgress = table(
  { name: 'gam_rule_progress' },
  {
    key: t.string().primaryKey(),
    ruleId: t.u64().index('btree'),
    accountId: t.u64().index('btree'),
    window: t.string(),
    count: t.u32(),
    sum: t.f64(),
    max: t.f64(),
    steps: t.u32(),
  }
);

const claim = table(
  { name: 'gam_claim' },
  {
    id: t.u64().primaryKey().autoInc(),
    uniq: t.string().unique(),
    accountId: t.u64().index('btree'),
    kind: t.string(),
    ownerId: t.u64().index('btree'),
    refId: t.u64(),
    scope: t.string(),
    prizeId: t.u64(),
    grantMode: t.string(),
    status: t.string().index('btree'),
    depth: t.u8(),
    attempts: t.u8(),
    error: t.string(),
    rewards: t.string(),
    createdAt: t.timestamp(),
    grantedAt: t.option(t.timestamp()),
  }
);

const levelTable = table(
  { name: 'gam_level_table' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    metaKey: t.string().index('btree'),
    levelMetaKey: t.string(),
    steps: t.array(LevelStep),
    isActive: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
  }
);

const userLevel = table(
  {
    name: 'gam_user_level',
    indexes: [{ accessor: 'byAccountTable', algorithm: 'btree', columns: ['accountId', 'tableId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    tableId: t.u64().index('btree'),
    level: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const streak = table(
  { name: 'gam_streak' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    eventKey: t.string().index('btree'),
    periodDays: t.u8(),
    gracePeriods: t.u8(),
    missAction: t.string(),
    cycleLength: t.u32(),
    repayAfterFall: t.bool(),
    rewards: t.array(StreakDay),
    milestones: t.array(StreakDay),
    isActive: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
  }
);

const userStreak = table(
  {
    name: 'gam_user_streak',
    indexes: [{ accessor: 'byAccountStreak', algorithm: 'btree', columns: ['accountId', 'streakId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    streakId: t.u64().index('btree'),
    count: t.u32(),
    best: t.u32(),
    peak: t.u32(),
    run: t.u32(),
    falls: t.u32(),
    graceUsed: t.u32(),
    lastPeriod: t.i64(),
    updatedAt: t.timestamp(),
  }
);

const metaRelation = table(
  { name: 'gam_meta_relation' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    metaKey: t.string().index('btree'),
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
    createdAt: t.timestamp(),
  }
);

const userRelation = table(
  {
    name: 'gam_user_relation',
    indexes: [{ accessor: 'byAccountRelation', algorithm: 'btree', columns: ['accountId', 'relationId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    relationId: t.u64().index('btree'),
    fires: t.u32(),
    armed: t.bool(),
    firstAt: t.timestamp(),
    lastAt: t.timestamp(),
  }
);

const task = table(
  { name: 'gam_task' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    iconUrl: t.string(),
    categoryId: t.u64(),
    tagIds: t.array(t.u64()),
    condition: t.string(),
    eventKey: t.string().index('btree'),
    metric: t.string(),
    target: t.f64(),
    valueMin: t.option(t.f64()),
    valueMax: t.option(t.f64()),
    repeat: t.string(),
    repeatMinutes: t.u32(),
    maxCompletions: t.u32(),
    parentId: t.u64().index('btree'),
    dependsOn: t.array(t.u64()),
    groupId: t.u64().index('btree'),
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
    createdAt: t.timestamp(),
  }
);

const taskGroup = table(
  { name: 'gam_taskgroup' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
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
    createdAt: t.timestamp(),
  }
);

const userTask = table(
  {
    name: 'gam_user_task',
    indexes: [{ accessor: 'byAccountTask', algorithm: 'btree', columns: ['accountId', 'taskId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    taskId: t.u64().index('btree'),
    scope: t.string(),
    status: t.string(),
    count: t.u32(),
    sum: t.f64(),
    max: t.f64(),
    completedAt: t.option(t.timestamp()),
    completedMicros: t.u64(),
    completedBy: t.string(),
    claimId: t.u64(),
    claimedAt: t.option(t.timestamp()),
    error: t.string(),
  }
);

const userTaskGroup = table(
  {
    name: 'gam_user_taskgroup',
    indexes: [{ accessor: 'byAccountGroup', algorithm: 'btree', columns: ['accountId', 'groupId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    groupId: t.u64().index('btree'),
    cycle: t.u32(),
    handed: t.array(t.u64()),
    nextAt: t.u64(),
  }
);

const achievement = table(
  { name: 'gam_achievement' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
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
    eventKey: t.string().index('btree'),
    metric: t.string(),
    valueMin: t.option(t.f64()),
    valueMax: t.option(t.f64()),
    taskId: t.u64(),
    taskGroupId: t.u64(),
    tiers: t.array(AchievementTier),
    isActive: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
  }
);

const userAchievement = table(
  {
    name: 'gam_user_achievement',
    indexes: [{ accessor: 'byAccountAchievement', algorithm: 'btree', columns: ['accountId', 'achievementId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    achievementId: t.u64().index('btree'),
    count: t.u32(),
    sum: t.f64(),
    max: t.f64(),
    tier: t.u32(),
    unlockedAt: t.option(t.timestamp()),
    tierAt: t.option(t.timestamp()),
    source: t.string(),
    sourceRef: t.string(),
  }
);

const grantTimer = table(
  { name: 'gam_grant_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const tickTimer = table(
  { name: 'gam_tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const gamificationTables = {
  gamSettings: settings,
  eventType,
  playerEvent,
  eventCounter,
  eventRate,
  eventRule,
  ruleProgress,
  claim,
  levelTable,
  userLevel,
  streak,
  userStreak,
  metaRelation,
  userRelation,
  task,
  taskGroup,
  userTask,
  userTaskGroup,
  achievement,
  userAchievement,
  grantTimer,
  tickTimer,
};

export const gamificationEnv = {};

export const gamRows = {
  settings: settings.rowType,
  eventRule: eventRule.rowType,
  levelTable: levelTable.rowType,
  streak: streak.rowType,
  userStreak: userStreak.rowType,
  metaRelation: metaRelation.rowType,
  userRelation: userRelation.rowType,
  task: task.rowType,
  taskGroup: taskGroup.rowType,
  userTask: userTask.rowType,
  userTaskGroup: userTaskGroup.rowType,
  achievement: achievement.rowType,
  userAchievement: userAchievement.rowType,
  claim: claim.rowType,
  playerEvent: playerEvent.rowType,
  eventCounter: eventCounter.rowType,
  userLevel: userLevel.rowType,
};

const allTables = { ...baseTables, ...playersTables, ...economyTables, ...gamificationTables };
export type GamificationSchema = ReturnType<typeof schema<typeof allTables, typeof baseEnv>>;
