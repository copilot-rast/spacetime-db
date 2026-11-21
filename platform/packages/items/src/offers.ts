import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, cleanKey, cleanTranslations, fail, loginHooks, requireAccount, requireRole, type Tr } from '@stg/base';
import { GATEWAYS, STORES, StartResult, activeMethods, discounted, metaValue, paymentHooks, purchaseChecks, purchaseCreatedHooks, startPurchase, type EProc } from '@stg/economy';
import { MetaCondition, Price, TagCount, itemsRows, type ItemsSchema } from './schema';
import {
  DAY_US,
  TEHRAN_US,
  base,
  compare,
  contentsOwned,
  econ,
  hasAnyTag,
  hmacUnit,
  levelOf,
  nowUs,
  pay,
  productBlock,
  record,
  type IDb,
  type ITx,
  type OfferRow,
  type ProductRow,
  type UserOfferRow,
} from './engine';

const KINDS = ['daily', 'entry'];
const TRIGGERS = ['first_entry', 'level', 'meta', 'tag', 'account_days', 'lapsed'];
const WEIGHTINGS = ['weighted', 'uniform', 'priority'];
const OPERATORS = ['gt', 'gte', 'lt', 'lte', 'eq'];

const OfferItem = t.object('OfferItem', {
  userOfferId: t.u64(),
  offerId: t.u64(),
  key: t.string(),
  kind: t.string(),
  name: Translations,
  description: Translations,
  badge: Translations,
  productId: t.u64(),
  productKey: t.string(),
  iconUrl: t.string(),
  coverUrl: t.string(),
  originalToman: t.i64(),
  finalToman: t.i64(),
  coinCurrency: t.string(),
  coinAmount: t.i64(),
  coinOriginal: t.i64(),
  discountPercent: t.u8(),
  paymentMethods: t.array(t.string()),
  purchaseLimit: t.u32(),
  bought: t.u32(),
  remaining: t.u32(),
  soldOut: t.bool(),
  started: t.bool(),
  expiresAt: t.u64(),
  secondsLeft: t.u64(),
  shownAt: t.u64(),
  slot: t.u8(),
  durationMinutes: t.u32(),
});
const RerollInfo = t.object('OfferRerollInfo', { enabled: t.bool(), used: t.u32(), limit: t.u32(), left: t.u32(), currencyKey: t.string(), nextCost: t.i64() });
const DailyBlock = t.object('OfferDaily', { enabled: t.bool(), period: t.i64(), periodStart: t.u64(), periodEnd: t.u64(), secondsLeft: t.u64(), items: t.array(OfferItem), reroll: RerollInfo });
const EntryBlock = t.object('OfferEntry', { enabled: t.bool(), timerStart: t.string(), items: t.array(OfferItem) });
const OffersAnswer = t.object('OffersAnswer', { now: t.u64(), daily: DailyBlock, entry: EntryBlock, paid: t.option(Price) });
const SeenResult = t.object('OfferSeenResult', { userOfferId: t.u64(), expiresAt: t.u64(), secondsLeft: t.u64() });
const PlayerOffers = t.object('PlayerOffers', { copies: t.array(itemsRows.userOffer), period: t.i64() });

type Settings = NonNullable<ReturnType<ITx['db']['offerSettings']['id']['find']>>;

