import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PLAYER_QUERIES, SUPPORT_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, freshPage, open, prefs, stamp, test, uniquePhone } from './fixtures.ts';

const DIR = '../.local/shots/panel8';
mkdirSync(DIR, { recursive: true });
const S = stamp();
const Q = [...PLAYER_QUERIES, ...SUPPORT_QUERIES];

test.describe.configure({ mode: 'serial' });

let owner: Client;
const players: { c: Client; id: bigint }[] = [];
let mainTicket = 0n;
let activeChat = 0n;
const chats: bigint[] = [];
let supId = 0n;
const username = `shot${S}`;
const password = `Shots${S}pw`;

async function settle(page: Page) {
  await page.waitForTimeout(450);
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 8000 });
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: `${DIR}/support-${name}.png` });
}

test.beforeAll(async () => {
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await owner.conn.reducers.adminCreateUser({ username, password, role: 'support' });
  await waitFor(() => [...owner.conn.db.adminAdmins.iter()].some(a => a.username === username));
  supId = [...owner.conn.db.adminAdmins.iter()].find(a => a.username === username)!.accountId;
  await owner.conn.reducers.adminSupportHeartbeat({ away: false });
  const names = ['سارا رحیمی', 'علی کریمی', 'مینا تهرانی'];
  for (const [i, name] of names.entries()) {
    const c = await connect(undefined, Q);
    const r = await login(c, uniquePhone('0936'));
    await c.conn.reducers.updateProfile({ displayName: name, lang: 'fa' });
    await c.conn.reducers.setMyClient({ platform: i === 1 ? 'ios' : 'android', appVersion: '2.4.1' });
    players.push({ c, id: r.accountId });
  }
  const [a, b, m] = players;
  const t1 = await a.c.conn.procedures.supportTicketCreate({
    subject: 'سکه‌های خریدم به حساب نیامد',
    departmentKey: '',
    body: 'سلام، دیروز بستهٔ ۵۰۰ سکه را خریدم و پولش از کارتم کم شد ولی سکه‌ها نیامد. تصویر رسید را پیوست کردم.',
    attachments: [{ url: 'https://cdn.example.com/receipts/r-5821.png', name: 'رسید پرداخت.png', type: '', size: 182_000 }],
  });
  mainTicket = t1.ticketId;
  await owner.conn.reducers.adminSupportReply({ ticketId: mainTicket, body: 'سلام سارا جان، ممنون از پیامت. پرداخت را پیدا کردیم و در حال بررسی است.', internal: false, status: '', attachments: [] });
  await owner.conn.reducers.adminSupportReply({ ticketId: mainTicket, body: 'شمارهٔ پیگیری بانک با سفارش ۵۸۲۱ می‌خواند؛ باید دستی سکه بدهیم.', internal: true, status: '', attachments: [] });
  await a.c.conn.reducers.supportTicketReply({ ticketId: mainTicket, body: 'ممنون، منتظرم. اگر امروز درست شود عالی است.', attachments: [] });
  await owner.conn.reducers.adminSupportAssign({ ticketId: mainTicket, assigneeId: 0n, departmentId: 0n, priority: 'high' });
  const t2 = await b.c.conn.procedures.supportTicketCreate({ subject: 'بازی روی گوشی من باز نمی‌شود', departmentKey: '', body: 'بعد از به‌روزرسانی، بازی در صفحهٔ بارگذاری می‌ماند.', attachments: [] });
  await owner.conn.reducers.adminSupportAssign({ ticketId: t2.ticketId, assigneeId: 0n, departmentId: 0n, priority: 'urgent' });
  const t3 = await m.c.conn.procedures.supportTicketCreate({ subject: 'پیشنهاد برای مرحلهٔ تازه', departmentKey: '', body: 'کاش یک حالت گروهی هم داشته باشید.', attachments: [] });
  await owner.conn.reducers.adminSupportReply({ ticketId: t3.ticketId, body: 'ممنون از پیشنهاد خوبت، به تیم بازی رساندیم.', internal: false, status: 'resolved', attachments: [] });
  await m.c.conn.reducers.supportTicketRate({ ticketId: t3.ticketId, rating: 5, comment: 'خیلی سریع جواب دادید' });
  await owner.conn.procedures.adminSupportCreateTicket({
    accountId: b.id,
    subject: 'بازگشت هزینهٔ خرید تکراری',
    body: 'خرید دوم شما برگشت داده شد. اگر سؤالی دارید همین‌جا بنویسید.',
    departmentId: 0n,
    priority: 'low',
    attachments: [],
  });
  const c1 = await b.c.conn.procedures.supportChatOpen({ topic: 'جایزهٔ رویداد', body: 'سلام، جایزهٔ رویداد دیروز را نگرفتم', departmentKey: '' });
  chats.push(c1.chatId);
  const c2 = await a.c.conn.procedures.supportChatOpen({ topic: 'تغییر شمارهٔ تلفن', body: 'می‌خواهم شمارهٔ حسابم را عوض کنم', departmentKey: '' });
  activeChat = c2.chatId;
  chats.push(c2.chatId);
  await owner.conn.reducers.adminChatTake({ chatId: activeChat });
  await owner.conn.reducers.adminChatSend({ chatId: activeChat, body: 'سلام، حتماً. شمارهٔ تازه را بنویسید تا کد تأیید بفرستیم.' });
  await a.c.conn.reducers.supportChatSend({ chatId: activeChat, body: 'شمارهٔ تازه ۰۹۱۲۰۰۰۰۰۰۰ است' });
});

