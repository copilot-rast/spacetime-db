import type { Page } from '@playwright/test';
import { ECONOMY_QUERIES, PLAYER_QUERIES, SUPPORT_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, open, stamp, test, toastOk, uniquePhone } from './fixtures.ts';

const S = stamp();
const fa = (s: string | number | bigint) => String(s).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const tr = (t: string) => [{ lang: 'fa', text: t }];
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...SUPPORT_QUERIES];
const CUR = `gwc${S}`;
const PRIZE = `gwp${S}`;
const K = { s: `gw${S}.str`, n: `gw${S}.num`, b: `gw${S}.flag`, j: `gw${S}.json`, t: `gw${S}.text` };

type RefArgs = Parameters<Client['conn']['reducers']['adminSaveReferralSettings']>[0];

test.describe.configure({ mode: 'serial' });

let owner: Client;
let orig: RefArgs;
let prizeId = 0n;
let curId = 0n;
const players: { c: Client; id: bigint }[] = [];
let codeA = '';
const refOf = new Map<bigint, bigint>();

async function confirm(page: Page) {
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
}

function current(): RefArgs {
  const s = [...owner.conn.db.adminReferralSettings.iter()][0]!;
  return {
    isEnabled: s.isEnabled,
    newAccountDays: s.newAccountDays,
    referrerPrizeId: s.referrerPrizeId,
    refereePrizeId: s.refereePrizeId,
    goalEventKey: s.goalEventKey,
    goalMeasure: s.goalMeasure,
    goalValue: s.goalValue,
    maxPerReferrer: s.maxPerReferrer,
    dailyPerReferrer: s.dailyPerReferrer,
    onePerDevice: s.onePerDevice,
    onePerPhone: s.onePerPhone,
    holdFlagged: s.holdFlagged,
    triesPerHour: s.triesPerHour,
  };
}

async function refSettings(a: RefArgs) {
  await owner.conn.reducers.adminSaveReferralSettings(a);
  await waitFor(() => {
    const s = [...owner.conn.db.adminReferralSettings.iter()][0];
    return !!s && s.dailyPerReferrer === a.dailyPerReferrer && s.triesPerHour === a.triesPerHour && s.holdFlagged === a.holdFlagged && s.referrerPrizeId === a.referrerPrizeId && s.goalEventKey === a.goalEventKey && s.newAccountDays === a.newAccountDays;
  });
}

