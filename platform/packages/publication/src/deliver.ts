import { TimeDuration } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { fail, sendSms, type Tr } from '@stg/base';
import { htmlToText } from './html';
import { parsePrivateKey, signJwt } from './rsa';
import { MIN_US, fillVars, isPlayer, langOf, mask, nowUs, pick, pubSettings, tehranDay, type PDb, type PProc, type PTx } from './engine';

export type Message = {
  kind: string;
  categoryKey: string;
  channels: string[];
  title: Tr[];
  body: Tr[];
  imageUrl?: string;
  actionType?: string;
  actionValue?: string;
  actionLabel?: Tr[];
  prizeId?: bigint;
  campaignId?: bigint;
  ruleId?: bigint;
  newsId?: bigint;
  vars?: Record<string, string>;
  capped?: boolean;
  ignorePrefs?: boolean;
};

export type Delivered = { status: string; reason: string; channels: string[]; inboxId: bigint };

export function prefEnabled(ctx: PDb, accountId: bigint, cat: { key: string; mandatory: boolean; defaultOn: boolean }, channel: string) {
  if (cat.mandatory) return true;
  const p = ctx.db.notifyPref.key.find(`${accountId}|${cat.key}|${channel}`);
  return p ? p.enabled : cat.defaultOn;
}

export function capCount(ctx: PDb, accountId: bigint, day: number, days: number) {
  let n = 0;
  for (let d = day - days + 1; d <= day; d++) n += ctx.db.notifyCap.key.find(`${accountId}|${d}`)?.count ?? 0;
  return n;
}

function overCap(ctx: PTx, accountId: bigint, now: bigint) {
  const s = pubSettings(ctx);
  const day = tehranDay(now);
  if (s.capPerDay && capCount(ctx, accountId, day, 1) >= s.capPerDay) return true;
  if (s.capPerWeek && capCount(ctx, accountId, day, 7) >= s.capPerWeek) return true;
  return false;
}

function bumpCap(ctx: PTx, accountId: bigint, now: bigint) {
  const day = tehranDay(now);
  const key = `${accountId}|${day}`;
  const r = ctx.db.notifyCap.key.find(key);
  if (r) ctx.db.notifyCap.key.update({ ...r, count: r.count + 1 });
  else ctx.db.notifyCap.insert({ key, accountId, day, count: 1 });
}

export function activeDevices(ctx: PDb, accountId: bigint) {
  return [...ctx.db.pushDevice.accountId.filter(accountId)].filter(d => d.isActive);
}

export function smsProvider(ctx: PDb) {
  return [...ctx.db.smsProvider.iter()].find(p => p.isActive);
}

function trimInbox(ctx: PTx, accountId: bigint) {
  const max = pubSettings(ctx).inboxMaxPerPlayer;
  if (!max) return;
  const rows = [...ctx.db.inbox.accountId.filter(accountId)];
  if (rows.length <= max) return;
  const removable = rows.filter(r => !r.prizeId || r.claimedAt).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const r of removable.slice(0, rows.length - max)) ctx.db.inbox.id.delete(r.id);
}