function offerSettings(ctx: IDb) {
  const s = ctx.db.offerSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

function periodOf(s: Settings, now: bigint) {
  const len = BigInt(Math.max(s.periodDays, 1)) * DAY_US;
  const shift = BigInt(s.resetMinute) * 60_000_000n;
  const period = (now + TEHRAN_US - shift) / len;
  const start = period * len - TEHRAN_US + shift;
  return { period, start, end: start + len };
}

function frozen(product: ProductRow, o: OfferRow) {
  const ownFinal = discounted(product.priceToman, product.discountPercent);
  if (o.priceMode === 'discount') {
    if (!o.discountPercent) return { originalToman: product.priceToman, finalToman: ownFinal, coinOriginal: product.coinAmount, coinAmount: product.coinAmount, discountPercent: product.discountPercent };
    return { originalToman: product.priceToman, finalToman: discounted(product.priceToman, o.discountPercent), coinOriginal: product.coinAmount, coinAmount: discounted(product.coinAmount, o.discountPercent), discountPercent: o.discountPercent };
  }
  const finalToman = o.priceToman >= 0n ? o.priceToman : ownFinal;
  const coinAmount = o.coinAmount >= 0n ? o.coinAmount : product.coinAmount;
  const pct = product.priceToman > 0n && finalToman < product.priceToman ? Number(((product.priceToman - finalToman) * 100n) / product.priceToman) : 0;
  return { originalToman: product.priceToman, finalToman, coinOriginal: product.coinAmount, coinAmount, discountPercent: pct };
}

function offerMethods(product: ProductRow, price: { finalToman: bigint; coinAmount: bigint }) {
  const own = discounted(product.priceToman, product.discountPercent);
  return product.paymentMethods.filter(m => {
    if (m === 'in_app') return !!product.coinCurrency && price.coinAmount > 0n;
    if (GATEWAYS.includes(m)) return price.finalToman === 0n || price.finalToman >= 100n;
    if (STORES.includes(m)) return price.finalToman === own;
    return false;
  });
}

function playerCount(ctx: IDb, accountId: bigint, s: Settings) {
  let n = s.count;
  for (const c of s.countByTag) if (hasAnyTag(ctx, accountId, [c.tagId]) && c.count > n) n = c.count;
  return n;
}

function eligible(ctx: ITx, accountId: bigint, o: OfferRow, now: bigint, s: Settings) {
  if (!o.isActive) return 'inactive';
  if ((o.startsAt && now < o.startsAt) || (o.endsAt && now >= o.endsAt)) return 'inactive';
  if (o.audienceTagIds.length && !hasAnyTag(ctx, accountId, o.audienceTagIds)) return 'audience';
  if (hasAnyTag(ctx, accountId, o.excludeTagIds)) return 'excluded_tag';
  if (o.minLevel || o.maxLevel) {
    const lvl = levelOf(ctx, accountId, o.levelTableId);
    if (o.minLevel && lvl < o.minLevel) return 'level_low';
    if (o.maxLevel && lvl > o.maxLevel) return 'level_high';
  }
  for (const c of o.metaConditions) {
    if (!ctx.db.meta.key.find(c.metaKey)) return 'meta';
    if (!compare(c.operator, metaValue(econ(ctx), accountId, c.metaKey), c.value)) return 'meta';
  }
  if (o.minAccountDays || o.maxAccountDays) {
    const acc = ctx.db.account.id.find(accountId);
    const days = acc ? Number((now - acc.createdAt.microsSinceUnixEpoch) / DAY_US) : 0;
    if (o.minAccountDays && days < o.minAccountDays) return 'account_new';
    if (o.maxAccountDays && days > o.maxAccountDays) return 'account_old';
  }
  const product = ctx.db.product.id.find(o.productId);
  if (!product) return 'product_inactive';
  if (!product.isActive && s.inactiveProducts === 'skip') return 'product_inactive';
  if (s.excludeOwned && contentsOwned(ctx, accountId, product.prizeId)) return 'owned';
  if (s.respectProductRules) {
    const b = productBlock(ctx, accountId, product, true);
    if (b) return b.toLowerCase();
  }
  const active = activeMethods(ctx as any);
  if (!offerMethods(product, frozen(product, o)).some(m => active.has(m))) return 'no_method';
  return '';
}

function copiesOf(ctx: IDb, accountId: bigint, offerId?: bigint) {
  return offerId === undefined ? [...ctx.db.userOffer.byAccountOffer.filter(accountId)] : [...ctx.db.userOffer.byAccountOffer.filter([accountId, offerId])];
}

function soldOut(uo: UserOfferRow) {
  return uo.purchaseLimit > 0 && uo.bought >= uo.purchaseLimit;
}

function order(ctx: ITx, list: OfferRow[], accountId: bigint, period: bigint, reroll: number, weighting: string) {
  const u = new Map(list.map(o => [o.id, hmacUnit(ctx, `offer-draw|${accountId}|${period}|${reroll}|${o.id}`)]));
  const key = (o: OfferRow) => (weighting === 'uniform' ? u.get(o.id)! : -Math.log(u.get(o.id)!) / o.weight);
  if (weighting === 'priority') return [...list].sort((a, b) => b.weight - a.weight || u.get(a.id)! - u.get(b.id)!);
  return [...list].sort((a, b) => key(a) - key(b));
}

function draw(ctx: ITx, accountId: bigint, s: Settings, now: bigint, p: { period: bigint; start: bigint }, reroll: number, exclude: Set<bigint>, n: number) {
  if (n <= 0) return [] as OfferRow[];
  const fresh: OfferRow[] = [];
  const recent: OfferRow[] = [];
  for (const o of ctx.db.offer.kind.filter('daily')) {
    if (!o.weight || exclude.has(o.id)) continue;
    if (eligible(ctx, accountId, o, now, s)) continue;
    const copies = copiesOf(ctx, accountId, o.id);
    const lastBought = copies.reduce((m, c) => (c.lastBoughtAt > m ? c.lastBoughtAt : m), 0n);
    if (lastBought && (s.boughtCooldownDays < 0 || (s.boughtCooldownDays > 0 && now - lastBought < BigInt(s.boughtCooldownDays) * DAY_US))) continue;
    const isRecent = s.noRepeatDays > 0 && copies.some(c => c.kind === 'daily' && c.period < p.period && c.madeAt >= p.start - BigInt(s.noRepeatDays) * DAY_US);
    (isRecent ? recent : fresh).push(o);
  }
  const picks = order(ctx, fresh, accountId, p.period, reroll, s.weighting).slice(0, n);
  if (picks.length < n && s.fillWithRepeats) picks.push(...order(ctx, recent, accountId, p.period, reroll, s.weighting).slice(0, n - picks.length));
  return picks;
}

function makeCopy(ctx: ITx, accountId: bigint, o: OfferRow, period: bigint, slot: number, reroll: number, now: bigint, expiresAt: bigint) {
  const product = ctx.db.product.id.find(o.productId)!;
  const f = frozen(product, o);
  return ctx.db.userOffer.insert({
    id: 0n,
    accountId,
    offerId: o.id,
    kind: o.kind,
    period,
    slot,
    status: 'active',
    originalToman: f.originalToman,
    finalToman: f.finalToman,
    coinCurrency: product.coinCurrency,
    coinAmount: f.coinAmount,
    coinOriginal: f.coinOriginal,
    discountPercent: f.discountPercent,
    purchaseLimit: o.purchaseLimit,
    bought: 0,
    reroll,
    forgotten: false,
    madeAt: now,
    shownAt: 0n,
    startedAt: o.kind === 'daily' ? now : 0n,
    expiresAt,
    endedAt: 0n,
    lastBoughtAt: 0n,
  });
}

function periodRow(ctx: ITx, accountId: bigint, period: bigint) {
  const key = `${accountId}|${period}`;
  return ctx.db.offerPeriod.key.find(key) ?? ctx.db.offerPeriod.insert({ key, accountId, period, rerolls: 0, drawn: false });
}

function dailyCopies(ctx: ITx, accountId: bigint, period: bigint) {
  return copiesOf(ctx, accountId).filter(c => c.kind === 'daily' && c.period === period && c.status === 'active');
}

function ensureDaily(ctx: ITx, accountId: bigint, s: Settings, now: bigint) {
  const p = periodOf(s, now);
  const row = periodRow(ctx, accountId, p.period);
  if (!row.drawn) {
    const picks = draw(ctx, accountId, s, now, p, 0, new Set(), playerCount(ctx, accountId, s));
    picks.forEach((o, i) => makeCopy(ctx, accountId, o, p.period, i, 0, now, p.end));
    ctx.db.offerPeriod.key.update({ ...row, drawn: true });
  }
  return p;
}

function entryHolds(ctx: ITx, accountId: bigint, o: OfferRow, now: bigint) {
  if (o.triggerType === 'first_entry') return true;
  if (o.triggerType === 'level') return levelOf(ctx, accountId, o.triggerRefId) >= o.triggerValue;
  if (o.triggerType === 'meta') return !!ctx.db.meta.key.find(o.triggerMetaKey) && metaValue(econ(ctx), accountId, o.triggerMetaKey) >= o.triggerValue;
  if (o.triggerType === 'tag') return hasAnyTag(ctx, accountId, [o.triggerRefId]);
  if (o.triggerType === 'account_days') {
    const acc = ctx.db.account.id.find(accountId);
    return !!acc && Number(now - acc.createdAt.microsSinceUnixEpoch) / Number(DAY_US) >= o.triggerValue;
  }
  if (o.triggerType === 'lapsed') {
    const st = ctx.db.offerState.accountId.find(accountId);
    return !!st && st.prevLoginAt > 0n && Number(st.lastLoginAt - st.prevLoginAt) / Number(DAY_US) >= o.triggerValue;
  }
  return false;
}

function startTimer(ctx: ITx, uo: UserOfferRow, now: bigint) {
  if (uo.kind !== 'entry' || uo.startedAt) return uo;
  const o = ctx.db.offer.id.find(uo.offerId);
  const dur = BigInt(o?.durationMinutes ?? 1440) * 60_000_000n;
  return ctx.db.userOffer.id.update({ ...uo, startedAt: now, expiresAt: now + dur });
}

function closeEnded(ctx: ITx, accountId: bigint, now: bigint) {
  for (const c of copiesOf(ctx, accountId)) {
    if (c.status !== 'active') continue;
    if (c.kind === 'entry' && c.startedAt && now >= c.expiresAt) ctx.db.userOffer.id.update({ ...c, status: 'expired', endedAt: c.endedAt || c.expiresAt });
  }
}

function ensureEntry(ctx: ITx, accountId: bigint, s: Settings, now: bigint) {
  closeEnded(ctx, accountId, now);
  const live = (c: UserOfferRow) => c.kind === 'entry' && c.status === 'active' && !c.forgotten;
  let open = copiesOf(ctx, accountId).filter(c => live(c) && !soldOut(c) && ctx.db.offer.id.find(c.offerId)?.isActive).length;
  const templates = [...ctx.db.offer.kind.filter('entry')].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const st = ctx.db.offerState.accountId.find(accountId);
  for (const o of templates) {
    if (open >= s.entryMaxActive) break;
    const history = copiesOf(ctx, accountId, o.id).filter(c => !c.forgotten).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (history.some(c => c.status === 'active')) continue;
    if (o.maxTriggers && history.length >= o.maxTriggers) continue;
    const last = history[history.length - 1];
    if (last) {
      if (o.repeat !== 'cooldown') continue;
      const ended = last.endedAt || last.expiresAt;
      if (!ended || now - ended < BigInt(o.cooldownHours) * 3_600_000_000n) continue;
      if (o.triggerType === 'lapsed' && (!st || st.lastLoginAt <= last.madeAt)) continue;
    }
    if (eligible(ctx, accountId, o, now, s)) continue;
    if (!entryHolds(ctx, accountId, o, now)) continue;
    makeCopy(ctx, accountId, o, -1n, 0, 0, now, 0n);
    open++;
  }
}

function view(ctx: ITx, uo: UserOfferRow, now: bigint) {
  const o = ctx.db.offer.id.find(uo.offerId)!;
  const product = ctx.db.product.id.find(o.productId)!;
  const active = activeMethods(ctx as any);
  const left = uo.expiresAt > now ? (uo.expiresAt - now) / 1_000_000n : 0n;
  return {
    userOfferId: uo.id,
    offerId: o.id,
    key: o.key,
    kind: uo.kind,
    name: o.name.length ? o.name : product.name,
    description: o.description.length ? o.description : product.description,
    badge: o.badge,
    productId: product.id,
    productKey: product.key,
    iconUrl: product.iconUrl,
    coverUrl: product.coverUrl,
    originalToman: uo.originalToman,
    finalToman: uo.finalToman,
    coinCurrency: uo.coinCurrency,
    coinAmount: uo.coinAmount,
    coinOriginal: uo.coinOriginal,
    discountPercent: uo.discountPercent,
    paymentMethods: offerMethods(product, uo).filter(m => active.has(m)),
    purchaseLimit: uo.purchaseLimit,
    bought: uo.bought,
    remaining: uo.purchaseLimit ? Math.max(uo.purchaseLimit - uo.bought, 0) : 0,
    soldOut: soldOut(uo),
    started: uo.startedAt > 0n,
    expiresAt: uo.expiresAt,
    secondsLeft: left,
    shownAt: uo.shownAt,
    slot: uo.slot,
    durationMinutes: o.durationMinutes,
  };
}

function rerollCost(s: Settings, used: number) {
  if (!s.rerollCurrency || s.rerollCost <= 0n || used < s.rerollFree) return 0n;
  return s.rerollCost + s.rerollCostStep * BigInt(used - s.rerollFree);
}

function answer(ctx: ITx, accountId: bigint, paid?: { currencyKey: string; amount: bigint }) {
  const s = offerSettings(ctx);
  const now = nowUs(ctx);
  const live = (c: UserOfferRow) => {
    const o = ctx.db.offer.id.find(c.offerId);
    return !!o && o.isActive && !!ctx.db.product.id.find(o.productId) && (s.showSoldOut || !soldOut(c));
  };
  let daily: ReturnType<typeof view>[] = [];
  const p = periodOf(s, now);
  let used = 0;
  if (s.dailyEnabled) {
    ensureDaily(ctx, accountId, s, now);
    used = periodRow(ctx, accountId, p.period).rerolls;
    daily = dailyCopies(ctx, accountId, p.period)
      .filter(live)
      .sort((a, b) => a.slot - b.slot)
      .map(c => view(ctx, c, now));
  }
  let entry: ReturnType<typeof view>[] = [];
  if (s.entryEnabled) {
    ensureEntry(ctx, accountId, s, now);
    entry = copiesOf(ctx, accountId)
      .filter(c => c.kind === 'entry' && c.status === 'active' && !c.forgotten && live(c))
      .map(c => (s.entryTimerStart === 'list' ? startTimer(ctx, c, now) : c))
      .sort((a, b) => (ctx.db.offer.id.find(a.offerId)?.sort ?? 0) - (ctx.db.offer.id.find(b.offerId)?.sort ?? 0) || (a.id < b.id ? -1 : 1))
      .map(c => view(ctx, c, now));
  }
  return {
    now,
    daily: {
      enabled: s.dailyEnabled,
      period: p.period,
      periodStart: p.start,
      periodEnd: p.end,
      secondsLeft: (p.end - now) / 1_000_000n,
      items: daily,
      reroll: {
        enabled: s.dailyEnabled && s.rerollEnabled,
        used,
        limit: s.rerollLimit,
        left: s.rerollLimit ? Math.max(s.rerollLimit - used, 0) : 0,
        currencyKey: s.rerollCurrency,
        nextCost: rerollCost(s, used),
      },
    },
    entry: { enabled: s.entryEnabled, timerStart: s.entryTimerStart, items: entry },
    paid,
  };
}

function offerPayments(ctx: IDb, userOfferId: bigint) {
  return [...ctx.db.offerPayment.userOfferId.filter(userOfferId)].map(op => ctx.db.payment.id.find(op.paymentId)).filter(p => !!p && p.status === 'success').length;
}

function checkTags(ctx: ITx, tags: bigint[]) {
  if (tags.length > 20) fail('TOO_MANY_TAGS');
  for (const id of tags) {
    const tag = ctx.db.tag.id.find(id);
    if (!tag) fail('TAG_NOT_FOUND');
    if (tag.keyType !== 'user') fail('TAG_KIND_MISMATCH');
  }
  return [...new Set(tags)];
}

export function defineOffers(st: ItemsSchema) {
  loginHooks.push((raw, accountId) => {
    const ctx = raw as unknown as ITx;
    const now = nowUs(ctx);
    const old = ctx.db.offerState.accountId.find(accountId);
    if (old) ctx.db.offerState.accountId.update({ accountId, prevLoginAt: old.lastLoginAt, lastLoginAt: now });
    else ctx.db.offerState.insert({ accountId, prevLoginAt: 0n, lastLoginAt: now });
  });

  purchaseChecks.push((raw, req, quote) => {
    if (!req.context.startsWith('offer:')) return quote;
    const ctx = raw as unknown as ITx;
    const s = offerSettings(ctx);
    const now = nowUs(ctx);
    let uo = ctx.db.userOffer.id.find(BigInt(req.context.slice(6)));
    if (!uo || uo.accountId !== req.accountId || uo.forgotten) fail('OFFER_NOT_FOUND');
    const o = ctx.db.offer.id.find(uo.offerId);
    if (!o || !o.isActive) fail('OFFER_NOT_FOUND');
    if (o.productId !== req.product.id) fail('OFFER_PRODUCT_MISMATCH');
    if (uo.status === 'expired') fail('OFFER_EXPIRED');
    if (uo.status !== 'active') fail('OFFER_NOT_FOUND');
    if (uo.kind === 'daily' && (!s.dailyEnabled || uo.period !== periodOf(s, now).period)) fail('OFFER_EXPIRED');
    if (uo.kind === 'entry') {
      if (!s.entryEnabled) fail('OFFER_EXPIRED');
      uo = startTimer(ctx, uo, now);
      if (now >= uo.expiresAt) fail('OFFER_EXPIRED');
    }
    if (o.audienceTagIds.length && !hasAnyTag(ctx, req.accountId, o.audienceTagIds)) fail('OFFER_NOT_FOUND');
    if (hasAnyTag(ctx, req.accountId, o.excludeTagIds)) fail('OFFER_NOT_FOUND');
    if (!req.product.isActive && s.inactiveProducts === 'skip') fail('PRODUCT_NOT_FOUND');
    if (uo.purchaseLimit && offerPayments(ctx, uo.id) >= uo.purchaseLimit) fail('OFFER_SOLD_OUT');
    return {
      available: true,
      originalToman: uo.originalToman,
      priceToman: uo.finalToman,
      discountPercent: uo.discountPercent,
      coinCurrency: uo.coinCurrency,
      coinAmount: uo.coinAmount,
      methods: offerMethods(req.product, uo),
      giftAllowed: s.giftCodes,
    };
  });

  purchaseCreatedHooks.push((raw, paymentId, req) => {
    if (!req.context.startsWith('offer:')) return;
    const ctx = raw as unknown as ITx;
    const uo = ctx.db.userOffer.id.find(BigInt(req.context.slice(6)))!;
    ctx.db.offerPayment.insert({ paymentId, userOfferId: uo.id, offerId: uo.offerId, accountId: req.accountId, createdAt: ctx.timestamp });
  });

  paymentHooks.push((raw, accountId, paymentId) => {
    const ctx = raw as unknown as ITx;
    const op = ctx.db.offerPayment.paymentId.find(paymentId);
    if (!op) return;
    const uo = ctx.db.userOffer.id.find(op.userOfferId);
    const p = ctx.db.payment.id.find(paymentId);
    if (!uo || !p) return;
    const now = nowUs(ctx);
    const next = { ...uo, bought: uo.bought + 1, lastBoughtAt: now };
    ctx.db.userOffer.id.update({ ...next, endedAt: soldOut(next) && !uo.endedAt ? now : uo.endedAt });
    const o = ctx.db.offer.id.find(uo.offerId);
    const value = p.method === 'in_app' ? Number(p.coinAmount) : Number(p.finalToman);
    record(ctx, accountId, 'offer_bought', value, { key: o?.key ?? '', kind: uo.kind, offerId: String(uo.offerId), userOfferId: String(uo.id), paymentId: String(paymentId) });
  });

  const adminOffers = st.view({ name: 'admin_offers', public: true }, t.array(itemsRows.offer), ctx => (adminOrNull(ctx as any) ? [...ctx.db.offer.iter()] : []));

  const adminOfferSettings = st.view({ name: 'admin_offer_settings', public: true }, t.option(itemsRows.offerSettings), ctx => (adminOrNull(ctx as any) ? ctx.db.offerSettings.id.find(0) ?? undefined : undefined));

  const adminSaveOfferSettings = st.reducer(
    {
      dailyEnabled: t.bool(),
      periodDays: t.u8(),
      resetMinute: t.u16(),
      count: t.u8(),
      countByTag: t.array(TagCount),
      weighting: t.string(),
      noRepeatDays: t.u16(),
      fillWithRepeats: t.bool(),
      boughtCooldownDays: t.i32(),
      excludeOwned: t.bool(),
      respectProductRules: t.bool(),
      inactiveProducts: t.string(),
      showSoldOut: t.bool(),
      giftCodes: t.bool(),
      rerollEnabled: t.bool(),
      rerollLimit: t.u8(),
      rerollFree: t.u8(),
      rerollCurrency: t.string(),
      rerollCost: t.i64(),
      rerollCostStep: t.i64(),
      rerollAvoidCurrent: t.bool(),
      entryEnabled: t.bool(),
      entryMaxActive: t.u8(),
      entryTimerStart: t.string(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const s = offerSettings(ctx);
      if (a.periodDays < 1 || a.periodDays > 30) fail('INVALID_SETTING:periodDays');
      if (a.resetMinute >= 1440) fail('INVALID_SETTING:resetMinute');
      if (a.count < 1 || a.count > 20) fail('INVALID_SETTING:count');
      if (!WEIGHTINGS.includes(a.weighting)) fail('INVALID_POLICY');
      if (a.noRepeatDays > 365) fail('INVALID_SETTING:noRepeatDays');
      if (a.boughtCooldownDays < -1 || a.boughtCooldownDays > 3650) fail('INVALID_SETTING:boughtCooldownDays');
      if (a.inactiveProducts !== 'allow' && a.inactiveProducts !== 'skip') fail('INVALID_POLICY');
      if (a.rerollCost < 0n || a.rerollCostStep < 0n) fail('INVALID_SETTING:rerollCost');
      if (a.rerollCost > 0n && !ctx.db.currency.key.find(a.rerollCurrency)) fail('CURRENCY_NOT_FOUND');
      if (a.entryMaxActive < 1 || a.entryMaxActive > 10) fail('INVALID_SETTING:entryMaxActive');
      if (a.entryTimerStart !== 'list' && a.entryTimerStart !== 'seen') fail('INVALID_POLICY');
      if (a.countByTag.length > 20) fail('TOO_MANY_TAGS');
      const tags = new Set<bigint>();
      for (const c of a.countByTag) {
        if (tags.has(c.tagId)) fail('DUPLICATE_TAG');
        tags.add(c.tagId);
        if (c.count < 1 || c.count > 20) fail('INVALID_SETTING:countByTag');
      }
      checkTags(ctx, [...tags]);
      ctx.db.offerSettings.id.update({ ...s, ...a, rerollCurrency: a.rerollCost > 0n ? a.rerollCurrency : '', updatedAt: ctx.timestamp });
      audit(base(ctx), me.id, 'offer_settings.save', 'settings', JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
    }
  );

  const adminSaveOffer = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      kind: t.string(),
      name: Translations,
      description: Translations,
      badge: Translations,
      productId: t.u64(),
      priceMode: t.string(),
      discountPercent: t.u8(),
      priceToman: t.i64(),
      coinAmount: t.i64(),
      purchaseLimit: t.u32(),
      weight: t.u32(),
      audienceTagIds: t.array(t.u64()),
      excludeTagIds: t.array(t.u64()),
      levelTableId: t.u64(),
      minLevel: t.u32(),
      maxLevel: t.u32(),
      metaConditions: t.array(MetaCondition),
      minAccountDays: t.u32(),
      maxAccountDays: t.u32(),
      triggerType: t.string(),
      triggerValue: t.f64(),
      triggerRefId: t.u64(),
      triggerMetaKey: t.string(),
      durationMinutes: t.u32(),
      repeat: t.string(),
      cooldownHours: t.u32(),
      maxTriggers: t.u32(),
      startsAt: t.u64(),
      endsAt: t.u64(),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.offer.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      if (old && old.kind !== a.kind) fail('KIND_LOCKED');
      const same = ctx.db.offer.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (!KINDS.includes(a.kind)) fail('INVALID_KIND');
      if (!ctx.db.product.id.find(a.productId)) fail('PRODUCT_NOT_FOUND');
      if (a.priceMode === 'discount') {
        if (a.discountPercent > 100) fail('INVALID_DISCOUNT');
      } else if (a.priceMode === 'price') {
        if (a.priceToman < -1n || (a.priceToman > 0n && a.priceToman < 100n)) fail('INVALID_PRICE');
        if (a.coinAmount < -1n) fail('INVALID_PRICE');
        if (a.priceToman < 0n && a.coinAmount < 0n) fail('PRICE_REQUIRED');
      } else fail('INVALID_PRICE_MODE');
      if (a.purchaseLimit > 1000) fail('INVALID_LIMIT');
      if (a.weight > 1_000_000) fail('INVALID_WEIGHT');
      if (a.maxLevel && a.minLevel > a.maxLevel) fail('INVALID_LEVEL');
      if (a.levelTableId && !ctx.db.levelTable.id.find(a.levelTableId)) fail('LEVEL_TABLE_NOT_FOUND');
      if (a.metaConditions.length > 10) fail('TOO_MANY_CONDITIONS');
      for (const c of a.metaConditions) {
        if (!ctx.db.meta.key.find(c.metaKey)) fail('META_NOT_FOUND');
        if (!OPERATORS.includes(c.operator)) fail('INVALID_OPERATOR');
        if (!Number.isFinite(c.value)) fail('INVALID_VALUE');
      }
      if (a.maxAccountDays && a.minAccountDays > a.maxAccountDays) fail('INVALID_DAYS');
      if (a.startsAt && a.endsAt && a.endsAt <= a.startsAt) fail('INVALID_WINDOW');
      const entry = a.kind === 'entry';
      if (entry) {
        if (!TRIGGERS.includes(a.triggerType)) fail('INVALID_TRIGGER');
        if (!Number.isFinite(a.triggerValue) || a.triggerValue < 0) fail('INVALID_TRIGGER');
        if (a.triggerType === 'level' && a.triggerRefId && !ctx.db.levelTable.id.find(a.triggerRefId)) fail('LEVEL_TABLE_NOT_FOUND');
        if (a.triggerType === 'meta' && !ctx.db.meta.key.find(a.triggerMetaKey)) fail('META_NOT_FOUND');
        if (a.triggerType === 'tag') checkTags(ctx, [a.triggerRefId]);
        if (a.durationMinutes < 1 || a.durationMinutes > 60 * 24 * 90) fail('INVALID_DURATION');
        if (a.repeat !== 'once' && a.repeat !== 'cooldown') fail('INVALID_REPEAT');
        if (a.cooldownHours > 24 * 3650) fail('INVALID_COOLDOWN');
        if (a.maxTriggers > 1000) fail('INVALID_MAX_TRIGGERS');
      }
      const row = {
        id: a.id,
        key,
        kind: a.kind,
        name: cleanTranslations(a.name as Tr[], base(ctx), false),
        description: cleanTranslations(a.description as Tr[], base(ctx), false),
        badge: cleanTranslations(a.badge as Tr[], base(ctx), false),
        productId: a.productId,
        priceMode: a.priceMode,
        discountPercent: a.priceMode === 'discount' ? a.discountPercent : 0,
        priceToman: a.priceMode === 'price' ? a.priceToman : -1n,
        coinAmount: a.priceMode === 'price' ? a.coinAmount : -1n,
        purchaseLimit: a.purchaseLimit,
        weight: a.weight,
        audienceTagIds: checkTags(ctx, a.audienceTagIds),
        excludeTagIds: checkTags(ctx, a.excludeTagIds),
        levelTableId: a.levelTableId,
        minLevel: a.minLevel,
        maxLevel: a.maxLevel,
        metaConditions: a.metaConditions,
        minAccountDays: a.minAccountDays,
        maxAccountDays: a.maxAccountDays,
        triggerType: entry ? a.triggerType : '',
        triggerValue: entry ? a.triggerValue : 0,
        triggerRefId: entry && (a.triggerType === 'level' || a.triggerType === 'tag') ? a.triggerRefId : 0n,
        triggerMetaKey: entry && a.triggerType === 'meta' ? a.triggerMetaKey : '',
        durationMinutes: entry ? a.durationMinutes : 0,
        repeat: entry ? a.repeat : 'once',
        cooldownHours: entry ? a.cooldownHours : 0,
        maxTriggers: entry ? a.maxTriggers : 0,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        isActive: a.isActive,
        sort: a.sort,
        createdAt: old?.createdAt ?? ctx.timestamp,
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.offer.id.update(row) : ctx.db.offer.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'offer.update' : 'offer.create', String(saved.id), key);
    }
  );

  const adminDeleteOffer = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const o = ctx.db.offer.id.find(id);
    if (!o) fail('NOT_FOUND');
    if ([...ctx.db.offerPayment.offerId.filter(id)].length) fail('IN_USE');
    for (const c of [...ctx.db.userOffer.offerId.filter(id)]) ctx.db.userOffer.id.delete(c.id);
    ctx.db.offer.id.delete(id);
    audit(base(ctx), me.id, 'offer.delete', String(id), o.key);
  });

  const adminPlayerOffers = st.procedure({ accountId: t.u64() }, PlayerOffers, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      return { copies: copiesOf(tx, a.accountId).sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 200), period: periodOf(offerSettings(tx), nowUs(tx)).period };
    })
  );

  const adminResetDailyOffers = st.reducer({ accountId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
    const p = periodOf(offerSettings(ctx), nowUs(ctx));
    for (const c of dailyCopies(ctx, a.accountId, p.period)) ctx.db.userOffer.id.update({ ...c, status: 'closed', endedAt: nowUs(ctx) });
    const row = periodRow(ctx, a.accountId, p.period);
    ctx.db.offerPeriod.key.update({ ...row, drawn: false });
    audit(base(ctx), me.id, 'offer.reset_daily', String(a.accountId));
  });

  const adminResetEntryOffer = st.reducer({ accountId: t.u64(), offerId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const o = ctx.db.offer.id.find(a.offerId);
    if (!o || o.kind !== 'entry') fail('NOT_FOUND');
    for (const c of copiesOf(ctx, a.accountId, a.offerId)) ctx.db.userOffer.id.update({ ...c, forgotten: true, status: c.status === 'active' ? 'closed' : c.status });
    audit(base(ctx), me.id, 'offer.reset_entry', String(a.accountId), o.key);
  });

  const adminExpireOffer = st.reducer({ userOfferId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const c = ctx.db.userOffer.id.find(a.userOfferId);
    if (!c) fail('NOT_FOUND');
    if (c.status !== 'active') fail('NOT_ACTIVE');
    ctx.db.userOffer.id.update({ ...c, status: 'closed', endedAt: nowUs(ctx) });
    audit(base(ctx), me.id, 'offer.expire', String(c.accountId), String(c.id));
  });

  const myOffers = st.procedure(OffersAnswer, ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      return answer(tx, me.id);
    })
  );

  const offersReroll = st.procedure(OffersAnswer, ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const s = offerSettings(tx);
      if (!s.dailyEnabled || !s.rerollEnabled) fail('REROLL_DISABLED');
      const now = nowUs(tx);
      const p = ensureDaily(tx, me.id, s, now);
      const row = periodRow(tx, me.id, p.period);
      if (s.rerollLimit && row.rerolls >= s.rerollLimit) fail('REROLL_LIMIT');
      const current = dailyCopies(tx, me.id, p.period);
      const unbought = current.filter(c => c.bought === 0);
      if (!unbought.length) fail('NOTHING_TO_REROLL');
      const exclude = new Set(current.filter(c => c.bought > 0 || s.rerollAvoidCurrent).map(c => c.offerId));
      const picks = draw(tx, me.id, s, now, p, row.rerolls + 1, exclude, unbought.length);
      if (!picks.length) fail('NO_OFFERS_LEFT');
      const cost = rerollCost(s, row.rerolls);
      const paid = cost > 0n ? pay(tx, me.id, s.rerollCurrency, cost, 'offer_reroll', 'offer_reroll', `${me.id}|${p.period}|${row.rerolls + 1}`) : [];
      for (const c of unbought) tx.db.userOffer.id.update({ ...c, status: 'replaced', endedAt: now });
      const slots = unbought.map(c => c.slot).sort((x, y) => x - y);
      picks.forEach((o, i) => makeCopy(tx, me.id, o, p.period, slots[i], row.rerolls + 1, now, p.end));
      tx.db.offerPeriod.key.update({ ...row, rerolls: row.rerolls + 1 });
      return answer(tx, me.id, paid[0] ?? { currencyKey: '', amount: 0n });
    })
  );

  const offerSeen = st.procedure({ userOfferId: t.u64() }, SeenResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      let uo = tx.db.userOffer.id.find(a.userOfferId);
      if (!uo || uo.accountId !== me.id || uo.forgotten) fail('OFFER_NOT_FOUND');
      const now = nowUs(tx);
      if (uo.status !== 'active' || (uo.expiresAt && now >= uo.expiresAt)) fail('OFFER_EXPIRED');
      if (!uo.shownAt) uo = tx.db.userOffer.id.update({ ...uo, shownAt: now });
      uo = startTimer(tx, uo, now);
      return { userOfferId: uo.id, expiresAt: uo.expiresAt, secondsLeft: uo.expiresAt > now ? (uo.expiresAt - now) / 1_000_000n : 0n };
    })
  );

  const offerBuy = st.procedure({ userOfferId: t.u64(), method: t.string(), giftCode: t.string() }, StartResult, (ctx, a) => {
    const productId = ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const uo = tx.db.userOffer.id.find(a.userOfferId);
      if (!uo || uo.accountId !== me.id) fail('OFFER_NOT_FOUND');
      const o = tx.db.offer.id.find(uo.offerId);
      if (!o) fail('OFFER_NOT_FOUND');
      return o.productId;
    });
    return startPurchase(ctx as unknown as EProc, { productId, method: a.method, giftCode: a.giftCode }, `offer:${a.userOfferId}`);
  });

  return {
    adminOffers,
    adminOfferSettings,
    adminSaveOfferSettings,
    adminSaveOffer,
    adminDeleteOffer,
    adminPlayerOffers,
    adminResetDailyOffers,
    adminResetEntryOffer,
    adminExpireOffer,
    myOffers,
    offersReroll,
    offerSeen,
    offerBuy,
  };
}
