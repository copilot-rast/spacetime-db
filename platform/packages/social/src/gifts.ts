import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { adminOrNull, audit, fail, requireAccount, requireRole } from '@stg/base';
import {
  GATEWAYS,
  STORES,
  StartResult,
  addMeta,
  balanceOf,
  changeBalance,
  currencyUseChecks,
  grantOverrides,
  grantPrize,
  metaUseChecks,
  payeeHooks,
  productVisible,
  purchaseChecks,
  purchaseCreatedHooks,
  startPurchase,
  type EProc,
  type Reward,
} from '@stg/economy';
import { playerLevel, recordEvent } from '@stg/gamification';
import { addItem, invRow, itemUseChecks, owns, productBlock, takeItem } from '@stg/items';
import { GiftCurrency, socialRows, type SocialSchema } from './schema';
import {
  DAY_US,
  HOUR_US,
  act,
  areFriends,
  base,
  blockedEither,
  bump,
  checkPriority,
  cleanName,
  econ,
  edgeOf,
  friendIds,
  isPlayer,
  matchingRules,
  metaBonus,
  metaOk,
  nameOf,
  notify,
  nowUs,
  oneOf,
  page,
  resolveLimits,
  sessionId,
  tagsOk,
  tehranDay,
  tr,
  type SDb,
  type STx,
} from './engine';
import { filterText } from './filter';
import { friendSettings } from './friends';

type GiftRow = NonNullable<ReturnType<STx['db']['friendGift']['id']['find']>>;
type ItemRow = NonNullable<ReturnType<STx['db']['item']['key']['find']>>;
type ProductRow = NonNullable<ReturnType<STx['db']['product']['id']['find']>>;

const Limit = t.object('GiftLimit', { used: t.u32(), limit: t.u32(), remaining: t.option(t.u32()), bonus: t.u32() });
const Limits = t.object('GiftLimits', { sender: Limit, recipient: Limit, pair: Limit, day: t.i32(), rule: t.option(t.object('GiftRuleRef', { id: t.u64(), name: t.string() })) });
const OptionItem = t.object('GiftOptionItem', { itemKey: t.string(), quantity: t.u32(), level: t.u32(), equipped: t.bool(), recipientOwns: t.bool(), giftable: t.bool(), reason: t.string() });
const OptionCurrency = t.object('GiftOptionCurrency', { currencyKey: t.string(), min: t.i64(), max: t.i64(), balance: t.i64() });
const OptionProduct = t.object('GiftOptionProduct', { productId: t.u64(), key: t.string(), priceToman: t.i64(), coinCurrency: t.string(), coinAmount: t.i64(), methods: t.array(t.string()), giftable: t.bool(), reason: t.string() });
const Options = t.object('GiftOptions', {
  friendId: t.u64(),
  friendName: t.string(),
  isFriend: t.bool(),
  canSend: t.bool(),
  reason: t.string(),
  limits: Limits,
  delivery: t.string(),
  expiryHours: t.u32(),
  messageEnabled: t.bool(),
  messageMaxLength: t.u32(),
  discountCodes: t.bool(),
  items: t.array(OptionItem),
  currencies: t.array(OptionCurrency),
  products: t.array(OptionProduct),
});
const SendResult = t.object('GiftSendResult', { giftId: t.u64(), status: t.string(), replayed: t.bool(), purchase: t.option(StartResult) });
const GiftEntry = (name: string) =>
  t.row(name, {
    id: t.u64().primaryKey(),
    otherId: t.u64(),
    otherName: t.string(),
    kind: t.string(),
    source: t.string(),
    itemKey: t.string(),
    quantity: t.u32(),
    currencyKey: t.string(),
    amount: t.i64(),
    productId: t.u64(),
    productKey: t.string(),
    method: t.string(),
    paymentId: t.u64(),
    message: t.string(),
    status: t.string(),
    outcome: t.string(),
    delivery: t.string(),
    createdAt: t.timestamp(),
    expiresAt: t.u64(),
    deliveredAt: t.u64(),
    respondedAt: t.u64(),
  });
const ReceivedEntry = GiftEntry('GiftReceivedEntry');
const SentEntry = GiftEntry('GiftSentEntry');
const AdminGiftRow = t.object('AdminGiftRow', { gift: socialRows.gift, senderName: t.string(), recipientName: t.string() });
const AdminGiftPage = t.object('AdminGiftPage', { total: t.u32(), rows: t.array(AdminGiftRow) });
const TrailRow = t.object('GiftTrailRow', { accountId: t.u64(), action: t.string(), detail: t.string(), at: t.timestamp() });
const AdminGiftDetail = t.object('AdminGiftDetail', { row: AdminGiftRow, trail: t.array(TrailRow) });
const Count = t.object('GiftCount', { key: t.string(), count: t.u32() });
const TopGiver = t.object('GiftTopPlayer', { accountId: t.u64(), displayName: t.string(), count: t.u32() });
const GiftReport = t.object('GiftReport', {
  total: t.u32(),
  byStatus: t.array(Count),
  byKind: t.array(Count),
  senders: t.u32(),
  recipients: t.u32(),
  moneyToman: t.i64(),
  coinsSpent: t.i64(),
  currencyMoved: t.i64(),
  topSenders: t.array(TopGiver),
  topRecipients: t.array(TopGiver),
  daily: t.array(t.object('GiftReportDay', { day: t.i32(), count: t.u32() })),
});

