import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { Translations, loginHooks, logActivity, audit, cleanKey, cleanTranslations, fail, requireAccount, requireRole, toLatinDigits, type Tr, type Tx } from '@stg/base';
import { GroupEntry, PrizeItem, economyRows, type EconomySchema } from './schema';
import { addMeta, asAny, balanceOf, changeBalance, ensureDefaults, extraItemTypes, grantPrize, metaValue, setMeta, type ETx, type Reward } from './engine';

export const METHODS = ['zarinpal', 'zibal', 'bazaar', 'myket', 'in_app'] as const;
export const GATEWAYS = ['zarinpal', 'zibal'];
export const STORES = ['bazaar', 'myket'];

const RewardRow = t.object('RewardRow', { type: t.string(), key: t.string(), action: t.string(), value: t.f64(), prizeKey: t.string() });
const RedeemResult = t.object('RedeemResult', { rewards: t.array(RewardRow), giftName: Translations });

const WalletView = t.row('WalletEntry', { currencyKey: t.string().primaryKey(), balance: t.i64() });
const MetaView = t.row('MetaEntry', { metaKey: t.string().primaryKey(), value: t.f64() });
const ShopRow = t.row('ShopProduct', {
  id: t.u64().primaryKey(),
  key: t.string(),
  name: Translations,
  description: Translations,
  categoryId: t.u64(),
  tagIds: t.array(t.u64()),
  priceToman: t.i64(),
  finalToman: t.i64(),
  coinCurrency: t.string(),
  coinAmount: t.i64(),
  discountPercent: t.u8(),
  paymentMethods: t.array(t.string()),
  skuBazaar: t.string(),
  skuMyket: t.string(),
  iconUrl: t.string(),
  coverUrl: t.string(),
  sort: t.i32(),
  exclusive: t.bool(),
  prizeId: t.u64(),
});

const UserEconomy = t.object('UserEconomy', {
  wallet: t.array(t.object('UserWalletLine', { currencyKey: t.string(), balance: t.i64() })),
  metas: t.array(t.object('UserMetaLine', { metaKey: t.string(), value: t.f64() })),
  prizes: t.array(economyRows.userPrize),
  ledger: t.array(economyRows.ledger),
});

const GiftPage = t.object('GiftPage', { total: t.u32(), rows: t.array(economyRows.gift) });
const ProductPage = t.object('ProductPage', { total: t.u32(), rows: t.array(economyRows.product) });

function base(ctx: ETx) {
  return ctx as unknown as Tx;
}

export function discounted(price: bigint, percent: number) {
  return (price * BigInt(100 - percent)) / 100n;
}

function checkTaxonomy(ctx: ETx, kind: string, categoryId: bigint, tagIds: bigint[], audience: bigint[] = []) {
  if (categoryId) {
    const c = ctx.db.category.id.find(categoryId);
    if (!c) fail('CATEGORY_NOT_FOUND');
    if (c.keyType !== kind) fail('CATEGORY_KIND_MISMATCH');
  }
  if (tagIds.length > 20) fail('TOO_MANY_TAGS');
  for (const id of tagIds) {
    const tag = ctx.db.tag.id.find(id);
    if (!tag) fail('TAG_NOT_FOUND');
    if (tag.keyType !== kind && tag.keyType !== 'general') fail('TAG_KIND_MISMATCH');
  }
  if (audience.length > 20) fail('TOO_MANY_TAGS');
  for (const id of audience) {
    const tag = ctx.db.tag.id.find(id);
    if (!tag) fail('TAG_NOT_FOUND');
    if (tag.keyType !== 'user') fail('TAG_KIND_MISMATCH');
  }
  return { categoryId, tagIds: [...new Set(tagIds)], audience: [...new Set(audience)] };
}

function cleanUrl(s: string) {
  const v = s.trim();
  if (v && !/^(https?:\/\/|\/)/.test(v)) fail('INVALID_URL');
  return v.slice(0, 500);
}

