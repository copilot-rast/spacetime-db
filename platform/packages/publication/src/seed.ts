import { ScheduleAt } from 'spacetimedb';
import type { PTx } from './engine';

const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];

const KEY_TYPES: [string, string, string, boolean][] = [
  ['news', 'خبر', 'News', true],
  ['faq', 'سؤال متداول', 'FAQ', true],
];

const CATEGORIES: [string, string, string, boolean, boolean][] = [
  ['system', 'پیام‌های مهم', 'Important messages', true, true],
  ['offers', 'پیشنهادها', 'Offers', false, true],
  ['rewards', 'جایزه‌ها', 'Rewards', false, true],
  ['reminders', 'یادآوری‌ها', 'Reminders', false, true],
  ['news', 'اخبار', 'News', false, true],
];

const REACTIONS: [string, string, string, string][] = [
  ['like', '👍', 'پسندیدم', 'Like'],
  ['love', '❤️', 'عالی', 'Love'],
  ['haha', '😂', 'خنده‌دار', 'Haha'],
  ['wow', '😮', 'شگفت‌انگیز', 'Wow'],
  ['sad', '😢', 'ناراحت', 'Sad'],
];

export function seedPublication(raw: unknown) {
  const ctx = raw as PTx;
  const now = ctx.timestamp;
  if (!ctx.db.pubSettings.id.find(0)) {
    ctx.db.pubSettings.insert({
      id: 0,
      inboxKeepDays: 90,
      inboxMaxPerPlayer: 200,
      maxDevices: 10,
      devicePerMinute: 20,
      prefsPerMinute: 30,
      inboxPerMinute: 60,
      batchSize: 200,
      batchesPerTick: 5,
      capPerDay: 5,
      capPerWeek: 20,
      pushRetries: 3,
      smsMaxChars: 600,
      liveNoticeMinutes: 60,
      inactiveScanMinutes: 10,
      clockOffsetSec: 0n,
      updatedAt: now,
    });
  }
  if (!ctx.db.pushConfig.id.find(0)) ctx.db.pushConfig.insert({ id: 0, provider: 'log', projectId: '', clientEmail: '', privateKeyId: '', privateKey: '', updatedAt: now });
  if (!ctx.db.pubState.id.find(0)) ctx.db.pubState.insert({ id: 0, lastInactiveScan: 0n, lastSweep: 0n });
  if (!ctx.db.newsSettings.id.find(0)) {
    ctx.db.newsSettings.insert({
      id: 0,
      commentsPerMinute: 5,
      reactionsPerMinute: 30,
      listPerMinute: 120,
      unreadScope: 'signup',
      showExpired: false,
      fillDefaultLang: true,
      realtimeOnPublish: true,
      notifyCategoryKey: 'news',
      logRetentionDays: 30,
      logPayloadBytes: 16384,
      ingestMaxKb: 256,
      slugStyle: 'native',
      publicEnabled: false,
      publicBaseUrl: '',
      publicPath: '/news/{slug}',
      rssEnabled: false,
      publicCacheSeconds: 300,
      siteTitle: [],
      updatedAt: now,
    });
  }
  for (const [key, fa, en, forTag] of KEY_TYPES) {
    if (!ctx.db.keyType.key.find(key)) ctx.db.keyType.insert({ key, title: tr(fa, en), forCategory: true, forTag, system: true });
  }
  CATEGORIES.forEach(([key, fa, en, mandatory, defaultOn], i) => {
    if (ctx.db.notifyCategory.key.find(key)) return;
    ctx.db.notifyCategory.insert({ id: 0n, key, name: tr(fa, en), description: [], mandatory, defaultOn, isActive: true, sort: i, createdAt: now });
  });
  if (ctx.db.reactionType.count() === 0n) {
    REACTIONS.forEach(([key, emoji, fa, en], i) => ctx.db.reactionType.insert({ key, emoji, name: tr(fa, en), isActive: true, sort: i }));
  }
  if (ctx.db.pubTickTimer.count() === 0n) ctx.db.pubTickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(3_000_000n) });
}
