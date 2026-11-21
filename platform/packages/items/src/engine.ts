import type { InferSchema, ProcedureCtx, ReducerCtx } from 'spacetimedb/server';
import { fail, sign, type Tx } from '@stg/base';
import { changeBalance, payeeOf, type ETx } from '@stg/economy';
import { playerLevel, recordEvent } from '@stg/gamification';
import type { ItemsSchema } from './schema';

export type IS = InferSchema<ItemsSchema>;
export type ITx = ReducerCtx<IS>;
export type IProc = ProcedureCtx<IS>;
export type IDb = { db: ITx['db'] };
export type ItemRow = NonNullable<ReturnType<ITx['db']['item']['id']['find']>>;
export type InvRow = NonNullable<ReturnType<ITx['db']['inventory']['id']['find']>>;
export type ProductRow = NonNullable<ReturnType<ITx['db']['product']['id']['find']>>;
export type OfferRow = NonNullable<ReturnType<ITx['db']['offer']['id']['find']>>;
export type UserOfferRow = NonNullable<ReturnType<ITx['db']['userOffer']['id']['find']>>;

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const DAY_US = 86_400_000_000n;
export const TEHRAN_US = 12_600_000_000n;

export const SYSTEM_EVENTS: [string, string, string][] = [
  ['item_bought', 'خرید آیتم', 'Item bought'],
  ['item_unlocked', 'باز شدن آیتم', 'Item unlocked'],
  ['item_upgraded', 'ارتقای آیتم', 'Item upgraded'],
  ['item_equipped', 'پوشیدن آیتم', 'Item equipped'],
  ['item_used', 'استفاده از آیتم', 'Item used'],
  ['offer_bought', 'خرید پیشنهاد', 'Offer bought'],
];

export function base(ctx: unknown) {
  return ctx as Tx;
}

export function econ(ctx: unknown) {
  return ctx as ETx;
}

