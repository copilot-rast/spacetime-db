import { schema, table, t } from 'spacetimedb/server';
import { baseTables, baseEnv, Translations } from '@stg/base';
import { playersTables } from '@stg/players';
import { economyTables } from '@stg/economy';
import { gamificationTables } from '@stg/gamification';
import { itemsTables } from '@stg/items';
import { publicationTables } from '@stg/publication';

export const GiftCurrency = t.object('GiftCurrency', { currencyKey: t.string(), min: t.i64(), max: t.i64() });

const settings = table(
  { name: 'social_settings' },
  {
    id: t.u8().primaryKey(),
    chatEnabled: t.bool(),
    messageMaxLength: t.u32(),
    messagesPerMinute: t.u32(),
    dmPolicy: t.string(),
    groupsEnabled: t.bool(),
    groupMaxMembers: t.u32(),
    groupsPerPlayer: t.u32(),
    filterEnabled: t.bool(),
    filterReportTitle: t.string(),
    historyPageMax: t.u32(),
    liveMessages: t.u32(),
    wordsSeeded: t.bool(),
    clockOffsetSec: t.i64(),
    updatedAt: t.timestamp(),
  }
);

const friendSettings = table(
  { name: 'social_friend_settings' },
  {
    id: t.u8().primaryKey(),
    dailyRequests: t.u32(),
    maxFriends: t.u32(),
    expiryDays: t.u32(),
    rejectCooldownHours: t.u32(),
    matchPolicy: t.string(),
    requestsBonusMeta: t.string(),
    friendsBonusMeta: t.string(),
    overLimit: t.string(),
    updatedAt: t.timestamp(),
  }
);

