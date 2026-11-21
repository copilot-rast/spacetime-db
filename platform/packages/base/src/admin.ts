import { t } from 'spacetimedb/server';
import { bytesToHex } from '@noble/hashes/utils.js';
import { baseRows, Translations, ROLES, type BaseSchema } from './schema';
import { sendSms, SMS_KINDS, type SmsProviderRow } from './sms';
import {
  adminOrNull,
  audit,
  cleanKey,
  cleanTranslations,
  dayKey,
  digitsFrom,
  fail,
  hasRole,
  maskSecret,
  normalizePhone,
  requireRole,
  roleOf,
  settingsOf,
  sign,
  toLatinDigits,
  type Tr,
  type Tx,
} from './util';

const SmsProviderView = t.row('SmsProviderView', {
  id: t.u64().primaryKey(),
  kind: t.string(),
  name: t.string(),
  isActive: t.bool(),
  hasKey: t.bool(),
  apiKeyMasked: t.string(),
  sender: t.string(),
  otpTemplate: t.string(),
  otpCodeVar: t.string(),
  updatedAt: t.timestamp(),
});

const AdminView = t.row('AdminView', {
  accountId: t.u64().primaryKey(),
  phone: t.string(),
  displayName: t.string(),
  role: t.string(),
  createdAt: t.timestamp(),
});

const AccountListRow = t.object('AccountListRow', {
  id: t.u64(),
  phone: t.string(),
  displayName: t.string(),
  lang: t.string(),
  status: t.string(),
  role: t.string(),
  createdAt: t.timestamp(),
  lastLoginAt: t.timestamp(),
});

const AccountPage = t.object('AccountPage', { total: t.u32(), rows: t.array(AccountListRow) });

const AuditListRow = t.object('AuditListRow', {
  id: t.u64(),
  accountId: t.u64(),
  phone: t.string(),
  action: t.string(),
  target: t.string(),
  detail: t.string(),
  at: t.timestamp(),
});

const AuditPage = t.object('AuditPage', { total: t.u32(), rows: t.array(AuditListRow) });

const Dashboard = t.object('BaseDashboard', {
  accounts: t.u32(),
  newToday: t.u32(),
  activeToday: t.u32(),
  blocked: t.u32(),
  admins: t.u32(),
  sessions: t.u32(),
  languages: t.u32(),
  categories: t.u32(),
  tags: t.u32(),
  smsKind: t.string(),
  setupDone: t.bool(),
});

const TestSmsResult = t.object('TestSmsResult', { mode: t.string(), code: t.string() });

function cleanText(s: string, max = 200) {
  return s.trim().slice(0, max);
}

function cleanUrl(s: string) {
  const v = s.trim();
  if (v && !/^(https?:\/\/|\/)/.test(v)) fail('INVALID_URL');
  return v.slice(0, 500);
}

function cleanColor(s: string) {
  const v = s.trim();
  if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) fail('INVALID_COLOR');
  return v;
}

function page(p: number, size: number) {
  const pageSize = Math.min(Math.max(size || 20, 1), 100);
  const pageNo = Math.max(p || 1, 1);
  return { start: (pageNo - 1) * pageSize, pageSize };
}

function keyTypeAllowed(ctx: Tx, key: string, kind: 'category' | 'tag') {
  const kt = ctx.db.keyType.key.find(key);
  if (!kt) fail('UNKNOWN_KEY_TYPE');
  if (kind === 'category' ? !kt.forCategory : !kt.forTag) fail('KEY_TYPE_NOT_ALLOWED');
}

