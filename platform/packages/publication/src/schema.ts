import { schema, table, t } from 'spacetimedb/server';
import { baseTables, baseEnv, Translations } from '@stg/base';
import { playersTables } from '@stg/players';
import { economyTables } from '@stg/economy';
import { gamificationTables } from '@stg/gamification';

const settings = table(
  { name: 'pub_settings' },
  {
    id: t.u8().primaryKey(),
    inboxKeepDays: t.u32(),
    inboxMaxPerPlayer: t.u32(),
    maxDevices: t.u32(),
    devicePerMinute: t.u32(),
    prefsPerMinute: t.u32(),
    inboxPerMinute: t.u32(),
    batchSize: t.u32(),
    batchesPerTick: t.u32(),
    capPerDay: t.u32(),
    capPerWeek: t.u32(),
    pushRetries: t.u32(),
    smsMaxChars: t.u32(),
    liveNoticeMinutes: t.u32(),
    inactiveScanMinutes: t.u32(),
    clockOffsetSec: t.i64(),
    updatedAt: t.timestamp(),
  }
);

const pushConfig = table(
  { name: 'pub_push_config' },
  {
    id: t.u8().primaryKey(),
    provider: t.string(),
    projectId: t.string(),
    clientEmail: t.string(),
    privateKeyId: t.string(),
    privateKey: t.string(),
    updatedAt: t.timestamp(),
  }
);

const pushToken = table(
  { name: 'pub_push_token' },
  {
    id: t.u8().primaryKey(),
    keyHash: t.string(),
    accessToken: t.string(),
    expiresAt: t.u64(),
  }
);

const category = table(
  { name: 'pub_category', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    mandatory: t.bool(),
    defaultOn: t.bool(),
    isActive: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
  }
);

const pref = table(
  { name: 'pub_pref' },
  {
    key: t.string().primaryKey(),
    accountId: t.u64().index('btree'),
    categoryKey: t.string(),
    channel: t.string(),
    enabled: t.bool(),
    updatedAt: t.timestamp(),
  }
);

const inbox = table(
  { name: 'pub_inbox' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    kind: t.string(),
    campaignId: t.u64().index('btree'),
    ruleId: t.u64(),
    newsId: t.u64(),
    categoryKey: t.string(),
    title: Translations,
    body: Translations,
    imageUrl: t.string(),
    actionType: t.string(),
    actionValue: t.string(),
    actionLabel: Translations,
    prizeId: t.u64(),
    claimedAt: t.u64(),
    rewards: t.string(),
    read: t.bool(),
    readAt: t.u64(),
    at: t.u64().index('btree'),
    createdAt: t.timestamp(),
  }
);

const device = table(
  { name: 'pub_device' },
  {
    id: t.u64().primaryKey().autoInc(),
    token: t.string().unique(),
    accountId: t.u64().index('btree'),
    platform: t.string(),
    appVersion: t.string(),
    deviceKey: t.string(),
    isActive: t.bool(),
    failCount: t.u32(),
    lastError: t.string(),
    createdAt: t.timestamp(),
    lastSeenAt: t.u64(),
  }
);

const outbox = table(
  { name: 'pub_outbox' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    channel: t.string(),
    kind: t.string(),
    inboxId: t.u64(),
    campaignId: t.u64().index('btree'),
    ruleId: t.u64(),
    categoryKey: t.string(),
    lang: t.string(),
    title: t.string(),
    body: t.string(),
    imageUrl: t.string(),
    data: t.string(),
    status: t.string().index('btree'),
    attempts: t.u32(),
    nextAt: t.u64(),
    devices: t.u32(),
    sent: t.u32(),
    error: t.string(),
    createdAt: t.timestamp(),
    doneAt: t.u64(),
  }
);

const pushLog = table(
  { name: 'pub_push_log' },
  {
    id: t.u64().primaryKey().autoInc(),
    outboxId: t.u64().index('btree'),
    deviceId: t.u64(),
    accountId: t.u64().index('btree'),
    provider: t.string(),
    token: t.string(),
    title: t.string(),
    body: t.string(),
    status: t.string(),
    error: t.string(),
    at: t.timestamp(),
  }
);

