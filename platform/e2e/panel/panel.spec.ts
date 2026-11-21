import type { Page } from '@playwright/test';
import { connect, login, sql } from '../src/lib.ts';
import { ADMIN_USER, adminPassword, expect, freshPage, lastSandboxCode, open, stamp, test, toastOk, uniquePhone } from './fixtures.ts';

const S = stamp();
const fa = (s: string) => s.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const latin = (s: string) => s.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  sql('UPDATE base_settings SET setup_done = false WHERE id = 0');
});

async function confirm(page: Page) {
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
}

async function dialogSave(page: Page, testId: string) {
  await page.getByTestId(testId).last().getByTestId('dialog-save').click();
  await expect(page.getByTestId(testId)).toHaveCount(0);
}

test('wrong password, lockout with countdown, and unlock from settings', async ({ page }) => {
  await open(page, 'settings/admin-login');
  const st = page.getByTestId('st-admin-login');
  const max = st.locator('input[name="adminLoginMaxAttempts"]');
  const oldMax = await max.inputValue();
  await max.fill('۷۰');
  await page.getByTestId('al-save').click();
  await expect(st.locator('.err-box')).toContainText('تعداد تلاش اشتباه');
  await max.fill('۲');
  await page.getByTestId('al-save').click();
  await toastOk(page);

  const p2 = await freshPage(page.context().browser()!);
  await p2.goto('/');
  await p2.locator('#c-db').fill(process.env.STG_DB!);
  await p2.getByTestId('connect-go').click();
  await p2.locator('#l-user').fill(ADMIN_USER);
  await p2.locator('#l-pass').fill('wrong-password-1');
  await p2.getByTestId('login-pass-go').click();
  await expect(p2.locator('.err-box')).toContainText('نام کاربری یا رمز اشتباه است');
  await p2.locator('#l-pass').fill('wrong-password-2');
  await p2.getByTestId('login-pass-go').click();
  await p2.locator('#l-pass').fill(adminPassword());
  await p2.getByTestId('login-pass-go').click();
  await expect(p2.locator('.err-box')).toContainText(/ورود قفل شده است\. [۰-۹]+ ثانیهٔ دیگر/);
  await expect(p2.getByTestId('login-pass-go')).toBeDisabled();

  await page.getByTestId('al-unlock').click();
  await confirm(page);
  await toastOk(page);
  await max.fill(oldMax);
  await page.getByTestId('al-save').click();
  await toastOk(page);

  await p2.reload();
  await p2.locator('#l-user').fill(ADMIN_USER);
  await p2.locator('#l-pass').fill(adminPassword());
  await p2.getByTestId('login-pass-go').click();
  await expect(p2.locator('.rail')).toBeVisible();
});

test('setup wizard saves each step and finishes', async ({ page }) => {
  await open(page, 'settings/setup');
  await page.getByTestId('st-open-wizard').click();
  const wz = page.getByTestId('wizard');
  await expect(wz).toBeVisible();
  await wz.locator('input[name="brand-name-fa"]').fill(`بازی تست ${S}`);
  await page.getByTestId('wz-next').click();
  await expect(page.getByTestId('wz-body-languages')).toBeVisible();
  await expect(page.getByTestId('wz-lg-fa')).toBeVisible();
  await page.getByTestId('wz-next').click();
  await expect(page.getByTestId('wz-body-sms')).toBeVisible();
  await expect(page.getByTestId('wz-active-provider')).toBeVisible();
  await wz.locator('input[name="testPhone"]').fill('۰۹۱۲۱۱۱۲۲۳۳');
  await page.getByTestId('sms-test-send').click();
  await expect(wz.locator('.ok-box')).toContainText('sandbox');
  await page.getByTestId('wz-next').click();
  await expect(page.getByTestId('wz-body-otp')).toBeVisible();
  await expect(wz.locator('input[name="otpLength"]')).toHaveValue(/^[۴-۸]$/);
  await page.getByTestId('wz-next').click();
  await expect(page.getByTestId('wz-review')).toContainText(`بازی تست ${S}`);
  await page.getByTestId('wz-next').click();
  await expect(wz).toHaveCount(0);
  await toastOk(page);
  await expect(page.getByTestId('side-brand')).toHaveText(`بازی تست ${S}`);
  await open(page, 'dashboard');
  await expect(page.getByTestId('tile-accounts')).toBeVisible();
  await expect(page.getByTestId('dash-setup')).toHaveCount(0);
});

