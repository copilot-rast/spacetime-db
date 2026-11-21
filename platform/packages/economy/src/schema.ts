import { schema, table, t } from 'spacetimedb/server';
import { baseTables, baseEnv, Translations } from '@stg/base';
import { playersTables } from '@stg/players';

export const PrizeItem = t.object('PrizeItem', {
  type: t.string(),
  key: t.string(),
  action: t.string(),
  value: t.f64(),
});

export const GroupEntry = t.object('PrizeGroupEntry', { prizeId: t.u64(), weight: t.u32() });

const currency = table(
  { name: 'economy_currency', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    type: t.string(),
    defaultValue: t.i64(),
    iconUrl: t.string(),
    categoryId: t.u64(),
    tagIds: t.array(t.u64()),
    sort: t.i32(),
    isActive: t.bool(),
    createdAt: t.timestamp(),
  }
);

const wallet = table(
  {
    name: 'economy_wallet',
    indexes: [{ accessor: 'byAccountCurrency', algorithm: 'btree', columns: ['accountId', 'currencyKey'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    currencyKey: t.string(),
    balance: t.i64(),
    updatedAt: t.timestamp(),
  }
);

const ledger = table(
  { name: 'economy_ledger' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    currencyKey: t.string(),
    delta: t.i64(),
    balanceAfter: t.i64(),
    reason: t.string(),
    sourceType: t.string(),
    sourceId: t.string(),
    at: t.timestamp(),
  }
);

const currencyInit = table({ name: 'economy_currency_init' }, { key: t.string().primaryKey() });

const meta = table(
  { name: 'economy_meta', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    defaultValue: t.f64(),
    serverOnly: t.bool(),
    createdAt: t.timestamp(),
  }
);

const userMeta = table(
  {
    name: 'economy_user_meta',
    indexes: [{ accessor: 'byAccountMeta', algorithm: 'btree', columns: ['accountId', 'metaKey'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    metaKey: t.string(),
    value: t.f64(),
    updatedAt: t.timestamp(),
  }
);

const prize = table(
  { name: 'economy_prize', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    message: Translations,
    categoryId: t.u64(),
    tagIds: t.array(t.u64()),
    isRepeatable: t.bool(),
    items: t.array(PrizeItem),
    createdAt: t.timestamp(),
  }
);

const prizeGroup = table(
  { name: 'economy_prize_group', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    entries: t.array(GroupEntry),
    isActive: t.bool(),
    createdAt: t.timestamp(),
  }
);

const userPrize = table(
  {
    name: 'economy_user_prize',
    indexes: [{ accessor: 'bySource', algorithm: 'btree', columns: ['sourceType', 'sourceId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    prizeId: t.u64(),
    sourceType: t.string(),
    sourceId: t.string(),
    rewards: t.string(),
    createdAt: t.timestamp(),
  }
);

const product = table(
  { name: 'economy_product' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    description: Translations,
    isActive: t.bool(),
    categoryId: t.u64(),
    tagIds: t.array(t.u64()),
    audienceTagIds: t.array(t.u64()),
    priceToman: t.i64(),
    coinCurrency: t.string(),
    coinAmount: t.i64(),
    discountPercent: t.u8(),
    paymentMethods: t.array(t.string()),
    skuBazaar: t.string(),
    skuMyket: t.string(),
    prizeId: t.u64(),
    iconUrl: t.string(),
    coverUrl: t.string(),
    sort: t.i32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const gift = table(
  { name: 'economy_gift' },
  {
    id: t.u64().primaryKey().autoInc(),
    name: Translations,
    type: t.string(),
    code: t.string().unique(),
    prizeId: t.u64(),
    discountPercent: t.u8(),
    perUserLimit: t.u32(),
    maxTotalUses: t.u32(),
    totalUsed: t.u32(),
    validFrom: t.option(t.timestamp()),
    expireAt: t.option(t.timestamp()),
    isActive: t.bool(),
    categoryId: t.u64(),
    tagIds: t.array(t.u64()),
    createdAt: t.timestamp(),
  }
);

const giftUse = table(
  { name: 'economy_gift_use' },
  {
    id: t.u64().primaryKey().autoInc(),
    giftId: t.u64().index('btree'),
    accountId: t.u64().index('btree'),
    paymentId: t.u64(),
    status: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const paymentMethod = table(
  { name: 'economy_payment_method' },
  {
    method: t.string().primaryKey(),
    isActive: t.bool(),
    config: t.string(),
    updatedAt: t.timestamp(),
  }
);

const payment = table(
  { name: 'economy_payment' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    productId: t.u64(),
    method: t.string(),
    sandbox: t.bool(),
    status: t.string().index('btree'),
    originalToman: t.i64(),
    finalToman: t.i64(),
    amountRial: t.i64(),
    coinCurrency: t.string(),
    coinAmount: t.i64(),
    giftId: t.u64(),
    discountPercent: t.u8(),
    authority: t.string().index('btree'),
    refId: t.string(),
    storeToken: t.string().index('btree'),
    cardMask: t.string(),
    error: t.string(),
    rewardGranted: t.bool(),
    rewardError: t.string(),
    rewards: t.string(),
    inquiryCount: t.u32(),
    inquiredAt: t.option(t.timestamp()),
    verifiedAt: t.option(t.timestamp()),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const paymentLog = table(
  { name: 'economy_payment_log' },
  {
    id: t.u64().primaryKey().autoInc(),
    paymentId: t.u64().index('btree'),
    action: t.string(),
    url: t.string(),
    request: t.string(),
    response: t.string(),
    httpStatus: t.u32(),
    at: t.timestamp(),
  }
);

const settings = table(
  { name: 'economy_settings' },
  {
    id: t.u8().primaryKey(),
    publicBaseUrl: t.string(),
    redirectUrl: t.string(),
    pendingTtlMinutes: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const reconcileTimer = table(
  { name: 'economy_reconcile_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const economyTables = {
  currency,
  wallet,
  ledger,
  currencyInit,
  meta,
  userMeta,
  prize,
  prizeGroup,
  userPrize,
  product,
  gift,
  giftUse,
  paymentMethod,
  payment,
  paymentLog,
  economySettings: settings,
  reconcileTimer,
};

export const economyEnv = {};

export const economyRows = {
  wallet: wallet.rowType,
  userMeta: userMeta.rowType,
  product: product.rowType,
  gift: gift.rowType,
  payment: payment.rowType,
  paymentLog: paymentLog.rowType,
  settings: settings.rowType,
  ledger: ledger.rowType,
  userPrize: userPrize.rowType,
};

const allTables = { ...baseTables, ...playersTables, ...economyTables };
export type EconomySchema = ReturnType<typeof schema<typeof allTables, typeof baseEnv>>;
