import { schema, table, t } from 'spacetimedb/server';
import { baseTables, baseEnv, Translations } from '@stg/base';
import { playersTables } from '@stg/players';
import { economyTables } from '@stg/economy';
import { gamificationTables } from '@stg/gamification';
import { publicationTables } from '@stg/publication';

export const Attachment = t.object('SupportAttachment', { url: t.string(), name: t.string(), type: t.string(), size: t.u32() });

export const ConfigRule = t.object('ConfigRule', {
  name: t.string(),
  value: t.string(),
  text: Translations,
  platforms: t.array(t.string()),
  minVersion: t.string(),
  maxVersion: t.string(),
  tagIds: t.array(t.u64()),
  countries: t.array(t.string()),
  percent: t.f64(),
});

const settings = table(
  { name: 'support_settings' },
  {
    id: t.u8().primaryKey(),
    maxOpenTickets: t.u32(),
    ticketsPerHour: t.u32(),
    messagesPerHour: t.u32(),
    maxAttachments: t.u32(),
    maxAttachmentKb: t.u32(),
    autoCloseDays: t.u32(),
    chatEnabled: t.bool(),
    chatGreeting: Translations,
    chatOffline: Translations,
    chatIdleMinutes: t.u32(),
    chatMessagesPerMinute: t.u32(),
    chatsPerHour: t.u32(),
    agentOnlineSeconds: t.u32(),
    activityRetentionDays: t.u32(),
    notifyCategoryKey: t.string(),
    clockOffsetSec: t.i64(),
    updatedAt: t.timestamp(),
  }
);

const department = table(
  { name: 'support_department' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    firstResponseHours: t.u32(),
    agentIds: t.array(t.u64()),
    autoAssign: t.bool(),
    isActive: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
  }
);

const canned = table(
  { name: 'support_canned' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    title: Translations,
    body: Translations,
    departmentId: t.u64(),
    isActive: t.bool(),
    sort: t.i32(),
    updatedAt: t.timestamp(),
  }
);

const ticket = table(
  { name: 'support_ticket' },
  {
    id: t.u64().primaryKey().autoInc(),
    number: t.string().unique(),
    accountId: t.u64().index('btree'),
    subject: t.string(),
    departmentId: t.u64(),
    priority: t.string(),
    status: t.string().index('btree'),
    assigneeId: t.u64().index('btree'),
    source: t.string(),
    chatId: t.u64(),
    messageCount: t.u32(),
    lastMessage: t.string(),
    lastPlayerMessageAt: t.u64(),
    lastStaffMessageAt: t.u64(),
    playerSeenAt: t.u64(),
    dueAt: t.u64(),
    firstResponseAt: t.u64(),
    statusAt: t.u64(),
    resolvedAt: t.u64(),
    closedAt: t.u64(),
    rating: t.u8(),
    ratingComment: t.string(),
    ratedAt: t.u64(),
    createdAt: t.u64(),
    updatedAt: t.u64(),
  }
);

const ticketMessage = table(
  { name: 'support_message' },
  {
    id: t.u64().primaryKey().autoInc(),
    ticketId: t.u64().index('btree'),
    kind: t.string(),
    authorType: t.string(),
    authorId: t.u64(),
    body: t.string(),
    attachments: t.array(Attachment),
    event: t.string(),
    eventData: t.string(),
    at: t.u64(),
  }
);

const chat = table(
  { name: 'support_chat' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    status: t.string().index('btree'),
    departmentId: t.u64(),
    topic: t.string(),
    agentId: t.u64().index('btree'),
    lastSeq: t.u32(),
    playerReadSeq: t.u32(),
    agentReadSeq: t.u32(),
    playerTypingAt: t.u64(),
    agentTypingAt: t.u64(),
    playerSeenAt: t.u64(),
    lastMessageAt: t.u64(),
    ticketId: t.u64(),
    rating: t.u8(),
    ratingComment: t.string(),
    closedBy: t.string(),
    createdAt: t.u64(),
    takenAt: t.u64(),
    closedAt: t.u64(),
  }
);

const chatMessage = table(
  { name: 'support_chat_message' },
  {
    id: t.u64().primaryKey().autoInc(),
    chatId: t.u64().index('btree'),
    seq: t.u32(),
    authorType: t.string(),
    authorId: t.u64(),
    body: t.string(),
    event: t.string(),
    at: t.u64(),
  }
);

