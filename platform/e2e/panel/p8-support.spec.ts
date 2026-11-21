import type { Page } from '@playwright/test';
import { PLAYER_QUERIES, SUPPORT_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, freshPage, open, stamp, test, toastOk, uniquePhone } from './fixtures.ts';

const S = stamp();
const fa = (s: string | number | bigint) => String(s).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const tr = (t: string) => [{ lang: 'fa', text: t }];
const Q = [...PLAYER_QUERIES, ...SUPPORT_QUERIES];

test.describe.configure({ mode: 'serial' });

let owner: Client;
let ownerId = 0n;
let player: { c: Client; id: bigint };
let sp: Page;
let supId = 0n;
let ticketId = 0n;
let cannedId = 0n;
const username = `sx${S}`;
const password = `Support${S}pw`;

async function confirm(page: Page) {
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
}

async function save(page: Page, id: string) {
  await page.getByTestId(id).last().getByTestId('dialog-save').click();
  await expect(page.getByTestId(id)).toHaveCount(0);
}

test.beforeAll(async () => {
  owner = await connect(undefined, Q);
  ownerId = (await loginOwner(owner)).accountId;
  await owner.conn.reducers.adminCreateUser({ username, password, role: 'support' });
  await waitFor(() => [...owner.conn.db.adminAdmins.iter()].some(a => a.username === username));
  supId = [...owner.conn.db.adminAdmins.iter()].find(a => a.username === username)!.accountId;
  await owner.conn.reducers.adminSaveSupportCanned({ id: 0n, key: `cn${S}`, title: tr(`تشکر ${S}`), body: tr(`از صبر شما ممنونیم ${S}`), departmentId: 0n, isActive: true, sort: 0 });
  await waitFor(() => [...owner.conn.db.adminSupportCanned.iter()].some(x => x.key === `cn${S}`));
  cannedId = [...owner.conn.db.adminSupportCanned.iter()].find(x => x.key === `cn${S}`)!.id;
  const pc = await connect(undefined, Q);
  const res = await login(pc, uniquePhone('0939'));
  player = { c: pc, id: res.accountId };
  const tk = await pc.conn.procedures.supportTicketCreate({
    subject: `پرداخت ناموفق ${S}`,
    departmentKey: '',
    body: `پول کم شد ولی سکه نیامد ${S}`,
    attachments: [{ url: `https://cdn.example.com/r${S}.png`, name: 'receipt.png', type: '', size: 2048 }],
  });
  ticketId = tk.ticketId;
});

test.afterAll(async () => {
  if (cannedId) await owner?.conn.reducers.adminDeleteSupportCanned({ id: cannedId }).catch(() => {});
  await owner?.conn.reducers.adminSetSupportClockOffset({ seconds: 0n }).catch(() => {});
  if (supId) await owner?.conn.reducers.adminDeleteUser({ accountId: supId }).catch(() => {});
  owner?.conn.disconnect();
  player?.c.conn.disconnect();
});

test('support user logs in and sees only the support menu and summary', async ({ page }) => {
  sp = await freshPage(page.context().browser()!);
  await sp.goto('/');
  await sp.locator('#c-db').fill(process.env.STG_DB!);
  await sp.getByTestId('connect-go').click();
  await sp.locator('#l-user').fill(username);
  await sp.locator('#l-pass').fill(password);
  await sp.getByTestId('login-pass-go').click();
  await expect(sp.locator('.rail')).toBeVisible();
  await expect(sp.getByTestId('support-summary')).toBeVisible();
  await expect(sp.getByTestId('sx-tile-awaiting')).toBeVisible();
  await expect(sp.getByTestId('rail-support')).toBeVisible();
  for (const id of ['economy', 'publication', 'players', 'growth', 'social', 'access']) await expect(sp.getByTestId(`rail-${id}`)).toHaveCount(0);
  await sp.getByTestId('rail-support').click();
  for (const id of ['tickets', 'live-chat', 'activity', 'support-departments', 'canned-replies']) await expect(sp.getByTestId(`side-${id}`)).toBeVisible();
  await expect(sp.getByTestId('dp-add')).toHaveCount(0);
  await sp.getByTestId('side-canned-replies').click();
  await expect(sp.getByTestId(`cr-row-cn${S}`)).toContainText(`تشکر ${S}`);
  await expect(sp.getByTestId('cr-add')).toHaveCount(0);
  await expect(sp.getByTestId(`cr-edit-cn${S}`)).toHaveCount(0);
});

