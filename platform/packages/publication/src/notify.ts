import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, cleanKey, fail, loginHooks, requireAccount, requireRole } from '@stg/base';
import { grantPrize, paymentHooks, prizeUseChecks, type Reward } from '@stg/economy';
import { eventHooks } from '@stg/gamification';
import { pubRows, publicationTables, type PublicationSchema } from './schema';
import { activeDevices, checkServiceAccount, deliver, fcmJwt, prefEnabled, runOutbox } from './deliver';
import {
  DAY_US,
  MIN_US,
  PLATFORMS,
  audienceBlock,
  base,
  checkQuiet,
  checkRate,
  checkTags,
  cleanAction,
  cleanChannels,
  cleanText,
  cleanUrl,
  econ,
  isPlayer,
  mask,
  nowUs,
  page,
  pubSettings,
  quietUntil,
  sessionAccountId,
  type CampaignRow,
  type PProc,
  type PTx,
  type RuleRow,
} from './engine';
import { newsTick, newsSweep } from './news';

export const TARGETS = ['all', 'players', 'tags'];
export const SCHEDULES = ['now', 'at', 'recurring'];
export const TRIGGERS = ['event', 'first_login', 'inactive', 'payment_success'];

const InboxEntry = t.row('InboxEntry', {
  id: t.u64().primaryKey(),
  kind: t.string(),
  categoryKey: t.string(),
  title: Translations,
  body: Translations,
  imageUrl: t.string(),
  actionType: t.string(),
  actionValue: t.string(),
  actionLabel: Translations,
  prizeId: t.u64(),
  claimed: t.bool(),
  read: t.bool(),
  newsId: t.u64(),
  at: t.u64(),
});
const PrefEntry = t.row('NotifyPrefRow', { key: t.string().primaryKey(), categoryKey: t.string(), channel: t.string(), enabled: t.bool() });
const DeviceEntry = t.row('PushDeviceEntry', { id: t.u64().primaryKey(), token: t.string(), platform: t.string(), appVersion: t.string(), isActive: t.bool(), lastSeenAt: t.u64() });
const PushConfigInfo = t.object('PushConfigInfo', { provider: t.string(), projectId: t.string(), clientEmail: t.string(), configured: t.bool(), keyHint: t.string() });
const ChannelPref = t.object('NotifyChannelPref', { channel: t.string(), enabled: t.bool() });
const PrefLine = t.object('NotifyPrefLine', { key: t.string(), name: Translations, description: Translations, mandatory: t.bool(), channels: t.array(ChannelPref) });
const PrefInput = t.object('NotifyPrefInput', { categoryKey: t.string(), channel: t.string(), enabled: t.bool() });
const RewardLine = t.object('InboxReward', { type: t.string(), key: t.string(), action: t.string(), value: t.f64(), prizeKey: t.string() });
const ClaimResult = t.object('InboxClaimResult', { inboxId: t.u64(), already: t.bool(), rewards: t.array(RewardLine) });
const RegisterResult = t.object('PushRegisterResult', { deviceId: t.u64(), platform: t.string(), active: t.bool(), deactivated: t.u32() });
const RunResult = t.object('PubRunResult', { batches: t.u32(), fires: t.u32(), outbox: t.u32() });
const DeliveryPage = t.object('PubDeliveryPage', { total: t.u32(), rows: t.array(pubRows.delivery) });
const FirePage = t.object('PubFirePage', { total: t.u32(), rows: t.array(pubRows.autoFire) });
const PushLogPage = t.object('PubPushLogPage', { total: t.u32(), rows: t.array(pubRows.pushLog) });
const OutboxPage = t.object('PubOutboxPage', { total: t.u32(), rows: t.array(pubRows.outbox) });
const Preview = t.object('PubCampaignPreview', { targeted: t.u32(), optedOut: t.u32(), withPush: t.u32(), withPhone: t.u32() });
const JwtPreview = t.object('PubJwtPreview', { jwt: t.string(), projectId: t.string(), clientEmail: t.string() });
const DeviceAdmin = t.object('PubDeviceAdmin', { id: t.u64(), accountId: t.u64(), token: t.string(), platform: t.string(), appVersion: t.string(), isActive: t.bool(), failCount: t.u32(), lastError: t.string(), lastSeenAt: t.u64() });

function candidates(ctx: PTx, c: CampaignRow) {
  let ids: bigint[];
  if (c.target === 'players') ids = [...c.accountIds];
  else if (c.target === 'tags') {
    const set = new Set<bigint>();
    for (const tag of c.tagIds) for (const u of ctx.db.userTag.tagId.filter(tag)) set.add(u.accountId);
    ids = [...set];
  } else ids = [...ctx.db.account.iter()].map(a => a.id);
  return ids.filter(id => id > c.cursor).sort((a, b) => (a < b ? -1 : 1));
}

function finishRun(ctx: PTx, c: CampaignRow, now: bigint) {
  if (c.schedule === 'recurring' && c.repeatMinutes) {
    const step = BigInt(c.repeatMinutes) * MIN_US;
    let next = c.runStartedAt + step;
    while (next <= now) next += step;
    if (!c.repeatUntil || next <= c.repeatUntil) return { ...c, status: 'scheduled', run: c.run + 1, cursor: 0n, nextAt: next };
  }
  return { ...c, status: 'done', finishedAt: now };
}