export function defineAdmin(st: BaseSchema) {
  const adminSettings = st.view({ name: 'admin_settings', public: true }, t.option(baseRows.settings), ctx =>
    adminOrNull(ctx as any) ? ctx.db.settings.id.find(0) ?? undefined : undefined
  );

  const adminSaveSettings = st.reducer(
    { otpLength: t.u8(), otpTtlSec: t.u32(), otpResendSec: t.u32(), otpMaxAttempts: t.u8(), otpDailyCap: t.u32() },
    (ctx, a) => {
      const me = requireRole(ctx, 'admin');
      if (a.otpLength < 4 || a.otpLength > 8) fail('INVALID_OTP_LENGTH');
      if (a.otpTtlSec < 30 || a.otpTtlSec > 900) fail('INVALID_OTP_TTL');
      if (a.otpResendSec < 10 || a.otpResendSec > 600) fail('INVALID_OTP_RESEND');
      if (a.otpMaxAttempts < 1 || a.otpMaxAttempts > 10) fail('INVALID_OTP_ATTEMPTS');
      if (a.otpDailyCap < 1 || a.otpDailyCap > 100) fail('INVALID_OTP_DAILY_CAP');
      ctx.db.settings.id.update({ ...settingsOf(ctx), ...a, updatedAt: ctx.timestamp });
      audit(ctx, me.id, 'settings.save', 'otp', JSON.stringify(a));
    }
  );

  const adminSaveLoginRules = st.reducer({ adminLoginMaxAttempts: t.u32(), adminLoginLockMinutes: t.u32() }, (ctx, a) => {
    const me = requireRole(ctx, 'owner');
    if (a.adminLoginMaxAttempts < 1 || a.adminLoginMaxAttempts > 50) fail('INVALID_RULE:adminLoginMaxAttempts');
    if (a.adminLoginLockMinutes < 1 || a.adminLoginLockMinutes > 24 * 60) fail('INVALID_RULE:adminLoginLockMinutes');
    ctx.db.settings.id.update({ ...settingsOf(ctx), ...a, updatedAt: ctx.timestamp });
    audit(ctx, me.id, 'settings.save', 'admin_login', JSON.stringify(a));
  });

  const adminClearLoginLocks = st.reducer(ctx => {
    const me = requireRole(ctx, 'owner');
    ctx.db.loginAttempt.clear();
    audit(ctx, me.id, 'admin_login.unlock', '');
  });

  const adminCompleteSetup = st.reducer({ done: t.bool() }, (ctx, { done }) => {
    const me = requireRole(ctx, 'admin');
    ctx.db.settings.id.update({ ...settingsOf(ctx), setupDone: done, updatedAt: ctx.timestamp });
    audit(ctx, me.id, 'setup.done', String(done));
  });

  const adminSaveBrand = st.reducer(
    {
      name: Translations,
      shortName: t.string(),
      logoUrl: t.string(),
      iconUrl: t.string(),
      primaryColor: t.string(),
      supportPhone: t.string(),
      supportEmail: t.string(),
      website: t.string(),
    },
    (ctx, a) => {
      const me = requireRole(ctx, 'admin');
      const email = a.supportEmail.trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('INVALID_EMAIL');
      ctx.db.brand.id.update({
        id: 0,
        name: cleanTranslations(a.name, ctx),
        shortName: cleanText(a.shortName, 40),
        logoUrl: cleanUrl(a.logoUrl),
        iconUrl: cleanUrl(a.iconUrl),
        primaryColor: cleanColor(a.primaryColor),
        supportPhone: cleanText(toLatinDigits(a.supportPhone), 30),
        supportEmail: email,
        website: cleanUrl(a.website),
        updatedAt: ctx.timestamp,
      });
      audit(ctx, me.id, 'brand.save', 'brand');
    }
  );

  const adminSmsProviders = st.view({ name: 'admin_sms_providers', public: true }, t.array(SmsProviderView), ctx => {
    if (!adminOrNull(ctx as any, 'admin')) return [];
    return [...ctx.db.smsProvider.iter()].map(p => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      isActive: p.isActive,
      hasKey: p.apiKey !== '',
      apiKeyMasked: maskSecret(p.apiKey),
      sender: p.sender,
      otpTemplate: p.otpTemplate,
      otpCodeVar: p.otpCodeVar,
      updatedAt: p.updatedAt,
    }));
  });

  const adminSaveSmsProvider = st.reducer(
    {
      id: t.u64(),
      kind: t.string(),
      name: t.string(),
      apiKey: t.string(),
      sender: t.string(),
      otpTemplate: t.string(),
      otpCodeVar: t.string(),
      isActive: t.bool(),
    },
    (ctx, a) => {
      const me = requireRole(ctx, 'admin');
      if (!(SMS_KINDS as readonly string[]).includes(a.kind)) fail('SMS_KIND_UNKNOWN');
      const name = cleanText(a.name, 60);
      if (!name) fail('NAME_REQUIRED');
      const old = a.id ? ctx.db.smsProvider.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const apiKey = a.apiKey.trim() || old?.apiKey || '';
      if (a.kind !== 'sandbox' && !apiKey) fail('API_KEY_REQUIRED');
      if (a.kind === 'smsir' && a.otpTemplate.trim() && !/^\d+$/.test(a.otpTemplate.trim())) fail('SMS_TEMPLATE_INVALID');
      if (a.isActive) {
        for (const p of ctx.db.smsProvider.iter()) {
          if (p.isActive && p.id !== a.id) ctx.db.smsProvider.id.update({ ...p, isActive: false });
        }
      }
      const row = {
        id: a.id,
        kind: a.kind,
        name,
        isActive: a.isActive,
        apiKey,
        sender: cleanText(a.sender, 40),
        otpTemplate: cleanText(a.otpTemplate, 60),
        otpCodeVar: cleanText(a.otpCodeVar, 30) || 'CODE',
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.smsProvider.id.update(row) : ctx.db.smsProvider.insert({ ...row, id: 0n });
      audit(ctx, me.id, old ? 'sms.update' : 'sms.create', String(saved.id), `${a.kind} active=${a.isActive}`);
    }
  );

  const adminDeleteSmsProvider = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(ctx, 'admin');
    const p = ctx.db.smsProvider.id.find(id);
    if (!p) fail('NOT_FOUND');
    if (p.isActive) fail('PROVIDER_ACTIVE');
    ctx.db.smsProvider.id.delete(id);
    audit(ctx, me.id, 'sms.delete', String(id));
  });

  const adminTestSms = st.procedure({ providerId: t.u64(), phone: t.string(), otp: t.bool() }, TestSmsResult, (ctx, a) => {
    const phone = normalizePhone(a.phone);
    const salt = bytesToHex(ctx.random.fill(new Uint8Array(16)));
    const plan = ctx.withTx(tx => {
      const me = requireRole(tx, 'admin');
      const p = tx.db.smsProvider.id.find(a.providerId);
      if (!p) fail('NOT_FOUND');
      const s = settingsOf(tx);
      const code = digitsFrom(sign(tx.env.OTP_SECRET, `test|${phone}|${salt}`), s.otpLength);
      const text = a.otp ? `کد آزمایشی: ${code}` : 'پیامک آزمایشی از پنل مدیریت';
      audit(tx, me.id, 'sms.test', String(p.id), phone);
      if (p.kind === 'sandbox') tx.db.sandboxSms.insert({ id: 0n, phone, text, at: tx.timestamp });
      return { provider: { ...p } as SmsProviderRow, code, text };
    });
    const r = sendSms(ctx, plan.provider, phone, a.otp ? plan.code : null, plan.text);
    return { mode: r.mode, code: a.otp ? plan.code : '' };
  });

  const adminTestPhones = st.view({ name: 'admin_test_phones', public: true }, t.array(baseRows.testPhone), ctx =>
    adminOrNull(ctx as any, 'admin') ? [...ctx.db.testPhone.iter()] : []
  );

  const adminSaveTestPhone = st.reducer({ phone: t.string(), code: t.string(), note: t.string() }, (ctx, a) => {
    const me = requireRole(ctx, 'admin');
    const phone = normalizePhone(a.phone);
    const code = toLatinDigits(a.code).trim();
    const s = settingsOf(ctx);
    if (!new RegExp(`^\\d{${s.otpLength}}$`).test(code)) fail('INVALID_CODE');
    const row = { phone, code, note: cleanText(a.note, 100) };
    if (ctx.db.testPhone.phone.find(phone)) ctx.db.testPhone.phone.update(row);
    else ctx.db.testPhone.insert(row);
    audit(ctx, me.id, 'test_phone.save', phone);
  });

  const adminDeleteTestPhone = st.reducer({ phone: t.string() }, (ctx, a) => {
    const me = requireRole(ctx, 'admin');
    const phone = normalizePhone(a.phone);
    if (!ctx.db.testPhone.phone.delete(phone)) fail('NOT_FOUND');
    audit(ctx, me.id, 'test_phone.delete', phone);
  });

  const adminSandboxSms = st.view({ name: 'admin_sandbox_sms', public: true }, t.array(baseRows.sandboxSms), ctx => {
    if (!adminOrNull(ctx as any, 'admin')) return [];
    return [...ctx.db.sandboxSms.iter()].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 50);
  });

  const adminClearSandboxSms = st.reducer(ctx => {
    const me = requireRole(ctx, 'admin');
    ctx.db.sandboxSms.clear();
    audit(ctx, me.id, 'sandbox_sms.clear', '');
  });

  const adminSaveLanguage = st.reducer(
    { code: t.string(), name: t.string(), dir: t.string(), isActive: t.bool(), sort: t.i32() },
    (ctx, a) => {
      const me = requireRole(ctx, 'admin');
      const code = a.code.trim();
      if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(code)) fail('INVALID_LANGUAGE_CODE');
      if (a.dir !== 'rtl' && a.dir !== 'ltr') fail('INVALID_DIR');
      const name = cleanText(a.name, 40);
      if (!name) fail('NAME_REQUIRED');
      const old = ctx.db.language.code.find(code);
      if (old?.isDefault && !a.isActive) fail('DEFAULT_LANGUAGE_INACTIVE');
      const row = { code, name, dir: a.dir, isActive: a.isActive, isDefault: old?.isDefault ?? false, sort: a.sort };
      if (old) ctx.db.language.code.update(row);
      else ctx.db.language.insert(row);
      audit(ctx, me.id, old ? 'language.update' : 'language.create', code);
    }
  );

  const adminSetDefaultLanguage = st.reducer({ code: t.string() }, (ctx, { code }) => {
    const me = requireRole(ctx, 'admin');
    const l = ctx.db.language.code.find(code);
    if (!l) fail('NOT_FOUND');
    if (!l.isActive) fail('LANGUAGE_INACTIVE');
    for (const x of ctx.db.language.iter()) {
      if (x.isDefault !== (x.code === code)) ctx.db.language.code.update({ ...x, isDefault: x.code === code });
    }
    ctx.db.settings.id.update({ ...settingsOf(ctx), defaultLang: code, updatedAt: ctx.timestamp });
    audit(ctx, me.id, 'language.default', code);
  });

  const adminDeleteLanguage = st.reducer({ code: t.string() }, (ctx, { code }) => {
    const me = requireRole(ctx, 'admin');
    const l = ctx.db.language.code.find(code);
    if (!l) fail('NOT_FOUND');
    if (l.isDefault) fail('DEFAULT_LANGUAGE');
    ctx.db.language.code.delete(code);
    audit(ctx, me.id, 'language.delete', code);
  });

  const adminSaveKeyType = st.reducer(
    { key: t.string(), title: Translations, forCategory: t.bool(), forTag: t.bool() },
    (ctx, a) => {
      const me = requireRole(ctx, 'admin');
      const key = cleanKey(a.key);
      if (!a.forCategory && !a.forTag) fail('KEY_TYPE_UNUSED');
      const old = ctx.db.keyType.key.find(key);
      const title = cleanTranslations(a.title as Tr[], ctx);
      if (old?.system) {
        ctx.db.keyType.key.update({ ...old, title });
      } else {
        const row = { key, title, forCategory: a.forCategory, forTag: a.forTag, system: false };
        if (old) ctx.db.keyType.key.update(row);
        else ctx.db.keyType.insert(row);
      }
      audit(ctx, me.id, old ? 'key_type.update' : 'key_type.create', key);
    }
  );

  const adminDeleteKeyType = st.reducer({ key: t.string() }, (ctx, { key }) => {
    const me = requireRole(ctx, 'admin');
    const kt = ctx.db.keyType.key.find(key);
    if (!kt) fail('NOT_FOUND');
    if (kt.system) fail('KEY_TYPE_SYSTEM');
    if ([...ctx.db.category.iter()].some(c => c.keyType === key) || [...ctx.db.tag.iter()].some(x => x.keyType === key)) fail('KEY_TYPE_IN_USE');
    ctx.db.keyType.key.delete(key);
    audit(ctx, me.id, 'key_type.delete', key);
  });

  const adminSaveCategory = st.reducer(
    {
      id: t.u64(),
      keyType: t.string(),
      key: t.string(),
      title: Translations,
      description: Translations,
      parentId: t.u64(),
      iconUrl: t.string(),
      sort: t.i32(),
      isActive: t.bool(),
    },
    (ctx, a) => {
      const me = requireRole(ctx, 'admin');
      keyTypeAllowed(ctx, a.keyType, 'category');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.category.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      for (const c of ctx.db.category.byTypeKey.filter([a.keyType, key])) {
        if (c.id !== a.id) fail('KEY_TAKEN');
      }
      if (a.parentId) {
        let cur = ctx.db.category.id.find(a.parentId);
        if (!cur) fail('PARENT_NOT_FOUND');
        if (cur.keyType !== a.keyType) fail('PARENT_KEY_TYPE');
        for (let depth = 0; cur; depth++) {
          if (cur.id === a.id || depth > 20) fail('PARENT_CYCLE');
          cur = cur.parentId ? ctx.db.category.id.find(cur.parentId) : null;
        }
      }
      const row = {
        id: a.id,
        keyType: a.keyType,
        key,
        title: cleanTranslations(a.title as Tr[], ctx),
        description: cleanTranslations(a.description as Tr[], ctx, false),
        parentId: a.parentId,
        iconUrl: cleanUrl(a.iconUrl),
        sort: a.sort,
        isActive: a.isActive,
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.category.id.update(row) : ctx.db.category.insert({ ...row, id: 0n });
      audit(ctx, me.id, old ? 'category.update' : 'category.create', String(saved.id), `${a.keyType}/${key}`);
    }
  );

  const adminDeleteCategory = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(ctx, 'admin');
    if (!ctx.db.category.id.find(id)) fail('NOT_FOUND');
    if ([...ctx.db.category.parentId.filter(id)].length) fail('CATEGORY_HAS_CHILDREN');
    ctx.db.category.id.delete(id);
    audit(ctx, me.id, 'category.delete', String(id));
  });

  const adminSaveTag = st.reducer(
    { id: t.u64(), keyType: t.string(), key: t.string(), title: Translations, color: t.string(), sort: t.i32(), isActive: t.bool() },
    (ctx, a) => {
      const me = requireRole(ctx, 'admin');
      keyTypeAllowed(ctx, a.keyType, 'tag');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.tag.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      for (const x of ctx.db.tag.byTypeKey.filter([a.keyType, key])) {
        if (x.id !== a.id) fail('KEY_TAKEN');
      }
      const row = {
        id: a.id,
        keyType: a.keyType,
        key,
        title: cleanTranslations(a.title as Tr[], ctx),
        color: cleanColor(a.color),
        sort: a.sort,
        isActive: a.isActive,
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.tag.id.update(row) : ctx.db.tag.insert({ ...row, id: 0n });
      audit(ctx, me.id, old ? 'tag.update' : 'tag.create', String(saved.id), `${a.keyType}/${key}`);
    }
  );

  const adminDeleteTag = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(ctx, 'admin');
    if (!ctx.db.tag.id.delete(id)) fail('NOT_FOUND');
    audit(ctx, me.id, 'tag.delete', String(id));
  });

  const adminAdmins = st.view({ name: 'admin_admins', public: true }, t.array(AdminView), ctx => {
    if (!adminOrNull(ctx as any)) return [];
    return [...ctx.db.admin.iter()].map(r => {
      const a = ctx.db.account.id.find(r.accountId);
      return { accountId: r.accountId, phone: a?.phone ?? '', displayName: a?.displayName ?? '', role: r.role, createdAt: r.createdAt };
    });
  });

  const adminSetAdmin = st.reducer({ phone: t.string(), role: t.string() }, (ctx, a) => {
    const me = requireRole(ctx, 'owner');
    if (!(ROLES as readonly string[]).includes(a.role)) fail('INVALID_ROLE');
    const phone = normalizePhone(a.phone);
    let acc = ctx.db.account.phone.find(phone);
    if (!acc) {
      acc = ctx.db.account.insert({
        id: 0n,
        phone,
        displayName: '',
        lang: settingsOf(ctx).defaultLang,
        status: 'active',
        createdAt: ctx.timestamp,
        lastLoginAt: ctx.timestamp,
      });
    }
    const old = ctx.db.admin.accountId.find(acc.id);
    if (old?.role === 'owner' && a.role !== 'owner') {
      const owners = [...ctx.db.admin.iter()].filter(x => x.role === 'owner').length;
      if (owners <= 1) fail('LAST_OWNER');
    }
    const row = { accountId: acc.id, role: a.role, createdAt: old?.createdAt ?? ctx.timestamp, createdBy: old?.createdBy ?? me.id };
    if (old) ctx.db.admin.accountId.update(row);
    else ctx.db.admin.insert(row);
    audit(ctx, me.id, 'admin.set', String(acc.id), `${phone} ${a.role}`);
  });

  const adminRemoveAdmin = st.reducer({ accountId: t.u64() }, (ctx, { accountId }) => {
    const me = requireRole(ctx, 'owner');
    const old = ctx.db.admin.accountId.find(accountId);
    if (!old) fail('NOT_FOUND');
    if (old.role === 'owner' && [...ctx.db.admin.iter()].filter(x => x.role === 'owner').length <= 1) fail('LAST_OWNER');
    ctx.db.admin.accountId.delete(accountId);
    audit(ctx, me.id, 'admin.remove', String(accountId));
  });

  const adminSetAccountStatus = st.reducer({ accountId: t.u64(), status: t.string() }, (ctx, a) => {
    const me = requireRole(ctx, 'admin');
    if (a.status !== 'active' && a.status !== 'blocked') fail('INVALID_STATUS');
    const acc = ctx.db.account.id.find(a.accountId);
    if (!acc) fail('NOT_FOUND');
    if (acc.id === me.id) fail('CANNOT_CHANGE_SELF');
    const targetRole = roleOf(ctx, acc.id);
    if (targetRole && !hasRole(roleOf(ctx, me.id), 'owner')) fail('FORBIDDEN');
    if (targetRole === 'owner') fail('CANNOT_BLOCK_OWNER');
    ctx.db.account.id.update({ ...acc, status: a.status });
    if (a.status === 'blocked') {
      for (const s of [...ctx.db.session.accountId.filter(acc.id)]) ctx.db.session.identity.delete(s.identity);
    }
    audit(ctx, me.id, 'account.status', String(acc.id), a.status);
  });

  const adminAccounts = st.procedure(
    { query: t.string(), status: t.string(), page: t.u32(), pageSize: t.u32() },
    AccountPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(tx, 'operator');
        const q = toLatinDigits(a.query).trim().toLowerCase();
        const list = [...tx.db.account.iter()]
          .filter(x => (!a.status || x.status === a.status) && (!q || x.phone.includes(q) || x.displayName.toLowerCase().includes(q) || String(x.id) === q))
          .sort((x, y) => (x.id < y.id ? 1 : -1));
        const { start, pageSize } = page(a.page, a.pageSize);
        return {
          total: list.length,
          rows: list.slice(start, start + pageSize).map(x => ({
            id: x.id,
            phone: x.phone,
            displayName: x.displayName,
            lang: x.lang,
            status: x.status,
            role: roleOf(tx, x.id) ?? '',
            createdAt: x.createdAt,
            lastLoginAt: x.lastLoginAt,
          })),
        };
      })
  );

  const adminAudit = st.procedure({ action: t.string(), page: t.u32(), pageSize: t.u32() }, AuditPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(tx, 'admin');
      const list = [...tx.db.audit.iter()]
        .filter(x => !a.action || x.action.startsWith(a.action))
        .sort((x, y) => (x.id < y.id ? 1 : -1));
      const { start, pageSize } = page(a.page, a.pageSize);
      return {
        total: list.length,
        rows: list.slice(start, start + pageSize).map(x => ({ ...x, phone: tx.db.account.id.find(x.accountId)?.phone ?? '' })),
      };
    })
  );

  const adminDashboard = st.procedure(Dashboard, ctx =>
    ctx.withTx(tx => {
      requireRole(tx, 'operator');
      const today = dayKey(tx.timestamp);
      let accounts = 0;
      let newToday = 0;
      let activeToday = 0;
      let blocked = 0;
      for (const a of tx.db.account.iter()) {
        accounts++;
        if (dayKey(a.createdAt) === today) newToday++;
        if (dayKey(a.lastLoginAt) === today) activeToday++;
        if (a.status === 'blocked') blocked++;
      }
      const provider = [...tx.db.smsProvider.iter()].find(p => p.isActive);
      return {
        accounts,
        newToday,
        activeToday,
        blocked,
        admins: Number(tx.db.admin.count()),
        sessions: Number(tx.db.session.count()),
        languages: [...tx.db.language.iter()].filter(l => l.isActive).length,
        categories: Number(tx.db.category.count()),
        tags: Number(tx.db.tag.count()),
        smsKind: provider?.kind ?? '',
        setupDone: settingsOf(tx).setupDone,
      };
    })
  );

  return {
    adminSettings,
    adminSaveSettings,
    adminSaveLoginRules,
    adminClearLoginLocks,
    adminCompleteSetup,
    adminSaveBrand,
    adminSmsProviders,
    adminSaveSmsProvider,
    adminDeleteSmsProvider,
    adminTestSms,
    adminTestPhones,
    adminSaveTestPhone,
    adminDeleteTestPhone,
    adminSandboxSms,
    adminClearSandboxSms,
    adminSaveLanguage,
    adminSetDefaultLanguage,
    adminDeleteLanguage,
    adminSaveKeyType,
    adminDeleteKeyType,
    adminSaveCategory,
    adminDeleteCategory,
    adminSaveTag,
    adminDeleteTag,
    adminAdmins,
    adminSetAdmin,
    adminRemoveAdmin,
    adminSetAccountStatus,
    adminAccounts,
    adminAudit,
    adminDashboard,
  };
}