export function giftSettings(ctx: SDb) {
  const s = ctx.db.giftSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

function flag(ctx: SDb, kind: string, key: string) {
  return ctx.db.giftable.key.find(`${kind}:${key}`)?.giftable;
}

function itemGiftable(ctx: SDb, it: ItemRow) {
  return flag(ctx, 'item', it.key) ?? flag(ctx, 'item_type', it.typeKey) ?? giftSettings(ctx).itemsDefault;
}

function productGiftable(ctx: SDb, p: ProductRow) {
  return flag(ctx, 'product', p.key) ?? giftSettings(ctx).productsDefault;
}

function methodKind(m: string) {
  return m === 'in_app' ? 'in_app' : GATEWAYS.includes(m) ? 'gateway' : STORES.includes(m) ? 'store' : '';
}

function tryCode(fn: () => void) {
  try {
    fn();
    return '';
  } catch (e) {
    return String((e as Error)?.message ?? e);
  }
}

function giftLimits(ctx: STx, senderId: bigint, recipientId: bigint, day: number) {
  const s = giftSettings(ctx);
  const sRules = matchingRules(ctx, senderId, ctx.db.giftRule.iter());
  const rRules = matchingRules(ctx, recipientId, ctx.db.giftRule.iter());
  const defaults = { perSenderDaily: s.perSenderDaily, perRecipientDaily: s.perRecipientDaily, perPairDaily: s.perPairDaily };
  const get = (r: (typeof sRules)[number], f: keyof typeof defaults) => r[f] ?? undefined;
  const mine = resolveLimits(sRules, s.matchPolicy, defaults, get);
  const theirs = resolveLimits(rRules, s.matchPolicy, defaults, get);
  const canSend = !sRules.length || (s.matchPolicy === 'generous' ? sRules.some(r => r.canSend) : sRules[0].canSend);
  const sb = metaBonus(ctx, senderId, s.sendBonusMeta);
  const rb = metaBonus(ctx, recipientId, s.receiveBonusMeta);
  const mk = (used: number, limit: number, bonus: number) => {
    const l = limit ? limit + bonus : 0;
    return { used, limit: l, remaining: l ? Math.max(l - used, 0) : undefined, bonus: limit ? bonus : 0 };
  };
  return {
    canSend,
    rule: mine.rule,
    day,
    sender: mk(ctx.db.giftDay.key.find(`s|${senderId}|${day}`)?.count ?? 0, mine.values.perSenderDaily, sb),
    recipient: mk(ctx.db.giftDay.key.find(`r|${recipientId}|${day}`)?.count ?? 0, theirs.values.perRecipientDaily, rb),
    pair: mk(ctx.db.giftDay.key.find(`p|${senderId}|${recipientId}|${day}`)?.count ?? 0, mine.values.perPairDaily, sb),
  };
}

function countGift(ctx: STx, g: { senderId: bigint; recipientId: bigint; day: number }, delta: number) {
  bump(ctx.db.giftDay, `s|${g.senderId}|${g.day}`, delta);
  bump(ctx.db.giftDay, `r|${g.recipientId}|${g.day}`, delta);
  bump(ctx.db.giftDay, `p|${g.senderId}|${g.recipientId}|${g.day}`, delta);
}

function checkWho(ctx: STx, senderId: bigint, recipientId: bigint) {
  const s = giftSettings(ctx);
  const now = nowUs(ctx);
  if (senderId === recipientId) fail('GIFT_SELF');
  if (!isPlayer(ctx, recipientId)) fail('RECIPIENT_NOT_FOUND');
  if (blockedEither(ctx, senderId, recipientId)) fail('GIFT_BLOCKED');
  const friends = areFriends(ctx, senderId, recipientId);
  if (s.recipients === 'friends' && !friends) fail('NOT_FRIENDS');
  if (s.minFriendDays) {
    const e = edgeOf(ctx, senderId, recipientId);
    if (!friends || !e) fail('NOT_FRIENDS');
    if (now - e.updatedAt.microsSinceUnixEpoch < BigInt(s.minFriendDays) * DAY_US) fail('FRIENDSHIP_TOO_NEW');
  }
  if (s.minMutualFriends) {
    const mine = new Set(friendIds(ctx, senderId));
    if (friendIds(ctx, recipientId).filter(x => mine.has(x)).length < s.minMutualFriends) fail('NOT_ENOUGH_MUTUAL_FRIENDS');
  }
  const age = (id: bigint) => now - ctx.db.account.id.find(id)!.createdAt.microsSinceUnixEpoch;
  if (s.minSenderAccountDays && age(senderId) < BigInt(s.minSenderAccountDays) * DAY_US) fail('SENDER_ACCOUNT_TOO_NEW');
  if (s.minRecipientAccountDays && age(recipientId) < BigInt(s.minRecipientAccountDays) * DAY_US) fail('RECIPIENT_ACCOUNT_TOO_NEW');
  if (s.minSenderLevel && playerLevel(ctx, senderId, s.levelTableId) < s.minSenderLevel) fail('SENDER_LEVEL_TOO_LOW');
}

function checkLimits(l: ReturnType<typeof giftLimits>) {
  if (!l.canSend) fail('GIFT_SENDING_BLOCKED');
  if (l.sender.remaining === 0) fail('GIFT_SENDER_DAILY_LIMIT');
  if (l.recipient.remaining === 0) fail('GIFT_RECIPIENT_DAILY_LIMIT');
  if (l.pair.remaining === 0) fail('GIFT_PAIR_DAILY_LIMIT');
}

function pendingFor(ctx: SDb, recipientId: bigint, test: (g: GiftRow) => boolean) {
  return [...ctx.db.friendGift.recipientId.filter(recipientId)].some(g => (g.status === 'pending' || g.status === 'paying' || g.status === 'sending') && test(g));
}

function itemBlock(ctx: STx, recipientId: bigint, it: ItemRow, qty: number) {
  const s = giftSettings(ctx);
  if (!it.stackable && owns(ctx as never, recipientId, it.key)) return 'RECIPIENT_OWNS_ITEM';
  if (it.stackable && it.maxStack && (invRow(ctx as never, recipientId, it.id)?.quantity ?? 0) + qty > it.maxStack) return 'STACK_FULL';
  if (s.itemRequirements === 'check') {
    if (it.requiresKey && !owns(ctx as never, recipientId, it.requiresKey)) return 'RECIPIENT_REQUIRES_ITEM';
    if (it.unlockLevel && playerLevel(ctx, recipientId, it.levelTableId) < it.unlockLevel) return 'RECIPIENT_LEVEL_TOO_LOW';
  }
  return '';
}

const RECIPIENT_CODES: Record<string, string> = {
  PRIZE_ALREADY_OWNED: 'RECIPIENT_OWNS_PRODUCT',
  PRODUCT_ALREADY_BOUGHT: 'RECIPIENT_OWNS_PRODUCT',
  PRIZE_ALREADY_GRANTED: 'RECIPIENT_OWNS_PRODUCT',
  LEVEL_TOO_LOW: 'RECIPIENT_LEVEL_TOO_LOW',
  LEVEL_TOO_HIGH: 'RECIPIENT_LEVEL_TOO_HIGH',
  REQUIRES_ITEM: 'RECIPIENT_REQUIRES_ITEM',
};

function productBlockFor(ctx: STx, recipientId: bigint, p: ProductRow, exceptGift = 0n) {
  const b = productBlock(ctx as never, recipientId, p, true);
  if (b) return RECIPIENT_CODES[b] ?? b;
  const once = ctx.db.productRule.productId.find(p.id)?.isOneTime;
  if (once && [...ctx.db.friendGift.recipientId.filter(recipientId)].some(g => g.id !== exceptGift && g.kind === 'product' && g.productId === p.id && g.status === 'delivered')) return 'RECIPIENT_OWNS_PRODUCT';
  return '';
}

function event(ctx: STx, g: GiftRow, accountId: bigint, key: string) {
  const value = g.kind === 'currency' ? Number(g.amount) : g.kind === 'item' ? g.quantity : 1;
  const product = g.productId ? ctx.db.product.id.find(g.productId)?.key ?? '' : '';
  const meta: Record<string, string> = { giftId: String(g.id), kind: g.kind, source: g.source, key: g.itemKey || g.currencyKey || product, senderId: String(g.senderId), recipientId: String(g.recipientId) };
  if (g.itemKey) meta.itemKey = g.itemKey;
  if (g.currencyKey) {
    meta.currency = g.currencyKey;
    meta.amount = String(g.amount);
  }
  if (product) {
    meta.productKey = product;
    meta.method = g.method;
  }
  recordEvent(ctx, accountId, key, value, JSON.stringify(meta), 'server');
}

function channels(ctx: SDb) {
  const n = giftSettings(ctx).notify;
  return n === 'none' ? [] : n === 'push_in_app' ? ['inbox', 'push'] : ['inbox'];
}

function tell(ctx: STx, g: GiftRow, to: 'recipient' | 'sender', what: string) {
  const s = giftSettings(ctx);
  if (to === 'sender' && !s.notifySender) return;
  const id = to === 'recipient' ? g.recipientId : g.senderId;
  const other = nameOf(ctx, to === 'recipient' ? g.senderId : g.recipientId);
  const texts: Record<string, [string, string, string, string]> = {
    received: ['یک هدیه گرفتی', 'You got a gift', '{from} برایت هدیه فرستاد.', '{from} sent you a gift.'],
    pending: ['یک هدیه منتظر توست', 'A gift is waiting for you', '{from} برایت هدیه فرستاد. قبولش کن.', '{from} sent you a gift. Accept it.'],
    accepted: ['هدیه‌ات قبول شد', 'Your gift was accepted', '{from} هدیه‌ات را قبول کرد.', '{from} accepted your gift.'],
    returned: ['هدیه‌ات برگشت', 'Your gift came back', 'هدیه‌ای که برای {from} فرستادی برگشت.', 'The gift you sent to {from} came back.'],
    reversed: ['هدیه پس گرفته شد', 'A gift was taken back', 'هدیهٔ {from} پس گرفته شد.', 'The gift from {from} was taken back.'],
  };
  const x = texts[what];
  notify(ctx, id, channels(ctx), 'friend_gift', tr(x[0], x[1]), tr(x[2], x[3]), `gift:${g.id}`, { from: other || '#' });
}

function deliverCheck(ctx: STx, g: GiftRow) {
  if (g.kind === 'item') {
    const it = ctx.db.item.key.find(g.itemKey);
    if (!it) return 'ITEM_NOT_FOUND';
    return itemBlock(ctx, g.recipientId, it, g.quantity);
  }
  if (g.kind === 'product') {
    const p = ctx.db.product.id.find(g.productId);
    if (!p) return 'PRODUCT_NOT_FOUND';
    const b = productBlock(ctx as never, g.recipientId, p, true);
    return b ? RECIPIENT_CODES[b] ?? b : '';
  }
  return '';
}

function deliver(ctx: STx, g: GiftRow, status = 'delivered') {
  const now = nowUs(ctx);
  let rewards = '';
  if (g.kind === 'item') {
    const it = ctx.db.item.key.find(g.itemKey)!;
    addItem(ctx as never, g.recipientId, it as never, g.quantity, 'gift', `gift:${g.id}`, true);
    const row = invRow(ctx as never, g.recipientId, it.id);
    if (row && !it.stackable && g.itemLevel && giftSettings(ctx).upgradeLevel === 'keep') ctx.db.inventory.id.update({ ...row, level: g.itemLevel });
  } else if (g.kind === 'currency') {
    changeBalance(econ(ctx), g.recipientId, g.currencyKey, g.amount, 'gift_received', 'friend_gift', String(g.id));
  } else {
    rewards = JSON.stringify(grantPrize(econ(ctx), g.recipientId, g.prizeId, 'friend_gift', String(g.id)));
  }
  const next = ctx.db.friendGift.id.update({ ...g, status, outcome: 'delivered', deliveredAt: now, respondedAt: g.delivery === 'accept' ? now : g.respondedAt, rewards: rewards || g.rewards });
  event(ctx, next, next.recipientId, 'Gift:Received');
  act(ctx, next.recipientId, 'prize', 'gift_received', String(g.id), { kind: g.kind, from: String(g.senderId) });
  audit(base(ctx), g.recipientId, 'gift.delivered', `gift:${g.id}`, g.kind);
  return next;
}

function hold(ctx: STx, g: GiftRow) {
  const s = giftSettings(ctx);
  const next = ctx.db.friendGift.id.update({ ...g, status: 'pending', expiresAt: nowUs(ctx) + BigInt(Math.max(s.expiryHours, 1)) * HOUR_US });
  tell(ctx, next, 'recipient', 'pending');
  return next;
}

function sent(ctx: STx, g: GiftRow) {
  event(ctx, g, g.senderId, 'Gift:Sent');
  act(ctx, g.senderId, 'prize', 'gift_sent', String(g.id), { kind: g.kind, to: String(g.recipientId) });
  if (g.delivery === 'accept') return hold(ctx, g);
  const d = deliver(ctx, g);
  tell(ctx, d, 'recipient', 'received');
  return d;
}

function giveBack(ctx: STx, g: GiftRow) {
  const s = giftSettings(ctx);
  if (g.kind === 'item') {
    const it = ctx.db.item.key.find(g.itemKey);
    if (it) addItem(ctx as never, g.senderId, it as never, g.quantity, 'gift_return', `gift:${g.id}`);
    return 'returned';
  }
  if (g.kind === 'currency') {
    changeBalance(econ(ctx), g.senderId, g.currencyKey, g.amount, 'gift_returned', 'friend_gift', String(g.id));
    return 'returned';
  }
  const coins = g.method === 'in_app';
  const policy = coins ? s.coinReturn : s.moneyReturn;
  const p = ctx.db.product.id.find(g.productId);
  const refund = () => {
    if (coins && g.coinAmount > 0n && g.coinCurrency) {
      changeBalance(econ(ctx), g.senderId, g.coinCurrency, g.coinAmount, 'gift_refund', 'friend_gift', String(g.id));
      return 'refunded';
    }
    return 'refund_due';
  };
  if (policy === 'none') return 'kept';
  if (policy === 'refund') return refund();
  if (policy === 'refund_due') return 'refund_due';
  if (p && !productBlock(ctx as never, g.senderId, p, true)) {
    grantPrize(econ(ctx), g.senderId, g.prizeId, 'friend_gift_return', String(g.id));
    return 'sender_got';
  }
  return refund();
}

function returnGift(ctx: STx, g: GiftRow, status: string) {
  const outcome = giveBack(ctx, g);
  const next = ctx.db.friendGift.id.update({ ...g, status, outcome, respondedAt: nowUs(ctx) });
  if (status === 'cancelled') countGift(ctx, g, -1);
  act(ctx, g.senderId, 'prize', 'gift_returned', String(g.id), { status, outcome }, status === 'reversed' ? 'admin' : 'player');
  if (outcome !== 'kept' && status !== 'cancelled') tell(ctx, next, 'sender', 'returned');
  audit(base(ctx), status === 'declined' ? g.recipientId : g.senderId, `gift.${status}`, `gift:${g.id}`, outcome);
  return next;
}

function failGift(ctx: STx, id: bigint, error: string, outcome = '') {
  const g = ctx.db.friendGift.id.find(id);
  if (!g || (g.status !== 'paying' && g.status !== 'sending')) return;
  ctx.db.friendGift.id.update({ ...g, status: 'failed', error: error.slice(0, 200), outcome });
  countGift(ctx, g, -1);
}

export function syncGift(ctx: STx, g: GiftRow) {
  if (g.status !== 'paying') return g;
  if (!g.paymentId) {
    if (ctx.timestamp.microsSinceUnixEpoch - g.createdAt.microsSinceUnixEpoch > HOUR_US) failGift(ctx, g.id, 'PAYMENT_NOT_STARTED');
    return ctx.db.friendGift.id.find(g.id)!;
  }
  const p = ctx.db.payment.id.find(g.paymentId);
  if (!p) failGift(ctx, g.id, 'PAYMENT_NOT_FOUND');
  else if (p.status === 'failed' || p.status === 'expired') failGift(ctx, g.id, p.error || p.status.toUpperCase());
  else if (p.status === 'refused') failGift(ctx, g.id, p.error || 'REFUSED', p.method === 'in_app' ? 'refunded' : 'refund_due');
  return ctx.db.friendGift.id.find(g.id)!;
}

function expireGift(ctx: STx, g: GiftRow) {
  if (g.status !== 'pending' || !g.expiresAt || g.expiresAt > nowUs(ctx)) return g;
  if (giftSettings(ctx).onExpiry === 'accept' && !deliverCheck(ctx, g)) {
    const d = deliver(ctx, g);
    tell(ctx, d, 'sender', 'accepted');
    return d;
  }
  return returnGift(ctx, g, 'expired');
}

export function giftTick(ctx: STx) {
  for (const g of [...ctx.db.friendGift.status.filter('pending')]) expireGift(ctx, g);
  for (const g of [...ctx.db.friendGift.status.filter('paying')]) syncGift(ctx, g);
}

function cleanMessage(ctx: STx, raw: string) {
  const s = giftSettings(ctx);
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!text) return { text: '', flagged: false };
  if (!s.messageEnabled) fail('GIFT_MESSAGES_OFF');
  if ([...text].length > s.messageMaxLength) fail('MESSAGE_TOO_LONG');
  const f = filterText(ctx, text, s.messageFilter);
  if (f.blocked) fail('MESSAGE_BLOCKED');
  return { text: f.text, flagged: f.flagged };
}