test('support replies to a player ticket, adds a note, uses a canned reply and resolves it', async () => {
  await open(sp, `tickets?status=all&player=${player.id}`);
  const row = sp.getByTestId(`tk-row-${ticketId}`);
  await expect(row).toContainText(`پرداخت ناموفق ${S}`);
  await expect(row).toContainText('باز');
  await expect(sp.getByTestId('tk-f-player')).toContainText(fa(player.id));
  await sp.getByTestId('tk-f-status').selectOption('waiting');
  await expect(row).toBeVisible();
  await sp.getByTestId('tk-f-status').selectOption('resolved');
  await expect(row).toHaveCount(0);
  await sp.getByTestId('tk-f-status').selectOption('all');
  await sp.getByTestId(`tk-open-${ticketId}`).click();
  await expect(sp.getByTestId('page-ticket')).toBeVisible();
  const thread = sp.getByTestId('tk-messages');
  await expect(thread).toContainText(`پول کم شد ولی سکه نیامد ${S}`);
  await expect(thread.getByTestId('sx-file')).toHaveAttribute('href', `https://cdn.example.com/r${S}.png`);
  await expect(sp.getByTestId('tk-player-name')).toContainText(fa(player.id));
  await expect(sp.getByTestId('tk-player-total')).toHaveText('۱');
  await sp.getByTestId('tk-canned').click();
  await sp.getByTestId(`tk-canned-cn${S}`).click();
  await expect(sp.getByTestId('tk-reply-body')).toHaveValue(`از صبر شما ممنونیم ${S}`);
  await sp.getByTestId('tk-reply-body').fill(`سلام، بررسی کردیم ${S}`);
  await sp.getByTestId('tk-reply-send').click();
  await toastOk(sp);
  await expect(thread.locator('.sx-msg.from-staff')).toContainText(`سلام، بررسی کردیم ${S}`);
  await expect(sp.getByTestId('tk-status')).toContainText('منتظر بازیکن');
  await expect(sp.getByTestId('tk-assignee')).toHaveValue(String(supId));
  await expect(thread).toContainText('سپرده شد');
  expect(await waitFor(() => [...player.c.conn.db.myTicketMessages.iter()].some(m => m.ticketId === ticketId && m.authorType === 'staff' && m.body === `سلام، بررسی کردیم ${S}`), 5000)).toBe(true);
  await sp.getByTestId('tk-reply').locator('.seg button').nth(1).click();
  await sp.getByTestId('tk-reply-body').fill(`یادداشت: تراکنش را با بانک چک کنید ${S}`);
  await sp.getByTestId('tk-reply-send').click();
  await expect(thread.locator('.sx-msg.is-note')).toContainText(`تراکنش را با بانک چک کنید ${S}`);
  await expect(thread.locator('.sx-msg.is-note')).toContainText('یادداشت داخلی');
  expect([...player.c.conn.db.myTicketMessages.iter()].some(m => m.body.includes('تراکنش را با بانک'))).toBe(false);
  await player.c.conn.reducers.supportTicketReply({ ticketId, body: `هنوز نیامده ${S}`, attachments: [] });
  await expect(thread).toContainText(`هنوز نیامده ${S}`);
  await expect(sp.getByTestId('tk-status')).toContainText('منتظر پشتیبان');
  await sp.getByTestId('tk-priority').selectOption('urgent');
  await expect(thread).toContainText('اولویت شد «فوری»');
  await sp.getByTestId('tk-move').selectOption('resolved');
  await expect(sp.getByTestId('tk-status')).toContainText('حل شده');
  await expect(thread).toContainText('وضعیت شد «حل شده»');
  await sp.getByTestId('tk-move').selectOption('awaiting_staff');
  await expect(sp.getByTestId('tk-status')).toContainText('منتظر پشتیبان');
  await sp.getByTestId('tk-move').selectOption('closed');
  await expect(sp.getByTestId('tk-status')).toContainText('بسته');
  await sp.getByTestId('tk-reply').locator('.seg button').nth(0).click();
  await expect(sp.getByTestId('tk-reply')).toContainText('این تیکت بسته است');
  await expect(sp.getByTestId('tk-reply-body')).toBeDisabled();
  await expect(sp.getByTestId('tk-reply-send')).toBeDisabled();
  await player.c.conn.reducers.supportTicketRate({ ticketId, rating: 4, comment: `سریع بود ${S}` });
  await expect(sp.getByTestId('tk-rating')).toContainText(`سریع بود ${S}`);
  await expect(sp.getByTestId('tk-rating')).toContainText('۴ از ۵');
});

