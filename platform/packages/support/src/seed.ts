import { ScheduleAt } from 'spacetimedb';
import type { STx } from './engine';

const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];

const DEPARTMENTS: [string, string, string, number][] = [
  ['general', 'پشتیبانی عمومی', 'General support', 24],
  ['payments', 'پرداخت و خرید', 'Payments', 12],
];

const CANNED: [string, string, string, string, string][] = [
  ['thanks', 'تشکر', 'Thanks', 'از پیامتان ممنونیم. بررسی می‌کنیم و زود خبر می‌دهیم.', 'Thanks for your message. We are looking into it and will get back to you soon.'],
  ['need_info', 'اطلاعات بیشتر', 'More details', 'لطفاً جزئیات بیشتری بفرستید تا بتوانیم کمک کنیم.', 'Please send more details so we can help.'],
  ['solved', 'حل شد', 'Solved', 'مشکل حل شد. اگر سؤال دیگری دارید همین‌جا بنویسید.', 'The issue is solved. Write here if you have another question.'],
];

export function seedSupport(raw: unknown) {
  const ctx = raw as STx;
  const now = ctx.timestamp;
  if (!ctx.db.supSettings.id.find(0)) {
    ctx.db.supSettings.insert({
      id: 0,
      maxOpenTickets: 10,
      ticketsPerHour: 6,
      messagesPerHour: 40,
      maxAttachments: 5,
      maxAttachmentKb: 2048,
      autoCloseDays: 7,
      chatEnabled: true,
      chatGreeting: tr('سلام! یکی از همکاران ما به‌زودی جواب می‌دهد.', 'Hi! One of our agents will answer soon.'),
      chatOffline: tr('الان همکاری آنلاین نیست. پیامتان را بگذارید، جواب می‌دهیم.', 'No agent is online right now. Leave your message and we will answer.'),
      chatIdleMinutes: 30,
      chatMessagesPerMinute: 12,
      chatsPerHour: 6,
      agentOnlineSeconds: 75,
      activityRetentionDays: 180,
      notifyCategoryKey: 'support',
      clockOffsetSec: 0n,
      updatedAt: now,
    });
    DEPARTMENTS.forEach(([key, fa, en, hours], i) => {
      if (ctx.db.supDepartment.key.find(key)) return;
      ctx.db.supDepartment.insert({ id: 0n, key, name: tr(fa, en), description: [], firstResponseHours: hours, agentIds: [], autoAssign: true, isActive: true, sort: i, createdAt: now });
    });
    CANNED.forEach(([key, tfa, ten, bfa, ben], i) => {
      if (ctx.db.supCanned.key.find(key)) return;
      ctx.db.supCanned.insert({ id: 0n, key, title: tr(tfa, ten), body: tr(bfa, ben), departmentId: 0n, isActive: true, sort: i, updatedAt: now });
    });
    if (!ctx.db.notifyCategory.key.find('support')) {
      ctx.db.notifyCategory.insert({ id: 0n, key: 'support', name: tr('پشتیبانی', 'Support'), description: [], mandatory: false, defaultOn: true, isActive: true, sort: 10, createdAt: now });
    }
  }
  if (!ctx.db.refSettings.id.find(0)) {
    ctx.db.refSettings.insert({
      id: 0,
      isEnabled: true,
      newAccountDays: 7,
      referrerPrizeId: 0n,
      refereePrizeId: 0n,
      goalEventKey: '',
      goalMeasure: 'count',
      goalValue: 0,
      maxPerReferrer: 100,
      dailyPerReferrer: 10,
      onePerDevice: true,
      onePerPhone: true,
      holdFlagged: true,
      triesPerHour: 10,
      updatedAt: now,
    });
  }
  if (ctx.db.supTickTimer.count() === 0n) ctx.db.supTickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(30_000_000n) });
}
