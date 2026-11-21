import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PLAYER_QUERIES, SOCIAL_QUERIES, connect, login, loginOwner, waitFor, type Client } from '../src/lib.ts';
import { expect, open, prefs, stamp, test, uniquePhone } from './fixtures.ts';

const DIR = '../.local/shots/panel8';
mkdirSync(DIR, { recursive: true });
const S = stamp();
const L = S.replace(/[0-9]/g, d => 'abcdefghij'[Number(d)]);
const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];

test.describe.configure({ mode: 'serial' });

let owner: Client;
const players: { c: Client; id: bigint }[] = [];
const made = { words: [] as bigint[], rooms: [] as bigint[], rule: 0n, tag: 0n, msg: 0n, group: 0n, group2: 0n };
let chatBefore: Record<string, unknown>;

async function settle(page: Page) {
  await page.waitForTimeout(450);
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 8000 });
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: `${DIR}/social-${name}.png` });
}

async function player(name: string) {
  const c = await connect(undefined, SOCIAL_QUERIES);
  const r = await login(c, uniquePhone('0939'));
  await c.conn.reducers.updateProfile({ displayName: name, lang: 'fa' });
  const p = { c, id: r.accountId };
  players.push(p);
  return p;
}

test.beforeAll(async () => {
  owner = await connect(undefined, [...PLAYER_QUERIES, ...SOCIAL_QUERIES]);
  await loginOwner(owner);
  await waitFor(() => [...owner.conn.db.adminChatSettings.iter()].length > 0, 5000);
  const cs = [...owner.conn.db.adminChatSettings.iter()][0] as unknown as Record<string, unknown>;
  chatBefore = Object.fromEntries(['chatEnabled', 'messageMaxLength', 'messagesPerMinute', 'dmPolicy', 'groupsEnabled', 'groupMaxMembers', 'groupsPerPlayer', 'filterEnabled', 'filterReportTitle', 'historyPageMax', 'liveMessages'].map(k => [k, cs[k]]));
  const r = owner.conn.reducers;
  await r.adminSaveChatSettings({ ...(chatBefore as object), chatEnabled: true, filterEnabled: true, groupsEnabled: true, messagesPerMinute: 0 } as never);
  const words: [string, string, string, string][] = [
    [`spam${L}`, 'mask', 'word', 'تبلیغ سایت‌های دیگر'],
    [`cheat${L}`, 'flag', 'word', 'حرف از تقلب، برای بررسی'],
    [`scam${L}`, 'block', 'contains', 'کلاهبرداری'],
    [`احمق${L}`, 'mask', 'word', ''],
  ];
  for (const [word, action, match, note] of words) await r.adminSaveChatWord({ id: 0n, word, action, match, isActive: true, note });
  await waitFor(() => [...owner.conn.db.adminChatWords.iter()].filter(w => w.word.includes(L)).length === 4);
  made.words = [...owner.conn.db.adminChatWords.iter()].filter(w => w.word.includes(L)).map(w => w.id);
  const rooms: [string, string, string, string, string][] = [
    [`lobby${S}`, 'لابی عمومی', 'Main lobby', 'گفتگوی آزاد همهٔ بازیکنان', 'Open chat for everyone'],
    [`clan${S}`, 'یافتن هم‌تیمی', 'Find a teammate', 'برای بازی گروهی هم‌تیمی پیدا کنید', 'Find people to play with'],
    [`help${S}`, 'پرسش و پاسخ', 'Questions', '', ''],
  ];
  for (const [i, [key, fa, en, dfa, den]] of rooms.entries()) await r.adminSaveRoom({ id: 0n, key, title: tr(fa, en), description: dfa ? tr(dfa, den) : [], isActive: i < 2, sort: i });
  await waitFor(() => [...owner.conn.db.adminRooms.iter()].filter(x => x.key.endsWith(S)).length === 3);
  made.rooms = [...owner.conn.db.adminRooms.iter()].filter(x => x.key.endsWith(S)).map(x => x.id);
  const lobby = [...owner.conn.db.adminRooms.iter()].find(x => x.key === `room:lobby${S}`)!.id;
  await r.adminSaveTag({ id: 0n, keyType: 'user', key: `vip${S}`, title: tr('بازیکن ویژه', 'VIP player'), color: '#f59e0b', sort: 0, isActive: true });
  await waitFor(() => [...owner.conn.db.tag.iter()].some(x => x.key === `vip${S}`));
  made.tag = [...owner.conn.db.tag.iter()].find(x => x.key === `vip${S}`)!.id;
  await r.adminSaveFriendRule({ id: 0n, name: `بازیکنان ویژه ${S}`, tagIds: [made.tag], priority: 10, dailyRequests: 50, maxFriends: 0, rejectCooldownHours: undefined, isActive: true });
  await waitFor(() => [...owner.conn.db.adminFriendRules.iter()].some(x => x.name === `بازیکنان ویژه ${S}`));
  made.rule = [...owner.conn.db.adminFriendRules.iter()].find(x => x.name === `بازیکنان ویژه ${S}`)!.id;

  const sara = await player('سارا');
  const reza = await player('رضا');
  const nima = await player('نیما');
  const mina = await player('مینا');
  for (const p of [sara, reza, nima]) await p.c.conn.reducers.chatJoinRoom({ channelId: lobby });
  const send = (p: { c: Client }, text: string) => p.c.conn.procedures.chatSend({ channelId: lobby, peerId: 0n, text, replyToId: 0n });
  await send(sara, 'سلام به همه! کسی برای بازی آنلاین هست؟');
  await send(reza, 'من هستم، تا ده دقیقه دیگر آنلاین می‌شوم');
  const bad = await send(nima, `بیایید spam${L} را ببینید، cheat${L} هم دارد`);
  made.msg = bad.messageId;
  await send(sara, `نیما تو احمق${L} هستی`);
  await send(reza, 'لطفاً مؤدب باشید 🙏');
  await sara.c.conn.procedures.chatReport({ messageId: bad.messageId, titleKey: [...owner.conn.db.reportTitle.iter()][0].key, note: 'تبلیغ و تقلب' });
  await sara.c.conn.procedures.friendRequest({ targetIds: [reza.id, nima.id, mina.id] });
  await reza.c.conn.reducers.friendAccept({ accountId: sara.id });
  await nima.c.conn.reducers.friendAccept({ accountId: sara.id });
  await reza.c.conn.procedures.friendRequest({ targetIds: [mina.id] });
  await waitFor(() => [...sara.c.conn.db.myFriends.iter()].length === 2, 5000);
  const g = await sara.c.conn.procedures.chatCreateGroup({ name: 'تیم شب‌های جمعه', memberIds: [reza.id, nima.id] });
  made.group = g.channelId;
  await sara.c.conn.procedures.chatSend({ channelId: g.channelId, peerId: 0n, text: 'امشب ساعت نه بازی داریم', replyToId: 0n });
  made.group2 = (await reza.c.conn.procedures.chatCreateGroup({ name: 'دوستان مدرسه', memberIds: [sara.id] })).channelId;
});