function checkItems(ctx: ETx, items: { type: string; key: string; action: string; value: number }[]) {
  if (!items.length) fail('ITEMS_REQUIRED');
  if (items.length > 30) fail('TOO_MANY_ITEMS');
  return items.map(i => {
    if (i.type === 'currency') {
      if (!ctx.db.currency.key.find(i.key)) fail('CURRENCY_NOT_FOUND');
      if (!Number.isInteger(i.value) || i.value === 0) fail('INVALID_VALUE');
      return { type: i.type, key: i.key, action: 'add', value: i.value };
    }
    if (i.type === 'meta') {
      if (!ctx.db.meta.key.find(i.key)) fail('META_NOT_FOUND');
      if (i.action !== 'add' && i.action !== 'set') fail('INVALID_ACTION');
      if (!Number.isFinite(i.value)) fail('INVALID_VALUE');
      return { type: i.type, key: i.key, action: i.action, value: i.value };
    }
    if (i.type === 'prize_group') {
      if (!ctx.db.prizeGroup.key.find(i.key)) fail('PRIZE_GROUP_NOT_FOUND');
      return { type: i.type, key: i.key, action: 'give', value: 1 };
    }
    if (extraItemTypes.includes(i.type)) {
      for (const v of itemValidators) v(ctx, i);
      return { ...i };
    }
    fail('INVALID_ITEM_TYPE');
  });
}

function accountOfSession(ctx: { db: ETx['db']; sender: ETx['sender'] }) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  return a && a.status === 'active' ? a : undefined;
}

export function productVisible(ctx: { db: ETx['db'] }, accountId: bigint, audience: bigint[]) {
  if (!audience.length) return true;
  return [...ctx.db.userTag.byAccountTag.filter(accountId)].some(ut => audience.includes(ut.tagId));
}

export function activeMethods(ctx: { db: ETx['db'] }) {
  return new Set([...ctx.db.paymentMethod.iter()].filter(m => m.isActive).map(m => m.method));
}