function cleanRequestId(raw: string) {
  const id = raw.trim();
  if (id && !/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) fail('INVALID_REQUEST_ID');
  return id;
}

type SendArgs = { friendId: bigint; itemKey: string; quantity: number; currencyKey: string; amount: bigint; productId: bigint; method: string; giftCode: string; message: string; requestId: string };

function newGift(ctx: STx, me: bigint, a: SendArgs, fields: Partial<GiftRow>, status: string) {
  const s = giftSettings(ctx);
  const msg = cleanMessage(ctx, a.message);
  const g = ctx.db.friendGift.insert({
    id: 0n,
    senderId: me,
    recipientId: a.friendId,
    source: 'inventory',
    kind: 'item',
    itemKey: '',
    itemLevel: 0,
    quantity: 0,
    currencyKey: '',
    amount: 0n,
    productId: 0n,
    prizeId: 0n,
    paymentId: 0n,
    method: '',
    coinCurrency: '',
    coinAmount: 0n,
    message: msg.text,
    messageFlagged: msg.flagged,
    delivery: s.delivery,
    status,
    outcome: '',
    error: '',
    requestId: a.requestId,
    day: tehranDay(nowUs(ctx)),
    rewards: '',
    createdAt: ctx.timestamp,
    expiresAt: 0n,
    deliveredAt: 0n,
    respondedAt: 0n,
    reversedAt: 0n,
    reversedBy: 0n,
    reverseNote: '',
    ...fields,
  });
  countGift(ctx, g, 1);
  if (a.requestId) ctx.db.giftRequest.insert({ key: `${me}|${a.requestId}`, giftId: g.id, detail: detailOf(a) });
  audit(base(ctx), me, 'gift.send', `gift:${g.id}`, `${g.kind} to=${a.friendId} ${g.itemKey || g.currencyKey || g.productId}`);
  return g;
}

