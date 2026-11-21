import { ScheduleAt } from 'spacetimedb';
import type { PTx } from './engine';

const KEY_TYPES: [string, string, string][] = [
  ['banner', 'بنر', 'Banner'],
  ['sponsor', 'اسپانسر', 'Sponsor'],
];

const EVENTS: [string, string, string][] = [['chance_played', 'بازی شانس', 'Chance game played']];

export function seedPromo(raw: unknown) {
  const ctx = raw as PTx;
  if (!ctx.db.promoSettings.id.find(0)) {
    ctx.db.promoSettings.insert({ id: 0, listPerMinute: 60, countPerMinute: 60, playPerMinute: 60, newPlayerDays: 7, requestTtlHours: 24, keepDays: 45, clockOffsetSec: 0n, updatedAt: ctx.timestamp });
  }
  for (const [key, fa, en] of KEY_TYPES) {
    if (!ctx.db.keyType.key.find(key)) {
      ctx.db.keyType.insert({ key, title: [{ lang: 'fa', text: fa }, { lang: 'en', text: en }], forCategory: true, forTag: true, system: true });
    }
  }
  EVENTS.forEach(([key, fa, en], i) => {
    if (ctx.db.eventType.key.find(key)) return;
    ctx.db.eventType.insert({ id: 0n, key, name: [{ lang: 'fa', text: fa }, { lang: 'en', text: en }], description: [], clientAllowed: false, valueMin: -1e15, valueMax: 1e15, rateLimit: 0, isActive: true, isSystem: true, sort: 200 + i, createdAt: ctx.timestamp });
  });
  if (ctx.db.promoTickTimer.count() === 0n) {
    ctx.db.promoTickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(600_000_000n) });
  }
}
