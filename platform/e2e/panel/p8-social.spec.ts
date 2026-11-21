import type { Page } from '@playwright/test';
import { PLAYER_QUERIES, SOCIAL_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, open, stamp, test, toastOk, uniquePhone } from './fixtures.ts';

const S = stamp();
const L = S.replace(/[0-9]/g, d => 'abcdefghij'[Number(d)]);
const tr = (t: string) => [{ lang: 'fa', text: t }];
const Q = [...PLAYER_QUERIES, ...SOCIAL_QUERIES];
const TAG = `sct${S}`;
const MASK = `qm${L}`;
const FLAG = `qf${L}`;

test.describe.configure({ mode: 'serial' });

let owner: Client;
let a: { c: Client; id: bigint };
let b: { c: Client; id: bigint };
let chatBefore: Record<string, unknown>;
let friendBefore: Record<string, unknown>;
let tagId = 0n;
let roomId = 0n;
const words: bigint[] = [];

async function confirm(page: Page) {
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
}

async function save(page: Page, id: string) {
  await page.getByTestId(id).last().getByTestId('dialog-save').click();
  await expect(page.getByTestId(id)).toHaveCount(0);
}

function chatArgs(s: Record<string, unknown>) {
  const k = ['chatEnabled', 'messageMaxLength', 'messagesPerMinute', 'dmPolicy', 'groupsEnabled', 'groupMaxMembers', 'groupsPerPlayer', 'filterEnabled', 'filterReportTitle', 'historyPageMax', 'liveMessages'];
  return Object.fromEntries(k.map(x => [x, s[x]])) as never;
}

function friendArgs(s: Record<string, unknown>) {
  const k = ['dailyRequests', 'maxFriends', 'expiryDays', 'rejectCooldownHours', 'matchPolicy', 'requestsBonusMeta', 'friendsBonusMeta', 'overLimit'];
  return Object.fromEntries(k.map(x => [x, s[x]])) as never;
}

const chatRow = () => [...owner.conn.db.adminChatSettings.iter()][0] as unknown as Record<string, unknown>;
const friendRow = () => [...owner.conn.db.adminFriendSettings.iter()][0] as unknown as Record<string, unknown>;

async function player() {
  const c = await connect(undefined, SOCIAL_QUERIES);
  const r = await login(c, uniquePhone('0936'));
  return { c, id: r.accountId };
}

test.beforeAll(async () => {
  owner = await connect(undefined, Q);
  await loginOwner(owner);
  await waitFor(() => !!chatRow() && !!friendRow(), 5000);
  chatBefore = chatArgs(chatRow());
  friendBefore = friendArgs(friendRow());
  const r = owner.conn.reducers;
  await r.adminSaveChatSettings({ ...(chatBefore as object), chatEnabled: true, filterEnabled: true, groupsEnabled: true, messagesPerMinute: 0 } as never);
  await r.adminSaveFriendSettings({ ...(friendBefore as object), dailyRequests: 0, maxFriends: 0 } as never);
  await r.adminSaveTag({ id: 0n, keyType: 'user', key: TAG, title: tr(`ویژه ${S}`), color: '#3b82f6', sort: 0, isActive: true });
  await waitFor(() => [...owner.conn.db.tag.iter()].some(x => x.key === TAG));
  tagId = [...owner.conn.db.tag.iter()].find(x => x.key === TAG)!.id;
  a = await player();
  b = await player();
});

test.afterAll(async () => {
  const r = owner?.conn.reducers;
  if (r) {
    for (const id of words) await r.adminDeleteChatWord({ id }).catch(() => {});
    for (const w of [...owner.conn.db.adminChatWords.iter()].filter(x => x.word.includes(L))) await r.adminDeleteChatWord({ id: w.id }).catch(() => {});
    for (const x of [...owner.conn.db.adminRooms.iter()].filter(x => x.key.includes(S))) await r.adminDeleteRoom({ id: x.id }).catch(() => {});
    for (const x of [...owner.conn.db.adminFriendRules.iter()].filter(x => x.name.includes(S))) await r.adminDeleteFriendRule({ id: x.id }).catch(() => {});
    if (a && b) await r.adminRemoveFriendship({ accountId: a.id, otherId: b.id }).catch(() => {});
    if (tagId) await r.adminDeleteTag({ id: tagId }).catch(() => {});
    if (chatBefore) await r.adminSaveChatSettings(chatBefore).catch(() => {});
    if (friendBefore) await r.adminSaveFriendSettings(friendBefore).catch(() => {});
    await r.adminSetSocialClockOffset({ seconds: 0n }).catch(() => {});
  }
  owner?.conn.disconnect();
  a?.c.conn.disconnect();
  b?.c.conn.disconnect();
});