test('support creates a ticket for a player from the inbox', async () => {
  await open(sp, 'tickets');
  await sp.getByTestId('tk-add').click();
  const d = sp.getByTestId('tk-new-dialog');
  await d.getByTestId('tk-new-subject').fill(`پیگیری خرید ${S}`);
  await d.getByTestId('tk-new-body').fill(`سکه‌های شما برگشت داده شد ${S}`);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('شمارهٔ بازیکن');
  await d.getByTestId('tk-new-player').fill(fa(player.id));
  await d.getByTestId('tk-new-files').fill('https://cdn.example.com/bad.exe');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('png');
  await d.getByTestId('tk-new-files').fill('');
  await d.getByTestId('tk-new-priority').selectOption('high');
  await save(sp, 'tk-new-dialog');
  await expect(sp.getByTestId('page-ticket')).toBeVisible();
  await expect(sp.locator('.page-title')).toHaveText(`پیگیری خرید ${S}`);
  await expect(sp.getByTestId('tk-status')).toContainText('منتظر بازیکن');
  await expect(sp.getByTestId('tk-messages')).toContainText('پشتیبان این تیکت را ساخت');
  expect(await waitFor(() => [...player.c.conn.db.myTickets.iter()].some(x => x.subject === `پیگیری خرید ${S}`), 5000)).toBe(true);
  await open(sp, `tickets?status=all&player=${player.id}&assignee=me&priority=high`);
  await expect(sp.getByTestId('tk-table').locator('tbody tr')).toHaveCount(1);
  await expect(sp.getByTestId('tk-table')).toContainText(`پیگیری خرید ${S}`);
});

test('support takes a live chat, sees typing, replies, hands it over and closes it to a ticket', async () => {
  await owner.conn.reducers.adminSupportHeartbeat({ away: false });
  const opened = await player.c.conn.procedures.supportChatOpen({ topic: `خرید ${S}`, body: `سلام، خریدم نرسید ${S}`, departmentKey: '' });
  const chatId = opened.chatId;
  await open(sp, 'live-chat');
  await expect(sp.getByTestId('lc-presence')).toBeVisible();
  await expect(sp.getByTestId(`lc-agent-${supId}`)).toHaveAttribute('data-state', 'on');
  await sp.getByTestId(`lc-chat-${chatId}`).click();
  const panel = sp.getByTestId('lc-panel');
  await expect(panel.getByTestId('lc-messages')).toContainText(`سلام، خریدم نرسید ${S}`);
  await expect(panel.getByTestId('lc-status')).toContainText('در صف');
  await panel.getByTestId('lc-take').click();
  await toastOk(sp);
  await expect(panel.getByTestId('lc-status')).toContainText('با شما');
  await expect(panel.getByTestId('lc-messages')).toContainText('گفتگو را پذیرفت');
  await player.c.conn.reducers.supportChatSend({ chatId, body: `کد سفارش ۱۲۳ ${S}` });
  await expect(panel.getByTestId('lc-messages')).toContainText(`کد سفارش ۱۲۳ ${S}`);
  await player.c.conn.reducers.supportChatTyping({ chatId });
  await expect(panel.getByTestId('lc-typing')).toContainText('در حال نوشتن');
  await expect(panel.getByTestId('lc-typing')).not.toContainText('در حال نوشتن', { timeout: 9000 });
  await panel.getByTestId('lc-input').fill(`در حال بررسی ${S}`);
  expect(await waitFor(() => ([...player.c.conn.db.myChats.iter()].find(c => c.id === chatId)?.agentTypingAt ?? 0n) > 0n, 5000)).toBe(true);
  await panel.getByTestId('lc-input').press('Enter');
  await expect(panel.getByTestId('lc-input')).toHaveValue('');
  expect(await waitFor(() => [...player.c.conn.db.myChatMessages.iter()].some(m => m.chatId === chatId && m.authorType === 'agent' && m.body === `در حال بررسی ${S}`), 5000)).toBe(true);
  expect(
    await waitFor(() => {
      const c = [...player.c.conn.db.myChats.iter()].find(x => x.id === chatId);
      return !!c && c.agentReadSeq >= 3;
    }, 5000)
  ).toBe(true);
  await expect(panel.locator('[data-testid^="lc-read-"]')).toHaveCount(0);
  await player.c.conn.reducers.supportChatSeen({ chatId });
  await expect(panel.locator('[data-testid^="lc-read-"]').first()).toContainText('خوانده شد');
  await panel.getByTestId('lc-transfer').click();
  const td = sp.getByTestId('lc-transfer-dialog');
  await td.getByTestId('lc-transfer-queue').click();
  await expect(td).toHaveCount(0);
  await expect(panel.getByTestId('lc-status')).toContainText('در صف');
  await panel.getByTestId('lc-take').click();
  await expect(panel.getByTestId('lc-status')).toContainText('با شما');
  await panel.getByTestId('lc-transfer').click();
  await td.getByTestId(`lc-transfer-${ownerId}`).click();
  await expect(td).toHaveCount(0);
  await expect(panel.getByTestId('lc-status')).not.toContainText('با شما');
  await expect(panel.getByTestId('lc-messages')).toContainText('گفتگو به');
  await expect(panel.getByTestId('lc-input')).toHaveCount(0);
  await owner.conn.reducers.adminChatTransfer({ chatId, toAgentId: supId });
  await expect(panel.getByTestId('lc-status')).toContainText('با شما');
  await sp.getByTestId('lc-list').locator('.seg button').nth(1).click();
  await expect(sp.getByTestId(`lc-chat-${chatId}`)).toBeVisible();
  await panel.getByTestId('lc-close-ticket').click();
  await confirm(sp);
  await expect(sp.locator('.toast-ok').last()).toContainText('تیکت');
  await expect(panel.getByTestId('lc-status')).toContainText('بسته');
  await expect(sp.getByTestId(`lc-chat-${chatId}`)).toBeVisible();
  const link = panel.getByTestId('lc-ticket-link');
  await expect(link).toBeVisible();
  expect(await waitFor(() => !![...player.c.conn.db.myChats.iter()].find(c => c.id === chatId)?.ticketNumber, 5000)).toBe(true);
  await link.click();
  await expect(sp.getByTestId('page-ticket')).toBeVisible();
  await expect(sp.getByTestId('tk-messages')).toContainText(`کد سفارش ۱۲۳ ${S}`);
  await expect(sp.getByTestId('tk-messages')).toContainText('از گفتگوی زندهٔ');
  await expect(sp.getByTestId('tk-details')).toContainText('از گفتگوی زنده');
});

