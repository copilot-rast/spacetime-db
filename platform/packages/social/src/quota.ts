import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { Translations, adminOrNull, audit, cleanTranslations, fail, requireAccount, requireRole, translate, type Tr } from '@stg/base';
import { setMeta } from '@stg/economy';
import { owns } from '@stg/items';
import { socialRows, type SocialSchema } from './schema';
import {
  DAY_US,
  MIN_US,
  areFriends,
  base,
  checkPriority,
  cleanName,
  econ,
  matchingRules,
  metaBonus,
  metaOk,
  nameOf,
  notify,
  nowUs,
  oneOf,
  resolveLimits,
  tagsOk,
  tr,
  type SDb,
  type STx,
} from './engine';

const Usage = t.object('QuotaUsage', { limit: t.u32(), used: t.u32(), left: t.u32() });
const FriendUsage = t.object('QuotaFriendUsage', { messages: Usage, conversations: Usage });
const QuotaRuleRef = t.object('QuotaRuleRef', { id: t.u64(), name: t.string() });
const PackProduct = t.object('QuotaPackProduct', { id: t.u64(), key: t.string(), amount: t.f64() });
const Today = t.object('QuotaToday', { sent: t.u32(), fromPacks: t.u32(), free: t.u32(), unlimited: t.u32(), blocked: t.u32() });

export const QuotaRefusal = t.object('QuotaRefusal', {
  code: t.string(),
  unit: t.string(),
  limit: t.u32(),
  used: t.u32(),
  packsLeft: t.u32(),
  resetsAt: t.timestamp(),
  friend: t.bool(),
  rule: t.option(QuotaRuleRef),
  message: t.string(),
  products: t.array(PackProduct),
});

const QuotaStatus = t.object('QuotaStatus', {
  enabled: t.bool(),
  countMode: t.string(),
  unlimited: t.bool(),
  unlimitedBy: t.string(),
  rule: t.option(QuotaRuleRef),
  freeLeft: t.u32(),
  packsLeft: t.u32(),
  packsExpireAt: t.u64(),
  order: t.string(),
  day: t.i32(),
  resetsAt: t.timestamp(),
  messages: Usage,
  conversations: Usage,
  friends: t.option(FriendUsage),
  friendPolicy: t.string(),
  replyFree: t.string(),
  bonus: t.u32(),
  today: Today,
  products: t.array(PackProduct),
});

const AdminQuota = t.object('AdminPlayerQuota', { status: QuotaStatus, lots: t.array(socialRows.quotaLot), days: t.array(socialRows.quotaDay) });
const ReportDay = t.object('QuotaReportDay', { day: t.i32(), sent: t.u32(), blocked: t.u32(), fromPacks: t.u32() });
const TopRow = t.object('QuotaTopRow', { accountId: t.u64(), displayName: t.string(), blocked: t.u32() });
const QuotaReport = t.object('QuotaReport', {
  sent: t.u32(),
  blocked: t.u32(),
  blockedPlayers: t.u32(),
  fromPacks: t.u32(),
  free: t.u32(),
  unlimited: t.u32(),
  daily: t.array(ReportDay),
  top: t.array(TopRow),
  packsFromMeta: t.u32(),
  packsFromAdmin: t.u32(),
});

type DayRow = NonNullable<ReturnType<STx['db']['quotaDay']['key']['find']>>;