test('dashboard tiles link to their pages', async ({ page }) => {
  await open(page, 'dashboard');
  await expect(page.getByTestId('tile-accounts')).toContainText(/[۰-۹]/);
  await expect(page.getByTestId('tile-sms')).toContainText('آزمایشی');
  await page.getByTestId('tile-blocked').click();
  await expect(page).toHaveURL(/#\/players\?status=blocked/);
  await expect(page.getByTestId('page-players')).toBeVisible();
  await expect(page.locator('.seg button[aria-pressed="true"]')).toHaveText('مسدود');
  await open(page, 'dashboard');
  await page.getByTestId('tile-languages').click();
  await expect(page.getByTestId('st-languages')).toBeVisible();
});

test('brand section edits and restores', async ({ page }) => {
  await open(page, 'settings/brand');
  const st = page.getByTestId('st-brand');
  await st.locator('input[name="brand-name-fa"]').fill('بازی من');
  await st.locator('input[name="brand-name-en"]').fill('My Game');
  await st.locator('input[name="shortName"]').fill('BM');
  await st.locator('input[name="supportPhone"]').fill('۰۲۱۱۲۳۴۵۶۷۸');
  await st.locator('input[name="primaryColor"]').fill('red');
  await page.getByTestId('brand-save').click();
  await expect(st.locator('.err-box')).toContainText('#RRGGBB');
  await st.locator('input[name="primaryColor"]').fill('#3f76ff');
  await page.getByTestId('brand-save').click();
  await toastOk(page);
  await expect(page.getByTestId('side-brand')).toHaveText('بازی من');
  await expect(page.locator('.rail-brand')).toHaveText('BM');
  await st.locator('input[name="shortName"]').fill('');
  await st.locator('input[name="supportPhone"]').fill('');
  await page.getByTestId('brand-save').click();
  await expect(page.locator('.rail-brand')).toHaveText('با');
});

test('languages add, edit, delete', async ({ page }) => {
  await open(page, 'settings/languages');
  if (await page.getByTestId('lg-row-de').isVisible()) {
    await page.getByTestId('lg-del-de').click();
    await confirm(page);
  }
  await page.getByTestId('lg-add').click();
  const d = page.getByTestId('lg-dialog');
  await d.locator('input[name="code"]').fill('de');
  await d.locator('input[name="name"]').fill('Deutsch');
  await d.locator('select[name="dir"]').selectOption('ltr');
  await dialogSave(page, 'lg-dialog');
  await expect(page.getByTestId('lg-row-de')).toContainText('Deutsch');
  await page.getByTestId('lg-edit-de').click();
  await d.locator('input[name="name"]').fill('Deutsch Neu');
  await dialogSave(page, 'lg-dialog');
  await expect(page.getByTestId('lg-row-de')).toContainText('Deutsch Neu');
  await expect(page.getByTestId('lg-del-fa')).toBeDisabled();
  await page.getByTestId('lg-del-de').click();
  await confirm(page);
  await expect(page.getByTestId('lg-row-de')).toHaveCount(0);
});

test('key types add, edit, delete', async ({ page }) => {
  const key = `kt${S}`;
  await open(page, 'settings/key-types');
  await expect(page.getByTestId('kt-del-general')).toBeDisabled();
  await page.getByTestId('kt-add').click();
  const d = page.getByTestId('kt-dialog');
  await d.locator('input[name="key"]').fill('Bad Key');
  await d.locator('input[name="title-fa"]').fill('نوع تست');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('حروف کوچک');
  await d.locator('input[name="key"]').fill(key);
  await dialogSave(page, 'kt-dialog');
  await expect(page.getByTestId(`kt-row-${key}`)).toContainText('نوع تست');
  await page.getByTestId(`kt-edit-${key}`).click();
  await d.locator('input[name="title-fa"]').fill('نوع تست ۲');
  await dialogSave(page, 'kt-dialog');
  await expect(page.getByTestId(`kt-row-${key}`)).toContainText('نوع تست ۲');
  await page.getByTestId(`kt-del-${key}`).click();
  await confirm(page);
  await expect(page.getByTestId(`kt-row-${key}`)).toHaveCount(0);
});

test('categories tree with quick-create key type and parent', async ({ page }) => {
  const kt = `ct${S}`;
  await open(page, 'settings/categories');
  await page.getByTestId('ct-filter-plus').click();
  const kd = page.getByTestId('kt-dialog');
  await kd.locator('input[name="key"]').fill(kt);
  await kd.locator('input[name="title-fa"]').fill('دسته‌بندی تست');
  await dialogSave(page, 'kt-dialog');
  await expect(page.getByTestId('ct-filter')).toHaveValue(kt);
  await page.getByTestId('ct-add-empty').click();
  let d = page.getByTestId('ct-dialog');
  await d.locator('input[name="key"]').fill('parent');
  await d.locator('input[name="title-fa"]').fill('والد');
  await dialogSave(page, 'ct-dialog');
  await expect(page.getByTestId('ct-row-parent')).toBeVisible();
  await page.getByTestId('ct-child-parent').click();
  d = page.getByTestId('ct-dialog');
  await expect(d.getByTestId('ct-parent')).not.toHaveValue('0');
  await d.locator('input[name="key"]').fill('child');
  await d.locator('input[name="title-fa"]').fill('فرزند');
  await d.locator('input[name="desc-fa"]').fill('توضیح');
  await d.getByTestId('ct-parent-plus').click();
  const nested = page.getByTestId('ct-dialog').last();
  await expect(page.getByTestId('ct-dialog')).toHaveCount(2);
  await nested.locator('input[name="key"]').fill('other');
  await nested.locator('input[name="title-fa"]').fill('دیگر');
  await nested.getByTestId('dialog-save').click();
  await expect(page.getByTestId('ct-dialog')).toHaveCount(1);
  await expect(page.locator('[data-testid="ct-dialog"] [data-testid="ct-parent"] option:checked')).toHaveText('دیگر');
  await dialogSave(page, 'ct-dialog');
  const rows = page.getByTestId('ct-tree').locator('.list-row');
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId('ct-row-child')).toContainText('توضیح');
  const keys = await rows.evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  expect(keys.indexOf('ct-row-child')).toBe(keys.indexOf('ct-row-other') + 1);
  await page.getByTestId('ct-del-other').click();
  await confirm(page);
  await expect(page.locator('.toast-bad').last()).toContainText('زیردسته');
  await page.getByTestId('ct-edit-child').click();
  d = page.getByTestId('ct-dialog');
  await d.locator('input[name="title-fa"]').fill('فرزند ۲');
  await dialogSave(page, 'ct-dialog');
  await expect(page.getByTestId('ct-row-child')).toContainText('فرزند ۲');
  for (const k of ['child', 'other', 'parent']) {
    await page.getByTestId(`ct-del-${k}`).click();
    await confirm(page);
    await expect(page.getByTestId(`ct-row-${k}`)).toHaveCount(0);
  }
  await open(page, 'settings/key-types');
  await page.getByTestId(`kt-del-${kt}`).click();
  await confirm(page);
  await expect(page.getByTestId(`kt-row-${kt}`)).toHaveCount(0);
});

