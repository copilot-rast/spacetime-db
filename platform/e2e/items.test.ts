import { DB, ECONOMY_QUERIES, GAMIFICATION_QUERIES, ITEMS_QUERIES, PLAYER_QUERIES, check, connect, done, errorOf, login, loginOwner, tr, uniquePhone, waitFor, type Client } from './src/lib.ts';

const BASE = process.env.STG_HTTP ?? 'http://127.0.0.1:7500';
const PW = process.env.PLAYWRIGHT_CORE ?? '/Users/mazyar/Projects/spacetime-game-backend/platform/node_modules/playwright-core/index.mjs';
const R = String(Date.now() % 10_000_000);
const k = (s: string) => `${s}_${R}`;
const c = (token?: string) => connect(token, [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMIFICATION_QUERIES, ...ITEMS_QUERIES]);
const rows = <T>(it: Iterable<T>) => [...it];
const HOUR = 3600;
const DAY = 86400;

let o: Client;
type ItemArgs = Parameters<Client['conn']['reducers']['adminSaveItem']>[0];
type OfferArgs = Parameters<Client['conn']['reducers']['adminSaveOffer']>[0];
type OfferSettingsArgs = Parameters<Client['conn']['reducers']['adminSaveOfferSettings']>[0];

const gold = k('gold');
const bal = (cl: Client) => rows(cl.conn.db.myWallet.iter()).find(w => w.currencyKey === gold)?.balance ?? -1n;
const inv = (cl: Client, key: string) => rows(cl.conn.db.myInventory.iter()).find(r => r.itemKey === key);