export function campaignBatch(ctx: PTx, id: bigint) {
  const c0 = ctx.db.campaign.id.find(id);
  if (!c0) return false;
  const now = nowUs(ctx);
  let c = c0;
  if (c.status !== 'scheduled' && c.status !== 'sending') return false;
  if (c.nextAt > now) return false;
  const q = quietUntil(c.quietStart, c.quietEnd, now);
  if (q) {
    ctx.db.campaign.id.update({ ...c, nextAt: q, updatedAt: ctx.timestamp });
    return false;
  }
  if (c.status === 'scheduled') c = { ...c, status: 'sending', runStartedAt: now, cursor: 0n };
  const size = Math.max(pubSettings(ctx).batchSize, 1);
  const list = candidates(ctx, c).slice(0, size);
  const f = { tagIds: [], excludeTagIds: c.excludeTagIds, levelTableId: c.levelTableId, minLevel: c.minLevel, maxLevel: c.maxLevel, countries: c.countries, inactiveDays: c.inactiveDays };
  const add = { recipients: 0, sent: 0, skipped: 0, inboxCount: 0 };
  for (const accountId of list) {
    const a = ctx.db.account.id.find(accountId);
    if (!a || audienceBlock(ctx, a, f, now, false)) continue;
    const key = `${c.id}|${c.run}|${accountId}`;
    if (ctx.db.delivery.key.find(key)) continue;
    const d = deliver(ctx, accountId, {
      kind: c.kind,
      categoryKey: c.categoryKey,
      channels: c.channels,
      title: c.title,
      body: c.body,
      imageUrl: c.imageUrl,
      actionType: c.actionType,
      actionValue: c.actionValue,
      actionLabel: c.actionLabel,
      prizeId: c.prizeId,
      campaignId: c.id,
      newsId: c.newsId,
      capped: true,
    });
    ctx.db.delivery.insert({ key, campaignId: c.id, run: c.run, accountId, status: d.status, reason: d.reason, channels: d.channels, inboxId: d.inboxId, at: now });
    add.recipients++;
    if (d.status === 'sent') add.sent++;
    else add.skipped++;
    if (d.inboxId) add.inboxCount++;
  }
  c = {
    ...c,
    cursor: list.length ? list[list.length - 1] : c.cursor,
    batches: c.batches + 1,
    recipients: c.recipients + add.recipients,
    sent: c.sent + add.sent,
    skipped: c.skipped + add.skipped,
    inboxCount: c.inboxCount + add.inboxCount,
    updatedAt: ctx.timestamp,
  };
  if (list.length < size) c = finishRun(ctx, c, now);
  ctx.db.campaign.id.update(c);
  return true;
}

function dueCampaign(ctx: PTx) {
  const now = nowUs(ctx);
  return [...ctx.db.campaign.status.filter('sending'), ...ctx.db.campaign.status.filter('scheduled')].filter(c => c.nextAt <= now).sort((a, b) => (a.id < b.id ? -1 : 1))[0]?.id;
}

export function fireRule(ctx: PTx, rule: RuleRow, accountId: bigint, occurrence: string, vars: Record<string, string>) {
  if (!rule.isActive) return;
  const key = `${rule.id}|${accountId}|${occurrence}`.slice(0, 200);
  if (ctx.db.autoFire.key.find(key)) return;
  const now = nowUs(ctx);
  ctx.db.autoFire.insert({ key, ruleId: rule.id, accountId, occurrence, status: 'pending', reason: '', vars: JSON.stringify(vars), dueAt: now, inboxId: 0n, at: now, doneAt: 0n });
}

function processFires(ctx: PTx, limit: number) {
  const now = nowUs(ctx);
  const due = [...ctx.db.autoFire.status.filter('pending')].filter(f => f.dueAt <= now).sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, limit);
  let n = 0;
  for (const f of due) {
    const rule = ctx.db.autoRule.id.find(f.ruleId);
    const done = (status: string, reason: string, inboxId = 0n) => ctx.db.autoFire.key.update({ ...f, status, reason, inboxId, doneAt: now });
    n++;
    if (!rule || !rule.isActive) {
      done('skipped', 'rule_off');
      continue;
    }
    const q = quietUntil(rule.quietStart, rule.quietEnd, now);
    if (q) {
      ctx.db.autoFire.key.update({ ...f, dueAt: q });
      continue;
    }
    const lastKey = `${rule.id}|${f.accountId}`;
    const last = ctx.db.autoLast.key.find(lastKey);
    if (rule.cooldownMinutes && last && now - last.at < BigInt(rule.cooldownMinutes) * MIN_US) {
      done('skipped', 'cooldown');
      continue;
    }
    let vars: Record<string, string> = {};
    try {
      vars = JSON.parse(f.vars);
    } catch {}
    const d = deliver(ctx, f.accountId, {
      kind: 'auto',
      ruleId: rule.id,
      categoryKey: rule.categoryKey,
      channels: rule.channels,
      title: rule.title,
      body: rule.body,
      imageUrl: rule.imageUrl,
      actionType: rule.actionType,
      actionValue: rule.actionValue,
      actionLabel: rule.actionLabel,
      prizeId: rule.prizeId,
      vars,
      capped: true,
    });
    if (d.status === 'sent') {
      if (last) ctx.db.autoLast.key.update({ key: lastKey, at: now });
      else ctx.db.autoLast.insert({ key: lastKey, at: now });
    }
    done(d.status, d.reason, d.inboxId);
  }
  return n;
}

function inactiveScan(ctx: PTx, force: boolean) {
  const now = nowUs(ctx);
  const s = pubSettings(ctx);
  const st = ctx.db.pubState.id.find(0) ?? ctx.db.pubState.insert({ id: 0, lastInactiveScan: 0n, lastSweep: 0n });
  if (!force && now - st.lastInactiveScan < BigInt(Math.max(s.inactiveScanMinutes, 1)) * MIN_US) return;
  ctx.db.pubState.id.update({ ...st, lastInactiveScan: now });
  const rules = [...ctx.db.autoRule.iter()].filter(r => r.isActive && r.trigger === 'inactive' && r.inactiveDays);
  if (!rules.length) return;
  for (const a of ctx.db.account.iter()) {
    if (!isPlayer(a)) continue;
    const last = a.lastLoginAt.microsSinceUnixEpoch;
    const days = Number((now - last) / DAY_US);
    for (const r of rules) if (days >= r.inactiveDays && days < r.inactiveDays + 2) fireRule(ctx, r, a.id, `inactive:${r.inactiveDays}:${last}`, { days: String(r.inactiveDays) });
  }
}

