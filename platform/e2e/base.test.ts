import { check, connect, done, errorOf, lastSandboxCode, login, tr, uniquePhone, waitFor } from './src/lib.ts';

const OWNER = '09120000001';

async function main() {
  const anon = await connect();
  check('brand is public before login', [...anon.conn.db.brand.iter()].length === 1);
  check('languages are public', [...anon.conn.db.language.iter()].some(l => l.code === 'fa' && l.isDefault));
  check('admin views are empty for guests', [...anon.conn.db.adminSettings.iter()].length === 0 && [...anon.conn.db.adminSmsProviders.iter()].length === 0);
  check('guest cannot save brand', (await errorOf(anon.conn.reducers.adminSaveBrand({ name: tr('x'), shortName: '', logoUrl: '', iconUrl: '', primaryColor: '', supportPhone: '', supportEmail: '', website: '' }))).includes('NOT_LOGGED_IN'));

  const owner = await connect();
  const ownerLogin = await login(owner, OWNER);
  check('bootstrap phone becomes owner', ownerLogin.role === 'owner', ownerLogin);
  check('my_role view shows owner', await waitFor(() => [...owner.conn.db.myRole.iter()][0]?.role === 'owner'));
  check('owner sees settings', await waitFor(() => [...owner.conn.db.adminSettings.iter()].length === 1));

  const s0 = [...owner.conn.db.adminSettings.iter()][0];
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

  const opPhone = uniquePhone('0912');
  await owner.conn.reducers.adminSetAdmin({ phone: opPhone, role: 'operator' });
  check('admin list shows the operator', await waitFor(() => [...owner.conn.db.adminAdmins.iter()].some(a => a.phone === opPhone && a.role === 'operator')));
  const op = await connect();
  const opLogin = await login(op, opPhone);
  check('operator logs in with its role', opLogin.role === 'operator', opLogin);
  const dash = await op.conn.procedures.adminDashboard();
  check('operator sees the dashboard', dash.accounts > 0 && dash.smsKind === 'sandbox', dash);
  check('operator cannot save brand', (await errorOf(op.conn.reducers.adminSaveBrand({ name: tr('x'), shortName: '', logoUrl: '', iconUrl: '', primaryColor: '', supportPhone: '', supportEmail: '', website: '' }))).includes('FORBIDDEN'));
  check('operator cannot see provider settings', [...op.conn.db.adminSmsProviders.iter()].length === 0);
  check('admin cannot make admins', (await errorOf(op.conn.reducers.adminSetAdmin({ phone: uniquePhone(), role: 'owner' }))).includes('FORBIDDEN'));
  const ownerRow = [...owner.conn.db.adminAdmins.iter()].find(a => a.phone === OWNER)!;
  check('last owner cannot be removed', (await errorOf(owner.conn.reducers.adminRemoveAdmin({ accountId: ownerRow.accountId }))).includes('LAST_OWNER'));
  const opRow = [...owner.conn.db.adminAdmins.iter()].find(a => a.phone === opPhone)!;
  await owner.conn.reducers.adminRemoveAdmin({ accountId: opRow.accountId });
  check('role removal reaches the operator live', await waitFor(() => [...op.conn.db.myRole.iter()].length === 0));

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
  check('audit log records actions', auditPage.rows.length > 0 && auditPage.rows[0].phone === OWNER, auditPage.rows[0]);

  await owner.conn.reducers.adminCompleteSetup({ done: true });
  check('setup flag', await waitFor(() => [...owner.conn.db.adminSettings.iter()][0]?.setupDone === true));

  await owner.conn.reducers.adminSaveSettings({ otpLength: s0.otpLength, otpTtlSec: s0.otpTtlSec, otpResendSec: s0.otpResendSec, otpMaxAttempts: s0.otpMaxAttempts, otpDailyCap: s0.otpDailyCap });
  await owner.conn.reducers.adminSaveBrand({ name: tr('بازی من', 'My Game'), shortName: '', logoUrl: '', iconUrl: '', primaryColor: '#3f76ff', supportPhone: '', supportEmail: '', website: '' });
  await owner.conn.reducers.adminCompleteSetup({ done: false });

  done('base');
}

main().catch(e => {
  console.error('ERROR', e);
  process.exit(1);
});
