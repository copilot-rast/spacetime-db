import type { Page } from '@playwright/test';
import { ECONOMY_QUERIES, PLAYER_QUERIES, connect, login, waitFor, type Client } from '../src/lib.ts';
import { expect, open, stamp, test, toastOk, uniquePhone } from './fixtures.ts';

const S = stamp();
const fa = (s: string) => s.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const CUR = `c${S}`;
const META = `m${S}`;
const PRIZE = `p${S}`;
const GROUP = `g${S}`;
const PRODUCT = `k${S}`;
const GIFT = `G${S}`;
const TAG = `t${S}`;

test.describe.configure({ mode: 'serial' });

let target: { c: Client; phone: string; id: bigint };
let reporter: { c: Client; phone: string; id: bigint };

async function player(phone: string) {
  const c = await connect(undefined, [...PLAYER_QUERIES, ...ECONOMY_QUERIES]);
  const r = await login(c, phone);
  return { c, phone, id: r.accountId };
}

async function confirm(page: Page) {
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
}

async function save(page: Page, id: string) {
  await page.getByTestId(id).last().getByTestId('dialog-save').click();
  await expect(page.getByTestId(id)).toHaveCount(0);
}

async function openPlayer(page: Page, phone: string) {
  await open(page, 'players');
  await page.getByTestId('pl-search').fill(phone);
  await page.getByTestId(`pl-open-${phone}`).click();
  await expect(page.getByTestId('pd-name')).toBeVisible();
}

test('currencies, metas: create, edit, delete and IN_USE', async ({ page }) => {
  await open(page, 'currencies');
  await page.getByTestId('cu-add').click();
  let d = page.getByTestId('cu-dialog');
  await d.locator('input[name="key"]').fill(CUR);
  await d.locator('input[name="name-fa"]').fill(`سکهٔ ${S}`);
  await d.locator('input[name="defaultValue"]').fill('۵۰');
  await save(page, 'cu-dialog');
  await expect(page.getByTestId(`cu-row-${CUR}`)).toContainText('۵۰');
  await page.getByTestId(`cu-edit-${CUR}`).click();
  d = page.getByTestId('cu-dialog');
  await expect(d.locator('input[name="key"]')).toBeDisabled();
  await d.locator('select[name="type"]').selectOption('hard');
  await save(page, 'cu-dialog');
  await expect(page.getByTestId(`cu-row-${CUR}`)).toContainText('سخت');
  await page.getByTestId('cu-add').click();
  await d.locator('input[name="key"]').fill(`x${S}`);
  await d.locator('input[name="name-fa"]').fill('موقت');
  await save(page, 'cu-dialog');
  await page.getByTestId(`cu-del-x${S}`).click();
  await confirm(page);
  await expect(page.getByTestId(`cu-row-x${S}`)).toHaveCount(0);

  await open(page, 'metas');
  await page.getByTestId('mt-add').click();
  d = page.getByTestId('mt-dialog');
  await d.locator('input[name="key"]').fill(META);
  await d.locator('input[name="name-fa"]').fill('امتیاز تست');
  await d.locator('input[name="defaultValue"]').fill('۲٫۵'.replace('٫', '.'));
  await save(page, 'mt-dialog');
  await expect(page.getByTestId(`mt-row-${META}`)).toContainText('۲.۵');
  await page.getByTestId(`mt-edit-${META}`).click();
  await page.getByTestId('mt-server').click();
  await save(page, 'mt-dialog');
  await expect(page.getByTestId(`mt-row-${META}`)).toContainText('فقط سرور');
});

