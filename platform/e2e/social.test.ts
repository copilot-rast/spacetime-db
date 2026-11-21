import { ECONOMY_QUERIES, GAMIFICATION_QUERIES, ITEMS_QUERIES, PLAYER_QUERIES, PUBLICATION_QUERIES, SOCIAL_QUERIES, check, connect, done, errorOf, login, loginOwner, panelUser, sql, tr, uniquePhone, waitFor, type Client } from './src/lib.ts';

const R = String(Date.now() % 10_000_000);
const k = (s: string) => `${s}_${R}`;
const Q = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMIFICATION_QUERIES, ...ITEMS_QUERIES, ...PUBLICATION_QUERIES, ...SOCIAL_QUERIES];
const c = (token?: string) => connect(token, Q);
const rows = <T>(it: Iterable<T>) => [...it];
const DAY = 86400;

let o: Client;
type P = { p: Client; id: bigint; phone: string };

type FriendSettings = Parameters<Client['conn']['reducers']['adminSaveFriendSettings']>[0];
type ChatSettings = Parameters<Client['conn']['reducers']['adminSaveChatSettings']>[0];
type QuotaSettings = Parameters<Client['conn']['reducers']['adminSaveQuotaSettings']>[0];
type GiftSettings = Parameters<Client['conn']['reducers']['adminSaveGiftSettings']>[0];
type ItemArgs = Parameters<Client['conn']['reducers']['adminSaveItem']>[0];

const FRIEND: FriendSettings = { dailyRequests: 20, maxFriends: 0, expiryDays: 0, rejectCooldownHours: 0, matchPolicy: 'priority', requestsBonusMeta: '', friendsBonusMeta: '', overLimit: 'refuse' };
const CHAT: ChatSettings = { chatEnabled: true, messageMaxLength: 500, messagesPerMinute: 20, dmPolicy: 'anyone', groupsEnabled: true, groupMaxMembers: 50, groupsPerPlayer: 10, filterEnabled: true, filterReportTitle: 'abuse', historyPageMax: 100, liveMessages: 30 };
const QUOTA: QuotaSettings = {
  enabled: false,
  countMode: 'messages',
  dailyMessages: 20,
  dailyConversations: 5,
  conversationScope: 'day',
  resetMinute: 0,
  utcOffsetMinutes: 210,
  countDirect: true,
  countGroups: false,
  countRooms: false,
  replyFree: 'off',
  friendPolicy: 'same',
  friendDailyMessages: 50,
  friendDailyConversations: 10,
  packMeta: '',
  packExpiryDays: 0,
  order: 'free_first',
  packProducts: [],
  bonusMeta: '',
  matchPolicy: 'priority',
  unlimitedItems: [],
  unlimitedMeta: '',
  unlimitedMetaMode: 'positive',
  message: [],
  notice: 'none',
};
const GIFT: GiftSettings = {
  enabled: true,
  recipients: 'friends',
  minFriendDays: 0,
  minMutualFriends: 0,
  minSenderAccountDays: 0,
  minRecipientAccountDays: 0,
  minSenderLevel: 0,
  levelTableId: 0n,
  inventoryEnabled: true,
  itemsDefault: true,
  equipped: 'block',
  upgradeLevel: 'keep',
  regift: 'block',
  itemRequirements: 'check',
  currencyEnabled: false,
  currencies: [],
  shopEnabled: true,
  productsDefault: true,
  methods: ['in_app', 'gateway', 'store'],
  discountCodes: false,
  perSenderDaily: 5,
  perRecipientDaily: 10,
  perPairDaily: 2,
  matchPolicy: 'priority',
  sendBonusMeta: '',
  receiveBonusMeta: '',
  delivery: 'instant',
  expiryHours: 72,
  onExpiry: 'return',
  coinReturn: 'refund',
  moneyReturn: 'sender',
  senderCancel: true,
  messageEnabled: true,
  messageMaxLength: 120,
  messageFilter: 'rules',
  notify: 'in_app',
  notifySender: true,
};

const gold = k('gold');
const bal = (cl: Client, key = gold) => rows(cl.conn.db.myWallet.iter()).find(w => w.currencyKey === key)?.balance ?? -1n;
const inv = (cl: Client, key: string) => rows(cl.conn.db.myInventory.iter()).find(r => r.itemKey === key);
const friends = (cl: Client) => rows(cl.conn.db.myFriends.iter()).map(f => f.accountId);
const inReq = (cl: Client) => rows(cl.conn.db.myFriendRequestsIn.iter()).map(f => f.accountId);
const outReq = (cl: Client) => rows(cl.conn.db.myFriendRequestsOut.iter()).map(f => f.accountId);

async function friendSet(p: Partial<FriendSettings>) {
  const want = { ...FRIEND, ...p };
  await o.conn.reducers.adminSaveFriendSettings(want);
  await waitFor(() => rows(o.conn.db.adminFriendSettings.iter())[0]?.dailyRequests === want.dailyRequests && rows(o.conn.db.adminFriendSettings.iter())[0]?.overLimit === want.overLimit);
}
async function chatSet(p: Partial<ChatSettings>) {
  await o.conn.reducers.adminSaveChatSettings({ ...CHAT, ...p });
}
async function quotaSet(p: Partial<QuotaSettings>) {
  await o.conn.reducers.adminSaveQuotaSettings({ ...QUOTA, ...p });
}
async function giftSet(p: Partial<GiftSettings>) {
  await o.conn.reducers.adminSaveGiftSettings({ ...GIFT, ...p });
}
async function clock(sec: number) {
  await o.conn.reducers.adminSetSocialClockOffset({ seconds: BigInt(sec) });
  await waitFor(() => rows(o.conn.db.adminChatSettings.iter())[0]?.clockOffsetSec === BigInt(sec));
}
async function player(tags: bigint[] = []): Promise<P> {
  const p = await c();
  const phone = uniquePhone('0937');
  const r = await login(p, phone);
  if (tags.length) await o.conn.reducers.adminSetPlayerTags({ accountId: r.accountId, tagIds: tags });
  await waitFor(() => bal(p) === 1000n);
  return { p, id: r.accountId, phone };
}
async function befriend(a: P, b: P) {
  await a.p.conn.procedures.friendRequest({ targetIds: [b.id] });
  await b.p.conn.procedures.friendRequest({ targetIds: [a.id] });
  await waitFor(() => friends(a.p).includes(b.id) && friends(b.p).includes(a.id));
}
async function tag(key: string) {
  await o.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key, title: tr(key), color: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.tag.iter()).some(x => x.key === key && x.keyType === 'user'));
  return rows(o.conn.db.tag.iter()).find(x => x.key === key && x.keyType === 'user')!.id;
}
async function meta(key: string) {
  await o.conn.reducers.adminSaveMeta({ id: 0n, key, name: tr(key), defaultValue: 0, serverOnly: false });
  await waitFor(() => rows(o.conn.db.meta.iter()).some(x => x.key === key));
}
async function item(key: string, p: Partial<ItemArgs>) {
  await o.conn.reducers.adminSaveItem({
    id: 0n, key, typeKey: 'skin', name: tr(key), description: [], iconUrl: '', imageUrl: '', categoryId: 0n, tagIds: [], rarity: 'common', stackable: false, maxStack: 0, requiresKey: '', isStarter: false, starterQuantity: 0,
    levelTableId: 0n, unlockLevel: 0, price: undefined, upgrades: [], services: [], usePrizeId: 0n, metadata: '', sort: 0, isActive: true, ...p,
  });
  await waitFor(() => rows(o.conn.db.item.iter()).some(x => x.key === key));
  return rows(o.conn.db.item.iter()).find(x => x.key === key)!;
}
async function prize(key: string, items: { type: string; key: string; action: string; value: number }[], isRepeatable = true) {
  await o.conn.reducers.adminSavePrize({ id: 0n, key, name: tr(key), message: [], categoryId: 0n, tagIds: [], isRepeatable, items });
  await waitFor(() => rows(o.conn.db.prize.iter()).some(x => x.key === key));
  return rows(o.conn.db.prize.iter()).find(x => x.key === key)!.id;
}
async function product(key: string, prizeId: bigint, coinAmount: bigint, paymentMethods = ['in_app'], skuBazaar = '') {
  await o.conn.reducers.adminSaveProduct({ id: 0n, key, name: tr(key), description: [], isActive: true, categoryId: 0n, tagIds: [], audienceTagIds: [], priceToman: 10000n, coinCurrency: gold, coinAmount, discountPercent: 0, paymentMethods, skuBazaar, skuMyket: '', prizeId, iconUrl: '', coverUrl: '', sort: 0 });
  const list = await o.conn.procedures.adminProducts({ query: key, categoryId: 0n, isActive: '', page: 1, pageSize: 50 });
  return list.rows.find(r => r.key === key)!.id;
}
async function give(pl: P, itemId: bigint, quantity = 1) {
  await o.conn.reducers.adminGiveItem({ accountId: pl.id, itemId, quantity, note: 'test' });
}
const send = (pl: P, a: Partial<{ channelId: bigint; peerId: bigint; text: string; replyToId: bigint }>) => pl.p.conn.procedures.chatSend({ channelId: 0n, peerId: 0n, text: 'hi', replyToId: 0n, ...a });
const gift = (pl: P, a: Partial<Parameters<Client['conn']['procedures']['giftSend']>[0]>) =>
  pl.p.conn.procedures.giftSend({ friendId: 0n, itemKey: '', quantity: 0, currencyKey: '', amount: 0n, productId: 0n, method: '', giftCode: '', message: '', requestId: '', ...a });
const events = (accountId: bigint, key: string) => (sql(`SELECT id FROM gam_player_event WHERE type_key = '${key}' AND account_id = ${accountId}`).match(/^\s*\d+\s*$/gm) ?? []).length;