test('chat settings: translated validation, save, run now and the test clock', async ({ page }) => {
  await open(page, 'settings/chat-settings');
  const st = page.getByTestId('st-chat-settings');
  const len = st.locator('input[name="messageMaxLength"]');
  await expect(len).toBeVisible();
  const before = await len.inputValue();
  await len.fill('۰');
  await st.getByTestId('scs-save').click();
  await expect(st.locator('.err-box')).toContainText('بیشترین طول پیام');
  await len.fill('۳۲۱');
  await st.getByTestId('scs-dm').selectOption('friends');
  await expect(st.getByTestId('scs-dm').locator('option:checked')).toHaveText('فقط دوستان');
  await st.getByTestId('scs-save').click();
  await toastOk(page);
  await expect.poll(() => chatRow().messageMaxLength).toBe(321);
  expect(chatRow().dmPolicy).toBe('friends');
  await len.fill(before);
  await st.getByTestId('scs-dm').selectOption(String(chatBefore.dmPolicy));
  await st.getByTestId('scs-save').click();
  await toastOk(page);
  await st.getByTestId('scs-run').click();
  await expect(page.locator('.toast-ok').last()).toContainText('بررسی انجام شد');
  await st.getByTestId('scs-clock-fwd').click();
  await expect(st.getByTestId('scs-clock-now')).not.toContainText('واقعی');
  await expect.poll(() => chatRow().clockOffsetSec).toBe(86400n);
  await st.getByTestId('scs-clock-reset').click();
  await expect(st.getByTestId('scs-clock-now')).toContainText('واقعی');
});

test('friend settings: translated validation, bonus meta, save', async ({ page }) => {
  await open(page, 'settings/friend-settings');
  const st = page.getByTestId('st-friend-settings');
  const daily = st.locator('input[name="dailyRequests"]');
  await expect(daily).toBeVisible();
  await daily.fill('۱۰۰۱');
  await st.getByTestId('sfs-save').click();
  await expect(st.locator('.err-box')).toContainText('درخواست دوستی در روز');
  await daily.fill('۰');
  const meta = [...owner.conn.db.meta.iter()][0];
  await st.locator('input[name="expiryDays"]').fill('۱۲');
  if (meta) await st.getByTestId('sfs-fbonus').selectOption(meta.key);
  await st.getByTestId('sfs-over').selectOption('trim');
  await st.getByTestId('sfs-save').click();
  await toastOk(page);
  await expect.poll(() => friendRow().expiryDays).toBe(12);
  expect(friendRow().overLimit).toBe('trim');
  if (meta) expect(friendRow().friendsBonusMeta).toBe(meta.key);
  await owner.conn.reducers.adminSaveFriendSettings({ ...(friendBefore as object), dailyRequests: 0, maxFriends: 0 } as never);
});