export function defineCatalog(st: EconomySchema) {
  loginHooks.push((ctx, accountId) => ensureDefaults(ctx as unknown as ETx, accountId));

  const myWallet = st.view({ name: 'my_wallet', public: true }, t.array(WalletView), ctx => {
    const a = accountOfSession(ctx as any);
    if (!a) return [];
    const out = new Map<string, bigint>();
    for (const c of ctx.db.currency.iter()) {
      const inited = !!ctx.db.currencyInit.key.find(`${a.id}|${c.id}`);
      out.set(c.key, inited ? 0n : c.defaultValue);
    }
    for (const w of ctx.db.wallet.byAccountCurrency.filter(a.id)) out.set(w.currencyKey, w.balance);
    return [...out].map(([currencyKey, balance]) => ({ currencyKey, balance }));
  });

  const myMetas = st.view({ name: 'my_metas', public: true }, t.array(MetaView), ctx => {
    const a = accountOfSession(ctx as any);
    if (!a) return [];
    const out = new Map<string, number>();
    for (const m of ctx.db.meta.iter()) if (!m.serverOnly) out.set(m.key, m.defaultValue);
    for (const um of ctx.db.userMeta.byAccountMeta.filter(a.id)) if (out.has(um.metaKey)) out.set(um.metaKey, um.value);
    return [...out].map(([metaKey, value]) => ({ metaKey, value }));
  });

  const shop = st.view({ name: 'shop', public: true }, t.array(ShopRow), ctx => {
    const a = accountOfSession(ctx as any);
    const methods = activeMethods(ctx as any);
    return [...ctx.db.product.iter()]
      .filter(p => p.isActive && (!p.audienceTagIds.length || (a && productVisible(ctx as any, a.id, p.audienceTagIds))))
      .map(p => ({
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description,
        categoryId: p.categoryId,
        tagIds: p.tagIds,
        priceToman: p.priceToman,
        finalToman: discounted(p.priceToman, p.discountPercent),
        coinCurrency: p.coinCurrency,
        coinAmount: p.coinAmount,
        discountPercent: p.discountPercent,
        paymentMethods: p.paymentMethods.filter(m => methods.has(m)),
        skuBazaar: p.skuBazaar,
        skuMyket: p.skuMyket,
        iconUrl: p.iconUrl,
        coverUrl: p.coverUrl,
        sort: p.sort,
        exclusive: p.audienceTagIds.length > 0,
        prizeId: p.prizeId,
      }))
      .filter(p => p.paymentMethods.length > 0 && shopFilters.every(f => f(ctx as any, a?.id, p.id)));
  });

  const syncEconomy = st.reducer(ctx => {
    const a = requireAccount(base(ctx));
    ensureDefaults(ctx, a.id);
  });

  const adminSaveCurrency = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, type: t.string(), defaultValue: t.i64(), iconUrl: t.string(), categoryId: t.u64(), tagIds: t.array(t.u64()), sort: t.i32(), isActive: t.bool() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      if (a.type !== 'soft' && a.type !== 'hard') fail('INVALID_TYPE');
      if (a.defaultValue < 0n) fail('INVALID_VALUE');
      const old = a.id ? ctx.db.currency.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      const same = ctx.db.currency.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      const tx = checkTaxonomy(ctx, 'currency', a.categoryId, a.tagIds);
      const row = { id: a.id, key, name: cleanTranslations(a.name as Tr[], base(ctx)), type: a.type, defaultValue: a.defaultValue, iconUrl: cleanUrl(a.iconUrl), categoryId: tx.categoryId, tagIds: tx.tagIds, sort: a.sort, isActive: a.isActive, createdAt: old?.createdAt ?? ctx.timestamp };
      const saved = old ? ctx.db.currency.id.update(row) : ctx.db.currency.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'currency.update' : 'currency.create', String(saved.id), key);
    }
  );

  const adminDeleteCurrency = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const c = ctx.db.currency.id.find(id);
    if (!c) fail('NOT_FOUND');
    if ([...ctx.db.prize.iter()].some(p => p.items.some(i => i.type === 'currency' && i.key === c.key))) fail('IN_USE');
    if ([...ctx.db.product.iter()].some(p => p.coinCurrency === c.key)) fail('IN_USE');
    if ([...ctx.db.wallet.iter()].some(w => w.currencyKey === c.key && w.balance !== 0n)) fail('IN_USE');
    for (const h of currencyUseChecks) if (h(ctx, c.key)) fail('IN_USE');
    ctx.db.currency.id.delete(id);
    audit(base(ctx), me.id, 'currency.delete', String(id), c.key);
  });

  const adminSaveMeta = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, defaultValue: t.f64(), serverOnly: t.bool() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      if (!Number.isFinite(a.defaultValue)) fail('INVALID_VALUE');
      const old = a.id ? ctx.db.meta.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      const same = ctx.db.meta.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      const row = { id: a.id, key, name: cleanTranslations(a.name as Tr[], base(ctx)), defaultValue: a.defaultValue, serverOnly: a.serverOnly, createdAt: old?.createdAt ?? ctx.timestamp };
      const saved = old ? ctx.db.meta.id.update(row) : ctx.db.meta.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'meta.update' : 'meta.create', String(saved.id), key);
    }
  );

  const adminDeleteMeta = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const m = ctx.db.meta.id.find(id);
    if (!m) fail('NOT_FOUND');
    if ([...ctx.db.prize.iter()].some(p => p.items.some(i => i.type === 'meta' && i.key === m.key))) fail('IN_USE');
    for (const h of metaUseChecks) if (h(ctx, m.key)) fail('IN_USE');
    ctx.db.meta.id.delete(id);
    for (const um of [...ctx.db.userMeta.iter()]) if (um.metaKey === m.key) ctx.db.userMeta.id.delete(um.id);
    audit(base(ctx), me.id, 'meta.delete', String(id), m.key);
  });

  const adminSavePrize = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, message: Translations, categoryId: t.u64(), tagIds: t.array(t.u64()), isRepeatable: t.bool(), items: t.array(PrizeItem) },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.prize.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const same = ctx.db.prize.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      const tx = checkTaxonomy(ctx, 'prize', a.categoryId, a.tagIds);
      const row = {
        id: a.id,
        key,
        name: cleanTranslations(a.name as Tr[], base(ctx)),
        message: cleanTranslations(a.message as Tr[], base(ctx), false),
        categoryId: tx.categoryId,
        tagIds: tx.tagIds,
        isRepeatable: a.isRepeatable,
        items: checkItems(ctx, a.items),
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.prize.id.update(row) : ctx.db.prize.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'prize.update' : 'prize.create', String(saved.id), key);
    }
  );

  const adminDeletePrize = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const p = ctx.db.prize.id.find(id);
    if (!p) fail('NOT_FOUND');
    if ([...ctx.db.product.iter()].some(x => x.prizeId === id) || [...ctx.db.gift.iter()].some(x => x.prizeId === id)) fail('IN_USE');
    if ([...ctx.db.prizeGroup.iter()].some(g => g.entries.some(e => e.prizeId === id))) fail('IN_USE');
    for (const h of prizeUseChecks) if (h(ctx, id)) fail('IN_USE');
    ctx.db.prize.id.delete(id);
    audit(base(ctx), me.id, 'prize.delete', String(id), p.key);
  });

  const adminSavePrizeGroup = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, entries: t.array(GroupEntry), isActive: t.bool() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.prizeGroup.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const same = ctx.db.prizeGroup.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (!a.entries.length) fail('ENTRIES_REQUIRED');
      if (a.entries.length > 100) fail('TOO_MANY_ITEMS');
      for (const e of a.entries) {
        if (!ctx.db.prize.id.find(e.prizeId)) fail('PRIZE_NOT_FOUND');
        if (e.weight < 1 || e.weight > 1_000_000) fail('INVALID_WEIGHT');
      }
      const row = { id: a.id, key, name: cleanTranslations(a.name as Tr[], base(ctx)), entries: a.entries, isActive: a.isActive, createdAt: old?.createdAt ?? ctx.timestamp };
      const saved = old ? ctx.db.prizeGroup.id.update(row) : ctx.db.prizeGroup.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'prize_group.update' : 'prize_group.create', String(saved.id), key);
    }
  );

  const adminDeletePrizeGroup = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const g = ctx.db.prizeGroup.id.find(id);
    if (!g) fail('NOT_FOUND');
    if ([...ctx.db.prize.iter()].some(p => p.items.some(i => i.type === 'prize_group' && i.key === g.key))) fail('IN_USE');
    for (const h of prizeGroupUseChecks) if (h(ctx, id)) fail('IN_USE');
    ctx.db.prizeGroup.id.delete(id);
    audit(base(ctx), me.id, 'prize_group.delete', String(id), g.key);
  });

  const adminSaveProduct = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
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
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.product.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const same = ctx.db.product.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (!ctx.db.prize.id.find(a.prizeId)) fail('PRIZE_NOT_FOUND');
      if (a.discountPercent > 100) fail('INVALID_DISCOUNT');
      const methods = [...new Set(a.paymentMethods)];
      if (!methods.length) fail('PAYMENT_METHODS_REQUIRED');
      for (const m of methods) if (!(METHODS as readonly string[]).includes(m)) fail('INVALID_PAYMENT_METHOD');
      if (methods.some(m => GATEWAYS.includes(m)) && a.priceToman < 100n && !(a.priceToman === 0n)) fail('PRICE_TOO_LOW');
      if (methods.some(m => GATEWAYS.includes(m) || STORES.includes(m)) && a.priceToman < 0n) fail('INVALID_PRICE');
      if (methods.includes('in_app')) {
        if (!ctx.db.currency.key.find(a.coinCurrency)) fail('CURRENCY_NOT_FOUND');
        if (a.coinAmount <= 0n) fail('COIN_PRICE_REQUIRED');
      }
      if (methods.includes('bazaar') && !a.skuBazaar.trim()) fail('SKU_REQUIRED');
      if (methods.includes('myket') && !a.skuMyket.trim()) fail('SKU_REQUIRED');
      const tx = checkTaxonomy(ctx, 'product', a.categoryId, a.tagIds, a.audienceTagIds);
      const row = {
        id: a.id,
        key,
        name: cleanTranslations(a.name as Tr[], base(ctx)),
        description: cleanTranslations(a.description as Tr[], base(ctx), false),
        isActive: a.isActive,
        categoryId: tx.categoryId,
        tagIds: tx.tagIds,
        audienceTagIds: tx.audience,
        priceToman: a.priceToman,
        coinCurrency: methods.includes('in_app') ? a.coinCurrency : '',
        coinAmount: methods.includes('in_app') ? a.coinAmount : 0n,
        discountPercent: a.discountPercent,
        paymentMethods: methods,
        skuBazaar: a.skuBazaar.trim(),
        skuMyket: a.skuMyket.trim(),
        prizeId: a.prizeId,
        iconUrl: cleanUrl(a.iconUrl),
        coverUrl: cleanUrl(a.coverUrl),
        sort: a.sort,
        createdAt: old?.createdAt ?? ctx.timestamp,
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.product.id.update(row) : ctx.db.product.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'product.update' : 'product.create', String(saved.id), key);
    }
  );

  const adminDeleteProduct = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const p = ctx.db.product.id.find(id);
    if (!p) fail('NOT_FOUND');
    if ([...ctx.db.payment.iter()].some(x => x.productId === id)) fail('IN_USE');
    ctx.db.product.id.delete(id);
    audit(base(ctx), me.id, 'product.delete', String(id), p.key);
  });

  const adminProducts = st.procedure({ query: t.string(), categoryId: t.u64(), isActive: t.string(), page: t.u32(), pageSize: t.u32() }, ProductPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const q = toLatinDigits(a.query).trim().toLowerCase();
      const list = [...tx.db.product.iter()]
        .filter(p => (!q || p.key.includes(q) || p.name.some(n => n.text.toLowerCase().includes(q))) && (!a.categoryId || p.categoryId === a.categoryId) && (!a.isActive || String(p.isActive) === a.isActive))
        .sort((x, y) => (x.sort - y.sort) || (x.id < y.id ? 1 : -1));
      const size = Math.min(Math.max(a.pageSize || 20, 1), 100);
      const start = (Math.max(a.page || 1, 1) - 1) * size;
      return { total: list.length, rows: list.slice(start, start + size) };
    })
  );

  const adminSaveGift = st.reducer(
    {
      id: t.u64(),
      name: Translations,
      type: t.string(),
      code: t.string(),
      prizeId: t.u64(),
      discountPercent: t.u8(),
      perUserLimit: t.u32(),
      maxTotalUses: t.u32(),
      validFrom: t.u64(),
      expireAt: t.u64(),
      isActive: t.bool(),
      categoryId: t.u64(),
      tagIds: t.array(t.u64()),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const code = toLatinDigits(a.code).trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) fail('INVALID_CODE');
      const old = a.id ? ctx.db.gift.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const same = ctx.db.gift.code.find(code);
      if (same && same.id !== a.id) fail('CODE_TAKEN');
      if (a.type === 'reward') {
        if (!ctx.db.prize.id.find(a.prizeId)) fail('PRIZE_NOT_FOUND');
      } else if (a.type === 'discount') {
        if (a.discountPercent < 1 || a.discountPercent > 100) fail('INVALID_DISCOUNT');
      } else fail('INVALID_TYPE');
      if (a.validFrom && a.expireAt && a.expireAt <= a.validFrom) fail('INVALID_DATES');
      const tx = checkTaxonomy(ctx, 'gift', a.categoryId, a.tagIds);
      const row = {
        id: a.id,
        name: cleanTranslations(a.name as Tr[], base(ctx)),
        type: a.type,
        code,
        prizeId: a.type === 'reward' ? a.prizeId : 0n,
        discountPercent: a.type === 'discount' ? a.discountPercent : 0,
        perUserLimit: a.perUserLimit,
        maxTotalUses: a.maxTotalUses,
        totalUsed: old?.totalUsed ?? 0,
        validFrom: a.validFrom ? new Timestamp(a.validFrom) : undefined,
        expireAt: a.expireAt ? new Timestamp(a.expireAt) : undefined,
        isActive: a.isActive,
        categoryId: tx.categoryId,
        tagIds: tx.tagIds,
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.gift.id.update(row) : ctx.db.gift.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'gift.update' : 'gift.create', String(saved.id), code);
    }
  );

  const adminDeleteGift = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const g = ctx.db.gift.id.find(id);
    if (!g) fail('NOT_FOUND');
    if ([...ctx.db.giftUse.giftId.filter(id)].length) fail('IN_USE');
    ctx.db.gift.id.delete(id);
    audit(base(ctx), me.id, 'gift.delete', String(id), g.code);
  });

  const adminGifts = st.procedure({ query: t.string(), type: t.string(), page: t.u32(), pageSize: t.u32() }, GiftPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const q = toLatinDigits(a.query).trim().toUpperCase();
      const list = [...tx.db.gift.iter()]
        .filter(g => (!q || g.code.includes(q) || g.name.some(n => n.text.toUpperCase().includes(q))) && (!a.type || g.type === a.type))
        .sort((x, y) => (x.id < y.id ? 1 : -1));
      const size = Math.min(Math.max(a.pageSize || 20, 1), 100);
      const start = (Math.max(a.page || 1, 1) - 1) * size;
      return { total: list.length, rows: list.slice(start, start + size) };
    })
  );

  const redeemGift = st.procedure({ code: t.string() }, RedeemResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const g = checkGift(tx, me.id, a.code, 'reward');
      const use = tx.db.giftUse.insert({ id: 0n, giftId: g.id, accountId: me.id, paymentId: 0n, status: 'used', createdAt: tx.timestamp, updatedAt: tx.timestamp });
      tx.db.gift.id.update({ ...g, totalUsed: g.totalUsed + 1 });
      const rewards = grantPrize(tx, me.id, g.prizeId, 'gift', String(use.id));
      logActivity(tx, me.id, { kind: 'gift', action: 'redeemed', refId: String(g.id), data: JSON.stringify({ code: g.code, prizeId: String(g.prizeId) }), actor: 'player' });
      return { rewards, giftName: g.name };
    })
  );

  const adminUserEconomy = st.procedure({ accountId: t.u64() }, UserEconomy, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      return {
        wallet: [...tx.db.currency.iter()].map(c => ({ currencyKey: c.key, balance: balanceOf(tx, a.accountId, c.key) })),
        metas: [...tx.db.meta.iter()].map(m => ({ metaKey: m.key, value: metaValue(tx, a.accountId, m.key) })),
        prizes: [...tx.db.userPrize.accountId.filter(a.accountId)].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 50),
        ledger: [...tx.db.ledger.accountId.filter(a.accountId)].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 50),
      };
    })
  );

  const adminGrantPrize = st.procedure({ accountId: t.u64(), prizeId: t.u64(), note: t.string() }, t.array(RewardRow), (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireRole(base(tx), 'admin');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      const sourceId = `${me.id}-${tx.timestamp.microsSinceUnixEpoch}`;
      const rewards = grantPrize(tx, a.accountId, a.prizeId, 'admin', sourceId);
      audit(base(tx), me.id, 'economy.grant', String(a.accountId), `prize=${a.prizeId} ${a.note}`);
      return rewards;
    })
  );

  const adminAdjust = st.reducer({ accountId: t.u64(), kind: t.string(), key: t.string(), action: t.string(), value: t.f64(), note: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
    if (a.kind === 'currency') {
      if (!Number.isInteger(a.value)) fail('INVALID_VALUE');
      const now = balanceOf(ctx, a.accountId, a.key);
      const delta = a.action === 'set' ? BigInt(a.value) - now : BigInt(a.value);
      changeBalance(ctx, a.accountId, a.key, delta, `admin:${a.note.slice(0, 100)}`, 'admin', String(me.id));
    } else if (a.kind === 'meta') {
      if (a.action === 'set') setMeta(ctx, a.accountId, a.key, a.value);
      else addMeta(ctx, a.accountId, a.key, a.value);
    } else fail('INVALID_KIND');
    audit(base(ctx), me.id, 'economy.adjust', String(a.accountId), `${a.kind}:${a.key} ${a.action} ${a.value} ${a.note}`);
  });

  return {
    myWallet,
    myMetas,
    shop,
    syncEconomy,
    adminSaveCurrency,
    adminDeleteCurrency,
    adminSaveMeta,
    adminDeleteMeta,
    adminSavePrize,
    adminDeletePrize,
    adminSavePrizeGroup,
    adminDeletePrizeGroup,
    adminSaveProduct,
    adminDeleteProduct,
    adminProducts,
    adminSaveGift,
    adminDeleteGift,
    adminGifts,
    redeemGift,
    adminUserEconomy,
    adminGrantPrize,
    adminAdjust,
  };
}