function sweep(ctx: PTx) {
  const now = nowUs(ctx);
  const realNow = ctx.timestamp.microsSinceUnixEpoch;
  const st = ctx.db.pubState.id.find(0) ?? ctx.db.pubState.insert({ id: 0, lastInactiveScan: 0n, lastSweep: 0n });
  if (realNow - st.lastSweep < 10n * MIN_US) return;
  ctx.db.pubState.id.update({ ...st, lastSweep: realNow });
  const s = pubSettings(ctx);
  const minute = realNow / MIN_US;
  for (const r of [...ctx.db.pubRate.iter()].filter(r => r.minute < minute - 2n).slice(0, 2000)) ctx.db.pubRate.key.delete(r.key);
  if (s.inboxKeepDays) {
    const cut = now - BigInt(s.inboxKeepDays) * DAY_US;
    for (const r of [...ctx.db.inbox.iter()].filter(r => r.at < cut && (!r.prizeId || r.claimedAt)).slice(0, 2000)) ctx.db.inbox.id.delete(r.id);
  }
  const old = now - 90n * DAY_US;
  for (const r of [...ctx.db.autoFire.iter()].filter(r => r.status !== 'pending' && r.at < old).slice(0, 2000)) ctx.db.autoFire.key.delete(r.key);
  for (const r of [...ctx.db.outbox.iter()].filter(r => r.doneAt && r.doneAt < realNow - 30n * DAY_US).slice(0, 2000)) ctx.db.outbox.id.delete(r.id);
  const capCut = Math.floor(Number((now + 12_600_000_000n) / DAY_US)) - 8;
  for (const r of [...ctx.db.notifyCap.iter()].filter(r => r.day < capCut).slice(0, 2000)) ctx.db.notifyCap.key.delete(r.key);
  const live = BigInt(Math.max(s.liveNoticeMinutes, 1)) * MIN_US;
  for (const r of [...ctx.db.liveNotice.iter()].filter(r => r.at.microsSinceUnixEpoch < realNow - live)) ctx.db.liveNotice.id.delete(r.id);
  newsSweep(ctx);
}

export function runWorker(ctx: PProc, force: boolean) {
  ctx.withTx(tx => {
    newsTick(tx);
    sweep(tx);
    inactiveScan(tx, force);
  });
  const s = ctx.withTx(tx => ({ ...pubSettings(tx) }));
  let batches = 0;
  for (let i = 0; i < Math.max(s.batchesPerTick, 1); i++) {
    const did = ctx.withTx(tx => {
      const id = dueCampaign(tx);
      return id ? campaignBatch(tx, id) : false;
    });
    if (!did) break;
    batches++;
  }
  const fires = ctx.withTx(tx => processFires(tx, Math.max(s.batchSize, 1)));
  const outbox = runOutbox(ctx, Math.max(s.batchSize, 1));
  return { batches, fires, outbox };
}

function markOpened(ctx: PTx, campaignId: bigint) {
  if (!campaignId) return;
  const c = ctx.db.campaign.id.find(campaignId);
  if (c) ctx.db.campaign.id.update({ ...c, opened: c.opened + 1 });
}

function ruleUsesCategory(ctx: PTx, key: string) {
  return [...ctx.db.autoRule.iter()].some(r => r.categoryKey === key) || [...ctx.db.campaign.iter()].some(c => c.categoryKey === key && (c.status === 'scheduled' || c.status === 'sending' || c.status === 'draft'));
}

function metaVars(metadata: string) {
  const out: Record<string, string> = {};
  if (!metadata) return out;
  try {
    const m = JSON.parse(metadata);
    if (m && typeof m === 'object' && !Array.isArray(m)) for (const [k, v] of Object.entries(m)) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v).slice(0, 200);
  } catch {}
  return out;
}

function cleanMessage(ctx: PTx, a: { categoryKey: string; channels: string[]; title: { lang: string; text: string }[]; body: { lang: string; text: string }[]; imageUrl: string; actionType: string; actionValue: string; actionLabel: { lang: string; text: string }[]; prizeId: bigint }) {
  const cat = ctx.db.notifyCategory.key.find(a.categoryKey.trim());
  if (!cat) fail('CATEGORY_NOT_FOUND');
  if (a.prizeId && !ctx.db.prize.id.find(a.prizeId)) fail('PRIZE_NOT_FOUND');
  return {
    categoryKey: cat.key,
    channels: cleanChannels(a.channels),
    title: cleanText(ctx, a.title, 200, true),
    body: cleanText(ctx, a.body, 2000, true, 'BODY_REQUIRED'),
    imageUrl: cleanUrl(a.imageUrl),
    ...cleanAction(ctx, a.actionType, a.actionValue),
    actionLabel: cleanText(ctx, a.actionLabel, 100, false),
    prizeId: a.prizeId,
  };
}

const MessageArgs = {
  categoryKey: t.string(),
  channels: t.array(t.string()),
  title: Translations,
  body: Translations,
  imageUrl: t.string(),
  actionType: t.string(),
  actionValue: t.string(),
  actionLabel: Translations,
  prizeId: t.u64(),
};

