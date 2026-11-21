import { cleanTranslations, fail, type Tr, type Tx } from '@stg/base';
import { GRANT_MODES, type GTx } from './engine';

export function base(ctx: GTx) {
  return ctx as unknown as Tx;
}

export function tr(ctx: GTx, list: unknown, required = true) {
  return cleanTranslations(list as Tr[], base(ctx), required);
}

export function checkMode(mode: string) {
  if (!GRANT_MODES.includes(mode)) fail('INVALID_GRANT_MODE');
  return mode;
}

export function checkPrize(ctx: GTx, prizeId: bigint, required = false) {
  if (!prizeId) {
    if (required) fail('PRIZE_REQUIRED');
    return 0n;
  }
  if (!ctx.db.prize.id.find(prizeId)) fail('PRIZE_NOT_FOUND');
  return prizeId;
}

export function checkMeta(ctx: GTx, key: string) {
  if (!ctx.db.meta.key.find(key)) fail('META_NOT_FOUND');
  return key;
}

export function checkEventKey(ctx: GTx, key: string) {
  const t = ctx.db.eventType.key.find(key);
  if (!t) fail('EVENT_TYPE_NOT_FOUND');
  return key;
}

export function checkAudience(ctx: GTx, tags: bigint[]) {
  if (tags.length > 20) fail('TOO_MANY_TAGS');
  for (const id of tags) {
    const tag = ctx.db.tag.id.find(id);
    if (!tag) fail('TAG_NOT_FOUND');
    if (tag.keyType !== 'user') fail('TAG_KIND_MISMATCH');
  }
  return [...new Set(tags)];
}

export function checkTaxonomy(ctx: GTx, kind: string, categoryId: bigint, tagIds: bigint[]) {
  if (categoryId) {
    const c = ctx.db.category.id.find(categoryId);
    if (!c) fail('CATEGORY_NOT_FOUND');
    if (c.keyType !== kind && c.keyType !== 'general') fail('CATEGORY_KIND_MISMATCH');
  }
  if (tagIds.length > 20) fail('TOO_MANY_TAGS');
  for (const id of tagIds) {
    const tag = ctx.db.tag.id.find(id);
    if (!tag) fail('TAG_NOT_FOUND');
    if (tag.keyType !== kind && tag.keyType !== 'general') fail('TAG_KIND_MISMATCH');
  }
  return [...new Set(tagIds)];
}

export function checkWindow(startsAt: bigint, endsAt: bigint) {
  if (startsAt && endsAt && endsAt <= startsAt) fail('INVALID_WINDOW');
}

export function checkUrl(s: string) {
  const v = s.trim();
  if (v && !/^(https?:\/\/|\/)/.test(v)) fail('INVALID_URL');
  return v.slice(0, 500);
}

export function checkRange(min: number | undefined, max: number | undefined) {
  if (min !== undefined && !Number.isFinite(min)) fail('INVALID_RANGE');
  if (max !== undefined && !Number.isFinite(max)) fail('INVALID_RANGE');
  if (min !== undefined && max !== undefined && min > max) fail('INVALID_RANGE');
}

export function lockedKey<T extends { key: string }>(old: T | null | undefined, key: string) {
  if (old && old.key !== key) fail('KEY_LOCKED');
}

export function page<T>(list: T[], pageNo: number, pageSize: number) {
  const size = Math.min(Math.max(pageSize || 20, 1), 100);
  const start = (Math.max(pageNo || 1, 1) - 1) * size;
  return { total: list.length, rows: list.slice(start, start + size) };
}
