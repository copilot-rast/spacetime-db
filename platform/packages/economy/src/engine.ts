import type { InferSchema, ProcedureCtx, ReducerCtx } from 'spacetimedb/server';
import { fail, sign } from '@stg/base';
import type { EconomySchema } from './schema';

export type ES = InferSchema<EconomySchema>;
export type ETx = ReducerCtx<ES>;
export type EProc = ProcedureCtx<ES>;

export type Reward = { type: string; key: string; action: string; value: number; prizeKey: string };

export function asAny<T>(ctx: unknown) {
  return ctx as T;
}

export function walletRow(ctx: ETx, accountId: bigint, currencyKey: string) {
  return [...ctx.db.wallet.byAccountCurrency.filter([accountId, currencyKey])][0];
}

export function balanceOf(ctx: ETx, accountId: bigint, currencyKey: string) {
  ensureDefaults(ctx, accountId);
  return walletRow(ctx, accountId, currencyKey)?.balance ?? 0n;
}

export function ensureDefaults(ctx: ETx, accountId: bigint) {
  for (const c of ctx.db.currency.iter()) {
    const key = `${accountId}|${c.id}`;
    if (ctx.db.currencyInit.key.find(key)) continue;
    ctx.db.currencyInit.insert({ key });
    if (c.defaultValue !== 0n) changeBalance(ctx, accountId, c.key, c.defaultValue, 'default', 'currency', String(c.id), true);
  }
}

export function changeBalance(
  ctx: ETx,
  accountId: bigint,
  currencyKey: string,
  delta: bigint,
  reason: string,
  sourceType: string,
  sourceId: string,
  skipDefaults = false
) {
  if (!ctx.db.currency.key.find(currencyKey)) fail('CURRENCY_NOT_FOUND');
  if (!skipDefaults) ensureDefaults(ctx, accountId);
  const row = walletRow(ctx, accountId, currencyKey);
  const next = (row?.balance ?? 0n) + delta;
  if (next < 0n) fail('INSUFFICIENT_BALANCE');
  if (row) ctx.db.wallet.id.update({ ...row, balance: next, updatedAt: ctx.timestamp });
  else ctx.db.wallet.insert({ id: 0n, accountId, currencyKey, balance: next, updatedAt: ctx.timestamp });
  ctx.db.ledger.insert({ id: 0n, accountId, currencyKey, delta, balanceAfter: next, reason, sourceType, sourceId, at: ctx.timestamp });
  return next;
}

export function metaValue(ctx: ETx, accountId: bigint, key: string) {
  const m = ctx.db.meta.key.find(key);
  if (!m) fail('META_NOT_FOUND');
  return [...ctx.db.userMeta.byAccountMeta.filter([accountId, key])][0]?.value ?? m.defaultValue;
}

export type MetaHook = (ctx: ETx, accountId: bigint, key: string, before: number, after: number, depth: number) => void;
export const metaHooks: MetaHook[] = [];

export function setMeta(ctx: ETx, accountId: bigint, key: string, value: number, depth = 0) {
  const m = ctx.db.meta.key.find(key);
  if (!m) fail('META_NOT_FOUND');
  if (!Number.isFinite(value)) fail('INVALID_VALUE');
  const row = [...ctx.db.userMeta.byAccountMeta.filter([accountId, key])][0];
  const before = row?.value ?? m.defaultValue;
  if (row) ctx.db.userMeta.id.update({ ...row, value, updatedAt: ctx.timestamp });
  else ctx.db.userMeta.insert({ id: 0n, accountId, metaKey: key, value, updatedAt: ctx.timestamp });
  if (before !== value) for (const h of metaHooks) h(ctx, accountId, key, before, value, depth);
  return value;
}

export function addMeta(ctx: ETx, accountId: bigint, key: string, delta: number, depth = 0) {
  return setMeta(ctx, accountId, key, metaValue(ctx, accountId, key) + delta, depth);
}

export function pickFromGroup(ctx: ETx, groupId: bigint, seed: string) {
  const g = ctx.db.prizeGroup.id.find(groupId);
  if (!g || !g.isActive) fail('PRIZE_GROUP_NOT_FOUND');
  const entries = g.entries.filter(e => e.weight > 0);
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (!total) fail('PRIZE_GROUP_EMPTY');
  const mac = sign(ctx.env.OTP_SECRET, `prize-group|${groupId}|${seed}`);
  const n = (((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0) % total;
  let acc = 0;
  for (const e of entries) {
    acc += e.weight;
    if (n < acc) return e.prizeId;
  }
  return entries[entries.length - 1].prizeId;
}

export function grantPrize(ctx: ETx, accountId: bigint, prizeId: bigint, sourceType: string, sourceId: string, depth = 0): Reward[] {
  if (depth > 4) fail('PRIZE_TOO_DEEP');
  const p = ctx.db.prize.id.find(prizeId);
  if (!p) fail('PRIZE_NOT_FOUND');
  for (const up of ctx.db.userPrize.bySource.filter([sourceType, sourceId])) {
    if (up.prizeId === prizeId && up.accountId === accountId) return JSON.parse(up.rewards) as Reward[];
  }
  if (!p.isRepeatable) {
    for (const up of ctx.db.userPrize.accountId.filter(accountId)) {
      if (up.prizeId === prizeId) fail('PRIZE_ALREADY_GRANTED');
    }
  }
  const rewards: Reward[] = [];
  for (const item of p.items) {
    if (item.type === 'currency') {
      changeBalance(ctx, accountId, item.key, BigInt(Math.trunc(item.value)), `prize:${p.key}`, sourceType, sourceId);
      rewards.push({ type: 'currency', key: item.key, action: 'add', value: Math.trunc(item.value), prizeKey: p.key });
    } else if (item.type === 'meta') {
      if (item.action === 'set') setMeta(ctx, accountId, item.key, item.value);
      else addMeta(ctx, accountId, item.key, item.value);
      rewards.push({ type: 'meta', key: item.key, action: item.action === 'set' ? 'set' : 'add', value: item.value, prizeKey: p.key });
    } else if (item.type === 'prize_group') {
      const g = ctx.db.prizeGroup.key.find(item.key);
      if (!g) fail('PRIZE_GROUP_NOT_FOUND');
      const picked = pickFromGroup(ctx, g.id, `${accountId}|${sourceType}|${sourceId}|${p.id}`);
      rewards.push(...grantPrize(ctx, accountId, picked, sourceType, `${sourceId}/${p.id}`, depth + 1));
    } else {
      for (const h of itemHandlers) {
        const r = h(ctx, accountId, item, p.key, sourceType, sourceId);
        if (r) {
          rewards.push(r);
          break;
        }
      }
    }
  }
  ctx.db.userPrize.insert({ id: 0n, accountId, prizeId, sourceType, sourceId, rewards: JSON.stringify(rewards), createdAt: ctx.timestamp });
  return rewards;
}

export type ItemHandler = (
  ctx: ETx,
  accountId: bigint,
  item: { type: string; key: string; action: string; value: number },
  prizeKey: string,
  sourceType: string,
  sourceId: string
) => Reward | undefined;
export const itemHandlers: ItemHandler[] = [];
export const extraItemTypes: string[] = [];
