import { t } from 'spacetimedb/server';
import { bytesToHex } from '@noble/hashes/utils.js';
import { baseRows, type BaseSchema } from './schema';
import { sendSms, type SmsProviderRow } from './sms';
import { checkAccountGuards, profileValidators } from './hooks';
import {
  addSeconds,
  dayKey,
  digitsFrom,
  fail,
  micros,
  normalizePhone,
  requireAccount,
  sessionAccount,
  settingsOf,
  sign,
  signHex,
  toLatinDigits,
  translate,
  type Tx,
} from './util';

const RequestOtpResult = t.object('RequestOtpResult', {
  phone: t.string(),
  codeLength: t.u8(),
  expiresInSec: t.u32(),
  retryAfterSec: t.u32(),
});

const VerifyOtpResult = t.object('VerifyOtpResult', {
  ok: t.bool(),
  error: t.string(),
  accountId: t.u64(),
  isNew: t.bool(),
  attemptsLeft: t.u32(),
  role: t.string(),
  detail: t.string(),
});

function hashCode(secret: string, phone: string, code: string) {
  return signHex(secret, `otp-hash|${phone}|${code}`);
}

function ensureBootstrapOwner(ctx: Tx, accountId: bigint, phone: string) {
  const list = (ctx.env.ADMIN_PHONES ?? '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(p => {
      try {
        return normalizePhone(p);
      } catch {
        return '';
      }
    });
  if (!list.includes(phone)) return;
  const existing = ctx.db.admin.accountId.find(accountId);
  if (existing?.role === 'owner') return;
  const row = { accountId, role: 'owner', createdAt: ctx.timestamp, createdBy: 0n };
  if (existing) ctx.db.admin.accountId.update(row);
  else ctx.db.admin.insert(row);
}

