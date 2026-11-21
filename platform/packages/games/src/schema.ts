import { schema, table, t } from 'spacetimedb/server';
import { baseTables, baseEnv, Translations } from '@stg/base';
import { playersTables } from '@stg/players';
import { economyTables } from '@stg/economy';
import { gamificationTables } from '@stg/gamification';
import { itemsTables } from '@stg/items';

export const MetaRequirement = t.object('GameMetaRequirement', { metaKey: t.string(), operator: t.string(), value: t.f64(), consume: t.f64() });

export const Requirements = t.object('GameRequirements', {
  itemKeys: t.array(t.string()),
  itemsMode: t.string(),
  consumeItems: t.bool(),
  tagIds: t.array(t.u64()),
  tagsMode: t.string(),
  excludeTagIds: t.array(t.u64()),
  minLevel: t.u32(),
  metas: t.array(MetaRequirement),
  productIds: t.array(t.u64()),
  paths: t.array(t.string()),
  refund: t.string(),
  lock: t.string(),
  message: Translations,
});

export const MinVersion = t.object('GameMinVersion', { platform: t.string(), version: t.string() });
export const RankReward = t.object('LeaderboardReward', { fromRank: t.u32(), toRank: t.u32(), prizeId: t.u64(), prizeGroupId: t.u64() });
export const MatchResult = t.object('GameMatchResult', { accountId: t.u64(), rank: t.u32(), score: t.f64() });

