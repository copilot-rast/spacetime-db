import { ScheduleAt } from 'spacetimedb';
import type { ETx } from './engine';

const KEY_TYPES: [string, string, string][] = [
  ['currency', 'ارز', 'Currency'],
  ['prize', 'جایزه', 'Prize'],
  ['product', 'محصول', 'Product'],
  ['gift', 'هدیه', 'Gift'],
];

export function seedEconomy(raw: unknown) {
  const ctx = raw as ETx;
  if (!ctx.db.economySettings.id.find(0)) {
    ctx.db.economySettings.insert({ id: 0, publicBaseUrl: '', redirectUrl: '', pendingTtlMinutes: 45, updatedAt: ctx.timestamp });
  }
  for (const [key, fa, en] of KEY_TYPES) {
    if (!ctx.db.keyType.key.find(key)) {
      ctx.db.keyType.insert({ key, title: [{ lang: 'fa', text: fa }, { lang: 'en', text: en }], forCategory: true, forTag: true, system: true });
    }
  }
  if (ctx.db.reconcileTimer.count() === 0n) {
    ctx.db.reconcileTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(60_000_000n) });
  }
}