export function itemsSettings(ctx: IDb) {
  const s = ctx.db.itemsSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function nowUs(ctx: ITx) {
  const s = ctx.db.itemsSettings.id.find(0);
  return ctx.timestamp.microsSinceUnixEpoch + BigInt(s?.clockOffsetSec ?? 0n) * 1_000_000n;
}

export function levelOf(ctx: IDb, accountId: bigint, tableId: bigint) {
  return playerLevel(ctx, accountId, tableId);
}

export function record(ctx: ITx, accountId: bigint, key: string, value: number, meta: Record<string, string>) {
  recordEvent(ctx, accountId, key, value, JSON.stringify(meta), 'server');
}

export function invRow(ctx: IDb, accountId: bigint, itemId: bigint) {
  return [...ctx.db.inventory.byAccountItem.filter([accountId, itemId])][0];
}

export function owns(ctx: IDb, accountId: bigint, itemKey: string) {
  const it = ctx.db.item.key.find(itemKey);
  if (!it) return false;
  const r = invRow(ctx, accountId, it.id);
  return !!r && r.quantity > 0;
}

export function slotsOf(ctx: IDb, typeKey: string) {
  return ctx.db.itemType.key.find(typeKey)?.slots ?? 0;
}

export function equippedIn(ctx: IDb, accountId: bigint, slot: string) {
  return [...ctx.db.inventory.byAccountItem.filter(accountId)].filter(r => r.equipped && r.slot === slot);
}

export function addItem(ctx: ITx, accountId: bigint, it: ItemRow, qty: number, source: string, ref: string, strict = false) {
  const row = invRow(ctx, accountId, it.id);
  if (!it.stackable) {
    if (row) {
      if (strict) fail('ALREADY_OWNED');
      return 0;
    }
    ctx.db.inventory.insert({ id: 0n, accountId, itemId: it.id, itemKey: it.key, slot: it.typeKey, quantity: 1, level: 0, equipped: false, source, sourceRef: ref.slice(0, 200), ownedAt: ctx.timestamp, updatedAt: ctx.timestamp });
    return 1;
  }
  const have = row?.quantity ?? 0;
  let add = qty;
  if (it.maxStack && have + add > it.maxStack) {
    if (strict) fail('STACK_FULL');
    add = Math.max(it.maxStack - have, 0);
  }
  if (add <= 0) return 0;
  if (row) ctx.db.inventory.id.update({ ...row, quantity: have + add, updatedAt: ctx.timestamp });
  else ctx.db.inventory.insert({ id: 0n, accountId, itemId: it.id, itemKey: it.key, slot: it.typeKey, quantity: add, level: 0, equipped: false, source, sourceRef: ref.slice(0, 200), ownedAt: ctx.timestamp, updatedAt: ctx.timestamp });
  return add;
}

export function takeItem(ctx: ITx, accountId: bigint, it: ItemRow, qty: number) {
  const row = invRow(ctx, accountId, it.id);
  if (!row || row.quantity === 0) fail('NOT_OWNED');
  if (row.quantity < qty) fail('NOT_ENOUGH_ITEMS');
  if (row.quantity === qty) ctx.db.inventory.id.delete(row.id);
  else ctx.db.inventory.id.update({ ...row, quantity: row.quantity - qty, updatedAt: ctx.timestamp });
}

export function equip(ctx: ITx, accountId: bigint, it: ItemRow) {
  const row = invRow(ctx, accountId, it.id);
  if (!row || row.quantity === 0) fail('NOT_OWNED');
  const slots = slotsOf(ctx, it.typeKey);
  if (!slots) fail('NOT_EQUIPPABLE');
  if (row.equipped) return [] as string[];
  const others = equippedIn(ctx, accountId, row.slot).sort((a, b) => (a.updatedAt.microsSinceUnixEpoch < b.updatedAt.microsSinceUnixEpoch ? -1 : 1));
  const off: string[] = [];
  while (others.length >= slots) {
    const o = others.shift()!;
    ctx.db.inventory.id.update({ ...o, equipped: false, updatedAt: ctx.timestamp });
    off.push(o.itemKey);
  }
  ctx.db.inventory.id.update({ ...row, equipped: true, updatedAt: ctx.timestamp });
  return off;
}

export function pay(ctx: ITx, accountId: bigint, currencyKey: string, amount: bigint, reason: string, sourceType: string, sourceId: string) {
  if (amount <= 0n) return [] as { currencyKey: string; amount: bigint }[];
  changeBalance(econ(ctx), accountId, currencyKey, -amount, reason, sourceType, sourceId);
  return [{ currencyKey, amount }];
}

export function grantStarters(ctx: ITx, accountId: bigint) {
  const list = [...ctx.db.item.iter()].filter(i => i.isStarter && i.isActive).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const given: string[] = [];
  for (const it of list) {
    const key = `${accountId}|${it.id}`;
    if (ctx.db.starterGiven.key.find(key)) continue;
    ctx.db.starterGiven.insert({ key, at: ctx.timestamp });
    const added = addItem(ctx, accountId, it, Math.max(it.starterQuantity, 1), 'starter', 'starter');
    if (!added) continue;
    given.push(it.key);
    if (slotsOf(ctx, it.typeKey) && equippedIn(ctx, accountId, it.typeKey).length === 0) equip(ctx, accountId, it);
  }
  return given;
}

export function prizeItems(ctx: IDb, prizeId: bigint) {
  const p = ctx.db.prize.id.find(prizeId);
  if (!p) return [] as ItemRow[];
  return p.items.filter(i => i.type === 'item').map(i => ctx.db.item.key.find(i.key)).filter((x): x is ItemRow => !!x);
}

export function contentsOwned(ctx: IDb, accountId: bigint, prizeId: bigint) {
  const items = prizeItems(ctx, prizeId);
  return items.length > 0 && items.every(i => !i.stackable && owns(ctx, accountId, i.key));
}

export function contentsMissing(ctx: IDb, accountId: bigint, prizeId: bigint) {
  const items = prizeItems(ctx, prizeId);
  const inPrize = new Set(items.map(i => i.key));
  return items.some(i => i.requiresKey && !inPrize.has(i.requiresKey) && !owns(ctx, accountId, i.requiresKey));
}

export function ruleOf(ctx: IDb, productId: bigint) {
  return ctx.db.productRule.productId.find(productId) ?? { productId, minLevel: 0, maxLevel: 0, levelTableId: 0n, isOneTime: false, checkContents: true, purchaseMessage: [], updatedAt: undefined };
}

export function deliveredCount(ctx: IDb, accountId: bigint, productId: bigint) {
  return [...ctx.db.payment.accountId.filter(accountId)].filter(p => p.productId === productId && p.status === 'success' && p.rewardGranted && payeeOf(ctx, p) === accountId).length;
}

export function boughtOnce(ctx: IDb, accountId: bigint, productId: bigint, exceptId = 0n) {
  return [...ctx.db.payment.accountId.filter(accountId)].some(p => p.productId === productId && p.id !== exceptId && p.status === 'success' && (p.rewardGranted || exceptId === 0n || p.id < exceptId) && payeeOf(ctx, p) === accountId);
}

export function productBlock(ctx: IDb, accountId: bigint, product: ProductRow, prizeOnce = false) {
  const r = ruleOf(ctx, product.id);
  if (r.minLevel || r.maxLevel) {
    const lvl = levelOf(ctx, accountId, r.levelTableId);
    if (r.minLevel && lvl < r.minLevel) return 'LEVEL_TOO_LOW';
    if (r.maxLevel && lvl > r.maxLevel) return 'LEVEL_TOO_HIGH';
  }
  if (r.isOneTime && boughtOnce(ctx, accountId, product.id)) return 'PRODUCT_ALREADY_BOUGHT';
  if (r.checkContents) {
    if (contentsOwned(ctx, accountId, product.prizeId)) return 'PRIZE_ALREADY_OWNED';
    if (contentsMissing(ctx, accountId, product.prizeId)) return 'REQUIRES_ITEM';
  }
  const prize = ctx.db.prize.id.find(product.prizeId);
  if (prizeOnce && prize && !prize.isRepeatable && [...ctx.db.userPrize.accountId.filter(accountId)].some(u => u.prizeId === prize.id)) return 'PRIZE_ALREADY_GRANTED';
  return '';
}

export function hmacUnit(ctx: ITx, msg: string) {
  const mac = sign(ctx.env.OTP_SECRET, msg);
  const n = ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0;
  return (n + 1) / 4294967297;
}

export type Req = { key: string; replay?: string };

export function cleanRequestId(raw: string, required: boolean) {
  const id = raw.trim();
  if (!id) {
    if (required) fail('REQUEST_ID_REQUIRED');
    return '';
  }
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) fail('INVALID_REQUEST_ID');
  return id;
}

