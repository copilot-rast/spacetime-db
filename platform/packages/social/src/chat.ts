import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, cleanKey, cleanTranslations, fail, requireAccount, requireRole, toLatinDigits } from '@stg/base';
import { activeRestriction, fileReport, type PTx } from '@stg/players';
import { socialRows, type SocialSchema } from './schema';
import { areFriends, base, blockedEither, checkRate, cleanName, isPlayer, nameOf, oneOf, page, sessionId, socialSettings, type SDb, type STx } from './engine';
import { ACTIONS, MATCHES, filterText, normalizeWord } from './filter';
import { QuotaRefusal, quotaGate } from './quota';

const SendResult = t.object('ChatSendResult', {
  ok: t.bool(),
  error: t.string(),
  messageId: t.u64(),
  channelId: t.u64(),
  text: t.string(),
  masked: t.bool(),
  flagged: t.bool(),
  quota: t.option(QuotaRefusal),
});
const GroupResult = t.object('ChatGroupResult', { channelId: t.u64() });
const MessageOut = t.object('ChatMessageOut', { id: t.u64(), channelId: t.u64(), senderId: t.u64(), senderName: t.string(), text: t.string(), replyToId: t.u64(), deleted: t.bool(), createdAt: t.timestamp() });
const History = t.object('ChatHistory', { rows: t.array(MessageOut), hasMore: t.bool() });
const ReportOut = t.object('ChatReportResult', { reportId: t.u64(), duplicate: t.bool() });
const LiveMessage = t.row('ChatLiveMessage', { id: t.u64().primaryKey(), channelId: t.u64(), senderId: t.u64(), senderName: t.string(), text: t.string(), replyToId: t.u64(), deleted: t.bool(), createdAt: t.timestamp() });
const ChannelEntry = t.row('ChatChannelEntry', {
  channelId: t.u64().primaryKey(),
  kind: t.string(),
  title: Translations,
  name: t.string(),
  peerId: t.u64(),
  peerName: t.string(),
  role: t.string(),
  members: t.u32(),
  lastMessageId: t.u64(),
  lastMessageAt: t.option(t.timestamp()),
  lastReadId: t.u64(),
  unread: t.bool(),
});
const RoomEntry = t.row('ChatRoomEntry', { id: t.u64().primaryKey(), key: t.string(), title: Translations, description: Translations, members: t.u32(), sort: t.i32() });
const FilterHit = t.object('ChatFilterHit', { id: t.u64(), word: t.string(), action: t.string() });
const FilterTest = t.object('ChatFilterTest', { text: t.string(), normalized: t.string(), changed: t.bool(), blocked: t.bool(), flagged: t.bool(), hits: t.array(FilterHit) });
const AdminMessageRow = t.object('AdminChatMessageRow', { message: socialRows.message, channelKind: t.string(), channelName: t.string(), senderName: t.string(), reports: t.u32() });
const AdminMessagePage = t.object('AdminChatMessagePage', { total: t.u32(), rows: t.array(AdminMessageRow) });
const ReportRef = t.object('ChatReportRef', { id: t.u64(), reporterId: t.u64(), titleKey: t.string(), note: t.string(), status: t.string(), createdAt: t.timestamp() });
const AdminMessageDetail = t.object('AdminChatMessageDetail', { row: AdminMessageRow, context: t.array(socialRows.message), reports: t.array(ReportRef) });
const AdminGroupRow = t.object('AdminChatGroupRow', { channel: socialRows.channel, ownerName: t.string() });
const AdminGroupPage = t.object('AdminChatGroupPage', { total: t.u32(), rows: t.array(AdminGroupRow) });

type ChannelRow = NonNullable<ReturnType<STx['db']['channel']['id']['find']>>;
type MessageRow = NonNullable<ReturnType<STx['db']['chatMessage']['id']['find']>>;