export const shopFilters: ((ctx: { db: ETx['db'] }, accountId: bigint | undefined, productId: bigint) => boolean)[] = [];
export const prizeUseChecks: ((ctx: ETx, prizeId: bigint) => boolean)[] = [];
export const metaUseChecks: ((ctx: ETx, metaKey: string) => boolean)[] = [];
export const currencyUseChecks: ((ctx: ETx, currencyKey: string) => boolean)[] = [];
export const prizeGroupUseChecks: ((ctx: ETx, groupId: bigint) => boolean)[] = [];
export const itemValidators: ((ctx: ETx, item: { type: string; key: string; action: string; value: number }) => void)[] = [];

export function checkGift(ctx: ETx, accountId: bigint, raw: string, type: string) {
  const code = toLatinDigits(raw).trim().toUpperCase();
  const g = ctx.db.gift.code.find(code);
  if (!g || !g.isActive || g.type !== type) fail('GIFT_NOT_FOUND');
  const now = ctx.timestamp.microsSinceUnixEpoch;
  if (g.validFrom && now < g.validFrom.microsSinceUnixEpoch) fail('GIFT_NOT_STARTED');
  if (g.expireAt && now >= g.expireAt.microsSinceUnixEpoch) fail('GIFT_EXPIRED');
  const uses = [...ctx.db.giftUse.giftId.filter(g.id)].filter(u => u.status !== 'released');
  if (g.maxTotalUses && uses.length >= g.maxTotalUses) fail('GIFT_USED_UP');
  if (g.perUserLimit && uses.filter(u => u.accountId === accountId).length >= g.perUserLimit) fail('GIFT_ALREADY_USED');
  return g;
}

export { asAny, type Reward };
