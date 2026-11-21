import { ScheduleAt } from 'spacetimedb';
import { COUNTRIES } from './countries';
import type { PTx } from './util';

const TITLES: [string, string, string][] = [
  ['abuse', 'توهین', 'Abuse'],
  ['harassment', 'آزار و اذیت', 'Harassment'],
  ['spam', 'هرزنامه', 'Spam'],
  ['cheating', 'تقلب', 'Cheating'],
  ['personal-info', 'پخش اطلاعات شخصی', 'Sharing personal info'],
  ['other', 'سایر', 'Other'],
];

export function seedPlayers(raw: unknown) {
  const ctx = raw as PTx;
  const now = ctx.timestamp;
  if (!ctx.db.accountRules.id.find(0)) {
    ctx.db.accountRules.insert({ id: 0, displayNameMin: 0, displayNameMax: 40, displayNameCharset: 'any', displayNameUnique: false, updatedAt: now });
  }
  if (!ctx.db.reportRules.id.find(0)) {
    ctx.db.reportRules.insert({ id: 0, perHour: 10, duplicateHours: 24, minAccountHours: 0, noteRequired: false, trustedTagIds: [], trustedPerHour: 30, updatedAt: now });
  }
  if (ctx.db.country.count() === 0n) {
    for (const [code, fa, en, ar, dialCode, sort] of COUNTRIES) {
      ctx.db.country.insert({
        code,
        name: [
          { lang: 'fa', text: fa },
          { lang: 'en', text: en },
          { lang: 'ar', text: ar },
        ].filter(x => x.text),
        dialCode,
        flagUrl: '',
        isActive: true,
        sort,
      });
    }
  }
  if (ctx.db.reportTitle.count() === 0n) {
    TITLES.forEach(([key, fa, en], i) =>
      ctx.db.reportTitle.insert({
        id: 0n,
        key,
        name: [
          { lang: 'fa', text: fa },
          { lang: 'en', text: en },
        ],
        description: [],
        isActive: true,
        sort: i,
      })
    );
  }
  if (ctx.db.expireTimer.count() === 0n) {
    ctx.db.expireTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(30_000_000n) });
  }
}
