import { t } from 'spacetimedb/server';
import { adminOrNull, audit, fail, requireAccount, requireRole } from '@stg/base';
import { supRows, type SupportSchema } from './schema';
import { HOUR_US, MIN_US, base, bump, cleanBody, isAgent, isPlayerAccount, langOf, nameOf, nowUs, page, pick, supSettings, writeActivity, type ChatRow, type SDb, type STx } from './engine';
import { agentsOnline, cleanSubject, createTicket } from './core';

const ChatLine = t.row('SupportChatLine', {
  id: t.u64().primaryKey(),
  status: t.string(),
  topic: t.string(),
  departmentId: t.u64(),
  agentName: t.string(),
  agentTypingAt: t.u64(),
  agentLastSeenAt: t.u64(),
  agentReadSeq: t.u32(),
  lastSeq: t.u32(),
  playerReadSeq: t.u32(),
  ticketId: t.u64(),
  ticketNumber: t.string(),
  canRate: t.bool(),
  rating: t.u8(),
  createdAt: t.u64(),
  closedAt: t.u64(),
});
const ChatMessageLine = t.row('SupportChatMessageLine', {
  id: t.u64().primaryKey(),
  chatId: t.u64(),
  seq: t.u32(),
  authorType: t.string(),
  authorName: t.string(),
  body: t.string(),
  event: t.string(),
  at: t.u64(),
});
const QueueLine = t.row('SupportChatQueueLine', {
  id: t.u64().primaryKey(),
  accountId: t.u64(),
  playerName: t.string(),
  status: t.string(),
  topic: t.string(),
  departmentId: t.u64(),
  agentId: t.u64(),
  agentName: t.string(),
  lastSeq: t.u32(),
  agentReadSeq: t.u32(),
  playerTypingAt: t.u64(),
  playerSeenAt: t.u64(),
  lastMessageAt: t.u64(),
  createdAt: t.u64(),
  takenAt: t.u64(),
});
const OpenResult = t.object('SupportChatOpened', { chatId: t.u64(), status: t.string(), existing: t.bool(), agentsOnline: t.u32() });
const ChatPage = t.object('SupportChatPage', { total: t.u32(), rows: t.array(supRows.chat) });
const CloseResult = t.object('SupportChatClosed', { chatId: t.u64(), ticketId: t.u64(), ticketNumber: t.string() });

function addLine(ctx: STx, c: ChatRow, authorType: string, authorId: bigint, body: string, event: string): ChatRow {
  const seq = c.lastSeq + 1;
  const at = nowUs(ctx);
  ctx.db.supChatMessage.insert({ id: 0n, chatId: c.id, seq, authorType, authorId, body, event, at });
  return { ...c, lastSeq: seq, lastMessageAt: at };
}

function ownChat(ctx: SDb, accountId: bigint, id: bigint) {
  const c = ctx.db.supChat.id.find(id);
  if (!c || c.accountId !== accountId) fail('CHAT_NOT_FOUND');
  return c;
}

function anyChat(ctx: SDb, id: bigint) {
  const c = ctx.db.supChat.id.find(id);
  if (!c) fail('CHAT_NOT_FOUND');
  return c;
}

function agentChat(ctx: SDb, meId: bigint, id: bigint) {
  const c = anyChat(ctx, id);
  if (c.status === 'closed') fail('CHAT_CLOSED');
  if (c.status !== 'active' || c.agentId !== meId) fail('NOT_YOUR_CHAT');
  return c;
}

function closeChat(ctx: STx, c: ChatRow, by: string, byId: bigint): ChatRow {
  const next = { ...addLine(ctx, c, 'system', byId, '', 'closed'), status: 'closed', closedBy: by, closedAt: nowUs(ctx), playerTypingAt: 0n, agentTypingAt: 0n };
  ctx.db.supChat.id.update(next);
  writeActivity(ctx, c.accountId, { kind: 'chat', action: 'closed', refId: String(c.id), data: JSON.stringify({ by }), actor: by === 'player' ? 'player' : by === 'idle' ? 'system' : `admin:${byId}` });
  return next;
}

export function closeIdleChats(ctx: STx) {
  const s = supSettings(ctx);
  const cutoff = nowUs(ctx) - BigInt(s.chatIdleMinutes) * MIN_US;
  let n = 0;
  for (const status of ['waiting', 'active']) {
    for (const c of [...ctx.db.supChat.status.filter(status)]) {
      if (c.lastMessageAt > cutoff) continue;
      closeChat(ctx, c, 'idle', 0n);
      n++;
    }
  }
  return n;
}

function sessionAccountId(ctx: { db: STx['db']; sender: STx['sender'] }) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  if (!a || a.status !== 'active') return undefined;
  return a.id;
}

