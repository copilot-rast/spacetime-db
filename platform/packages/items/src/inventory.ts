import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, cleanKey, cleanTranslations, fail, loginHooks, requireAccount, requireRole, toLatinDigits, type Tr } from '@stg/base';
import { extraItemTypes, grantPrize, itemHandlers, itemValidators, purchaseChecks, settleChecks, shopFilters, type Reward } from '@stg/economy';
import { ItemService, Price, itemsRows, itemsTables, type ItemsSchema } from './schema';
import {
  RARITIES,
  addItem,
  base,
  boughtOnce,
  contentsMissing,
  contentsOwned,
  deliveredCount,
  econ,
  equip,
  grantStarters,
  invRow,
  itemsSettings,
  levelOf,
  owns,
  page,
  pay,
  prizeItems,
  record,
  requestReplay,
  requestSave,
  cleanRequestId,
  ruleOf,
  slotsOf,
  takeItem,
  type IDb,
  type ITx,
  type ItemRow,
} from './engine';

const InvEntry = t.row('InventoryEntry', {
  id: t.u64().primaryKey(),
  itemId: t.u64(),
  itemKey: t.string(),
  slot: t.string(),
  quantity: t.u32(),
  level: t.u32(),
  equipped: t.bool(),
  source: t.string(),
  ownedAt: t.timestamp(),
});

const ShopFlagRow = t.row('ShopFlagRow', {
  productId: t.u64().primaryKey(),
  minLevel: t.u32(),
  maxLevel: t.u32(),
  playerLevel: t.u32(),
  isOneTime: t.bool(),
  owned: t.bool(),
  levelLocked: t.bool(),
  aboveMaxLevel: t.bool(),
  requiresItem: t.bool(),
  bought: t.bool(),
  purchaseCount: t.u32(),
  purchaseMessage: Translations,
  itemKeys: t.array(t.string()),
});

const PaidLine = t.object('ItemPaid', { currencyKey: t.string(), amount: t.i64() });
const ItemRewardRow = t.object('ItemReward', { type: t.string(), key: t.string(), action: t.string(), value: t.f64(), prizeKey: t.string() });
const ActionResult = t.object('ItemActionResult', {
  itemKey: t.string(),
  quantity: t.u32(),
  level: t.u32(),
  equipped: t.bool(),
  paid: t.array(PaidLine),
  rewards: t.array(ItemRewardRow),
  replayed: t.bool(),
});
const EquipResult = t.object('ItemEquipResult', { itemKey: t.string(), slot: t.string(), equipped: t.bool(), unequipped: t.array(t.string()) });

const CatalogLine = t.object('ItemCatalogLine', {
  itemId: t.u64(),
  key: t.string(),
  typeKey: t.string(),
  rarity: t.string(),
  stackable: t.bool(),
  owned: t.bool(),
  quantity: t.u32(),
  level: t.u32(),
  maxLevel: t.u32(),
  equipped: t.bool(),
  equippable: t.bool(),
  unlockLevel: t.u32(),
  playerLevel: t.u32(),
  locked: t.bool(),
  requirementMet: t.bool(),
  canBuy: t.bool(),
  canUnlock: t.bool(),
  canUpgrade: t.bool(),
  nextUpgradePrice: t.option(Price),
});
const Catalog = t.object('ItemCatalog', { total: t.u32(), owned: t.u32(), items: t.array(CatalogLine) });

const PurchaseLine = t.object('ProductPurchaseCount', { productId: t.u64(), key: t.string(), count: t.u32(), lastPurchasedAt: t.u64() });

const ItemAdminRow = t.object('ItemAdminRow', { item: itemsRows.item, owners: t.u32(), equippedBy: t.u32() });
const ItemPage = t.object('ItemAdminPage', { total: t.u32(), rows: t.array(ItemAdminRow) });
const UserItems = t.object('UserItems', { inventory: t.array(itemsRows.inventory), uses: t.array(itemsRows.useLog) });

type Out = { itemKey: string; quantity: number; level: number; equipped: boolean; paid: { currencyKey: string; amount: bigint }[]; rewards: Reward[]; replayed: boolean };

