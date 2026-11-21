import { schema, table, t } from 'spacetimedb/server';

export const Translation = t.object('Translation', { lang: t.string(), text: t.string() });
export const Translations = t.array(Translation);

export const ROLES = ['owner', 'admin', 'operator'] as const;
export type Role = (typeof ROLES)[number];

const account = table(
  { name: 'base_account' },
  {
    id: t.u64().primaryKey().autoInc(),
    phone: t.string().unique(),
    displayName: t.string(),
    lang: t.string(),
    status: t.string(),
    createdAt: t.timestamp(),
    lastLoginAt: t.timestamp(),
  }
);

const session = table(
  { name: 'base_session' },
  {
    identity: t.identity().primaryKey(),
    accountId: t.u64().index('btree'),
    createdAt: t.timestamp(),
  }
);

const otp = table(
  { name: 'base_otp' },
  {
    phone: t.string().primaryKey(),
    codeHash: t.string(),
    sentAt: t.timestamp(),
    expiresAt: t.timestamp(),
    attempts: t.u32(),
  }
);

const otpDaily = table(
  { name: 'base_otp_daily' },
  {
    key: t.string().primaryKey(),
    count: t.u32(),
  }
);

const testPhone = table(
  { name: 'base_test_phone' },
  {
    phone: t.string().primaryKey(),
    code: t.string(),
    note: t.string(),
  }
);

const sandboxSms = table(
  { name: 'base_sandbox_sms' },
  {
    id: t.u64().primaryKey().autoInc(),
    phone: t.string().index('btree'),
    text: t.string(),
    at: t.timestamp(),
  }
);

const admin = table(
  { name: 'base_admin' },
  {
    accountId: t.u64().primaryKey(),
    role: t.string(),
    createdAt: t.timestamp(),
    createdBy: t.u64(),
  }
);

const smsProvider = table(
  { name: 'base_sms_provider' },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string(),
    name: t.string(),
    isActive: t.bool(),
    apiKey: t.string(),
    sender: t.string(),
    otpTemplate: t.string(),
    otpCodeVar: t.string(),
    updatedAt: t.timestamp(),
  }
);

const settings = table(
  { name: 'base_settings' },
  {
    id: t.u8().primaryKey(),
    otpLength: t.u8(),
    otpTtlSec: t.u32(),
    otpResendSec: t.u32(),
    otpMaxAttempts: t.u8(),
    otpDailyCap: t.u32(),
    defaultLang: t.string(),
    setupDone: t.bool(),
    updatedAt: t.timestamp(),
  }
);

const brand = table(
  { name: 'base_brand', public: true },
  {
    id: t.u8().primaryKey(),
    name: Translations,
    shortName: t.string(),
    logoUrl: t.string(),
    iconUrl: t.string(),
    primaryColor: t.string(),
    supportPhone: t.string(),
    supportEmail: t.string(),
    website: t.string(),
    updatedAt: t.timestamp(),
  }
);

const language = table(
  { name: 'base_language', public: true },
  {
    code: t.string().primaryKey(),
    name: t.string(),
    dir: t.string(),
    isActive: t.bool(),
    isDefault: t.bool(),
    sort: t.i32(),
  }
);

const keyType = table(
  { name: 'base_key_type', public: true },
  {
    key: t.string().primaryKey(),
    title: Translations,
    forCategory: t.bool(),
    forTag: t.bool(),
    system: t.bool(),
  }
);

const category = table(
  {
    name: 'base_category',
    public: true,
    indexes: [{ accessor: 'byTypeKey', algorithm: 'btree', columns: ['keyType', 'key'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    keyType: t.string(),
    key: t.string(),
    title: Translations,
    description: Translations,
    parentId: t.u64().index('btree'),
    iconUrl: t.string(),
    sort: t.i32(),
    isActive: t.bool(),
    createdAt: t.timestamp(),
  }
);

const tag = table(
  {
    name: 'base_tag',
    public: true,
    indexes: [{ accessor: 'byTypeKey', algorithm: 'btree', columns: ['keyType', 'key'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    keyType: t.string(),
    key: t.string(),
    title: Translations,
    color: t.string(),
    sort: t.i32(),
    isActive: t.bool(),
    createdAt: t.timestamp(),
  }
);

const audit = table(
  { name: 'base_audit' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    action: t.string(),
    target: t.string(),
    detail: t.string(),
    at: t.timestamp(),
  }
);

export const baseTables = {
  account,
  session,
  otp,
  otpDaily,
  testPhone,
  sandboxSms,
  admin,
  smsProvider,
  settings,
  brand,
  language,
  keyType,
  category,
  tag,
  audit,
};

export const baseEnv = {
  OTP_SECRET: t.string(),
  ADMIN_PHONES: t.string().optional(),
};

export const baseRows = {
  account: account.rowType,
  admin: admin.rowType,
  settings: settings.rowType,
  brand: brand.rowType,
  smsProvider: smsProvider.rowType,
  testPhone: testPhone.rowType,
  sandboxSms: sandboxSms.rowType,
  audit: audit.rowType,
};

export type BaseSchema = ReturnType<typeof schema<typeof baseTables, typeof baseEnv>>;