test('support settings are read-only for support', async () => {
  await sp.goto('/#/settings/support-settings');
  const st = sp.getByTestId('sx-settings');
  await expect(st).toBeVisible();
  await expect(st.locator('input[name="maxOpenTickets"]')).toBeDisabled();
  await expect(st.getByTestId('sx-s-save')).toHaveCount(0);
  await expect(st.getByTestId('sx-s-run')).toHaveCount(0);
  await expect(st).toContainText('فقط مدیرها');
});

test('admin: departments create, edit and delete', async ({ page }) => {
  await open(page, 'support-departments');
  await page.getByTestId('dp-add').click();
  const d = page.getByTestId('dp-dialog');
  await d.locator('input[name="key"]').fill(`dp${S}`);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('زبان پیش‌فرض');
  await d.locator('input[name="name-fa"]').fill(`فروشگاه ${S}`);
  await d.locator('input[name="firstResponseHours"]').fill('0');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('۷۲۰');
  await d.locator('input[name="firstResponseHours"]').fill('۶');
  await d.getByTestId(`dp-agent-${supId}`).click();
  await d.getByTestId('dp-auto').click();
  await save(page, 'dp-dialog');
  const row = page.getByTestId(`dp-row-dp${S}`);
  await expect(row).toContainText(`فروشگاه ${S}`);
  await expect(row).toContainText('۶ ساعت');
  await expect(row).toContainText('خودکار');
  await page.getByTestId(`dp-edit-dp${S}`).click();
  await expect(d.locator('input[name="key"]')).toBeDisabled();
  await d.locator('input[name="name-fa"]').fill(`فروشگاه و خرید ${S}`);
  await d.getByTestId('dp-auto').click();
  await save(page, 'dp-dialog');
  await expect(row).toContainText(`فروشگاه و خرید ${S}`);
  await expect(row).toContainText('دستی');
  await page.getByTestId(`dp-del-dp${S}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('admin: canned replies create, edit and delete', async ({ page }) => {
  await open(page, 'canned-replies');
  await page.getByTestId('cr-add').click();
  const d = page.getByTestId('cr-dialog');
  await d.locator('input[name="key"]').fill(`cr${S}`);
  await d.locator('input[name="title-fa"]').fill(`درخواست رسید ${S}`);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('زبان پیش‌فرض');
  await d.locator('textarea[name="body-fa"]').fill(`لطفاً تصویر رسید پرداخت را بفرستید ${S}`);
  const general = [...owner.conn.db.adminSupportDepartments.iter()].find(x => x.isActive);
  if (general) await d.getByTestId('cr-dept').selectOption(String(general.id));
  await save(page, 'cr-dialog');
  const row = page.getByTestId(`cr-row-cr${S}`);
  await expect(row).toContainText(`درخواست رسید ${S}`);
  await expect(row).toContainText('لطفاً تصویر رسید');
  await page.getByTestId(`cr-edit-cr${S}`).click();
  await d.getByTestId('cr-dept').selectOption('0');
  await d.getByTestId('cr-active').click();
  await save(page, 'cr-dialog');
  await expect(row).toContainText('همهٔ بخش‌ها');
  await expect(row).toContainText('غیرفعال');
  await page.getByTestId(`cr-del-cr${S}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('admin: support settings save, translated INVALID_SETTING, run now and the test clock', async ({ page }) => {
  await open(page, 'settings/support-settings');
  const st = page.getByTestId('sx-settings');
  const input = st.locator('input[name="maxOpenTickets"]');
  const before = await input.inputValue();
  await input.fill('0');
  await st.getByTestId('sx-s-save').click();
  await expect(st.locator('.err-box')).toContainText('مقدار «بیشترین تیکت باز هر بازیکن» درست نیست');
  await input.fill('۱۲');
  await st.getByTestId('sx-s-save').click();
  await toastOk(page);
  await expect(st.locator('.err-box')).toHaveCount(0);
  expect([...owner.conn.db.adminSupportSettings.iter()][0].maxOpenTickets).toBe(12);
  await input.fill(before);
  await st.getByTestId('sx-s-save').click();
  await expect.poll(() => String([...owner.conn.db.adminSupportSettings.iter()][0].maxOpenTickets)).toBe(before.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))));
  await st.getByTestId('sx-s-run').click();
  await expect(page.locator('.toast-ok').last()).toContainText('تیکت');
  await st.getByTestId('sx-s-clock-fwd').click();
  await expect.poll(() => [...owner.conn.db.adminSupportSettings.iter()][0].clockOffsetSec).toBe(86400n);
  await expect(st.getByTestId('sx-s-clock-reset')).toBeEnabled();
  await st.getByTestId('sx-s-clock-reset').click();
  await expect.poll(() => [...owner.conn.db.adminSupportSettings.iter()][0].clockOffsetSec).toBe(0n);
});

