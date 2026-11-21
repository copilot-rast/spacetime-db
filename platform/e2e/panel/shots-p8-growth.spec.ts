import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ECONOMY_QUERIES, GAMIFICATION_QUERIES, PLAYER_QUERIES, SUPPORT_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, open, prefs, stamp, test, uniquePhone } from './fixtures.ts';

const DIR = '../.local/shots/panel8';
mkdirSync(DIR, { recursive: true });
const S = stamp();
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMIFICATION_QUERIES, ...SUPPORT_QUERIES];
const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];

type RefArgs = Parameters<Client['conn']['reducers']['adminSaveReferralSettings']>[0];
type Rule = Parameters<Client['conn']['reducers']['adminSaveConfigKey']>[0]['rules'][number];

let owner: Client;
let orig: RefArgs;
const players: { c: Client; id: bigint }[] = [];
const keys: string[] = [];

async function settle(page: Page) {
  await page.waitForTimeout(450);
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 8000 });
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: `${DIR}/growth-${name}.png` });
}

async function player(name: string) {
  const c = await connect(undefined, Q);
  const r = await login(c, uniquePhone('0936'));
  await c.conn.reducers.updateProfile({ displayName: name, lang: 'fa' });
  const p = { c, id: r.accountId };
  players.push(p);
  return p;
}

function current(): RefArgs {
  const s = [...owner.conn.db.adminReferralSettings.iter()][0]!;
  const { id: _i, updatedAt: _u, ...rest } = s;
  return rest;
}

async function refSettings(a: RefArgs) {
  await owner.conn.reducers.adminSaveReferralSettings(a);
  await waitFor(() => {
    const s = [...owner.conn.db.adminReferralSettings.iter()][0];
    return !!s && s.dailyPerReferrer === a.dailyPerReferrer && s.goalEventKey === a.goalEventKey && s.holdFlagged === a.holdFlagged;
  });
}

const rule = (p: Partial<Rule>): Rule => ({ name: 'r', value: '', text: [], platforms: [], minVersion: '', maxVersion: '', tagIds: [], countries: [], percent: 100, ...p });

async function key(k: string, type: string, description: string, value: string, rules: Rule[] = [], text: { lang: string; text: string }[] = [], isActive = true) {
  const old = [...owner.conn.db.adminConfigKeys.iter()].find(x => x.key === k);
  await owner.conn.reducers.adminSaveConfigKey({ key: k, version: old?.version ?? 0, type, description, value, text, rules, isActive });
  await waitFor(() => [...owner.conn.db.adminConfigKeys.iter()].some(x => x.key === k && x.version === (old?.version ?? 0) + 1));
  if (!keys.includes(k)) keys.push(k);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await waitFor(() => [...owner.conn.db.adminReferralSettings.iter()].length === 1);
  orig = current();
  const plain = { ...orig, isEnabled: true, newAccountDays: 7, referrerPrizeId: 0n, refereePrizeId: 0n, goalEventKey: '', goalMeasure: 'count', goalValue: 0, maxPerReferrer: 100, dailyPerReferrer: 10, holdFlagged: true, triesPerHour: 50 };
  await refSettings(plain);
  const A = await player('سارا محمدی');
  const B = await player('علی رضایی');
  const C = await player('مریم کریمی');
  const D = await player('رضا احمدی');
  const E = await player('نگار حسینی');
  const F = await player('امیر نوری');
  const code = async (p: { c: Client }) => (await p.c.conn.procedures.referralMe({ lang: 'fa' })).code;
  const codeA = await code(A);
  await B.c.conn.procedures.referralEnter({ code: codeA });
  await F.c.conn.procedures.referralEnter({ code: await code(B) });
  const ev = [...owner.conn.db.eventType.iter()][0];
  await refSettings({ ...plain, dailyPerReferrer: 2, goalEventKey: ev?.key ?? '', goalValue: ev ? 3 : 0 });
  for (const p of [C, D, E]) await p.c.conn.procedures.referralEnter({ code: codeA });
  const list = await owner.conn.procedures.adminReferrals({ query: '', status: 'held', flag: '', flagged: false, referrerId: A.id, refereeId: 0n, page: 1, pageSize: 10 });
  const e = list.rows.find(x => x.referral.refereeId === E.id);
  if (e) await owner.conn.reducers.adminRejectReferral({ id: e.referral.id, note: 'حساب تکراری از یک خانواده' });
  await refSettings(orig);

  const P = `demo${S}`;
  await key(`${P}.shop_banner`, 'text', 'متن بنر بالای فروشگاه', '', [rule({ name: 'ios_users', platforms: ['ios'], text: tr('پیشنهاد ویژهٔ آیفون', 'iPhone special') })], tr('حراج پاییزه شروع شد', 'Autumn sale is on'));
  await key(`${P}.daily_bonus`, 'number', 'سکهٔ جایزهٔ ورود روزانه', '50', [rule({ name: 'new_version', value: '80', minVersion: '2.4.0' }), rule({ name: 'half_android', value: '65', platforms: ['android'], percent: 50 })]);
  await key(`${P}.chat_enabled`, 'bool', 'گفتگوی عمومی در لابی', 'true', [rule({ name: 'web_off', value: 'false', platforms: ['web'] })]);
  await key(`${P}.matchmaking`, 'json', 'تنظیم صف بازی', '{"maxWait":30,"region":"auto"}');
  await key(`${P}.support_url`, 'string', 'نشانی صفحهٔ راهنما', 'https://help.example.com', [], [], false);
  await key(`${P}.daily_bonus`, 'number', 'سکهٔ جایزهٔ ورود روزانه', '60', [rule({ name: 'new_version', value: '80', minVersion: '2.4.0' }), rule({ name: 'half_android', value: '65', platforms: ['android'], percent: 50 })]);
  await key(`${P}.daily_bonus`, 'number', 'سکهٔ جایزهٔ ورود روزانه', '60', [rule({ name: 'new_version', value: '80', minVersion: '2.4.0' })]);
});