export function deliver(ctx: PTx, accountId: bigint, m: Message): Delivered {
  const skip = (reason: string): Delivered => ({ status: 'skipped', reason, channels: [], inboxId: 0n });
  const a = ctx.db.account.id.find(accountId);
  if (!isPlayer(a)) return skip('not_player');
  const cat = ctx.db.notifyCategory.key.find(m.categoryKey);
  if (!cat || !cat.isActive) return skip('category_off');
  const now = nowUs(ctx);
  const channels = m.channels.filter(ch => m.ignorePrefs || prefEnabled(ctx, accountId, cat, ch));
  if (!channels.length) return skip('opted_out');
  if (m.capped && !cat.mandatory && overCap(ctx, accountId, now)) return skip('cap');
  const vars = { player: a!.displayName || `#${accountId}`, ...(m.vars ?? {}) };
  const title = fillVars(m.title, vars);
  const body = fillVars(m.body, vars);
  const done: string[] = [];
  let inboxId = 0n;
  if (channels.includes('inbox')) {
    const row = ctx.db.inbox.insert({
      id: 0n,
      accountId,
      kind: m.kind,
      campaignId: m.campaignId ?? 0n,
      ruleId: m.ruleId ?? 0n,
      newsId: m.newsId ?? 0n,
      categoryKey: cat.key,
      title,
      body,
      imageUrl: m.imageUrl ?? '',
      actionType: m.actionType || 'none',
      actionValue: m.actionValue ?? '',
      actionLabel: m.actionLabel ?? [],
      prizeId: m.prizeId ?? 0n,
      claimedAt: 0n,
      rewards: '',
      read: false,
      readAt: 0n,
      at: now,
      createdAt: ctx.timestamp,
    });
    inboxId = row.id;
    done.push('inbox');
    trimInbox(ctx, accountId);
  }
  const lang = langOf(ctx, accountId);
  const titleText = pick(title, lang, ctx);
  const bodyText = htmlToText(pick(body, lang, ctx));
  const out = (channel: string, text: string) =>
    ctx.db.outbox.insert({
      id: 0n,
      accountId,
      channel,
      kind: m.kind,
      inboxId,
      campaignId: m.campaignId ?? 0n,
      ruleId: m.ruleId ?? 0n,
      categoryKey: cat.key,
      lang,
      title: titleText,
      body: text,
      imageUrl: /^https:\/\//.test(m.imageUrl ?? '') ? m.imageUrl! : '',
      data: JSON.stringify({ inboxId: String(inboxId), category: cat.key, actionType: m.actionType || 'none', actionValue: m.actionValue ?? '', lang }),
      status: 'pending',
      attempts: 0,
      nextAt: 0n,
      devices: 0,
      sent: 0,
      error: '',
      createdAt: ctx.timestamp,
      doneAt: 0n,
    });
  if (channels.includes('push') && activeDevices(ctx, accountId).length) {
    out('push', bodyText);
    done.push('push');
  }
  if (channels.includes('sms') && /^09\d{9}$/.test(a!.phone) && smsProvider(ctx)) {
    const max = pubSettings(ctx).smsMaxChars || 600;
    out('sms', `${titleText}\n${bodyText}`.trim().slice(0, max));
    done.push('sms');
  }
  if (!done.length) return skip(channels.includes('push') ? 'no_device' : 'no_address');
  if (m.capped && !cat.mandatory) bumpCap(ctx, accountId, now);
  return { status: 'sent', reason: '', channels: done, inboxId };
}

export function sendNotification(raw: unknown, accountId: bigint, m: Partial<Message> & { categoryKey: string; title: Tr[]; body: Tr[] }) {
  const ctx = raw as PTx;
  const cat = ctx.db.notifyCategory.key.find(m.categoryKey);
  if (!cat) fail('CATEGORY_NOT_FOUND');
  return deliver(ctx, accountId, { kind: 'direct', channels: ['inbox'], ...m });
}

type PushResult = { deviceId: bigint; token: string; status: string; error: string };
type Work = {
  id: bigint;
  channel: string;
  accountId: bigint;
  campaignId: bigint;
  title: string;
  body: string;
  imageUrl: string;
  data: string;
  attempts: number;
  phone: string;
  devices: { id: bigint; token: string }[];
};

export function serviceKeyHash(cfg: { privateKey: string; clientEmail: string }) {
  return bytesToHex(sha256(utf8ToBytes(`${cfg.clientEmail}|${cfg.privateKey}`))).slice(0, 32);
}

export function fcmJwt(cfg: { clientEmail: string; privateKey: string; privateKeyId: string }, iat: number) {
  return signJwt(
    cfg.privateKey,
    cfg.privateKeyId ? { alg: 'RS256', typ: 'JWT', kid: cfg.privateKeyId } : { alg: 'RS256', typ: 'JWT' },
    { iss: cfg.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }
  );
}

