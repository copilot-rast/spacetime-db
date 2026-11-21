import { schema, table, t } from 'spacetimedb/server';
import { baseTables, baseEnv, Translations } from '@stg/base';

const StoreLink = t.object('StoreLink', { store: t.string(), url: t.string(), label: Translations });
const ReportNote = t.object('ReportNote', { by: t.u64(), at: t.timestamp(), text: t.string() });

const accountRules = table(
  { name: 'players_account_rules', public: true },
  {
    id: t.u8().primaryKey(),
    displayNameMin: t.u8(),
    displayNameMax: t.u8(),
    displayNameCharset: t.string(),
    displayNameUnique: t.bool(),
    updatedAt: t.timestamp(),
  }
);

const appVersion = table(
  { name: 'players_app_version', public: true },
  {
    platform: t.string().primaryKey(),
    latestVersion: t.string(),
    minVersion: t.string(),
    storeLinks: t.array(StoreLink),
    updateMessage: Translations,
    forceMessage: Translations,
    isActive: t.bool(),
    updatedAt: t.timestamp(),
  }
);

const country = table(
  { name: 'players_country', public: true },
  {
    code: t.string().primaryKey(),
    name: Translations,
    dialCode: t.string(),
    flagUrl: t.string(),
    isActive: t.bool(),
    sort: t.i32(),
  }
);

const profile = table(
  { name: 'players_profile' },
  {
    accountId: t.u64().primaryKey(),
    countryCode: t.string(),
    updatedAt: t.timestamp(),
  }
);

const tagMeta = table(
  { name: 'players_tag_meta', public: true },
  {
    tagId: t.u64().primaryKey(),
    isPublic: t.bool(),
  }
);

const userTag = table(
  {
    name: 'players_user_tag',
    indexes: [{ accessor: 'byAccountTag', algorithm: 'btree', columns: ['accountId', 'tagId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    tagId: t.u64().index('btree'),
    createdBy: t.u64(),
    createdAt: t.timestamp(),
  }
);

const restriction = table(
  { name: 'players_restriction' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    kind: t.string(),
    status: t.string().index('btree'),
    startsAt: t.timestamp(),
    endsAt: t.timestamp(),
    reason: Translations,
    note: t.string(),
    reportId: t.u64(),
    createdBy: t.u64(),
    createdAt: t.timestamp(),
    liftedBy: t.u64(),
    liftedAt: t.option(t.timestamp()),
    liftNote: t.string(),
  }
);

const reportTitle = table(
  { name: 'players_report_title', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    isActive: t.bool(),
    sort: t.i32(),
  }
);

const report = table(
  { name: 'players_report' },
  {
    id: t.u64().primaryKey().autoInc(),
    reporterId: t.u64().index('btree'),
    targetId: t.u64().index('btree'),
    titleId: t.u64(),
    titleKey: t.string(),
    titleName: Translations,
    note: t.string(),
    matchId: t.string(),
    contentId: t.string(),
    gameKey: t.string(),
    status: t.string(),
    reviewerId: t.u64(),
    reviewStartedAt: t.option(t.timestamp()),
    notes: t.array(ReportNote),
    action: t.string(),
    restrictionId: t.u64(),
    resolvedBy: t.u64(),
    resolvedAt: t.option(t.timestamp()),
    resolutionNote: t.string(),
    createdAt: t.timestamp(),
  }
);

const reportRules = table(
  { name: 'players_report_rules' },
  {
    id: t.u8().primaryKey(),
    perHour: t.u32(),
    duplicateHours: t.u32(),
    minAccountHours: t.u32(),
    noteRequired: t.bool(),
    trustedTagIds: t.array(t.u64()),
    trustedPerHour: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const reportRate = table(
  { name: 'players_report_rate' },
  {
    key: t.string().primaryKey(),
    count: t.u32(),
  }
);

const expireTimer = table(
  { name: 'players_expire_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const playersTables = {
  accountRules,
  appVersion,
  country,
  profile,
  tagMeta,
  userTag,
  restriction,
  reportTitle,
  report,
  reportRules,
  reportRate,
  expireTimer,
};

export const playersEnv = {};

export const playersRows = {
  restriction: restriction.rowType,
  report: report.rowType,
  reportRules: reportRules.rowType,
  profile: profile.rowType,
};

export { StoreLink, ReportNote };

const allTables = { ...baseTables, ...playersTables };
export type PlayersSchema = ReturnType<typeof schema<typeof allTables, typeof baseEnv>>;
