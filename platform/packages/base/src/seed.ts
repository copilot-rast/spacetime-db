import type { Tx } from './util';

const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];

export function seedBase(ctx: Tx) {
  const now = ctx.timestamp;
  if (!ctx.db.settings.id.find(0)) {
    ctx.db.settings.insert({
      id: 0,
      otpLength: 5,
      otpTtlSec: 120,
      otpResendSec: 60,
      otpMaxAttempts: 5,
      otpDailyCap: 10,
      defaultLang: 'fa',
      setupDone: false,
      updatedAt: now,
    });
  }
  if (!ctx.db.brand.id.find(0)) {
    ctx.db.brand.insert({
      id: 0,
      name: tr('بازی من', 'My Game'),
      shortName: '',
      logoUrl: '',
      iconUrl: '',
      primaryColor: '#3f76ff',
      supportPhone: '',
      supportEmail: '',
      website: '',
      updatedAt: now,
    });
  }
  if (!ctx.db.language.code.find('fa')) ctx.db.language.insert({ code: 'fa', name: 'فارسی', dir: 'rtl', isActive: true, isDefault: true, sort: 0 });
  if (!ctx.db.language.code.find('en')) ctx.db.language.insert({ code: 'en', name: 'English', dir: 'ltr', isActive: true, isDefault: false, sort: 1 });
  const keyTypes = [
    { key: 'general', title: tr('عمومی', 'General'), forCategory: true, forTag: true },
    { key: 'user', title: tr('بازیکن', 'Player'), forCategory: false, forTag: true },
  ];
  for (const k of keyTypes) {
    if (!ctx.db.keyType.key.find(k.key)) ctx.db.keyType.insert({ ...k, system: true });
  }
  if (ctx.db.smsProvider.count() === 0n) {
    ctx.db.smsProvider.insert({
      id: 0n,
      kind: 'sandbox',
      name: 'Sandbox',
      isActive: true,
      apiKey: '',
      sender: '',
      otpTemplate: '',
      otpCodeVar: 'CODE',
      updatedAt: now,
    });
  }
}