const friendRule = table(
  { name: 'social_friend_rule' },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    tagIds: t.array(t.u64()),
    priority: t.i32(),
    dailyRequests: t.option(t.u32()),
    maxFriends: t.option(t.u32()),
    rejectCooldownHours: t.option(t.u32()),
    isActive: t.bool(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const edge = table(
  { name: 'social_edge' },
  {
    key: t.string().primaryKey(),
    accountId: t.u64().index('btree'),
    otherId: t.u64().index('btree'),
    state: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    expiresAt: t.u64(),
  }
);

const friendDay = table({ name: 'social_friend_day' }, { key: t.string().primaryKey(), count: t.u32() });

const rejection = table(
  { name: 'social_rejection' },
  {
    key: t.string().primaryKey(),
    requesterId: t.u64().index('btree'),
    rejecterId: t.u64(),
    at: t.u64(),
  }
);

const word = table(
  { name: 'social_word' },
  {
    id: t.u64().primaryKey().autoInc(),
    word: t.string(),
    normalized: t.string().unique(),
    action: t.string(),
    match: t.string(),
    isActive: t.bool(),
    note: t.string(),
    createdAt: t.timestamp(),
  }
);

const channel = table(
  { name: 'social_channel' },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string().index('btree'),
    key: t.string().unique(),
    title: Translations,
    description: Translations,
    name: t.string(),
    ownerId: t.u64(),
    isActive: t.bool(),
    sort: t.i32(),
    members: t.u32(),
    messageCount: t.u64(),
    lastMessageId: t.u64(),
    lastMessageAt: t.option(t.timestamp()),
    createdAt: t.timestamp(),
  }
);

const member = table(
  { name: 'social_member' },
  {
    key: t.string().primaryKey(),
    channelId: t.u64().index('btree'),
    accountId: t.u64().index('btree'),
    role: t.string(),
    lastReadId: t.u64(),
    joinedAt: t.timestamp(),
  }
);

const message = table(
  { name: 'social_message' },
  {
    id: t.u64().primaryKey().autoInc(),
    channelId: t.u64().index('btree'),
    senderId: t.u64().index('btree'),
    text: t.string(),
    original: t.string(),
    replyToId: t.u64(),
    status: t.string(),
    flagged: t.bool(),
    hits: t.array(t.string()),
    deletedBy: t.u64(),
    deletedAt: t.option(t.timestamp()),
    createdAt: t.timestamp(),
  }
);

const rate = table({ name: 'social_rate' }, { key: t.string().primaryKey(), minute: t.u64(), count: t.u32() });

const quotaSettings = table(
  { name: 'social_quota_settings' },
  {
    id: t.u8().primaryKey(),
    enabled: t.bool(),
    countMode: t.string(),
    dailyMessages: t.u32(),
    dailyConversations: t.u32(),
    conversationScope: t.string(),
    resetMinute: t.u16(),
    utcOffsetMinutes: t.i32(),
    countDirect: t.bool(),
    countGroups: t.bool(),
    countRooms: t.bool(),
    replyFree: t.string(),
    friendPolicy: t.string(),
    friendDailyMessages: t.u32(),
    friendDailyConversations: t.u32(),
    packMeta: t.string(),
    packExpiryDays: t.u32(),
    order: t.string(),
    packProducts: t.array(t.string()),
    bonusMeta: t.string(),
    matchPolicy: t.string(),
    unlimitedItems: t.array(t.string()),
    unlimitedMeta: t.string(),
    unlimitedMetaMode: t.string(),
    message: Translations,
    notice: t.string(),
    updatedAt: t.timestamp(),
  }
);

const quotaRule = table(
  { name: 'social_quota_rule' },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    tagIds: t.array(t.u64()),
    priority: t.i32(),
    unlimited: t.bool(),
    dailyMessages: t.option(t.u32()),
    dailyConversations: t.option(t.u32()),
    friendDailyMessages: t.option(t.u32()),
    friendDailyConversations: t.option(t.u32()),
    isActive: t.bool(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const quotaDay = table(
  { name: 'social_quota_day' },
  {
    key: t.string().primaryKey(),
    accountId: t.u64().index('btree'),
    day: t.i32(),
    messages: t.u32(),
    conversations: t.u32(),
    friendMessages: t.u32(),
    friendConversations: t.u32(),
    packUsed: t.u32(),
    freeSent: t.u32(),
    unlimitedSent: t.u32(),
    total: t.u32(),
    blocked: t.u32(),
    notified: t.bool(),
  }
);

const quotaTarget = table(
  { name: 'social_quota_target' },
  {
    key: t.string().primaryKey(),
    accountId: t.u64().index('btree'),
    target: t.string(),
    firstAt: t.u64(),
    lastAt: t.u64(),
    lastDay: t.i32(),
    replyOwed: t.bool(),
  }
);

const quotaLot = table(
  { name: 'social_quota_lot' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    amount: t.u32(),
    remaining: t.u32(),
    source: t.string(),
    note: t.string(),
    expiresAt: t.u64(),
    createdBy: t.u64(),
    createdAt: t.timestamp(),
  }
);

const giftSettings = table(
  { name: 'social_gift_settings' },
  {
    id: t.u8().primaryKey(),
    enabled: t.bool(),
    recipients: t.string(),
    minFriendDays: t.u32(),
    minMutualFriends: t.u32(),
    minSenderAccountDays: t.u32(),
    minRecipientAccountDays: t.u32(),
    minSenderLevel: t.u32(),
    levelTableId: t.u64(),
    inventoryEnabled: t.bool(),
    itemsDefault: t.bool(),
    equipped: t.string(),
    upgradeLevel: t.string(),
    regift: t.string(),
    itemRequirements: t.string(),
    currencyEnabled: t.bool(),
    currencies: t.array(GiftCurrency),
    shopEnabled: t.bool(),
    productsDefault: t.bool(),
    methods: t.array(t.string()),
    discountCodes: t.bool(),
    perSenderDaily: t.u32(),
    perRecipientDaily: t.u32(),
    perPairDaily: t.u32(),
    matchPolicy: t.string(),
    sendBonusMeta: t.string(),
    receiveBonusMeta: t.string(),
    delivery: t.string(),
    expiryHours: t.u32(),
    onExpiry: t.string(),
    coinReturn: t.string(),
    moneyReturn: t.string(),
    senderCancel: t.bool(),
    messageEnabled: t.bool(),
    messageMaxLength: t.u32(),
    messageFilter: t.string(),
    notify: t.string(),
    notifySender: t.bool(),
    updatedAt: t.timestamp(),
  }
);

const giftRule = table(
  { name: 'social_gift_rule' },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    tagIds: t.array(t.u64()),
    priority: t.i32(),
    perSenderDaily: t.option(t.u32()),
    perRecipientDaily: t.option(t.u32()),
    perPairDaily: t.option(t.u32()),
    canSend: t.bool(),
    isActive: t.bool(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const giftable = table(
  { name: 'social_giftable' },
  {
    key: t.string().primaryKey(),
    kind: t.string(),
    refKey: t.string(),
    giftable: t.bool(),
    updatedAt: t.timestamp(),
  }
);

const gift = table(
  { name: 'social_gift' },
  {
    id: t.u64().primaryKey().autoInc(),
    senderId: t.u64().index('btree'),
    recipientId: t.u64().index('btree'),
    source: t.string(),
    kind: t.string(),
    itemKey: t.string(),
    itemLevel: t.u32(),
    quantity: t.u32(),
    currencyKey: t.string(),
    amount: t.i64(),
    productId: t.u64(),
    prizeId: t.u64(),
    paymentId: t.u64().index('btree'),
    method: t.string(),
    coinCurrency: t.string(),
    coinAmount: t.i64(),
    message: t.string(),
    messageFlagged: t.bool(),
    delivery: t.string(),
    status: t.string().index('btree'),
    outcome: t.string(),
    error: t.string(),
    requestId: t.string(),
    day: t.i32(),
    rewards: t.string(),
    createdAt: t.timestamp(),
    expiresAt: t.u64(),
    deliveredAt: t.u64(),
    respondedAt: t.u64(),
    reversedAt: t.u64(),
    reversedBy: t.u64(),
    reverseNote: t.string(),
  }
);

const giftRequest = table({ name: 'social_gift_request' }, { key: t.string().primaryKey(), giftId: t.u64(), detail: t.string() });

const giftDay = table({ name: 'social_gift_day' }, { key: t.string().primaryKey(), count: t.u32() });

const tickTimer = table(
  { name: 'social_tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const socialTables = {
  socialSettings: settings,
  friendSettings,
  friendRule,
  edge,
  friendDay,
  rejection,
  chatWord: word,
  channel,
  member,
  chatMessage: message,
  socialRate: rate,
  quotaSettings,
  quotaRule,
  quotaDay,
  quotaTarget,
  quotaLot,
  giftSettings,
  giftRule,
  giftable,
  friendGift: gift,
  giftRequest,
  giftDay,
  socialTickTimer: tickTimer,
};

export const socialEnv = {};

export const socialRows = {
  settings: settings.rowType,
  friendSettings: friendSettings.rowType,
  friendRule: friendRule.rowType,
  word: word.rowType,
  channel: channel.rowType,
  message: message.rowType,
  quotaSettings: quotaSettings.rowType,
  quotaRule: quotaRule.rowType,
  quotaDay: quotaDay.rowType,
  quotaLot: quotaLot.rowType,
  giftSettings: giftSettings.rowType,
  giftRule: giftRule.rowType,
  giftable: giftable.rowType,
  gift: gift.rowType,
};

const allTables = { ...baseTables, ...playersTables, ...economyTables, ...gamificationTables, ...itemsTables, ...publicationTables, ...socialTables };
export type SocialSchema = ReturnType<typeof schema<typeof allTables, typeof baseEnv>>;