test.afterAll(async () => {
  if (orig) await owner?.conn.reducers.adminSaveReferralSettings(orig).catch(() => {});
  for (const k of keys) await owner?.conn.reducers.adminDeleteConfigKey({ key: k }).catch(() => {});
  owner?.conn.disconnect();
  for (const p of players) p.c.conn.disconnect();
});

test('growth screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  const [A, B, , D, , F] = players;
  await open(page, 'settings/referral-settings');
  await expect(page.getByTestId('gw-settings')).toBeVisible();
  await shot(page, 'settings');

  await open(page, `referrals?referrer=${A.id}`);
  await expect(page.getByTestId('rf-table')).toBeVisible();
  await shot(page, 'referrals');
  const held = await owner.conn.procedures.adminReferrals({ query: '', status: '', flag: '', flagged: false, referrerId: 0n, refereeId: D.id, page: 1, pageSize: 1 });
  const dId = held.rows[0]?.referral.id;
  if (dId && held.rows[0].referral.status === 'held') {
    await page.getByTestId(`rf-approve-${dId}`).click();
    await page.getByTestId('gw-decide-note').fill('دو حساب از یک دستگاه؛ با بازیکن تماس گرفته شد');
    await shot(page, 'decide');
    await page.getByTestId('gw-decide').getByRole('button', { name: 'انصراف' }).click();
  }
  await open(page, 'referrals');
  await shot(page, 'referrals-all');

  await open(page, `referral-tree?id=${F.id}`);
  await expect(page.getByTestId(`rt-up-${A.id}`)).toBeVisible();
  await shot(page, 'tree');
  await open(page, `referral-tree?id=${A.id}`);
  await expect(page.getByTestId(`rt-down-${B.id}`)).toBeVisible();
  await shot(page, 'tree-inviter');
  await open(page, 'referral-tree');
  await shot(page, 'tree-empty');

  await open(page, `player?id=${B.id}`);
  await page.getByTestId('pd-referral').scrollIntoViewIfNeeded();
  await settle(page);
  await page.getByTestId('pd-referral').screenshot({ path: `${DIR}/growth-player-card.png` });

  await open(page, 'remote-config');
  await page.getByTestId('rc-q').fill(`demo${S}`);
  await expect(page.getByTestId(`rc-row-demo${S}.daily_bonus`)).toBeVisible();
  await shot(page, 'remote-config');
  await page.getByTestId(`rc-edit-demo${S}.daily_bonus`).click();
  await page.getByTestId('rc-dialog').getByTestId('rc-rule-add').click();
  await page.getByTestId('rc-dialog').getByTestId('rc-rule-1-pf-android').click();
  await shot(page, 'config-edit');
  await page.getByTestId('rc-dialog').locator('.dialog-body').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await shot(page, 'config-edit-rules');
  await page.getByTestId('rc-dialog').getByRole('button', { name: 'انصراف' }).click();
  await page.getByTestId('rc-add').click();
  await page.getByTestId('rc-dialog').getByTestId('rc-type').selectOption('json');
  await page.getByTestId('rc-dialog').getByTestId('rc-value').fill('{"maxWait": 30,');
  await shot(page, 'config-new-json');
  await page.getByTestId('rc-dialog').getByRole('button', { name: 'انصراف' }).click();
  await page.getByTestId(`rc-hist-demo${S}.daily_bonus`).click();
  await expect(page.getByTestId('rc-history').locator('.list-row').first()).toBeVisible();
  await shot(page, 'config-history');
  await page.getByTestId('rc-history').getByRole('button', { name: 'بستن' }).click();
  await page.getByTestId('rc-preview-open').click();
  await page.getByTestId('pv-player').fill(String(B.id));
  await page.getByTestId('pv-platform').selectOption('ios');
  await page.getByTestId('pv-version').fill('2.5.0');
  await page.getByTestId('pv-run').click();
  await expect(page.getByTestId('pv-result')).toBeVisible();
  await shot(page, 'config-preview');
  await page.getByTestId('rc-preview').getByRole('button', { name: 'بستن' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, `referrals?referrer=${A.id}`);
  await shot(page, 'referrals-mobile');
  await open(page, 'remote-config');
  await shot(page, 'remote-config-mobile');
  await page.setViewportSize({ width: 1280, height: 800 });

  await prefs(page, 'en', 'light');
  await open(page, `referrals?referrer=${A.id}`);
  await shot(page, 'referrals-en');
  await open(page, 'remote-config');
  await page.getByTestId('rc-q').fill(`demo${S}`);
  await shot(page, 'remote-config-en');
  await open(page, `referral-tree?id=${F.id}`);
  await shot(page, 'tree-en');
  await open(page, 'settings/referral-settings');
  await shot(page, 'settings-en');
  await prefs(page, 'fa', 'light');
});
