import { ScheduleAt } from 'spacetimedb';
import { SYSTEM_EVENTS, type ITx } from './engine';

const KEY_TYPES: [string, string, string][] = [['item', 'آیتم', 'Item']];

const TYPES: [string, string, string, number][] = [
  ['avatar', 'آواتار', 'Avatar', 1],
  ['frame', 'قاب', 'Frame', 1],
  ['skin', 'پوسته', 'Skin', 1],
  ['board', 'صفحه', 'Board', 1],
  ['piece', 'مهره', 'Piece', 1],
  ['ball', 'توپ', 'Ball', 1],
  ['trail', 'رد', 'Trail', 1],
  ['emote', 'شکلک', 'Emote', 4],
  ['booster', 'تقویت‌کننده', 'Booster', 0],
  ['other', 'دیگر', 'Other', 0],
];

export function seedItems(raw: unknown) {
  const ctx = raw as ITx;
  if (!ctx.db.itemsSettings.id.find(0)) {
    ctx.db.itemsSettings.insert({ id: 0, hideBoughtOneTime: true, hideAboveMaxLevel: true, requestTtlHours: 24, clockOffsetSec: 0n, updatedAt: ctx.timestamp });
  }
  if (!ctx.db.offerSettings.id.find(0)) {
    ctx.db.offerSettings.insert({
      id: 0,
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
      updatedAt: ctx.timestamp,
    });
  }
  for (const [key, fa, en] of KEY_TYPES) {
    if (!ctx.db.keyType.key.find(key)) {
      ctx.db.keyType.insert({ key, title: [{ lang: 'fa', text: fa }, { lang: 'en', text: en }], forCategory: true, forTag: true, system: true });
    }
  }
  TYPES.forEach(([key, fa, en, slots], i) => {
    if (ctx.db.itemType.key.find(key)) return;
    ctx.db.itemType.insert({ id: 0n, key, name: [{ lang: 'fa', text: fa }, { lang: 'en', text: en }], slots, sort: i, isSystem: true, createdAt: ctx.timestamp });
  });
  SYSTEM_EVENTS.forEach(([key, fa, en], i) => {
    if (ctx.db.eventType.key.find(key)) return;
    ctx.db.eventType.insert({ id: 0n, key, name: [{ lang: 'fa', text: fa }, { lang: 'en', text: en }], description: [], clientAllowed: false, valueMin: -1e15, valueMax: 1e15, rateLimit: 0, isActive: true, isSystem: true, sort: 100 + i, createdAt: ctx.timestamp });
  });
  if (ctx.db.itemsTickTimer.count() === 0n) {
    ctx.db.itemsTickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(600_000_000n) });
  }
}
