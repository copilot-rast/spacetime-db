import { ScheduleAt } from 'spacetimedb';
import { normalizeWord } from './filter';
import { tr, type STx } from './engine';

const WORDS: [string, string, string][] = [
  ['احمق', 'mask', 'word'],
  ['بیشعور', 'mask', 'word'],
  ['خفه شو', 'mask', 'word'],
  ['کثافت', 'mask', 'word'],
  ['آشغال', 'mask', 'word'],
  ['حرامزاده', 'block', 'contains'],
  ['idiot', 'mask', 'word'],
  ['stupid', 'mask', 'word'],
  ['fuck', 'block', 'contains'],
  ['scam', 'flag', 'word'],
];

const EVENTS: [string, string, string][] = [
  ['Gift:Sent', 'هدیه فرستاده شد', 'Gift sent'],
  ['Gift:Received', 'هدیه رسید', 'Gift received'],
];

export function seedSocial(raw: unknown) {
  const ctx = raw as STx;
  const now = ctx.timestamp;
  if (!ctx.db.socialSettings.id.find(0)) {
    ctx.db.socialSettings.insert({ id: 0, chatEnabled: true, messageMaxLength: 500, messagesPerMinute: 20, dmPolicy: 'anyone', groupsEnabled: true, groupMaxMembers: 50, groupsPerPlayer: 10, filterEnabled: true, filterReportTitle: 'abuse', historyPageMax: 100, liveMessages: 30, wordsSeeded: false, clockOffsetSec: 0n, updatedAt: now });
  }
  const s = ctx.db.socialSettings.id.find(0)!;
  if (!s.wordsSeeded) {
    for (const [word, action, match] of WORDS) {
      const normalized = normalizeWord(word);
      if (!ctx.db.chatWord.normalized.find(normalized)) ctx.db.chatWord.insert({ id: 0n, word, normalized, action, match, isActive: true, note: '', createdAt: now });
    }
    ctx.db.socialSettings.id.update({ ...s, wordsSeeded: true });
  }
  if (!ctx.db.friendSettings.id.find(0)) {
    ctx.db.friendSettings.insert({ id: 0, dailyRequests: 20, maxFriends: 0, expiryDays: 0, rejectCooldownHours: 0, matchPolicy: 'priority', requestsBonusMeta: '', friendsBonusMeta: '', overLimit: 'refuse', updatedAt: now });
  }
  if (!ctx.db.quotaSettings.id.find(0)) {
    ctx.db.quotaSettings.insert({
      id: 0,
      enabled: false,
      countMode: 'messages',
      dailyMessages: 20,
      dailyConversations: 5,
      conversationScope: 'day',
      resetMinute: 0,
      utcOffsetMinutes: 210,
      countDirect: true,
      countGroups: false,
      countRooms: false,
      replyFree: 'off',
      friendPolicy: 'same',
      friendDailyMessages: 50,
      friendDailyConversations: 10,
      packMeta: '',
      packExpiryDays: 0,
      order: 'free_first',
      packProducts: [],
      bonusMeta: '',
      matchPolicy: 'priority',
      unlimitedItems: [],
      unlimitedMeta: '',
      unlimitedMetaMode: 'positive',
      message: [],
      notice: 'none',
      updatedAt: now,
    });
  }
  if (!ctx.db.giftSettings.id.find(0)) {
    ctx.db.giftSettings.insert({
      id: 0,
      enabled: true,
      recipients: 'friends',
      minFriendDays: 0,
      minMutualFriends: 0,
      minSenderAccountDays: 0,
      minRecipientAccountDays: 0,
      minSenderLevel: 0,
      levelTableId: 0n,
      inventoryEnabled: true,
      itemsDefault: true,
      equipped: 'block',
      upgradeLevel: 'keep',
      regift: 'block',
      itemRequirements: 'check',
      currencyEnabled: false,
      currencies: [],
      shopEnabled: true,
      productsDefault: true,
      methods: ['in_app', 'gateway', 'store'],
      discountCodes: false,
      perSenderDaily: 5,
      perRecipientDaily: 10,
      perPairDaily: 2,
      matchPolicy: 'priority',
      sendBonusMeta: '',
      receiveBonusMeta: '',
      delivery: 'instant',
      expiryHours: 72,
      onExpiry: 'return',
      coinReturn: 'refund',
      moneyReturn: 'sender',
      senderCancel: true,
      messageEnabled: true,
      messageMaxLength: 120,
      messageFilter: 'rules',
      notify: 'in_app',
      notifySender: true,
      updatedAt: now,
    });
  }
  EVENTS.forEach(([key, fa, en], i) => {
    if (ctx.db.eventType.key.find(key)) return;
    ctx.db.eventType.insert({ id: 0n, key, name: tr(fa, en), description: [], clientAllowed: false, valueMin: -1e15, valueMax: 1e15, rateLimit: 0, isActive: true, isSystem: true, sort: 200 + i, createdAt: now });
  });
  if (!ctx.db.notifyCategory.key.find('social')) {
    ctx.db.notifyCategory.insert({ id: 0n, key: 'social', name: tr('دوستان و هدیه‌ها', 'Friends and gifts'), description: [], mandatory: false, defaultOn: true, isActive: true, sort: 10, createdAt: now });
  }
  if (ctx.db.socialTickTimer.count() === 0n) ctx.db.socialTickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(30_000_000n) });
}