export function requestReplay(ctx: ITx, accountId: bigint, requestId: string, action: string, detail: string) {
  if (!requestId) return undefined;
  const r = ctx.db.itemRequest.key.find(`${accountId}|${requestId}`);
  if (!r) return undefined;
  if (r.action !== action || r.detail !== detail) fail('REQUEST_ID_REUSED');
  return r.result;
}

export function requestSave(ctx: ITx, accountId: bigint, requestId: string, action: string, detail: string, result: string) {
  if (!requestId) return;
  const ttl = BigInt(itemsSettings(ctx).requestTtlHours || 24) * 3_600_000_000n;
  ctx.db.itemRequest.insert({ key: `${accountId}|${requestId}`, accountId, action, detail, result, expiresAt: ctx.timestamp.microsSinceUnixEpoch + ttl });
}

export function compare(op: string, a: number, b: number) {
  const x = Math.round(a * 10000);
  const y = Math.round(b * 10000);
  return op === 'gt' ? x > y : op === 'gte' ? x >= y : op === 'lt' ? x < y : op === 'lte' ? x <= y : x === y;
}

export function hasAnyTag(ctx: IDb, accountId: bigint, tags: bigint[]) {
  if (!tags.length) return false;
  return [...ctx.db.userTag.byAccountTag.filter(accountId)].some(ut => tags.includes(ut.tagId));
}

export function page<T>(list: T[], pageNo: number, pageSize: number) {
  const size = Math.min(Math.max(pageSize || 20, 1), 100);
  const start = (Math.max(pageNo || 1, 1) - 1) * size;
  return { total: list.length, rows: list.slice(start, start + size) };
}