test.beforeAll(async () => {
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await waitFor(() => [...owner.conn.db.adminReferralSettings.iter()].length === 1);
  orig = current();
  const r = owner.conn.reducers;
  await r.adminSaveCurrency({ id: 0n, key: CUR, name: tr(`سکهٔ دعوت ${S}`), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => [...owner.conn.db.currency.iter()].some(x => x.key === CUR));
  curId = [...owner.conn.db.currency.iter()].find(x => x.key === CUR)!.id;
  await r.adminSavePrize({ id: 0n, key: PRIZE, name: tr(`جایزهٔ یک‌باره ${S}`), message: [], categoryId: 0n, tagIds: [], isRepeatable: false, items: [{ type: 'currency', key: CUR, action: 'add', value: 5 }] });
  await waitFor(() => [...owner.conn.db.prize.iter()].some(x => x.key === PRIZE));
  prizeId = [...owner.conn.db.prize.iter()].find(x => x.key === PRIZE)!.id;
});

test.afterAll(async () => {
  if (orig) await owner?.conn.reducers.adminSaveReferralSettings(orig).catch(() => {});
  for (const k of Object.values(K)) await owner?.conn.reducers.adminDeleteConfigKey({ key: k }).catch(() => {});
  if (prizeId) await owner?.conn.reducers.adminDeletePrize({ id: prizeId }).catch(() => {});
  if (curId) await owner?.conn.reducers.adminDeleteCurrency({ id: curId }).catch(() => {});
  owner?.conn.disconnect();
  for (const p of players) p.c.conn.disconnect();
});

test('referral settings: save every field and translated errors', async ({ page }) => {
  await refSettings({ ...orig, referrerPrizeId: 0n });
  await open(page, 'settings/referral-settings');
  const f = page.getByTestId('gw-settings');
  await expect(f).toBeVisible();
  await f.locator('input[name="triesPerHour"]').fill('12');
  await f.locator('input[name="dailyPerReferrer"]').fill('7');
  await page.getByTestId('gw-s-hold').click();
  await page.getByTestId('gw-s-save').click();
  await toastOk(page);
  await expect.poll(() => current().triesPerHour).toBe(12);
  expect(current().dailyPerReferrer).toBe(7);
  expect(current().holdFlagged).toBe(!orig.holdFlagged);
  await page.getByTestId('gw-s-referrer-prize').selectOption(String(prizeId));
  await page.getByTestId('gw-s-save').click();
  await expect(f.locator('.err-box')).toContainText('تکرارپذیر');
  await page.getByTestId('gw-s-referrer-prize').selectOption('0');
  await f.locator('input[name="newAccountDays"]').fill('400');
  await page.getByTestId('gw-s-save').click();
  await expect(f.locator('.err-box')).toContainText('مهلت ورود کد');
  await f.locator('input[name="newAccountDays"]').fill(String(orig.newAccountDays));
  const ev = [...owner.conn.db.eventType.iter()][0];
  if (ev) {
    await page.getByTestId('gw-s-goal-event').selectOption(ev.key);
    await f.locator('input[name="goalValue"]').fill('0');
    await page.getByTestId('gw-s-save').click();
    await expect(f.locator('.err-box')).toContainText('بیشتر از صفر');
    await page.getByTestId('gw-s-goal-event').selectOption('');
  }
  await refSettings(orig);
});

test('referrals: list, filters, approve and reject held invites', async ({ page }) => {
  await refSettings({ ...orig, isEnabled: true, newAccountDays: 7, referrerPrizeId: 0n, refereePrizeId: 0n, goalEventKey: '', goalMeasure: 'count', goalValue: 0, maxPerReferrer: 100, dailyPerReferrer: 1, holdFlagged: true, triesPerHour: 50 });
  for (let i = 0; i < 5; i++) {
    const c = await connect(undefined, Q);
    const res = await login(c, uniquePhone('0936'));
    players.push({ c, id: res.accountId });
  }
  const [A, B, C, D, E] = players;
  codeA = (await A.c.conn.procedures.referralMe({ lang: 'fa' })).code;
  for (const p of [B, C, D, E]) await p.c.conn.procedures.referralEnter({ code: codeA });
  const list = await owner.conn.procedures.adminReferrals({ query: '', status: '', flag: '', flagged: false, referrerId: A.id, refereeId: 0n, page: 1, pageSize: 10 });
  for (const x of list.rows) refOf.set(x.referral.refereeId, x.referral.id);
  expect(list.rows.find(x => x.referral.refereeId === B.id)?.referral.status).toBe('completed');
  expect(list.rows.filter(x => x.referral.status === 'held').length).toBe(3);

  await open(page, `referrals?referrer=${A.id}`);
  await expect(page.getByTestId('rf-tile-held')).toBeVisible();
  await expect(page.getByTestId('rf-f-referrer')).toContainText(fa(A.id));
  await expect(page.getByTestId(`rf-row-${refOf.get(B.id)}`)).toContainText('کامل‌شده');
  await expect(page.getByTestId(`rf-row-${refOf.get(C.id)}`)).toContainText('دعوت‌های پشت‌سرهم');
  await expect(page.getByTestId(`rf-row-${refOf.get(C.id)}`)).toContainText('نگه‌داشته برای بررسی');
  await expect(page.getByTestId(`rf-approve-${refOf.get(B.id)}`)).toHaveCount(0);
  await page.getByTestId('rf-f-status').selectOption('held');
  await expect(page).toHaveURL(/status=held/);
  await expect(page.getByTestId(`rf-row-${refOf.get(B.id)}`)).toHaveCount(0);
  await expect(page.getByTestId(`rf-row-${refOf.get(C.id)}`)).toBeVisible();

  await page.getByTestId(`rf-approve-${refOf.get(C.id)}`).click();
  await page.getByTestId('gw-decide-note').fill(`بررسی شد ${S}`);
  await page.getByTestId('gw-decide-ok').click();
  await toastOk(page);
  await expect(page.getByTestId('gw-decide')).toHaveCount(0);
  await expect(page.getByTestId(`rf-row-${refOf.get(C.id)}`)).toHaveCount(0);

  await page.getByTestId(`rf-reject-${refOf.get(D.id)}`).click();
  await page.getByTestId('gw-decide-note').fill('دستگاه مشکوک');
  await page.getByTestId('gw-decide-ok').click();
  await toastOk(page);
  await expect(page.getByTestId(`rf-row-${refOf.get(D.id)}`)).toHaveCount(0);

  await page.getByTestId(`rf-approve-${refOf.get(E.id)}`).click();
  await owner.conn.reducers.adminRejectReferral({ id: refOf.get(E.id)!, note: '' });
  await page.getByTestId('gw-decide-ok').click();
  await expect(page.getByTestId('gw-decide').locator('.err-box')).toContainText('منتظر بررسی نیست');
  await page.getByTestId('gw-decide').getByRole('button', { name: 'انصراف' }).click();

  await page.getByTestId('rf-f-status').selectOption('');
  await expect(page.getByTestId(`rf-row-${refOf.get(C.id)}`)).toContainText('کامل‌شده');
  await expect(page.getByTestId(`rf-row-${refOf.get(C.id)}`)).toContainText(`بررسی شد ${S}`);
  await expect(page.getByTestId(`rf-row-${refOf.get(D.id)}`)).toContainText('ردشده');
  const after = await owner.conn.procedures.adminReferrals({ query: '', status: '', flag: '', flagged: false, referrerId: A.id, refereeId: 0n, page: 1, pageSize: 10 });
  expect(after.rows.find(x => x.referral.refereeId === C.id)?.referral.status).toBe('completed');
  expect(after.rows.find(x => x.referral.refereeId === D.id)?.referral.status).toBe('rejected');
  await page.getByTestId('rf-q').fill(codeA);
  await expect(page.getByTestId(`rf-row-${refOf.get(B.id)}`)).toBeVisible();
  await refSettings(orig);
});

test('referral tree: inviter chain, invited players and the id box', async ({ page }) => {
  const [A, B, C, D] = players;
  await open(page, `referral-tree?id=${B.id}`);
  await expect(page.getByTestId(`rt-up-${A.id}`)).toBeVisible();
  await expect(page.getByTestId('rt-me')).toContainText(fa(B.id));
  await page.getByTestId('rt-id').fill(fa(A.id));
  await page.getByTestId('rt-go').click();
  await expect(page).toHaveURL(new RegExp(`referral-tree\\?id=${A.id}`));
  await expect(page.getByTestId('rt-me')).toContainText(fa(codeA));
  await expect(page.getByTestId(`rt-down-${B.id}`)).toContainText('کامل‌شده');
  await expect(page.getByTestId(`rt-down-${C.id}`)).toContainText('کامل‌شده');
  await expect(page.getByTestId(`rt-down-${D.id}`)).toContainText('ردشده');
  await expect(page.getByTestId('rt-chain')).toContainText('کسی این بازیکن را دعوت نکرده');
  await page.getByTestId(`rt-down-${B.id}`).getByRole('link', { name: 'درخت دعوت' }).click();
  await expect(page).toHaveURL(new RegExp(`referral-tree\\?id=${B.id}`));
  await expect(page.getByTestId(`rt-up-${A.id}`)).toBeVisible();
});

test('player referral card', async ({ page }) => {
  const [A, B] = players;
  await open(page, `player?id=${A.id}`);
  const card = page.getByTestId('pd-referral');
  await expect(card.getByTestId('pr-code')).toHaveText(fa(codeA));
  await expect(card.getByTestId('pr-total')).toHaveText(fa(2));
  await expect(card.getByTestId('pr-completed')).toHaveText(fa(2));
  await expect(card.getByTestId('pr-by')).toContainText('کسی این بازیکن را دعوت نکرده');
  await open(page, `player?id=${B.id}`);
  await expect(page.getByTestId('pd-referral').getByTestId('pr-by')).toContainText(fa(A.id));
  await expect(page.getByTestId('pd-referral').getByTestId('pr-by')).toContainText('کامل‌شده');
  await page.getByTestId('pd-referral').getByTestId('pr-tree').click();
  await expect(page.getByTestId(`rt-up-${A.id}`)).toBeVisible();
  await open(page, `player?id=${A.id}`);
  await page.getByTestId('pd-referral').getByTestId('pr-list').click();
  await expect(page).toHaveURL(new RegExp(`referrals\\?referrer=${A.id}`));
  await expect(page.getByTestId(`rf-row-${refOf.get(B.id)}`)).toBeVisible();
});

async function newKey(page: Page, key: string, type: string, fill: (d: ReturnType<Page['getByTestId']>) => Promise<void>) {
  await page.getByTestId('rc-add').click();
  const d = page.getByTestId('rc-dialog');
  await d.locator('input[name="key"]').fill(key);
  await d.getByTestId('rc-type').selectOption(type);
  await d.locator('input[name="description"]').fill(`آزمایش ${type}`);
  await fill(d);
  await d.getByTestId('dialog-save').click();
  await expect(d).toHaveCount(0);
  await expect(page.getByTestId(`rc-row-${key}`)).toBeVisible();
}

test('remote config: typed keys, rules, conflict, preview, history, rollback, delete', async ({ page }) => {
  const [A] = players;
  await open(page, 'remote-config');
  await page.getByTestId('rc-add').click();
  const d0 = page.getByTestId('rc-dialog');
  await d0.locator('input[name="key"]').fill('Bad Key');
  await d0.getByTestId('dialog-save').click();
  await expect(d0.locator('.err-box')).toContainText('حرف کوچک');
  await d0.getByRole('button', { name: 'انصراف' }).click();

  await newKey(page, K.s, 'string', d => d.getByTestId('rc-value').fill('سلام دنیا'));
  await newKey(page, K.n, 'number', d => d.getByTestId('rc-value').fill('42'));
  await newKey(page, K.b, 'bool', d => d.getByTestId('rc-value').click());
  await newKey(page, K.j, 'json', async d => {
    await d.getByTestId('rc-value').fill('{bad');
    await expect(d.locator('.field-err')).toContainText('JSON درست نیست');
    await d.getByTestId('dialog-save').click();
    await expect(d.locator('.err-box')).toContainText('JSON درست نیست');
    await d.getByTestId('rc-value').fill('{"slots":3}');
  });
  await newKey(page, K.t, 'text', d => d.locator('textarea[name="value-fa"]').fill('خوش آمدی'));
  await expect(page.getByTestId('rc-table').getByTestId(`rc-val-${K.s}`)).toHaveText('سلام دنیا');
  await expect(page.getByTestId('rc-table').getByTestId(`rc-val-${K.n}`)).toHaveText(fa(42));
  await expect(page.getByTestId('rc-table').getByTestId(`rc-val-${K.b}`)).toContainText('روشن');
  await expect(page.getByTestId('rc-table').getByTestId(`rc-val-${K.j}`)).toHaveText('{"slots":3}');
  await expect(page.getByTestId('rc-table').getByTestId(`rc-val-${K.t}`)).toHaveText('خوش آمدی');
  await expect(page.getByTestId('rc-table').getByTestId(`rc-ver-${K.s}`)).toContainText('نسخهٔ ۱');
  const keys = [...owner.conn.db.adminConfigKeys.iter()];
  expect(keys.find(k => k.key === K.b)?.value).toBe('true');
  expect(keys.find(k => k.key === K.t)?.text[0]?.text).toBe('خوش آمدی');

  await page.getByTestId(`rc-edit-${K.s}`).click();
  const d = page.getByTestId('rc-dialog');
  await d.getByTestId('rc-rule-add').click();
  await d.getByTestId('rc-rule-add').click();
  await d.locator('input[name="rule-name-0"]').fill('ios_none');
  await d.getByTestId('rc-rule-0-value').fill('آی‌اواس');
  await d.getByTestId('rc-rule-0-pf-ios').click();
  await d.locator('input[name="rule-percent-0"]').fill('0');
  await d.locator('input[name="rule-name-1"]').fill('android_all');
  await d.getByTestId('rc-rule-1-value').fill('اندرویدی');
  await d.getByTestId('rc-rule-1-pf-android').click();
  await d.getByTestId('rc-rule-1-up').click();
  await expect(d.locator('input[name="rule-name-0"]')).toHaveValue('android_all');
  await d.getByTestId('rc-rule-add').click();
  await d.locator('input[name="rule-name-2"]').fill('android_all');
  await d.getByTestId('rc-rule-2-value').fill('x');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('یکتا');
  await d.getByTestId('rc-rule-2-del').click();
  await d.getByTestId('dialog-save').click();
  await expect(d).toHaveCount(0);
  await expect(page.getByTestId('rc-table').getByTestId(`rc-ver-${K.s}`)).toContainText('نسخهٔ ۲');
  await expect(page.getByTestId('rc-table').getByTestId(`rc-rules-${K.s}`)).toHaveText(fa(2));
  const saved = [...owner.conn.db.adminConfigKeys.iter()].find(k => k.key === K.s)!;
  expect(saved.rules.map(r => r.name)).toEqual(['android_all', 'ios_none']);
  expect(saved.rules[1].percent).toBe(0);
  expect(saved.rules[0].platforms).toEqual(['android']);

  await page.getByTestId(`rc-edit-${K.n}`).click();
  await expect(d.getByTestId('rc-version')).toContainText('نسخهٔ ۱');
  const n = [...owner.conn.db.adminConfigKeys.iter()].find(k => k.key === K.n)!;
  await owner.conn.reducers.adminSaveConfigKey({ key: n.key, version: n.version, type: n.type, description: n.description, value: '43', text: [], rules: [], isActive: true });
  await d.getByTestId('rc-value').fill('44');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('زودتر ذخیره');
  await d.getByRole('button', { name: 'انصراف' }).click();
  await expect(page.getByTestId('rc-table').getByTestId(`rc-val-${K.n}`)).toHaveText(fa(43));
  await expect(page.getByTestId('rc-table').getByTestId(`rc-ver-${K.n}`)).toContainText('نسخهٔ ۲');

  await page.getByTestId('rc-preview-open').click();
  const pv = page.getByTestId('rc-preview');
  await pv.getByTestId('pv-player').fill(fa(A.id));
  await pv.getByTestId('pv-platform').selectOption('android');
  await pv.getByTestId('pv-run').click();
  await expect(pv.getByTestId(`pv-variant-${K.s}`)).toHaveText('android_all');
  await expect(pv.getByTestId(`pv-row-${K.s}`)).toContainText('اندرویدی');
  await expect(pv.getByTestId(`pv-row-${K.t}`)).toContainText('خوش آمدی');
  await pv.getByTestId('pv-platform').selectOption('ios');
  await pv.getByTestId('pv-run').click();
  await expect(pv.getByTestId(`pv-variant-${K.s}`)).toHaveText('پیش‌فرض');
  await expect(pv.getByTestId(`pv-row-${K.s}`)).toContainText('سلام دنیا');
  await pv.getByTestId('pv-player').fill('999999999');
  await pv.getByTestId('pv-run').click();
  await expect(pv.locator('.err-box')).toBeVisible();
  await pv.getByRole('button', { name: 'بستن' }).click();

  await page.getByTestId(`rc-hist-${K.s}`).click();
  const h = page.getByTestId('rc-history');
  await expect(h.getByTestId(`rh-row-${K.s}-1`)).toContainText('ساخت');
  await expect(h.getByTestId(`rh-sum-${K.s}-2`)).toContainText('قانون‌ها: ۰ ← ۲');
  await expect(h.getByTestId(`rh-rollback-${K.s}-2`)).toHaveCount(0);
  await h.getByTestId(`rh-rollback-${K.s}-1`).click();
  await confirm(page);
  await toastOk(page);
  await expect(h.getByTestId(`rh-row-${K.s}-3`)).toContainText('بازگشت');
  await expect(h.getByTestId(`rh-sum-${K.s}-3`)).toContainText('قانون‌ها: ۲ ← ۰');
  await h.getByRole('button', { name: 'بستن' }).click();
  await expect(page.getByTestId('rc-table').getByTestId(`rc-ver-${K.s}`)).toContainText('نسخهٔ ۳');
  await expect(page.getByTestId('rc-table').getByTestId(`rc-rules-${K.s}`)).toContainText('ندارد');

  await page.getByTestId('rc-q').fill(`gw${S}.js`);
  await expect(page).toHaveURL(/q=gw/);
  await expect(page.getByTestId(`rc-row-${K.s}`)).toHaveCount(0);
  await expect(page.getByTestId(`rc-row-${K.j}`)).toBeVisible();
  await page.getByTestId('rc-q').fill('');
  for (const k of Object.values(K)) {
    await page.getByTestId(`rc-del-${k}`).click();
    await confirm(page);
    await expect(page.getByTestId(`rc-row-${k}`)).toHaveCount(0);
  }
  await page.getByTestId('rc-history-all').click();
  await expect(page.getByTestId('rc-history').getByTestId(`rh-row-${K.t}-1-del`)).toContainText('حذف');
  await page.getByTestId('rc-history').getByRole('button', { name: 'بستن' }).click();
});