function detailOf(a: SendArgs) {
  return JSON.stringify([String(a.friendId), a.itemKey, a.quantity, a.currencyKey, String(a.amount), String(a.productId), a.method, a.message]);
}

function entry(ctx: SDb, g: GiftRow, otherId: bigint, showPay: boolean) {
  return {
    id: g.id,
    otherId,
    otherName: nameOf(ctx, otherId),
    kind: g.kind,
    source: g.source,
    itemKey: g.itemKey,
    quantity: g.quantity,
    currencyKey: g.currencyKey,
    amount: g.amount,
    productId: g.productId,
    productKey: g.productId ? ctx.db.product.id.find(g.productId)?.key ?? '' : '',
    method: showPay ? g.method : '',
    paymentId: showPay ? g.paymentId : 0n,
    message: g.message,
    status: g.status,
    outcome: g.outcome,
    delivery: g.delivery,
    createdAt: g.createdAt,
    expiresAt: g.expiresAt,
    deliveredAt: g.deliveredAt,
    respondedAt: g.respondedAt,
  };
}

function undoRewards(ctx: STx, accountId: bigint, rewards: Reward[]) {
  for (const r of rewards) {
    if (r.type === 'currency') changeBalance(econ(ctx), accountId, r.key, -BigInt(Math.trunc(r.value)), 'gift_reversed', 'friend_gift', '');
    else if (r.type === 'meta' && r.action === 'add') addMeta(econ(ctx), accountId, r.key, -r.value);
    else if (r.type === 'item' && r.value > 0) {
      const it = ctx.db.item.key.find(r.key);
      const row = it ? invRow(ctx as never, accountId, it.id) : undefined;
      if (!it || !row || row.quantity < r.value) fail('ITEM_GONE');
      takeItem(ctx as never, accountId, it as never, r.value);
    }
  }
}