export function defineChat(st: SupportSchema) {
  const supportChatOpen = st.procedure({ topic: t.string(), body: t.string(), departmentKey: t.string() }, OpenResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      if (!isPlayerAccount(me)) fail('PLAYERS_ONLY');
      const s = supSettings(tx);
      if (!s.chatEnabled) fail('CHAT_DISABLED');
      const online = agentsOnline(tx);
      const body = cleanBody(a.body, 2000, false);
      const existing = [...tx.db.supChat.accountId.filter(me.id)].find(c => c.status !== 'closed');
      if (existing) {
        if (body) {
          bump(tx, `chatmsg|${me.id}`, s.chatMessagesPerMinute, MIN_US, 'TOO_MANY_MESSAGES');
          tx.db.supChat.id.update({ ...addLine(tx, existing, 'player', me.id, body, ''), playerSeenAt: tx.timestamp.microsSinceUnixEpoch });
        }
        return { chatId: existing.id, status: existing.status, existing: true, agentsOnline: online };
      }
      let departmentId = 0n;
      if (a.departmentKey.trim()) {
        const d = tx.db.supDepartment.key.find(a.departmentKey.trim());
        if (!d || !d.isActive) fail('DEPARTMENT_NOT_FOUND');
        departmentId = d.id;
      }
      const topic = a.topic.trim().slice(0, 150);
      bump(tx, `chat|${me.id}`, s.chatsPerHour, HOUR_US, 'TOO_MANY_CHATS');
      const now = nowUs(tx);
      let c = tx.db.supChat.insert({
        id: 0n,
        accountId: me.id,
        status: 'waiting',
        departmentId,
        topic,
        agentId: 0n,
        lastSeq: 0,
        playerReadSeq: 0,
        agentReadSeq: 0,
        playerTypingAt: 0n,
        agentTypingAt: 0n,
        playerSeenAt: tx.timestamp.microsSinceUnixEpoch,
        lastMessageAt: now,
        ticketId: 0n,
        rating: 0,
        ratingComment: '',
        closedBy: '',
        createdAt: now,
        takenAt: 0n,
        closedAt: 0n,
      });
      const lang = langOf(tx, me.id);
      const greeting = pick(tx, s.chatGreeting, lang);
      if (greeting) c = addLine(tx, c, 'system', 0n, greeting, 'greeting');
      if (!online) {
        const off = pick(tx, s.chatOffline, lang);
        if (off) c = addLine(tx, c, 'system', 0n, off, 'offline');
      }
      if (body) c = addLine(tx, c, 'player', me.id, body, '');
      tx.db.supChat.id.update({ ...c, playerReadSeq: c.lastSeq });
      writeActivity(tx, me.id, { kind: 'chat', action: 'opened', refId: String(c.id), data: JSON.stringify({ topic }), actor: 'player' });
      return { chatId: c.id, status: c.status, existing: false, agentsOnline: online };
    })
  );

  const supportChatSend = st.reducer({ chatId: t.u64(), body: t.string() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const s = supSettings(ctx);
    const c = ownChat(ctx, me.id, a.chatId);
    if (c.status === 'closed') fail('CHAT_CLOSED');
    const body = cleanBody(a.body, 2000);
    bump(ctx, `chatmsg|${me.id}`, s.chatMessagesPerMinute, MIN_US, 'TOO_MANY_MESSAGES');
    const next = addLine(ctx, c, 'player', me.id, body, '');
    ctx.db.supChat.id.update({ ...next, playerReadSeq: next.lastSeq, playerTypingAt: 0n, playerSeenAt: ctx.timestamp.microsSinceUnixEpoch });
  });

  const supportChatTyping = st.reducer({ chatId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const c = ownChat(ctx, me.id, a.chatId);
    if (c.status === 'closed') fail('CHAT_CLOSED');
    const now = ctx.timestamp.microsSinceUnixEpoch;
    ctx.db.supChat.id.update({ ...c, playerTypingAt: now, playerSeenAt: now });
  });

  const supportChatSeen = st.reducer({ chatId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const c = ownChat(ctx, me.id, a.chatId);
    ctx.db.supChat.id.update({ ...c, playerReadSeq: c.lastSeq, playerSeenAt: ctx.timestamp.microsSinceUnixEpoch });
  });

  const supportChatClose = st.reducer({ chatId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const c = ownChat(ctx, me.id, a.chatId);
    if (c.status === 'closed') fail('CHAT_CLOSED');
    closeChat(ctx, c, 'player', me.id);
  });

  const supportChatRate = st.reducer({ chatId: t.u64(), rating: t.u8(), comment: t.string() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const c = ownChat(ctx, me.id, a.chatId);
    if (c.status !== 'closed' || !c.takenAt) fail('CANNOT_RATE');
    if (c.rating) fail('ALREADY_RATED');
    if (a.rating < 1 || a.rating > 5) fail('INVALID_RATING');
    const comment = a.comment.trim();
    if (comment.length > 500) fail('COMMENT_TOO_LONG');
    ctx.db.supChat.id.update({ ...c, rating: a.rating, ratingComment: comment });
  });

  const myChats = st.view({ name: 'my_chats', public: true }, t.array(ChatLine), ctx => {
    const id = sessionAccountId(ctx as any);
    if (id === undefined) return [];
    return [...ctx.db.supChat.accountId.filter(id)]
      .sort((x, y) => (x.id < y.id ? 1 : -1))
      .slice(0, 20)
      .map(c => ({
        id: c.id,
        status: c.status,
        topic: c.topic,
        departmentId: c.departmentId,
        agentName: nameOf(ctx as any, c.agentId),
        agentTypingAt: c.agentTypingAt,
        agentLastSeenAt: c.agentId ? ctx.db.supAgent.accountId.find(c.agentId)?.lastSeenAt ?? 0n : 0n,
        agentReadSeq: c.agentReadSeq,
        lastSeq: c.lastSeq,
        playerReadSeq: c.playerReadSeq,
        ticketId: c.ticketId,
        ticketNumber: c.ticketId ? ctx.db.supTicket.id.find(c.ticketId)?.number ?? '' : '',
        canRate: c.status === 'closed' && c.takenAt > 0n && !c.rating,
        rating: c.rating,
        createdAt: c.createdAt,
        closedAt: c.closedAt,
      }));
  });

  const myChatMessages = st.view({ name: 'my_chat_messages', public: true }, t.array(ChatMessageLine), ctx => {
    const id = sessionAccountId(ctx as any);
    if (id === undefined) return [];
    const chats = [...ctx.db.supChat.accountId.filter(id)].sort((x, y) => (x.id < y.id ? 1 : -1));
    const keep = chats.filter((c, i) => c.status !== 'closed' || i === 0);
    const out = [];
    for (const c of keep) {
      for (const m of ctx.db.supChatMessage.chatId.filter(c.id)) {
        out.push({ id: m.id, chatId: m.chatId, seq: m.seq, authorType: m.authorType, authorName: m.authorType === 'agent' ? nameOf(ctx as any, m.authorId) : '', body: m.body, event: m.event, at: m.at });
      }
    }
    return out;
  });

  const adminChatQueue = st.view({ name: 'admin_chat_queue', public: true }, t.array(QueueLine), ctx => {
    if (!adminOrNull(ctx as any, 'support')) return [];
    const out = [];
    for (const status of ['waiting', 'active']) {
      for (const c of ctx.db.supChat.status.filter(status)) {
        out.push({
          id: c.id,
          accountId: c.accountId,
          playerName: nameOf(ctx as any, c.accountId),
          status: c.status,
          topic: c.topic,
          departmentId: c.departmentId,
          agentId: c.agentId,
          agentName: nameOf(ctx as any, c.agentId),
          lastSeq: c.lastSeq,
          agentReadSeq: c.agentReadSeq,
          playerTypingAt: c.playerTypingAt,
          playerSeenAt: c.playerSeenAt,
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
          takenAt: c.takenAt,
        });
      }
    }
    return out;
  });

  const adminChatMessages = st.view({ name: 'admin_chat_messages', public: true }, t.array(supRows.chatMessage), ctx => {
    const me = adminOrNull(ctx as any, 'support');
    if (!me) return [];
    const focus = ctx.db.supAgent.accountId.find(me.id)?.focusChatId ?? 0n;
    const ids = new Set<bigint>();
    for (const c of ctx.db.supChat.status.filter('waiting')) ids.add(c.id);
    for (const c of ctx.db.supChat.agentId.filter(me.id)) if (c.status === 'active') ids.add(c.id);
    if (focus) ids.add(focus);
    const out = [];
    for (const id of ids) for (const m of ctx.db.supChatMessage.chatId.filter(id)) out.push(m);
    return out;
  });

  const adminChatTake = st.reducer({ chatId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    const c = anyChat(ctx, a.chatId);
    if (c.status === 'closed') fail('CHAT_CLOSED');
    if (c.status !== 'waiting') fail('ALREADY_TAKEN');
    const next = addLine(ctx, c, 'system', me.id, nameOf(ctx, me.id), 'accepted');
    ctx.db.supChat.id.update({ ...next, status: 'active', agentId: me.id, takenAt: c.takenAt || nowUs(ctx), agentReadSeq: next.lastSeq });
    audit(base(ctx), me.id, 'support_chat.take', String(c.id));
  });

  const adminChatSend = st.reducer({ chatId: t.u64(), body: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    const c = agentChat(ctx, me.id, a.chatId);
    const body = cleanBody(a.body, 2000);
    const next = addLine(ctx, c, 'agent', me.id, body, '');
    ctx.db.supChat.id.update({ ...next, agentReadSeq: next.lastSeq, agentTypingAt: 0n });
  });

  const adminChatTyping = st.reducer({ chatId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    const c = agentChat(ctx, me.id, a.chatId);
    ctx.db.supChat.id.update({ ...c, agentTypingAt: ctx.timestamp.microsSinceUnixEpoch });
  });

  const adminChatRead = st.reducer({ chatId: t.u64(), seq: t.u32() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    const c = agentChat(ctx, me.id, a.chatId);
    const seq = Math.min(a.seq, c.lastSeq);
    if (seq > c.agentReadSeq) ctx.db.supChat.id.update({ ...c, agentReadSeq: seq });
  });

  const adminChatTransfer = st.reducer({ chatId: t.u64(), toAgentId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    const c = agentChat(ctx, me.id, a.chatId);
    if (a.toAgentId === me.id) fail('SAME_AGENT');
    if (a.toAgentId && !isAgent(ctx, a.toAgentId)) fail('AGENT_NOT_FOUND');
    const next = addLine(ctx, c, 'system', me.id, a.toAgentId ? nameOf(ctx, a.toAgentId) : '', 'transferred');
    ctx.db.supChat.id.update({ ...next, status: a.toAgentId ? 'active' : 'waiting', agentId: a.toAgentId, agentReadSeq: 0, agentTypingAt: 0n });
    audit(base(ctx), me.id, 'support_chat.transfer', String(c.id), `to=${a.toAgentId}`);
  });

  const adminChatClose = st.procedure({ chatId: t.u64(), toTicket: t.bool() }, CloseResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireRole(base(tx), 'support');
      const c = anyChat(tx, a.chatId);
      if (c.status === 'closed') fail('CHAT_CLOSED');
      if (c.status === 'active' && c.agentId !== me.id) fail('NOT_YOUR_CHAT');
      let closed = closeChat(tx, c, 'agent', me.id);
      let ticketId = 0n;
      let ticketNumber = '';
      if (a.toTicket) {
        const lines = [...tx.db.supChatMessage.chatId.filter(c.id)]
          .sort((x, y) => x.seq - y.seq)
          .filter(m => m.body && (m.authorType !== 'system' || m.event === 'greeting'))
          .map(m => `${m.authorType === 'player' ? nameOf(tx, c.accountId) : m.authorType === 'agent' ? nameOf(tx, m.authorId) : '-'}: ${m.body}`);
        const body = (lines.join('\n') || '-').slice(0, 5000);
        const departmentId = c.departmentId || [...tx.db.supDepartment.iter()].filter(d => d.isActive).sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1))[0]?.id || 0n;
        if (!departmentId) fail('DEPARTMENT_NOT_FOUND');
        const subject = cleanSubject(c.topic.length >= 3 ? c.topic : `Chat #${c.id}`);
        const tk = createTicket(tx, { accountId: c.accountId, subject, departmentId, priority: 'normal', source: 'chat', body, attachments: [], authorType: 'player', authorId: c.accountId, status: 'open', assigneeId: me.id, chatId: c.id });
        closed = { ...closed, ticketId: tk.id };
        tx.db.supChat.id.update(closed);
        ticketId = tk.id;
        ticketNumber = tk.number;
      }
      audit(base(tx), me.id, 'support_chat.close', String(c.id), a.toTicket ? `ticket=${ticketId}` : '');
      return { chatId: c.id, ticketId, ticketNumber };
    })
  );

  const adminChats = st.procedure({ view: t.string(), accountId: t.u64(), page: t.u32(), pageSize: t.u32() }, ChatPage, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireRole(base(tx), 'support');
      const list = [...tx.db.supChat.iter()]
        .filter(c => {
          if (a.view === 'queue' && c.status !== 'waiting') return false;
          if (a.view === 'mine' && !(c.status === 'active' && c.agentId === me.id)) return false;
          if (a.view === 'active' && c.status !== 'active') return false;
          if (a.view === 'closed' && c.status !== 'closed') return false;
          if (a.accountId && c.accountId !== a.accountId) return false;
          return true;
        })
        .sort((x, y) => (a.view === 'queue' ? (x.createdAt < y.createdAt ? -1 : 1) : x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  return {
    supportChatOpen,
    supportChatSend,
    supportChatTyping,
    supportChatSeen,
    supportChatClose,
    supportChatRate,
    myChats,
    myChatMessages,
    adminChatQueue,
    adminChatMessages,
    adminChatTake,
    adminChatSend,
    adminChatTyping,
    adminChatRead,
    adminChatTransfer,
    adminChatClose,
    adminChats,
  };
}