const game = table(
  { name: 'games_game' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    registered: t.bool(),
    realtime: t.bool(),
    codeName: t.string(),
    settingsSchema: t.string(),
    name: Translations,
    description: Translations,
    iconUrl: t.string(),
    isActive: t.bool(),
    maintenance: t.bool(),
    maintenanceMessage: Translations,
    sort: t.i32(),
    categoryId: t.u64(),
    tagIds: t.array(t.u64()),
    minPlayers: t.u8(),
    maxPlayers: t.u8(),
    turnSeconds: t.u32(),
    matchSeconds: t.u32(),
    botsAllowed: t.bool(),
    botAfterSeconds: t.u32(),
    friendAllowed: t.bool(),
    platforms: t.array(t.string()),
    minVersions: t.array(MinVersion),
    skillMetaKey: t.string(),
    bandSize: t.u32(),
    widenEverySeconds: t.u32(),
    widenStep: t.u32(),
    maxBand: t.u32(),
    fillAfterSeconds: t.u32(),
    settings: t.string(),
    requirements: Requirements,
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const room = table(
  {
    name: 'games_room',
    indexes: [{ accessor: 'byGameKey', algorithm: 'btree', columns: ['gameId', 'key'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64().index('btree'),
    key: t.string(),
    name: Translations,
    entryCurrency: t.string(),
    entryFee: t.i64(),
    prizeId: t.u64(),
    prizeGroupId: t.u64(),
    minLevel: t.u32(),
    isLocked: t.bool(),
    isHidden: t.bool(),
    isActive: t.bool(),
    inheritGame: t.bool(),
    requirements: Requirements,
    sort: t.i32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const ticket = table(
  {
    name: 'games_ticket',
    indexes: [{ accessor: 'byRoomStatus', algorithm: 'btree', columns: ['roomId', 'status'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    gameId: t.u64(),
    roomId: t.u64(),
    path: t.string(),
    code: t.string().index('btree'),
    host: t.bool(),
    status: t.string().index('btree'),
    skill: t.f64(),
    matchId: t.u64().index('btree'),
    feeCurrency: t.string(),
    fee: t.i64(),
    feeRefunded: t.bool(),
    consumed: t.string(),
    refund: t.string(),
    ticketsReturned: t.bool(),
    ready: t.bool(),
    rank: t.u32(),
    score: t.f64(),
    outcome: t.string(),
    createdAt: t.u64(),
    updatedAt: t.u64(),
  }
);

const match = table(
  { name: 'games_match' },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64().index('btree'),
    roomId: t.u64(),
    gameKey: t.string(),
    roomKey: t.string(),
    path: t.string(),
    state: t.string().index('btree'),
    players: t.array(t.u64()),
    bots: t.u8(),
    skillMin: t.f64(),
    skillMax: t.f64(),
    reason: t.string(),
    createdAt: t.u64(),
    startedAt: t.u64(),
    endedAt: t.u64(),
  }
);

const payout = table(
  { name: 'games_payout' },
  {
    id: t.u64().primaryKey().autoInc(),
    uniq: t.string().unique(),
    kind: t.string(),
    refId: t.u64().index('btree'),
    accountId: t.u64().index('btree'),
    prizeId: t.u64(),
    prizeGroupId: t.u64(),
    status: t.string().index('btree'),
    attempts: t.u8(),
    error: t.string(),
    rewards: t.string(),
    createdAt: t.timestamp(),
    grantedAt: t.option(t.timestamp()),
  }
);

const server = table(
  { name: 'games_server' },
  {
    identity: t.identity().primaryKey(),
    note: t.string(),
    isActive: t.bool(),
    createdBy: t.u64(),
    createdAt: t.timestamp(),
  }
);

const leaderboard = table(
  { name: 'games_leaderboard' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    gameId: t.u64().index('btree'),
    name: Translations,
    description: Translations,
    iconUrl: t.string(),
    period: t.string(),
    scoreMode: t.string(),
    order: t.string(),
    source: t.string(),
    topN: t.u32(),
    rewards: t.array(RankReward),
    isActive: t.bool(),
    sort: t.i32(),
    currentPeriod: t.string(),
    periodStartedAt: t.u64(),
    resets: t.u32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const lbScore = table(
  {
    name: 'games_lb_score',
    indexes: [{ accessor: 'byBoardPeriod', algorithm: 'btree', columns: ['boardId', 'period'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    uniq: t.string().unique(),
    boardId: t.u64(),
    period: t.string(),
    accountId: t.u64().index('btree'),
    score: t.f64(),
    rank: t.u32(),
    writes: t.u32(),
    updatedAt: t.u64(),
  }
);

const lbPeriod = table(
  { name: 'games_lb_period' },
  {
    id: t.u64().primaryKey().autoInc(),
    uniq: t.string().unique(),
    boardId: t.u64().index('btree'),
    period: t.string(),
    reason: t.string(),
    paid: t.bool(),
    players: t.u32(),
    rewarded: t.u32(),
    startedAt: t.u64(),
    endedAt: t.u64(),
  }
);

const lbResult = table(
  { name: 'games_lb_result' },
  {
    id: t.u64().primaryKey().autoInc(),
    periodId: t.u64().index('btree'),
    boardId: t.u64(),
    accountId: t.u64().index('btree'),
    rank: t.u32(),
    score: t.f64(),
    prizeId: t.u64(),
    prizeGroupId: t.u64(),
  }
);

const settings = table(
  { name: 'games_settings' },
  {
    id: t.u8().primaryKey(),
    ticketTtlSeconds: t.u32(),
    startTimeoutSeconds: t.u32(),
    playTimeoutSeconds: t.u32(),
    maxTicketsPerPlayer: t.u8(),
    payoutMaxTries: t.u8(),
    weekStart: t.u8(),
    monthCalendar: t.string(),
    historyDays: t.u32(),
    clockOffsetSec: t.i64(),
    updatedAt: t.timestamp(),
  }
);

const tickTimer = table(
  { name: 'games_tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const payoutTimer = table(
  { name: 'games_payout_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const gamesTables = {
  game,
  gameRoom: room,
  gameTicket: ticket,
  gameMatch: match,
  gamePayout: payout,
  gameServer: server,
  leaderboard,
  lbScore,
  lbPeriod,
  lbResult,
  gamesSettings: settings,
  gamesTickTimer: tickTimer,
  gamesPayoutTimer: payoutTimer,
};

export const gamesEnv = {};

export const gamesRows = {
  game: game.rowType,
  room: room.rowType,
  ticket: ticket.rowType,
  match: match.rowType,
  payout: payout.rowType,
  server: server.rowType,
  leaderboard: leaderboard.rowType,
  lbScore: lbScore.rowType,
  lbPeriod: lbPeriod.rowType,
  lbResult: lbResult.rowType,
  settings: settings.rowType,
};

const allTables = { ...baseTables, ...playersTables, ...economyTables, ...gamificationTables, ...itemsTables, ...gamesTables };
export type GamesSchema = ReturnType<typeof schema<typeof allTables, typeof baseEnv>>;
