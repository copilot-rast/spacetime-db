import { ADMIN_USER, ADMIN_PASSWORD, sql, check, connect, done, errorOf, lastSandboxCode, login, loginOwner, panelUser, tr, uniquePhone, waitFor } from './src/lib.ts';

async function main() {
  const anon = await connect();
  check('brand is public before login', [...anon.conn.db.brand.iter()].length === 1);
  check('languages are public', [...anon.conn.db.language.iter()].some(l => l.code === 'fa' && l.isDefault));
  check('admin views are empty for guests', [...anon.conn.db.adminSettings.iter()].length === 0 && [...anon.conn.db.adminSmsProviders.iter()].length === 0);
  check('guest cannot save brand', (await errorOf(anon.conn.reducers.adminSaveBrand({ name: tr('x'), shortName: '', logoUrl: '', iconUrl: '', primaryColor: '', supportPhone: '', supportEmail: '', website: '' }))).includes('NOT_LOGGED_IN'));

  sql('DELETE FROM base_login_attempt');
  const owner = await connect();
  const ownerLogin = await loginOwner(owner);
  check('env admin logs in as owner', ownerLogin.ok && ownerLogin.role === 'owner', ownerLogin);
  check('owner sees settings', await waitFor(() => [...owner.conn.db.adminSettings.iter()].length === 1));

  const pw = await connect();
  const bad = await pw.conn.procedures.adminLogin({ username: ADMIN_USER, password: 'wrong-password' });
  check('wrong admin password refused', !bad.ok && bad.error === 'INVALID_CREDENTIALS', bad);
  const badUser = await pw.conn.procedures.adminLogin({ username: 'root', password: ADMIN_PASSWORD });
  check('unknown username refused', !badUser.ok && badUser.error === 'INVALID_CREDENTIALS', badUser);
  let last = { ok: true, error: '', retryAfterSec: 0 };
  const max = [...owner.conn.db.adminSettings.iter()][0].adminLoginMaxAttempts;
  for (let i = 0; i < max + 1; i++) last = await pw.conn.procedures.adminLogin({ username: ADMIN_USER, password: `nope-${i}` });
  check('admin login locks after too many failures', !last.ok && last.error === 'TOO_MANY_ATTEMPTS' && last.retryAfterSec > 0, last);
  const locked = await pw.conn.procedures.adminLogin({ username: ADMIN_USER, password: ADMIN_PASSWORD });
  check('lock holds even for the right password', !locked.ok && locked.error === 'TOO_MANY_ATTEMPTS');
  check('guests cannot change login rules', (await errorOf(pw.conn.reducers.adminSaveLoginRules({ adminLoginMaxAttempts: 5, adminLoginLockMinutes: 15 }))).includes('NOT_LOGGED_IN'));
  check('an sms code cannot reach a panel account', (await errorOf(pw.conn.procedures.requestOtp({ phone: `admin:${ADMIN_USER}` }))).includes('INVALID_PHONE'));
  await owner.conn.reducers.adminClearLoginLocks({});
  const unlocked = await pw.conn.procedures.adminLogin({ username: ADMIN_USER, password: ADMIN_PASSWORD });
  check('owner unlock lets the admin in again', unlocked.ok && unlocked.accountId === ownerLogin.accountId, unlocked);
  await owner.conn.reducers.adminSaveLoginRules({ adminLoginMaxAttempts: 5, adminLoginLockMinutes: 1 });
  check('owner changes login rules', await waitFor(() => [...owner.conn.db.adminSettings.iter()][0]?.adminLoginLockMinutes === 1));
  await owner.conn.reducers.adminSaveLoginRules({ adminLoginMaxAttempts: 5, adminLoginLockMinutes: 15 });

  const oldOwnerPhone = await connect();
  const smsOwner = await login(oldOwnerPhone, '09120000001');
  check('a phone login never carries a role', smsOwner.role === '' && [...oldOwnerPhone.conn.db.myRole.iter()].length === 0);
  check('a phone login never reads admin views', [...oldOwnerPhone.conn.db.adminSettings.iter()].length === 0 && (await errorOf(oldOwnerPhone.conn.procedures.adminDashboard())).includes('FORBIDDEN'));

  const s0 = [...owner.conn.db.adminSettings.iter()][0];
  const b0 = [...owner.conn.db.brand.iter()][0];
  await owner.conn.reducers.adminSaveSettings({ otpLength: 6, otpTtlSec: 180, otpResendSec: 30, otpMaxAttempts: 3, otpDailyCap: 2 });
  check('settings save', await waitFor(() => [...owner.conn.db.adminSettings.iter()][0]?.otpLength === 6));
  check('bad settings are refused', (await errorOf(owner.conn.reducers.adminSaveSettings({ otpLength: 2, otpTtlSec: 180, otpResendSec: 30, otpMaxAttempts: 3, otpDailyCap: 2 }))).includes('INVALID_OTP_LENGTH'));

  const user = await connect();
  const userPhone = uniquePhone();
  await user.conn.procedures.requestOtp({ phone: userPhone });
  const code6 = lastSandboxCode(userPhone);
  check('new code length follows settings', code6.length === 6, code6);
  const wrong = await user.conn.procedures.verifyOtp({ phone: userPhone, code: code6 === '000000' ? '111111' : '000000' });
  check('attempts follow settings', !wrong.ok && wrong.attemptsLeft === 2, wrong);
  const ok = await user.conn.procedures.verifyOtp({ phone: userPhone, code: code6 });
  check('plain user logs in without a role', ok.ok && ok.isNew && ok.role === '', ok);
  await user.conn.procedures.requestOtp({ phone: userPhone });
  await user.conn.procedures.verifyOtp({ phone: userPhone, code: lastSandboxCode(userPhone) });
  check('daily cap stops the third code', (await errorOf(user.conn.procedures.requestOtp({ phone: userPhone }))).includes('DAILY_LIMIT'));
  check('plain user cannot read admin views', [...user.conn.db.adminSettings.iter()].length === 0 && [...user.conn.db.adminAdmins.iter()].length === 0);
  check('plain user cannot list accounts', (await errorOf(user.conn.procedures.adminAccounts({ query: '', status: '', page: 1, pageSize: 10 }))).includes('FORBIDDEN'));

  await user.conn.reducers.updateProfile({ displayName: 'بازیکن تست', lang: 'en' });
  check('profile update', await waitFor(() => [...user.conn.db.me.iter()][0]?.displayName === 'بازیکن تست' && [...user.conn.db.me.iter()][0]?.lang === 'en'));

  await owner.conn.reducers.adminSaveBrand({
    name: tr('متاهوم', 'Meta Home'),
    shortName: 'MH',
    logoUrl: 'https://example.com/logo.png',
    iconUrl: '',
    primaryColor: '#123abc',
    supportPhone: '۰۲۱۱۲۳۴۵۶۷۸',
    supportEmail: 'support@example.com',
    website: 'https://example.com',
  });
  check('brand reaches every client live', await waitFor(() => [...user.conn.db.brand.iter()][0]?.shortName === 'MH' && [...anon.conn.db.brand.iter()][0]?.supportPhone === '02112345678'));
  check('bad color is refused', (await errorOf(owner.conn.reducers.adminSaveBrand({ name: tr('x'), shortName: '', logoUrl: '', iconUrl: '', primaryColor: 'red', supportPhone: '', supportEmail: '', website: '' }))).includes('INVALID_COLOR'));
  check('unknown language in a title is refused', (await errorOf(owner.conn.reducers.adminSaveBrand({ name: [{ lang: 'zz', text: 'x' }], shortName: '', logoUrl: '', iconUrl: '', primaryColor: '', supportPhone: '', supportEmail: '', website: '' }))).includes('UNKNOWN_LANGUAGE'));

  await owner.conn.reducers.adminSaveLanguage({ code: 'ar', name: 'العربية', dir: 'rtl', isActive: true, sort: 2 });
  check('language add', await waitFor(() => [...anon.conn.db.language.iter()].some(l => l.code === 'ar')));
  await owner.conn.reducers.adminSetDefaultLanguage({ code: 'en' });
  check('default language switch', await waitFor(() => [...anon.conn.db.language.iter()].find(l => l.code === 'en')?.isDefault === true && [...owner.conn.db.adminSettings.iter()][0]?.defaultLang === 'en'));
  check('default language cannot be deleted', (await errorOf(owner.conn.reducers.adminDeleteLanguage({ code: 'en' }))).includes('DEFAULT_LANGUAGE'));
  await owner.conn.reducers.adminSetDefaultLanguage({ code: 'fa' });
  await owner.conn.reducers.adminDeleteLanguage({ code: 'ar' });
  check('language delete', await waitFor(() => ![...anon.conn.db.language.iter()].some(l => l.code === 'ar')));

  const kt = `kt${Date.now() % 100000}`;
  await owner.conn.reducers.adminSaveKeyType({ key: kt, title: tr('نوع تست'), forCategory: true, forTag: false });
  check('key type add', await waitFor(() => [...anon.conn.db.keyType.iter()].some(k => k.key === kt)));
  check('system key type cannot be deleted', (await errorOf(owner.conn.reducers.adminDeleteKeyType({ key: 'general' }))).includes('KEY_TYPE_SYSTEM'));
  check('tag on a category-only key type is refused', (await errorOf(owner.conn.reducers.adminSaveTag({ id: 0n, keyType: kt, key: 'x', title: tr('x'), color: '', sort: 0, isActive: true }))).includes('KEY_TYPE_NOT_ALLOWED'));

  await owner.conn.reducers.adminSaveCategory({ id: 0n, keyType: kt, key: 'parent', title: tr('والد', 'Parent'), description: [], parentId: 0n, iconUrl: '', sort: 0, isActive: true });
  check('category add', await waitFor(() => [...anon.conn.db.category.iter()].some(c => c.keyType === kt && c.key === 'parent')));
  const parent = [...anon.conn.db.category.iter()].find(c => c.keyType === kt && c.key === 'parent')!;
  await owner.conn.reducers.adminSaveCategory({ id: 0n, keyType: kt, key: 'child', title: tr('فرزند'), description: tr('توضیح'), parentId: parent.id, iconUrl: '', sort: 1, isActive: true });
  check('child category', await waitFor(() => [...anon.conn.db.category.iter()].some(c => c.key === 'child' && c.parentId === parent.id)));
  const child = [...anon.conn.db.category.iter()].find(c => c.keyType === kt && c.key === 'child')!;
  check('duplicate key is refused', (await errorOf(owner.conn.reducers.adminSaveCategory({ id: 0n, keyType: kt, key: 'parent', title: tr('x'), description: [], parentId: 0n, iconUrl: '', sort: 0, isActive: true }))).includes('KEY_TAKEN'));
  check('parent cycle is refused', (await errorOf(owner.conn.reducers.adminSaveCategory({ ...parent, parentId: child.id }))).includes('PARENT_CYCLE'));
  check('category with children cannot be deleted', (await errorOf(owner.conn.reducers.adminDeleteCategory({ id: parent.id }))).includes('CATEGORY_HAS_CHILDREN'));
  check('key type in use cannot be deleted', (await errorOf(owner.conn.reducers.adminDeleteKeyType({ key: kt }))).includes('KEY_TYPE_IN_USE'));
  await owner.conn.reducers.adminDeleteCategory({ id: child.id });
  await owner.conn.reducers.adminDeleteCategory({ id: parent.id });
  await owner.conn.reducers.adminDeleteKeyType({ key: kt });
  check('category and key type cleanup', await waitFor(() => ![...anon.conn.db.keyType.iter()].some(k => k.key === kt)));

  const tagKey = `vip${Date.now() % 100000}`;
  await owner.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key: tagKey, title: tr('ویژه', 'VIP'), color: '#ff8800', sort: 0, isActive: true });
  check('player tag add', await waitFor(() => [...anon.conn.db.tag.iter()].some(x => x.key === tagKey && x.color === '#ff8800')));
  const tagRow = [...anon.conn.db.tag.iter()].find(x => x.key === tagKey)!;
  await owner.conn.reducers.adminDeleteTag({ id: tagRow.id });
  check('tag delete', await waitFor(() => ![...anon.conn.db.tag.iter()].some(x => x.key === tagKey)));

  const fakeKey = 'abcd1234efgh5678ijkl';
  await owner.conn.reducers.adminSaveSmsProvider({ id: 0n, kind: 'kavenegar', name: `KN ${Date.now()}`, apiKey: fakeKey, sender: '', otpTemplate: 'login', otpCodeVar: '', isActive: false });
  check('provider key is masked', await waitFor(() => [...owner.conn.db.adminSmsProviders.iter()].some(p => p.kind === 'kavenegar' && p.apiKeyMasked === 'abcd••••ijkl' && p.hasKey)));
  check('provider rows never carry the key', ![...owner.conn.db.adminSmsProviders.iter()].some(p => JSON.stringify(p, (_k, v) => (typeof v === 'bigint' ? String(v) : v)).includes(fakeKey)));
  check('kavenegar without a key is refused', (await errorOf(owner.conn.reducers.adminSaveSmsProvider({ id: 0n, kind: 'kavenegar', name: 'x', apiKey: '', sender: '', otpTemplate: '', otpCodeVar: '', isActive: false }))).includes('API_KEY_REQUIRED'));
  const kn = [...owner.conn.db.adminSmsProviders.iter()].find(p => p.kind === 'kavenegar' && p.hasKey)!;
  await owner.conn.reducers.adminSaveSmsProvider({ id: kn.id, kind: 'kavenegar', name: kn.name, apiKey: '', sender: '', otpTemplate: 'login2', otpCodeVar: '', isActive: false });
  check('empty key on edit keeps the old key', await waitFor(() => [...owner.conn.db.adminSmsProviders.iter()].find(p => p.id === kn.id)?.otpTemplate === 'login2' && [...owner.conn.db.adminSmsProviders.iter()].find(p => p.id === kn.id)?.hasKey === true));
  const knTest = await errorOf(owner.conn.procedures.adminTestSms({ providerId: kn.id, phone: '09120000000', otp: true }));
  check('real kavenegar call with a fake key fails cleanly', knTest.includes('SMS_FAILED'), knTest);
  await owner.conn.reducers.adminDeleteSmsProvider({ id: kn.id });
  const sandbox = [...owner.conn.db.adminSmsProviders.iter()].find(p => p.kind === 'sandbox' && p.isActive)!;
  check('active provider cannot be deleted', (await errorOf(owner.conn.reducers.adminDeleteSmsProvider({ id: sandbox.id }))).includes('PROVIDER_ACTIVE'));
  const testSms = await owner.conn.procedures.adminTestSms({ providerId: sandbox.id, phone: '09121112233', otp: true });
  check('sandbox test sms', testSms.mode === 'sandbox' && testSms.code.length === 6, testSms);
  check('sandbox inbox shows it live', await waitFor(() => [...owner.conn.db.adminSandboxSms.iter()].some(x => x.phone === '09121112233' && x.text.includes(testSms.code))));

  const reviewer = uniquePhone('0990');
  await owner.conn.reducers.adminSaveTestPhone({ phone: reviewer, code: '۱۲۳۴۵۶', note: 'store reviewer' });
  const rc = await connect();
  await rc.conn.procedures.requestOtp({ phone: reviewer });
  const rv = await rc.conn.procedures.verifyOtp({ phone: reviewer, code: '123456' });
  check('test phone logs in with its fixed code', rv.ok, rv);
  await owner.conn.reducers.adminDeleteTestPhone({ phone: reviewer });

  const op = await panelUser(owner, 'operator');
  check('admin list shows the panel user', await waitFor(() => [...owner.conn.db.adminAdmins.iter()].some(a => a.username === op.username && a.role === 'operator' && a.isActive && !a.isEnv)));
  check('env owner row is marked', [...owner.conn.db.adminAdmins.iter()].some(a => a.isEnv && a.role === 'owner' && a.username === ADMIN_USER));
  const dash = await op.client.conn.procedures.adminDashboard();
  check('operator sees the dashboard', dash.accounts > 0 && dash.smsKind === 'sandbox', dash);
  check('operator cannot save brand', (await errorOf(op.client.conn.reducers.adminSaveBrand({ name: tr('x'), shortName: '', logoUrl: '', iconUrl: '', primaryColor: '', supportPhone: '', supportEmail: '', website: '' }))).includes('FORBIDDEN'));
  check('operator cannot see provider settings', [...op.client.conn.db.adminSmsProviders.iter()].length === 0);
  check('only the owner creates panel users', (await errorOf(op.client.conn.reducers.adminCreateUser({ username: 'sneaky', password: 'Sneaky12345', role: 'owner' }))).includes('FORBIDDEN'));
  check('short password refused', (await errorOf(owner.conn.reducers.adminCreateUser({ username: 'weakone', password: 'abc1', role: 'admin' }))).includes('PASSWORD_TOO_SHORT'));
  check('password needs letters and digits', (await errorOf(owner.conn.reducers.adminCreateUser({ username: 'weakone', password: 'onlylettershere', role: 'admin' }))).includes('PASSWORD_TOO_WEAK'));
  check('bad username refused', (await errorOf(owner.conn.reducers.adminCreateUser({ username: 'a b', password: 'Good12345678', role: 'admin' }))).includes('INVALID_USERNAME'));
  check('username taken', (await errorOf(owner.conn.reducers.adminCreateUser({ username: op.username, password: 'Good12345678', role: 'admin' }))).includes('USERNAME_TAKEN'));
  check('env username cannot be reused', (await errorOf(owner.conn.reducers.adminCreateUser({ username: ADMIN_USER, password: 'Good12345678', role: 'admin' }))).includes('USERNAME_TAKEN'));
  const envRow = [...owner.conn.db.adminAdmins.iter()].find(a => a.isEnv)!;
  check('env owner cannot be edited', (await errorOf(owner.conn.reducers.adminSetUserRole({ accountId: envRow.accountId, role: 'operator' }))).includes('ENV_ADMIN_LOCKED'));
  check('env owner cannot change its password here', (await errorOf(owner.conn.reducers.adminChangeMyPassword({ oldPassword: ADMIN_PASSWORD, newPassword: 'Other12345678' }))).includes('ENV_ADMIN_LOCKED'));

  await owner.conn.reducers.adminSetUserRole({ accountId: op.accountId, role: 'admin' });
  check('role change reaches the user live', await waitFor(() => [...op.client.conn.db.myRole.iter()][0]?.role === 'admin'));
  await owner.conn.reducers.adminSetUserRole({ accountId: op.accountId, role: 'operator' });

  check('wrong old password refused', (await errorOf(op.client.conn.reducers.adminChangeMyPassword({ oldPassword: 'not-it-123', newPassword: 'NewPass12345' }))).includes('INVALID_CREDENTIALS'));
  await op.client.conn.reducers.adminChangeMyPassword({ oldPassword: op.password, newPassword: 'NewPass12345' });
  const relog = await (await connect()).conn.procedures.adminLogin({ username: op.username, password: 'NewPass12345' });
  check('user logs in with its new password', relog.ok && relog.role === 'operator', relog);
  const oldPw = await (await connect()).conn.procedures.adminLogin({ username: op.username, password: op.password });
  check('old password no longer works', !oldPw.ok && oldPw.error === 'INVALID_CREDENTIALS');

  await owner.conn.reducers.adminSetUserPassword({ accountId: op.accountId, password: 'Reset1234567' });
  check('owner reset logs the user out', await waitFor(() => [...op.client.conn.db.myRole.iter()].length === 0));
  const afterReset = await (await connect()).conn.procedures.adminLogin({ username: op.username.toUpperCase(), password: 'Reset1234567' });
  check('reset password works and usernames ignore case', afterReset.ok, afterReset);

  await owner.conn.reducers.adminSetUserActive({ accountId: op.accountId, isActive: false });
  const inactive = await (await connect()).conn.procedures.adminLogin({ username: op.username, password: 'Reset1234567' });
  check('inactive user cannot log in', !inactive.ok && inactive.error === 'INVALID_CREDENTIALS');
  check('owner cannot deactivate self', (await errorOf(owner.conn.reducers.adminSetUserActive({ accountId: ownerLogin.accountId, isActive: false }))).match(/CANNOT_CHANGE_SELF|ENV_ADMIN_LOCKED/) !== null);
  await owner.conn.reducers.adminSetUserActive({ accountId: op.accountId, isActive: true });
  await owner.conn.reducers.adminDeleteUser({ accountId: op.accountId });
  check('deleted user leaves the list', await waitFor(() => ![...owner.conn.db.adminAdmins.iter()].some(a => a.username === op.username)));
  const gone = await (await connect()).conn.procedures.adminLogin({ username: op.username, password: 'Reset1234567' });
  check('deleted user cannot log in', !gone.ok && gone.error === 'INVALID_CREDENTIALS');
  await owner.conn.reducers.adminCreateUser({ username: op.username, password: 'Again1234567', role: 'operator' });
  check('a deleted username can be used again', await waitFor(() => [...owner.conn.db.adminAdmins.iter()].some(a => a.username === op.username && a.isActive)));
  const again = [...owner.conn.db.adminAdmins.iter()].find(a => a.username === op.username)!;
  await owner.conn.reducers.adminDeleteUser({ accountId: again.accountId });

  const page = await owner.conn.procedures.adminAccounts({ query: userPhone.slice(-6), status: '', page: 1, pageSize: 10 });
  check('account search by phone', page.total === 1 && page.rows[0].phone === userPhone, page);
  const userId = page.rows[0].id;
  await owner.conn.reducers.adminSetAccountStatus({ accountId: userId, status: 'blocked' });
  check('blocking logs the player out live', await waitFor(() => [...user.conn.db.me.iter()].length === 0));
  check('blocked phone cannot ask for a code', (await errorOf(user.conn.procedures.requestOtp({ phone: userPhone }))).includes('ACCOUNT_BLOCKED'));
  const blockedPage = await owner.conn.procedures.adminAccounts({ query: '', status: 'blocked', page: 1, pageSize: 100 });
  check('status filter', blockedPage.rows.some(r => r.id === userId) && blockedPage.rows.every(r => r.status === 'blocked'));
  await owner.conn.reducers.adminSetAccountStatus({ accountId: userId, status: 'active' });
  check('owner cannot block self', (await errorOf(owner.conn.reducers.adminSetAccountStatus({ accountId: ownerLogin.accountId, status: 'blocked' }))).includes('CANNOT_CHANGE_SELF'));

  const auditPage = await owner.conn.procedures.adminAudit({ action: 'account.', page: 1, pageSize: 5 });
  check('audit log records actions', auditPage.rows.length > 0 && auditPage.rows[0].phone === `admin:${ADMIN_USER}`, auditPage.rows[0]);

  await owner.conn.reducers.adminCompleteSetup({ done: true });
  check('setup flag', await waitFor(() => [...owner.conn.db.adminSettings.iter()][0]?.setupDone === true));

  await owner.conn.reducers.adminSaveSettings({ otpLength: s0.otpLength, otpTtlSec: s0.otpTtlSec, otpResendSec: s0.otpResendSec, otpMaxAttempts: s0.otpMaxAttempts, otpDailyCap: s0.otpDailyCap });
  await owner.conn.reducers.adminSaveBrand({ name: b0.name, shortName: b0.shortName, logoUrl: b0.logoUrl, iconUrl: b0.iconUrl, primaryColor: b0.primaryColor, supportPhone: b0.supportPhone, supportEmail: b0.supportEmail, website: b0.website });
  await owner.conn.reducers.adminCompleteSetup({ done: s0.setupDone });

  done('base');
}

main().catch(e => {
  console.error('ERROR', e);
  process.exit(1);
});