function memberOf(ctx: SDb, channelId: bigint, accountId: bigint) {
  return ctx.db.member.key.find(`${channelId}|${accountId}`) ?? undefined;
}

function addMember(ctx: STx, ch: ChannelRow, accountId: bigint, role: string) {
  if (memberOf(ctx, ch.id, accountId)) return ch;
  ctx.db.member.insert({ key: `${ch.id}|${accountId}`, channelId: ch.id, accountId, role, lastReadId: ch.lastMessageId, joinedAt: ctx.timestamp });
  return ctx.db.channel.id.update({ ...ch, members: ch.members + 1 });
}

function removeMember(ctx: STx, ch: ChannelRow, accountId: bigint) {
  if (!ctx.db.member.key.delete(`${ch.id}|${accountId}`)) return ch;
  return ctx.db.channel.id.update({ ...ch, members: Math.max(ch.members - 1, 0) });
}

function dmKey(a: bigint, b: bigint) {
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

function dmPeer(ch: ChannelRow, me: bigint) {
  const [, x, y] = ch.key.split(':');
  return BigInt(x) === me ? BigInt(y) : BigInt(x);
}

function out(ctx: SDb, m: MessageRow) {
  const deleted = m.status !== 'visible';
  return { id: m.id, channelId: m.channelId, senderId: m.senderId, senderName: nameOf(ctx, m.senderId), text: deleted ? '' : m.text, replyToId: m.replyToId, deleted, createdAt: m.createdAt };
}

function blockedSet(ctx: SDb, me: bigint) {
  return new Set([...ctx.db.edge.accountId.filter(me)].filter(e => e.state === 'blocked').map(e => e.otherId));
}

function canSee(ctx: SDb, me: bigint, m: MessageRow) {
  return !!memberOf(ctx, m.channelId, me);
}

function filterReport(ctx: STx, m: MessageRow, hits: string[]) {
  const s = socialSettings(ctx);
  const title = ctx.db.reportTitle.key.find(s.filterReportTitle);
  const key = title && title.isActive ? title.key : [...ctx.db.reportTitle.iter()].filter(x => x.isActive).sort((a, b) => a.sort - b.sort)[0]?.key;
  if (!key) return;
  fileReport(ctx, { id: 0n, createdAt: ctx.timestamp }, { targetId: m.senderId, titleKey: key, note: `filter: ${hits.join(', ')}`.slice(0, 1000), matchId: `channel:${m.channelId}`, contentId: `chat:${m.id}`, gameKey: 'chat' }, true);
}

function groupName(ctx: STx, raw: string) {
  const name = cleanName(raw, 60);
  const f = filterText(ctx, name);
  if (f.blocked) fail('NAME_BLOCKED');
  return f.text;
}

export function defineChat(st: SocialSchema) {
  const chatSend = st.procedure({ channelId: t.u64(), peerId: t.u64(), text: t.string(), replyToId: t.u64() }, SendResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx)).id;
      const s = socialSettings(tx);
      if (!s.chatEnabled) fail('CHAT_OFF');
      if (activeRestriction(tx as unknown as PTx, me, 'mute')) fail('CHAT_MUTED');
      const text = a.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
      if (!text) fail('TEXT_REQUIRED');
      if ([...text].length > s.messageMaxLength) fail('MESSAGE_TOO_LONG');
      let ch: ChannelRow | undefined;
      let peerId = 0n;
      if (a.channelId) {
        ch = tx.db.channel.id.find(a.channelId) ?? undefined;
        if (!ch || !ch.isActive) fail('CHANNEL_NOT_FOUND');
        if (ch.kind === 'direct') {
          if (!ch.key.split(':').slice(1).includes(String(me))) fail('NOT_MEMBER');
          peerId = dmPeer(ch, me);
        } else if (!memberOf(tx, ch.id, me)) fail('NOT_MEMBER');
      } else {
        if (!a.peerId) fail('CHANNEL_REQUIRED');
        peerId = a.peerId;
        if (peerId === me) fail('CANNOT_TARGET_SELF');
        ch = tx.db.channel.key.find(dmKey(me, peerId)) ?? undefined;
      }
      if (peerId) {
        if (!isPlayer(tx, peerId)) fail('USER_NOT_FOUND');
        if (blockedEither(tx, me, peerId)) fail('BLOCKED');
        if (s.dmPolicy === 'none') fail('DIRECT_OFF');
        if (s.dmPolicy === 'friends' && !areFriends(tx, me, peerId)) fail('NOT_FRIENDS');
      }
      if (a.replyToId) {
        const r = tx.db.chatMessage.id.find(a.replyToId);
        if (!r || !ch || r.channelId !== ch.id || r.status !== 'visible') fail('REPLY_NOT_FOUND');
      }
      checkRate(tx, `chat|${me}`, s.messagesPerMinute, 'TOO_MANY_MESSAGES');
      const f = s.filterEnabled ? filterText(tx, text) : filterText(tx, text, 'off');
      if (f.blocked) fail('CHAT_BLOCKED');
      const kind = ch?.kind ?? 'direct';
      const refusal = quotaGate(tx, me, { kind, target: kind === 'direct' ? `u:${peerId}` : kind === 'group' ? `g:${ch!.id}` : `r:${ch!.id}`, peerId, startedByPeer: !!ch && ch.kind === 'direct' && ch.ownerId === peerId });
      if (refusal) return { ok: false, error: refusal.code, messageId: 0n, channelId: ch?.id ?? 0n, text: '', masked: false, flagged: false, quota: refusal };
      if (!ch) {
        ch = tx.db.channel.insert({ id: 0n, kind: 'direct', key: dmKey(me, peerId), title: [], description: [], name: '', ownerId: me, isActive: true, sort: 0, members: 0, messageCount: 0n, lastMessageId: 0n, lastMessageAt: undefined, createdAt: tx.timestamp });
      }
      if (ch.kind === 'direct') {
        ch = addMember(tx, ch, me, 'member');
        ch = addMember(tx, ch, peerId, 'member');
      }
      const m = tx.db.chatMessage.insert({ id: 0n, channelId: ch.id, senderId: me, text: f.text, original: f.changed ? text : '', replyToId: a.replyToId, status: 'visible', flagged: f.flagged, hits: f.hits.map(h => h.word), deletedBy: 0n, deletedAt: undefined, createdAt: tx.timestamp });
      tx.db.channel.id.update({ ...ch, messageCount: ch.messageCount + 1n, lastMessageId: m.id, lastMessageAt: tx.timestamp });
      const mine = memberOf(tx, ch.id, me);
      if (mine) tx.db.member.key.update({ ...mine, lastReadId: m.id });
      if (f.flagged) filterReport(tx, m, f.hits.filter(h => h.action === 'flag').map(h => h.word));
      return { ok: true, error: '', messageId: m.id, channelId: ch.id, text: f.text, masked: f.masked, flagged: f.flagged, quota: undefined };
    })
  );

  const chatJoinRoom = st.reducer({ channelId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const ch = ctx.db.channel.id.find(a.channelId);
    if (!ch || ch.kind !== 'room' || !ch.isActive) fail('CHANNEL_NOT_FOUND');
    addMember(ctx, ch, me, 'member');
  });

  const chatLeave = st.reducer({ channelId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    let ch = ctx.db.channel.id.find(a.channelId);
    const m = ch ? memberOf(ctx, ch.id, me) : undefined;
    if (!ch || !m) fail('NOT_MEMBER');
    ch = removeMember(ctx, ch, me);
    if (ch.kind === 'group' && ch.ownerId === me) {
      const next = [...ctx.db.member.channelId.filter(ch.id)].sort((x, y) => (x.joinedAt.microsSinceUnixEpoch < y.joinedAt.microsSinceUnixEpoch ? -1 : 1))[0];
      if (next) {
        ctx.db.member.key.update({ ...next, role: 'owner' });
        ctx.db.channel.id.update({ ...ch, ownerId: next.accountId });
      } else ctx.db.channel.id.update({ ...ch, ownerId: 0n, isActive: false });
    }
  });

  const chatMarkRead = st.reducer({ channelId: t.u64(), messageId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const m = memberOf(ctx, a.channelId, me);
    if (!m) fail('NOT_MEMBER');
    const ch = ctx.db.channel.id.find(a.channelId)!;
    const id = a.messageId && a.messageId < ch.lastMessageId ? a.messageId : ch.lastMessageId;
    if (id > m.lastReadId) ctx.db.member.key.update({ ...m, lastReadId: id });
  });

  const chatCreateGroup = st.procedure({ name: t.string(), memberIds: t.array(t.u64()) }, GroupResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx)).id;
      const s = socialSettings(tx);
      if (!s.chatEnabled || !s.groupsEnabled) fail('GROUPS_OFF');
      if (activeRestriction(tx as unknown as PTx, me, 'mute')) fail('CHAT_MUTED');
      const name = groupName(tx, a.name);
      const ids = [...new Set(a.memberIds)].filter(x => x !== me);
      if (ids.length + 1 > s.groupMaxMembers) fail('GROUP_FULL');
      const owned = [...tx.db.channel.kind.filter('group')].filter(c => c.isActive && c.ownerId === me).length;
      if (s.groupsPerPlayer && owned >= s.groupsPerPlayer) fail('TOO_MANY_GROUPS');
      for (const id of ids) {
        if (!isPlayer(tx, id)) fail('USER_NOT_FOUND');
        if (blockedEither(tx, me, id)) fail('BLOCKED');
        if (!areFriends(tx, me, id)) fail('NOT_FRIENDS');
      }
      let ch = tx.db.channel.insert({ id: 0n, kind: 'group', key: `group:${me}:${tx.timestamp.microsSinceUnixEpoch}:${owned}`, title: [], description: [], name, ownerId: me, isActive: true, sort: 0, members: 0, messageCount: 0n, lastMessageId: 0n, lastMessageAt: undefined, createdAt: tx.timestamp });
      ch = addMember(tx, ch, me, 'owner');
      for (const id of ids) ch = addMember(tx, ch, id, 'member');
      return { channelId: ch.id };
    })
  );

  const ownGroup = (ctx: STx, me: bigint, channelId: bigint) => {
    const ch = ctx.db.channel.id.find(channelId);
    if (!ch || ch.kind !== 'group' || !ch.isActive) fail('CHANNEL_NOT_FOUND');
    if (!memberOf(ctx, ch.id, me)) fail('NOT_MEMBER');
    if (ch.ownerId !== me) fail('NOT_GROUP_OWNER');
    return ch;
  };

  const chatGroupAdd = st.reducer({ channelId: t.u64(), accountId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const ch = ownGroup(ctx, me, a.channelId);
    if (!isPlayer(ctx, a.accountId)) fail('USER_NOT_FOUND');
    if (blockedEither(ctx, me, a.accountId)) fail('BLOCKED');
    if (!areFriends(ctx, me, a.accountId)) fail('NOT_FRIENDS');
    if (memberOf(ctx, ch.id, a.accountId)) fail('ALREADY_MEMBER');
    if (ch.members + 1 > socialSettings(ctx).groupMaxMembers) fail('GROUP_FULL');
    addMember(ctx, ch, a.accountId, 'member');
  });

  const chatGroupRemove = st.reducer({ channelId: t.u64(), accountId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const ch = ownGroup(ctx, me, a.channelId);
    if (a.accountId === me) fail('CANNOT_TARGET_SELF');
    if (!memberOf(ctx, ch.id, a.accountId)) fail('NOT_MEMBER');
    removeMember(ctx, ch, a.accountId);
  });

  const chatGroupRename = st.reducer({ channelId: t.u64(), name: t.string() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const ch = ownGroup(ctx, me, a.channelId);
    ctx.db.channel.id.update({ ...ch, name: groupName(ctx, a.name) });
  });

  const chatDeleteMessage = st.reducer({ messageId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const m = ctx.db.chatMessage.id.find(a.messageId);
    if (!m || m.senderId !== me || m.status !== 'visible') fail('MESSAGE_NOT_FOUND');
    ctx.db.chatMessage.id.update({ ...m, status: 'deleted', deletedBy: me, deletedAt: ctx.timestamp });
  });

  const chatHistory = st.procedure({ channelId: t.u64(), beforeId: t.u64(), limit: t.u32() }, History, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx)).id;
      if (!memberOf(tx, a.channelId, me)) fail('NOT_MEMBER');
      const max = socialSettings(tx).historyPageMax;
      const limit = Math.min(Math.max(a.limit || 50, 1), max);
      const blocked = blockedSet(tx, me);
      const list = [...tx.db.chatMessage.channelId.filter(a.channelId)].filter(m => (!a.beforeId || m.id < a.beforeId) && !blocked.has(m.senderId)).sort((x, y) => (x.id < y.id ? 1 : -1));
      return { rows: list.slice(0, limit).map(m => out(tx, m)), hasMore: list.length > limit };
    })
  );

  const chatReport = st.procedure({ messageId: t.u64(), titleKey: t.string(), note: t.string() }, ReportOut, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const m = tx.db.chatMessage.id.find(a.messageId);
      if (!m || !canSee(tx, me.id, m)) fail('MESSAGE_NOT_FOUND');
      if (m.senderId === me.id) fail('CANNOT_REPORT_OWN');
      if ([...a.note.trim()].length > 500) fail('NOTE_TOO_LONG');
      const contentId = `chat:${m.id}`;
      const dup = [...tx.db.report.reporterId.filter(me.id)].find(r => r.contentId === contentId);
      if (dup) return { reportId: dup.id, duplicate: true };
      return fileReport(tx, me, { targetId: m.senderId, titleKey: a.titleKey, note: a.note, matchId: `channel:${m.channelId}`, contentId, gameKey: 'chat' });
    })
  );

  const chatRooms = st.view({ name: 'chat_rooms', public: true }, t.array(RoomEntry), ctx =>
    [...ctx.db.channel.kind.filter('room')].filter(c => c.isActive).map(c => ({ id: c.id, key: c.key.slice(5), title: c.title, description: c.description, members: c.members, sort: c.sort }))
  );

  const myChannels = st.view({ name: 'my_channels', public: true }, t.array(ChannelEntry), ctx => {
    const me = sessionId(ctx as never);
    if (me === undefined) return [];
    return [...ctx.db.member.accountId.filter(me)].flatMap(m => {
      const c = ctx.db.channel.id.find(m.channelId);
      if (!c || !c.isActive) return [];
      const peerId = c.kind === 'direct' ? dmPeer(c, me) : 0n;
      return [{ channelId: c.id, kind: c.kind, title: c.title, name: c.name, peerId, peerName: peerId ? nameOf(ctx as never, peerId) : '', role: m.role, members: c.members, lastMessageId: c.lastMessageId, lastMessageAt: c.lastMessageAt, lastReadId: m.lastReadId, unread: c.lastMessageId > m.lastReadId }];
    });
  });

  const myChatLive = st.view({ name: 'my_chat_live', public: true }, t.array(LiveMessage), ctx => {
    const me = sessionId(ctx as never);
    if (me === undefined) return [];
    const n = ctx.db.socialSettings.id.find(0)?.liveMessages ?? 30;
    if (!n) return [];
    const blocked = blockedSet(ctx as never, me);
    return [...ctx.db.member.accountId.filter(me)].flatMap(m => {
      const c = ctx.db.channel.id.find(m.channelId);
      if (!c || !c.isActive) return [];
      return [...ctx.db.chatMessage.channelId.filter(c.id)]
        .filter(x => !blocked.has(x.senderId))
        .sort((x, y) => (x.id < y.id ? 1 : -1))
        .slice(0, n)
        .map(x => out(ctx as never, x));
    });
  });

  const adminChatSettings = st.view({ name: 'admin_chat_settings', public: true }, t.option(socialRows.settings), ctx => (adminOrNull(ctx as any) ? ctx.db.socialSettings.id.find(0) ?? undefined : undefined));

  const adminSaveChatSettings = st.reducer(
    {
      chatEnabled: t.bool(),
      messageMaxLength: t.u32(),
      messagesPerMinute: t.u32(),
      dmPolicy: t.string(),
      groupsEnabled: t.bool(),
      groupMaxMembers: t.u32(),
      groupsPerPlayer: t.u32(),
      filterEnabled: t.bool(),
      filterReportTitle: t.string(),
      historyPageMax: t.u32(),
      liveMessages: t.u32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      if (a.messageMaxLength < 1 || a.messageMaxLength > 4000) fail('INVALID_SETTING:messageMaxLength');
      if (a.messagesPerMinute > 600) fail('INVALID_SETTING:messagesPerMinute');
      oneOf(a.dmPolicy, ['anyone', 'friends', 'none'], 'dmPolicy');
      if (a.groupMaxMembers < 2 || a.groupMaxMembers > 1000) fail('INVALID_SETTING:groupMaxMembers');
      if (a.groupsPerPlayer > 100) fail('INVALID_SETTING:groupsPerPlayer');
      if (!ctx.db.reportTitle.key.find(a.filterReportTitle)) fail('REPORT_TITLE_NOT_FOUND');
      if (a.historyPageMax < 10 || a.historyPageMax > 200) fail('INVALID_SETTING:historyPageMax');
      if (a.liveMessages > 200) fail('INVALID_SETTING:liveMessages');
      ctx.db.socialSettings.id.update({ ...socialSettings(ctx), ...a, updatedAt: ctx.timestamp });
      audit(base(ctx), me.id, 'chat_settings.save', 'settings', JSON.stringify(a));
    }
  );

  const adminSetSocialClockOffset = st.reducer({ seconds: t.i64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (a.seconds > 3650n * 86400n || a.seconds < -3650n * 86400n) fail('INVALID_OFFSET');
    ctx.db.socialSettings.id.update({ ...socialSettings(ctx), clockOffsetSec: a.seconds, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'social.clock_offset', String(a.seconds));
  });

  const adminChatWords = st.view({ name: 'admin_chat_words', public: true }, t.array(socialRows.word), ctx => (adminOrNull(ctx as any) ? [...ctx.db.chatWord.iter()] : []));

  const adminSaveChatWord = st.reducer({ id: t.u64(), word: t.string(), action: t.string(), match: t.string(), isActive: t.bool(), note: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'operator');
    if (!ACTIONS.includes(a.action)) fail('INVALID_MOD_ACTION');
    if (!MATCHES.includes(a.match)) fail('INVALID_MATCH');
    const normalized = normalizeWord(a.word);
    const same = ctx.db.chatWord.normalized.find(normalized);
    if (same && same.id !== a.id) fail('ALREADY_EXISTS');
    const old = a.id ? ctx.db.chatWord.id.find(a.id) : undefined;
    if (a.id && !old) fail('NOT_FOUND');
    const row = { id: a.id, word: a.word.trim(), normalized, action: a.action, match: a.match, isActive: a.isActive, note: a.note.trim().slice(0, 200), createdAt: old?.createdAt ?? ctx.timestamp };
    const saved = old ? ctx.db.chatWord.id.update(row) : ctx.db.chatWord.insert({ ...row, id: 0n });
    audit(base(ctx), me.id, old ? 'chat_word.update' : 'chat_word.create', String(saved.id), `${saved.word} ${saved.action}`);
  });

  const adminDeleteChatWord = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'operator');
    if (!ctx.db.chatWord.id.delete(a.id)) fail('NOT_FOUND');
    audit(base(ctx), me.id, 'chat_word.delete', String(a.id));
  });

  const adminTestChatFilter = st.procedure({ text: t.string() }, FilterTest, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const f = filterText(tx, a.text.slice(0, 4000));
      return { text: f.text, normalized: f.normalized, changed: f.changed, blocked: f.blocked, flagged: f.flagged, hits: f.hits };
    })
  );

  const adminRooms = st.view({ name: 'admin_rooms', public: true }, t.array(socialRows.channel), ctx => (adminOrNull(ctx as any) ? [...ctx.db.channel.kind.filter('room')] : []));

  const adminSaveRoom = st.reducer({ id: t.u64(), key: t.string(), title: Translations, description: Translations, isActive: t.bool(), sort: t.i32() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const key = `room:${cleanKey(a.key)}`;
    const old = a.id ? ctx.db.channel.id.find(a.id) : undefined;
    if (a.id && (!old || old.kind !== 'room')) fail('NOT_FOUND');
    const same = ctx.db.channel.key.find(key);
    if (same && same.id !== a.id) fail('ALREADY_EXISTS');
    const title = cleanTranslations(a.title, base(ctx));
    const description = cleanTranslations(a.description, base(ctx), false);
    if (old) ctx.db.channel.id.update({ ...old, key, title, description, isActive: a.isActive, sort: a.sort });
    else ctx.db.channel.insert({ id: 0n, kind: 'room', key, title, description, name: '', ownerId: 0n, isActive: a.isActive, sort: a.sort, members: 0, messageCount: 0n, lastMessageId: 0n, lastMessageAt: undefined, createdAt: ctx.timestamp });
    audit(base(ctx), me.id, old ? 'room.update' : 'room.create', key);
  });

  const adminDeleteRoom = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const ch = ctx.db.channel.id.find(a.id);
    if (!ch || ch.kind !== 'room') fail('NOT_FOUND');
    for (const m of [...ctx.db.member.channelId.filter(ch.id)]) ctx.db.member.key.delete(m.key);
    for (const m of [...ctx.db.chatMessage.channelId.filter(ch.id)]) ctx.db.chatMessage.id.delete(m.id);
    ctx.db.channel.id.delete(ch.id);
    audit(base(ctx), me.id, 'room.delete', ch.key);
  });

  const adminRow = (ctx: SDb, m: MessageRow, reports?: number) => {
    const c = ctx.db.channel.id.find(m.channelId);
    const name = !c ? '' : c.kind === 'room' ? c.key.slice(5) : c.kind === 'group' ? c.name : c.key;
    const count = reports ?? [...ctx.db.report.targetId.filter(m.senderId)].filter(r => r.contentId === `chat:${m.id}`).length;
    return { message: m, channelKind: c?.kind ?? '', channelName: name, senderName: nameOf(ctx, m.senderId), reports: count };
  };

  const adminSocialMessages = st.procedure(
    { channelId: t.u64(), senderId: t.u64(), query: t.string(), flagged: t.bool(), status: t.string(), page: t.u32(), pageSize: t.u32() },
    AdminMessagePage,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(base(tx), 'operator');
        const q = toLatinDigits(a.query).trim().toLowerCase();
        const src = a.channelId ? tx.db.chatMessage.channelId.filter(a.channelId) : a.senderId ? tx.db.chatMessage.senderId.filter(a.senderId) : tx.db.chatMessage.iter();
        const list = [...src]
          .filter(m => (!a.senderId || m.senderId === a.senderId) && (!a.flagged || m.flagged) && (!a.status || m.status === a.status) && (!q || m.text.toLowerCase().includes(q) || m.original.toLowerCase().includes(q) || String(m.id) === q))
          .sort((x, y) => (x.id < y.id ? 1 : -1));
        const p = page(list, a.page, a.pageSize);
        return { total: p.total, rows: p.rows.map(m => adminRow(tx, m)) };
      })
  );

  const adminSocialMessage = st.procedure({ id: t.u64() }, AdminMessageDetail, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const m = tx.db.chatMessage.id.find(a.id);
      if (!m) fail('NOT_FOUND');
      const all = [...tx.db.chatMessage.channelId.filter(m.channelId)].sort((x, y) => (x.id < y.id ? -1 : 1));
      const i = all.findIndex(x => x.id === m.id);
      const reports = [...tx.db.report.targetId.filter(m.senderId)].filter(r => r.contentId === `chat:${m.id}`).map(r => ({ id: r.id, reporterId: r.reporterId, titleKey: r.titleKey, note: r.note, status: r.status, createdAt: r.createdAt }));
      return { row: adminRow(tx, m, reports.length), context: all.slice(Math.max(i - 5, 0), i + 6), reports };
    })
  );

  const adminDeleteChatMessage = st.reducer({ id: t.u64(), note: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'operator');
    const m = ctx.db.chatMessage.id.find(a.id);
    if (!m) fail('NOT_FOUND');
    if (m.status === 'removed') fail('ALREADY_REMOVED');
    ctx.db.chatMessage.id.update({ ...m, status: 'removed', deletedBy: me.id, deletedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'chat_message.delete', String(m.id), `sender=${m.senderId} ${a.note.trim().slice(0, 300)}`);
  });

  const adminRestoreChatMessage = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'operator');
    const m = ctx.db.chatMessage.id.find(a.id);
    if (!m) fail('NOT_FOUND');
    if (m.status !== 'removed') fail('NOT_REMOVED');
    ctx.db.chatMessage.id.update({ ...m, status: 'visible', deletedBy: 0n, deletedAt: undefined });
    audit(base(ctx), me.id, 'chat_message.restore', String(m.id));
  });

  const adminChatGroups = st.procedure({ query: t.string(), page: t.u32(), pageSize: t.u32() }, AdminGroupPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const q = a.query.trim().toLowerCase();
      const list = [...tx.db.channel.kind.filter('group')].filter(c => !q || c.name.toLowerCase().includes(q) || String(c.id) === q).sort((x, y) => (x.id < y.id ? 1 : -1));
      const p = page(list, a.page, a.pageSize);
      return { total: p.total, rows: p.rows.map(c => ({ channel: c, ownerName: nameOf(tx, c.ownerId) })) };
    })
  );

  const adminCloseGroup = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'operator');
    const ch = ctx.db.channel.id.find(a.id);
    if (!ch || ch.kind !== 'group') fail('NOT_FOUND');
    ctx.db.channel.id.update({ ...ch, isActive: false });
    audit(base(ctx), me.id, 'group.close', String(ch.id), ch.name);
  });

  return {
    chatSend,
    chatJoinRoom,
    chatLeave,
    chatMarkRead,
    chatCreateGroup,
    chatGroupAdd,
    chatGroupRemove,
    chatGroupRename,
    chatDeleteMessage,
    chatHistory,
    chatReport,
    chatRooms,
    myChannels,
    myChatLive,
    adminChatSettings,
    adminSaveChatSettings,
    adminSetSocialClockOffset,
    adminChatWords,
    adminSaveChatWord,
    adminDeleteChatWord,
    adminTestChatFilter,
    adminRooms,
    adminSaveRoom,
    adminDeleteRoom,
    adminSocialMessages,
    adminSocialMessage,
    adminDeleteChatMessage,
    adminRestoreChatMessage,
    adminChatGroups,
    adminCloseGroup
  };
}