async function clock(sec: number) {
  await o.conn.reducers.adminSetItemsClockOffset({ seconds: BigInt(sec) });
  await waitFor(() => rows(o.conn.db.adminItemsSettings.iter())[0]?.clockOffsetSec === BigInt(sec));
}
async function player(tags: bigint[] = []) {
  const p = await c();
  const phone = uniquePhone('0936');
  const r = await login(p, phone);
  if (tags.length) await o.conn.reducers.adminSetPlayerTags({ accountId: r.accountId, tagIds: tags });
  await waitFor(() => bal(p) === 1000n);
  return { p, id: r.accountId, phone };
}
async function item(key: string, p: Partial<ItemArgs>) {
  const old = rows(o.conn.db.item.iter()).find(x => x.key === key);
  await o.conn.reducers.adminSaveItem({
    id: old?.id ?? 0n,
    key,
    typeKey: 'skin',
    name: tr(key),
    description: [],
    iconUrl: '',
    imageUrl: '',
    categoryId: 0n,
    tagIds: [],
    rarity: 'common',
    stackable: false,
    maxStack: 0,
    requiresKey: '',
    isStarter: false,
    starterQuantity: 0,
    levelTableId: 0n,
    unlockLevel: 0,
    price: undefined,
    upgrades: [],
    services: [],
    usePrizeId: 0n,
    metadata: '',
    sort: 0,
    isActive: true,
    ...p,
  });
  await waitFor(() => rows(o.conn.db.item.iter()).some(x => x.key === key));
  return rows(o.conn.db.item.iter()).find(x => x.key === key)!;
}
async function prize(key: string, items: { type: string; key: string; action: string; value: number }[]) {
  await o.conn.reducers.adminSavePrize({ id: 0n, key, name: tr(key), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items });
  await waitFor(() => rows(o.conn.db.prize.iter()).some(x => x.key === key));
  return rows(o.conn.db.prize.iter()).find(x => x.key === key)!.id;
}
async function product(key: string, prizeId: bigint, p: Partial<{ priceToman: bigint; coinAmount: bigint; paymentMethods: string[]; skuBazaar: string; isActive: boolean }>) {
  await o.conn.reducers.adminSaveProduct({
    id: 0n,
    key,
    name: tr(key),
    description: [],
    isActive: p.isActive ?? true,
    categoryId: 0n,
    tagIds: [],
    audienceTagIds: [],
    priceToman: p.priceToman ?? 0n,
    coinCurrency: gold,
    coinAmount: p.coinAmount ?? 10n,
    discountPercent: 0,
    paymentMethods: p.paymentMethods ?? ['in_app'],
    skuBazaar: p.skuBazaar ?? '',
    skuMyket: '',
    prizeId,
    iconUrl: '',
    coverUrl: '',
    sort: 0,
  });
  const list = await o.conn.procedures.adminProducts({ query: key, categoryId: 0n, isActive: '', page: 1, pageSize: 50 });
  return list.rows.find(r => r.key === key)!.id;
}
async function rule(productId: bigint, p: Partial<Parameters<Client['conn']['reducers']['adminSaveProductRule']>[0]>) {
  await o.conn.reducers.adminSaveProductRule({ productId, minLevel: 0, maxLevel: 0, levelTableId: 0n, isOneTime: false, checkContents: true, purchaseMessage: [], ...p });
  await waitFor(() => rows(o.conn.db.productRule.iter()).some(x => x.productId === productId));
}
async function offer(key: string, p: Partial<OfferArgs>) {
  const old = rows(o.conn.db.adminOffers.iter()).find(x => x.key === key);
  await o.conn.reducers.adminSaveOffer({
    id: old?.id ?? 0n,
    key,
    kind: 'daily',
    name: [],
    description: [],
    badge: [],
    productId: 0n,
    priceMode: 'discount',
    discountPercent: 50,
    priceToman: -1n,
    coinAmount: -1n,
    purchaseLimit: 1,
    weight: 10,
    audienceTagIds: [],
    excludeTagIds: [],
    levelTableId: 0n,
    minLevel: 0,
    maxLevel: 0,
    metaConditions: [],
    minAccountDays: 0,
    maxAccountDays: 0,
    triggerType: '',
    triggerValue: 0,
    triggerRefId: 0n,
    triggerMetaKey: '',
    durationMinutes: 1440,
    repeat: 'once',
    cooldownHours: 0,
    maxTriggers: 0,
    startsAt: 0n,
    endsAt: 0n,
    isActive: true,
    sort: 0,
    ...p,
  });
  await waitFor(() => rows(o.conn.db.adminOffers.iter()).some(x => x.key === key));
  return rows(o.conn.db.adminOffers.iter()).find(x => x.key === key)!.id;
}
const DEFAULT_OFFER_SETTINGS: OfferSettingsArgs = {
  dailyEnabled: true,
  periodDays: 1,
  resetMinute: 0,
  count: 3,
  countByTag: [],
  weighting: 'weighted',
  noRepeatDays: 1,
  fillWithRepeats: true,
  boughtCooldownDays: 7,
  excludeOwned: true,
  respectProductRules: true,
  inactiveProducts: 'allow',
  showSoldOut: true,
  giftCodes: false,
  rerollEnabled: true,
  rerollLimit: 3,
  rerollFree: 1,
  rerollCurrency: '',
  rerollCost: 0n,
  rerollCostStep: 0n,
  rerollAvoidCurrent: true,
  entryEnabled: true,
  entryMaxActive: 1,
  entryTimerStart: 'list',
};
async function offerSettings(p: Partial<OfferSettingsArgs>) {
  await o.conn.reducers.adminSaveOfferSettings({ ...DEFAULT_OFFER_SETTINGS, ...p });
}
async function tag(key: string) {
  await o.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key, title: tr(key), color: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.tag.iter()).some(x => x.key === key && x.keyType === 'user'));
  return rows(o.conn.db.tag.iter()).find(x => x.key === key && x.keyType === 'user')!.id;
}
async function payInBrowser(url: string) {
  const { chromium } = await import(PW);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('button', { name: 'پرداخت' }).first().click({ timeout: 20000 });
    await page.waitForURL(/example\.com/, { timeout: 30000 });
    return page.url();
  } finally {
    await browser.close();
  }
}
const rid = () => `r${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function main() {
  o = await c();
  await loginOwner(o);
  await clock(0);
  await offerSettings({});

  check('item types seeded', ['avatar', 'skin', 'frame', 'booster', 'emote'].every(t => rows(o.conn.db.itemType.iter()).some(x => x.key === t && x.isSystem)));
  check('skin is an exclusive slot, booster not equippable', rows(o.conn.db.itemType.iter()).find(x => x.key === 'skin')?.slots === 1 && rows(o.conn.db.itemType.iter()).find(x => x.key === 'booster')?.slots === 0);
  check('item key type seeded', rows(o.conn.db.keyType.iter()).some(x => x.key === 'item'));
  check('item event types seeded', ['item_bought', 'item_unlocked', 'item_upgraded', 'item_equipped', 'item_used', 'offer_bought'].every(key => rows(o.conn.db.eventType.iter()).some(x => x.key === key && x.isSystem && !x.clientAllowed)));
  check('items settings defaults', await waitFor(() => {
    const s = rows(o.conn.db.adminItemsSettings.iter())[0];
    return !!s && s.hideBoughtOneTime && s.hideAboveMaxLevel && s.requestTtlHours === 24 && s.clockOffsetSec === 0n;
  }));
  check('offer settings defaults', await waitFor(() => {
    const s = rows(o.conn.db.adminOfferSettings.iter())[0];
    return !!s && s.count === 3 && s.periodDays === 1 && s.entryTimerStart === 'list' && s.rerollLimit === 3;
  }));

  await o.conn.reducers.adminSaveCurrency({ id: 0n, key: gold, name: tr('طلا'), type: 'soft', defaultValue: 1000n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.currency.iter()).some(x => x.key === gold));
  const xp = k('xp');
  const gems = k('gems');
  for (const m of [xp, gems]) {
    await o.conn.reducers.adminSaveMeta({ id: 0n, key: m, name: tr(m), defaultValue: 0, serverOnly: false });
    await waitFor(() => rows(o.conn.db.meta.iter()).some(x => x.key === m));
  }
  await o.conn.reducers.adminSaveLevelTable({ id: 0n, key: k('lt'), name: tr('سطح'), description: [], metaKey: xp, levelMetaKey: '', steps: [{ level: 1, threshold: 10, title: [], prizeId: 0n, grantMode: 'auto' }, { level: 2, threshold: 100, title: [], prizeId: 0n, grantMode: 'auto' }], isActive: true, sort: 0 });
  await waitFor(() => rows(o.conn.db.adminLevelTables.iter()).some(x => x.key === k('lt')));
  const lt = rows(o.conn.db.adminLevelTables.iter()).find(x => x.key === k('lt'))!.id;

  await o.conn.reducers.adminSavePaymentMethod({ method: 'in_app', isActive: true, config: '{}' });
  await o.conn.reducers.adminSavePaymentMethod({ method: 'zarinpal', isActive: true, config: JSON.stringify({ merchantId: '', sandbox: true }) });
  await o.conn.reducers.adminSavePaymentMethod({ method: 'bazaar', isActive: true, config: JSON.stringify({ packageName: 'ir.example.game', apiSecret: 'very-secret-api', rsaPublicKey: '', sandbox: true }) });
  await o.conn.reducers.adminSaveEconomySettings({ publicBaseUrl: BASE, redirectUrl: 'https://example.com/pay?ok={success}&p={paymentId}', pendingTtlMinutes: 45 });

  const pGold = await prize(k('p_gold'), [{ type: 'currency', key: gold, action: 'add', value: 5 }]);
  check('bad rarity refused', (await errorOf(item(k('bad'), { rarity: 'mythic' }))).includes('INVALID_RARITY'));
  check('unknown item type refused', (await errorOf(item(k('bad'), { typeKey: 'nope' }))).includes('ITEM_TYPE_NOT_FOUND'));
  check('stackable item cannot have upgrades', (await errorOf(item(k('bad'), { stackable: true, upgrades: [{ currencyKey: gold, amount: 1n }] }))).includes('STACKABLE_NO_UPGRADES'));
  check('starter cannot need a level', (await errorOf(item(k('bad'), { isStarter: true, unlockLevel: 2 }))).includes('STARTER_HAS_LEVEL'));
  check('price with unknown currency refused', (await errorOf(item(k('bad'), { price: { currencyKey: 'nope', amount: 5n } }))).includes('CURRENCY_NOT_FOUND'));

  const starter = await item(k('starter_skin'), { isStarter: true, rarity: 'common' });
  const potion = await item(k('potion'), { typeKey: 'booster', stackable: true, maxStack: 20, isStarter: true, starterQuantity: 3, price: { currencyKey: gold, amount: 10n }, usePrizeId: pGold });
  const skinA = await item(k('skin_a'), { rarity: 'rare', price: { currencyKey: gold, amount: 100n }, upgrades: [{ currencyKey: gold, amount: 50n }, { currencyKey: gold, amount: 80n }], services: [{ key: 'polish', name: tr('براق'), currencyKey: gold, unitPrice: 5n, maxUnits: 3, prizeId: 0n }] });
  const skinB = await item(k('skin_b'), { rarity: 'epic' });
  const frame = await item(k('frame'), { typeKey: 'frame', levelTableId: lt, unlockLevel: 2 });
  const addon = await item(k('addon'), { typeKey: 'other', requiresKey: skinA.key, price: { currencyKey: gold, amount: 30n } });
  check('self reference refused', (await errorOf(item(k('addon'), { typeKey: 'other', requiresKey: k('addon') }))).includes('SELF_REFERENCE'));

  check('item prize with unknown item refused', (await errorOf(prize(k('p_bad'), [{ type: 'item', key: 'nope', action: 'give', value: 1 }]))).includes('ITEM_NOT_FOUND'));
  const pSkinB = await prize(k('p_skin_b'), [{ type: 'item', key: skinB.key, action: 'give', value: 1 }]);
  const pPotions = await prize(k('p_potions'), [{ type: 'item', key: potion.key, action: 'give', value: 5 }]);

  const { p: p1, id: id1, phone: phone1 } = await player();
  check('starter items given at login', await waitFor(() => inv(p1, starter.key)?.quantity === 1 && inv(p1, potion.key)?.quantity === 3));
  check('first starter of an equip slot is equipped', inv(p1, starter.key)?.equipped === true && inv(p1, potion.key)?.equipped === false);
  check('player cannot save items', (await errorOf(p1.conn.reducers.adminSaveItemType({ id: 0n, key: k('hack'), name: tr('x'), slots: 1, sort: 0 }))).includes('FORBIDDEN'));
  check('player cannot move the items clock', (await errorOf(p1.conn.reducers.adminSetItemsClockOffset({ seconds: 1n }))).includes('FORBIDDEN'));
  const again = await c(p1.token);
  await login(again, phone1);
  await p1.conn.reducers.syncItems({});
  check('starter items given once', await waitFor(() => inv(p1, starter.key)?.quantity === 1 && inv(p1, potion.key)?.quantity === 3), inv(p1, potion.key));
  again.conn.disconnect();

  const g1 = await o.conn.procedures.adminGrantPrize({ accountId: id1, prizeId: pSkinB, note: '' });
  check('item prize gives the item', g1.length === 1 && g1[0].type === 'item' && g1[0].value === 1 && (await waitFor(() => inv(p1, skinB.key)?.quantity === 1)), g1);
  const g2 = await o.conn.procedures.adminGrantPrize({ accountId: id1, prizeId: pSkinB, note: '' });
  check('unique item prize twice is a no-op', g2[0].value === 0 && inv(p1, skinB.key)?.quantity === 1, g2);
  await o.conn.procedures.adminGrantPrize({ accountId: id1, prizeId: pPotions, note: '' });
  check('stackable item prize adds quantity', await waitFor(() => inv(p1, potion.key)?.quantity === 8));
  check('item used by a prize cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteItem({ id: skinB.id }))).includes('IN_USE'));

  const b1 = await p1.conn.procedures.itemBuy({ key: skinA.key, quantity: 1, requestId: '' });
  check('buy an item with currency', b1.itemKey === skinA.key && b1.quantity === 1 && b1.paid[0]?.amount === 100n && (await waitFor(() => bal(p1) === 900n)), b1);
  check('unique item cannot be bought twice', (await errorOf(p1.conn.procedures.itemBuy({ key: skinA.key, quantity: 1, requestId: '' }))).includes('ALREADY_OWNED'));
  check('item without price is not for sale', (await errorOf(p1.conn.procedures.itemBuy({ key: skinB.key, quantity: 1, requestId: '' }))).includes('NOT_FOR_SALE'));
  const r1 = rid();
  const b2 = await p1.conn.procedures.itemBuy({ key: potion.key, quantity: 2, requestId: r1 });
  const b3 = await p1.conn.procedures.itemBuy({ key: potion.key, quantity: 2, requestId: r1 });
  check('request id replays without a second charge', !b2.replayed && b3.replayed && b3.quantity === 10 && (await waitFor(() => bal(p1) === 880n && inv(p1, potion.key)?.quantity === 10)), [b2, b3]);
  check('request id reused for another action refused', (await errorOf(p1.conn.procedures.itemBuy({ key: potion.key, quantity: 3, requestId: r1 }))).includes('REQUEST_ID_REUSED'));
  check('stack limit refused', (await errorOf(p1.conn.procedures.itemBuy({ key: potion.key, quantity: 11, requestId: '' }))).includes('STACK_FULL'));
  await o.conn.reducers.adminAdjust({ accountId: id1, kind: 'currency', key: gold, action: 'set', value: 5, note: '' });
  check('insufficient balance', (await errorOf(p1.conn.procedures.itemBuy({ key: addon.key, quantity: 1, requestId: '' }))).includes('INSUFFICIENT_BALANCE') && !inv(p1, addon.key));
  await o.conn.reducers.adminAdjust({ accountId: id1, kind: 'currency', key: gold, action: 'set', value: 1000, note: '' });
  await waitFor(() => bal(p1) === 1000n);
  await o.conn.reducers.adminTakeItem({ accountId: id1, itemId: potion.id, quantity: 10, note: '' });
  await waitFor(() => (inv(p1, potion.key)?.quantity ?? 0) === 0);

  const u1 = await p1.conn.procedures.itemUpgrade({ key: skinA.key, fromLevel: 0, requestId: '' });
  check('upgrade with the per-level cost', u1.level === 1 && u1.paid[0]?.amount === 50n && (await waitFor(() => bal(p1) === 950n)), u1);
  check('upgrade from a stale level refused', (await errorOf(p1.conn.procedures.itemUpgrade({ key: skinA.key, fromLevel: 0, requestId: '' }))).includes('UPGRADE_CHANGED'));
  const u2 = await p1.conn.procedures.itemUpgrade({ key: skinA.key, fromLevel: -1, requestId: '' });
  check('second level costs its own price', u2.level === 2 && u2.paid[0]?.amount === 80n && (await waitFor(() => bal(p1) === 870n)), u2);
  check('upgrade past the last level refused', (await errorOf(p1.conn.procedures.itemUpgrade({ key: skinA.key, fromLevel: -1, requestId: '' }))).includes('UPGRADE_MAXED'));
  check('upgrade of an unowned item refused', (await errorOf(p1.conn.procedures.itemUpgrade({ key: frame.key, fromLevel: -1, requestId: '' }))).includes('NOT_OWNED'));

  const e1 = await p1.conn.procedures.itemEquip({ key: skinA.key });
  check('equip takes the exclusive slot', e1.slot === 'skin' && e1.unequipped.includes(starter.key) && (await waitFor(() => inv(p1, skinA.key)?.equipped === true && inv(p1, starter.key)?.equipped === false)), e1);
  const e2 = await p1.conn.procedures.itemEquip({ key: skinB.key });
  check('second skin replaces the first', e2.unequipped.join() === skinA.key && (await waitFor(() => rows(p1.conn.db.myInventory.iter()).filter(r => r.slot === 'skin' && r.equipped).length === 1 && inv(p1, skinB.key)?.equipped === true)), e2);
  await p1.conn.procedures.itemBuy({ key: potion.key, quantity: 4, requestId: '' });
  check('booster type cannot be equipped', (await errorOf(p1.conn.procedures.itemEquip({ key: potion.key }))).includes('NOT_EQUIPPABLE'));
  check('unowned item cannot be equipped', (await errorOf(p1.conn.procedures.itemEquip({ key: frame.key }))).includes('NOT_OWNED'));
  const ue = await p1.conn.procedures.itemUnequip({ key: skinB.key });
  check('unequip frees the slot', !ue.equipped && (await waitFor(() => rows(p1.conn.db.myInventory.iter()).filter(r => r.slot === 'skin' && r.equipped).length === 0)));

  check('use needs a request id', (await errorOf(p1.conn.procedures.itemUse({ key: potion.key, service: '', units: 1, requestId: '' }))).includes('REQUEST_ID_REQUIRED'));
  const before = bal(p1);
  const us = await p1.conn.procedures.itemUse({ key: potion.key, service: '', units: 2, requestId: rid() });
  check('consumable use takes units and pays its effect', us.quantity === 2 && us.rewards.length === 2 && (await waitFor(() => bal(p1) === before + 10n)), us);
  check('more units than owned refused', (await errorOf(p1.conn.procedures.itemUse({ key: potion.key, service: '', units: 3, requestId: rid() }))).includes('NOT_ENOUGH_ITEMS'));
  check('unique item is not consumable', (await errorOf(p1.conn.procedures.itemUse({ key: skinA.key, service: '', units: 1, requestId: rid() }))).includes('NOT_CONSUMABLE'));
  const sv = await p1.conn.procedures.itemUse({ key: skinA.key, service: 'polish', units: 2, requestId: rid() });
  check('item service charges per unit', sv.paid[0]?.amount === 10n && (await waitFor(() => bal(p1) === before)), sv);
  check('service units above the cap refused', (await errorOf(p1.conn.procedures.itemUse({ key: skinA.key, service: 'polish', units: 4, requestId: rid() }))).includes('INVALID_UNITS'));
  check('unknown service refused', (await errorOf(p1.conn.procedures.itemUse({ key: skinA.key, service: 'nope', units: 1, requestId: rid() }))).includes('SERVICE_NOT_FOUND'));

  check('unlock below the level refused', (await errorOf(p1.conn.procedures.itemUnlock({ key: frame.key }))).includes('LEVEL_TOO_LOW'));
  check('bought item is not unlockable', (await errorOf(p1.conn.procedures.itemUnlock({ key: skinA.key }))).includes('NOT_UNLOCKABLE'));
  const cat0 = await p1.conn.procedures.myItems({ typeKey: '' });
  const fr0 = cat0.items.find(x => x.key === frame.key)!;
  check('catalog shows the locked item', fr0.locked && !fr0.canUnlock && fr0.unlockLevel === 2 && fr0.playerLevel === 0, fr0);
  await o.conn.reducers.adminAdjust({ accountId: id1, kind: 'meta', key: xp, action: 'set', value: 100, note: '' });
  const un = await p1.conn.procedures.itemUnlock({ key: frame.key });
  check('unlock at the level', un.quantity === 1 && (await waitFor(() => inv(p1, frame.key)?.source === 'unlock')), un);
  check('unlock twice refused', (await errorOf(p1.conn.procedures.itemUnlock({ key: frame.key }))).includes('ALREADY_OWNED'));
  const cat = await p1.conn.procedures.myItems({ typeKey: 'skin' });
  const ca = cat.items.find(x => x.key === skinA.key)!;
  check('catalog flags for an owned maxed skin', cat.items.every(x => x.typeKey === 'skin') && ca.owned && ca.level === 2 && ca.maxLevel === 2 && !ca.canBuy && !ca.canUpgrade && ca.equippable, ca);

  const { p: p2, id: id2 } = await player();
  check('required item missing', (await errorOf(p2.conn.procedures.itemBuy({ key: addon.key, quantity: 1, requestId: '' }))).includes('REQUIRES_ITEM'));
  check('starter item cannot be taken back', (await errorOf(o.conn.reducers.adminTakeItem({ accountId: id2, itemId: starter.id, quantity: 1, note: '' }))).includes('STARTER_ITEM'));
  await o.conn.reducers.adminGiveItem({ accountId: id2, itemId: skinA.id, quantity: 1, note: 'test' });
  check('admin gives an item', await waitFor(() => inv(p2, skinA.key)?.source === 'admin'));
  check('admin give of an owned unique item refused', (await errorOf(o.conn.reducers.adminGiveItem({ accountId: id2, itemId: skinA.id, quantity: 1, note: '' }))).includes('ALREADY_OWNED'));
  const ui = await o.conn.procedures.adminUserItems({ accountId: id1 });
  check('admin sees inventory and uses', ui.inventory.length >= 5 && ui.uses.length === 2);
  const ai = await o.conn.procedures.adminItems({ query: skinA.key, typeKey: '', isActive: '', page: 1, pageSize: 10 });
  check('admin item list with owners', ai.total === 1 && ai.rows[0].owners === 2, ai.rows[0]);

  const prodOnce = await product(k('once'), pGold, { coinAmount: 10n });
  await rule(prodOnce, { isOneTime: true, purchaseMessage: tr('ممنون') });
  check('shop flags before purchase', await waitFor(() => {
    const f = rows(p2.conn.db.shopFlags.iter()).find(x => x.productId === prodOnce);
    return !!f && f.isOneTime && !f.bought && f.purchaseCount === 0 && f.purchaseMessage[0]?.text === 'ممنون';
  }));
  await p2.conn.procedures.purchaseStart({ productId: prodOnce, method: 'in_app', giftCode: '' });
  check('one-time product refused at start', (await errorOf(p2.conn.procedures.purchaseStart({ productId: prodOnce, method: 'in_app', giftCode: '' }))).includes('PRODUCT_ALREADY_BOUGHT'));
  check('bought one-time product leaves the shop, flags say bought', await waitFor(() => !rows(p2.conn.db.shop.iter()).some(x => x.id === prodOnce) && rows(p2.conn.db.shopFlags.iter()).find(x => x.productId === prodOnce)?.bought === true));

  const prodStore = await product(k('once_store'), pGold, { priceToman: 5000n, paymentMethods: ['bazaar'], skuBazaar: k('sku') });
  await rule(prodStore, { isOneTime: true });
  const s1 = await p2.conn.procedures.purchaseStart({ productId: prodStore, method: 'bazaar', giftCode: '' });
  const s2 = await p2.conn.procedures.purchaseStart({ productId: prodStore, method: 'bazaar', giftCode: '' });
  const ss1 = await p2.conn.procedures.purchaseSubmit({ paymentId: s1.paymentId, token: `sandbox-${s1.paymentId}-a` });
  const ss2 = await p2.conn.procedures.purchaseSubmit({ paymentId: s2.paymentId, token: `sandbox-${s2.paymentId}-b` });
  check('first parallel one-time payment delivered', ss1.status === 'success' && ss1.rewardGranted, ss1);
  check('second one-time payment refused at settlement', ss2.status === 'refused' && !ss2.rewardGranted && ss2.error === 'PRODUCT_ALREADY_BOUGHT', ss2);
  check('refused payment is not retried', (await errorOf(o.conn.procedures.adminRetryGrant({ id: s2.paymentId }))).includes('NOTHING_TO_RETRY'));

  const prodMax = await product(k('max'), pGold, { coinAmount: 1n });
  await rule(prodMax, { maxLevel: 1, levelTableId: lt });
  const prodMin = await product(k('min'), pGold, { coinAmount: 1n });
  await rule(prodMin, { minLevel: 3, levelTableId: lt });
  check('max level refused above it', (await errorOf(p1.conn.procedures.purchaseStart({ productId: prodMax, method: 'in_app', giftCode: '' }))).includes('LEVEL_TOO_HIGH'));
  check('max level hides the product', await waitFor(() => !rows(p1.conn.db.shop.iter()).some(x => x.id === prodMax) && rows(p1.conn.db.shopFlags.iter()).find(x => x.productId === prodMax)?.aboveMaxLevel === true));
  check('max level allows a low player', (await p2.conn.procedures.purchaseStart({ productId: prodMax, method: 'in_app', giftCode: '' })).status === 'success');
  check('min level refused below it', (await errorOf(p1.conn.procedures.purchaseStart({ productId: prodMin, method: 'in_app', giftCode: '' }))).includes('LEVEL_TOO_LOW'));
  check('min level shows levelLocked', await waitFor(() => rows(p1.conn.db.shopFlags.iter()).find(x => x.productId === prodMin)?.levelLocked === true && rows(p1.conn.db.shop.iter()).some(x => x.id === prodMin)));
  const prodSkin = await product(k('skin_pack'), pSkinB, { coinAmount: 1n });
  check('owned contents refused', (await errorOf(p1.conn.procedures.purchaseStart({ productId: prodSkin, method: 'in_app', giftCode: '' }))).includes('PRIZE_ALREADY_OWNED'));
  check('owned flag in the shop', await waitFor(() => rows(p1.conn.db.shopFlags.iter()).find(x => x.productId === prodSkin)?.owned === true && rows(p1.conn.db.shopFlags.iter()).find(x => x.productId === prodSkin)?.itemKeys.join() === skinB.key));
  const pAddon = await prize(k('p_addon'), [{ type: 'item', key: addon.key, action: 'give', value: 1 }]);
  const prodAddon = await product(k('addon_pack'), pAddon, { coinAmount: 1n });
  const { p: p5 } = await player();
  check('contents needing a missing item refused', (await errorOf(p5.conn.procedures.purchaseStart({ productId: prodAddon, method: 'in_app', giftCode: '' }))).includes('REQUIRES_ITEM') && rows(p5.conn.db.shopFlags.iter()).find(x => x.productId === prodAddon)?.requiresItem === true);
  await rule(prodSkin, { checkContents: false });
  check('contents check can be switched off', (await p1.conn.procedures.purchaseStart({ productId: prodSkin, method: 'in_app', giftCode: '' })).status === 'success');
  const counts = await p2.conn.procedures.myPurchases();
  check('purchase counts', counts.find(x => x.productId === prodOnce)?.count === 1 && counts.find(x => x.productId === prodStore)?.count === 1 && counts.find(x => x.productId === prodMax)?.count === 1, counts);
  check('shop purchase count flag', await waitFor(() => rows(p2.conn.db.shopFlags.iter()).find(x => x.productId === prodStore)?.purchaseCount === 1));
  check('player cannot save product rules', (await errorOf(p1.conn.reducers.adminSaveProductRule({ productId: prodMax, minLevel: 0, maxLevel: 0, levelTableId: 0n, isOneTime: false, checkContents: true, purchaseMessage: [] }))).includes('FORBIDDEN'));
  check('bad level range refused', (await errorOf(rule(prodMax, { minLevel: 5, maxLevel: 2 }))).includes('INVALID_LEVEL_RANGE'));

  const runTag = await tag(k('offers'));
  const vipTag = await tag(k('vip'));
  const prodPack = await product(k('pack'), pGold, { priceToman: 1000n, coinAmount: 100n, paymentMethods: ['in_app', 'zarinpal'] });
  const prodHidden = await product(k('hidden'), pGold, { coinAmount: 40n, isActive: false });
  check('offer on unknown product refused', (await errorOf(offer(k('bad_offer'), { productId: 999999n }))).includes('PRODUCT_NOT_FOUND'));
  check('offer price under 100 toman refused', (await errorOf(offer(k('bad_offer'), { productId: prodPack, priceMode: 'price', priceToman: 50n }))).includes('INVALID_PRICE'));
  check('entry offer needs a trigger', (await errorOf(offer(k('bad_offer'), { productId: prodPack, kind: 'entry', triggerType: 'nope' }))).includes('INVALID_TRIGGER'));
  const daily: bigint[] = [];
  for (let i = 0; i < 6; i++) daily.push(await offer(k(`daily${i}`), { productId: prodPack, audienceTagIds: [runTag], weight: 10 + i }));
  await offer(k('daily_excluded'), { productId: prodPack, audienceTagIds: [runTag], excludeTagIds: [vipTag], weight: 1_000_000 });
  await offerSettings({ count: 2, fillWithRepeats: false, rerollCurrency: gold, rerollCost: 20n, rerollCostStep: 10n, rerollFree: 1, rerollLimit: 3, entryMaxActive: 10 });

  const { p: p3, id: id3 } = await player([runTag, vipTag]);
  const o1 = await p3.conn.procedures.myOffers();
  const ids1 = o1.daily.items.map(x => x.offerId);
  check('daily set drawn with the configured count', o1.daily.enabled && o1.daily.items.length === 2 && ids1.every(id => daily.includes(id)), ids1);
  check('excluded tag keeps an offer out', !o1.daily.items.some(x => x.key === k('daily_excluded')));
  check('daily price frozen at half', o1.daily.items.every(x => x.finalToman === 500n && x.originalToman === 1000n && x.coinAmount === 50n && x.coinOriginal === 100n && x.discountPercent === 50 && x.paymentMethods.includes('in_app') && x.paymentMethods.includes('zarinpal')), o1.daily.items[0]);
  check('daily countdown to the period end', o1.daily.secondsLeft > 0n && o1.daily.secondsLeft <= 86400n && o1.daily.items[0].expiresAt === o1.daily.periodEnd);
  const o2 = await p3.conn.procedures.myOffers();
  check('daily set stable within the period', o2.daily.items.map(x => x.userOfferId).join() === o1.daily.items.map(x => x.userOfferId).join());
  const seen = await p3.conn.procedures.offerSeen({ userOfferId: o1.daily.items[0].userOfferId });
  check('mark a daily offer seen', seen.expiresAt === o1.daily.periodEnd && (await p3.conn.procedures.myOffers()).daily.items[0].shownAt > 0n);
  const view = await o.conn.procedures.adminPlayerOffers({ accountId: id3 });
  check('admin sees the copies', view.copies.length === 2 && view.period === o1.daily.period);

  await clock(DAY);
  const o3 = await p3.conn.procedures.myOffers();
  const ids3 = o3.daily.items.map(x => x.offerId);
  check('next period draws a new set without repeats', o3.daily.period === o1.daily.period + 1n && o3.daily.items.length === 2 && ids3.every(id => !ids1.includes(id)), [ids1, ids3]);
  check('old period copy cannot be bought', (await errorOf(p3.conn.procedures.offerBuy({ userOfferId: o1.daily.items[1].userOfferId, method: 'in_app', giftCode: '' }))).includes('OFFER_EXPIRED'));

  const g0 = bal(p3);
  const rr1 = await p3.conn.procedures.offersReroll();
  const idsR1 = rr1.daily.items.map(x => x.offerId);
  check('first reroll is free and avoids the current offers', rr1.paid?.amount === 0n && rr1.daily.items.length === 2 && idsR1.every(id => !ids3.includes(id)) && bal(p3) === g0 && rr1.daily.reroll.used === 1 && rr1.daily.reroll.nextCost === 20n, [idsR1, rr1.paid]);
  const rr2 = await p3.conn.procedures.offersReroll();
  check('second reroll is paid', rr2.paid?.amount === 20n && rr2.paid.currencyKey === gold && (await waitFor(() => bal(p3) === g0 - 20n)) && rr2.daily.reroll.nextCost === 30n, rr2.paid);
  const rr3 = await p3.conn.procedures.offersReroll();
  check('third reroll costs one step more', rr3.paid?.amount === 30n && (await waitFor(() => bal(p3) === g0 - 50n)) && rr3.daily.reroll.left === 0);
  check('reroll limit', (await errorOf(p3.conn.procedures.offersReroll())).includes('REROLL_LIMIT'));
  check('failed reroll costs nothing', bal(p3) === g0 - 50n);

  const [d1, d2] = rr3.daily.items;
  const gb = bal(p3);
  const buy1 = await p3.conn.procedures.offerBuy({ userOfferId: d1.userOfferId, method: 'in_app', giftCode: '' });
  check('offer bought with coins at the frozen price', buy1.status === 'success' && (await waitFor(() => bal(p3) === gb - 50n + 5n)), buy1);
  const pay1 = await o.conn.procedures.adminPayment({ id: buy1.paymentId });
  check('payment carries the offer price', pay1.row.payment.coinAmount === 50n && pay1.row.payment.productId === prodPack && pay1.row.payment.discountPercent === 50, pay1.row.payment);
  check('per-offer limit', (await errorOf(p3.conn.procedures.offerBuy({ userOfferId: d1.userOfferId, method: 'in_app', giftCode: '' }))).includes('OFFER_SOLD_OUT'));
  const o4 = await p3.conn.procedures.myOffers();
  check('sold-out offer stays listed', o4.daily.items.find(x => x.userOfferId === d1.userOfferId)?.soldOut === true && o4.daily.items.find(x => x.userOfferId === d1.userOfferId)?.bought === 1);
  check('gift codes do not stack on offers', (await errorOf(p3.conn.procedures.offerBuy({ userOfferId: d2.userOfferId, method: 'zarinpal', giftCode: 'ANY' }))).includes('GIFT_NOT_ALLOWED'));
  check('another player cannot buy my copy', (await errorOf(p2.conn.procedures.offerBuy({ userOfferId: d2.userOfferId, method: 'in_app', giftCode: '' }))).includes('OFFER_NOT_FOUND'));
  const z = await p3.conn.procedures.offerBuy({ userOfferId: d2.userOfferId, method: 'zarinpal', giftCode: '' });
  const zp = await o.conn.procedures.adminPayment({ id: z.paymentId });
  check('zarinpal gets the offer price', z.status === 'redirect' && zp.row.payment.finalToman === 500n && zp.row.payment.amountRial === 5000n && zp.row.payment.originalToman === 1000n, zp.row.payment);
  const landed = await payInBrowser(z.redirectUrl);
  const zs = await p3.conn.procedures.purchaseStatus({ paymentId: z.paymentId });
  check('zarinpal offer payment delivered', landed.includes('ok=true') && zs.status === 'success' && zs.rewardGranted, zs);
  const o5 = await p3.conn.procedures.myOffers();
  check('delivered gateway purchase counts for the offer', o5.daily.items.find(x => x.userOfferId === d2.userOfferId)?.soldOut === true);
  check('reroll limit holds after buys', (await errorOf(p3.conn.procedures.offersReroll())).includes('REROLL_LIMIT'));
  check('offer with copies bought cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteOffer({ id: d1.offerId }))).includes('IN_USE'));

  const first = await offer(k('e_first'), { kind: 'entry', productId: prodHidden, audienceTagIds: [runTag], triggerType: 'first_entry', priceMode: 'price', coinAmount: 7n, purchaseLimit: 2, durationMinutes: 60, sort: 1 });
  const lvl = await offer(k('e_level'), { kind: 'entry', productId: prodHidden, audienceTagIds: [runTag], triggerType: 'level', triggerRefId: lt, triggerValue: 2, discountPercent: 0, sort: 2 });
  const met = await offer(k('e_meta'), { kind: 'entry', productId: prodHidden, audienceTagIds: [runTag], triggerType: 'meta', triggerMetaKey: gems, triggerValue: 5, discountPercent: 0, sort: 3 });
  const tg = await offer(k('e_tag'), { kind: 'entry', productId: prodHidden, audienceTagIds: [runTag], triggerType: 'tag', triggerRefId: vipTag, discountPercent: 0, sort: 4 });
  const age = await offer(k('e_age'), { kind: 'entry', productId: prodHidden, audienceTagIds: [runTag], triggerType: 'account_days', triggerValue: 3, discountPercent: 0, durationMinutes: 60, repeat: 'cooldown', cooldownHours: 1, maxTriggers: 2, sort: 5 });
  const lap = await offer(k('e_lapsed'), { kind: 'entry', productId: prodHidden, audienceTagIds: [runTag], triggerType: 'lapsed', triggerValue: 7, discountPercent: 0, sort: 6 });
  const entryKeys = (a: { entry: { items: { offerId: bigint }[] } }) => a.entry.items.map(x => x.offerId);

  const { p: p4, id: id4, phone: phone4 } = await player([runTag]);
  check('inactive product is not sold in the shop', (await errorOf(p4.conn.procedures.purchaseStart({ productId: prodHidden, method: 'in_app', giftCode: '' }))).includes('PRODUCT_NOT_FOUND'));
  const e1a = await p4.conn.procedures.myOffers();
  const fe = e1a.entry.items.find(x => x.offerId === first)!;
  check('first entry offer fires', !!fe && fe.started && fe.coinAmount === 7n && fe.purchaseLimit === 2, e1a.entry.items);
  check('first entry countdown', fe.secondsLeft > 3500n && fe.secondsLeft <= 3600n && fe.durationMinutes === 60, fe.secondsLeft);
  check('other triggers wait', ![lvl, met, tg, age, lap].some(id => entryKeys(e1a).includes(id)), entryKeys(e1a));
  const eb1 = await p4.conn.procedures.offerBuy({ userOfferId: fe.userOfferId, method: 'in_app', giftCode: '' });
  const eb2 = await p4.conn.procedures.offerBuy({ userOfferId: fe.userOfferId, method: 'in_app', giftCode: '' });
  check('entry offer of an offer-only product bought up to its limit', eb1.status === 'success' && eb2.status === 'success' && (await waitFor(() => bal(p4) === 1000n - 14n + 10n)));
  check('entry offer limit', (await errorOf(p4.conn.procedures.offerBuy({ userOfferId: fe.userOfferId, method: 'in_app', giftCode: '' }))).includes('OFFER_SOLD_OUT'));

  await o.conn.reducers.adminAdjust({ accountId: id4, kind: 'meta', key: xp, action: 'set', value: 100, note: '' });
  const e1b = await p4.conn.procedures.myOffers();
  check('level trigger fires', entryKeys(e1b).includes(lvl) && !entryKeys(e1b).includes(met));
  const lv = e1b.entry.items.find(x => x.offerId === lvl)!;
  check('level offer countdown', lv.secondsLeft > 86000n && lv.secondsLeft <= 86400n);
  await o.conn.reducers.adminAdjust({ accountId: id4, kind: 'meta', key: gems, action: 'set', value: 5, note: '' });
  check('meta trigger fires', entryKeys(await p4.conn.procedures.myOffers()).includes(met));
  await o.conn.reducers.adminSetPlayerTags({ accountId: id4, tagIds: [runTag, vipTag] });
  const e1c = await p4.conn.procedures.myOffers();
  check('tag trigger fires', entryKeys(e1c).includes(tg) && !entryKeys(e1c).includes(age) && !entryKeys(e1c).includes(lap));
  check('sold-out first entry offer still listed', e1c.entry.items.find(x => x.offerId === first)?.soldOut === true);

  await offerSettings({ count: 2, fillWithRepeats: false, entryMaxActive: 10, entryTimerStart: 'seen' });
  await clock(12 * DAY);
  const pl4 = await c();
  await login(pl4, phone4);
  const e2a = await pl4.conn.procedures.myOffers();
  check('expired entry offers are gone for good', ![first, lvl, met, tg].some(id => entryKeys(e2a).includes(id)), entryKeys(e2a));
  const ag = e2a.entry.items.find(x => x.offerId === age);
  const lp = e2a.entry.items.find(x => x.offerId === lap);
  check('account age trigger fires', !!ag);
  check('lapsed return trigger fires', !!lp);
  check('seen mode waits for the client', !!ag && !ag.started && ag.expiresAt === 0n);
  const sa = await pl4.conn.procedures.offerSeen({ userOfferId: ag!.userOfferId });
  check('seen starts the countdown', sa.secondsLeft > 3500n && sa.secondsLeft <= 3600n, sa);
  await clock(12 * DAY + 3 * HOUR);
  const e2b = await pl4.conn.procedures.myOffers();
  const ag2 = e2b.entry.items.find(x => x.offerId === age);
  check('cooldown offer opens again after its cooldown', !!ag2 && ag2.userOfferId !== ag!.userOfferId, ag2);
  await pl4.conn.procedures.offerSeen({ userOfferId: ag2!.userOfferId });
  await clock(12 * DAY + 6 * HOUR);
  check('max triggers stop the repeat', !entryKeys(await pl4.conn.procedures.myOffers()).includes(age));
  await o.conn.reducers.adminResetEntryOffer({ accountId: id4, offerId: age });
  check('admin reset lets the trigger open it again', entryKeys(await pl4.conn.procedures.myOffers()).includes(age));
  await o.conn.reducers.adminResetDailyOffers({ accountId: id3 });
  const o6 = await p3.conn.procedures.myOffers();
  check('admin reset draws the daily set again', o6.daily.items.length === 2 && o6.daily.items.every(x => x.bought === 0));

  await offerSettings({});
  await clock(0);
  await item(starter.key, { isStarter: true, isActive: false });
  await item(potion.key, { typeKey: 'booster', stackable: true, maxStack: 20, isStarter: true, starterQuantity: 3, price: { currencyKey: gold, amount: 10n }, usePrizeId: pGold, isActive: false });
  check('items clock back at zero', rows(o.conn.db.adminItemsSettings.iter())[0]?.clockOffsetSec === 0n);
  check('player sees no admin offers', rows(p3.conn.db.adminOffers.iter()).length === 0 && rows(p3.conn.db.adminOfferSettings.iter()).length === 0);
  void DB;
  done('items');
}

main().catch(async e => {
  console.error('ERROR', e);
  try {
    await clock(0);
    await offerSettings({});
  } catch {}
  process.exit(1);
});