async function seeds() {
  check('friend settings defaults', await waitFor(() => {
    const s = rows(o.conn.db.adminFriendSettings.iter())[0];
    return !!s && s.dailyRequests === 20 && s.maxFriends === 0 && s.expiryDays === 0 && s.overLimit === 'refuse' && s.matchPolicy === 'priority';
  }));
  check('quota is off by default', await waitFor(() => rows(o.conn.db.adminQuotaSettings.iter())[0]?.enabled === false && rows(o.conn.db.adminQuotaSettings.iter())[0]?.utcOffsetMinutes === 210));
  check('gift defaults', await waitFor(() => {
    const s = rows(o.conn.db.adminGiftSettings.iter())[0];
    return !!s && s.enabled && s.recipients === 'friends' && s.perPairDaily === 2 && s.delivery === 'instant' && !s.currencyEnabled && s.expiryHours === 72;
  }));
  check('chat settings defaults', rows(o.conn.db.adminChatSettings.iter())[0]?.messageMaxLength === 500 && rows(o.conn.db.adminChatSettings.iter())[0]?.dmPolicy === 'anyone');
  check('ten filter words seeded', rows(o.conn.db.adminChatWords.iter()).length >= 10 && rows(o.conn.db.adminChatWords.iter()).some(w => w.word === 'احمق' && w.action === 'mask'));
  check('gift events seeded', ['Gift:Sent', 'Gift:Received'].every(key => rows(o.conn.db.eventType.iter()).some(x => x.key === key && x.isSystem && !x.clientAllowed)));
  check('social notify category seeded', rows(o.conn.db.notifyCategory.iter()).some(x => x.key === 'social'));
}

async function friendsSuite() {
  await friendSet({});
  const [a, b, cc, d] = [await player(), await player(), await player(), await player()];
  const r1 = await a.p.conn.procedures.friendRequest({ targetIds: [b.id] });
  check('request sent', r1.sent.length === 1 && r1.sent[0] === b.id && r1.remainingToday === 19);
  check('sender sees outgoing', await waitFor(() => outReq(a.p).includes(b.id)));
  check('target sees incoming', await waitFor(() => inReq(b.p).includes(a.id)));
  check('views are private to each player', inReq(a.p).length === 0 && outReq(b.p).length === 0 && inReq(cc.p).length === 0 && outReq(cc.p).length === 0);
  check('self request refused', (await errorOf(a.p.conn.procedures.friendRequest({ targetIds: [a.id] }))).includes('CANNOT_TARGET_SELF'));
  check('unknown user refused', (await errorOf(a.p.conn.procedures.friendRequest({ targetIds: [999999999n] }))).includes('USER_NOT_FOUND'));
  check('empty request refused', (await errorOf(a.p.conn.procedures.friendRequest({ targetIds: [] }))).includes('NO_USERS'));
  check('over 100 ids refused', (await errorOf(a.p.conn.procedures.friendRequest({ targetIds: Array.from({ length: 101 }, (_, i) => BigInt(i + 1)) }))).includes('FRIEND_TOO_MANY_USERS'));
  const dup = await a.p.conn.procedures.friendRequest({ targetIds: [b.id] });
  check('duplicate request is a no-op and costs nothing', dup.sent.length === 0 && dup.skipped.includes(b.id) && dup.remainingToday === 19);
  const back = await b.p.conn.procedures.friendRequest({ targetIds: [a.id] });
  check('requesting back accepts', back.accepted.includes(a.id) && back.sent.length === 0 && back.remainingToday === 20);
  check('both are friends', await waitFor(() => friends(a.p).includes(b.id) && friends(b.p).includes(a.id) && !outReq(a.p).includes(b.id)));
  const rules = await a.p.conn.procedures.friendRules();
  check('friend rules show today', rules.dailyRequests === 20 && rules.sentToday === 1 && rules.remainingToday === 19 && rules.friends === 1 && rules.friendSlotsLeft === undefined && rules.resetsAt.microsSinceUnixEpoch > BigInt(Date.now()) * 1000n);

  await cc.p.conn.procedures.friendRequest({ targetIds: [d.id] });
  await waitFor(() => inReq(d.p).includes(cc.id));
  await d.p.conn.reducers.friendDecline({ accountId: cc.id });
  check('decline removes both sides', await waitFor(() => !inReq(d.p).includes(cc.id) && !outReq(cc.p).includes(d.id)));
  check('decline twice refused', (await errorOf(d.p.conn.reducers.friendDecline({ accountId: cc.id }))).includes('REQUEST_NOT_FOUND'));
  await friendSet({ rejectCooldownHours: 24 });
  check('cooldown after a rejection', (await errorOf(cc.p.conn.procedures.friendRequest({ targetIds: [d.id] }))).includes('FRIEND_REQUEST_COOLDOWN'));
  await d.p.conn.procedures.friendRequest({ targetIds: [cc.id] });
  await waitFor(() => inReq(cc.p).includes(d.id));
  await cc.p.conn.reducers.friendAccept({ accountId: d.id });
  check('reaching out lifts the cooldown and accept works', await waitFor(() => friends(cc.p).includes(d.id)));
  await friendSet({});

  await a.p.conn.procedures.friendRequest({ targetIds: [cc.id] });
  await waitFor(() => outReq(a.p).includes(cc.id));
  await a.p.conn.reducers.friendCancel({ accountId: cc.id });
  check('cancel removes the invite', await waitFor(() => !outReq(a.p).includes(cc.id) && !inReq(cc.p).includes(a.id)));
  check('cancel twice refused', (await errorOf(a.p.conn.reducers.friendCancel({ accountId: cc.id }))).includes('REQUEST_NOT_FOUND'));
  check('accept without invite refused', (await errorOf(a.p.conn.reducers.friendAccept({ accountId: d.id }))).includes('REQUEST_NOT_FOUND'));

  await a.p.conn.reducers.friendBlock({ accountId: d.id });
  check('blocked list shows only to blocker', await waitFor(() => rows(a.p.conn.db.myBlocked.iter()).some(x => x.accountId === d.id)) && rows(d.p.conn.db.myBlocked.iter()).length === 0);
  const blockedReq = await d.p.conn.procedures.friendRequest({ targetIds: [a.id] });
  check('blocked player request is silently skipped', blockedReq.sent.length === 0 && blockedReq.skipped.includes(a.id));
  check('blocked target never sees the request', !inReq(a.p).includes(d.id));
  await a.p.conn.reducers.friendUnblock({ accountId: d.id });
  check('unblock works', await waitFor(() => rows(a.p.conn.db.myBlocked.iter()).length === 0));
  check('unblock twice refused', (await errorOf(a.p.conn.reducers.friendUnblock({ accountId: d.id }))).includes('NOT_BLOCKED'));
  await a.p.conn.reducers.friendRemove({ accountId: b.id });
  check('remove unfriends both', await waitFor(() => !friends(a.p).includes(b.id) && !friends(b.p).includes(a.id)));
  check('remove non-friend refused', (await errorOf(a.p.conn.reducers.friendRemove({ accountId: b.id }))).includes('NOT_FRIENDS'));
  await befriend(a, b);
  await a.p.conn.reducers.friendBlock({ accountId: b.id });
  check('block ends a friendship', await waitFor(() => !friends(a.p).includes(b.id) && !friends(b.p).includes(a.id)));
  await a.p.conn.reducers.friendUnblock({ accountId: b.id });

  await friendSet({ dailyRequests: 2 });
  const [e, t1, t2, t3, t4] = [await player(), await player(), await player(), await player(), await player()];
  check('refuse mode: over the limit refused whole', (await errorOf(e.p.conn.procedures.friendRequest({ targetIds: [t1.id, t2.id, t3.id] }))).includes('FRIEND_DAILY_LIMIT'));
  check('refused request sent nothing', (await e.p.conn.procedures.friendRules()).sentToday === 0);
  await friendSet({ dailyRequests: 2, overLimit: 'trim' });
  const trimmed = await e.p.conn.procedures.friendRequest({ targetIds: [t1.id, t2.id, t3.id] });
  check('trim mode sends what is left', trimmed.sent.length === 2 && trimmed.skipped.includes(t3.id) && trimmed.remainingToday === 0);
  check('limit reached refuses next', (await errorOf(e.p.conn.procedures.friendRequest({ targetIds: [t4.id] }))).includes('FRIEND_DAILY_LIMIT'));
  await waitFor(() => inReq(t1.p).includes(e.id));
  await t1.p.conn.reducers.friendAccept({ accountId: e.id });
  check('accepting is free at the limit', await waitFor(() => friends(e.p).includes(t1.id)));

  const reqMeta = k('req_bonus');
  const slotMeta = k('slot_bonus');
  await meta(reqMeta);
  await meta(slotMeta);
  check('unknown bonus meta refused', (await errorOf(o.conn.reducers.adminSaveFriendSettings({ ...FRIEND, requestsBonusMeta: 'nope_meta' }))).includes('META_NOT_FOUND'));
  await friendSet({ dailyRequests: 2, overLimit: 'trim', requestsBonusMeta: reqMeta, friendsBonusMeta: slotMeta });
  await o.conn.reducers.adminAdjust({ accountId: e.id, kind: 'meta', key: reqMeta, action: 'set', value: 3.7, note: '' });
  const er = await e.p.conn.procedures.friendRules();
  check('bonus meta adds whole requests', er.dailyRequests === 5 && er.bonus.dailyRequests === 3 && er.base.dailyRequests === 2 && er.remainingToday === 3);
  check('bonus requests usable', (await e.p.conn.procedures.friendRequest({ targetIds: [t4.id] })).sent.length === 1);

  await friendSet({ dailyRequests: 2 });
  const f = await player();
  const targets = [await player(), await player(), await player(), await player(), await player()];
  const par = await Promise.all(targets.map(t => errorOf(f.p.conn.procedures.friendRequest({ targetIds: [t.id] }))));
  check('parallel requests never pass the daily limit', par.filter(x => x === '').length === 2 && par.filter(x => x.includes('FRIEND_DAILY_LIMIT')).length === 3);
  check('counter exact after parallel', (await f.p.conn.procedures.friendRules()).sentToday === 2);

  const vip = await tag(k('vip'));
  const vip2 = await tag(k('vip2'));
  check('rule needs a limit', (await errorOf(o.conn.reducers.adminSaveFriendRule({ id: 0n, name: 'x', tagIds: [vip], priority: 1, dailyRequests: undefined, maxFriends: undefined, rejectCooldownHours: undefined, isActive: true }))).includes('LIMIT_REQUIRED'));
  check('rule needs tags', (await errorOf(o.conn.reducers.adminSaveFriendRule({ id: 0n, name: 'x', tagIds: [], priority: 1, dailyRequests: 5, maxFriends: undefined, rejectCooldownHours: undefined, isActive: true }))).includes('TAGS_REQUIRED'));
  check('rule priority bounded', (await errorOf(o.conn.reducers.adminSaveFriendRule({ id: 0n, name: 'x', tagIds: [vip], priority: 5000, dailyRequests: 5, maxFriends: undefined, rejectCooldownHours: undefined, isActive: true }))).includes('INVALID_PRIORITY'));
  await o.conn.reducers.adminSaveFriendRule({ id: 0n, name: k('r_vip'), tagIds: [vip], priority: 10, dailyRequests: 5, maxFriends: undefined, rejectCooldownHours: undefined, isActive: true });
  await o.conn.reducers.adminSaveFriendRule({ id: 0n, name: k('r_vip2'), tagIds: [vip2], priority: 5, dailyRequests: 50, maxFriends: undefined, rejectCooldownHours: undefined, isActive: true });
  await waitFor(() => rows(o.conn.db.adminFriendRules.iter()).filter(r => r.name.endsWith(R)).length === 2);
  const g = await player([vip, vip2]);
  const gr = await g.p.conn.procedures.friendRules();
  check('priority policy: highest priority rule wins', gr.dailyRequests === 5 && gr.tier?.name === k('r_vip'));
  await friendSet({ dailyRequests: 2, matchPolicy: 'generous' });
  check('generous policy: largest limit wins', (await g.p.conn.procedures.friendRules()).dailyRequests === 50);
  await o.conn.reducers.adminSaveFriendRule({ id: 0n, name: k('r_free'), tagIds: [vip2], priority: 1, dailyRequests: 0, maxFriends: undefined, rejectCooldownHours: undefined, isActive: true });
  check('generous: unlimited beats any number', await waitFor(() => rows(o.conn.db.adminFriendRules.iter()).some(r => r.name === k('r_free'))) && (await g.p.conn.procedures.friendRules()).remainingToday === undefined);
  check('untagged player keeps the default', (await f.p.conn.procedures.friendRules()).dailyRequests === 2);
  for (const r of rows(o.conn.db.adminFriendRules.iter()).filter(r => r.name.endsWith(R))) await o.conn.reducers.adminDeleteFriendRule({ id: r.id });

  await friendSet({ maxFriends: 1 });
  const [h, h1, h2, h3] = [await player(), await player(), await player(), await player()];
  await h.p.conn.procedures.friendRequest({ targetIds: [h3.id] });
  await befriend(h, h1);
  check('max friends: cannot send while full', (await errorOf(h.p.conn.procedures.friendRequest({ targetIds: [h2.id] }))).includes('FRIEND_LIMIT_REACHED'));
  check('max friends: accepting a full sender refused', (await errorOf(h3.p.conn.reducers.friendAccept({ accountId: h.id }))).includes('FRIEND_TARGET_LIMIT_REACHED'));
  await h2.p.conn.procedures.friendRequest({ targetIds: [h.id] });
  check('max friends: accept past the limit refused', (await errorOf(h.p.conn.reducers.friendAccept({ accountId: h2.id }))).includes('FRIEND_LIMIT_REACHED'));
  await o.conn.reducers.adminAdjust({ accountId: h.id, kind: 'meta', key: slotMeta, action: 'set', value: 1, note: '' });
  await friendSet({ maxFriends: 1, friendsBonusMeta: slotMeta });
  const hr = await h.p.conn.procedures.friendRules();
  check('slot bonus raises the friend limit', hr.maxFriends === 2 && hr.friendSlotsLeft === 1);
  await h.p.conn.reducers.friendAccept({ accountId: h2.id });
  check('accept works with the bonus slot', await waitFor(() => friends(h.p).includes(h2.id)));

  await friendSet({ expiryDays: 1 });
  const [x1, x2, x3] = [await player(), await player(), await player()];
  await x1.p.conn.procedures.friendRequest({ targetIds: [x2.id, x3.id] });
  check('invite carries an expiry', await waitFor(() => (rows(x2.p.conn.db.myFriendRequestsIn.iter())[0]?.expiresAt ?? 0n) > 0n));
  await clock(2 * DAY);
  check('expired invite cannot be accepted', (await errorOf(x2.p.conn.reducers.friendAccept({ accountId: x1.id }))).includes('REQUEST_EXPIRED'));
  await o.conn.reducers.adminSocialRun({});
  check('sweep removes expired invites', await waitFor(() => !inReq(x3.p).includes(x1.id) && outReq(x1.p).length === 0));
  await clock(0);
  await friendSet({});

  const op = await panelUser(o, 'operator', Q);
  check('operator cannot change friend settings', (await errorOf(op.client.conn.reducers.adminSaveFriendSettings(FRIEND))).includes('FORBIDDEN'));
  check('player cannot read player friends', (await errorOf(a.p.conn.procedures.adminPlayerFriends({ accountId: b.id }))).includes('FORBIDDEN'));
  check('player sees no admin settings', rows(a.p.conn.db.adminFriendSettings.iter()).length === 0 && rows(a.p.conn.db.adminChatWords.iter()).length === 0);
  const pf = await op.client.conn.procedures.adminPlayerFriends({ accountId: h.id });
  check('admin sees a player friends', pf.edges.filter(e => e.state === 'friend').length === 2 && pf.rules.dailyRequests === 20);
  check('invalid setting refused', (await errorOf(o.conn.reducers.adminSaveFriendSettings({ ...FRIEND, overLimit: 'drop' }))).includes('INVALID_SETTING'));
  await o.conn.reducers.adminRemoveFriendship({ accountId: h.id, otherId: h1.id });
  check('admin removes a friendship', await waitFor(() => !friends(h.p).includes(h1.id) && !friends(h1.p).includes(h.id)));
  op.client.conn.disconnect();
}