const campaign = table(
  { name: 'pub_campaign' },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string(),
    name: t.string(),
    categoryKey: t.string(),
    channels: t.array(t.string()),
    title: Translations,
    body: Translations,
    imageUrl: t.string(),
    actionType: t.string(),
    actionValue: t.string(),
    actionLabel: Translations,
    prizeId: t.u64(),
    newsId: t.u64(),
    target: t.string(),
    accountIds: t.array(t.u64()),
    tagIds: t.array(t.u64()),
    excludeTagIds: t.array(t.u64()),
    levelTableId: t.u64(),
    minLevel: t.u32(),
    maxLevel: t.u32(),
    countries: t.array(t.string()),
    inactiveDays: t.u32(),
    schedule: t.string(),
    scheduledAt: t.u64(),
    repeatMinutes: t.u32(),
    repeatUntil: t.u64(),
    quietStart: t.u16(),
    quietEnd: t.u16(),
    status: t.string().index('btree'),
    run: t.u32(),
    runStartedAt: t.u64(),
    nextAt: t.u64(),
    cursor: t.u64(),
    batches: t.u32(),
    recipients: t.u32(),
    sent: t.u32(),
    skipped: t.u32(),
    failed: t.u32(),
    inboxCount: t.u32(),
    pushSent: t.u32(),
    pushFailed: t.u32(),
    smsSent: t.u32(),
    opened: t.u32(),
    createdBy: t.u64(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    finishedAt: t.u64(),
  }
);

const delivery = table(
  { name: 'pub_delivery' },
  {
    key: t.string().primaryKey(),
    campaignId: t.u64().index('btree'),
    run: t.u32(),
    accountId: t.u64().index('btree'),
    status: t.string(),
    reason: t.string(),
    channels: t.array(t.string()),
    inboxId: t.u64(),
    at: t.u64(),
  }
);

const cap = table(
  { name: 'pub_cap' },
  {
    key: t.string().primaryKey(),
    accountId: t.u64().index('btree'),
    day: t.u32(),
    count: t.u32(),
  }
);