export function defineAuth(st: BaseSchema) {
  const requestOtp = st.procedure({ phone: t.string() }, RequestOtpResult, (ctx, { phone: raw }) => {
    const phone = normalizePhone(raw);
    const secret = ctx.env.OTP_SECRET;
    const salt = bytesToHex(ctx.random.fill(new Uint8Array(16)));
    const sender = ctx.sender.toHexString();

    const plan = ctx.withTx(tx => {
      const s = settingsOf(tx);
      const now = tx.timestamp;
      const acc = tx.db.account.phone.find(phone);
      if (acc && acc.status !== 'active') fail('ACCOUNT_BLOCKED');
      if (acc) {
        const g = checkAccountGuards(tx, acc.id);
        if (g) fail(g.code);
      }
      const existing = tx.db.otp.phone.find(phone);
      const wait = BigInt(s.otpResendSec) * 1_000_000n;
      if (existing && micros(now) - micros(existing.sentAt) < wait) {
        const left = (wait - (micros(now) - micros(existing.sentAt))) / 1_000_000n + 1n;
        fail(`RETRY_LATER:${left}`);
      }
      const test = tx.db.testPhone.phone.find(phone);
      const provider = [...tx.db.smsProvider.iter()].find(p => p.isActive);
      if (!test && !provider) fail('SMS_NOT_CONFIGURED');
      const key = `${phone}|${dayKey(now)}`;
      const daily = tx.db.otpDaily.key.find(key);
      if (!test && daily && daily.count >= s.otpDailyCap) fail('DAILY_LIMIT');
      const code = test ? test.code : digitsFrom(sign(secret, `otp-code|${phone}|${micros(now)}|${sender}|${salt}`), s.otpLength);
      const row = {
        phone,
        codeHash: hashCode(secret, phone, code),
        sentAt: now,
        expiresAt: addSeconds(now, s.otpTtlSec),
        attempts: 0,
      };
      if (existing) tx.db.otp.phone.update(row);
      else tx.db.otp.insert(row);
      if (!test) {
        if (daily) tx.db.otpDaily.key.update({ key, count: daily.count + 1 });
        else tx.db.otpDaily.insert({ key, count: 1 });
      }
      const brand = tx.db.brand.id.find(0);
      const brandName = brand ? translate(brand.name, s.defaultLang, s.defaultLang) : '';
      const text = brandName ? `کد ورود ${brandName}: ${code}` : `کد ورود: ${code}`;
      if (!test && provider!.kind === 'sandbox') {
        tx.db.sandboxSms.insert({ id: 0n, phone, text, at: now });
      }
      return {
        code,
        text,
        key,
        isTest: !!test,
        provider: provider ? ({ ...provider } as SmsProviderRow) : undefined,
        result: {
          phone,
          codeLength: code.length,
          expiresInSec: s.otpTtlSec,
          retryAfterSec: s.otpResendSec,
        },
      };
    });

    if (!plan.isTest && plan.provider) {
      try {
        sendSms(ctx, plan.provider, phone, plan.code, plan.text);
      } catch (e) {
        ctx.withTx(tx => {
          tx.db.otp.phone.delete(phone);
          const d = tx.db.otpDaily.key.find(plan.key);
          if (d && d.count > 0) tx.db.otpDaily.key.update({ key: plan.key, count: d.count - 1 });
        });
        throw e;
      }
    }
    return plan.result;
  });

  const verifyOtp = st.procedure({ phone: t.string(), code: t.string() }, VerifyOtpResult, (ctx, { phone: raw, code: rawCode }) => {
    const phone = normalizePhone(raw);
    const code = toLatinDigits(rawCode).trim();
    const secret = ctx.env.OTP_SECRET;
    return ctx.withTx(tx => {
      const s = settingsOf(tx);
      const res = (error: string, attemptsLeft = 0, detail = '') => ({ ok: false, error, accountId: 0n, isNew: false, attemptsLeft, role: '', detail });
      const row = tx.db.otp.phone.find(phone);
      if (!row) return res('NO_CODE');
      if (micros(tx.timestamp) > micros(row.expiresAt)) {
        tx.db.otp.phone.delete(phone);
        return res('EXPIRED');
      }
      if (hashCode(secret, phone, code) !== row.codeHash) {
        const attempts = row.attempts + 1;
        if (attempts >= s.otpMaxAttempts) {
          tx.db.otp.phone.delete(phone);
          return res('TOO_MANY_ATTEMPTS');
        }
        tx.db.otp.phone.update({ ...row, attempts });
        return res('WRONG_CODE', s.otpMaxAttempts - attempts);
      }
      tx.db.otp.phone.delete(phone);
      let acc = tx.db.account.phone.find(phone);
      const isNew = !acc;
      if (acc && acc.status !== 'active') return res('ACCOUNT_BLOCKED');
      if (acc) {
        const g = checkAccountGuards(tx, acc.id);
        if (g) return res(g.code, 0, g.detail);
      }
      if (!acc) {
        acc = tx.db.account.insert({
          id: 0n,
          phone,
          displayName: '',
          lang: s.defaultLang,
          status: 'active',
          createdAt: tx.timestamp,
          lastLoginAt: tx.timestamp,
        });
      } else {
        acc = tx.db.account.id.update({ ...acc, lastLoginAt: tx.timestamp });
      }
      const sessionRow = { identity: tx.sender, accountId: acc.id, createdAt: tx.timestamp };
      if (tx.db.session.identity.find(tx.sender)) tx.db.session.identity.update(sessionRow);
      else tx.db.session.insert(sessionRow);
      ensureBootstrapOwner(tx, acc.id, phone);
      return { ok: true, error: '', accountId: acc.id, isNew, attemptsLeft: 0, role: tx.db.admin.accountId.find(acc.id)?.role ?? '', detail: '' };
    });
  });

  const logout = st.reducer(ctx => {
    ctx.db.session.identity.delete(ctx.sender);
  });

  const updateProfile = st.reducer({ displayName: t.string(), lang: t.string() }, (ctx, { displayName, lang }) => {
    const acc = requireAccount(ctx);
    const name = displayName.trim().replace(/\s+/g, ' ');
    if ([...name].length > 64) fail('DISPLAY_NAME_TOO_LONG');
    for (const v of profileValidators) v(ctx, acc.id, name);
    const l = ctx.db.language.code.find(lang);
    if (!l || !l.isActive) fail('UNKNOWN_LANGUAGE');
    ctx.db.account.id.update({ ...acc, displayName: name, lang });
  });

  const me = st.view({ name: 'me', public: true }, t.option(baseRows.account), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return undefined;
    return ctx.db.account.id.find(s.accountId) ?? undefined;
  });

  const myRole = st.view({ name: 'my_role', public: true }, t.option(baseRows.admin), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return undefined;
    const a = ctx.db.account.id.find(s.accountId);
    if (!a || a.status !== 'active') return undefined;
    return ctx.db.admin.accountId.find(a.id) ?? undefined;
  });

  return { requestOtp, verifyOtp, logout, updateProfile, me, myRole };
}

export { sessionAccount };