export function quotaSettings(ctx: SDb) {
  const s = ctx.db.quotaSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

function shift(s: { resetMinute: number; utcOffsetMinutes: number }) {
  return BigInt(s.utcOffsetMinutes - s.resetMinute) * MIN_US;
}

export function quotaDayOf(s: { resetMinute: number; utcOffsetMinutes: number }, us: bigint) {
  const x = us + shift(s);
  return Number((x - (((x % DAY_US) + DAY_US) % DAY_US)) / DAY_US);
}

function resetsAt(ctx: STx, s: { resetMinute: number; utcOffsetMinutes: number }, day: number) {
  const end = BigInt(day + 1) * DAY_US - shift(s);
  return new Timestamp(end - (nowUs(ctx) - ctx.timestamp.microsSinceUnixEpoch));
}

function limitsOf(ctx: STx, accountId: bigint) {
  const s = quotaSettings(ctx);
  const rules = matchingRules(ctx, accountId, ctx.db.quotaRule.iter());
  const r = resolveLimits(
    rules,
    s.matchPolicy,
    { dailyMessages: s.dailyMessages, dailyConversations: s.dailyConversations, friendDailyMessages: s.friendDailyMessages, friendDailyConversations: s.friendDailyConversations },
    (x, f) => x[f] ?? undefined
  );
  let unlimitedBy = '';
  if (s.matchPolicy === 'generous' ? rules.some(x => x.unlimited) : rules[0]?.unlimited) unlimitedBy = 'rule';
  else if (s.unlimitedItems.some(k => owns(ctx as never, accountId, k))) unlimitedBy = 'item';
  else if (s.unlimitedMeta && ctx.db.meta.key.find(s.unlimitedMeta)) {
    const v = [...ctx.db.userMeta.byAccountMeta.filter([accountId, s.unlimitedMeta])][0]?.value ?? ctx.db.meta.key.find(s.unlimitedMeta)!.defaultValue;
    if (s.unlimitedMetaMode === 'until' ? v * 1_000_000 > Number(nowUs(ctx)) : v > 0) unlimitedBy = 'meta';
  }
  const bonus = metaBonus(ctx, accountId, s.bonusMeta);
  const mainUnit = s.countMode === 'conversations' ? 'conversations' : 'messages';
  return {
    s,
    rule: r.rule,
    unlimitedBy,
    bonus,
    messages: r.values.dailyMessages + (mainUnit === 'messages' ? bonus : 0),
    conversations: r.values.dailyConversations + (mainUnit === 'conversations' ? bonus : 0),
    friendMessages: r.values.friendDailyMessages,
    friendConversations: r.values.friendDailyConversations,
  };
}

function liveLots(ctx: STx, accountId: bigint) {
  const now = nowUs(ctx);
  return [...ctx.db.quotaLot.accountId.filter(accountId)]
    .filter(l => l.remaining > 0 && (!l.expiresAt || l.expiresAt > now))
    .sort((a, b) => (a.expiresAt === b.expiresAt ? (a.id < b.id ? -1 : 1) : !a.expiresAt ? 1 : !b.expiresAt ? -1 : a.expiresAt < b.expiresAt ? -1 : 1));
}

export function convertPacks(ctx: STx, accountId: bigint) {
  const s = quotaSettings(ctx);
  if (!s.packMeta || !ctx.db.meta.key.find(s.packMeta)) return;
  const m = ctx.db.meta.key.find(s.packMeta)!;
  const row = [...ctx.db.userMeta.byAccountMeta.filter([accountId, s.packMeta])][0];
  const v = row?.value ?? m.defaultValue;
  const whole = Math.floor(v);
  if (!(whole >= 1)) return;
  setMeta(econ(ctx), accountId, s.packMeta, v - whole);
  const now = nowUs(ctx);
  const at = row?.updatedAt.microsSinceUnixEpoch ?? ctx.timestamp.microsSinceUnixEpoch;
  const start = at + (now - ctx.timestamp.microsSinceUnixEpoch);
  ctx.db.quotaLot.insert({ id: 0n, accountId, amount: Math.min(whole, 1_000_000_000), remaining: Math.min(whole, 1_000_000_000), source: 'meta', note: s.packMeta, expiresAt: s.packExpiryDays ? start + BigInt(s.packExpiryDays) * DAY_US : 0n, createdBy: 0n, createdAt: ctx.timestamp });
}

function packProducts(ctx: STx) {
  const s = quotaSettings(ctx);
  const list = s.packProducts.length ? s.packProducts.map(k => ctx.db.product.key.find(k)).filter(p => !!p) : [...ctx.db.product.iter()].filter(p => p.isActive);
  const out: { id: bigint; key: string; amount: number }[] = [];
  for (const p of list) {
    if (!p) continue;
    const prize = ctx.db.prize.id.find(p.prizeId);
    const amount = prize?.items.filter(i => i.type === 'meta' && i.key === s.packMeta && i.action !== 'set').reduce((x, i) => x + i.value, 0) ?? 0;
    if (s.packProducts.length || (s.packMeta && amount > 0)) out.push({ id: p.id, key: p.key, amount });
  }
  return out;
}

function dayRow(ctx: STx, accountId: bigint, day: number): DayRow {
  return ctx.db.quotaDay.key.find(`${accountId}|${day}`) ?? { key: `${accountId}|${day}`, accountId, day, messages: 0, conversations: 0, friendMessages: 0, friendConversations: 0, packUsed: 0, freeSent: 0, unlimitedSent: 0, total: 0, blocked: 0, notified: false };
}

function saveDay(ctx: STx, row: DayRow) {
  if (ctx.db.quotaDay.key.find(row.key)) ctx.db.quotaDay.key.update(row);
  else ctx.db.quotaDay.insert(row);
}

const usage = (limit: number, used: number) => ({ limit, used, left: Math.max(limit - used, 0) });

export function quotaStatus(ctx: STx, accountId: bigint) {
  const l = limitsOf(ctx, accountId);
  const s = l.s;
  if (s.enabled) convertPacks(ctx, accountId);
  const day = quotaDayOf(s, nowUs(ctx));
  const row = dayRow(ctx, accountId, day);
  const lots = liveLots(ctx, accountId);
  const packsLeft = lots.reduce((x, y) => x + y.remaining, 0);
  const mainUnit = s.countMode === 'conversations' ? 'conversations' : 'messages';
  return {
    enabled: s.enabled,
    countMode: s.countMode,
    unlimited: !!l.unlimitedBy,
    unlimitedBy: l.unlimitedBy,
    rule: l.rule,
    freeLeft: mainUnit === 'messages' ? Math.max(l.messages - row.messages, 0) : Math.max(l.conversations - row.conversations, 0),
    packsLeft,
    packsExpireAt: lots.find(x => x.expiresAt)?.expiresAt ?? 0n,
    order: s.order,
    day,
    resetsAt: resetsAt(ctx, s, day),
    messages: usage(l.messages, row.messages),
    conversations: usage(l.conversations, row.conversations),
    friends: s.friendPolicy === 'separate' ? { messages: usage(l.friendMessages, row.friendMessages), conversations: usage(l.friendConversations, row.friendConversations) } : undefined,
    friendPolicy: s.friendPolicy,
    replyFree: s.replyFree,
    bonus: l.bonus,
    today: { sent: row.total, fromPacks: row.packUsed, free: row.freeSent, unlimited: row.unlimitedSent, blocked: row.blocked },
    products: packProducts(ctx),
  };
}

const BUILT_IN: Tr[] = tr('سهمیهٔ پیام خصوصی امروزت تمام شد. از {reset} دوباره می‌توانی پیام بدهی.', 'Your private message quota for today is used up. You can send again from {reset}.');

export type GateTarget = { kind: string; target: string; peerId: bigint; startedByPeer: boolean };

export function quotaGate(ctx: STx, accountId: bigint, g: GateTarget) {
  const s = quotaSettings(ctx);
  if (!s.enabled) return undefined;
  const counted = g.kind === 'direct' ? s.countDirect : g.kind === 'group' ? s.countGroups : s.countRooms;
  if (!counted) return undefined;
  convertPacks(ctx, accountId);
  const now = nowUs(ctx);
  const day = quotaDayOf(s, now);
  const row = dayRow(ctx, accountId, day);
  const l = limitsOf(ctx, accountId);
  const tkey = `${accountId}|${g.target}`;
  const tgt = ctx.db.quotaTarget.key.find(tkey);
  const pass = (mut: (r: DayRow) => void) => {
    mut(row);
    row.total++;
    saveDay(ctx, row);
    const next = { key: tkey, accountId, target: g.target, firstAt: tgt && tgt.firstAt ? tgt.firstAt : now, lastAt: now, lastDay: day, replyOwed: false };
    if (tgt) ctx.db.quotaTarget.key.update(next);
    else ctx.db.quotaTarget.insert(next);
    if (g.kind === 'direct') {
      const pk = `${g.peerId}|u:${accountId}`;
      const p = ctx.db.quotaTarget.key.find(pk);
      if (p) ctx.db.quotaTarget.key.update({ ...p, replyOwed: true });
      else ctx.db.quotaTarget.insert({ key: pk, accountId: g.peerId, target: `u:${accountId}`, firstAt: 0n, lastAt: 0n, lastDay: -1, replyOwed: true });
    }
    return undefined;
  };
  if (l.unlimitedBy) return pass(r => r.unlimitedSent++);
  const friend = g.kind === 'direct' && areFriends(ctx, accountId, g.peerId);
  if (friend && s.friendPolicy === 'free') return pass(r => r.freeSent++);
  if (s.replyFree === 'started' && g.kind === 'direct' && g.startedByPeer) return pass(r => r.freeSent++);
  if (s.replyFree === 'reply' && tgt?.replyOwed) return pass(r => r.freeSent++);
  const newChat = !tgt || !tgt.firstAt || (s.conversationScope === 'day' && tgt.lastDay !== day);
  const sep = friend && s.friendPolicy === 'separate';
  const msgLimit = sep ? l.friendMessages : l.messages;
  const convLimit = sep ? l.friendConversations : l.conversations;
  const usedMsg = sep ? row.friendMessages : row.messages;
  const usedConv = sep ? row.friendConversations : row.conversations;
  const lots = liveLots(ctx, accountId);
  const packsLeft = lots.reduce((x, y) => x + y.remaining, 0);
  const refuse = (code: string, unit: string, limit: number, used: number) => {
    row.blocked++;
    const at = resetsAt(ctx, s, day);
    const lang = ctx.db.account.id.find(accountId)?.lang ?? 'fa';
    const iso = new Date(Number(at.microsSinceUnixEpoch / 1000n)).toISOString();
    const text = translate(s.message.length ? s.message : BUILT_IN, lang, 'fa').replace('{reset}', iso).replace('{limit}', String(limit));
    if (s.notice === 'inbox' && !row.notified) {
      row.notified = true;
      notify(ctx, accountId, ['inbox'], 'chat_quota', tr('سهمیهٔ پیام تمام شد', 'Message quota used up'), s.message.length ? s.message : BUILT_IN, 'chat_quota', { reset: iso, limit: String(limit) });
    }
    saveDay(ctx, row);
    return { code, unit, limit, used, packsLeft, resetsAt: at, friend, rule: l.rule, message: text, products: packProducts(ctx) };
  };
  const spendPack = () => {
    const lot = lots[0];
    ctx.db.quotaLot.id.update({ ...lot, remaining: lot.remaining - 1 });
  };
  const cost = (unit: 'messages' | 'conversations', limit: number, used: number, extra: (r: DayRow) => void) => {
    const free = used < limit;
    const pack = packsLeft > 0;
    const useFree = (r: DayRow) => {
      if (unit === 'messages') {
        if (sep) r.friendMessages++;
        else r.messages++;
      } else if (sep) r.friendConversations++;
      else r.conversations++;
      extra(r);
    };
    const usePack = (r: DayRow) => {
      spendPack();
      r.packUsed++;
      extra(r);
    };
    if (s.order === 'packs_first' && pack) return pass(usePack);
    if (free) return pass(useFree);
    if (pack) return pass(usePack);
    return refuse('DM_QUOTA_EXCEEDED', unit, limit, used);
  };
  if (s.countMode === 'conversations') {
    if (!newChat) return pass(() => {});
    return cost('conversations', convLimit, usedConv, () => {});
  }
  if (s.countMode === 'both' && newChat && usedConv >= convLimit) return refuse('DM_CONVERSATION_LIMIT', 'conversations', convLimit, usedConv);
  return cost('messages', msgLimit, usedMsg, r => {
    if (s.countMode === 'both' && newChat) {
      if (sep) r.friendConversations++;
      else r.conversations++;
    }
  });
}

export function defineQuota(st: SocialSchema) {
  const chatQuota = st.procedure(QuotaStatus, ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx)).id;
      return quotaStatus(tx, me);
    })
  );

  const adminQuotaSettings = st.view({ name: 'admin_quota_settings', public: true }, t.option(socialRows.quotaSettings), ctx =>
    adminOrNull(ctx as any) ? ctx.db.quotaSettings.id.find(0) ?? undefined : undefined
  );

  const adminSaveQuotaSettings = st.reducer(
    {
      enabled: t.bool(),
      countMode: t.string(),
      dailyMessages: t.u32(),
      dailyConversations: t.u32(),
      conversationScope: t.string(),
      resetMinute: t.u16(),
      utcOffsetMinutes: t.i32(),
      countDirect: t.bool(),
      countGroups: t.bool(),
      countRooms: t.bool(),
      replyFree: t.string(),
      friendPolicy: t.string(),
      friendDailyMessages: t.u32(),
      friendDailyConversations: t.u32(),
      packMeta: t.string(),
      packExpiryDays: t.u32(),
      order: t.string(),
      packProducts: t.array(t.string()),
      bonusMeta: t.string(),
      matchPolicy: t.string(),
      unlimitedItems: t.array(t.string()),
      unlimitedMeta: t.string(),
      unlimitedMetaMode: t.string(),
      message: Translations,
      notice: t.string(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      oneOf(a.countMode, ['messages', 'conversations', 'both'], 'countMode');
      oneOf(a.conversationScope, ['day', 'ever'], 'conversationScope');
      oneOf(a.replyFree, ['off', 'started', 'reply'], 'replyFree');
      oneOf(a.friendPolicy, ['same', 'separate', 'free'], 'friendPolicy');
      oneOf(a.order, ['free_first', 'packs_first'], 'order');
      oneOf(a.matchPolicy, ['priority', 'generous'], 'matchPolicy');
      oneOf(a.unlimitedMetaMode, ['positive', 'until'], 'unlimitedMetaMode');
      oneOf(a.notice, ['none', 'inbox'], 'notice');
      for (const [f, v] of [['dailyMessages', a.dailyMessages], ['dailyConversations', a.dailyConversations], ['friendDailyMessages', a.friendDailyMessages], ['friendDailyConversations', a.friendDailyConversations]] as const) {
        if (v > 100000) fail(`INVALID_SETTING:${f}`);
      }
      if (a.resetMinute > 1439) fail('INVALID_SETTING:resetMinute');
      if (a.utcOffsetMinutes < -720 || a.utcOffsetMinutes > 840) fail('INVALID_TIMEZONE');
      if (a.packExpiryDays > 3650) fail('INVALID_SETTING:packExpiryDays');
      const packMeta = metaOk(ctx, a.packMeta);
      const bonusMeta = metaOk(ctx, a.bonusMeta);
      const unlimitedMeta = metaOk(ctx, a.unlimitedMeta);
      if (packMeta && (packMeta === bonusMeta || packMeta === unlimitedMeta)) fail('SAME_META');
      const items = [...new Set(a.unlimitedItems.map(x => x.trim()).filter(Boolean))];
      for (const k of items) if (!ctx.db.item.key.find(k)) fail('ITEM_NOT_FOUND');
      const products = [...new Set(a.packProducts.map(x => x.trim()).filter(Boolean))];
      for (const k of products) if (!ctx.db.product.key.find(k)) fail('PRODUCT_NOT_FOUND');
      ctx.db.quotaSettings.id.update({ id: 0, ...a, packMeta, bonusMeta, unlimitedMeta, unlimitedItems: items, packProducts: products, message: cleanTranslations(a.message, base(ctx), false), updatedAt: ctx.timestamp });
      audit(base(ctx), me.id, 'quota_settings.save', 'settings', JSON.stringify({ enabled: a.enabled, countMode: a.countMode, dailyMessages: a.dailyMessages }));
    }
  );

  const adminQuotaRules = st.view({ name: 'admin_quota_rules', public: true }, t.array(socialRows.quotaRule), ctx => (adminOrNull(ctx as any) ? [...ctx.db.quotaRule.iter()] : []));

  const adminSaveQuotaRule = st.reducer(
    {
      id: t.u64(),
      name: t.string(),
      tagIds: t.array(t.u64()),
      priority: t.i32(),
      unlimited: t.bool(),
      dailyMessages: t.option(t.u32()),
      dailyConversations: t.option(t.u32()),
      friendDailyMessages: t.option(t.u32()),
      friendDailyConversations: t.option(t.u32()),
      isActive: t.bool(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const name = cleanName(a.name);
      const tagIds = tagsOk(ctx, a.tagIds);
      checkPriority(a.priority);
      const vals = [a.dailyMessages, a.dailyConversations, a.friendDailyMessages, a.friendDailyConversations];
      if (!a.unlimited && vals.every(v => v === undefined)) fail('LIMIT_REQUIRED');
      if (vals.some(v => (v ?? 0) > 100000)) fail('INVALID_RULE');
      const old = a.id ? ctx.db.quotaRule.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const row = { ...a, dailyMessages: a.dailyMessages, dailyConversations: a.dailyConversations, friendDailyMessages: a.friendDailyMessages, friendDailyConversations: a.friendDailyConversations, name, tagIds, createdAt: old?.createdAt ?? ctx.timestamp, updatedAt: ctx.timestamp };
      const saved = old ? ctx.db.quotaRule.id.update(row) : ctx.db.quotaRule.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'quota_rule.update' : 'quota_rule.create', String(saved.id), name);
    }
  );

  const adminDeleteQuotaRule = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.quotaRule.id.delete(a.id)) fail('NOT_FOUND');
    audit(base(ctx), me.id, 'quota_rule.delete', String(a.id));
  });

  const adminPlayerQuota = st.procedure({ accountId: t.u64() }, AdminQuota, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      const status = quotaStatus(tx, a.accountId);
      const lots = [...tx.db.quotaLot.accountId.filter(a.accountId)].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 20);
      const days = [...tx.db.quotaDay.accountId.filter(a.accountId)].sort((x, y) => y.day - x.day).slice(0, 14);
      return { status, lots, days };
    })
  );

  const adminQuotaGrant = st.reducer({ accountId: t.u64(), amount: t.u32(), expiresInDays: t.i32(), note: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
    if (a.amount < 1 || a.amount > 100000) fail('INVALID_AMOUNT');
    if (a.expiresInDays > 3650) fail('INVALID_SETTING:expiresInDays');
    const days = a.expiresInDays < 0 ? quotaSettings(ctx).packExpiryDays : a.expiresInDays;
    const row = ctx.db.quotaLot.insert({ id: 0n, accountId: a.accountId, amount: a.amount, remaining: a.amount, source: 'admin', note: a.note.trim().slice(0, 200), expiresAt: days ? nowUs(ctx) + BigInt(days) * DAY_US : 0n, createdBy: me.id, createdAt: ctx.timestamp });
    audit(base(ctx), me.id, 'quota.grant', String(a.accountId), `lot=${row.id} amount=${a.amount} days=${days}`);
  });

  const adminQuotaReset = st.reducer({ accountId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = quotaSettings(ctx);
    const day = quotaDayOf(s, nowUs(ctx));
    const row = ctx.db.quotaDay.key.find(`${a.accountId}|${day}`);
    if (row) ctx.db.quotaDay.key.update({ ...row, messages: 0, conversations: 0, friendMessages: 0, friendConversations: 0 });
    audit(base(ctx), me.id, 'quota.reset', String(a.accountId), String(day));
  });

  const adminQuotaRevokeLot = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const lot = ctx.db.quotaLot.id.find(a.id);
    if (!lot) fail('NOT_FOUND');
    ctx.db.quotaLot.id.update({ ...lot, remaining: 0 });
    audit(base(ctx), me.id, 'quota.revoke', String(lot.accountId), `lot=${lot.id} left=${lot.remaining}`);
  });

  const adminQuotaReport = st.procedure({ days: t.u32() }, QuotaReport, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const s = quotaSettings(tx);
      const today = quotaDayOf(s, nowUs(tx));
      const from = today - Math.min(Math.max(a.days || 30, 1), 400) + 1;
      const daily = new Map<number, { day: number; sent: number; blocked: number; fromPacks: number }>();
      const blockedBy = new Map<bigint, number>();
      const tot = { sent: 0, blocked: 0, fromPacks: 0, free: 0, unlimited: 0 };
      for (const r of tx.db.quotaDay.iter()) {
        if (r.day < from || r.day > today) continue;
        const d = daily.get(r.day) ?? { day: r.day, sent: 0, blocked: 0, fromPacks: 0 };
        d.sent += r.total;
        d.blocked += r.blocked;
        d.fromPacks += r.packUsed;
        daily.set(r.day, d);
        tot.sent += r.total;
        tot.blocked += r.blocked;
        tot.fromPacks += r.packUsed;
        tot.free += r.freeSent;
        tot.unlimited += r.unlimitedSent;
        if (r.blocked) blockedBy.set(r.accountId, (blockedBy.get(r.accountId) ?? 0) + r.blocked);
      }
      let packsFromMeta = 0;
      let packsFromAdmin = 0;
      for (const l of tx.db.quotaLot.iter()) {
        if (l.source === 'admin') packsFromAdmin += l.amount;
        else packsFromMeta += l.amount;
      }
      return {
        ...tot,
        blockedPlayers: blockedBy.size,
        daily: [...daily.values()].sort((x, y) => x.day - y.day),
        top: [...blockedBy.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([accountId, blocked]) => ({ accountId, displayName: nameOf(tx, accountId), blocked })),
        packsFromMeta,
        packsFromAdmin,
      };
    })
  );

  return {
    chatQuota,
    adminQuotaSettings,
    adminSaveQuotaSettings,
    adminQuotaRules,
    adminSaveQuotaRule,
    adminDeleteQuotaRule,
    adminPlayerQuota,
    adminQuotaGrant,
    adminQuotaReset,
    adminQuotaRevokeLot,
    adminQuotaReport
  };
}
