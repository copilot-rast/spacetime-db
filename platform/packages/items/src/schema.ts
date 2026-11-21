import { schema, table, t } from 'spacetimedb/server';
import { baseTables, baseEnv, Translations } from '@stg/base';
import { playersTables } from '@stg/players';
import { economyTables } from '@stg/economy';
import { gamificationTables } from '@stg/gamification';

export const Price = t.object('ItemPrice', { currencyKey: t.string(), amount: t.i64() });
export const ItemService = t.object('ItemService', { key: t.string(), name: Translations, currencyKey: t.string(), unitPrice: t.i64(), maxUnits: t.u32(), prizeId: t.u64() });
export const MetaCondition = t.object('OfferMetaCondition', { metaKey: t.string(), operator: t.string(), value: t.f64() });
export const TagCount = t.object('OfferTagCount', { tagId: t.u64(), count: t.u8() });

const itemType = table(
  { name: 'items_type', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    name: Translations,
    slots: t.u8(),
    sort: t.i32(),
    isSystem: t.bool(),
    createdAt: t.timestamp(),
  }
);

const item = table(
  { name: 'items_item', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    typeKey: t.string().index('btree'),
    name: Translations,
    description: Translations,
    iconUrl: t.string(),
    imageUrl: t.string(),
    categoryId: t.u64(),
    tagIds: t.array(t.u64()),
    rarity: t.string(),
    stackable: t.bool(),
    maxStack: t.u32(),
    requiresKey: t.string(),
    isStarter: t.bool(),
    starterQuantity: t.u32(),
    levelTableId: t.u64(),
    unlockLevel: t.u32(),
    price: t.option(Price),
    upgrades: t.array(Price),
    services: t.array(ItemService),
    usePrizeId: t.u64(),
    metadata: t.string(),
    sort: t.i32(),
    isActive: t.bool(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const inventory = table(
  {
    name: 'items_inventory',
    indexes: [{ accessor: 'byAccountItem', algorithm: 'btree', columns: ['accountId', 'itemId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    itemId: t.u64().index('btree'),
    itemKey: t.string(),
    slot: t.string(),
    quantity: t.u32(),
    level: t.u32(),
    equipped: t.bool(),
    source: t.string(),
    sourceRef: t.string(),
    ownedAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const starterGiven = table({ name: 'items_starter_given' }, { key: t.string().primaryKey(), at: t.timestamp() });

const request = table(
  { name: 'items_request' },
  {
    key: t.string().primaryKey(),
    accountId: t.u64(),
    action: t.string(),
    detail: t.string(),
    result: t.string(),
    expiresAt: t.u64().index('btree'),
  }
);

const useLog = table(
  { name: 'items_use_log' },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64().index('btree'),
    itemKey: t.string(),
    service: t.string(),
    units: t.u32(),
    paid: t.string(),
    rewards: t.string(),
    requestId: t.string(),
    at: t.timestamp(),
  }
);

const productRule = table(
  { name: 'items_product_rule', public: true },
  {
    productId: t.u64().primaryKey(),
    minLevel: t.u32(),
    maxLevel: t.u32(),
    levelTableId: t.u64(),
    isOneTime: t.bool(),
    checkContents: t.bool(),
    purchaseMessage: Translations,
    updatedAt: t.timestamp(),
  }
);

const settings = table(
  { name: 'items_settings' },
  {
    id: t.u8().primaryKey(),
    hideBoughtOneTime: t.bool(),
    hideAboveMaxLevel: t.bool(),
    requestTtlHours: t.u32(),
    clockOffsetSec: t.i64(),
    updatedAt: t.timestamp(),
  }
);

const offer = table(
  { name: 'items_offer' },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    kind: t.string().index('btree'),
    name: Translations,
    description: Translations,
    badge: Translations,
    productId: t.u64().index('btree'),
    priceMode: t.string(),
    discountPercent: t.u8(),
    priceToman: t.i64(),
    coinAmount: t.i64(),
    purchaseLimit: t.u32(),
    weight: t.u32(),
    audienceTagIds: t.array(t.u64()),
    excludeTagIds: t.array(t.u64()),
    levelTableId: t.u64(),
    minLevel: t.u32(),
    maxLevel: t.u32(),
    metaConditions: t.array(MetaCondition),
    minAccountDays: t.u32(),
    maxAccountDays: t.u32(),
    triggerType: t.string(),
    triggerValue: t.f64(),
    triggerRefId: t.u64(),
    triggerMetaKey: t.string(),
    durationMinutes: t.u32(),
    repeat: t.string(),
    cooldownHours: t.u32(),
    maxTriggers: t.u32(),
    startsAt: t.u64(),
    endsAt: t.u64(),
    isActive: t.bool(),
    sort: t.i32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const offerSettings = table(
  { name: 'items_offer_settings' },
  {
    id: t.u8().primaryKey(),
    dailyEnabled: t.bool(),
    periodDays: t.u8(),
    resetMinute: t.u16(),
    count: t.u8(),
    countByTag: t.array(TagCount),
    weighting: t.string(),
    noRepeatDays: t.u16(),
    fillWithRepeats: t.bool(),
    boughtCooldownDays: t.i32(),
    excludeOwned: t.bool(),
    respectProductRules: t.bool(),
    inactiveProducts: t.string(),
    showSoldOut: t.bool(),
    giftCodes: t.bool(),
    rerollEnabled: t.bool(),
    rerollLimit: t.u8(),
    rerollFree: t.u8(),
    rerollCurrency: t.string(),
    rerollCost: t.i64(),
    rerollCostStep: t.i64(),
    rerollAvoidCurrent: t.bool(),
    entryEnabled: t.bool(),
    entryMaxActive: t.u8(),
    entryTimerStart: t.string(),
    updatedAt: t.timestamp(),
  }
);

const userOffer = table(
  {
    name: 'items_user_offer',
    indexes: [{ accessor: 'byAccountOffer', algorithm: 'btree', columns: ['accountId', 'offerId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    accountId: t.u64(),
    offerId: t.u64().index('btree'),
    kind: t.string(),
    period: t.i64(),
    slot: t.u8(),
    status: t.string(),
    originalToman: t.i64(),
    finalToman: t.i64(),
    coinCurrency: t.string(),
    coinAmount: t.i64(),
    coinOriginal: t.i64(),
    discountPercent: t.u8(),
    purchaseLimit: t.u32(),
    bought: t.u32(),
    reroll: t.u32(),
    forgotten: t.bool(),
    madeAt: t.u64(),
    shownAt: t.u64(),
    startedAt: t.u64(),
    expiresAt: t.u64(),
    endedAt: t.u64(),
    lastBoughtAt: t.u64(),
  }
);

const offerPeriod = table(
  { name: 'items_offer_period' },
  {
    key: t.string().primaryKey(),
    accountId: t.u64().index('btree'),
    period: t.i64(),
    rerolls: t.u32(),
    drawn: t.bool(),
  }
);

const offerState = table(
  { name: 'items_offer_state' },
  {
    accountId: t.u64().primaryKey(),
    lastLoginAt: t.u64(),
    prevLoginAt: t.u64(),
  }
);

const offerPayment = table(
  { name: 'items_offer_payment' },
  {
    paymentId: t.u64().primaryKey(),
    userOfferId: t.u64().index('btree'),
    offerId: t.u64().index('btree'),
    accountId: t.u64(),
    createdAt: t.timestamp(),
  }
);

const tickTimer = table(
  { name: 'items_tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const itemsTables = {
  itemType,
  item,
  inventory,
  starterGiven,
  itemRequest: request,
  itemUseLog: useLog,
  productRule,
  itemsSettings: settings,
  offer,
  offerSettings,
  userOffer,
  offerPeriod,
  offerState,
  offerPayment,
  itemsTickTimer: tickTimer,
};

export const itemsEnv = {};

export const itemsRows = {
  itemType: itemType.rowType,
  item: item.rowType,
  inventory: inventory.rowType,
  useLog: useLog.rowType,
  productRule: productRule.rowType,
  settings: settings.rowType,
  offer: offer.rowType,
  offerSettings: offerSettings.rowType,
  userOffer: userOffer.rowType,
};

const allTables = { ...baseTables, ...playersTables, ...economyTables, ...gamificationTables, ...itemsTables };
export type ItemsSchema = ReturnType<typeof schema<typeof allTables, typeof baseEnv>>;