async function chatSuite() {
  await chatSet({});
  await quotaSet({});
  const [a, b, cc, d] = [await player(), await player(), await player(), await player()];
  await befriend(a, b);
  const roomKey = k('lobby');
  check('room key validated', (await errorOf(o.conn.reducers.adminSaveRoom({ id: 0n, key: 'Bad Key', title: tr('لابی'), description: [], isActive: true, sort: 0 }))).includes('INVALID_KEY'));
  await o.conn.reducers.adminSaveRoom({ id: 0n, key: roomKey, title: tr('لابی', 'Lobby'), description: [], isActive: true, sort: 0 });
  check('duplicate room refused', (await errorOf(o.conn.reducers.adminSaveRoom({ id: 0n, key: roomKey, title: tr('x'), description: [], isActive: true, sort: 0 }))).includes('ALREADY_EXISTS'));
  check('players see public rooms', await waitFor(() => rows(a.p.conn.db.chatRooms.iter()).some(r => r.key === roomKey)));
  const room = rows(a.p.conn.db.chatRooms.iter()).find(r => r.key === roomKey)!;
  check('non-member cannot post in a room', (await errorOf(send(a, { channelId: room.id }))).includes('NOT_MEMBER'));
  await a.p.conn.reducers.chatJoinRoom({ channelId: room.id });
  await b.p.conn.reducers.chatJoinRoom({ channelId: room.id });
  const rm = await send(a, { channelId: room.id, text: 'سلام همه' });
  check('room message sent', rm.ok && rm.messageId > 0n && rm.text === 'سلام همه');
  check('room member sees it live', await waitFor(() => rows(b.p.conn.db.myChatMessages.iter()).some(m => m.id === rm.messageId && m.senderId === a.id)));
  check('non-member sees nothing', rows(cc.p.conn.db.myChatMessages.iter()).every(m => m.id !== rm.messageId));
  check('non-member cannot read history', (await errorOf(cc.p.conn.procedures.chatHistory({ channelId: room.id, beforeId: 0n, limit: 10 }))).includes('NOT_MEMBER'));

  const dm = await send(a, { peerId: cc.id, text: 'hello there' });
  check('direct message opens a channel', dm.ok && dm.channelId > 0n);
  check('peer sees the channel unread', await waitFor(() => rows(cc.p.conn.db.myChannels.iter()).some(ch => ch.channelId === dm.channelId && ch.kind === 'direct' && ch.peerId === a.id && ch.unread)));
  await cc.p.conn.reducers.chatMarkRead({ channelId: dm.channelId, messageId: 0n });
  check('mark read clears unread', await waitFor(() => rows(cc.p.conn.db.myChannels.iter()).some(ch => ch.channelId === dm.channelId && !ch.unread)));
  check('third player cannot see the DM', rows(d.p.conn.db.myChatMessages.iter()).every(m => m.channelId !== dm.channelId) && rows(b.p.conn.db.myChatMessages.iter()).every(m => m.channelId !== dm.channelId));
  check('outsider cannot post into the DM channel', (await errorOf(send(d, { channelId: dm.channelId, text: 'x' }))).includes('NOT_MEMBER'));
  check('self DM refused', (await errorOf(send(a, { peerId: a.id }))).includes('CANNOT_TARGET_SELF'));
  check('empty text refused', (await errorOf(send(a, { peerId: cc.id, text: '   ' }))).includes('TEXT_REQUIRED'));
  check('long text refused', (await errorOf(send(a, { peerId: cc.id, text: 'x'.repeat(501) }))).includes('MESSAGE_TOO_LONG'));
  check('reply to another channel refused', (await errorOf(send(a, { peerId: cc.id, text: 'r', replyToId: rm.messageId }))).includes('REPLY_NOT_FOUND'));
  check('reply in the same channel works', (await send(b, { channelId: room.id, text: 'reply', replyToId: rm.messageId })).ok);

  const m1 = await send(a, { peerId: cc.id, text: 'تو احمق هستی' });
  check('word filter masks Persian', m1.ok && m1.masked && m1.text === 'تو **** هستی');
  check('mask drops invisible marks', (await send(a, { peerId: cc.id, text: 'تو اح‌ـمق هستی' })).text === 'تو **** هستی');
  check('Arabic letters and suffixes matched', (await send(a, { peerId: cc.id, text: 'خيلي احمقی' })).masked);
  check('spaced letters matched', (await send(a, { peerId: cc.id, text: 'ا ح م ق' })).masked);
  check('two-word entry matched', (await send(a, { peerId: cc.id, text: 'خفه شو دیگه' })).text.startsWith('*** **'));
  check('leet and case matched', (await send(a, { peerId: cc.id, text: 'you ID10T' })).text === 'you *****');
  check('repeated letters matched', (await send(a, { peerId: cc.id, text: 'stuuupid' })).masked);
  check('clean text untouched', !(await send(a, { peerId: cc.id, text: 'مقاله خوبی بود' })).masked);
  check('block word refuses the message', (await errorOf(send(a, { peerId: cc.id, text: 'حرام‌زاده' }))).includes('CHAT_BLOCKED'));
  check('contains match across separators', (await errorOf(send(a, { peerId: cc.id, text: 'f.u.c.k off' }))).includes('CHAT_BLOCKED'));
  const fl = await send(a, { peerId: cc.id, text: 'this is a scam' });
  check('flag word passes but is flagged', fl.ok && fl.flagged && !fl.masked);
  const reps = await o.conn.procedures.adminReports({ query: '', status: '', titleId: 0n, targetId: a.id, reporterId: 0n, gameKey: 'chat', page: 1, pageSize: 50 });
  check('filter files a report', reps.rows.some(r => r.report.contentId === `chat:${fl.messageId}` && r.report.reporterId === 0n));
  const test = await o.conn.procedures.adminTestChatFilter({ text: 'تو احمق هستی' });
  check('filter test shows hits', test.changed && test.hits.some(h => h.word === 'احمق') && test.text === 'تو **** هستی');
  check('duplicate word by normal form refused', (await errorOf(o.conn.reducers.adminSaveChatWord({ id: 0n, word: 'احمق', action: 'mask', match: 'word', isActive: true, note: '' }))).includes('ALREADY_EXISTS'));
  check('bad action refused', (await errorOf(o.conn.reducers.adminSaveChatWord({ id: 0n, word: k('w'), action: 'nuke', match: 'word', isActive: true, note: '' }))).includes('INVALID_MOD_ACTION'));
  check('bad match refused', (await errorOf(o.conn.reducers.adminSaveChatWord({ id: 0n, word: k('w'), action: 'mask', match: 'regex', isActive: true, note: '' }))).includes('INVALID_MATCH'));
  const nw = `zz${R}`;
  await o.conn.reducers.adminSaveChatWord({ id: 0n, word: nw, action: 'block', match: 'word', isActive: true, note: '' });
  check('new word applies at once', (await errorOf(send(a, { peerId: cc.id, text: `hey ${nw}` }))).includes('CHAT_BLOCKED'));
  await waitFor(() => rows(o.conn.db.adminChatWords.iter()).some(w => w.word === nw));
  await o.conn.reducers.adminDeleteChatWord({ id: rows(o.conn.db.adminChatWords.iter()).find(w => w.word === nw)!.id });
  check('deleted word no longer applies', (await send(a, { peerId: cc.id, text: `hey ${nw}` })).ok);
  check('operator can edit words, player cannot', (await errorOf(a.p.conn.reducers.adminSaveChatWord({ id: 0n, word: 'x1', action: 'mask', match: 'word', isActive: true, note: '' }))).includes('FORBIDDEN'));

  await o.conn.reducers.adminRestrict({ accountId: b.id, kind: 'mute', minutes: 60, endsAt: 0n, reason: tr('بی‌احترامی'), note: '' });
  check('muted player cannot send', (await errorOf(send(b, { channelId: room.id }))).includes('CHAT_MUTED'));
  check('muted player cannot create groups', (await errorOf(b.p.conn.procedures.chatCreateGroup({ name: 'g', memberIds: [] }))).includes('CHAT_MUTED'));
  const det = await o.conn.procedures.adminPlayer({ accountId: b.id });
  await o.conn.reducers.adminLiftRestriction({ id: det.player.mute!.id, note: '' });
  check('lifted mute can send again', (await send(b, { channelId: room.id, text: 'back' })).ok);

  await cc.p.conn.reducers.friendBlock({ accountId: a.id });
  check('blocked: sender refused', (await errorOf(send(a, { peerId: cc.id, text: 'x' }))).includes('BLOCKED'));
  check('blocked: blocker refused too', (await errorOf(send(cc, { peerId: a.id, text: 'x' }))).includes('BLOCKED'));
  await cc.p.conn.reducers.friendUnblock({ accountId: a.id });

  await chatSet({ dmPolicy: 'friends' });
  check('friends-only DMs refuse strangers', (await errorOf(send(a, { peerId: d.id, text: 'x' }))).includes('NOT_FRIENDS'));
  check('friends-only DMs allow friends', (await send(a, { peerId: b.id, text: 'hey friend' })).ok);
  await chatSet({ messagesPerMinute: 3 });
  const burst = await Promise.all([0, 1, 2, 3, 4].map(i => errorOf(send(d, { channelId: 0n, peerId: cc.id, text: `b${i}` }))));
  check('rate limit per minute', burst.filter(x => x === '').length <= 3 && burst.some(x => x.includes('TOO_MANY_MESSAGES')));
  await chatSet({});

  const hist = rows([0, 1, 2, 3, 4]);
  for (const i of hist) await send(b, { peerId: d.id, text: `h${i}` });
  const ch = rows(b.p.conn.db.myChannels.iter()).find(x => x.peerId === d.id)!;
  const h1 = await b.p.conn.procedures.chatHistory({ channelId: ch.channelId, beforeId: 0n, limit: 2 });
  check('history pages newest first', h1.rows.length === 2 && h1.hasMore && h1.rows[0].text === 'h4');
  const h2 = await b.p.conn.procedures.chatHistory({ channelId: ch.channelId, beforeId: h1.rows[1].id, limit: 10 });
  check('history before id', h2.rows.length === 3 && !h2.hasMore && h2.rows[2].text === 'h0');

  const target = await send(a, { channelId: room.id, text: 'report me' });
  const rep = await b.p.conn.procedures.chatReport({ messageId: target.messageId, titleKey: 'abuse', note: 'rude' });
  check('message report filed', rep.reportId > 0n && !rep.duplicate);
  check('second report of the same message is a duplicate', (await b.p.conn.procedures.chatReport({ messageId: target.messageId, titleKey: 'spam', note: '' })).duplicate);
  check('own message report refused', (await errorOf(a.p.conn.procedures.chatReport({ messageId: target.messageId, titleKey: 'abuse', note: '' }))).includes('CANNOT_REPORT_OWN'));
  check('outsider cannot report an unseen message', (await errorOf(d.p.conn.procedures.chatReport({ messageId: target.messageId, titleKey: 'abuse', note: '' }))).includes('MESSAGE_NOT_FOUND'));
  check('bad title refused', (await errorOf(cc.p.conn.procedures.chatReport({ messageId: dm.messageId, titleKey: 'nope', note: '' }))).includes('REPORT_TITLE_NOT_FOUND'));
  const md = await o.conn.procedures.adminChatMessage({ id: target.messageId });
  check('admin sees message with context and reports', md.reports.length === 1 && md.context.some(x => x.id === rm.messageId) && md.row.channelKind === 'room');
  await o.conn.reducers.adminDeleteChatMessage({ id: target.messageId, note: 'rude' });
  check('deleted message hidden from players', await waitFor(() => rows(b.p.conn.db.myChatMessages.iter()).some(m => m.id === target.messageId && m.deleted && m.text === '')));
  check('delete twice refused', (await errorOf(o.conn.reducers.adminDeleteChatMessage({ id: target.messageId, note: '' }))).includes('ALREADY_REMOVED'));
  await o.conn.reducers.adminRestoreChatMessage({ id: target.messageId });
  check('restored message visible again', await waitFor(() => rows(b.p.conn.db.myChatMessages.iter()).some(m => m.id === target.messageId && !m.deleted)));
  const list = await o.conn.procedures.adminChatMessages({ channelId: 0n, senderId: a.id, query: '', flagged: true, status: '', page: 1, pageSize: 20 });
  check('admin filters flagged messages', list.rows.length >= 1 && list.rows.every(r => r.message.flagged && r.message.senderId === a.id));
  check('admin sees original text of masked messages', (await o.conn.procedures.adminChatMessages({ channelId: 0n, senderId: a.id, query: 'احمق', flagged: false, status: '', page: 1, pageSize: 20 })).rows.some(r => r.message.original.includes('احمق')));
  const own = await send(a, { channelId: room.id, text: 'oops' });
  await a.p.conn.reducers.chatDeleteMessage({ messageId: own.messageId });
  check('sender deletes own message', await waitFor(() => rows(b.p.conn.db.myChatMessages.iter()).some(m => m.id === own.messageId && m.deleted)));
  check('cannot delete others message', (await errorOf(b.p.conn.reducers.chatDeleteMessage({ messageId: rm.messageId }))).includes('MESSAGE_NOT_FOUND'));

  check('group with stranger refused', (await errorOf(a.p.conn.procedures.chatCreateGroup({ name: 'team', memberIds: [b.id, d.id] }))).includes('NOT_FRIENDS'));
  check('group name filtered', (await errorOf(a.p.conn.procedures.chatCreateGroup({ name: 'حرامزاده', memberIds: [] }))).includes('NAME_BLOCKED'));
  const grp = await a.p.conn.procedures.chatCreateGroup({ name: 'تیم احمق', memberIds: [b.id] });
  check('group created with members', await waitFor(() => rows(b.p.conn.db.myChannels.iter()).some(x => x.channelId === grp.channelId && x.kind === 'group' && x.members === 2 && x.name === 'تیم ****')));
  check('member cannot add others', (await errorOf(b.p.conn.reducers.chatGroupAdd({ channelId: grp.channelId, accountId: cc.id }))).includes('NOT_GROUP_OWNER'));
  check('group message reaches members', (await send(b, { channelId: grp.channelId, text: 'group hi' })).ok && (await waitFor(() => rows(a.p.conn.db.myChatMessages.iter()).some(m => m.channelId === grp.channelId))));
  check('non-member cannot post in group', (await errorOf(send(cc, { channelId: grp.channelId, text: 'x' }))).includes('NOT_MEMBER'));
  await chatSet({ groupsPerPlayer: 1 });
  check('groups per player limit', (await errorOf(a.p.conn.procedures.chatCreateGroup({ name: 'two', memberIds: [] }))).includes('TOO_MANY_GROUPS'));
  await chatSet({ groupMaxMembers: 2 });
  await befriend(a, cc);
  check('group size limit', (await errorOf(a.p.conn.reducers.chatGroupAdd({ channelId: grp.channelId, accountId: cc.id }))).includes('GROUP_FULL'));
  await chatSet({});
  await a.p.conn.reducers.chatGroupAdd({ channelId: grp.channelId, accountId: cc.id });
  await a.p.conn.reducers.chatGroupRemove({ channelId: grp.channelId, accountId: cc.id });
  check('owner adds and removes members', await waitFor(() => !rows(cc.p.conn.db.myChannels.iter()).some(x => x.channelId === grp.channelId)));
  await a.p.conn.reducers.chatLeave({ channelId: grp.channelId });
  check('owner leaving hands the group over', await waitFor(() => rows(b.p.conn.db.myChannels.iter()).some(x => x.channelId === grp.channelId && x.role === 'owner')));
  await chatSet({ chatEnabled: false });
  check('chat can be turned off', (await errorOf(send(a, { channelId: room.id, text: 'x' }))).includes('CHAT_OFF'));
  await chatSet({});
  check('players cannot create rooms', (await errorOf(a.p.conn.reducers.adminSaveRoom({ id: 0n, key: 'x', title: tr('x'), description: [], isActive: true, sort: 0 }))).includes('FORBIDDEN'));

  await o.conn.reducers.adminRestrict({ accountId: d.id, kind: 'suspend', minutes: 30, endsAt: 0n, reason: tr('تقلب'), note: '' });
  const sus = await errorOf(send(d, { peerId: cc.id, text: 'x' }));
  check('suspended player cannot chat', sus.includes('NOT_LOGGED_IN') || sus.includes('ACCOUNT_SUSPENDED'));
}

