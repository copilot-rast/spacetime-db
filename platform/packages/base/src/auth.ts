import { t } from 'spacetimedb/server';
import { bytesToHex } from '@noble/hashes/utils.js';
import { baseRows, type BaseSchema } from './schema';
import { sendSms, type SmsProviderRow } from './sms';
import { checkAccountGuards, loginHooks, profileValidators } from './hooks';
import { verifyPassword } from './passwords';
import {
  addSeconds,
  dayKey,
  digitsFrom,
  fail,
  micros,
  normalizePhone,
  PANEL_PREFIX,
  isPanelAccount,
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

const AdminLoginResult = t.object('AdminLoginResult', {
  ok: t.bool(),
  error: t.string(),
  accountId: t.u64(),
  role: t.string(),
  retryAfterSec: t.u32(),
});

export function defineAuth(st: BaseSchema) {
  const adminLogin = st.procedure({ username: t.string(), password: t.string() }, AdminLoginResult, (ctx, a) =>
    ctx.withTx(tx => {
      const res = (error: string, retryAfterSec = 0) => ({ ok: false, error, accountId: 0n, role: '', retryAfterSec });
      const envUser = tx.env.ADMIN_USERNAME ?? '';
      const envPass = tx.env.ADMIN_PASSWORD ?? '';
      const envOn = !!envUser && envPass.length >= 8;
      const input = a.username.trim();
      const isEnv = envOn && input === envUser;
      const panelUser = isEnv ? undefined : tx.db.adminUser.username.find(input.toLowerCase());
      if (!envOn && tx.db.adminUser.count() === 0n) return res('PASSWORD_LOGIN_DISABLED');
      const s = settingsOf(tx);
      const now = micros(tx.timestamp);
      const window = BigInt(s.adminLoginLockMinutes) * 60_000_000n;
      const key = `admin|${isEnv ? envUser : input.toLowerCase()}`;
      const att = tx.db.loginAttempt.key.find(key);
      const fresh = att && now - micros(att.windowStart) < window ? att : undefined;
      if (fresh && fresh.failures >= s.adminLoginMaxAttempts) {
        return res('TOO_MANY_ATTEMPTS', Number((window - (now - micros(fresh.windowStart))) / 1_000_000n) + 1);
      }
      const secret = tx.env.OTP_SECRET;
      const same = (x: string, y: string) => signHex(secret, `admin-login|${x}`) === signHex(secret, `admin-login|${y}`);
      let ok = false;
      if (isEnv) ok = same(a.password, envPass);
      else if (panelUser && panelUser.isActive) ok = verifyPassword(panelUser.passwordHash, a.password);
      if (!ok) {
        const row = { key, failures: (fresh?.failures ?? 0) + 1, windowStart: fresh?.windowStart ?? tx.timestamp };
        if (att) tx.db.loginAttempt.key.update(row);
        else tx.db.loginAttempt.insert(row);
        return res('INVALID_CREDENTIALS');
      }
      if (att) tx.db.loginAttempt.key.delete(key);
      let acc;
      let isNew = false;
      if (isEnv) {
        const phone = `${PANEL_PREFIX}${envUser}`;
        acc = tx.db.account.phone.find(phone);
        isNew = !acc;
        if (!acc) acc = tx.db.account.insert({ id: 0n, phone, displayName: envUser, lang: s.defaultLang, status: 'active', createdAt: tx.timestamp, lastLoginAt: tx.timestamp });
        else acc = tx.db.account.id.update({ ...acc, status: 'active', lastLoginAt: tx.timestamp });
        const role = tx.db.admin.accountId.find(acc.id);
        if (role?.role !== 'owner') {
          const row = { accountId: acc.id, role: 'owner', createdAt: role?.createdAt ?? tx.timestamp, createdBy: 0n };
          if (role) tx.db.admin.accountId.update(row);
          else tx.db.admin.insert(row);
        }
      } else {
        acc = tx.db.account.id.find(panelUser!.accountId);
        if (!acc || acc.status !== 'active' || !tx.db.admin.accountId.find(acc.id)) return res('INVALID_CREDENTIALS');
        acc = tx.db.account.id.update({ ...acc, lastLoginAt: tx.timestamp });
        tx.db.adminUser.accountId.update({ ...panelUser!, lastLoginAt: tx.timestamp });
      }
      const sessionRow = { identity: tx.sender, accountId: acc.id, createdAt: tx.timestamp };
      if (tx.db.session.identity.find(tx.sender)) tx.db.session.identity.update(sessionRow);
      else tx.db.session.insert(sessionRow);
      for (const h of loginHooks) h(tx, acc.id, isNew);
      tx.db.audit.insert({ id: 0n, accountId: acc.id, action: 'admin.password_login', target: isEnv ? envUser : panelUser!.username, detail: '', at: tx.timestamp });
      return { ok: true, error: '', accountId: acc.id, role: tx.db.admin.accountId.find(acc.id)?.role ?? '', retryAfterSec: 0 };
    })
  );
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
      for (const h of loginHooks) h(tx, acc.id, isNew);
      return { ok: true, error: '', accountId: acc.id, isNew, attemptsLeft: 0, role: '', detail: '' };
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
    if (!isPanelAccount(a)) return undefined;
    return ctx.db.admin.accountId.find(a.id) ?? undefined;
  });

  return { adminLogin, requestOtp, verifyOtp, logout, updateProfile, me, myRole };
}

export { sessionAccount };