export function defineNotify(st: PublicationSchema) {
  eventHooks.push((raw, accountId, key, value, metadata, eventId) => {
    const ctx = raw as unknown as PTx;
    if (!ctx.db.pubSettings.id.find(0)) return;
    for (const r of ctx.db.autoRule.eventKey.filter(key)) {
      if (!r.isActive || r.trigger !== 'event') continue;
      const vars = metaVars(metadata);
      if (r.matchField && vars[r.matchField] !== r.matchValue) continue;
      fireRule(ctx, r, accountId, `ev:${eventId}`, { ...vars, value: String(value) });
    }
  });
  loginHooks.push((raw, accountId, isNew) => {
    const ctx = raw as unknown as PTx;
    if (!isNew || !ctx.db.pubSettings.id.find(0)) return;
    for (const r of ctx.db.autoRule.iter()) if (r.isActive && r.trigger === 'first_login') fireRule(ctx, r, accountId, 'first', {});
  });
  paymentHooks.push((raw, accountId, paymentId) => {
    const ctx = raw as unknown as PTx;
    if (!ctx.db.pubSettings.id.find(0)) return;
    const p = ctx.db.payment.id.find(paymentId);
    for (const r of ctx.db.autoRule.iter()) if (r.isActive && r.trigger === 'payment_success') fireRule(ctx, r, accountId, `pay:${paymentId}`, { amount: String(p?.finalToman ?? 0n), paymentId: String(paymentId) });
  });
  prizeUseChecks.push((raw, id) => {
    const ctx = raw as unknown as PTx;
    return [...ctx.db.autoRule.iter()].some(r => r.prizeId === id) || [...ctx.db.campaign.iter()].some(c => c.prizeId === id) || [...ctx.db.inbox.iter()].some(i => i.prizeId === id && !i.claimedAt);
  });

  const myInbox = st.view({ name: 'my_inbox', public: true }, t.array(InboxEntry), ctx => {
    const id = sessionAccountId(ctx as never);
    if (id === undefined) return [];
    return [...ctx.db.inbox.accountId.filter(id)].map(r => ({
      id: r.id,
      kind: r.kind,
      categoryKey: r.categoryKey,
      title: r.title,
      body: r.body,
      imageUrl: r.imageUrl,
      actionType: r.actionType,
      actionValue: r.actionValue,
      actionLabel: r.actionLabel,
      prizeId: r.prizeId,
      claimed: !!r.claimedAt,
      read: r.read,
      newsId: r.newsId,
      at: r.at,
    }));
  });

  const myNotifyPrefs = st.view({ name: 'my_notify_prefs', public: true }, t.array(PrefEntry), ctx => {
    const id = sessionAccountId(ctx as never);
    if (id === undefined) return [];
    return [...ctx.db.notifyPref.accountId.filter(id)].map(p => ({ key: p.key, categoryKey: p.categoryKey, channel: p.channel, enabled: p.enabled }));
  });

  const myPushDevices = st.view({ name: 'my_push_devices', public: true }, t.array(DeviceEntry), ctx => {
    const id = sessionAccountId(ctx as never);
    if (id === undefined) return [];
    return [...ctx.db.pushDevice.accountId.filter(id)].map(d => ({ id: d.id, token: mask(d.token), platform: d.platform, appVersion: d.appVersion, isActive: d.isActive, lastSeenAt: d.lastSeenAt }));
  });

  const adminPublicationSettings = st.view({ name: 'admin_publication_settings', public: true }, t.option(pubRows.settings), ctx => (adminOrNull(ctx as any) ? ctx.db.pubSettings.id.find(0) ?? undefined : undefined));

  const adminPushConfig = st.view({ name: 'admin_push_config', public: true }, t.option(PushConfigInfo), ctx => {
    if (!adminOrNull(ctx as any)) return undefined;
    const c = ctx.db.pushConfig.id.find(0);
    if (!c) return undefined;
    return { provider: c.provider, projectId: c.projectId, clientEmail: c.clientEmail, configured: !!c.privateKey, keyHint: c.privateKey ? '********' : '' };
  });

  const adminCampaigns = st.view({ name: 'admin_campaigns', public: true }, t.array(pubRows.campaign), ctx => (adminOrNull(ctx as any) ? [...ctx.db.campaign.iter()] : []));

  const adminAutoRules = st.view({ name: 'admin_auto_rules', public: true }, t.array(pubRows.autoRule), ctx => (adminOrNull(ctx as any) ? [...ctx.db.autoRule.iter()] : []));

  const adminSavePublicationSettings = st.reducer(
    {
      inboxKeepDays: t.u32(),
      inboxMaxPerPlayer: t.u32(),
      maxDevices: t.u32(),
      devicePerMinute: t.u32(),
      prefsPerMinute: t.u32(),
      inboxPerMinute: t.u32(),
      batchSize: t.u32(),
      batchesPerTick: t.u32(),
      capPerDay: t.u32(),
      capPerWeek: t.u32(),
      pushRetries: t.u32(),
      smsMaxChars: t.u32(),
      liveNoticeMinutes: t.u32(),
      inactiveScanMinutes: t.u32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const s = pubSettings(ctx);
      if (a.inboxKeepDays > 3650) fail('INVALID_SETTING:inboxKeepDays');
      if (a.inboxMaxPerPlayer > 10_000) fail('INVALID_SETTING:inboxMaxPerPlayer');
      if (a.maxDevices < 1 || a.maxDevices > 50) fail('INVALID_SETTING:maxDevices');
      if (a.devicePerMinute > 10_000) fail('INVALID_SETTING:devicePerMinute');
      if (a.prefsPerMinute > 10_000) fail('INVALID_SETTING:prefsPerMinute');
      if (a.inboxPerMinute > 10_000) fail('INVALID_SETTING:inboxPerMinute');
      if (a.batchSize < 1 || a.batchSize > 2000) fail('INVALID_SETTING:batchSize');
      if (a.batchesPerTick < 1 || a.batchesPerTick > 100) fail('INVALID_SETTING:batchesPerTick');
      if (a.capPerDay > 1000) fail('INVALID_SETTING:capPerDay');
      if (a.capPerWeek > 10_000 || (a.capPerWeek && a.capPerDay > a.capPerWeek)) fail('INVALID_SETTING:capPerWeek');
      if (a.pushRetries < 1 || a.pushRetries > 10) fail('INVALID_SETTING:pushRetries');
      if (a.smsMaxChars < 70 || a.smsMaxChars > 1000) fail('INVALID_SETTING:smsMaxChars');
      if (a.liveNoticeMinutes < 1 || a.liveNoticeMinutes > 1440) fail('INVALID_SETTING:liveNoticeMinutes');
      if (a.inactiveScanMinutes < 1 || a.inactiveScanMinutes > 1440) fail('INVALID_SETTING:inactiveScanMinutes');
      ctx.db.pubSettings.id.update({ ...s, ...a, updatedAt: ctx.timestamp });
      audit(base(ctx), me.id, 'publication_settings.save', 'settings', JSON.stringify(a));
    }
  );

  const adminSetPublicationClockOffset = st.reducer({ seconds: t.i64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = pubSettings(ctx);
    if (a.seconds < -3650n * 86400n || a.seconds > 3650n * 86400n) fail('INVALID_CLOCK_OFFSET');
    ctx.db.pubSettings.id.update({ ...s, clockOffsetSec: a.seconds, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'publication_settings.clock', 'settings', String(a.seconds));
  });

  const adminSavePushConfig = st.reducer({ provider: t.string(), serviceAccount: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (a.provider !== 'log' && a.provider !== 'fcm') fail('INVALID_PROVIDER');
    const old = ctx.db.pushConfig.id.find(0);
    let sa = old ? { projectId: old.projectId, clientEmail: old.clientEmail, privateKey: old.privateKey, privateKeyId: old.privateKeyId } : { projectId: '', clientEmail: '', privateKey: '', privateKeyId: '' };
    if (a.serviceAccount.trim()) sa = checkServiceAccount(a.serviceAccount.trim());
    if (a.provider === 'fcm' && !sa.privateKey) fail('INVALID_SERVICE_ACCOUNT');
    const row = { id: 0, provider: a.provider, ...sa, updatedAt: ctx.timestamp };
    if (old) ctx.db.pushConfig.id.update(row);
    else ctx.db.pushConfig.insert(row);
    if (a.serviceAccount.trim() && ctx.db.pushToken.id.find(0)) ctx.db.pushToken.id.delete(0);
    audit(base(ctx), me.id, 'push_config.save', a.provider, sa.projectId);
  });

  const adminPushJwtPreview = st.procedure(JwtPreview, ctx =>
    ctx.withTx(tx => {
      const me = requireRole(base(tx), 'admin');
      const c = tx.db.pushConfig.id.find(0);
      if (!c || !c.privateKey) fail('PUSH_NOT_CONFIGURED');
      audit(base(tx), me.id, 'push_config.jwt_preview', c.projectId);
      return { jwt: fcmJwt(c, Number(tx.timestamp.microsSinceUnixEpoch / 1_000_000n)), projectId: c.projectId, clientEmail: c.clientEmail };
    })
  );

  const adminSaveNotifyCategory = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, description: Translations, mandatory: t.bool(), defaultOn: t.bool(), isActive: t.bool(), sort: t.i32() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.notifyCategory.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      const same = ctx.db.notifyCategory.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (a.mandatory && !a.defaultOn) fail('MANDATORY_MUST_BE_ON');
      const row = { id: a.id, key, name: cleanText(ctx, a.name, 200, true), description: cleanText(ctx, a.description, 500, false), mandatory: a.mandatory, defaultOn: a.defaultOn, isActive: a.isActive, sort: a.sort, createdAt: old?.createdAt ?? ctx.timestamp };
      const saved = old ? ctx.db.notifyCategory.id.update(row) : ctx.db.notifyCategory.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'notify_category.update' : 'notify_category.create', String(saved.id), key);
    }
  );

  const adminDeleteNotifyCategory = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const c = ctx.db.notifyCategory.id.find(id);
    if (!c) fail('NOT_FOUND');
    if (c.key === 'system' || c.key === 'news' || c.key === newsCategoryKey(ctx)) fail('CATEGORY_LOCKED');
    if (ruleUsesCategory(ctx, c.key)) fail('IN_USE');
    ctx.db.notifyCategory.id.delete(id);
    for (const p of [...ctx.db.notifyPref.iter()].filter(p => p.categoryKey === c.key)) ctx.db.notifyPref.key.delete(p.key);
    audit(base(ctx), me.id, 'notify_category.delete', String(id), c.key);
  });

  const notifyPrefs = st.procedure(t.array(PrefLine), ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      return [...tx.db.notifyCategory.iter()]
        .filter(c => c.isActive)
        .sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1))
        .map(c => ({ key: c.key, name: c.name, description: c.description, mandatory: c.mandatory, channels: ['inbox', 'push', 'sms'].map(channel => ({ channel, enabled: prefEnabled(tx, me.id, c, channel) })) }));
    })
  );

  const notifyPrefsSet = st.reducer({ prefs: t.array(PrefInput) }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    if (!a.prefs.length || a.prefs.length > 50) fail('INVALID_PREFS');
    checkRate(ctx, `${me.id}|prefs`, pubSettings(ctx).prefsPerMinute);
    for (const p of a.prefs) {
      const c = ctx.db.notifyCategory.key.find(p.categoryKey.trim());
      if (!c || !c.isActive) fail('CATEGORY_NOT_FOUND');
      if (!['inbox', 'push', 'sms'].includes(p.channel)) fail('INVALID_CHANNEL');
      if (c.mandatory) fail('CATEGORY_LOCKED');
      const key = `${me.id}|${c.key}|${p.channel}`;
      const row = { key, accountId: me.id, categoryKey: c.key, channel: p.channel, enabled: p.enabled, updatedAt: ctx.timestamp };
      if (ctx.db.notifyPref.key.find(key)) ctx.db.notifyPref.key.update(row);
      else ctx.db.notifyPref.insert(row);
    }
  });

  const inboxRead = st.reducer({ ids: t.array(t.u64()), all: t.bool() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    if (!a.all && (!a.ids.length || a.ids.length > 200)) fail('INVALID_IDS');
    checkRate(ctx, `${me.id}|inbox`, pubSettings(ctx).inboxPerMinute);
    const now = nowUs(ctx);
    const rows = a.all ? [...ctx.db.inbox.accountId.filter(me.id)] : a.ids.map(id => ctx.db.inbox.id.find(id)).filter(r => !!r && r.accountId === me.id);
    for (const r of rows) {
      if (!r || r.read) continue;
      ctx.db.inbox.id.update({ ...r, read: true, readAt: now });
      markOpened(ctx, r.campaignId);
    }
  });

  const inboxDelete = st.reducer({ ids: t.array(t.u64()) }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    if (!a.ids.length || a.ids.length > 200) fail('INVALID_IDS');
    checkRate(ctx, `${me.id}|inbox`, pubSettings(ctx).inboxPerMinute);
    for (const id of a.ids) {
      const r = ctx.db.inbox.id.find(id);
      if (!r || r.accountId !== me.id) fail('NOT_FOUND');
      if (r.prizeId && !r.claimedAt) fail('PRIZE_NOT_CLAIMED');
      ctx.db.inbox.id.delete(id);
    }
  });

  const inboxClaim = st.procedure({ id: t.u64() }, ClaimResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      checkRate(tx, `${me.id}|inbox`, pubSettings(tx).inboxPerMinute);
      const r = tx.db.inbox.id.find(a.id);
      if (!r || r.accountId !== me.id) fail('NOT_FOUND');
      if (!r.prizeId) fail('NO_PRIZE');
      const already = !!r.claimedAt;
      const rewards: Reward[] = grantPrize(econ(tx), me.id, r.prizeId, 'inbox', String(r.id));
      if (!already) {
        tx.db.inbox.id.update({ ...r, claimedAt: nowUs(tx), rewards: JSON.stringify(rewards), read: true, readAt: r.readAt || nowUs(tx) });
        if (!r.read) markOpened(tx, r.campaignId);
      }
      return { inboxId: r.id, already, rewards: rewards.map(x => ({ ...x, value: Number(x.value) })) };
    })
  );

  const pushRegister = st.procedure({ token: t.string(), platform: t.string(), appVersion: t.string(), deviceKey: t.string() }, RegisterResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const s = pubSettings(tx);
      checkRate(tx, `${me.id}|device`, s.devicePerMinute);
      const token = a.token.trim();
      if (token.length < 16 || token.length > 4096 || /\s/.test(token)) fail('INVALID_TOKEN');
      if (!PLATFORMS.includes(a.platform)) fail('INVALID_PLATFORM');
      const appVersion = a.appVersion.trim();
      if (appVersion.length > 40) fail('INVALID_APP_VERSION');
      const deviceKey = a.deviceKey.trim();
      if (deviceKey.length > 200) fail('INVALID_DEVICE_KEY');
      const now = nowUs(tx);
      let deactivated = 0;
      if (deviceKey) {
        for (const d of tx.db.pushDevice.accountId.filter(me.id)) {
          if (d.deviceKey === deviceKey && d.token !== token && d.isActive) {
            tx.db.pushDevice.id.update({ ...d, isActive: false, lastError: 'REPLACED' });
            deactivated++;
          }
        }
      }
      const old = tx.db.pushDevice.token.find(token);
      const row = { token, accountId: me.id, platform: a.platform, appVersion, deviceKey, isActive: true, failCount: 0, lastError: '', lastSeenAt: now };
      const saved = old ? tx.db.pushDevice.id.update({ ...old, ...row }) : tx.db.pushDevice.insert({ ...row, id: 0n, createdAt: tx.timestamp });
      const active = activeDevices(tx, me.id).sort((x, y) => (x.lastSeenAt < y.lastSeenAt ? 1 : x.lastSeenAt > y.lastSeenAt ? -1 : x.id < y.id ? 1 : -1));
      for (const d of active.slice(s.maxDevices)) {
        tx.db.pushDevice.id.update({ ...d, isActive: false, lastError: 'LIMIT' });
        deactivated++;
      }
      const fresh = tx.db.pushDevice.id.find(saved.id)!;
      return { deviceId: fresh.id, platform: fresh.platform, active: fresh.isActive, deactivated };
    })
  );

  const pushUnregister = st.reducer({ token: t.string() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    checkRate(ctx, `${me.id}|device`, pubSettings(ctx).devicePerMinute);
    const d = ctx.db.pushDevice.token.find(a.token.trim());
    if (!d || d.accountId !== me.id) fail('DEVICE_NOT_FOUND');
    ctx.db.pushDevice.id.delete(d.id);
  });

  const campaignArgs = {
    id: t.u64(),
    name: t.string(),
    ...MessageArgs,
    target: t.string(),
    accountIds: t.array(t.u64()),
    tagIds: t.array(t.u64()),
    excludeTagIds: t.array(t.u64()),
    levelTableId: t.u64(),
    minLevel: t.u32(),
    maxLevel: t.u32(),
    countries: t.array(t.string()),
    inactiveDays: t.u32(),
    schedule: t.string(),
    scheduledAt: t.u64(),
    repeatMinutes: t.u32(),
    repeatUntil: t.u64(),
    quietStart: t.u16(),
    quietEnd: t.u16(),
  };

  const adminSaveCampaign = st.reducer(campaignArgs, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const old = a.id ? ctx.db.campaign.id.find(a.id) : undefined;
    if (a.id && !old) fail('NOT_FOUND');
    if (old && (old.status !== 'draft' || old.kind !== 'campaign')) fail('NOT_EDITABLE');
    if (a.name.length > 200) fail('INVALID_NAME');
    const msg = cleanMessage(ctx, a);
    if (!TARGETS.includes(a.target)) fail('INVALID_TARGET');
    let accountIds: bigint[] = [];
    let tagIds: bigint[] = [];
    if (a.target === 'players') {
      accountIds = [...new Set(a.accountIds)].sort((x, y) => (x < y ? -1 : 1));
      if (!accountIds.length) fail('TARGET_PLAYERS_REQUIRED');
      if (accountIds.length > 1000) fail('TOO_MANY_PLAYERS');
      for (const id of accountIds) if (!ctx.db.account.id.find(id)) fail('USER_NOT_FOUND');
    }
    if (a.target === 'tags') {
      tagIds = checkTags(ctx, a.tagIds, ['user']);
      if (!tagIds.length) fail('TARGET_TAGS_REQUIRED');
    } else if (a.tagIds.length) fail('TAGS_NEED_TAG_TARGET');
    const excludeTagIds = checkTags(ctx, a.excludeTagIds, ['user']);
    if (excludeTagIds.some(x => tagIds.includes(x))) fail('DUPLICATE_TAG');
    if (a.maxLevel && a.minLevel > a.maxLevel) fail('INVALID_LEVEL_RANGE');
    if (a.levelTableId && !ctx.db.levelTable.id.find(a.levelTableId)) fail('LEVEL_TABLE_NOT_FOUND');
    if (a.countries.length > 50) fail('TOO_MANY_COUNTRIES');
    const countries = [...new Set(a.countries.map(c => c.trim().toUpperCase()))];
    for (const c of countries) if (!ctx.db.country.code.find(c)) fail('COUNTRY_NOT_FOUND');
    if (a.inactiveDays > 3650) fail('INVALID_INACTIVE_DAYS');
    if (!SCHEDULES.includes(a.schedule)) fail('INVALID_SCHEDULE');
    const now = nowUs(ctx);
    if (a.schedule === 'at') {
      if (!a.scheduledAt || a.scheduledAt <= now) fail('SCHEDULE_IN_PAST');
      if (a.scheduledAt > now + 366n * DAY_US) fail('SCHEDULE_TOO_FAR');
    }
    if (a.schedule === 'recurring') {
      if (a.repeatMinutes < 60 || a.repeatMinutes > 525_600) fail('INVALID_REPEAT');
      if (a.scheduledAt && a.scheduledAt > now + 366n * DAY_US) fail('SCHEDULE_TOO_FAR');
      if (a.repeatUntil && a.repeatUntil <= (a.scheduledAt || now)) fail('INVALID_REPEAT');
    }
    checkQuiet(a.quietStart, a.quietEnd);
    const row = {
      kind: 'campaign',
      name: a.name.trim(),
      ...msg,
      newsId: 0n,
      target: a.target,
      accountIds,
      tagIds,
      excludeTagIds,
      levelTableId: a.levelTableId,
      minLevel: a.minLevel,
      maxLevel: a.maxLevel,
      countries,
      inactiveDays: a.inactiveDays,
      schedule: a.schedule,
      scheduledAt: a.schedule === 'now' ? 0n : a.scheduledAt,
      repeatMinutes: a.schedule === 'recurring' ? a.repeatMinutes : 0,
      repeatUntil: a.schedule === 'recurring' ? a.repeatUntil : 0n,
      quietStart: a.quietStart,
      quietEnd: a.quietEnd,
      updatedAt: ctx.timestamp,
    };
    const saved = old
      ? ctx.db.campaign.id.update({ ...old, ...row })
      : ctx.db.campaign.insert({ ...row, id: 0n, status: 'draft', run: 0, runStartedAt: 0n, nextAt: 0n, cursor: 0n, batches: 0, recipients: 0, sent: 0, skipped: 0, failed: 0, inboxCount: 0, pushSent: 0, pushFailed: 0, smsSent: 0, opened: 0, createdBy: me.id, createdAt: ctx.timestamp, finishedAt: 0n });
    audit(base(ctx), me.id, old ? 'campaign.update' : 'campaign.create', String(saved.id), saved.name);
  });

  const adminSendCampaign = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const c = ctx.db.campaign.id.find(id);
    if (!c) fail('NOT_FOUND');
    if (c.status !== 'draft') fail('NOT_DRAFT');
    const now = nowUs(ctx);
    if (c.schedule === 'at' && c.scheduledAt <= now) fail('SCHEDULE_IN_PAST');
    ctx.db.campaign.id.update({ ...c, status: 'scheduled', nextAt: c.scheduledAt || now, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'campaign.send', String(id), c.name);
  });

  const adminCancelCampaign = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const c = ctx.db.campaign.id.find(id);
    if (!c) fail('NOT_FOUND');
    if (c.status !== 'scheduled' && c.status !== 'sending') fail('NOT_CANCELLABLE');
    ctx.db.campaign.id.update({ ...c, status: 'cancelled', finishedAt: nowUs(ctx), updatedAt: ctx.timestamp });
    for (const o of [...ctx.db.outbox.campaignId.filter(id)]) if (o.status === 'pending') ctx.db.outbox.id.update({ ...o, status: 'skipped', error: 'CANCELLED', doneAt: nowUs(ctx) });
    audit(base(ctx), me.id, 'campaign.cancel', String(id), c.name);
  });

  const adminDeleteCampaign = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const c = ctx.db.campaign.id.find(id);
    if (!c) fail('NOT_FOUND');
    if (c.status === 'scheduled' || c.status === 'sending') fail('CAMPAIGN_RUNNING');
    for (const d of [...ctx.db.delivery.campaignId.filter(id)]) ctx.db.delivery.key.delete(d.key);
    ctx.db.campaign.id.delete(id);
    audit(base(ctx), me.id, 'campaign.delete', String(id), c.name);
  });

  const adminCampaignDeliveries = st.procedure({ campaignId: t.u64(), status: t.string(), page: t.u32(), pageSize: t.u32() }, DeliveryPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const list = [...tx.db.delivery.campaignId.filter(a.campaignId)].filter(d => !a.status || d.status === a.status).sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : x.key < y.key ? -1 : 1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminCampaignPreview = st.procedure({ id: t.u64() }, Preview, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const c = tx.db.campaign.id.find(a.id);
      if (!c) fail('NOT_FOUND');
      const now = nowUs(tx);
      const cat = tx.db.notifyCategory.key.find(c.categoryKey);
      const out = { targeted: 0, optedOut: 0, withPush: 0, withPhone: 0 };
      const f = { tagIds: [], excludeTagIds: c.excludeTagIds, levelTableId: c.levelTableId, minLevel: c.minLevel, maxLevel: c.maxLevel, countries: c.countries, inactiveDays: c.inactiveDays };
      for (const id of candidates(tx, { ...c, cursor: 0n })) {
        const acc = tx.db.account.id.find(id);
        if (!acc || audienceBlock(tx, acc, f, now, false)) continue;
        out.targeted++;
        if (cat && !c.channels.some(ch => prefEnabled(tx, id, cat, ch))) out.optedOut++;
        if (activeDevices(tx, id).length) out.withPush++;
        if (/^09\d{9}$/.test(acc.phone)) out.withPhone++;
      }
      return out;
    })
  );

  const ruleArgs = {
    id: t.u64(),
    key: t.string(),
    name: t.string(),
    trigger: t.string(),
    eventKey: t.string(),
    matchField: t.string(),
    matchValue: t.string(),
    inactiveDays: t.u32(),
    ...MessageArgs,
    cooldownMinutes: t.u32(),
    quietStart: t.u16(),
    quietEnd: t.u16(),
    isActive: t.bool(),
  };

  const adminSaveAutoRule = st.reducer(ruleArgs, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const key = cleanKey(a.key);
    const old = a.id ? ctx.db.autoRule.id.find(a.id) : undefined;
    if (a.id && !old) fail('NOT_FOUND');
    if (old && old.key !== key) fail('KEY_LOCKED');
    const same = ctx.db.autoRule.key.find(key);
    if (same && same.id !== a.id) fail('KEY_TAKEN');
    if (!TRIGGERS.includes(a.trigger)) fail('INVALID_TRIGGER');
    let eventKey = '';
    if (a.trigger === 'event') {
      eventKey = a.eventKey.trim();
      if (!ctx.db.eventType.key.find(eventKey)) fail('EVENT_TYPE_NOT_FOUND');
      if (a.matchField.length > 64 || a.matchValue.length > 200) fail('INVALID_MATCH');
    }
    if (a.trigger === 'inactive' && (a.inactiveDays < 1 || a.inactiveDays > 365)) fail('INVALID_INACTIVE_DAYS');
    if (a.cooldownMinutes > 525_600) fail('INVALID_COOLDOWN');
    checkQuiet(a.quietStart, a.quietEnd);
    const msg = cleanMessage(ctx, a);
    const row = {
      id: a.id,
      key,
      name: a.name.trim().slice(0, 200),
      trigger: a.trigger,
      eventKey,
      matchField: a.trigger === 'event' ? a.matchField.trim() : '',
      matchValue: a.trigger === 'event' ? a.matchValue.trim() : '',
      inactiveDays: a.trigger === 'inactive' ? a.inactiveDays : 0,
      ...msg,
      cooldownMinutes: a.cooldownMinutes,
      quietStart: a.quietStart,
      quietEnd: a.quietEnd,
      isActive: a.isActive,
      createdAt: old?.createdAt ?? ctx.timestamp,
      updatedAt: ctx.timestamp,
    };
    const saved = old ? ctx.db.autoRule.id.update(row) : ctx.db.autoRule.insert({ ...row, id: 0n });
    audit(base(ctx), me.id, old ? 'auto_rule.update' : 'auto_rule.create', String(saved.id), key);
  });

  const adminDeleteAutoRule = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const r = ctx.db.autoRule.id.find(id);
    if (!r) fail('NOT_FOUND');
    for (const f of [...ctx.db.autoFire.ruleId.filter(id)]) ctx.db.autoFire.key.delete(f.key);
    ctx.db.autoRule.id.delete(id);
    audit(base(ctx), me.id, 'auto_rule.delete', String(id), r.key);
  });

  const adminAutoFires = st.procedure({ ruleId: t.u64(), status: t.string(), page: t.u32(), pageSize: t.u32() }, FirePage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const list = [...tx.db.autoFire.ruleId.filter(a.ruleId)].filter(f => !a.status || f.status === a.status).sort((x, y) => (x.at < y.at ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminPushLog = st.procedure({ accountId: t.u64(), page: t.u32(), pageSize: t.u32() }, PushLogPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const list = [...(a.accountId ? tx.db.pushLog.accountId.filter(a.accountId) : tx.db.pushLog.iter())].sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminOutbox = st.procedure({ accountId: t.u64(), campaignId: t.u64(), page: t.u32(), pageSize: t.u32() }, OutboxPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const src = a.accountId ? [...tx.db.outbox.accountId.filter(a.accountId)] : a.campaignId ? [...tx.db.outbox.campaignId.filter(a.campaignId)] : [...tx.db.outbox.iter()];
      const list = src.filter(o => !a.campaignId || o.campaignId === a.campaignId).sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminPushDevices = st.procedure({ accountId: t.u64() }, t.array(DeviceAdmin), (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      return [...tx.db.pushDevice.accountId.filter(a.accountId)].map(d => ({ id: d.id, accountId: d.accountId, token: mask(d.token), platform: d.platform, appVersion: d.appVersion, isActive: d.isActive, failCount: d.failCount, lastError: d.lastError, lastSeenAt: d.lastSeenAt }));
    })
  );

  const adminTestNotification = st.procedure({ accountId: t.u64(), ...MessageArgs }, t.string(), (ctx, a) => {
    const r = ctx.withTx(tx => {
      const me = requireRole(base(tx), 'admin');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      const msg = cleanMessage(tx, a);
      const d = deliver(tx, a.accountId, { kind: 'test', ...msg, ignorePrefs: true });
      audit(base(tx), me.id, 'notification.test', String(a.accountId), d.status);
      return d;
    });
    runOutbox(ctx, 50);
    return r.status === 'sent' ? `sent:${r.channels.join(',')}` : `skipped:${r.reason}`;
  });

  const adminPublicationRun = st.procedure(RunResult, ctx => {
    ctx.withTx(tx => {
      requireRole(base(tx), 'admin');
    });
    return runWorker(ctx, true);
  });

  const pubTick = st.procedure({ onSchedule: publicationTables.pubTickTimer }, { timer: publicationTables.pubTickTimer.rowType }, t.unit(), ctx => {
    runWorker(ctx, false);
    return {};
  });

  return {
    pubTick,
    myInbox,
    myNotifyPrefs,
    myPushDevices,
    adminPublicationSettings,
    adminPushConfig,
    adminCampaigns,
    adminAutoRules,
    adminSavePublicationSettings,
    adminSetPublicationClockOffset,
    adminSavePushConfig,
    adminPushJwtPreview,
    adminSaveNotifyCategory,
    adminDeleteNotifyCategory,
    notifyPrefs,
    notifyPrefsSet,
    inboxRead,
    inboxDelete,
    inboxClaim,
    pushRegister,
    pushUnregister,
    adminSaveCampaign,
    adminSendCampaign,
    adminCancelCampaign,
    adminDeleteCampaign,
    adminCampaignDeliveries,
    adminCampaignPreview,
    adminSaveAutoRule,
    adminDeleteAutoRule,
    adminAutoFires,
    adminPushLog,
    adminOutbox,
    adminPushDevices,
    adminTestNotification,
    adminPublicationRun,
  };
}

function newsCategoryKey(ctx: PTx) {
  return ctx.db.newsSettings.id.find(0)?.notifyCategoryKey ?? 'news';
}