test('prizes with item rows and prize groups with chances', async ({ page }) => {
  await open(page, 'prizes');
  await page.getByTestId('pz-add').click();
  const d = page.getByTestId('pz-dialog');
  await d.locator('input[name="key"]').fill(PRIZE);
  await d.locator('input[name="name-fa"]').fill(`جایزهٔ تست ${S}`);
  await d.getByTestId('item-0-key').selectOption(CUR);
  await d.locator('input[name="item-0-value"]').fill('۲۵');
  await d.getByTestId('item-add').click();
  await d.getByTestId('item-1').locator('select').first().selectOption('meta');
  await d.getByTestId('item-1-key').selectOption(META);
  await d.getByTestId('item-1').locator('select').nth(2).selectOption('set');
  await d.locator('input[name="item-1-value"]').fill('۷');
  await save(page, 'pz-dialog');
  await expect(page.getByTestId(`pz-row-${PRIZE}`)).toContainText('+۲۵');
  await expect(page.getByTestId(`pz-row-${PRIZE}`)).toContainText('=۷');

  await page.getByTestId('pz-add').click();
  await d.locator('input[name="key"]').fill(`q${S}`);
  await d.locator('input[name="name-fa"]').fill(`دوم ${S}`);
  await d.getByTestId('item-0-key').selectOption(CUR);
  await save(page, 'pz-dialog');

  await open(page, 'prize-groups');
  await page.getByTestId('pg-add').click();
  const g = page.getByTestId('pg-dialog');
  await g.locator('input[name="key"]').fill(GROUP);
  await g.locator('input[name="name-fa"]').fill('گروه تست');
  await g.getByTestId('pg-entry-add').click();
  await g.getByTestId('pg-entry-add').click();
  await g.getByTestId('pg-entry-0-prize').selectOption({ label: `جایزهٔ تست ${S}` });
  await g.locator('input[name="pg-entry-0-weight"]').fill('۳');
  await g.getByTestId('pg-entry-1-prize').selectOption({ label: `دوم ${S}` });
  await expect(g.getByTestId('pg-entry-0-chance')).toHaveText('۷۵٪');
  await expect(g.getByTestId('pg-entry-1-chance')).toHaveText('۲۵٪');
  await save(page, 'pg-dialog');
  await expect(page.getByTestId(`pg-row-${GROUP}`)).toContainText('۷۵٪');
  await page.getByTestId(`pg-del-${GROUP}`).click();
  await confirm(page);
  await expect(page.getByTestId(`pg-row-${GROUP}`)).toHaveCount(0);
  await open(page, 'prizes');
  await page.getByTestId(`pz-del-q${S}`).click();
  await confirm(page);
  await expect(page.getByTestId(`pz-row-q${S}`)).toHaveCount(0);
});

test('products show only the fields their methods need', async ({ page }) => {
  await open(page, 'settings/payment-methods');
  const inApp = page.getByTestId('pm-in_app-active');
  if ((await inApp.getAttribute('aria-checked')) !== 'true') {
    await inApp.click();
    await page.getByTestId('pm-in_app-save').click();
    await toastOk(page);
  }
  await expect(page.getByTestId('pm-in_app-configured')).toHaveText('تنظیم‌شده');
  await open(page, 'products');
  await page.getByTestId('pr-add').click();
  const d = page.getByTestId('pr-dialog');
  await d.locator('input[name="key"]').fill(PRODUCT);
  await d.locator('input[name="name-fa"]').fill('بستهٔ سکه');
  await d.getByTestId('pr-prize').selectOption({ label: `جایزهٔ تست ${S}` });
  await expect(d.locator('input[name="priceToman"]')).toBeVisible();
  await d.getByTestId('pr-method-zarinpal').click();
  await expect(d.locator('input[name="priceToman"]')).toHaveCount(0);
  await d.getByTestId('pr-method-bazaar').click();
  await expect(d.locator('input[name="skuBazaar"]')).toBeVisible();
  await expect(d.locator('input[name="discountPercent"]')).toHaveCount(0);
  await d.getByTestId('pr-method-bazaar').click();
  await expect(d.locator('input[name="skuBazaar"]')).toHaveCount(0);
  await d.getByTestId('pr-method-in_app').click();
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('قیمت سکه‌ای');
  await d.getByTestId('pr-coin').selectOption(CUR);
  await d.locator('input[name="coinAmount"]').fill('۱۰');
  await save(page, 'pr-dialog');
  await page.getByTestId('pr-search').fill(PRODUCT);
  await expect(page.getByTestId(`pr-row-${PRODUCT}`)).toContainText('سکهٔ بازی');
  await expect(page.getByTestId(`pr-row-${PRODUCT}`)).toContainText(`۱۰ سکهٔ ${S}`);
});