export function checkServiceAccount(json: string) {
  let sa: Record<string, unknown>;
  try {
    sa = JSON.parse(json);
  } catch {
    fail('INVALID_SERVICE_ACCOUNT');
  }
  if (!sa || sa.type !== 'service_account' || typeof sa.project_id !== 'string' || !sa.project_id || typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') fail('INVALID_SERVICE_ACCOUNT');
  try {
    parsePrivateKey(sa.private_key as string);
  } catch {
    fail('INVALID_SERVICE_ACCOUNT');
  }
  return { projectId: sa.project_id as string, clientEmail: sa.client_email as string, privateKey: sa.private_key as string, privateKeyId: typeof sa.private_key_id === 'string' ? sa.private_key_id : '' };
}

function accessToken(ctx: PProc, cfg: { clientEmail: string; privateKey: string; privateKeyId: string }, force: boolean) {
  const keyHash = serviceKeyHash(cfg);
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const cached = ctx.withTx(tx => tx.db.pushToken.id.find(0));
  if (!force && cached && cached.keyHash === keyHash && cached.expiresAt > now + 60_000_000n) return cached.accessToken;
  const jwt = fcmJwt(cfg, Number(now / 1_000_000n));
  const res = ctx.http.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
    timeout: TimeDuration.fromMillis(8000),
  });
  let j: { access_token?: string; expires_in?: number } = {};
  try {
    j = JSON.parse(res.text());
  } catch {}
  if (res.status !== 200 || !j.access_token) {
    console.error(`push fcm auth http=${res.status}`);
    fail('PUSH_AUTH_FAILED');
  }
  const expiresAt = now + BigInt(Math.max(Number(j.expires_in ?? 3600), 120)) * 1_000_000n;
  ctx.withTx(tx => {
    const row = { id: 0, keyHash, accessToken: j.access_token!, expiresAt };
    if (tx.db.pushToken.id.find(0)) tx.db.pushToken.id.update(row);
    else tx.db.pushToken.insert(row);
  });
  return j.access_token!;
}