async function quotaSuite() {
  await chatSet({});
  await quotaSet({});
  const [a, b, cc, d] = [await player(), await player(), await player(), await player()];
  await send(a, { peerId: b.id, text: 'free' });
  const off = await a.p.conn.procedures.chatQuota();
  check('quota off: nothing counted', !off.enabled && off.today.sent === 0 && !sql(`SELECT * FROM social_quota_day WHERE account_id = ${a.id}`).includes(String(a.id)));
  const packMeta = k('dm_pack');
  const bonusMeta = k('dm_bonus');
  await meta(packMeta);
  await meta(bonusMeta);
  check('pack meta cannot also be bonus meta', (await errorOf(o.conn.reducers.adminSaveQuotaSettings({ ...QUOTA, packMeta, bonusMeta: packMeta }))).includes('SAME_META'));
  check('time zone bounded', (await errorOf(o.conn.reducers.adminSaveQuotaSettings({ ...QUOTA, utcOffsetMinutes: 2000 }))).includes('INVALID_TIMEZONE'));
  check('unknown item refused', (await errorOf(o.conn.reducers.adminSaveQuotaSettings({ ...QUOTA, unlimitedItems: ['nope_item'] }))).includes('ITEM_NOT_FOUND'));
  const packPrize = await prize(k('p_pack'), [{ type: 'meta', key: packMeta, action: 'add', value: 5 }]);
  const packProduct = await product(k('dm_pack_5'), packPrize, 50n);
  await o.conn.reducers.adminSavePaymentMethod({ method: 'in_app', isActive: true, config: '{}' });
  await quotaSet({ enabled: true, dailyMessages: 2, packMeta });
  await send(a, { peerId: b.id, text: '1' });
  await send(a, { peerId: b.id, text: '2' });
  const ref = await send(a, { peerId: b.id, text: '3' });
  check('quota refuses over the daily count', !ref.ok && ref.error === 'DM_QUOTA_EXCEEDED' && !!ref.quota && ref.quota.limit === 2 && ref.quota.used === 2 && ref.quota.unit === 'messages');
  check('refusal carries reset time and pack products', !!ref.quota && ref.quota.resetsAt.microsSinceUnixEpoch > BigInt(Date.now()) * 1000n && ref.quota.products.some(p => p.id === packProduct && p.amount === 5) && ref.quota.message.length > 0);
  const st1 = await a.p.conn.procedures.chatQuota();
  check('status shows the refusal', st1.enabled && st1.freeLeft === 0 && st1.today.blocked === 1 && st1.today.sent === 2 && st1.messages.used === 2);
  check('refused message not stored', !rows(b.p.conn.db.myChatMessages.iter()).some(m => m.text === '3'));
  check('room messages not counted by default', await (async () => {
    await o.conn.reducers.adminSaveRoom({ id: 0n, key: k('qroom'), title: tr('q'), description: [], isActive: true, sort: 0 });
    await waitFor(() => rows(a.p.conn.db.chatRooms.iter()).some(r => r.key === k('qroom')));
    const room = rows(a.p.conn.db.chatRooms.iter()).find(r => r.key === k('qroom'))!;
    await a.p.conn.reducers.chatJoinRoom({ channelId: room.id });
    return (await send(a, { channelId: room.id, text: 'room ok' })).ok;
  })());
  await a.p.conn.procedures.purchaseStart({ productId: packProduct, method: 'in_app', giftCode: '' });
  const st2 = await a.p.conn.procedures.chatQuota();
  check('bought pack becomes messages', st2.packsLeft === 5);
  check('pack message goes through', (await send(a, { peerId: b.id, text: 'p1' })).ok && (await a.p.conn.procedures.chatQuota()).packsLeft === 4);
  await o.conn.reducers.adminQuotaGrant({ accountId: a.id, amount: 3, expiresInDays: 0, note: 'gift' });
  const aq = await o.conn.procedures.adminPlayerQuota({ accountId: a.id });
  check('admin grant adds a lot', aq.status.packsLeft === 7 && aq.lots.some(l => l.source === 'admin' && l.amount === 3) && aq.days[0]?.packUsed === 1);
  for (const l of aq.lots) await o.conn.reducers.adminQuotaRevokeLot({ id: l.id });
  check('revoke empties the lots', (await a.p.conn.procedures.chatQuota()).packsLeft === 0);
  await o.conn.reducers.adminQuotaReset({ accountId: a.id });
  check('admin reset frees today', (await a.p.conn.procedures.chatQuota()).freeLeft === 2);

  await quotaSet({ enabled: true, dailyMessages: 2, packMeta });
  const e = await player();
  const par = await Promise.all([0, 1, 2, 3, 4].map(i => send(e, { peerId: cc.id, text: `x${i}` })));
  check('parallel sends never pass the quota', par.filter(r => r.ok).length === 2 && par.filter(r => r.error === 'DM_QUOTA_EXCEEDED').length === 3);

  await befriend(b, cc);
  await quotaSet({ enabled: true, dailyMessages: 1, friendPolicy: 'separate', friendDailyMessages: 3 });
  for (let i = 0; i < 3; i++) await send(b, { peerId: cc.id, text: `f${i}` });
  check('friends use their own quota', !(await send(b, { peerId: cc.id, text: 'f3' })).ok && (await send(b, { peerId: d.id, text: 'n0' })).ok);
  const bq = await b.p.conn.procedures.chatQuota();
  check('status shows friend quota', bq.friends?.messages.used === 3 && bq.friends?.messages.limit === 3 && bq.messages.used === 1);
  await quotaSet({ enabled: true, dailyMessages: 1, friendPolicy: 'free' });
  check('free friends policy', (await send(b, { peerId: cc.id, text: 'free friend' })).ok && (await send(b, { peerId: cc.id, text: 'free friend 2' })).ok);

  await quotaSet({ enabled: true, dailyMessages: 0, replyFree: 'reply' });
  const [r1, r2] = [await player(), await player()];
  check('zero free quota: packs only', (await send(r1, { peerId: r2.id, text: 'hi' })).error === 'DM_QUOTA_EXCEEDED');
  await o.conn.reducers.adminQuotaGrant({ accountId: r2.id, amount: 1, expiresInDays: 0, note: '' });
  check('pack lets the first message out', (await send(r2, { peerId: r1.id, text: 'hello' })).ok);
  check('one free reply after their message', (await send(r1, { peerId: r2.id, text: 'reply' })).ok && (await send(r1, { peerId: r2.id, text: 'again' })).error === 'DM_QUOTA_EXCEEDED');

  await quotaSet({ enabled: true, countMode: 'conversations', dailyConversations: 1 });
  const [s1, s2, s3] = [await player(), await player(), await player()];
  check('conversations mode: first chat costs one', (await send(s1, { peerId: s2.id, text: 'a' })).ok);
  check('conversations mode: more messages in the chat are free', (await send(s1, { peerId: s2.id, text: 'b' })).ok && (await send(s1, { peerId: s2.id, text: 'c' })).ok);
  const nc = await send(s1, { peerId: s3.id, text: 'new' });
  check('conversations mode: new chat over the limit refused', !nc.ok && nc.quota?.unit === 'conversations');
  await quotaSet({ enabled: true, countMode: 'both', dailyMessages: 10, dailyConversations: 1 });
  const [u1, u2, u3] = [await player(), await player(), await player()];
  await send(u1, { peerId: u2.id, text: 'a' });
  await o.conn.reducers.adminQuotaGrant({ accountId: u1.id, amount: 5, expiresInDays: 0, note: '' });
  check('both mode: chat cap is hard even with packs', (await send(u1, { peerId: u3.id, text: 'b' })).error === 'DM_CONVERSATION_LIMIT');

  const vip = await tag(k('qvip'));
  check('quota rule needs a limit or unlimited', (await errorOf(o.conn.reducers.adminSaveQuotaRule({ id: 0n, name: 'x', tagIds: [vip], priority: 0, unlimited: false, dailyMessages: undefined, dailyConversations: undefined, friendDailyMessages: undefined, friendDailyConversations: undefined, isActive: true }))).includes('LIMIT_REQUIRED'));
  await o.conn.reducers.adminSaveQuotaRule({ id: 0n, name: k('q_vip'), tagIds: [vip], priority: 5, unlimited: true, dailyMessages: undefined, dailyConversations: undefined, friendDailyMessages: undefined, friendDailyConversations: undefined, isActive: true });
  await quotaSet({ enabled: true, dailyMessages: 1 });
  const v = await player([vip]);
  check('unlimited by tag rule', (await send(v, { peerId: a.id, text: '1' })).ok && (await send(v, { peerId: a.id, text: '2' })).ok && (await send(v, { peerId: a.id, text: '3' })).ok);
  const vq = await v.p.conn.procedures.chatQuota();
  check('status says unlimited by rule', vq.unlimited && vq.unlimitedBy === 'rule' && vq.rule?.name === k('q_vip') && vq.today.unlimited === 3);
  for (const r of rows(o.conn.db.adminQuotaRules.iter()).filter(r => r.name.endsWith(R))) await o.conn.reducers.adminDeleteQuotaRule({ id: r.id });
  const vipItem = await item(k('dm_vip'), { typeKey: 'other' });
  const vipItem2 = await item(k('dm_vip2'), { typeKey: 'other' });
  await quotaSet({ enabled: true, dailyMessages: 1, unlimitedItems: [vipItem.key, vipItem2.key], bonusMeta });
  const w = await player();
  await give(w, vipItem.id);
  check('unlimited by owned item', (await send(w, { peerId: a.id, text: '1' })).ok && (await send(w, { peerId: a.id, text: '2' })).ok && (await w.p.conn.procedures.chatQuota()).unlimitedBy === 'item');
  check('item used by quota cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteItem({ id: vipItem2.id }))).includes('IN_USE'));
  const bm = await player();
  await o.conn.reducers.adminAdjust({ accountId: bm.id, kind: 'meta', key: bonusMeta, action: 'set', value: 2, note: '' });
  const bmq = await bm.p.conn.procedures.chatQuota();
  check('bonus meta adds to the free quota', bmq.messages.limit === 3 && bmq.bonus === 2);
  check('meta used by quota cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteMeta({ id: rows(o.conn.db.meta.iter()).find(m => m.key === bonusMeta)!.id }))).includes('IN_USE'));

  await quotaSet({ enabled: true, dailyMessages: 1 });
  const z = await player();
  await send(z, { peerId: a.id, text: '1' });
  check('quota used up today', (await send(z, { peerId: a.id, text: '2' })).error === 'DM_QUOTA_EXCEEDED');
  await clock(DAY);
  check('quota resets the next day', (await send(z, { peerId: a.id, text: '3' })).ok);
  await clock(0);
  await quotaSet({ enabled: true, dailyMessages: 0, notice: 'inbox' });
  const n = await player();
  await send(n, { peerId: a.id, text: '1' });
  await send(n, { peerId: a.id, text: '2' });
  check('inbox notice once on the first refusal', await waitFor(() => rows(n.p.conn.db.myInbox.iter()).filter(x => x.categoryKey === 'social').length === 1));
  const rep = await o.conn.procedures.adminQuotaReport({ days: 7 });
  check('quota report counts blocked', rep.blocked >= 5 && rep.blockedPlayers >= 3 && rep.packsFromAdmin >= 3 && rep.packsFromMeta >= 5);
  await quotaSet({});
}

async function giftsSuite() {
  await chatSet({});
  await quotaSet({});
  await giftSet({});
  await o.conn.reducers.adminSavePaymentMethod({ method: 'in_app', isActive: true, config: '{}' });
  await o.conn.reducers.adminSavePaymentMethod({ method: 'bazaar', isActive: true, config: JSON.stringify({ packageName: 'ir.example.game', apiSecret: 'very-secret-api', rsaPublicKey: '', sandbox: true }) });
  const [a, b, cc] = [await player(), await player(), await player()];
  await befriend(a, b);
  const skin = await item(k('g_skin'), {});
  const skin2 = await item(k('g_skin2'), {});
  const potion = await item(k('g_potion'), { typeKey: 'booster', stackable: true, maxStack: 10 });
  const frame = await item(k('g_frame'), { typeKey: 'frame' });
  await give(a, skin.id);
  await give(a, potion.id, 5);
  await give(a, frame.id);
  await waitFor(() => !!inv(a.p, skin.key) && inv(a.p, potion.key)?.quantity === 5 && !!inv(a.p, frame.key));

  const opts = await a.p.conn.procedures.giftOptions({ friendId: b.id });
  check('gift options for a friend', opts.canSend && opts.isFriend && opts.limits.pair.limit === 2 && opts.limits.pair.remaining === 2 && opts.items.some(i => i.itemKey === skin.key && i.giftable && !i.reason));
  check('gift options for a stranger say why', (await a.p.conn.procedures.giftOptions({ friendId: cc.id })).reason === 'NOT_FRIENDS');
  check('stranger refused', (await errorOf(gift(a, { friendId: cc.id, itemKey: skin.key }))).includes('NOT_FRIENDS'));
  check('self gift refused', (await errorOf(gift(a, { friendId: a.id, itemKey: skin.key }))).includes('GIFT_SELF'));
  check('one source required', (await errorOf(gift(a, { friendId: b.id }))).includes('GIFT_SOURCE_REQUIRED') && (await errorOf(gift(a, { friendId: b.id, itemKey: skin.key, currencyKey: gold, amount: 5n }))).includes('GIFT_SOURCE_REQUIRED'));
  check('item not owned refused', (await errorOf(gift(a, { friendId: b.id, itemKey: skin2.key }))).includes('ITEM_NOT_OWNED'));
  const r1 = await gift(a, { friendId: b.id, itemKey: skin.key, message: 'برای تو احمق جان' });
  check('instant item gift delivered', r1.status === 'delivered' && !r1.replayed && r1.giftId > 0n);
  check('item moved to the friend', await waitFor(() => !inv(a.p, skin.key) && inv(b.p, skin.key)?.source === 'gift'));
  check('recipient sees the gift without price', await waitFor(() => rows(b.p.conn.db.myGiftsReceived.iter()).some(g => g.id === r1.giftId && g.otherId === a.id && g.method === '' && g.message === 'برای تو **** جان')));
  check('sender sees it sent', rows(a.p.conn.db.myGiftsSent.iter()).some(g => g.id === r1.giftId && g.status === 'delivered'));
  check('third player sees no gifts', rows(cc.p.conn.db.myGiftsReceived.iter()).length === 0 && rows(cc.p.conn.db.myGiftsSent.iter()).length === 0);
  check('gift events recorded', events(a.id, 'Gift:Sent') === 1 && events(b.id, 'Gift:Received') === 1);
  check('recipient gets an inbox notice', await waitFor(() => rows(b.p.conn.db.myInbox.iter()).some(x => x.categoryKey === 'social')));
  check('regift refused', (await errorOf(gift(b, { friendId: a.id, itemKey: skin.key }))).includes('REGIFT_BLOCKED'));
  await give(cc, skin2.id);
  await give(a, skin2.id);
  await befriend(a, cc);
  check('recipient owns the item', (await errorOf(gift(a, { friendId: cc.id, itemKey: skin2.key }))).includes('RECIPIENT_OWNS_ITEM'));
  await a.p.conn.procedures.itemEquip({ key: frame.key });
  check('equipped item refused', (await errorOf(gift(a, { friendId: b.id, itemKey: frame.key }))).includes('ITEM_EQUIPPED'));
  await o.conn.reducers.adminSetGiftable({ kind: 'item', key: skin2.key, giftable: false });
  check('not giftable item refused', (await errorOf(gift(a, { friendId: b.id, itemKey: skin2.key }))).includes('ITEM_NOT_GIFTABLE'));
  await o.conn.reducers.adminSetGiftable({ kind: 'item', key: skin2.key, giftable: undefined });
  await o.conn.reducers.adminSetGiftable({ kind: 'item_type', key: 'booster', giftable: false });
  check('item type flag applies', (await errorOf(gift(a, { friendId: b.id, itemKey: potion.key, quantity: 2 }))).includes('ITEM_NOT_GIFTABLE'));
  await o.conn.reducers.adminSetGiftable({ kind: 'item', key: potion.key, giftable: true });
  check('item flag beats the type flag', (await gift(a, { friendId: b.id, itemKey: potion.key, quantity: 2 })).status === 'delivered');
  check('stackable quantity moved', await waitFor(() => inv(a.p, potion.key)?.quantity === 3 && inv(b.p, potion.key)?.quantity === 2));
  check('pair limit reached', (await errorOf(gift(a, { friendId: b.id, itemKey: potion.key }))).includes('GIFT_PAIR_DAILY_LIMIT'));
  await o.conn.reducers.adminSetGiftable({ kind: 'item_type', key: 'booster', giftable: undefined });
  const starter = rows(b.p.conn.db.myInventory.iter()).find(r => r.source === 'starter' && rows(o.conn.db.item.iter()).some(i => i.key === r.itemKey && !i.stackable));
  if (starter) check('starter item cannot be gifted', (await errorOf(gift(b, { friendId: a.id, itemKey: starter.itemKey }))).includes('STARTER_ITEM'));

  check('currency gifts off by default', (await errorOf(gift(a, { friendId: cc.id, currencyKey: gold, amount: 10n }))).includes('CURRENCY_GIFTS_OFF'));
  check('unknown currency in settings refused', (await errorOf(o.conn.reducers.adminSaveGiftSettings({ ...GIFT, currencyEnabled: true, currencies: [{ currencyKey: 'nope', min: 1n, max: 0n }] }))).includes('CURRENCY_NOT_FOUND'));
  await giftSet({ currencyEnabled: true, currencies: [{ currencyKey: gold, min: 10n, max: 200n }], perPairDaily: 3 });
  check('below the minimum refused', (await errorOf(gift(a, { friendId: cc.id, currencyKey: gold, amount: 5n }))).includes('INVALID_AMOUNT'));
  check('above the maximum refused', (await errorOf(gift(a, { friendId: cc.id, currencyKey: gold, amount: 500n }))).includes('INVALID_AMOUNT'));
  const rid = `req-${R}`;
  const cg = await gift(a, { friendId: cc.id, currencyKey: gold, amount: 100n, requestId: rid });
  check('currency gift moves balances', cg.status === 'delivered' && (await waitFor(() => bal(a.p) === 900n && bal(cc.p) === 1100n)));
  const again = await gift(a, { friendId: cc.id, currencyKey: gold, amount: 100n, requestId: rid });
  check('same request id replays without moving twice', again.replayed && again.giftId === cg.giftId && (await waitFor(() => bal(a.p) === 900n)));
  check('request id with other details refused', (await errorOf(gift(a, { friendId: cc.id, currencyKey: gold, amount: 50n, requestId: rid }))).includes('REQUEST_ID_REUSED'));
  check('bad request id refused', (await errorOf(gift(a, { friendId: cc.id, currencyKey: gold, amount: 50n, requestId: 'bad id!' }))).includes('INVALID_REQUEST_ID'));
  const [p1, p2] = [await player(), await player()];
  await befriend(p1, p2);
  const par = await Promise.all([0, 1, 2, 3, 4].map(() => errorOf(gift(p1, { friendId: p2.id, currencyKey: gold, amount: 10n }))));
  check('parallel gifts never pass the pair limit', par.filter(x => x === '').length === 3 && par.filter(x => x.includes('GIFT_PAIR_DAILY_LIMIT')).length === 2);
  check('parallel gifts move the exact amount', await waitFor(() => bal(p1.p) === 970n && bal(p2.p) === 1030n));
  const dupPar = await Promise.all([0, 1, 2].map(() => gift(p2, { friendId: p1.id, currencyKey: gold, amount: 10n, requestId: `dup-${R}` })));
  check('parallel duplicate request ids send once', new Set(dupPar.map(x => String(x.giftId))).size === 1 && dupPar.filter(x => x.replayed).length === 2 && (await waitFor(() => bal(p2.p) === 1020n)));
  await giftSet({ currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }], perPairDaily: 0 });
  check('insufficient balance refused and nothing counted', (await errorOf(gift(p2, { friendId: p1.id, currencyKey: gold, amount: 5000n }))).includes('INSUFFICIENT_BALANCE') && (await p2.p.conn.procedures.giftOptions({ friendId: p1.id })).limits.sender.used === 1);

  await p1.p.conn.reducers.friendBlock({ accountId: p2.id });
  await giftSet({ recipients: 'any', currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }] });
  check('block refuses gifts even for any player', (await errorOf(gift(p2, { friendId: p1.id, currencyKey: gold, amount: 1n }))).includes('GIFT_BLOCKED') && (await errorOf(gift(p1, { friendId: p2.id, currencyKey: gold, amount: 1n }))).includes('GIFT_BLOCKED'));
  const stranger = await player();
  check('any-player mode allows strangers', (await gift(stranger, { friendId: p2.id, currencyKey: gold, amount: 1n })).status === 'delivered');
  await giftSet({ minFriendDays: 3, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }] });
  check('friendship too new', (await errorOf(gift(a, { friendId: b.id, currencyKey: gold, amount: 1n }))).includes('FRIENDSHIP_TOO_NEW'));
  await clock(4 * DAY);
  check('old enough friendship passes', (await gift(a, { friendId: b.id, currencyKey: gold, amount: 1n })).status === 'delivered');
  await clock(0);
  await giftSet({ minSenderAccountDays: 30, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }] });
  check('sender account too new', (await errorOf(gift(a, { friendId: b.id, currencyKey: gold, amount: 1n }))).includes('SENDER_ACCOUNT_TOO_NEW'));
  await giftSet({ minMutualFriends: 1, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }] });
  check('mutual friends required', (await errorOf(gift(a, { friendId: b.id, currencyKey: gold, amount: 1n }))).includes('NOT_ENOUGH_MUTUAL_FRIENDS'));

  const gtag = await tag(k('gnosend'));
  const sendMeta = k('gift_bonus');
  await meta(sendMeta);
  await giftSet({ perSenderDaily: 1, perPairDaily: 0, sendBonusMeta: sendMeta, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }] });
  const [q1, q2, q3] = [await player(), await player(), await player()];
  await befriend(q1, q2);
  await befriend(q1, q3);
  await gift(q1, { friendId: q2.id, currencyKey: gold, amount: 1n });
  check('sender daily limit', (await errorOf(gift(q1, { friendId: q3.id, currencyKey: gold, amount: 1n }))).includes('GIFT_SENDER_DAILY_LIMIT'));
  await o.conn.reducers.adminAdjust({ accountId: q1.id, kind: 'meta', key: sendMeta, action: 'set', value: 1, note: '' });
  check('bonus meta raises the sender limit', (await gift(q1, { friendId: q3.id, currencyKey: gold, amount: 1n })).status === 'delivered');
  await giftSet({ perRecipientDaily: 1, perSenderDaily: 0, perPairDaily: 0, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }] });
  await befriend(q2, q3);
  check('recipient daily limit', (await errorOf(gift(q2, { friendId: q3.id, currencyKey: gold, amount: 1n }))).includes('GIFT_RECIPIENT_DAILY_LIMIT'));
  await o.conn.reducers.adminSaveGiftRule({ id: 0n, name: k('g_block'), tagIds: [gtag], priority: 1, perSenderDaily: undefined, perRecipientDaily: undefined, perPairDaily: undefined, canSend: false, isActive: true });
  await o.conn.reducers.adminSetPlayerTags({ accountId: q2.id, tagIds: [gtag] });
  check('tag rule can stop sending', (await errorOf(gift(q2, { friendId: q1.id, currencyKey: gold, amount: 1n }))).includes('GIFT_SENDING_BLOCKED'));
  for (const r of rows(o.conn.db.adminGiftRules.iter()).filter(r => r.name.endsWith(R))) await o.conn.reducers.adminDeleteGiftRule({ id: r.id });

  await giftSet({ delivery: 'accept', perPairDaily: 0, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }] });
  const [m1, m2] = [await player(), await player()];
  await befriend(m1, m2);
  await give(m1, skin.id);
  await give(m1, skin2.id);
  await waitFor(() => !!inv(m1.p, skin2.key));
  const pend = await gift(m1, { friendId: m2.id, itemKey: skin.key });
  check('accept mode holds the gift', pend.status === 'pending' && (await waitFor(() => !inv(m1.p, skin.key))) && !inv(m2.p, skin.key));
  check('recipient sees it pending with expiry', await waitFor(() => rows(m2.p.conn.db.myGiftsReceived.iter()).some(g => g.id === pend.giftId && g.status === 'pending' && g.expiresAt > 0n)));
  check('second pending gift of the same item refused', (await errorOf(gift(m1, { friendId: m2.id, itemKey: skin.key }))).includes('ITEM_NOT_OWNED'));
  check('only the recipient can accept', (await errorOf(m1.p.conn.reducers.giftAccept({ giftId: pend.giftId }))).includes('GIFT_NOT_FOUND'));
  await m2.p.conn.reducers.giftAccept({ giftId: pend.giftId });
  check('accepted gift delivered', await waitFor(() => inv(m2.p, skin.key)?.source === 'gift'));
  check('accept twice refused', (await errorOf(m2.p.conn.reducers.giftAccept({ giftId: pend.giftId }))).includes('GIFT_NOT_PENDING'));
  check('sender hears it was accepted', await waitFor(() => rows(m1.p.conn.db.myInbox.iter()).some(x => x.categoryKey === 'social')));
  const dec = await gift(m1, { friendId: m2.id, itemKey: skin2.key });
  await m2.p.conn.reducers.giftDecline({ giftId: dec.giftId });
  check('declined item goes back', await waitFor(() => !!inv(m1.p, skin2.key) && rows(m1.p.conn.db.myGiftsSent.iter()).some(g => g.id === dec.giftId && g.status === 'declined' && g.outcome === 'returned')));
  const can = await gift(m1, { friendId: m2.id, currencyKey: gold, amount: 50n });
  await waitFor(() => bal(m1.p) === 950n);
  const usedBefore = (await m1.p.conn.procedures.giftOptions({ friendId: m2.id })).limits.sender.used;
  await m1.p.conn.reducers.giftCancel({ giftId: can.giftId });
  check('cancelled currency comes back and is not counted', (await waitFor(() => bal(m1.p) === 1000n && bal(m2.p) === 1000n)) && (await m1.p.conn.procedures.giftOptions({ friendId: m2.id })).limits.sender.used === usedBefore - 1);
  check('recipient cannot cancel', (await errorOf(m2.p.conn.reducers.giftCancel({ giftId: dec.giftId }))).includes('GIFT_NOT_FOUND'));
  const exp = await gift(m1, { friendId: m2.id, currencyKey: gold, amount: 30n });
  await clock(4 * DAY);
  check('expired gift cannot be accepted', (await errorOf(m2.p.conn.reducers.giftAccept({ giftId: exp.giftId }))).includes('GIFT_EXPIRED'));
  await o.conn.reducers.adminSocialRun({});
  check('sweep returns an expired gift', await waitFor(() => bal(m1.p) === 1000n && rows(m1.p.conn.db.myGiftsSent.iter()).some(g => g.id === exp.giftId && g.status === 'expired')));
  await clock(0);
  await giftSet({ delivery: 'accept', onExpiry: 'accept', perPairDaily: 0, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }] });
  const auto = await gift(m1, { friendId: m2.id, currencyKey: gold, amount: 20n });
  await clock(4 * DAY);
  await o.conn.reducers.adminSocialRun({});
  check('auto-accept on expiry', await waitFor(() => bal(m2.p) === 1020n && rows(m2.p.conn.db.myGiftsReceived.iter()).some(g => g.id === auto.giftId && g.status === 'delivered')));
  await clock(0);

  await giftSet({ perPairDaily: 0 });
  const shopSkin = await item(k('g_shopskin'), {});
  const sp = await prize(k('p_shop2'), [{ type: 'item', key: shopSkin.key, action: 'give', value: 1 }]);
  const prod = await product(k('g_prod'), sp, 100n, ['in_app', 'bazaar'], `sku_${R}`);
  const [s1, s2, s3] = [await player(), await player(), await player()];
  await befriend(s1, s2);
  await befriend(s1, s3);
  await give(s1, shopSkin.id);
  check('method not allowed refused', (await errorOf(gift(s1, { friendId: s2.id, productId: prod, method: 'zarinpal' }))).includes('METHOD_NOT_ALLOWED'));
  const pg = await gift(s1, { friendId: s2.id, productId: prod, method: 'in_app' });
  check('shop gift with coins delivered even when the sender owns it', pg.status === 'delivered' && pg.purchase?.status === 'success');
  check('sender paid, recipient got the prize', await waitFor(() => bal(s1.p) === 900n && inv(s2.p, shopSkin.key)?.source === 'prize'));
  check('sender keeps own copy and gift is not a sender purchase', !!inv(s1.p, shopSkin.key) && (await s1.p.conn.procedures.myPurchases()).every(x => x.productId !== prod));
  check('recipient owns the product now', (await errorOf(gift(s1, { friendId: s2.id, productId: prod, method: 'in_app' }))).includes('RECIPIENT_OWNS_PRODUCT'));
  await o.conn.reducers.adminSetGiftable({ kind: 'product', key: k('g_prod'), giftable: false });
  check('not giftable product refused', (await errorOf(gift(s1, { friendId: s3.id, productId: prod, method: 'in_app' }))).includes('PRODUCT_NOT_GIFTABLE'));
  await o.conn.reducers.adminSetGiftable({ kind: 'product', key: k('g_prod'), giftable: undefined });
  const sg = await gift(s1, { friendId: s3.id, productId: prod, method: 'bazaar' });
  check('store gift waits for the store', sg.status === 'paying' && sg.purchase?.status === 'store' && sg.purchase.developerPayload === String(sg.purchase.paymentId));
  check('paying gift hidden from the recipient', rows(s3.p.conn.db.myGiftsReceived.iter()).every(g => g.id !== sg.giftId));
  check('another gift of the same product waits', (await errorOf(gift(s1, { friendId: s3.id, productId: prod, method: 'in_app' }))).includes('GIFT_ALREADY_PENDING'));
  await s1.p.conn.procedures.purchaseSubmit({ paymentId: sg.purchase!.paymentId, token: `sandbox-${sg.purchase!.paymentId}-x` });
  check('store payment delivers to the recipient', await waitFor(() => inv(s3.p, shopSkin.key)?.source === 'prize' && rows(s3.p.conn.db.myGiftsReceived.iter()).some(g => g.id === sg.giftId && g.status === 'delivered')));
  check('shop gift events', events(s1.id, 'Gift:Sent') === 2 && events(s3.id, 'Gift:Received') === 1);
  const poor = await player();
  await befriend(poor, s2);
  await o.conn.reducers.adminAdjust({ accountId: poor.id, kind: 'currency', key: gold, action: 'set', value: 10, note: '' });
  const skin3 = await item(k('g_skin3'), {});
  const prod3 = await product(k('g_prod3'), await prize(k('p_shop3'), [{ type: 'item', key: skin3.key, action: 'give', value: 1 }]), 100n);
  check('coins short refuses the shop gift', (await errorOf(gift(poor, { friendId: s2.id, productId: prod3, method: 'in_app' }))).includes('INSUFFICIENT_BALANCE'));
  check('failed shop gift not counted', await waitFor(() => rows(poor.p.conn.db.myGiftsSent.iter()).some(g => g.status === 'failed')) && (await poor.p.conn.procedures.giftOptions({ friendId: s2.id })).limits.sender.used === 0);
  await giftSet({ delivery: 'accept', perPairDaily: 0 });
  const held = await gift(s1, { friendId: s2.id, productId: prod3, method: 'in_app' });
  check('accept mode shop gift is pending and paid', held.status === 'pending' && (await waitFor(() => bal(s1.p) === 800n)) && !inv(s2.p, skin3.key));
  await s2.p.conn.reducers.giftDecline({ giftId: held.giftId });
  check('declined coin purchase refunded', await waitFor(() => bal(s1.p) === 900n && rows(s1.p.conn.db.myGiftsSent.iter()).some(g => g.id === held.giftId && g.outcome === 'refunded')));
  await giftSet({ perPairDaily: 0, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }], messageMaxLength: 10 });
  check('message length limit', (await errorOf(gift(s1, { friendId: s2.id, currencyKey: gold, amount: 1n, message: 'x'.repeat(11) }))).includes('MESSAGE_TOO_LONG'));
  check('blocked word in message refused', (await errorOf(gift(s1, { friendId: s2.id, currencyKey: gold, amount: 1n, message: 'fuck' }))).includes('MESSAGE_BLOCKED'));
  await giftSet({ perPairDaily: 0, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }], messageEnabled: false });
  check('messages can be turned off', (await errorOf(gift(s1, { friendId: s2.id, currencyKey: gold, amount: 1n, message: 'hi' }))).includes('GIFT_MESSAGES_OFF'));

  await giftSet({ perPairDaily: 0, perSenderDaily: 0, currencyEnabled: true, currencies: [{ currencyKey: gold, min: 1n, max: 0n }] });
  const ri = await gift(m1, { friendId: m2.id, itemKey: skin2.key });
  await waitFor(() => inv(m2.p, skin2.key)?.source === 'gift');
  check('player cannot reverse', (await errorOf(m1.p.conn.reducers.adminReverseFriendGift({ id: ri.giftId, returnTo: 'sender', note: '' }))).includes('FORBIDDEN'));
  await o.conn.reducers.adminReverseFriendGift({ id: ri.giftId, returnTo: 'sender', note: 'mistake' });
  check('reverse takes the item back to the sender', await waitFor(() => !inv(m2.p, skin2.key) && !!inv(m1.p, skin2.key)));
  check('reverse twice refused', (await errorOf(o.conn.reducers.adminReverseFriendGift({ id: ri.giftId, returnTo: 'sender', note: '' }))).includes('GIFT_NOT_REVERSIBLE'));
  const big = await gift(m1, { friendId: m2.id, currencyKey: gold, amount: 500n });
  await o.conn.reducers.adminAdjust({ accountId: m2.id, kind: 'currency', key: gold, action: 'set', value: 0, note: '' });
  check('reverse of spent currency refused', (await errorOf(o.conn.reducers.adminReverseFriendGift({ id: big.giftId, returnTo: 'sender', note: '' }))).includes('INSUFFICIENT_BALANCE'));
  check('refund only for coin purchases', (await errorOf(o.conn.reducers.adminReverseFriendGift({ id: big.giftId, returnTo: 'refund', note: '' }))).includes('INVALID_POLICY'));
  const before = bal(s1.p);
  await o.conn.reducers.adminReverseFriendGift({ id: pg.giftId, returnTo: 'refund', note: 'refund' });
  check('reverse a coin shop gift: prize taken, coins refunded', await waitFor(() => !inv(s2.p, shopSkin.key) && bal(s1.p) === before + 100n));
  const lst = await o.conn.procedures.adminFriendGifts({ status: '', kind: '', userId: m1.id, flagged: false, page: 1, pageSize: 50 });
  check('admin gift log by player', lst.total >= 5 && lst.rows.every(r => r.gift.senderId === m1.id || r.gift.recipientId === m1.id));
  check('admin gift log status filter', (await o.conn.procedures.adminFriendGifts({ status: 'reversed', kind: '', userId: 0n, flagged: false, page: 1, pageSize: 50 })).rows.every(r => r.gift.status === 'reversed'));
  const detail = await o.conn.procedures.adminFriendGift({ id: ri.giftId });
  check('gift trail from the audit log', detail.trail.some(t => t.action === 'gift.send') && detail.trail.some(t => t.action === 'gift.reverse') && detail.row.gift.reverseNote === 'mistake');
  const rep = await o.conn.procedures.adminFriendGiftReport({ days: 7 });
  check('gift report', rep.total >= 10 && rep.byKind.some(x => x.key === 'product') && rep.coinsSpent >= 200n && rep.currencyMoved > 0n);
  check('operator reads, cannot change settings', (await errorOf((await panelUser(o, 'operator', Q)).client.conn.reducers.adminSaveGiftSettings(GIFT))).includes('FORBIDDEN'));
  check('bad policy refused', (await errorOf(o.conn.reducers.adminSaveGiftSettings({ ...GIFT, delivery: 'mail' }))).includes('INVALID_SETTING'));
  const gcur = k('gcur');
  await o.conn.reducers.adminSaveCurrency({ id: 0n, key: gcur, name: tr('gcur'), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.currency.iter()).some(x => x.key === gcur));
  await giftSet({ currencyEnabled: true, currencies: [{ currencyKey: gcur, min: 1n, max: 0n }] });
  check('currency used by gifts cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteCurrency({ id: rows(o.conn.db.currency.iter()).find(x => x.key === gcur)!.id }))).includes('IN_USE'));
  await giftSet({ enabled: false });
  check('gifts can be turned off', (await errorOf(gift(s1, { friendId: s2.id, itemKey: shopSkin.key }))).includes('FRIEND_GIFTS_OFF'));
  await giftSet({});
}

async function main() {
  o = await c();
  await loginOwner(o);
  await clock(0);
  await o.conn.reducers.adminSaveCurrency({ id: 0n, key: gold, name: tr('طلا'), type: 'soft', defaultValue: 1000n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.currency.iter()).some(x => x.key === gold));
  await friendSet({});
  await chatSet({});
  await quotaSet({});
  await giftSet({});
  await seeds();
  await friendsSuite();
  await chatSuite();
  await quotaSuite();
  await giftsSuite();
  await clock(0);
  await friendSet({});
  await chatSet({});
  await quotaSet({});
  await giftSet({});
  done('social');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