test('gift codes: reward and discount', async ({ page }) => {
  await open(page, 'gifts');
  await page.getByTestId('gf-add').click();
  const d = page.getByTestId('gf-dialog');
  await d.locator('input[name="code"]').fill(GIFT.toLowerCase());
  await d.locator('input[name="name-fa"]').fill('هدیهٔ تست');
  await d.getByTestId('gf-prize').selectOption({ label: `جایزهٔ تست ${S}` });
  await d.locator('input[name="maxTotalUses"]').fill('۵');
  await save(page, 'gf-dialog');
  await page.getByTestId('gf-search').fill(GIFT);
  const row = page.getByTestId(`gf-row-${GIFT}`);
  await expect(row).toContainText('۰ از ۵');
  await page.getByTestId(`gf-edit-${GIFT}`).click();
  await d.getByRole('button', { name: 'تخفیف' }).click();
  await d.locator('input[name="discountPercent"]').fill('۱۵');
  await save(page, 'gf-dialog');
  await expect(row).toContainText('۱۵٪');
  await page.getByTestId(`gf-del-${GIFT}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('a coin purchase shows in payments and the player economy', async ({ page }) => {
  target = await player(uniquePhone('0937'));
  const tc = target.c;
  await waitFor(() => [...tc.conn.db.shop.iter()].some(p => p.key === PRODUCT), 5000);
  const product = [...tc.conn.db.shop.iter()].find(p => p.key === PRODUCT)!;
  const res = await tc.conn.procedures.purchaseStart({ productId: product.id, method: 'in_app', giftCode: '' });
  expect(res.status).toBe('success');

  await open(page, 'payments');
  await page.getByTestId('py-method').selectOption('in_app');
  await page.getByTestId('py-search').fill(target.phone);
  const row = page.getByTestId(`py-row-${res.paymentId}`);
  await expect(row).toContainText('موفق');
  await expect(row).toContainText(PRODUCT);
  await row.click();
  const dlg = page.getByTestId('py-dialog');
  await expect(dlg.getByTestId('py-reward')).toHaveText('جایزه داده شد');
  await expect(dlg.getByTestId('py-amount')).toContainText('۱۰');
  await expect(dlg.getByTestId('py-retry')).toBeDisabled();
  await page.keyboard.press('Escape');

  await openPlayer(page, target.phone);
  await expect(page.getByTestId(`pd-bal-${CUR}`)).toContainText('۶۵');
  await expect(page.getByTestId('pd-ledger')).toContainText('-۱۰');
  await page.getByTestId('pd-grant').click();
  await page.getByTestId('grant-prize').selectOption({ label: `جایزهٔ تست ${S} (${PRIZE})` });
  await page.getByTestId('grant-save').click();
  await toastOk(page);
  await expect(page.getByTestId(`pd-bal-${CUR}`)).toContainText('۹۰');
  await page.getByTestId('pd-adjust').click();
  const a = page.getByTestId('adjust-dialog');
  await a.getByTestId('adjust-key').selectOption(CUR);
  await a.locator('input[name="adjustValue"]').fill('-۵');
  await a.getByTestId('adjust-save').click();
  await expect(a).toHaveCount(0);
  await expect(page.getByTestId(`pd-bal-${CUR}`)).toContainText('۸۵');
  await page.getByTestId('pd-adjust').click();
  await a.getByTestId('adjust-key').selectOption(CUR);
  await a.locator('input[name="adjustValue"]').fill('-۵۰۰');
  await a.getByTestId('adjust-save').click();
  await expect(a.locator('.err-box')).toContainText('موجودی کافی نیست');
  await page.keyboard.press('Escape');
});

test('player tags, tag filter and bulk tags', async ({ page }) => {
  await openPlayer(page, target.phone);
  await page.getByTestId('pd-tag-plus').click();
  const d = page.getByTestId('tg-dialog');
  await d.locator('input[name="key"]').fill(TAG);
  await d.locator('input[name="title-fa"]').fill(`برچسب ${S}`);
  await save(page, 'tg-dialog');
  await expect(page.getByTestId(`pd-tag-${TAG}`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('pd-tags-save').click();
  await toastOk(page);
  await expect(page.getByTestId('pd-tags-save')).toHaveCount(0);

  await open(page, 'players');
  await page.getByTestId('pl-tag').selectOption({ label: `برچسب ${S}` });
  await expect(page.getByTestId('pl-total')).toHaveText('۱ حساب');
  await expect(page.getByTestId(`pl-row-${target.phone}`)).toContainText(`برچسب ${S}`);

  reporter = await player(uniquePhone('0938'));
  await page.getByTestId('pl-tag').selectOption('');
  await page.getByTestId('pl-search').fill(reporter.phone);
  await page.getByTestId(`pl-check-${reporter.phone}`).check();
  await expect(page.getByTestId('bulkbar')).toContainText('۱ بازیکن');
  await page.getByTestId('bulk-add').click();
  await page.getByTestId(`bulk-tags-${TAG}`).click();
  await page.getByTestId('bulk-apply').click();
  await toastOk(page);
  await expect(page.getByTestId(`pl-row-${reporter.phone}`)).toContainText(`برچسب ${S}`);
  await page.getByTestId(`pl-check-${reporter.phone}`).check();
  await page.getByTestId('bulk-remove').click();
  await page.getByTestId(`bulk-tags-${TAG}`).click();
  await page.getByTestId('bulk-apply').click();
  await expect(page.getByTestId(`pl-row-${reporter.phone}`)).not.toContainText(`برچسب ${S}`);
});

test('suspend, mute, warn and lift', async ({ page }) => {
  await openPlayer(page, target.phone);
  await page.getByTestId('pd-suspend').click();
  const d = page.getByTestId('rs-dialog');
  await d.getByTestId('rs-dur-1440').click();
  await d.locator('input[name="reason-fa"]').fill('تقلب در بازی');
  await d.locator('textarea[name="note"]').fill('یادداشت داخلی');
  await d.getByTestId('rs-save').click();
  await expect(d).toHaveCount(0);
  await expect(page.getByTestId('pd-active-suspend')).toContainText('تقلب در بازی');
  await expect.poll(() => [...target.c.conn.db.me.iter()].length, { timeout: 8000 }).toBe(0);

  await page.getByTestId('pd-mute').click();
  await page.getByTestId('rs-dur-60').click();
  await page.getByTestId('rs-save').click();
  await expect(page.getByTestId('rs-dialog').locator('.err-box')).toContainText('الزامی');
  await page.locator('input[name="reason-fa"]').fill('فحاشی در چت');
  await page.getByTestId('rs-save').click();
  await expect(page.getByTestId('pd-active-mute')).toBeVisible();
  await page.getByTestId('pd-lift-mute').click();
  await page.locator('textarea[name="liftNote"]').fill('اشتباه');
  await page.getByTestId('lift-save').click();
  await expect(page.getByTestId('pd-active-mute')).toHaveCount(0);

  await page.getByTestId('pd-warn').click();
  await expect(page.getByTestId('rs-dur')).toHaveCount(0);
  await page.locator('input[name="reason-fa"]').fill('رفتار نامناسب');
  await page.getByTestId('rs-save').click();
  await expect(page.getByTestId('pd-history')).toContainText('رفتار نامناسب');
  await expect(page.getByTestId('pd-history')).toContainText('برداشته‌شده');

  await open(page, 'restrictions');
  await page.getByTestId('rl-search').fill(target.phone);
  const row = page.getByTestId(`rl-row-${target.phone}`);
  await expect(row).toContainText('تعلیق');
  await page.getByTestId(`rl-lift-${target.phone}`).click();
  await page.getByTestId('lift-save').click();
  await expect(row).toHaveCount(0);
  await page.locator('.seg button', { hasText: 'برداشته‌شده' }).click();
  await expect(page.getByTestId('rl-table')).toContainText('تقلب در بازی');
});

test('reports: badge, review, notes and resolve with close others', async ({ page }) => {
  const r1 = await reporter.c.conn.procedures.reportPlayer({ targetId: target.id, titleKey: 'spam', note: 'پیام تبلیغاتی', matchId: 'm-1', contentId: '', gameKey: 'lobby' });
  const r2 = await reporter.c.conn.procedures.reportPlayer({ targetId: target.id, titleKey: 'abuse', note: '', matchId: '', contentId: '', gameKey: '' });
  expect(r1.duplicate).toBe(false);
  expect(r2.reportId).not.toBe(r1.reportId);

  await open(page, 'reports');
  await expect(page.getByTestId('nav-reports-badge')).toBeVisible();
  await page.getByTestId('rp-search').fill(target.phone);
  await expect(page.getByTestId('rp-table').locator('tbody tr')).toHaveCount(2);
  await page.getByTestId(`rp-open-${target.phone}`).last().click();
  const d = page.getByTestId('rp-dialog');
  await expect(d).toContainText('پیام تبلیغاتی');
  await expect(d.getByTestId('rp-history')).toContainText('۱ اخطار');
  await d.getByTestId('rp-take').click();
  await expect(d.getByTestId('rp-putback')).toBeVisible();
  await d.locator('input[name="rpNote"]').fill('بررسی شد');
  await d.getByTestId('rp-note-add').click();
  await expect(d.getByTestId('rp-note')).toContainText('بررسی شد');
  await d.getByRole('button', { name: 'اخطار' }).click();
  await d.locator('input[name="rpReason-fa"]').fill('تبلیغ ممنوع است');
  await d.getByTestId('rp-close-others').check();
  await d.getByTestId('rp-resolve').click();
  await expect(d.getByTestId('rp-closed')).toContainText('اخطار');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rp-table')).toContainText('گزارشی پیدا نشد');
  await page.locator('.seg button', { hasText: 'رسیدگی‌شده' }).click();
  await expect(page.getByTestId('rp-table').locator('tbody tr')).toHaveCount(2);
});

test('settings: account rules with try box, report titles and rules', async ({ page }) => {
  await open(page, 'settings/account-rules');
  const st = page.getByTestId('st-account-rules');
  const charset = st.locator('select[name="charset"]');
  const old = await charset.inputValue();
  await charset.selectOption('latin');
  await st.locator('input[name="sample"]').fill('علی');
  await expect(page.getByTestId('ar-try-bad')).toContainText('حروف غیرمجاز');
  await st.locator('input[name="sample"]').fill('Ali_99');
  await expect(page.getByTestId('ar-try-ok')).toBeVisible();
  await st.locator('input[name="displayNameMax"]').fill('۹۹');
  await page.getByTestId('ar-save').click();
  await expect(st.locator('.err-box')).toContainText('بیشترین طول نام');
  await st.locator('input[name="displayNameMax"]').fill('۴۰');
  await page.getByTestId('ar-save').click();
  await toastOk(page);
  await charset.selectOption(old);
  await page.getByTestId('ar-save').click();
  await toastOk(page);

  await open(page, 'settings/report-titles');
  await page.getByTestId('rt-add').click();
  const d = page.getByTestId('rt-dialog');
  await d.locator('input[name="key"]').fill(`r${S}`);
  await d.locator('input[name="name-fa"]').fill('دلیل تست');
  await save(page, 'rt-dialog');
  await expect(page.getByTestId(`rt-row-r${S}`)).toContainText('دلیل تست');
  await page.getByTestId(`rt-edit-r${S}`).click();
  await d.locator('input[name="name-fa"]').fill('دلیل تست ۲');
  await save(page, 'rt-dialog');
  await expect(page.getByTestId(`rt-row-r${S}`)).toContainText('دلیل تست ۲');
  await page.getByTestId(`rt-del-r${S}`).click();
  await confirm(page);
  await expect(page.getByTestId(`rt-row-r${S}`)).toHaveCount(0);
  await page.getByTestId('rt-del-spam').click();
  await confirm(page);
  await expect(page.locator('.toast-bad').last()).toContainText('حذف نمی‌شود');

  await open(page, 'settings/report-rules');
  const rr = page.getByTestId('st-report-rules');
  const per = rr.locator('input[name="perHour"]');
  const oldPer = await per.inputValue();
  await per.fill('۱۲');
  await page.getByTestId(`rr-trusted-${TAG}`).click();
  await expect(page.locator('.toast-ok')).toHaveCount(0, { timeout: 10_000 });
  await page.getByTestId('rr-save').click();
  await toastOk(page);
  await open(page, 'settings/report-rules');
  await expect(page.getByTestId('st-report-rules').locator('input[name="perHour"]')).toHaveValue('۱۲');
  await expect(page.getByTestId(`rr-trusted-${TAG}`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('st-report-rules').locator('input[name="perHour"]').fill(oldPer);
  await page.getByTestId(`rr-trusted-${TAG}`).click();
  await page.getByTestId('rr-save').click();
  await toastOk(page);
});

test('settings: app versions, countries and tag visibility', async ({ page }) => {
  await open(page, 'settings/app-versions');
  await page.getByTestId('av-add').click();
  const d = page.getByTestId('av-dialog');
  const platform = await d.locator('select[name="platform"]').inputValue();
  await d.locator('input[name="latest"]').fill('2.0.0');
  await d.locator('input[name="min"]').fill('3.0.0');
  await d.getByTestId('av-link-add').click();
  await d.locator('input[name="av-link-0-url"]').fill('https://example.com/app');
  await d.locator('input[name="av-link-0-label-fa"]').fill('دانلود');
  await d.locator('input[name="updateMessage-fa"]').fill('نسخهٔ تازه آمد');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('حداقل نسخه');
  await d.locator('input[name="min"]').fill('1.5.0');
  await save(page, 'av-dialog');
  const row = page.getByTestId(`av-row-${platform}`);
  await expect(row).toContainText('2.0.0');
  await page.getByTestId(`av-edit-${platform}`).click();
  await d.locator('input[name="latest"]').fill('2.1.0');
  await save(page, 'av-dialog');
  await expect(row).toContainText('2.1.0');
  await page.getByTestId(`av-del-${platform}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);

  await open(page, 'settings/countries');
  await page.getByTestId('co-search').fill('ایران');
  await expect(page.getByTestId('co-row-IR')).toContainText('+۹۸');
  await page.getByTestId('co-search').fill('');
  await page.getByTestId('co-add').click();
  const c = page.getByTestId('co-dialog');
  await c.locator('input[name="code"]').fill('qz');
  await c.locator('input[name="dialCode"]').fill('+999');
  await c.locator('input[name="name-fa"]').fill('کشور تست');
  await save(page, 'co-dialog');
  await page.getByTestId('co-search').fill('QZ');
  await expect(page.getByTestId('co-row-QZ')).toContainText('کشور تست');
  await page.getByTestId('co-active-QZ').click();
  await expect(page.getByTestId('co-active-QZ')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('co-edit-QZ').click();
  await c.locator('input[name="name-fa"]').fill('کشور تست ۲');
  await save(page, 'co-dialog');
  await expect(page.getByTestId('co-row-QZ')).toContainText('کشور تست ۲');
  await page.getByTestId('co-del-QZ').click();
  await confirm(page);
  await expect(page.getByTestId('co-row-QZ')).toHaveCount(0);

  await open(page, 'settings/tags');
  await page.getByTestId('tg-filter').selectOption('user');
  const sw = page.getByTestId(`tg-public-${TAG}`);
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
});

test('payment method keeps a masked secret; economy settings validate', async ({ page }) => {
  await open(page, 'settings/payment-methods');
  const card = page.getByTestId('pm-zibal');
  const merchant = card.locator('input[name="zibal-merchant"]');
  await merchant.fill(`secret-${S}`);
  await page.getByTestId('pm-zibal-save').click();
  await toastOk(page);
  await expect(page.getByTestId('pm-zibal-configured')).toHaveText('تنظیم‌شده');
  await open(page, 'settings/payment-methods');
  await expect(page.getByTestId('pm-zibal').locator('input[name="zibal-merchant"]')).toHaveValue('********');
  await expect(page.getByTestId('pm-zibal')).not.toContainText(`secret-${S}`);
  await page.getByTestId('pm-zibal-save').click();
  await toastOk(page);
  await expect(page.getByTestId('pm-zibal-configured')).toHaveText('تنظیم‌شده');

  await open(page, 'settings/economy-settings');
  const st = page.getByTestId('st-economy-settings');
  const base = st.locator('input[name="publicBaseUrl"]');
  const oldBase = await base.inputValue();
  await base.fill('not a url');
  await page.getByTestId('es-save').click();
  await expect(st.locator('.err-box')).toContainText('https://');
  await st.locator('input[name="pendingTtlMinutes"]').fill('۲');
  await base.fill('https://api.example.com');
  await page.getByTestId('es-save').click();
  await expect(st.locator('.err-box')).toContainText('مهلت پرداخت');
  await st.locator('input[name="pendingTtlMinutes"]').fill('۴۵');
  await page.getByTestId('es-save').click();
  await toastOk(page);
  await expect(st).toContainText('route/economy/callback');
  await base.fill(oldBase);
  await page.getByTestId('es-save').click();
  await toastOk(page);
});

test('dashboard tiles, economy overview and palette', async ({ page }) => {
  await open(page, 'dashboard');
  await expect(page.getByTestId('tile-paymentsDay')).toContainText(/[۰-۹]/);
  await expect(page.getByTestId('tile-reportsOpen')).toBeVisible();
  await page.getByTestId('tile-suspended').click();
  await expect(page).toHaveURL(/players\?status=suspended/);
  await open(page, 'economy');
  await expect(page.getByTestId('eco-tile-paymentsDay')).toContainText(/[۰-۹]/);
  await expect(page.getByTestId('eco-chart')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('.pal-input').fill('روش‌های پرداخت');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('st-payment-methods')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.locator('.pal-input').fill('restrictions');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-restrictions')).toBeVisible();
});

test('cleanup keeps catalog tidy', async ({ page }) => {
  await open(page, 'products');
  await page.getByTestId('pr-search').fill(PRODUCT);
  await page.getByTestId(`pr-del-${PRODUCT}`).click();
  await confirm(page);
  await expect(page.locator('.toast-bad').last()).toContainText('حذف نمی‌شود');
  await page.getByTestId(`pr-edit-${PRODUCT}`).click();
  await page.getByTestId('pr-dialog').getByRole('switch').last().click();
  await save(page, 'pr-dialog');
  await expect(page.getByTestId(`pr-row-${PRODUCT}`)).toContainText('غیرفعال');
  await open(page, 'metas');
  await page.getByTestId(`mt-del-${META}`).click();
  await confirm(page);
  await expect(page.locator('.toast-bad').last()).toContainText('حذف نمی‌شود');
  target.c.conn.disconnect();
  reporter.c.conn.disconnect();
});