export function defineGifts(st: SocialSchema) {
  purchaseChecks.push((raw, req, quote) => {
    if (!req.context.startsWith('friend_gift:')) return quote;
    const ctx = raw as unknown as STx;
    const g = ctx.db.friendGift.id.find(BigInt(req.context.slice(12)));
    if (!g || g.senderId !== req.accountId || g.status !== 'paying' || g.paymentId || g.productId !== req.product.id) fail('GIFT_NOT_FOUND');
    const s = giftSettings(ctx);
    return {
      ...quote,
      available: req.product.isActive && productVisible(ctx, req.accountId, req.product.audienceTagIds),
      methods: quote.methods.filter(m => s.methods.includes(methodKind(m))),
      giftAllowed: s.discountCodes,
    };
  });
  purchaseCreatedHooks.push((raw, paymentId, req) => {
    if (!req.context.startsWith('friend_gift:')) return;
    const ctx = raw as unknown as STx;
    const g = ctx.db.friendGift.id.find(BigInt(req.context.slice(12)))!;
    const p = ctx.db.payment.id.find(paymentId)!;
    ctx.db.friendGift.id.update({ ...g, paymentId, method: req.method, coinCurrency: p.coinCurrency, coinAmount: p.coinAmount });
  });
  payeeHooks.push((ctx, p) => {
    for (const g of (ctx as unknown as SDb).db.friendGift.paymentId.filter(p.id)) return g.recipientId;
    return undefined;
  });
  grantOverrides.push((raw, p) => {
    const ctx = raw as unknown as STx;
    const g = [...ctx.db.friendGift.paymentId.filter(p.id)][0];
    if (!g) return undefined;
    if (g.status !== 'paying') return g.rewards || '[]';
    const next = sent(ctx, g);
    return next.rewards || '[]';
  });
  metaUseChecks.push((raw, key) => {
    const ctx = raw as unknown as SDb;
    const f = ctx.db.friendSettings.id.find(0);
    const q = ctx.db.quotaSettings.id.find(0);
    const g = ctx.db.giftSettings.id.find(0);
    return [f?.requestsBonusMeta, f?.friendsBonusMeta, q?.packMeta, q?.bonusMeta, q?.unlimitedMeta, g?.sendBonusMeta, g?.receiveBonusMeta].includes(key);
  });
  currencyUseChecks.push((raw, key) => !!(raw as unknown as SDb).db.giftSettings.id.find(0)?.currencies.some(c => c.currencyKey === key));
  itemUseChecks.push((raw, key) => !!(raw as unknown as SDb).db.quotaSettings.id.find(0)?.unlimitedItems.includes(key));

  const giftOptions = st.procedure({ friendId: t.u64() }, Options, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx)).id;
      const s = giftSettings(tx);
      if (a.friendId === me) fail('GIFT_SELF');
      if (!isPlayer(tx, a.friendId)) fail('RECIPIENT_NOT_FOUND');
      const lim = giftLimits(tx, me, a.friendId, tehranDay(nowUs(tx)));
      const reason = (!s.enabled ? 'FRIEND_GIFTS_OFF' : '') || tryCode(() => checkWho(tx, me, a.friendId)) || tryCode(() => checkLimits(lim));
      const items = !s.inventoryEnabled
        ? []
        : [...tx.db.inventory.byAccountItem.filter(me)].flatMap(r => {
            const it = tx.db.item.id.find(r.itemId);
            if (!it) return [];
            const giftable = itemGiftable(tx, it) && !(r.source === 'starter' && !it.stackable);
            const why = !giftable ? 'ITEM_NOT_GIFTABLE' : r.equipped && s.equipped === 'block' ? 'ITEM_EQUIPPED' : s.regift === 'block' && r.source === 'gift' ? 'REGIFT_BLOCKED' : itemBlock(tx, a.friendId, it, 1) || (pendingFor(tx, a.friendId, g => g.kind === 'item' && g.itemKey === it.key && !it.stackable) ? 'GIFT_ALREADY_PENDING' : '');
            return [{ itemKey: it.key, quantity: r.quantity, level: r.level, equipped: r.equipped, recipientOwns: owns(tx as never, a.friendId, it.key), giftable, reason: why }];
          });
      const currencies = !s.currencyEnabled ? [] : s.currencies.map(c => ({ ...c, balance: balanceOf(econ(tx), me, c.currencyKey) }));
      const products = !s.shopEnabled
        ? []
        : [...tx.db.product.iter()]
            .filter(p => p.isActive && productVisible(tx, me, p.audienceTagIds))
            .map(p => {
              const giftable = productGiftable(tx, p);
              const methods = p.paymentMethods.filter(m => s.methods.includes(methodKind(m)));
              const why = !giftable ? 'PRODUCT_NOT_GIFTABLE' : !methods.length ? 'METHOD_NOT_ALLOWED' : productBlockFor(tx, a.friendId, p) || (pendingFor(tx, a.friendId, g => g.kind === 'product' && g.productId === p.id) ? 'GIFT_ALREADY_PENDING' : '');
              return { productId: p.id, key: p.key, priceToman: p.priceToman, coinCurrency: p.coinCurrency, coinAmount: p.coinAmount, methods, giftable, reason: why };
            });
      return {
        friendId: a.friendId,
        friendName: nameOf(tx, a.friendId),
        isFriend: areFriends(tx, me, a.friendId),
        canSend: !reason,
        reason,
        limits: lim,
        delivery: s.delivery,
        expiryHours: s.expiryHours,
        messageEnabled: s.messageEnabled,
        messageMaxLength: s.messageMaxLength,
        discountCodes: s.discountCodes,
        items,
        currencies,
        products,
      };
    })
  );

  const giftSend = st.procedure(
    { friendId: t.u64(), itemKey: t.string(), quantity: t.u32(), currencyKey: t.string(), amount: t.i64(), productId: t.u64(), method: t.string(), giftCode: t.string(), message: t.string(), requestId: t.string() },
    SendResult,
    (ctx, a) => {
      const args = { ...a, requestId: cleanRequestId(a.requestId) };
      const plan = ctx.withTx(tx => {
        const me = requireAccount(base(tx)).id;
        const s = giftSettings(tx);
        if (args.requestId) {
          const r = tx.db.giftRequest.key.find(`${me}|${args.requestId}`);
          if (r) {
            if (r.detail !== detailOf(args)) fail('REQUEST_ID_REUSED');
            const g = tx.db.friendGift.id.find(r.giftId)!;
            return { kind: 'done' as const, giftId: g.id, status: g.status, replayed: true };
          }
        }
        if (!s.enabled) fail('FRIEND_GIFTS_OFF');
        const sources = [!!args.itemKey, !!args.currencyKey, !!args.productId].filter(Boolean).length;
        if (sources !== 1) fail('GIFT_SOURCE_REQUIRED');
        checkWho(tx, me, args.friendId);
        checkLimits(giftLimits(tx, me, args.friendId, tehranDay(nowUs(tx))));
        if (args.itemKey) {
          if (!s.inventoryEnabled) fail('INVENTORY_GIFTS_OFF');
          const it = tx.db.item.key.find(args.itemKey);
          if (!it) fail('ITEM_NOT_FOUND');
          const row = invRow(tx as never, me, it.id);
          if (!row || row.quantity === 0) fail('ITEM_NOT_OWNED');
          const qty = it.stackable ? args.quantity || 1 : 1;
          if (qty > 100000) fail('INVALID_AMOUNT');
          if (row.quantity < qty) fail('ITEM_NOT_OWNED');
          if (row.source === 'starter' && !it.stackable) fail('STARTER_ITEM');
          if (!itemGiftable(tx, it)) fail('ITEM_NOT_GIFTABLE');
          if (row.equipped && s.equipped === 'block') fail('ITEM_EQUIPPED');
          if (s.regift === 'block' && row.source === 'gift') fail('REGIFT_BLOCKED');
          const block = itemBlock(tx, args.friendId, it, qty);
          if (block) fail(block);
          if (!it.stackable && pendingFor(tx, args.friendId, g => g.kind === 'item' && g.itemKey === it.key)) fail('GIFT_ALREADY_PENDING');
          const level = s.upgradeLevel === 'keep' ? row.level : 0;
          takeItem(tx as never, me, it as never, qty);
          const g = newGift(tx, me, args, { source: 'inventory', kind: 'item', itemKey: it.key, itemLevel: level, quantity: qty }, 'sending');
          const done = sent(tx, g);
          return { kind: 'done' as const, giftId: done.id, status: done.status, replayed: false };
        }
        if (args.currencyKey) {
          if (!s.currencyEnabled) fail('CURRENCY_GIFTS_OFF');
          const c = s.currencies.find(x => x.currencyKey === args.currencyKey);
          if (!c || !tx.db.currency.key.find(c.currencyKey)) fail('CURRENCY_NOT_GIFTABLE');
          const min = c.min > 1n ? c.min : 1n;
          if (args.amount < min || (c.max > 0n && args.amount > c.max)) fail('INVALID_AMOUNT');
          const g = newGift(tx, me, args, { source: 'inventory', kind: 'currency', currencyKey: c.currencyKey, amount: args.amount }, 'sending');
          changeBalance(econ(tx), me, c.currencyKey, -args.amount, 'gift_sent', 'friend_gift', String(g.id));
          const done = sent(tx, g);
          return { kind: 'done' as const, giftId: done.id, status: done.status, replayed: false };
        }
        if (!s.shopEnabled) fail('SHOP_GIFTS_OFF');
        const p = tx.db.product.id.find(args.productId);
        if (!p || !p.isActive || !productVisible(tx, me, p.audienceTagIds)) fail('PRODUCT_NOT_FOUND');
        if (!productGiftable(tx, p)) fail('PRODUCT_NOT_GIFTABLE');
        if (!p.paymentMethods.includes(args.method) || !s.methods.includes(methodKind(args.method))) fail('METHOD_NOT_ALLOWED');
        const block = productBlockFor(tx, args.friendId, p);
        if (block) fail(block);
        if (pendingFor(tx, args.friendId, g => g.kind === 'product' && g.productId === p.id)) fail('GIFT_ALREADY_PENDING');
        const g = newGift(tx, me, args, { source: 'shop', kind: 'product', productId: p.id, prizeId: p.prizeId, method: args.method }, 'paying');
        return { kind: 'pay' as const, giftId: g.id };
      });
      if (plan.kind === 'done') return { giftId: plan.giftId, status: plan.status, replayed: plan.replayed, purchase: undefined };
      let purchase;
      try {
        purchase = startPurchase(ctx as unknown as EProc, { productId: args.productId, method: args.method, giftCode: args.giftCode }, `friend_gift:${plan.giftId}`);
      } catch (e) {
        const code = String((e as Error)?.message ?? e);
        ctx.withTx(tx => {
          const g = tx.db.friendGift.id.find(plan.giftId);
          if (g) syncGift(tx, g);
          failGift(tx, plan.giftId, code);
        });
        throw e;
      }
      const status = ctx.withTx(tx => syncGift(tx, tx.db.friendGift.id.find(plan.giftId)!).status);
      return { giftId: plan.giftId, status, replayed: false, purchase };
    }
  );

  const giftAccept = st.reducer({ giftId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const g = ctx.db.friendGift.id.find(a.giftId);
    if (!g || g.recipientId !== me) fail('GIFT_NOT_FOUND');
    if (g.status !== 'pending') fail('GIFT_NOT_PENDING');
    if (g.expiresAt && g.expiresAt <= nowUs(ctx)) fail('GIFT_EXPIRED');
    const block = deliverCheck(ctx, g);
    if (block) fail(block);
    const d = deliver(ctx, g);
    tell(ctx, d, 'sender', 'accepted');
  });

  const giftDecline = st.reducer({ giftId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const g = ctx.db.friendGift.id.find(a.giftId);
    if (!g || g.recipientId !== me) fail('GIFT_NOT_FOUND');
    if (g.status !== 'pending') fail('GIFT_NOT_PENDING');
    returnGift(ctx, g, 'declined');
  });

  const giftCancel = st.reducer({ giftId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const g = ctx.db.friendGift.id.find(a.giftId);
    if (!g || g.senderId !== me) fail('GIFT_NOT_FOUND');
    if (g.status !== 'pending') fail('GIFT_NOT_PENDING');
    if (!giftSettings(ctx).senderCancel) fail('GIFT_CANCEL_OFF');
    returnGift(ctx, g, 'cancelled');
  });

  const HIDDEN = ['paying', 'sending', 'failed'];

  const myGiftsReceived = st.view({ name: 'my_gifts_received', public: true }, t.array(ReceivedEntry), ctx => {
    const me = sessionId(ctx as never);
    if (me === undefined) return [];
    return [...ctx.db.friendGift.recipientId.filter(me)].filter(g => !HIDDEN.includes(g.status)).map(g => entry(ctx as never, g, g.senderId, false));
  });

  const myGiftsSent = st.view({ name: 'my_gifts_sent', public: true }, t.array(SentEntry), ctx => {
    const me = sessionId(ctx as never);
    if (me === undefined) return [];
    return [...ctx.db.friendGift.senderId.filter(me)].map(g => entry(ctx as never, g, g.recipientId, true));
  });

  const adminGiftSettings = st.view({ name: 'admin_gift_settings', public: true }, t.option(socialRows.giftSettings), ctx => (adminOrNull(ctx as any) ? ctx.db.giftSettings.id.find(0) ?? undefined : undefined));

  const adminSaveGiftSettings = st.reducer(
    {
      enabled: t.bool(),
      recipients: t.string(),
      minFriendDays: t.u32(),
      minMutualFriends: t.u32(),
      minSenderAccountDays: t.u32(),
      minRecipientAccountDays: t.u32(),
      minSenderLevel: t.u32(),
      levelTableId: t.u64(),
      inventoryEnabled: t.bool(),
      itemsDefault: t.bool(),
      equipped: t.string(),
      upgradeLevel: t.string(),
      regift: t.string(),
      itemRequirements: t.string(),
      currencyEnabled: t.bool(),
      currencies: t.array(GiftCurrency),
      shopEnabled: t.bool(),
      productsDefault: t.bool(),
      methods: t.array(t.string()),
      discountCodes: t.bool(),
      perSenderDaily: t.u32(),
      perRecipientDaily: t.u32(),
      perPairDaily: t.u32(),
      matchPolicy: t.string(),
      sendBonusMeta: t.string(),
      receiveBonusMeta: t.string(),
      delivery: t.string(),
      expiryHours: t.u32(),
      onExpiry: t.string(),
      coinReturn: t.string(),
      moneyReturn: t.string(),
      senderCancel: t.bool(),
      messageEnabled: t.bool(),
      messageMaxLength: t.u32(),
      messageFilter: t.string(),
      notify: t.string(),
      notifySender: t.bool(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      oneOf(a.recipients, ['friends', 'any'], 'recipients');
      oneOf(a.equipped, ['block', 'unequip'], 'equipped');
      oneOf(a.upgradeLevel, ['keep', 'reset'], 'upgradeLevel');
      oneOf(a.regift, ['block', 'allow'], 'regift');
      oneOf(a.itemRequirements, ['check', 'ignore'], 'itemRequirements');
      oneOf(a.matchPolicy, ['priority', 'generous'], 'matchPolicy');
      oneOf(a.delivery, ['instant', 'accept'], 'delivery');
      oneOf(a.onExpiry, ['return', 'accept'], 'onExpiry');
      oneOf(a.coinReturn, ['refund', 'sender', 'none'], 'coinReturn');
      oneOf(a.moneyReturn, ['sender', 'refund_due', 'none'], 'moneyReturn');
      oneOf(a.messageFilter, ['rules', 'block', 'off'], 'messageFilter');
      oneOf(a.notify, ['in_app', 'push_in_app', 'none'], 'notify');
      const methods = [...new Set(a.methods)];
      for (const m of methods) oneOf(m, ['in_app', 'gateway', 'store'], 'methods');
      if (a.levelTableId && !ctx.db.levelTable.id.find(a.levelTableId)) fail('LEVEL_TABLE_NOT_FOUND');
      if (a.expiryHours < 1 || a.expiryHours > 24 * 90) fail('INVALID_SETTING:expiryHours');
      if (a.messageMaxLength < 1 || a.messageMaxLength > 500) fail('INVALID_SETTING:messageMaxLength');
      for (const [f, v] of [['minFriendDays', a.minFriendDays], ['minSenderAccountDays', a.minSenderAccountDays], ['minRecipientAccountDays', a.minRecipientAccountDays]] as const) if (v > 3650) fail(`INVALID_SETTING:${f}`);
      for (const [f, v] of [['perSenderDaily', a.perSenderDaily], ['perRecipientDaily', a.perRecipientDaily], ['perPairDaily', a.perPairDaily]] as const) if (v > 10000) fail(`INVALID_SETTING:${f}`);
      const seen = new Set<string>();
      for (const c of a.currencies) {
        if (!ctx.db.currency.key.find(c.currencyKey)) fail('CURRENCY_NOT_FOUND');
        if (seen.has(c.currencyKey)) fail('DUPLICATE_CURRENCY');
        seen.add(c.currencyKey);
        if (c.min < 0n || c.max < 0n || (c.max > 0n && c.max < c.min)) fail('INVALID_AMOUNT');
      }
      ctx.db.giftSettings.id.update({ id: 0, ...a, methods, sendBonusMeta: metaOk(ctx, a.sendBonusMeta), receiveBonusMeta: metaOk(ctx, a.receiveBonusMeta), updatedAt: ctx.timestamp });
      audit(base(ctx), me.id, 'gift_settings.save', 'settings', JSON.stringify({ ...a, levelTableId: String(a.levelTableId), currencies: a.currencies.map(c => c.currencyKey) }));
    }
  );

  const adminGiftRules = st.view({ name: 'admin_gift_rules', public: true }, t.array(socialRows.giftRule), ctx => (adminOrNull(ctx as any) ? [...ctx.db.giftRule.iter()] : []));

  const adminSaveGiftRule = st.reducer(
    { id: t.u64(), name: t.string(), tagIds: t.array(t.u64()), priority: t.i32(), perSenderDaily: t.option(t.u32()), perRecipientDaily: t.option(t.u32()), perPairDaily: t.option(t.u32()), canSend: t.bool(), isActive: t.bool() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const name = cleanName(a.name);
      const tagIds = tagsOk(ctx, a.tagIds);
      checkPriority(a.priority);
      if ([a.perSenderDaily, a.perRecipientDaily, a.perPairDaily].some(v => (v ?? 0) > 10000)) fail('INVALID_LIMIT');
      const old = a.id ? ctx.db.giftRule.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const row = { ...a, perSenderDaily: a.perSenderDaily, perRecipientDaily: a.perRecipientDaily, perPairDaily: a.perPairDaily, name, tagIds, createdAt: old?.createdAt ?? ctx.timestamp, updatedAt: ctx.timestamp };
      const saved = old ? ctx.db.giftRule.id.update(row) : ctx.db.giftRule.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'gift_rule.update' : 'gift_rule.create', String(saved.id), name);
    }
  );

  const adminDeleteGiftRule = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.giftRule.id.delete(a.id)) fail('NOT_FOUND');
    audit(base(ctx), me.id, 'gift_rule.delete', String(a.id));
  });

  const adminGiftables = st.view({ name: 'admin_giftables', public: true }, t.array(socialRows.giftable), ctx => (adminOrNull(ctx as any) ? [...ctx.db.giftable.iter()] : []));

  const adminSetGiftable = st.reducer({ kind: t.string(), key: t.string(), giftable: t.option(t.bool()) }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (a.kind === 'item' && !ctx.db.item.key.find(a.key)) fail('ITEM_NOT_FOUND');
    else if (a.kind === 'item_type' && !ctx.db.itemType.key.find(a.key)) fail('ITEM_TYPE_NOT_FOUND');
    else if (a.kind === 'product' && !ctx.db.product.key.find(a.key)) fail('PRODUCT_NOT_FOUND');
    else if (!['item', 'item_type', 'product'].includes(a.kind)) fail('INVALID_KIND');
    const key = `${a.kind}:${a.key}`;
    if (a.giftable === undefined) ctx.db.giftable.key.delete(key);
    else {
      const row = { key, kind: a.kind, refKey: a.key, giftable: a.giftable, updatedAt: ctx.timestamp };
      if (ctx.db.giftable.key.find(key)) ctx.db.giftable.key.update(row);
      else ctx.db.giftable.insert(row);
    }
    audit(base(ctx), me.id, 'giftable.set', key, String(a.giftable ?? 'default'));
  });

  const adminRow = (ctx: SDb, g: GiftRow) => ({ gift: g, senderName: nameOf(ctx, g.senderId), recipientName: nameOf(ctx, g.recipientId) });

  const adminFriendGifts = st.procedure(
    { status: t.string(), kind: t.string(), userId: t.u64(), flagged: t.bool(), page: t.u32(), pageSize: t.u32() },
    AdminGiftPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(base(tx), 'operator');
        const src = a.userId ? [...tx.db.friendGift.senderId.filter(a.userId), ...tx.db.friendGift.recipientId.filter(a.userId)] : a.status ? [...tx.db.friendGift.status.filter(a.status)] : [...tx.db.friendGift.iter()];
        const uniq = new Map(src.map(g => [g.id, g]));
        const list = [...uniq.values()].filter(g => (!a.status || g.status === a.status) && (!a.kind || g.kind === a.kind) && (!a.flagged || g.messageFlagged)).sort((x, y) => (x.id < y.id ? 1 : -1));
        const p = page(list, a.page, a.pageSize);
        return { total: p.total, rows: p.rows.map(g => adminRow(tx, g)) };
      })
  );

  const adminFriendGift = st.procedure({ id: t.u64() }, AdminGiftDetail, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const g = tx.db.friendGift.id.find(a.id);
      if (!g) fail('NOT_FOUND');
      const target = `gift:${g.id}`;
      const trail = [...tx.db.audit.accountId.filter(g.senderId), ...tx.db.audit.accountId.filter(g.recipientId)]
        .filter(r => r.target === target)
        .concat([...tx.db.audit.iter()].filter(r => r.target === target && r.accountId !== g.senderId && r.accountId !== g.recipientId))
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .map(r => ({ accountId: r.accountId, action: r.action, detail: r.detail, at: r.at }));
      return { row: adminRow(tx, g), trail };
    })
  );

  const adminReverseFriendGift = st.reducer({ id: t.u64(), returnTo: t.string(), note: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    oneOf(a.returnTo, ['sender', 'refund', 'none'], 'returnTo');
    let g = ctx.db.friendGift.id.find(a.id);
    if (!g) fail('NOT_FOUND');
    const note = a.note.trim().slice(0, 300);
    const target = `gift:${g.id}`;
    if (g.status === 'pending') {
      g = returnGift(ctx, g, 'reversed');
      ctx.db.friendGift.id.update({ ...g, reversedAt: nowUs(ctx), reversedBy: me.id, reverseNote: note });
      audit(base(ctx), me.id, 'gift.reverse', target, `pending ${g.outcome} ${note}`);
      return;
    }
    if (g.status !== 'delivered') fail('GIFT_NOT_REVERSIBLE');
    if (a.returnTo === 'refund' && (g.kind !== 'product' || g.method !== 'in_app' || !g.coinAmount)) fail('INVALID_POLICY');
    if (g.kind === 'item') {
      const it = ctx.db.item.key.find(g.itemKey);
      const row = it ? invRow(ctx as never, g.recipientId, it.id) : undefined;
      if (!it || !row || row.quantity < g.quantity) fail('ITEM_GONE');
      takeItem(ctx as never, g.recipientId, it as never, g.quantity);
    } else if (g.kind === 'currency') {
      changeBalance(econ(ctx), g.recipientId, g.currencyKey, -g.amount, 'gift_reversed', 'friend_gift', String(g.id));
    } else {
      let rewards: Reward[] = [];
      try {
        rewards = JSON.parse(g.rewards || '[]') as Reward[];
      } catch {}
      undoRewards(ctx, g.recipientId, rewards);
    }
    let outcome = 'kept';
    if (a.returnTo === 'refund') {
      if (g.kind !== 'product' || g.method !== 'in_app' || !g.coinAmount) fail('INVALID_POLICY');
      changeBalance(econ(ctx), g.senderId, g.coinCurrency, g.coinAmount, 'gift_refund', 'friend_gift', String(g.id));
      outcome = 'refunded';
    } else if (a.returnTo === 'sender') {
      if (g.kind === 'item') addItem(ctx as never, g.senderId, ctx.db.item.key.find(g.itemKey)! as never, g.quantity, 'gift_return', target);
      else if (g.kind === 'currency') changeBalance(econ(ctx), g.senderId, g.currencyKey, g.amount, 'gift_returned', 'friend_gift', String(g.id));
      else grantPrize(econ(ctx), g.senderId, g.prizeId, 'friend_gift_reverse', String(g.id));
      outcome = g.kind === 'product' ? 'sender_got' : 'returned';
    }
    const next = ctx.db.friendGift.id.update({ ...g, status: 'reversed', outcome, reversedAt: nowUs(ctx), reversedBy: me.id, reverseNote: note });
    tell(ctx, next, 'recipient', 'reversed');
    act(ctx, g.recipientId, 'prize', 'gift_reversed', String(g.id), { returnTo: a.returnTo }, `admin:${me.id}`);
    act(ctx, g.senderId, 'prize', 'gift_reversed', String(g.id), { returnTo: a.returnTo }, `admin:${me.id}`);
    audit(base(ctx), me.id, 'gift.reverse', target, `${a.returnTo} ${note}`);
  });

  const adminFriendGiftReport = st.procedure({ days: t.u32() }, GiftReport, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const today = tehranDay(nowUs(tx));
      const from = today - Math.min(Math.max(a.days || 30, 1), 400) + 1;
      const list = [...tx.db.friendGift.iter()].filter(g => g.day >= from && g.day <= today);
      const tally = (f: (g: GiftRow) => string) => {
        const m = new Map<string, number>();
        for (const g of list) m.set(f(g), (m.get(f(g)) ?? 0) + 1);
        return [...m.entries()].map(([key, count]) => ({ key, count }));
      };
      const top = (f: (g: GiftRow) => bigint) => {
        const m = new Map<bigint, number>();
        for (const g of list) if (g.status === 'delivered' || g.status === 'pending') m.set(f(g), (m.get(f(g)) ?? 0) + 1);
        return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([accountId, count]) => ({ accountId, displayName: nameOf(tx, accountId), count }));
      };
      let moneyToman = 0n;
      let coinsSpent = 0n;
      let currencyMoved = 0n;
      for (const g of list) {
        if (g.kind === 'currency' && g.status === 'delivered') currencyMoved += g.amount;
        if (g.kind === 'product' && g.paymentId) {
          const p = tx.db.payment.id.find(g.paymentId);
          if (p && p.status === 'success') {
            if (p.method === 'in_app') coinsSpent += p.coinAmount;
            else moneyToman += p.finalToman;
          }
        }
      }
      const daily = new Map<number, number>();
      for (const g of list) daily.set(g.day, (daily.get(g.day) ?? 0) + 1);
      return {
        total: list.length,
        byStatus: tally(g => g.status),
        byKind: tally(g => g.kind),
        senders: new Set(list.map(g => g.senderId)).size,
        recipients: new Set(list.map(g => g.recipientId)).size,
        moneyToman,
        coinsSpent,
        currencyMoved,
        topSenders: top(g => g.senderId),
        topRecipients: top(g => g.recipientId),
        daily: [...daily.entries()].sort((x, y) => x[0] - y[0]).map(([day, count]) => ({ day, count })),
      };
    })
  );

  return {
    giftOptions,
    giftSend,
    giftAccept,
    giftDecline,
    giftCancel,
    myGiftsReceived,
    myGiftsSent,
    adminGiftSettings,
    adminSaveGiftSettings,
    adminGiftRules,
    adminSaveGiftRule,
    adminDeleteGiftRule,
    adminGiftables,
    adminSetGiftable,
    adminFriendGifts,
    adminFriendGift,
    adminReverseFriendGift,
    adminFriendGiftReport
  };
}