const autoRule = table(
  { name: 'pub_auto_rule' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: t.string(),
    trigger: t.string(),
    eventKey: t.string().index('btree'),
    matchField: t.string(),
    matchValue: t.string(),
    inactiveDays: t.u32(),
    channels: t.array(t.string()),
    categoryKey: t.string(),
    title: Translations,
    body: Translations,
    imageUrl: t.string(),
    actionType: t.string(),
    actionValue: t.string(),
    actionLabel: Translations,
    prizeId: t.u64(),
    cooldownMinutes: t.u32(),
    quietStart: t.u16(),
    quietEnd: t.u16(),
    isActive: t.bool(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const autoFire = table(
  { name: 'pub_auto_fire' },
  {
    key: t.string().primaryKey(),
    ruleId: t.u64().index('btree'),
    accountId: t.u64().index('btree'),
    occurrence: t.string(),
    status: t.string().index('btree'),
    reason: t.string(),
    vars: t.string(),
    dueAt: t.u64(),
    inboxId: t.u64(),
    at: t.u64(),
    doneAt: t.u64(),
  }
);

const autoLast = table(
  { name: 'pub_auto_last' },
  {
    key: t.string().primaryKey(),
    at: t.u64(),
  }
);

const state = table(
  { name: 'pub_state' },
  {
    id: t.u8().primaryKey(),
    lastInactiveScan: t.u64(),
    lastSweep: t.u64(),
  }
);

const rate = table(
  { name: 'pub_rate' },
  {
    key: t.string().primaryKey(),
    minute: t.u64().index('btree'),
    count: t.u32(),
  }
);

const tickTimer = table(
  { name: 'pub_tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const liveNotice = table(
  { name: 'pub_live_notice', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    event: t.string(),
    newsId: t.u64(),
    title: Translations,
    at: t.timestamp(),
  }
);

const newsSettings = table(
  { name: 'pub_news_settings' },
  {
    id: t.u8().primaryKey(),
    commentsPerMinute: t.u32(),
    reactionsPerMinute: t.u32(),
    listPerMinute: t.u32(),
    unreadScope: t.string(),
    showExpired: t.bool(),
    fillDefaultLang: t.bool(),
    realtimeOnPublish: t.bool(),
    notifyCategoryKey: t.string(),
    logRetentionDays: t.u32(),
    logPayloadBytes: t.u32(),
    ingestMaxKb: t.u32(),
    slugStyle: t.string(),
    publicEnabled: t.bool(),
    publicBaseUrl: t.string(),
    publicPath: t.string(),
    rssEnabled: t.bool(),
    publicCacheSeconds: t.u32(),
    siteTitle: Translations,
    updatedAt: t.timestamp(),
  }
);

const news = table(
  { name: 'pub_news' },
  {
    id: t.u64().primaryKey().autoInc(),
    slug: t.string().unique(),
    status: t.string().index('btree'),
    categoryId: t.u64(),
    tagIds: t.array(t.u64()),
    title: Translations,
    summary: Translations,
    body: Translations,
    coverUrl: t.string(),
    isPinned: t.bool(),
    publishedAt: t.u64(),
    expiresAt: t.u64(),
    allowComment: t.bool(),
    freeComment: t.bool(),
    allowReaction: t.bool(),
    notifyMode: t.string(),
    notifyTagIds: t.array(t.u64()),
    notifiedAt: t.u64(),
    campaignId: t.u64(),
    source: t.string(),
    externalKey: t.string().index('btree'),
    sourceUrl: t.string(),
    contentHash: t.string(),
    lang: t.string(),
    metaTitle: Translations,
    metaDescription: Translations,
    keywords: t.array(t.string()),
    canonicalUrl: t.string(),
    ogImage: t.string(),
    noindex: t.bool(),
    approvedBy: t.u64(),
    approvedAt: t.u64(),
    rejectReason: t.string(),
    createdBy: t.u64(),
    updatedBy: t.u64(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const newsSeen = table(
  { name: 'pub_news_seen' },
  {
    key: t.string().primaryKey(),
    newsId: t.u64().index('btree'),
    accountId: t.u64().index('btree'),
    at: t.u64(),
  }
);

const reactionType = table(
  { name: 'pub_reaction_type', public: true },
  {
    key: t.string().primaryKey(),
    emoji: t.string(),
    name: Translations,
    isActive: t.bool(),
    sort: t.i32(),
  }
);

const newsReaction = table(
  { name: 'pub_news_reaction' },
  {
    key: t.string().primaryKey(),
    newsId: t.u64().index('btree'),
    accountId: t.u64(),
    reaction: t.string().index('btree'),
    at: t.u64(),
  }
);

const newsComment = table(
  { name: 'pub_news_comment' },
  {
    id: t.u64().primaryKey().autoInc(),
    newsId: t.u64().index('btree'),
    accountId: t.u64().index('btree'),
    parentId: t.u64(),
    message: t.string(),
    status: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const newsSource = table(
  { name: 'pub_news_source' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: t.string(),
    isActive: t.bool(),
    authMode: t.string(),
    tokenHeader: t.string(),
    signatureHeader: t.string(),
    timestampHeader: t.string(),
    skewSeconds: t.u32(),
    secret: t.string(),
    itemsPath: t.string(),
    mapping: t.string(),
    bodyFormat: t.string(),
    defaultCategoryId: t.u64(),
    defaultLang: t.string(),
    defaultTagIds: t.array(t.u64()),
    publishMode: t.string(),
    updateMode: t.string(),
    rateLimitPerMinute: t.u32(),
    notifyMode: t.string(),
    allowComment: t.bool(),
    allowReaction: t.bool(),
    lastReceivedAt: t.u64(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const ingestLog = table(
  { name: 'pub_ingest_log' },
  {
    id: t.u64().primaryKey().autoInc(),
    sourceId: t.u64().index('btree'),
    status: t.string(),
    httpStatus: t.u16(),
    code: t.string(),
    created: t.u32(),
    updated: t.u32(),
    unchanged: t.u32(),
    ignored: t.u32(),
    failed: t.u32(),
    results: t.string(),
    body: t.string(),
    at: t.timestamp(),
  }
);

const ingestReplay = table(
  { name: 'pub_ingest_replay' },
  {
    key: t.string().primaryKey(),
    expiresAt: t.u64().index('btree'),
  }
);

const faq = table(
  { name: 'pub_faq' },
  {
    id: t.u64().primaryKey().autoInc(),
    categoryId: t.u64(),
    question: Translations,
    answer: Translations,
    answerHtml: Translations,
    isActive: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

export const publicationTables = {
  pubSettings: settings,
  pushConfig,
  pushToken,
  notifyCategory: category,
  notifyPref: pref,
  inbox,
  pushDevice: device,
  outbox,
  pushLog,
  campaign,
  delivery,
  notifyCap: cap,
  autoRule,
  autoFire,
  autoLast,
  pubState: state,
  pubRate: rate,
  pubTickTimer: tickTimer,
  liveNotice,
  newsSettings,
  news,
  newsSeen,
  reactionType,
  newsReaction,
  newsComment,
  newsSource,
  ingestLog,
  ingestReplay,
  faq,
};

export const publicationEnv = {};

export const pubRows = {
  settings: settings.rowType,
  campaign: campaign.rowType,
  delivery: delivery.rowType,
  autoRule: autoRule.rowType,
  autoFire: autoFire.rowType,
  pushLog: pushLog.rowType,
  outbox: outbox.rowType,
  news: news.rowType,
  newsSettings: newsSettings.rowType,
  newsComment: newsComment.rowType,
  ingestLog: ingestLog.rowType,
  faq: faq.rowType,
  device: device.rowType,
};

const allTables = { ...baseTables, ...playersTables, ...economyTables, ...gamificationTables, ...publicationTables };
export type PublicationSchema = ReturnType<typeof schema<typeof allTables, typeof baseEnv>>;
