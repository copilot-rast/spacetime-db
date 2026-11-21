import { schema, table, t } from 'spacetimedb/server';
import { baseTables, baseEnv, Translations } from '@stg/base';
import { playersTables } from '@stg/players';
import { economyTables } from '@stg/economy';
import { gamificationTables } from '@stg/gamification';
import { itemsTables } from '@stg/items';

export const ChanceSlot = t.object('ChanceSlot', { chance: t.f64(), prizeId: t.u64(), prizeGroupId: t.u64() });
export const TicketPrice = t.object('ChanceTicketPrice', { type: t.string(), key: t.string(), amount: t.i64() });

const settings = table(
  { name: 'promo_settings' },
  {
    id: t.u8().primaryKey(),
    listPerMinute: t.u32(),
    countPerMinute: t.u32(),
    playPerMinute: t.u32(),
    newPlayerDays: t.u32(),
    requestTtlHours: t.u32(),
    keepDays: t.u32(),
    clockOffsetSec: t.i64(),
    updatedAt: t.timestamp(),
  }
);

const placement = table(
  { name: 'promo_placement', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    layout: t.string(),
    maxItems: t.u8(),
    rotateSeconds: t.u8(),
    sponsorId: t.u64(),
    isActive: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const banner = table(
  { name: 'promo_banner' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    placementId: t.u64().index('btree'),
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
    sponsorId: t.u64().index('btree'),
    isActive: t.bool(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const bannerSeen = table(
  { name: 'promo_banner_seen' },
  {
    key: t.string().primaryKey(),
    bannerId: t.u64().index('btree'),
    accountId: t.u64(),
    day: t.string(),
    viewed: t.bool(),
    clicked: t.bool(),
    at: t.u64().index('btree'),
  }
);

const bannerDay = table(
  { name: 'promo_banner_day' },
  {
    key: t.string().primaryKey(),
    bannerId: t.u64().index('btree'),
    day: t.string(),
    views: t.u32(),
    clicks: t.u32(),
  }
);

const sponsor = table(
  { name: 'promo_sponsor' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
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
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const sponsorSeen = table(
  { name: 'promo_sponsor_seen' },
  {
    key: t.string().primaryKey(),
    sponsorId: t.u64().index('btree'),
    accountId: t.u64(),
    day: t.string(),
    viewed: t.bool(),
    clicked: t.bool(),
    at: t.u64().index('btree'),
  }
);

const sponsorDay = table(
  { name: 'promo_sponsor_day' },
  {
    key: t.string().primaryKey(),
    sponsorId: t.u64().index('btree'),
    day: t.string(),
    views: t.u32(),
    clicks: t.u32(),
    players: t.u32(),
  }
);

const sponsorTotal = table(
  { name: 'promo_sponsor_total' },
  {
    sponsorId: t.u64().primaryKey(),
    views: t.u64(),
    clicks: t.u64(),
  }
);

const sponsorPlayer = table(
  { name: 'promo_sponsor_player' },
  {
    key: t.string().primaryKey(),
    sponsorId: t.u64().index('btree'),
    accountId: t.u64(),
    firstDay: t.string(),
  }
);

const rate = table(
  { name: 'promo_rate' },
  {
    key: t.string().primaryKey(),
    minute: t.u64().index('btree'),
    count: t.u32(),
  }
);

const chanceGame = table(
  { name: 'promo_chance_game', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    kind: t.string(),
    name: Translations,
    description: Translations,
    metadata: t.string(),
    prizeType: t.string(),
    prize: t.array(ChanceSlot),
    intervalTime: t.u32(),
    freePlays: t.u32(),
    freePeriod: t.string(),
    price: t.option(TicketPrice),
    dailyLimit: t.u32(),
    totalLimit: t.u32(),
    isActive: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const chanceState = table(
  { name: 'promo_chance_state' },
  {
    key: t.string().primaryKey(),
    gameId: t.u64().index('btree'),
    accountId: t.u64().index('btree'),
    plays: t.u64(),
    lastFreeAt: t.u64(),
    lastPlayAt: t.u64(),
    day: t.string(),
    dayPlays: t.u32(),
    freeWindow: t.string(),
    freeWindowPlays: t.u32(),
  }
);

const chancePlay = table(
  { name: 'promo_chance_play' },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64().index('btree'),
    gameKey: t.string(),
    accountId: t.u64().index('btree'),
    mode: t.string(),
    status: t.string(),
    requestId: t.string(),
    roll: t.u32(),
    slot: t.i32(),
    prizeId: t.u64(),
    prizeGroupId: t.u64(),
    spent: t.string(),
    rewards: t.string(),
    error: t.string(),
    at: t.timestamp(),
  }
);

const request = table(
  { name: 'promo_request' },
  {
    key: t.string().primaryKey(),
    accountId: t.u64(),
    action: t.string(),
    detail: t.string(),
    result: t.string(),
    expiresAt: t.u64().index('btree'),
  }
);

const tickTimer = table(
  { name: 'promo_tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const promoTables = {
  promoSettings: settings,
  placement,
  banner,
  bannerSeen,
  bannerDay,
  sponsor,
  sponsorSeen,
  sponsorDay,
  sponsorTotal,
  sponsorPlayer,
  promoRate: rate,
  chanceGame,
  chanceState,
  chancePlay,
  promoRequest: request,
  promoTickTimer: tickTimer,
};

export const promoEnv = {};

export const promoRows = {
  settings: settings.rowType,
  banner: banner.rowType,
  sponsor: sponsor.rowType,
  chancePlay: chancePlay.rowType,
};

const allTables = { ...baseTables, ...playersTables, ...economyTables, ...gamificationTables, ...itemsTables, ...promoTables };
export type PromoSchema = ReturnType<typeof schema<typeof allTables, typeof baseEnv>>;
