import { ScheduleAt } from 'spacetimedb';
import { SYSTEM_EVENTS, type GTx } from './engine';

const KEY_TYPES: [string, string, string][] = [
  ['task', 'تسک', 'Task'],
  ['achievement', 'دستاورد', 'Achievement'],
];

export function seedGamification(raw: unknown) {
  const ctx = raw as GTx;
  if (!ctx.db.gamSettings.id.find(0)) {
    ctx.db.gamSettings.insert({ id: 0, weekStart: 6, playerRateLimit: 120, retentionDays: 30, chainDepth: 8, clockOffsetSec: 0n, updatedAt: ctx.timestamp });
  }
  for (const [key, fa, en] of KEY_TYPES) {
    if (!ctx.db.keyType.key.find(key)) {
      ctx.db.keyType.insert({ key, title: [{ lang: 'fa', text: fa }, { lang: 'en', text: en }], forCategory: true, forTag: true, system: true });
    }
  }
  SYSTEM_EVENTS.forEach(([key, fa, en], i) => {
    if (ctx.db.eventType.key.find(key)) return;
    ctx.db.eventType.insert({
      id: 0n,
      key,
      name: [{ lang: 'fa', text: fa }, { lang: 'en', text: en }],
      description: [],
      clientAllowed: false,
      valueMin: -1e15,
      valueMax: 1e15,
      rateLimit: 0,
      isActive: true,
      isSystem: true,
      sort: i,
      createdAt: ctx.timestamp,
    });
  });
  if (ctx.db.tickTimer.count() === 0n) {
    ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(30_000_000n) });
  }
}