test('word list: create, edit, live filter tester, delete', async ({ page }) => {
  await open(page, 'chat-words');
  await page.getByTestId('scw-add').click();
  const d = page.getByTestId('scw-dialog');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('واژه را بنویسید');
  await d.locator('input[name="word"]').fill(MASK);
  await d.locator('input[name="note"]').fill(`آزمایش ${S}`);
  await save(page, 'scw-dialog');
  await expect.poll(() => [...owner.conn.db.adminChatWords.iter()].some(w => w.word === MASK)).toBe(true);
  const w = [...owner.conn.db.adminChatWords.iter()].find(x => x.word === MASK)!;
  words.push(w.id);
  const row = page.getByTestId(`scw-row-${w.id}`);
  await expect(row).toContainText('پوشاندن');
  await expect(row).toContainText('واژهٔ کامل');

  await page.getByTestId('scw-add').click();
  await d.locator('input[name="word"]').fill(MASK.toUpperCase());
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('از پیش');
  await d.getByRole('button', { name: 'انصراف' }).click();

  const input = page.getByTestId('scw-test-input');
  await input.fill(`salam ${MASK} rafigh`);
  const out = page.getByTestId('scw-test-out');
  await expect(out).toHaveText(`salam ${'*'.repeat(MASK.length)} rafigh`);
  await expect(page.getByTestId('scw-test-info')).toContainText('پوشانده شد');
  await expect(page.getByTestId('scw-test-info')).toContainText(MASK);

  await page.getByTestId(`scw-edit-${w.id}`).click();
  await d.getByRole('button', { name: 'رد کردن' }).click();
  await d.getByRole('button', { name: 'هر جای متن' }).click();
  await save(page, 'scw-dialog');
  await expect(row).toContainText('رد کردن');
  await expect(row).toContainText('هر جای متن');
  await input.fill(`abc${MASK}xyz`);
  await expect(page.getByTestId('scw-test-info')).toContainText('رد می‌شود');

  await page.getByTestId('scw-search').fill(L);
  await expect(page.locator('[data-testid^="scw-row-"]')).toHaveCount(1);
  await page.getByTestId(`scw-del-${w.id}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
  await input.fill(`salam ${MASK} rafigh`);
  await expect(page.getByTestId('scw-test-info')).toContainText('بدون مشکل');
});

test('rooms: create, edit, delete', async ({ page }) => {
  const key = `room${S}`;
  await open(page, 'chat-rooms');
  await page.getByTestId('scr-add').click();
  const d = page.getByTestId('scr-dialog');
  await d.locator('input[name="key"]').fill(key);
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('زبان پیش‌فرض');
  await d.locator('input[name="title-fa"]').fill(`اتاق عمومی ${S}`);
  await d.locator('textarea[name="description-fa"]').fill('گفتگوی آزاد بازیکنان');
  await save(page, 'scr-dialog');
  const row = page.getByTestId(`scr-row-${key}`);
  await expect(row).toContainText(`اتاق عمومی ${S}`);
  await expect(row).toContainText('فعال');
  await page.getByTestId(`scr-edit-${key}`).click();
  await d.locator('input[name="sort"]').fill('۷');
  await d.getByTestId('scr-active').click();
  await save(page, 'scr-dialog');
  await expect(row).toContainText('غیرفعال');
  await expect(row).toContainText('۷');
  await page.getByTestId(`scr-del-${key}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('message moderation: players chat in a room, filter, detail, remove with note, restore', async ({ page }) => {
  const r = owner.conn.reducers;
  await r.adminSaveChatWord({ id: 0n, word: MASK, action: 'mask', match: 'word', isActive: true, note: '' });
  await r.adminSaveChatWord({ id: 0n, word: FLAG, action: 'flag', match: 'word', isActive: true, note: '' });
  await waitFor(() => [...owner.conn.db.adminChatWords.iter()].filter(w => w.word.includes(L)).length === 2);
  for (const w of [...owner.conn.db.adminChatWords.iter()].filter(w => w.word.includes(L))) words.push(w.id);
  await r.adminSaveRoom({ id: 0n, key: `mod${S}`, title: tr(`اتاق نظارت ${S}`), description: [], isActive: true, sort: 0 });
  await waitFor(() => [...owner.conn.db.adminRooms.iter()].some(x => x.key === `room:mod${S}`));
  roomId = [...owner.conn.db.adminRooms.iter()].find(x => x.key === `room:mod${S}`)!.id;
  await a.c.conn.reducers.chatJoinRoom({ channelId: roomId });
  await b.c.conn.reducers.chatJoinRoom({ channelId: roomId });
  const m1 = await a.c.conn.procedures.chatSend({ channelId: roomId, peerId: 0n, text: `سلام بچه‌ها ${S}`, replyToId: 0n });
  const m2 = await b.c.conn.procedures.chatSend({ channelId: roomId, peerId: 0n, text: `hey ${MASK} and ${FLAG}`, replyToId: 0n });
  expect(m1.ok && m2.ok).toBe(true);
  expect(m2.masked && m2.flagged).toBe(true);

  await open(page, `chat-messages?channel=${roomId}`);
  await expect(page.getByTestId('scm-channel').locator('option:checked')).toHaveText(`اتاق نظارت ${S}`);
  const r1 = page.getByTestId(`scm-row-${m1.messageId}`);
  const r2 = page.getByTestId(`scm-row-${m2.messageId}`);
  await expect(r1).toContainText(`سلام بچه‌ها ${S}`);
  await expect(r2).toContainText(`hey ${'*'.repeat(MASK.length)} and ${FLAG}`);
  await expect(r2).toContainText('متن اصلی');
  await expect(r2).toContainText(MASK);
  await expect(r2).toContainText('نشان‌دار');
  await page.getByTestId('scm-flagged').click();
  await expect(r1).toHaveCount(0);
  await expect(r2).toBeVisible();
  await page.getByTestId('scm-flagged').click();
  await expect(r1).toBeVisible();

  await page.getByTestId(`scm-open-${m2.messageId}`).click();
  const d = page.getByTestId('scm-dialog');
  await expect(d.getByTestId('scm-original')).toContainText(MASK);
  await expect(d.getByTestId('scm-context')).toContainText(`سلام بچه‌ها ${S}`);
  await expect(d.getByTestId('scm-reports')).toContainText('پالایش خودکار');
  await expect(d.locator('[data-testid^="scm-report-"]').first()).toHaveAttribute('href', /#\/reports\?id=\d+/);
  await d.locator('input[name="removeNote"]').fill(`ناسزا ${S}`);
  await d.getByTestId('scm-remove').click();
  await toastOk(page);
  await expect(d.getByTestId('scm-detail')).toContainText('برداشته‌شده');
  await d.getByTestId('scm-restore').click();
  await expect(d.getByTestId('scm-detail')).toContainText('دیده می‌شود');
  await d.getByTestId('scm-remove').click();
  await expect(d.getByTestId('scm-detail')).toContainText('برداشته‌شده');
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await page.getByTestId('page-chat-messages').getByRole('button', { name: 'برداشته‌شده' }).click();
  await expect(r2).toBeVisible();
  await expect(r1).toHaveCount(0);
  await expect(page).toHaveURL(/status=removed/);
});

test('groups: players who are friends make a group, the panel lists and closes it', async ({ page }) => {
  await a.c.conn.procedures.friendRequest({ targetIds: [b.id] });
  await b.c.conn.reducers.friendAccept({ accountId: a.id });
  await waitFor(() => [...a.c.conn.db.myFriends.iter()].some(f => f.accountId === b.id), 5000);
  const name = `گروه دوستان ${S}`;
  const g = await a.c.conn.procedures.chatCreateGroup({ name, memberIds: [b.id] });
  await open(page, 'chat-groups');
  await page.getByTestId('scg-q').fill(name);
  const row = page.getByTestId(`scg-row-${g.channelId}`);
  await expect(row).toContainText(name);
  await expect(row).toContainText('۲');
  await expect(row).toContainText('فعال');
  await page.getByTestId(`scg-close-${g.channelId}`).click();
  await confirm(page);
  await expect(row).toContainText('بسته');
  await expect(page.getByTestId(`scg-close-${g.channelId}`)).toHaveCount(0);
});

test('friend rules: create with explicit limits, keep-default validation, edit, delete', async ({ page }) => {
  const name = `بازیکنان ویژه ${S}`;
  await open(page, 'friend-rules');
  await page.getByTestId('sfr-add').click();
  const d = page.getByTestId('sfr-dialog');
  await d.locator('input[name="name"]').fill(name);
  await d.getByTestId(`sfr-tags-${TAG}`).click();
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('دست‌کم یکی از محدودیت‌ها');
  await d.getByTestId('sfr-dailyRequests-keep').click();
  await d.locator('input[name="dailyRequests"]').fill('۲۰۰۰');
  await d.getByTestId('dialog-save').click();
  await expect(d.locator('.err-box')).toContainText('درخواست دوستی در روز');
  await d.locator('input[name="dailyRequests"]').fill('۴۰');
  await d.locator('input[name="priority"]').fill('۵');
  await save(page, 'sfr-dialog');
  await expect.poll(() => [...owner.conn.db.adminFriendRules.iter()].some(x => x.name === name)).toBe(true);
  const rule = [...owner.conn.db.adminFriendRules.iter()].find(x => x.name === name)!;
  expect(rule.dailyRequests).toBe(40);
  expect(rule.maxFriends).toBeUndefined();
  const row = page.getByTestId(`sfr-row-${rule.id}`);
  await expect(row).toContainText('۴۰');
  await expect(row).toContainText('پیش‌فرض');
  await expect(row).toContainText(`ویژه ${S}`);
  await page.getByTestId(`sfr-edit-${rule.id}`).click();
  await d.getByTestId('sfr-maxFriends-keep').click();
  await d.locator('input[name="maxFriends"]').fill('۰');
  await save(page, 'sfr-dialog');
  await expect(row).toContainText('بی‌محدودیت');
  await expect.poll(() => [...owner.conn.db.adminFriendRules.iter()].find(x => x.id === rule.id)?.maxFriends).toBe(0);
  await page.getByTestId(`sfr-del-${rule.id}`).click();
  await confirm(page);
  await expect(row).toHaveCount(0);
});

test('player card: friendship shows with rules and can be removed', async ({ page }) => {
  await open(page, `player?id=${a.id}`);
  const card = page.getByTestId('pd-friends');
  await expect(card.getByTestId(`pf-edge-${b.id}`)).toBeVisible();
  await expect(card.getByTestId('pf-friend').getByTestId(`pf-edge-${b.id}`)).toBeVisible();
  await expect(card.getByTestId('pf-rules-box')).toContainText('بی‌نهایت');
  await expect(card.getByTestId('pf-tier')).toContainText('پیش‌فرض');
  await card.getByTestId(`pf-remove-${b.id}`).click();
  await confirm(page);
  await expect(card.getByTestId(`pf-edge-${b.id}`)).toHaveCount(0);
  await expect(card).toContainText('هنوز دوست یا دعوتی ندارد');
  await expect.poll(() => [...a.c.conn.db.myFriends.iter()].length).toBe(0);
});