test.afterAll(async () => {
  const r = owner?.conn.reducers;
  if (r) {
    for (const id of made.words) await r.adminDeleteChatWord({ id }).catch(() => {});
    for (const id of made.rooms) await r.adminDeleteRoom({ id }).catch(() => {});
    if (made.rule) await r.adminDeleteFriendRule({ id: made.rule }).catch(() => {});
    if (made.tag) await r.adminDeleteTag({ id: made.tag }).catch(() => {});
    for (const id of [made.group, made.group2]) if (id) await r.adminCloseGroup({ id }).catch(() => {});
    if (chatBefore) await r.adminSaveChatSettings(chatBefore as never).catch(() => {});
    for (const p of players) for (const q of players) if (p.id < q.id) await r.adminRemoveFriendship({ accountId: p.id, otherId: q.id }).catch(() => {});
  }
  owner?.conn.disconnect();
  for (const p of players) p.c.conn.disconnect();
});

test('social pages in fa', async ({ page }) => {
  await open(page, 'chat-words');
  await page.getByTestId('scw-test-input').fill(`سلام spam${L} و cheat${L}!`);
  await expect(page.getByTestId('scw-test-info')).toBeVisible();
  await shot(page, 'words');
  await page.getByTestId('scw-add').click();
  await page.getByTestId('scw-dialog').locator('input[name="word"]').fill('کلمهٔ ممنوع');
  await shot(page, 'word-dialog');
  await page.keyboard.press('Escape');

  await open(page, 'chat-rooms');
  await shot(page, 'rooms');
  await page.getByTestId(`scr-edit-lobby${S}`).click();
  await shot(page, 'room-dialog');
  await page.keyboard.press('Escape');

  const lobby = [...owner.conn.db.adminRooms.iter()].find(x => x.key === `room:lobby${S}`)!.id;
  await open(page, `chat-messages?channel=${lobby}`);
  await expect(page.getByTestId(`scm-row-${made.msg}`)).toBeVisible();
  await shot(page, 'messages');
  await page.getByTestId(`scm-open-${made.msg}`).click();
  await expect(page.getByTestId('scm-reports')).toBeVisible();
  await shot(page, 'message-dialog');
  await page.keyboard.press('Escape');

  await open(page, 'chat-groups');
  await expect(page.getByTestId(`scg-row-${made.group}`)).toBeVisible();
  await shot(page, 'groups');

  await open(page, 'friend-rules');
  await shot(page, 'friend-rules');
  await page.getByTestId(`sfr-edit-${made.rule}`).click();
  await shot(page, 'friend-rule-dialog');
  await page.keyboard.press('Escape');

  await open(page, 'settings/chat-settings');
  await expect(page.getByTestId('scs')).toBeVisible();
  await shot(page, 'chat-settings');
  await open(page, 'settings/friend-settings');
  await expect(page.getByTestId('sfs')).toBeVisible();
  await shot(page, 'friend-settings');
});

test('social pages in en', async ({ page }) => {
  await prefs(page, 'en', 'light');
  await open(page, 'chat-words');
  await page.getByTestId('scw-test-input').fill(`hello spam${L} and scam${L}`);
  await expect(page.getByTestId('scw-test-info')).toBeVisible();
  await shot(page, 'words-en');
  const lobby = [...owner.conn.db.adminRooms.iter()].find(x => x.key === `room:lobby${S}`)!.id;
  await open(page, `chat-messages?channel=${lobby}`);
  await expect(page.getByTestId(`scm-row-${made.msg}`)).toBeVisible();
  await shot(page, 'messages-en');
  await open(page, 'friend-rules');
  await shot(page, 'friend-rules-en');
  await prefs(page, 'fa', 'light');
});

test('player friends card', async ({ page }) => {
  const sara = players[0];
  await open(page, `player?id=${sara.id}`);
  const card = page.getByTestId('pd-friends');
  await card.scrollIntoViewIfNeeded();
  await settle(page);
  await card.screenshot({ path: `${DIR}/social-player-card.png` });
});