function tr(ctx: ITx, list: unknown, required = true) {
  return cleanTranslations(list as Tr[], base(ctx), required);
}

function cleanUrl(s: string) {
  const v = s.trim();
  if (v && !/^(https?:\/\/|\/)/.test(v)) fail('INVALID_URL');
  return v.slice(0, 500);
}

function checkCurrency(ctx: ITx, key: string) {
  if (!ctx.db.currency.key.find(key)) fail('CURRENCY_NOT_FOUND');
}

function sessionAccount(ctx: { db: ITx['db']; sender: ITx['sender'] }) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  return a && a.status === 'active' ? a : undefined;
}

function activeItem(ctx: ITx, key: string) {
  const it = ctx.db.item.key.find(key.trim().toLowerCase());
  if (!it || !it.isActive) fail('ITEM_NOT_FOUND');
  return it;
}

function outOf(ctx: IDb, accountId: bigint, it: ItemRow, paid: Out['paid'], rewards: Reward[] = []): Out {
  const r = invRow(ctx, accountId, it.id);
  return { itemKey: it.key, quantity: r?.quantity ?? 0, level: r?.level ?? 0, equipped: r?.equipped ?? false, paid, rewards, replayed: false };
}

function serialize(o: Out) {
  return JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
}

function deserialize(s: string): Out {
  const o = JSON.parse(s, (_k, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as Out;
  return { ...o, replayed: true };
}

function requirementMet(ctx: IDb, accountId: bigint, it: ItemRow) {
  return !it.requiresKey || owns(ctx, accountId, it.requiresKey);
}

function itemUsed(ctx: ITx, key: string) {
  if ([...ctx.db.prize.iter()].some(p => p.items.some(i => i.type === 'item' && i.key === key))) return true;
  return [...ctx.db.item.iter()].some(i => i.requiresKey === key);
}

function flagsFor(ctx: IDb, accountId: bigint, productId: bigint) {
  const product = ctx.db.product.id.find(productId);
  const r = ruleOf(ctx, productId);
  const lvl = levelOf(ctx, accountId, r.levelTableId);
  const prizeId = product?.prizeId ?? 0n;
  return {
    productId,
    minLevel: r.minLevel,
    maxLevel: r.maxLevel,
    playerLevel: lvl,
    isOneTime: r.isOneTime,
    owned: contentsOwned(ctx, accountId, prizeId),
    levelLocked: !!r.minLevel && lvl < r.minLevel,
    aboveMaxLevel: !!r.maxLevel && lvl > r.maxLevel,
    requiresItem: contentsMissing(ctx, accountId, prizeId),
    bought: deliveredCount(ctx, accountId, productId) > 0,
    purchaseCount: deliveredCount(ctx, accountId, productId),
    purchaseMessage: r.purchaseMessage,
    itemKeys: prizeItems(ctx, prizeId).map(i => i.key),
  };
}

export function defineInventory(st: ItemsSchema) {
  extraItemTypes.push('item');
  itemValidators.push((ctx, item) => {
    if (item.type !== 'item') return;
    if (!(ctx as unknown as ITx).db.item.key.find(item.key)) fail('ITEM_NOT_FOUND');
    if (!Number.isInteger(item.value) || item.value < 1 || item.value > 100_000) fail('INVALID_VALUE');
  });
  itemHandlers.push((ctx, accountId, item, prizeKey, sourceType, sourceId) => {
    if (item.type !== 'item') return undefined;
    const tx = ctx as unknown as ITx;
    const it = tx.db.item.key.find(item.key);
    if (!it) fail('ITEM_NOT_FOUND');
    const added = addItem(tx, accountId, it, Math.max(Math.trunc(item.value) || 1, 1), 'prize', `${sourceType}:${sourceId}`);
    return { type: 'item', key: it.key, action: 'give', value: added, prizeKey };
  });
  loginHooks.push((ctx, accountId) => {
    grantStarters(ctx as unknown as ITx, accountId);
  });
  purchaseChecks.push((ctx, req, quote) => {
    if (!quote.available) return quote;
    const tx = ctx as unknown as ITx;
    const r = ruleOf(tx, req.product.id);
    if (r.minLevel || r.maxLevel) {
      const lvl = levelOf(tx, req.accountId, r.levelTableId);
      if (r.minLevel && lvl < r.minLevel) fail('LEVEL_TOO_LOW');
      if (r.maxLevel && lvl > r.maxLevel) fail('LEVEL_TOO_HIGH');
    }
    if (r.isOneTime && boughtOnce(tx, req.accountId, req.product.id)) fail('PRODUCT_ALREADY_BOUGHT');
    if (r.checkContents) {
      if (contentsOwned(tx, req.accountId, req.product.prizeId)) fail('PRIZE_ALREADY_OWNED');
      if (contentsMissing(tx, req.accountId, req.product.prizeId)) fail('REQUIRES_ITEM');
    }
    return quote;
  });
  settleChecks.push((ctx, p, product) => {
    const tx = ctx as unknown as ITx;
    const r = ruleOf(tx, product.id);
    if (r.isOneTime && boughtOnce(tx, p.accountId, product.id, p.id)) return 'PRODUCT_ALREADY_BOUGHT';
    if (r.checkContents && contentsOwned(tx, p.accountId, product.prizeId)) return 'PRIZE_ALREADY_OWNED';
    return undefined;
  });
  shopFilters.push((ctx, accountId, productId) => {
    const s = (ctx as IDb).db.itemsSettings.id.find(0);
    const r = (ctx as IDb).db.productRule.productId.find(productId);
    if (!r || !s) return true;
    if (accountId === undefined) return true;
    if (s.hideAboveMaxLevel && r.maxLevel && levelOf(ctx as IDb, accountId, r.levelTableId) > r.maxLevel) return false;
    if (s.hideBoughtOneTime && r.isOneTime && deliveredCount(ctx as IDb, accountId, productId) > 0) return false;
    return true;
  });

  const myInventory = st.view({ name: 'my_inventory', public: true }, t.array(InvEntry), ctx => {
    const a = sessionAccount(ctx as any);
    if (!a) return [];
    return [...ctx.db.inventory.byAccountItem.filter(a.id)].map(r => ({ id: r.id, itemId: r.itemId, itemKey: r.itemKey, slot: r.slot, quantity: r.quantity, level: r.level, equipped: r.equipped, source: r.source, ownedAt: r.ownedAt }));
  });

  const shopFlags = st.view({ name: 'shop_flags', public: true }, t.array(ShopFlagRow), ctx => {
    const a = sessionAccount(ctx as any);
    if (!a) return [];
    return [...ctx.db.product.iter()].filter(p => p.isActive).map(p => flagsFor(ctx as any, a.id, p.id));
  });

  const adminItemsSettings = st.view({ name: 'admin_items_settings', public: true }, t.option(itemsRows.settings), ctx => (adminOrNull(ctx as any) ? ctx.db.itemsSettings.id.find(0) ?? undefined : undefined));

  const adminSaveItemsSettings = st.reducer({ hideBoughtOneTime: t.bool(), hideAboveMaxLevel: t.bool(), requestTtlHours: t.u32() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = itemsSettings(ctx);
    if (a.requestTtlHours < 1 || a.requestTtlHours > 24 * 30) fail('INVALID_RULE:requestTtlHours');
    ctx.db.itemsSettings.id.update({ ...s, ...a, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'items_settings.save', 'settings', JSON.stringify(a));
  });

  const adminSetItemsClockOffset = st.reducer({ seconds: t.i64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = itemsSettings(ctx);
    if (a.seconds < -3650n * 86400n || a.seconds > 3650n * 86400n) fail('INVALID_CLOCK_OFFSET');
    ctx.db.itemsSettings.id.update({ ...s, clockOffsetSec: a.seconds, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'items_settings.clock', 'settings', String(a.seconds));
  });

  const adminSaveItemType = st.reducer({ id: t.u64(), key: t.string(), name: Translations, slots: t.u8(), sort: t.i32() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const key = cleanKey(a.key);
    const old = a.id ? ctx.db.itemType.id.find(a.id) : undefined;
    if (a.id && !old) fail('NOT_FOUND');
    if (old && old.key !== key) fail('KEY_LOCKED');
    const same = ctx.db.itemType.key.find(key);
    if (same && same.id !== a.id) fail('KEY_TAKEN');
    if (a.slots > 20) fail('INVALID_SLOTS');
    const row = { id: a.id, key, name: tr(ctx, a.name), slots: a.slots, sort: a.sort, isSystem: old?.isSystem ?? false, createdAt: old?.createdAt ?? ctx.timestamp };
    const saved = old ? ctx.db.itemType.id.update(row) : ctx.db.itemType.insert({ ...row, id: 0n });
    audit(base(ctx), me.id, old ? 'item_type.update' : 'item_type.create', String(saved.id), key);
  });

  const adminDeleteItemType = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const ty = ctx.db.itemType.id.find(id);
    if (!ty) fail('NOT_FOUND');
    if (ty.isSystem) fail('SYSTEM_ITEM_TYPE');
    if ([...ctx.db.item.typeKey.filter(ty.key)].length) fail('IN_USE');
    ctx.db.itemType.id.delete(id);
    audit(base(ctx), me.id, 'item_type.delete', String(id), ty.key);
  });

  const adminSaveItem = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      typeKey: t.string(),
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
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.item.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      const same = ctx.db.item.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (!ctx.db.itemType.key.find(a.typeKey)) fail('ITEM_TYPE_NOT_FOUND');
      if (!RARITIES.includes(a.rarity)) fail('INVALID_RARITY');
      if (a.categoryId) {
        const c = ctx.db.category.id.find(a.categoryId);
        if (!c) fail('CATEGORY_NOT_FOUND');
        if (c.keyType !== 'item' && c.keyType !== 'general') fail('CATEGORY_KIND_MISMATCH');
      }
      if (a.tagIds.length > 20) fail('TOO_MANY_TAGS');
      for (const id of a.tagIds) {
        const tag = ctx.db.tag.id.find(id);
        if (!tag) fail('TAG_NOT_FOUND');
        if (tag.keyType !== 'item' && tag.keyType !== 'general') fail('TAG_KIND_MISMATCH');
      }
      const requiresKey = a.requiresKey.trim().toLowerCase();
      if (requiresKey) {
        if (requiresKey === key) fail('SELF_REFERENCE');
        if (!ctx.db.item.key.find(requiresKey)) fail('ITEM_NOT_FOUND');
      }
      if (a.isStarter && a.unlockLevel) fail('STARTER_HAS_LEVEL');
      if (a.levelTableId && !ctx.db.levelTable.id.find(a.levelTableId)) fail('LEVEL_TABLE_NOT_FOUND');
      if (a.unlockLevel > 10_000) fail('INVALID_LEVEL');
      if (a.price) {
        checkCurrency(ctx, a.price.currencyKey);
        if (a.price.amount <= 0n) fail('INVALID_PRICE');
      }
      if (a.stackable && a.upgrades.length) fail('STACKABLE_NO_UPGRADES');
      if (a.upgrades.length > 50) fail('TOO_MANY_UPGRADES');
      for (const u of a.upgrades) {
        checkCurrency(ctx, u.currencyKey);
        if (u.amount < 0n) fail('INVALID_PRICE');
      }
      if (a.services.length > 20) fail('TOO_MANY_SERVICES');
      const seen = new Set<string>();
      const services = a.services.map(sv => {
        const k = cleanKey(sv.key);
        if (seen.has(k)) fail('DUPLICATE_SERVICE');
        seen.add(k);
        if (sv.unitPrice < 0n) fail('INVALID_PRICE');
        if (sv.unitPrice > 0n) checkCurrency(ctx, sv.currencyKey);
        if (sv.maxUnits < 1 || sv.maxUnits > 100) fail('INVALID_UNITS');
        if (sv.prizeId && !ctx.db.prize.id.find(sv.prizeId)) fail('PRIZE_NOT_FOUND');
        return { key: k, name: tr(ctx, sv.name, false), currencyKey: sv.unitPrice > 0n ? sv.currencyKey : '', unitPrice: sv.unitPrice, maxUnits: sv.maxUnits, prizeId: sv.prizeId };
      });
      if (a.usePrizeId && !ctx.db.prize.id.find(a.usePrizeId)) fail('PRIZE_NOT_FOUND');
      if (a.usePrizeId && !a.stackable) fail('NOT_CONSUMABLE');
      if (a.metadata.length > 4000) fail('METADATA_TOO_LARGE');
      if (a.metadata) {
        try {
          JSON.parse(a.metadata);
        } catch {
          fail('INVALID_METADATA');
        }
      }
      if (old && old.stackable !== a.stackable && [...ctx.db.inventory.itemId.filter(old.id)].length) fail('IN_USE');
      const row = {
        id: a.id,
        key,
        typeKey: a.typeKey,
        name: tr(ctx, a.name),
        description: tr(ctx, a.description, false),
        iconUrl: cleanUrl(a.iconUrl),
        imageUrl: cleanUrl(a.imageUrl),
        categoryId: a.categoryId,
        tagIds: [...new Set(a.tagIds)],
        rarity: a.rarity,
        stackable: a.stackable,
        maxStack: a.stackable ? a.maxStack : 1,
        requiresKey,
        isStarter: a.isStarter,
        starterQuantity: a.isStarter ? (a.stackable ? Math.max(a.starterQuantity, 1) : 1) : 0,
        levelTableId: a.levelTableId,
        unlockLevel: a.unlockLevel,
        price: a.price,
        upgrades: a.upgrades,
        services,
        usePrizeId: a.usePrizeId,
        metadata: a.metadata,
        sort: a.sort,
        isActive: a.isActive,
        createdAt: old?.createdAt ?? ctx.timestamp,
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.item.id.update(row) : ctx.db.item.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'item.update' : 'item.create', String(saved.id), key);
    }
  );

  const adminDeleteItem = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const it = ctx.db.item.id.find(id);
    if (!it) fail('NOT_FOUND');
    if ([...ctx.db.inventory.itemId.filter(id)].length || itemUsed(ctx, it.key)) fail('IN_USE');
    ctx.db.item.id.delete(id);
    audit(base(ctx), me.id, 'item.delete', String(id), it.key);
  });

  const adminItems = st.procedure({ query: t.string(), typeKey: t.string(), isActive: t.string(), page: t.u32(), pageSize: t.u32() }, ItemPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const q = toLatinDigits(a.query).trim().toLowerCase();
      const list = [...tx.db.item.iter()]
        .filter(i => (!q || i.key.includes(q) || i.name.some(n => n.text.toLowerCase().includes(q))) && (!a.typeKey || i.typeKey === a.typeKey) && (!a.isActive || String(i.isActive) === a.isActive))
        .sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1));
      const p = page(list, a.page, a.pageSize);
      return {
        total: p.total,
        rows: p.rows.map(item => {
          const inv = [...tx.db.inventory.itemId.filter(item.id)];
          return { item, owners: inv.length, equippedBy: inv.filter(r => r.equipped).length };
        }),
      };
    })
  );

  const adminUserItems = st.procedure({ accountId: t.u64() }, UserItems, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      return {
        inventory: [...tx.db.inventory.byAccountItem.filter(a.accountId)],
        uses: [...tx.db.itemUseLog.accountId.filter(a.accountId)].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 50),
      };
    })
  );

  const adminGiveItem = st.reducer({ accountId: t.u64(), itemId: t.u64(), quantity: t.u32(), note: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
    const it = ctx.db.item.id.find(a.itemId);
    if (!it) fail('ITEM_NOT_FOUND');
    if (a.quantity < 1 || a.quantity > 100_000) fail('INVALID_QUANTITY');
    addItem(ctx, a.accountId, it, a.quantity, 'admin', String(me.id), true);
    audit(base(ctx), me.id, 'item.give', String(a.accountId), `${it.key} x${a.quantity} ${a.note}`);
  });

  const adminTakeItem = st.reducer({ accountId: t.u64(), itemId: t.u64(), quantity: t.u32(), note: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const it = ctx.db.item.id.find(a.itemId);
    if (!it) fail('ITEM_NOT_FOUND');
    const row = invRow(ctx, a.accountId, it.id);
    if (!row) fail('NOT_OWNED');
    if (row.source === 'starter' && !it.stackable) fail('STARTER_ITEM');
    takeItem(ctx, a.accountId, it, it.stackable ? Math.max(a.quantity, 1) : 1);
    audit(base(ctx), me.id, 'item.take', String(a.accountId), `${it.key} x${a.quantity} ${a.note}`);
  });

  const adminSaveProductRule = st.reducer(
    { productId: t.u64(), minLevel: t.u32(), maxLevel: t.u32(), levelTableId: t.u64(), isOneTime: t.bool(), checkContents: t.bool(), purchaseMessage: Translations },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      if (!ctx.db.product.id.find(a.productId)) fail('PRODUCT_NOT_FOUND');
      if (a.maxLevel && a.minLevel > a.maxLevel) fail('INVALID_LEVEL_RANGE');
      if (a.levelTableId && !ctx.db.levelTable.id.find(a.levelTableId)) fail('LEVEL_TABLE_NOT_FOUND');
      const row = { ...a, purchaseMessage: tr(ctx, a.purchaseMessage, false), updatedAt: ctx.timestamp };
      if (ctx.db.productRule.productId.find(a.productId)) ctx.db.productRule.productId.update(row);
      else ctx.db.productRule.insert(row);
      audit(base(ctx), me.id, 'product_rule.save', String(a.productId), JSON.stringify({ min: a.minLevel, max: a.maxLevel, once: a.isOneTime, contents: a.checkContents }));
    }
  );

  const adminDeleteProductRule = st.reducer({ productId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.productRule.productId.find(a.productId)) fail('NOT_FOUND');
    ctx.db.productRule.productId.delete(a.productId);
    audit(base(ctx), me.id, 'product_rule.delete', String(a.productId));
  });

  const syncItems = st.reducer(ctx => {
    const me = requireAccount(base(ctx));
    grantStarters(ctx, me.id);
  });

  const myItems = st.procedure({ typeKey: t.string() }, Catalog, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      grantStarters(tx, me.id);
      const list = [...tx.db.item.iter()]
        .filter(i => i.isActive && (!a.typeKey || i.typeKey === a.typeKey))
        .sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1));
      const items = list.map(i => {
        const r = invRow(tx, me.id, i.id);
        const owned = !!r && r.quantity > 0;
        const lvl = levelOf(tx, me.id, i.levelTableId);
        const locked = i.unlockLevel > 0 && lvl < i.unlockLevel;
        const req = requirementMet(tx, me.id, i);
        const level = r?.level ?? 0;
        const full = i.stackable && !!i.maxStack && (r?.quantity ?? 0) >= i.maxStack;
        return {
          itemId: i.id,
          key: i.key,
          typeKey: i.typeKey,
          rarity: i.rarity,
          stackable: i.stackable,
          owned,
          quantity: r?.quantity ?? 0,
          level,
          maxLevel: i.upgrades.length,
          equipped: r?.equipped ?? false,
          equippable: slotsOf(tx, i.typeKey) > 0,
          unlockLevel: i.unlockLevel,
          playerLevel: lvl,
          locked,
          requirementMet: req,
          canBuy: !!i.price && !locked && req && (i.stackable ? !full : !owned),
          canUnlock: !i.price && i.unlockLevel > 0 && !locked && req && !owned,
          canUpgrade: owned && level < i.upgrades.length,
          nextUpgradePrice: owned && level < i.upgrades.length ? i.upgrades[level] : undefined,
        };
      });
      return { total: items.length, owned: items.filter(x => x.owned).length, items };
    })
  );

  const itemBuy = st.procedure({ key: t.string(), quantity: t.u32(), requestId: t.string() }, ActionResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const rid = cleanRequestId(a.requestId, false);
      const it = activeItem(tx, a.key);
      const qty = it.stackable ? a.quantity || 1 : 1;
      const replay = requestReplay(tx, me.id, rid, 'buy', `${it.key}|${qty}`);
      if (replay) return deserialize(replay);
      if (!it.price) fail('NOT_FOR_SALE');
      if (qty < 1 || qty > 1000) fail('INVALID_QUANTITY');
      if (it.unlockLevel && levelOf(tx, me.id, it.levelTableId) < it.unlockLevel) fail('LEVEL_TOO_LOW');
      if (!requirementMet(tx, me.id, it)) fail('REQUIRES_ITEM');
      addItem(tx, me.id, it, qty, 'buy', rid || `buy-${tx.timestamp.microsSinceUnixEpoch}`, true);
      const total = it.price.amount * BigInt(qty);
      const paid = pay(tx, me.id, it.price.currencyKey, total, `item:${it.key}`, 'item_buy', `${me.id}|${rid || tx.timestamp.microsSinceUnixEpoch}`);
      record(tx, me.id, 'item_bought', Number(total), { key: it.key, quantity: String(qty) });
      const out = outOf(tx, me.id, it, paid);
      requestSave(tx, me.id, rid, 'buy', `${it.key}|${qty}`, serialize(out));
      return out;
    })
  );

  const itemUnlock = st.procedure({ key: t.string() }, ActionResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const it = activeItem(tx, a.key);
      if (it.price || !it.unlockLevel) fail('NOT_UNLOCKABLE');
      const lvl = levelOf(tx, me.id, it.levelTableId);
      if (lvl < it.unlockLevel) fail('LEVEL_TOO_LOW');
      if (!requirementMet(tx, me.id, it)) fail('REQUIRES_ITEM');
      addItem(tx, me.id, it, 1, 'unlock', `level:${lvl}`, true);
      record(tx, me.id, 'item_unlocked', lvl, { key: it.key });
      return outOf(tx, me.id, it, []);
    })
  );

  const itemUpgrade = st.procedure({ key: t.string(), fromLevel: t.i32(), requestId: t.string() }, ActionResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const rid = cleanRequestId(a.requestId, false);
      const it = activeItem(tx, a.key);
      const replay = requestReplay(tx, me.id, rid, 'upgrade', `${it.key}|${a.fromLevel}`);
      if (replay) return deserialize(replay);
      const row = invRow(tx, me.id, it.id);
      if (!row || row.quantity === 0) fail('NOT_OWNED');
      if (a.fromLevel >= 0 && a.fromLevel !== row.level) fail('UPGRADE_CHANGED');
      if (row.level >= it.upgrades.length) fail('UPGRADE_MAXED');
      const cost = it.upgrades[row.level];
      tx.db.inventory.id.update({ ...row, level: row.level + 1, updatedAt: tx.timestamp });
      const paid = pay(tx, me.id, cost.currencyKey, cost.amount, `upgrade:${it.key}:${row.level + 1}`, 'item_upgrade', `${me.id}|${it.id}|${row.level + 1}`);
      record(tx, me.id, 'item_upgraded', row.level + 1, { key: it.key });
      const out = outOf(tx, me.id, it, paid);
      requestSave(tx, me.id, rid, 'upgrade', `${it.key}|${a.fromLevel}`, serialize(out));
      return out;
    })
  );

  const itemEquip = st.procedure({ key: t.string() }, EquipResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const it = activeItem(tx, a.key);
      const was = invRow(tx, me.id, it.id)?.equipped ?? false;
      const off = equip(tx, me.id, it);
      if (!was) record(tx, me.id, 'item_equipped', 1, { key: it.key, slot: it.typeKey });
      return { itemKey: it.key, slot: it.typeKey, equipped: true, unequipped: off };
    })
  );

  const itemUnequip = st.procedure({ key: t.string() }, EquipResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const it = tx.db.item.key.find(a.key.trim().toLowerCase());
      if (!it) fail('ITEM_NOT_FOUND');
      const row = invRow(tx, me.id, it.id);
      if (!row || row.quantity === 0) fail('NOT_OWNED');
      if (row.equipped) tx.db.inventory.id.update({ ...row, equipped: false, updatedAt: tx.timestamp });
      return { itemKey: it.key, slot: row.slot, equipped: false, unequipped: row.equipped ? [it.key] : [] };
    })
  );

  const itemUse = st.procedure({ key: t.string(), service: t.string(), units: t.u32(), requestId: t.string() }, ActionResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const rid = cleanRequestId(a.requestId, true);
      const it = activeItem(tx, a.key);
      const units = a.units || 1;
      const service = a.service.trim().toLowerCase();
      const detail = `${it.key}|${service}|${units}`;
      const replay = requestReplay(tx, me.id, rid, 'use', detail);
      if (replay) return deserialize(replay);
      const row = invRow(tx, me.id, it.id);
      if (!row || row.quantity === 0) fail('NOT_OWNED');
      let paid: Out['paid'] = [];
      const rewards: Reward[] = [];
      if (!service) {
        if (!it.stackable) fail('NOT_CONSUMABLE');
        if (units < 1 || units > 1000) fail('INVALID_UNITS');
        takeItem(tx, me.id, it, units);
        if (it.usePrizeId) for (let i = 0; i < Math.min(units, 100); i++) rewards.push(...grantPrize(econ(tx), me.id, it.usePrizeId, 'item_use', `${me.id}|${rid}#${i}`));
      } else {
        const sv = it.services.find(x => x.key === service);
        if (!sv) fail('SERVICE_NOT_FOUND');
        if (units < 1 || units > sv.maxUnits) fail('INVALID_UNITS');
        paid = pay(tx, me.id, sv.currencyKey, sv.unitPrice * BigInt(units), `service:${it.key}:${sv.key}`, 'item_use', `${me.id}|${rid}`);
        if (sv.prizeId) for (let i = 0; i < units; i++) rewards.push(...grantPrize(econ(tx), me.id, sv.prizeId, 'item_use', `${me.id}|${rid}#${i}`));
      }
      tx.db.itemUseLog.insert({ id: 0n, accountId: me.id, itemKey: it.key, service, units, paid: JSON.stringify(paid.map(p => ({ currencyKey: p.currencyKey, amount: String(p.amount) }))), rewards: JSON.stringify(rewards), requestId: rid, at: tx.timestamp });
      record(tx, me.id, 'item_used', units, { key: it.key, service });
      const out = outOf(tx, me.id, it, paid, rewards);
      requestSave(tx, me.id, rid, 'use', detail, serialize(out));
      return out;
    })
  );

  const myPurchases = st.procedure(t.array(PurchaseLine), ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const by = new Map<bigint, { count: number; last: bigint }>();
      for (const p of tx.db.payment.accountId.filter(me.id)) {
        if (p.status !== 'success' || !p.rewardGranted) continue;
        const v = by.get(p.productId) ?? { count: 0, last: 0n };
        v.count++;
        if (p.updatedAt.microsSinceUnixEpoch > v.last) v.last = p.updatedAt.microsSinceUnixEpoch;
        by.set(p.productId, v);
      }
      return [...by].map(([productId, v]) => ({ productId, key: tx.db.product.id.find(productId)?.key ?? '', count: v.count, lastPurchasedAt: v.last }));
    })
  );

  const itemsTick = st.procedure({ onSchedule: itemsTables.itemsTickTimer }, { timer: itemsTables.itemsTickTimer.rowType }, t.unit(), ctx => {
    ctx.withTx(tx => {
      const now = tx.timestamp.microsSinceUnixEpoch;
      const old = [...tx.db.itemRequest.iter()].filter(r => r.expiresAt < now).slice(0, 500);
      for (const r of old) tx.db.itemRequest.key.delete(r.key);
    });
    return {};
  });

  return {
    itemsTick,
    myInventory,
    shopFlags,
    adminItemsSettings,
    adminSaveItemsSettings,
    adminSetItemsClockOffset,
    adminSaveItemType,
    adminDeleteItemType,
    adminSaveItem,
    adminDeleteItem,
    adminItems,
    adminUserItems,
    adminGiveItem,
    adminTakeItem,
    adminSaveProductRule,
    adminDeleteProductRule,
    syncItems,
    myItems,
    itemBuy,
    itemUnlock,
    itemUpgrade,
    itemEquip,
    itemUnequip,
    itemUse,
    myPurchases,
  };
}