test('tags by key type with color', async ({ page }) => {
  const key = `vip${S}`;
  await open(page, 'settings/tags');
  await page.getByTestId('tg-filter').selectOption('user');
  await page.getByTestId('tg-add').click();
  const d = page.getByTestId('tg-dialog');
  await expect(d.getByTestId('tg-kt')).toHaveValue('user');
  await d.locator('input[name="key"]').fill(key);
  await d.locator('input[name="title-fa"]').fill('ویژه');
  await d.locator('input[name="title-en"]').fill('VIP');
  await d.locator('input[name="color"]').fill('#ff8800');
  await dialogSave(page, 'tg-dialog');
  await expect(page.getByTestId(`tg-row-${key}`)).toContainText('#ff8800');
  await page.getByTestId(`tg-edit-${key}`).click();
  await d.locator('input[name="color"]').fill('#00aa55');
  await dialogSave(page, 'tg-dialog');
  await expect(page.getByTestId(`tg-row-${key}`)).toContainText('#00aa55');
  await page.getByTestId(`tg-del-${key}`).click();
  await confirm(page);
  await expect(page.getByTestId(`tg-row-${key}`)).toHaveCount(0);
});

test('sms providers: kinds, masked key, activate, test send, delete', async ({ page }) => {
  const kn = `KN${S}`;
  const sb = `SB${S}`;
  await open(page, 'settings/sms');
  await page.getByTestId('sm-add').click();
  const d = page.getByTestId('sm-dialog');
  await d.locator('select[name="kind"]').selectOption('kavenegar');
  await d.locator('input[name="name"]').fill(kn);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('کلید API');
  await d.locator('input[name="apiKey"]').fill('abcd1234efgh5678ijkl');
  await d.locator('input[name="otpTemplate"]').fill('login');
  await dialogSave(page, 'sm-dialog');
  const row = page.getByTestId(`sm-row-${kn}`);
  await expect(row).toContainText('abcd••••ijkl');
  await page.getByTestId(`sm-edit-${kn}`).click();
  await expect(d.locator('input[name="apiKey"]')).toHaveValue('');
  await expect(d.locator('input[name="apiKey"]')).toHaveAttribute('placeholder', 'abcd••••ijkl');
  await d.locator('input[name="otpTemplate"]').fill('login2');
  await dialogSave(page, 'sm-dialog');
  await expect(row).toContainText('login2');
  await expect(row).toContainText('abcd••••ijkl');
  await page.getByTestId('sm-add').click();
  await d.locator('select[name="kind"]').selectOption('smsir');
  await expect(d.locator('input[name="otpCodeVar"]')).toBeVisible();
  await d.locator('input[name="name"]').fill(`IR${S}`);
  await d.locator('input[name="apiKey"]').fill('irkey-1234567890');
  await d.locator('input[name="otpTemplate"]').fill('abc');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('باید عدد باشد');
  await d.locator('input[name="otpTemplate"]').fill('۱۰۰۲۰۰');
  await dialogSave(page, 'sm-dialog');
  await expect(page.getByTestId(`sm-row-IR${S}`)).toContainText('۱۰۰۲۰۰');
  await page.getByTestId(`sm-del-IR${S}`).click();
  await confirm(page);
  await page.getByTestId(`sm-test-${kn}`).click();
  const td = page.getByTestId('sms-test-dialog');
  await td.locator('input[name="testPhone"]').fill('09120000000');
  await td.getByTestId('sms-test-send').click();
  await expect(td.locator('.err-box')).toContainText('ناموفق', { timeout: 20_000 });
  await page.keyboard.press('Escape');
  await page.getByTestId(`sm-del-${kn}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);

  await page.getByTestId('sm-add').click();
  await d.locator('select[name="kind"]').selectOption('sandbox');
  await expect(d.locator('input[name="apiKey"]')).toHaveCount(0);
  await d.locator('input[name="name"]').fill(sb);
  await d.getByTestId('sm-active').click();
  await dialogSave(page, 'sm-dialog');
  await expect(page.getByTestId(`sm-row-${sb}`)).toContainText('سرویس فعال');
  await expect(page.getByTestId('sm-del-Sandbox')).toBeEnabled();
  await page.getByTestId('sm-activate-Sandbox').click();
  await expect(page.getByTestId('sm-row-Sandbox')).toContainText('سرویس فعال');
  await expect(page.getByTestId('sm-del-Sandbox')).toBeDisabled();
  await page.getByTestId(`sm-del-${sb}`).click();
  await confirm(page);
  await expect(page.getByTestId(`sm-row-${sb}`)).toHaveCount(0);

  await page.getByTestId('sm-test-Sandbox').click();
  await td.locator('input[name="testPhone"]').fill('09121112233');
  await td.getByTestId('sms-test-send').click();
  const ok = td.locator('.ok-box');
  await expect(ok).toContainText('sandbox');
  const code = latin((await ok.innerText()).match(/[۰-۹]{4,8}/)![0]);
  await page.keyboard.press('Escape');
  await open(page, 'settings/sandbox');
  await expect(page.getByTestId('sb-list')).toContainText(fa(code));
});

test('sandbox inbox is live and clears', async ({ page }) => {
  await open(page, 'settings/sandbox');
  const list = page.getByTestId('sb-list');
  await expect(list).toBeVisible();
  const before = await list.locator('.list-row').count();
  const phone = uniquePhone('0939');
  const c = await connect();
  await c.conn.procedures.requestOtp({ phone });
  await expect(list.locator('.list-row')).toHaveCount(before + 1);
  await expect(list).toContainText(fa(phone));
  c.conn.disconnect();
  await page.getByTestId('sb-clear').click();
  await confirm(page);
  await expect(page.getByTestId('st-sandbox').locator('.empty')).toBeVisible();
});

test('test phones add, edit, delete', async ({ page }) => {
  const phone = uniquePhone('0990');
  await open(page, 'settings/test-phones');
  await page.getByTestId('tp-add').click();
  const d = page.getByTestId('tp-dialog');
  await d.locator('input[name="phone"]').fill(fa(phone));
  const hint = await d.locator('.hint').first().innerText();
  const n = Number(latin(hint.match(/[۰-۹0-9]+/)![0])) || 5;
  await d.locator('input[name="code"]').fill(fa('1234567890'.slice(0, n)));
  await d.locator('input[name="note"]').fill('بازبین فروشگاه');
  await dialogSave(page, 'tp-dialog');
  const row = page.getByTestId(`tp-row-${phone}`);
  await expect(row).toContainText('بازبین فروشگاه');
  await expect(row).toContainText(fa(phone));
  await page.getByTestId(`tp-edit-${phone}`).click();
  await d.locator('input[name="note"]').fill('بازبین دوم');
  await dialogSave(page, 'tp-dialog');
  await expect(row).toContainText('بازبین دوم');
  await page.getByTestId(`tp-del-${phone}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('otp rules save with Persian digits', async ({ page }) => {
  await open(page, 'settings/otp');
  const st = page.getByTestId('st-otp');
  const resend = st.locator('input[name="otpResendSec"]');
  await expect(resend).toHaveValue(/^[۰-۹]+$/);
  const old = await resend.inputValue();
  await resend.fill('۵');
  await page.getByTestId('otp-save').click();
  await expect(st.locator('.err-box')).toContainText('۱۰ تا ۶۰۰');
  await resend.fill('۴۵');
  await page.getByTestId('otp-save').click();
  await toastOk(page);
  await open(page, 'settings/otp');
  await expect(page.getByTestId('st-otp').locator('input[name="otpResendSec"]')).toHaveValue('۴۵');
  await page.getByTestId('st-otp').locator('input[name="otpResendSec"]').fill(old);
  await page.getByTestId('otp-save').click();
  await toastOk(page);
});

test('players search, block and unblock from the player page', async ({ page }) => {
  const phone = uniquePhone('0936');
  const c = await connect();
  await login(c, phone);
  await open(page, 'players');
  await page.getByTestId('pl-search').fill(fa(phone.slice(-6)));
  await expect(page.getByTestId('pl-total')).toHaveText('۱ حساب');
  const row = page.getByTestId(`pl-row-${phone}`);
  await expect(row).toContainText('فعال');
  await page.getByTestId(`pl-open-${phone}`).click();
  await expect(page.getByTestId('page-player')).toBeVisible();
  await page.getByTestId('pd-block').click();
  await confirm(page);
  await expect(page.getByTestId('pd-block')).toContainText('رفع مسدودی');
  await expect.poll(() => [...c.conn.db.me.iter()].length, { timeout: 8000 }).toBe(0);
  await open(page, 'players?status=blocked');
  await page.getByTestId('pl-search').fill(phone);
  await expect(row).toContainText('مسدود');
  await page.getByTestId(`pl-open-${phone}`).click();
  await page.getByTestId('pd-block').click();
  await confirm(page);
  await expect(page.getByTestId('pd-block')).toContainText('مسدود کردن');
  await open(page, 'players');
  await expect(page.getByTestId('pager-range')).toContainText('۱ تا');
  c.conn.disconnect();
});

test('panel users: create, role, password, deactivate, delete; operator is read-only', async ({ page }) => {
  const username = `op${stamp()}`;
  const pass1 = `First${stamp()}pass`;
  const pass2 = `Second${stamp()}pass`;
  const pass3 = `Third${stamp()}pass`;
  await open(page, 'admins');
  await expect(page.getByTestId(`pu-row-${ADMIN_USER}`)).toContainText('کاربر سرور');
  await expect(page.getByTestId(`pu-role-${ADMIN_USER}`)).toHaveCount(0);
  await expect(page.getByTestId(`pu-del-${ADMIN_USER}`)).toHaveCount(0);
  await page.getByTestId('pu-add').click();
  const d = page.getByTestId('pu-dialog');
  await d.locator('input[name="username"]').fill('A!');
  await d.locator('input[name="password"]').fill('short');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('نام کاربری');
  await d.locator('input[name="username"]').fill(username);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('دست‌کم ۱۰ نویسه');
  await d.locator('input[name="password"]').fill('onlyletterspassword');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('حرف داشته باشد هم عدد');
  await d.getByTestId('password-gen').click();
  await expect(d.locator('input[name="password"]')).toHaveAttribute('type', 'text');
  await d.locator('input[name="password"]').fill(pass1);
  await d.locator('input[value="operator"]').check();
  await d.getByTestId('dialog-save').click();
  await expect(d).toHaveCount(0);
  const row = page.getByTestId(`pu-row-${username}`);
  await expect(row).toContainText('هنوز وارد نشده');
  await expect(page.getByTestId(`pu-role-${username}`)).toHaveValue('operator');
  await page.getByTestId('pu-add').click();
  await d.locator('input[name="username"]').fill(username);
  await d.locator('input[name="password"]').fill(pass1);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('گرفته شده');
  await page.keyboard.press('Escape');

  const op = await freshPage(page.context().browser()!);
  await op.goto('/');
  await op.locator('#c-db').fill(process.env.STG_DB!);
  await op.getByTestId('connect-go').click();
  await op.locator('#l-user').fill(username);
  await op.locator('#l-pass').fill(pass1);
  await op.getByTestId('login-pass-go').click();
  await expect(op.locator('.rail')).toBeVisible();
  await expect(op.getByTestId('side-username')).toHaveText(username);
  await expect(op.getByTestId('wizard')).toHaveCount(0);
  await expect(op.getByTestId('dash-setup')).toHaveCount(0);
  await op.getByTestId('rail-access').click();
  await expect(op.getByTestId('side-admins')).toBeVisible();
  await expect(op.getByTestId('side-audit')).toHaveCount(0);
  await expect(op.getByTestId('pu-add')).toHaveCount(0);
  await expect(op.getByTestId('page-admins')).toContainText('فقط مالک');
  await op.goto('/#/settings/brand');
  await expect(op.getByTestId('st-brand')).toBeVisible();
  await expect(op.locator('.win-head')).toContainText('فقط خواندنی');
  await expect(op.getByTestId('brand-save')).toHaveCount(0);
  await expect(op.getByTestId('st-nav-sms')).toHaveCount(0);
  await op.goto('/#/dashboard');
  await op.getByTestId('profile-btn').click();
  await op.getByTestId('profile-password').click();
  const mp = op.getByTestId('my-pw-dialog');
  await mp.locator('input[name="oldPassword"]').fill('wrong-old-1234');
  await mp.locator('input[name="newPassword"]').fill(pass2);
  await mp.locator('input[name="repeatPassword"]').fill(pass2 + 'x');
  await mp.getByTestId('dialog-save').click();
  await expect(mp.locator('.err-box')).toContainText('یکی نیست');
  await mp.locator('input[name="repeatPassword"]').fill(pass2);
  await mp.getByTestId('dialog-save').click();
  await expect(mp.locator('.err-box')).toContainText('اشتباه');
  await mp.locator('input[name="oldPassword"]').fill(pass1);
  await mp.getByTestId('dialog-save').click();
  await expect(mp).toHaveCount(0);

  await expect(row).not.toContainText('هنوز وارد نشده');
  await page.getByTestId(`pu-role-${username}`).selectOption('admin');
  await toastOk(page);
  await expect(op.getByTestId('side-audit')).toHaveCount(0);
  await op.getByTestId('rail-access').click();
  await expect(op.getByTestId('side-audit')).toBeVisible();
  await page.getByTestId(`pu-reset-${username}`).click();
  const rd = page.getByTestId('pw-reset-dialog');
  await rd.locator('input[name="newUserPassword"]').fill(pass3);
  await rd.getByTestId('dialog-save').click();
  await expect(rd).toHaveCount(0);
  await expect(op.getByTestId('login-password')).toBeVisible();
  await op.locator('#l-user').fill(username);
  await op.locator('#l-pass').fill(pass2);
  await op.getByTestId('login-pass-go').click();
  await expect(op.locator('.err-box')).toContainText('اشتباه');
  await op.locator('#l-pass').fill(pass3);
  await op.getByTestId('login-pass-go').click();
  await expect(op.locator('.rail')).toBeVisible();

  await page.getByTestId(`pu-active-${username}`).click();
  await expect(page.getByTestId(`pu-active-${username}`)).toHaveAttribute('aria-checked', 'false');
  await expect(op.getByTestId('login-password')).toBeVisible();
  await op.locator('#l-user').fill(username);
  await op.locator('#l-pass').fill(pass3);
  await op.getByTestId('login-pass-go').click();
  await expect(op.locator('.err-box')).toContainText('اشتباه');
  await page.getByTestId(`pu-del-${username}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('audit log filters by action', async ({ page }) => {
  await open(page, 'audit');
  await expect(page.getByTestId('au-table')).toContainText('admin_user.delete');
  await page.getByTestId('au-action').selectOption('account.');
  await expect(page.getByTestId('au-table').locator('tbody tr').first()).toContainText('تغییر وضعیت حساب');
  await expect(page.getByTestId('au-table')).not.toContainText('admin_user.delete');
  await expect(page.getByTestId('au-table')).not.toContainText('admin:admin');
});

test('command palette finds pages and settings in both languages', async ({ page }) => {
  await open(page, 'dashboard');
  await page.keyboard.press('Control+k');
  await page.locator('.pal-input').fill('زبان');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('st-languages')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.locator('.pal-input').fill('audit');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-audit')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('.pal-input').fill('sandbox');
  await expect(page.getByTestId('pal-s-sandbox')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('profile name, english locale and dark theme', async ({ page }) => {
  await open(page, 'dashboard');
  await page.getByTestId('profile-btn').click();
  await page.locator('#pf-name').fill('مدیر تست');
  await page.getByTestId('profile-save').click();
  await toastOk(page);
  await expect(page.locator('.avatar')).toHaveText('م');
  await page.locator('#pf-name').fill('');
  await page.getByTestId('profile-save').click();
  await page.getByTestId('profile-lang-en').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.keyboard.press('Escape');
  await expect(page.locator('.crumb-current')).toHaveText('Dashboard');
  await expect(page.getByTestId('tile-accounts')).toContainText(/[0-9]/);
  await open(page, 'players');
  await expect(page.getByTestId('pl-total')).toContainText('accounts');
  await page.getByTestId('profile-btn').click();
  await page.getByTestId('profile-lang-fa').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('profile-theme-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.keyboard.press('Escape');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});