test('activity: filters on the activity page and the player card link', async ({ page }) => {
  await open(page, `activity?player=${player.id}`);
  const table = page.getByTestId('act-table');
  await expect(table).toContainText('ثبت‌نام کرد');
  await expect(table).toContainText('ساخته شد');
  await expect(table).toContainText('گفتگوی پشتیبانی');
  await expect(page.getByTestId('act-summary')).not.toContainText(/[0-9]/);
  await page.getByTestId('act-kind-ticket').click();
  await expect(table).not.toContainText('ثبت‌نام کرد');
  await expect(table).toContainText('حل شد');
  await expect(table).toContainText('شماره');
  await page.getByTestId('act-action').selectOption('closed');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await page.getByTestId('act-clear').click();
  await page.getByTestId('act-player').fill(String(player.id));
  await page.getByTestId('act-kind-login').click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('خود بازیکن');
  await page.getByTestId('act-from').fill('2099-01-01T00:00');
  await expect(table).toContainText('فعالیتی پیدا نشد');
  await open(page, `player?id=${player.id}`);
  const card = page.getByTestId('pd-activity');
  await expect(card.getByTestId('pa-list')).toContainText('بسته شد');
  await expect(card.getByTestId('pa-list')).toContainText(username);
  await card.getByTestId('pa-all').click();
  await expect(page.getByTestId('page-activity')).toBeVisible();
  await expect(page.getByTestId('act-player')).toHaveValue(fa(player.id));
});

test('mobile: the tickets list turns into cards without horizontal scroll', async () => {
  await sp.setViewportSize({ width: 390, height: 844 });
  await open(sp, `tickets?status=all&player=${player.id}`);
  await expect(sp.getByTestId(`tkc-${ticketId}`)).toBeVisible();
  await expect(sp.getByTestId('tk-table')).toBeHidden();
  const over = await sp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  await sp.setViewportSize({ width: 1280, height: 800 });
});