test.afterAll(async () => {
  for (const id of chats) await owner?.conn.procedures.adminChatClose({ chatId: id, toTicket: false }).catch(() => {});
  await owner?.conn.reducers.adminSupportFocus({ ticketId: 0n, chatId: 0n }).catch(() => {});
  if (supId) await owner?.conn.reducers.adminDeleteUser({ accountId: supId }).catch(() => {});
  owner?.conn.disconnect();
  for (const p of players) p.c.conn.disconnect();
});

test('player card on the player page', async ({ page }) => {
  await open(page, `player?id=${players[0].id}`);
  const card = page.getByTestId('pd-activity');
  await card.scrollIntoViewIfNeeded();
  await settle(page);
  await card.screenshot({ path: `${DIR}/support-player-card.png` });
});

test('tickets inbox, new ticket dialog and ticket page', async ({ page }) => {
  await open(page, 'tickets');
  await expect(page.getByTestId(`tk-row-${mainTicket}`)).toBeVisible();
  await shot(page, 'tickets');
  await page.getByTestId('tk-add').click();
  await page.getByTestId('tk-new-subject').fill('پیگیری پرداخت ناموفق');
  await shot(page, 'tickets-new');
  await page.keyboard.press('Escape');
  await open(page, `ticket?id=${mainTicket}`);
  await expect(page.getByTestId('tk-messages')).toContainText('منتظرم');
  await shot(page, 'ticket');
  await page.getByTestId('tk-reply').locator('.seg button').nth(1).click();
  await page.getByTestId('tk-reply-body').fill('با بانک تماس گرفتم، فردا جواب می‌دهند.');
  await page.getByTestId('tk-canned').click();
  await shot(page, 'ticket-note-canned');
  await page.keyboard.press('Escape');
});

test('live chat console and transfer dialog', async ({ page }) => {
  await open(page, `live-chat?tab=mine&chat=${activeChat}`);
  await expect(page.getByTestId('lc-messages')).toContainText('شمارهٔ تازه');
  await players[0].c.conn.reducers.supportChatTyping({ chatId: activeChat });
  await expect(page.getByTestId('lc-typing')).toContainText('در حال نوشتن');
  await shot(page, 'live-chat');
  await page.getByTestId('lc-transfer').click();
  await shot(page, 'live-chat-transfer');
  await page.keyboard.press('Escape');
  await open(page, `live-chat?tab=queue&chat=${chats[0]}`);
  await expect(page.getByTestId('lc-take')).toBeVisible();
  await shot(page, 'live-chat-queue');
});

test('departments, canned replies and their dialogs', async ({ page }) => {
  await open(page, 'support-departments');
  await shot(page, 'departments');
  await page.getByTestId('dp-add').click();
  await shot(page, 'department-dialog');
  await page.keyboard.press('Escape');
  await open(page, 'canned-replies');
  await shot(page, 'canned');
  await page.getByTestId('cr-add').click();
  await shot(page, 'canned-dialog');
  await page.keyboard.press('Escape');
});

test('settings section and activity page', async ({ page }) => {
  await open(page, 'settings/support-settings');
  await expect(page.getByTestId('sx-settings')).toBeVisible();
  await shot(page, 'settings');
  await page.locator('.win-scroll').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await shot(page, 'settings-bottom');
  await open(page, 'activity');
  await shot(page, 'activity');
  await open(page, `activity?player=${players[0].id}&kinds=ticket,chat`);
  await shot(page, 'activity-filtered');
});

test('english pages', async ({ page }) => {
  await prefs(page, 'en', 'light');
  await open(page, 'tickets');
  await shot(page, 'tickets-en');
  await open(page, `ticket?id=${mainTicket}`);
  await expect(page.getByTestId('tk-messages')).toBeVisible();
  await shot(page, 'ticket-en');
  await open(page, `live-chat?tab=mine&chat=${activeChat}`);
  await shot(page, 'live-chat-en');
  await open(page, 'activity');
  await shot(page, 'activity-en');
  await prefs(page, 'fa', 'light');
});

test('support user dashboard, dark ticket page and mobile inbox', async ({ page }) => {
  const sp = await freshPage(page.context().browser()!);
  await sp.goto('/');
  await sp.locator('#c-db').fill(process.env.STG_DB!);
  await sp.getByTestId('connect-go').click();
  await sp.locator('#l-user').fill(username);
  await sp.locator('#l-pass').fill(password);
  await sp.getByTestId('login-pass-go').click();
  await expect(sp.getByTestId('support-summary')).toBeVisible();
  await shot(sp, 'dashboard');
  await prefs(page, 'fa', 'dark');
  await open(page, `ticket?id=${mainTicket}`);
  await shot(page, 'ticket-dark');
  await prefs(page, 'fa', 'light');
  await sp.setViewportSize({ width: 390, height: 844 });
  await open(sp, 'tickets');
  await shot(sp, 'tickets-mobile');
  await open(sp, `ticket?id=${mainTicket}`);
  await shot(sp, 'ticket-mobile');
  await open(sp, 'live-chat');
  await shot(sp, 'live-chat-mobile');
});