const agent = table(
  { name: 'support_agent' },
  {
    accountId: t.u64().primaryKey(),
    lastSeenAt: t.u64(),
    away: t.bool(),
    focusTicketId: t.u64(),
    focusChatId: t.u64(),
  }
);

const rate = table(
  { name: 'support_rate' },
  {
    key: t.string().primaryKey(),
    bucket: t.u64().index('btree'),
    count: t.u32(),
  }
);

const tickTimer = table(
  { name: 'support_tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const refSettings = table(
  { name: 'referral_settings' },
  {
    id: t.u8().primaryKey(),
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
    updatedAt: t.timestamp(),
  }
);

const refCode = table(
  { name: 'referral_code' },
  {
    accountId: t.u64().primaryKey(),
    code: t.string().unique(),
    createdAt: t.timestamp(),
  }
);

const referral = table(
  { name: 'referral' },
  {
    id: t.u64().primaryKey().autoInc(),
    referrerId: t.u64().index('btree'),
    refereeId: t.u64().unique(),
    code: t.string(),
    status: t.string().index('btree'),
    flags: t.array(t.string()),
    referrerPrizeId: t.u64(),
    refereePrizeId: t.u64(),
    goalEventKey: t.string(),
    goalMeasure: t.string(),
    goalValue: t.f64(),
    device: t.string(),
    referrerClaimId: t.u64(),
    refereeClaimId: t.u64(),
    decidedBy: t.u64(),
    decidedAt: t.u64(),
    note: t.string(),
    createdAt: t.u64(),
    completedAt: t.u64(),
  }
);

const refMark = table(
  { name: 'referral_mark' },
  {
    key: t.string().primaryKey(),
    referralId: t.u64(),
    at: t.timestamp(),
  }
);

const configKey = table(
  { name: 'config_key' },
  {
    key: t.string().primaryKey(),
    type: t.string(),
    description: t.string(),
    value: t.string(),
    text: Translations,
    rules: t.array(ConfigRule),
    isActive: t.bool(),
    version: t.u32(),
    updatedBy: t.u64(),
    updatedAt: t.timestamp(),
  }
);

const configHistory = table(
  { name: 'config_history' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().index('btree'),
    version: t.u32(),
    action: t.string(),
    snapshot: t.string(),
    by: t.u64(),
    at: t.timestamp(),
  }
);

const client = table(
  { name: 'config_client' },
  {
    accountId: t.u64().primaryKey(),
    platform: t.string(),
    appVersion: t.string(),
    updatedAt: t.timestamp(),
  }
);

const configSeen = table(
  { name: 'config_seen' },
  {
    accountId: t.u64().primaryKey(),
    hash: t.string(),
    variants: t.string(),
  }
);

const activity = table(
  { name: 'player_activity' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    kind: t.string(),
    action: t.string(),
    refId: t.string(),
    data: t.string(),
    actor: t.string(),
    device: t.string(),
    platform: t.string(),
    country: t.string(),
    at: t.u64(),
  }
);

export const supportTables = {
  supSettings: settings,
  supDepartment: department,
  supCanned: canned,
  supTicket: ticket,
  supTicketMessage: ticketMessage,
  supChat: chat,
  supChatMessage: chatMessage,
  supAgent: agent,
  supRate: rate,
  supTickTimer: tickTimer,
  refSettings,
  refCode,
  referral,
  refMark,
  configKey,
  configHistory,
  supClient: client,
  configSeen,
  playerActivity: activity,
};

export const supportEnv = {};

export const supRows = {
  settings: settings.rowType,
  department: department.rowType,
  canned: canned.rowType,
  ticket: ticket.rowType,
  ticketMessage: ticketMessage.rowType,
  chat: chat.rowType,
  chatMessage: chatMessage.rowType,
  refSettings: refSettings.rowType,
  referral: referral.rowType,
  configKey: configKey.rowType,
  configHistory: configHistory.rowType,
  activity: activity.rowType,
};

const allTables = { ...baseTables, ...playersTables, ...economyTables, ...gamificationTables, ...publicationTables, ...supportTables };
export type SupportSchema = ReturnType<typeof schema<typeof allTables, typeof baseEnv>>;