function fcmSend(ctx: PProc, cfg: { projectId: string; clientEmail: string; privateKey: string; privateKeyId: string }, w: Work, token: string): PushResult['status'] | string {
  const data: Record<string, string> = JSON.parse(w.data);
  const msg: Record<string, unknown> = {
    token,
    notification: { title: w.title, body: w.body, ...(w.imageUrl ? { image: w.imageUrl } : {}) },
    data,
    android: { priority: 'HIGH' },
    apns: { payload: { aps: { 'mutable-content': 1 } }, ...(w.imageUrl ? { fcm_options: { image: w.imageUrl } } : {}) },
  };
  if (data.actionType === 'url') msg.webpush = { fcm_options: { link: data.actionValue } };
  const body = JSON.stringify({ message: msg });
  for (let i = 0; i < 2; i++) {
    const at = accessToken(ctx, cfg, i > 0);
    const res = ctx.http.fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${at}` },
      body,
      timeout: TimeDuration.fromMillis(8000),
    });
    if (res.status === 200) return 'sent';
    if (res.status === 401 && i === 0) continue;
    const text = res.text();
    if (res.status === 404 || /UNREGISTERED|SENDER_ID_MISMATCH/.test(text) || (res.status === 400 && /registration token|INVALID_ARGUMENT/.test(text) && /token/i.test(text))) return 'dead';
    return `failed:HTTP_${res.status}`;
  }
  return 'failed:PUSH_AUTH_FAILED';
}

export function runOutbox(ctx: PProc, limit: number) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const plan = ctx.withTx(tx => {
    const pending = [...tx.db.outbox.status.filter('pending'), ...[...tx.db.outbox.status.filter('sending')].filter(r => r.nextAt < now)]
      .filter(r => r.nextAt <= now)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, limit);
    const cfg = tx.db.pushConfig.id.find(0);
    const sms = smsProvider(tx);
    const work: Work[] = [];
    for (const r of pending) {
      tx.db.outbox.id.update({ ...r, status: 'sending', attempts: r.attempts + 1, nextAt: now + 2n * MIN_US });
      const done = new Set([...tx.db.pushLog.outboxId.filter(r.id)].filter(l => l.status === 'sent').map(l => l.deviceId));
      work.push({
        id: r.id,
        channel: r.channel,
        accountId: r.accountId,
        campaignId: r.campaignId,
        title: r.title,
        body: r.body,
        imageUrl: r.imageUrl,
        data: r.data,
        attempts: r.attempts + 1,
        phone: tx.db.account.id.find(r.accountId)?.phone ?? '',
        devices: r.channel === 'push' ? activeDevices(tx, r.accountId).filter(d => !done.has(d.id)).map(d => ({ id: d.id, token: d.token })) : [],
      });
    }
    return { work, cfg: cfg ? { ...cfg } : undefined, sms: sms ? { ...sms } : undefined, retries: pubSettings(tx).pushRetries };
  });
  if (!plan.work.length) return 0;
  const results: { w: Work; push: PushResult[]; smsOk: boolean; smsSandbox: string; error: string }[] = [];
  for (const w of plan.work) {
    const r = { w, push: [] as PushResult[], smsOk: false, smsSandbox: '', error: '' };
    if (w.channel === 'push') {
      const provider = plan.cfg?.provider ?? 'log';
      for (const d of w.devices) {
        let status = 'sent';
        let error = '';
        if (provider === 'log') {
          if (d.token.startsWith('sandbox-dead')) status = 'dead';
          else if (d.token.startsWith('sandbox-fail')) {
            status = 'failed';
            error = 'SANDBOX_FAIL';
          }
          console.info(`PUSH_SANDBOX token=${mask(d.token)} status=${status} title=${w.title.slice(0, 80)}`);
        } else if (!plan.cfg || !plan.cfg.privateKey) {
          status = 'failed';
          error = 'PUSH_NOT_CONFIGURED';
        } else {
          try {
            const s = fcmSend(ctx, plan.cfg, w, d.token);
            if (s.startsWith('failed:')) {
              status = 'failed';
              error = s.slice(7);
            } else status = s;
          } catch (e) {
            status = 'failed';
            error = e instanceof SenderError ? e.message : 'PUSH_REQUEST_FAILED';
          }
        }
        r.push.push({ deviceId: d.id, token: d.token, status, error });
      }
    } else if (w.channel === 'sms') {
      if (!plan.sms) r.error = 'SMS_NOT_CONFIGURED';
      else {
        try {
          const res = sendSms(ctx, plan.sms, w.phone, null, w.body);
          r.smsOk = true;
          r.smsSandbox = res.mode === 'sandbox' ? w.body : '';
        } catch (e) {
          r.error = e instanceof SenderError ? e.message : 'SMS_FAILED';
        }
      }
    }
    results.push(r);
  }
  ctx.withTx(tx => {
    const provider = plan.cfg?.provider ?? 'log';
    for (const r of results) {
      const row = tx.db.outbox.id.find(r.w.id);
      if (!row) continue;
      let status = 'sent';
      let error = r.error;
      let sent = row.sent;
      let pushSent = 0;
      let pushFailed = 0;
      if (r.w.channel === 'push') {
        let transient = false;
        for (const p of r.push) {
          tx.db.pushLog.insert({ id: 0n, outboxId: row.id, deviceId: p.deviceId, accountId: row.accountId, provider, token: mask(p.token), title: row.title, body: row.body, status: p.status, error: p.error, at: tx.timestamp });
          const d = tx.db.pushDevice.id.find(p.deviceId);
          if (p.status === 'sent') {
            pushSent++;
            if (d && d.failCount) tx.db.pushDevice.id.update({ ...d, failCount: 0, lastError: '' });
          } else {
            pushFailed++;
            if (p.status === 'dead') {
              if (d) tx.db.pushDevice.id.delete(d.id);
            } else {
              transient = true;
              if (d) tx.db.pushDevice.id.update({ ...d, failCount: d.failCount + 1, lastError: p.error, isActive: d.failCount + 1 < 5 });
            }
          }
        }
        sent += pushSent;
        if (!sent) {
          status = transient && r.w.attempts < plan.retries ? 'pending' : 'failed';
          error = error || (r.push.length ? r.push[r.push.length - 1].error || 'DEVICE_DEAD' : 'NO_DEVICE');
        } else if (transient && r.w.attempts < plan.retries) status = 'pending';
      } else {
        if (r.smsOk) {
          sent = 1;
          if (r.smsSandbox) tx.db.sandboxSms.insert({ id: 0n, phone: r.w.phone, text: r.smsSandbox, at: tx.timestamp });
        } else status = r.w.attempts < plan.retries ? 'pending' : 'failed';
      }
      const backoff = BigInt(r.w.attempts) * MIN_US;
      tx.db.outbox.id.update({ ...row, status, error, sent, devices: row.devices + r.push.length, nextAt: status === 'pending' ? now + backoff : 0n, doneAt: status === 'pending' ? 0n : now });
      if (row.campaignId) {
        const c = tx.db.campaign.id.find(row.campaignId);
        if (c) tx.db.campaign.id.update({ ...c, pushSent: c.pushSent + pushSent, pushFailed: c.pushFailed + pushFailed, smsSent: c.smsSent + (r.w.channel === 'sms' && r.smsOk ? 1 : 0) });
      }
    }
  });
  return results.length;
}
