import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, fail, requireAccount, requireRole, toLatinDigits } from '@stg/base';
import { Attachment, supRows, supportTables, type SupportSchema } from './schema';
import {
  DAY_US,
  FINISHED,
  HOUR_US,
  PLAYER_EVENTS,
  PRIORITIES,
  STATUSES,
  WAITING_STAFF,
  base,
  bump,
  cleanAttachments,
  cleanBody,
  cleanKeyOf,
  cleanTr,
  isAgent,
  isPlayerAccount,
  langOf,
  nameOf,
  nowUs,
  page,
  pick,
  supSettings,
  writeActivity,
  type SDb,
  type STx,
  type TicketRow,
} from './engine';
import { closeIdleChats } from './chat';
import { addEvent, addMessage, agentsOnline, cleanSubject, createTicket, defaultDepartment, department, openAssigned, tellPlayer } from './core';

const KEY_RE = /^[a-z][a-z0-9_-]{0,47}$/;

const DepartmentLine = t.row('SupportDepartmentLine', { id: t.u64().primaryKey(), key: t.string(), name: Translations, description: Translations, firstResponseHours: t.u32(), sort: t.i32() });
const TicketLine = t.row('SupportTicketLine', {
  id: t.u64().primaryKey(),
  number: t.string(),
  subject: t.string(),
  departmentId: t.u64(),
  departmentKey: t.string(),
  priority: t.string(),
  status: t.string(),
  source: t.string(),
  messageCount: t.u32(),
  lastMessage: t.string(),
  lastStaffMessageAt: t.u64(),
  unread: t.bool(),
  canRate: t.bool(),
  rating: t.u8(),
  agentName: t.string(),
  chatId: t.u64(),
  createdAt: t.u64(),
  updatedAt: t.u64(),
  resolvedAt: t.u64(),
  closedAt: t.u64(),
});
const MessageLine = t.row('SupportMessageLine', {
  id: t.u64().primaryKey(),
  ticketId: t.u64(),
  authorType: t.string(),
  authorName: t.string(),
  body: t.string(),
  attachments: t.array(Attachment),
  event: t.string(),
  eventData: t.string(),
  at: t.u64(),
});
const AgentLine = t.row('SupportAgentLine', {
  accountId: t.u64().primaryKey(),
  name: t.string(),
  role: t.string(),
  lastSeenAt: t.u64(),
  away: t.bool(),
  openTickets: t.u32(),
  activeChats: t.u32(),
});
const CreateResult = t.object('SupportTicketCreated', { ticketId: t.u64(), number: t.string(), assigneeId: t.u64(), status: t.string() });
const AdminTicketLine = t.object('SupportAdminTicketLine', { ticket: supRows.ticket, playerName: t.string(), assigneeName: t.string(), departmentKey: t.string(), overdue: t.bool() });
const TicketPage = t.object('SupportTicketPage', { total: t.u32(), rows: t.array(AdminTicketLine) });
const TicketDetail = t.object('SupportTicketDetail', {
  ticket: supRows.ticket,
  messages: t.array(supRows.ticketMessage),
  playerName: t.string(),
  playerTickets: t.u32(),
  playerOpenTickets: t.u32(),
  assigneeName: t.string(),
  departmentKey: t.string(),
  overdue: t.bool(),
});
const Summary = t.object('SupportSummary', {
  awaitingStaff: t.u32(),
  waitingChats: t.u32(),
  activeChats: t.u32(),
  overdue: t.u32(),
  unassigned: t.u32(),
  mine: t.u32(),
  myChats: t.u32(),
  agentsOnline: t.u32(),
  avgFirstResponseMinutes: t.f64(),
  avgRating: t.f64(),
  rated: t.u32(),
  clockOffsetSec: t.i64(),
});
const RunResult = t.object('SupportRunResult', { ticketsClosed: t.u32(), chatsClosed: t.u32(), activityRemoved: t.u32() });
const SupportInfo = t.object('SupportInfo', {
  lang: t.string(),
  chatEnabled: t.bool(),
  agentsOnline: t.u32(),
  greeting: t.string(),
  offline: t.string(),
  maxAttachments: t.u32(),
  maxAttachmentKb: t.u32(),
  attachmentTypes: t.array(t.string()),
  unread: t.u32(),
  openTickets: t.u32(),
  chatId: t.u64(),
});

const AttachmentArg = t.array(Attachment);

function setStatus(ctx: STx, tk: TicketRow, to: string, byType: string, byId: bigint): TicketRow {
  const now = nowUs(ctx);
  const d = ctx.db.supDepartment.id.find(tk.departmentId);
  const next = { ...tk, status: to, statusAt: now, updatedAt: now };
  if (to === 'resolved') next.resolvedAt = now;
  if (to === 'closed') next.closedAt = now;
  if (WAITING_STAFF.includes(to)) {
    if (!WAITING_STAFF.includes(tk.status) || !tk.dueAt) next.dueAt = now + BigInt(d?.firstResponseHours ?? 24) * HOUR_US;
  } else next.dueAt = 0n;
  addEvent(ctx, tk.id, 'status_changed', to, byType, byId);
  return next;
}

function staffMove(from: string, to: string) {
  if (!STATUSES.includes(to) || to === 'open') fail('INVALID_STATUS');
  if (from === to) fail('INVALID_TRANSITION');
  if (to === 'resolved' || to === 'closed') {
    if (from === 'closed') fail('INVALID_TRANSITION');
  } else if (to === 'awaiting_staff') {
    if (!FINISHED.includes(from)) fail('INVALID_TRANSITION');
  } else if (to === 'awaiting_player') {
    if (!WAITING_STAFF.includes(from)) fail('INVALID_TRANSITION');
  }
}

function playerTicket(ctx: SDb, accountId: bigint, id: bigint) {
  const tk = ctx.db.supTicket.id.find(id);
  if (!tk || tk.accountId !== accountId) fail('TICKET_NOT_FOUND');
  return tk;
}

function staffTicket(ctx: SDb, id: bigint) {
  const tk = ctx.db.supTicket.id.find(id);
  if (!tk) fail('TICKET_NOT_FOUND');
  return tk;
}

function sessionAccountId(ctx: { db: STx['db']; sender: STx['sender'] }) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  if (!a || a.status !== 'active') return undefined;
  return a.id;
}

function overdueOf(tk: TicketRow, now: bigint) {
  return WAITING_STAFF.includes(tk.status) && tk.dueAt > 0n && tk.dueAt < now;
}

function priorityRank(p: string) {
  return PRIORITIES.indexOf(p);
}

export function autoCloseTickets(ctx: STx) {
  const s = supSettings(ctx);
  if (!s.autoCloseDays) return 0;
  const now = nowUs(ctx);
  const cutoff = now - BigInt(s.autoCloseDays) * DAY_US;
  let n = 0;
  for (const status of ['awaiting_player', 'resolved']) {
    for (const tk of [...ctx.db.supTicket.status.filter(status)]) {
      if (tk.statusAt > cutoff) continue;
      addEvent(ctx, tk.id, 'auto_closed', '', 'system', 0n);
      ctx.db.supTicket.id.update({ ...tk, status: 'closed', statusAt: now, closedAt: now, dueAt: 0n, updatedAt: now });
      writeActivity(ctx, tk.accountId, { kind: 'ticket', action: 'auto_closed', refId: String(tk.id), data: JSON.stringify({ number: tk.number }), actor: 'system' });
      n++;
    }
  }
  return n;
}

export function sweepActivity(ctx: STx) {
  const s = supSettings(ctx);
  if (!s.activityRetentionDays) return 0;
  const cutoff = nowUs(ctx) - BigInt(s.activityRetentionDays) * DAY_US;
  let n = 0;
  for (const r of [...ctx.db.playerActivity.iter()]) {
    if (r.at < cutoff) {
      ctx.db.playerActivity.id.delete(r.id);
      if (++n >= 5000) break;
    }
  }
  return n;
}

function sweepRates(ctx: STx) {
  const minute = ctx.timestamp.microsSinceUnixEpoch / 60_000_000n;
  for (const r of [...ctx.db.supRate.iter()]) if (r.bucket + 24n * 60n < minute) ctx.db.supRate.key.delete(r.key);
}

export function runSupport(ctx: STx) {
  const ticketsClosed = autoCloseTickets(ctx);
  const chatsClosed = closeIdleChats(ctx);
  const activityRemoved = sweepActivity(ctx);
  sweepRates(ctx);
  return { ticketsClosed, chatsClosed, activityRemoved };
}

function checkAgentList(ctx: SDb, ids: bigint[]) {
  const out = [...new Set(ids)];
  if (out.length > 100) fail('TOO_MANY_AGENTS');
  for (const id of out) if (!isAgent(ctx, id)) fail('AGENT_NOT_FOUND');
  return out;
}

export function defineTickets(st: SupportSchema) {
  const SettingsArgs = {
    maxOpenTickets: t.u32(),
    ticketsPerHour: t.u32(),
    messagesPerHour: t.u32(),
    maxAttachments: t.u32(),
    maxAttachmentKb: t.u32(),
    autoCloseDays: t.u32(),
    chatEnabled: t.bool(),
    chatGreeting: Translations,
    chatOffline: Translations,
    chatIdleMinutes: t.u32(),
    chatMessagesPerMinute: t.u32(),
    chatsPerHour: t.u32(),
    agentOnlineSeconds: t.u32(),
    activityRetentionDays: t.u32(),
    notifyCategoryKey: t.string(),
  };

  const adminSupportSettings = st.view({ name: 'admin_support_settings', public: true }, t.option(supRows.settings), ctx =>
    adminOrNull(ctx as any, 'support') ? ctx.db.supSettings.id.find(0) ?? undefined : undefined
  );

  const adminSaveSupportSettings = st.reducer(SettingsArgs, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = supSettings(ctx);
    if (a.maxOpenTickets < 1 || a.maxOpenTickets > 100) fail('INVALID_SETTING:maxOpenTickets');
    if (a.ticketsPerHour > 1000) fail('INVALID_SETTING:ticketsPerHour');
    if (a.messagesPerHour > 10_000) fail('INVALID_SETTING:messagesPerHour');
    if (a.maxAttachments > 20) fail('INVALID_SETTING:maxAttachments');
    if (a.maxAttachmentKb < 1 || a.maxAttachmentKb > 51_200) fail('INVALID_SETTING:maxAttachmentKb');
    if (a.autoCloseDays > 365) fail('INVALID_SETTING:autoCloseDays');
    if (a.chatIdleMinutes < 1 || a.chatIdleMinutes > 1440) fail('INVALID_SETTING:chatIdleMinutes');
    if (a.chatMessagesPerMinute > 1000) fail('INVALID_SETTING:chatMessagesPerMinute');
    if (a.chatsPerHour > 1000) fail('INVALID_SETTING:chatsPerHour');
    if (a.agentOnlineSeconds < 10 || a.agentOnlineSeconds > 3600) fail('INVALID_SETTING:agentOnlineSeconds');
    if (a.activityRetentionDays > 3650) fail('INVALID_SETTING:activityRetentionDays');
    const key = a.notifyCategoryKey.trim();
    if (key && !ctx.db.notifyCategory.key.find(key)) fail('CATEGORY_NOT_FOUND');
    const chatGreeting = cleanTr(ctx, a.chatGreeting, 1000, false);
    const chatOffline = cleanTr(ctx, a.chatOffline, 1000, false);
    ctx.db.supSettings.id.update({ ...s, ...a, notifyCategoryKey: key, chatGreeting, chatOffline, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'support_settings.save', 'settings', JSON.stringify({ ...a, chatGreeting: undefined, chatOffline: undefined }));
  });

  const adminSetSupportClockOffset = st.reducer({ seconds: t.i64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = supSettings(ctx);
    if (a.seconds < -3650n * 86400n || a.seconds > 3650n * 86400n) fail('INVALID_CLOCK_OFFSET');
    ctx.db.supSettings.id.update({ ...s, clockOffsetSec: a.seconds, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'support_settings.clock', 'settings', String(a.seconds));
  });

  const supportDepartments = st.view({ name: 'support_departments', public: true }, t.array(DepartmentLine), ctx =>
    [...ctx.db.supDepartment.iter()]
      .filter(d => d.isActive)
      .map(d => ({ id: d.id, key: d.key, name: d.name, description: d.description, firstResponseHours: d.firstResponseHours, sort: d.sort }))
  );

  const adminSupportDepartments = st.view({ name: 'admin_support_departments', public: true }, t.array(supRows.department), ctx =>
    adminOrNull(ctx as any, 'support') ? [...ctx.db.supDepartment.iter()] : []
  );

  const adminSaveSupportDepartment = st.reducer(
    { id: t.u64(), key: t.string(), name: Translations, description: Translations, firstResponseHours: t.u32(), agentIds: t.array(t.u64()), autoAssign: t.bool(), isActive: t.bool(), sort: t.i32() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const old = a.id ? ctx.db.supDepartment.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const key = cleanKeyOf(a.key, KEY_RE);
      if (old && old.key !== key) fail('KEY_LOCKED');
      if (!old && ctx.db.supDepartment.key.find(key)) fail('KEY_TAKEN');
      if (a.firstResponseHours < 1 || a.firstResponseHours > 720) fail('INVALID_RESPONSE_HOURS');
      const row = {
        id: a.id,
        key,
        name: cleanTr(ctx, a.name, 100, true),
        description: cleanTr(ctx, a.description, 500, false),
        firstResponseHours: a.firstResponseHours,
        agentIds: checkAgentList(ctx, a.agentIds),
        autoAssign: a.autoAssign,
        isActive: a.isActive,
        sort: a.sort,
        createdAt: old?.createdAt ?? ctx.timestamp,
      };
      const saved = old ? ctx.db.supDepartment.id.update(row) : ctx.db.supDepartment.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'support_department.update' : 'support_department.create', String(saved.id), key);
    }
  );

  const adminDeleteSupportDepartment = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const d = ctx.db.supDepartment.id.find(id);
    if (!d) fail('NOT_FOUND');
    if ([...ctx.db.supTicket.iter()].some(x => x.departmentId === id && x.status !== 'closed')) fail('IN_USE');
    if ([...ctx.db.supChat.iter()].some(x => x.departmentId === id && x.status !== 'closed')) fail('IN_USE');
    ctx.db.supDepartment.id.delete(id);
    for (const c of [...ctx.db.supCanned.iter()]) if (c.departmentId === id) ctx.db.supCanned.id.update({ ...c, departmentId: 0n });
    audit(base(ctx), me.id, 'support_department.delete', String(id), d.key);
  });

  const adminSupportCanned = st.view({ name: 'admin_support_canned', public: true }, t.array(supRows.canned), ctx =>
    adminOrNull(ctx as any, 'support') ? [...ctx.db.supCanned.iter()] : []
  );

  const adminSaveSupportCanned = st.reducer(
    { id: t.u64(), key: t.string(), title: Translations, body: Translations, departmentId: t.u64(), isActive: t.bool(), sort: t.i32() },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const old = a.id ? ctx.db.supCanned.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const key = cleanKeyOf(a.key, KEY_RE);
      const clash = ctx.db.supCanned.key.find(key);
      if (clash && clash.id !== a.id) fail('KEY_TAKEN');
      if (a.departmentId) department(ctx, a.departmentId);
      const row = {
        id: a.id,
        key,
        title: cleanTr(ctx, a.title, 100, true),
        body: cleanTr(ctx, a.body, 5000, true, 'BODY_REQUIRED'),
        departmentId: a.departmentId,
        isActive: a.isActive,
        sort: a.sort,
        updatedAt: ctx.timestamp,
      };
      const saved = old ? ctx.db.supCanned.id.update(row) : ctx.db.supCanned.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'support_canned.update' : 'support_canned.create', String(saved.id), key);
    }
  );

  const adminDeleteSupportCanned = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const c = ctx.db.supCanned.id.find(id);
    if (!c) fail('NOT_FOUND');
    ctx.db.supCanned.id.delete(id);
    audit(base(ctx), me.id, 'support_canned.delete', String(id), c.key);
  });

  const supportInfo = st.procedure({ lang: t.string() }, SupportInfo, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const s = supSettings(tx);
      const lang = langOf(tx, me.id, a.lang);
      const mine = [...tx.db.supTicket.accountId.filter(me.id)];
      const chat = [...tx.db.supChat.accountId.filter(me.id)].find(c => c.status !== 'closed');
      return {
        lang,
        chatEnabled: s.chatEnabled,
        agentsOnline: agentsOnline(tx),
        greeting: pick(tx, s.chatGreeting, lang),
        offline: pick(tx, s.chatOffline, lang),
        maxAttachments: s.maxAttachments,
        maxAttachmentKb: s.maxAttachmentKb,
        attachmentTypes: ['png', 'jpg', 'webp', 'pdf'],
        unread: mine.filter(x => x.lastStaffMessageAt > x.playerSeenAt).length,
        openTickets: mine.filter(x => !FINISHED.includes(x.status)).length,
        chatId: chat?.id ?? 0n,
      };
    })
  );

  const supportTicketCreate = st.procedure(
    { subject: t.string(), departmentKey: t.string(), body: t.string(), attachments: AttachmentArg },
    CreateResult,
    (ctx, a) =>
      ctx.withTx(tx => {
        const me = requireAccount(base(tx));
        if (!isPlayerAccount(me)) fail('PLAYERS_ONLY');
        const s = supSettings(tx);
        const subject = cleanSubject(a.subject);
        const body = cleanBody(a.body);
        const d = a.departmentKey.trim() ? tx.db.supDepartment.key.find(a.departmentKey.trim()) : defaultDepartment(tx);
        if (!d || !d.isActive) fail('DEPARTMENT_NOT_FOUND');
        const attachments = cleanAttachments(tx, a.attachments);
        const open = [...tx.db.supTicket.accountId.filter(me.id)].filter(x => !FINISHED.includes(x.status)).length;
        if (open >= s.maxOpenTickets) fail('TOO_MANY_OPEN_TICKETS');
        bump(tx, `ticket|${me.id}`, s.ticketsPerHour, HOUR_US, 'TOO_MANY_TICKETS');
        bump(tx, `msg|${me.id}`, s.messagesPerHour, HOUR_US, 'TOO_MANY_MESSAGES');
        const tk = createTicket(tx, { accountId: me.id, subject, departmentId: d.id, priority: 'normal', source: 'player', body, attachments, authorType: 'player', authorId: me.id, status: 'open', assigneeId: 0n, chatId: 0n });
        return { ticketId: tk.id, number: tk.number, assigneeId: tk.assigneeId, status: tk.status };
      })
  );

  const supportTicketReply = st.reducer({ ticketId: t.u64(), body: t.string(), attachments: AttachmentArg }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const s = supSettings(ctx);
    let tk = playerTicket(ctx, me.id, a.ticketId);
    if (tk.status === 'closed') fail('TICKET_CLOSED');
    const body = cleanBody(a.body);
    const attachments = cleanAttachments(ctx, a.attachments);
    bump(ctx, `msg|${me.id}`, s.messagesPerHour, HOUR_US, 'TOO_MANY_MESSAGES');
    tk = addMessage(ctx, tk, 'message', 'player', me.id, body, attachments);
    const now = nowUs(ctx);
    if (tk.status !== 'open' && tk.status !== 'awaiting_staff') tk = setStatus(ctx, tk, 'awaiting_staff', 'player', me.id);
    ctx.db.supTicket.id.update({ ...tk, lastPlayerMessageAt: now, playerSeenAt: now });
  });

  const supportTicketResolve = st.reducer({ ticketId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const tk = playerTicket(ctx, me.id, a.ticketId);
    if (FINISHED.includes(tk.status)) fail('INVALID_TRANSITION');
    ctx.db.supTicket.id.update(setStatus(ctx, tk, 'resolved', 'player', me.id));
    writeActivity(ctx, me.id, { kind: 'ticket', action: 'resolved', refId: String(tk.id), data: JSON.stringify({ number: tk.number }), actor: 'player' });
  });

  const supportTicketRate = st.reducer({ ticketId: t.u64(), rating: t.u8(), comment: t.string() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const tk = playerTicket(ctx, me.id, a.ticketId);
    if (!FINISHED.includes(tk.status)) fail('TICKET_NOT_FINISHED');
    if (tk.rating) fail('ALREADY_RATED');
    if (a.rating < 1 || a.rating > 5) fail('INVALID_RATING');
    const comment = a.comment.trim();
    if (comment.length > 500) fail('COMMENT_TOO_LONG');
    addEvent(ctx, tk.id, 'rated', String(a.rating), 'player', me.id);
    ctx.db.supTicket.id.update({ ...tk, rating: a.rating, ratingComment: comment, ratedAt: nowUs(ctx) });
  });

  const supportTicketSeen = st.reducer({ ticketId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const tk = playerTicket(ctx, me.id, a.ticketId);
    ctx.db.supTicket.id.update({ ...tk, playerSeenAt: nowUs(ctx) });
  });

  const myTickets = st.view({ name: 'my_tickets', public: true }, t.array(TicketLine), ctx => {
    const id = sessionAccountId(ctx as any);
    if (id === undefined) return [];
    return [...ctx.db.supTicket.accountId.filter(id)]
      .sort((x, y) => (x.id < y.id ? 1 : -1))
      .slice(0, 50)
      .map(x => ({
        id: x.id,
        number: x.number,
        subject: x.subject,
        departmentId: x.departmentId,
        departmentKey: ctx.db.supDepartment.id.find(x.departmentId)?.key ?? '',
        priority: x.priority,
        status: x.status,
        source: x.source,
        messageCount: x.messageCount,
        lastMessage: x.lastMessage,
        lastStaffMessageAt: x.lastStaffMessageAt,
        unread: x.lastStaffMessageAt > x.playerSeenAt,
        canRate: FINISHED.includes(x.status) && !x.rating,
        rating: x.rating,
        agentName: nameOf(ctx as any, x.assigneeId),
        chatId: x.chatId,
        createdAt: x.createdAt,
        updatedAt: x.updatedAt,
        resolvedAt: x.resolvedAt,
        closedAt: x.closedAt,
      }));
  });

  const myTicketMessages = st.view({ name: 'my_ticket_messages', public: true }, t.array(MessageLine), ctx => {
    const id = sessionAccountId(ctx as any);
    if (id === undefined) return [];
    const tickets = [...ctx.db.supTicket.accountId.filter(id)].sort((x, y) => (x.id < y.id ? 1 : -1)).slice(0, 50);
    const out = [];
    for (const tk of tickets) {
      for (const m of ctx.db.supTicketMessage.ticketId.filter(tk.id)) {
        if (m.kind === 'note') continue;
        if (m.kind === 'event' && !PLAYER_EVENTS.includes(m.event)) continue;
        out.push({ id: m.id, ticketId: m.ticketId, authorType: m.authorType, authorName: m.authorType === 'system' ? '' : nameOf(ctx as any, m.authorId), body: m.body, attachments: m.attachments, event: m.event, eventData: m.eventData, at: m.at });
      }
    }
    return out;
  });

  const adminSupportCreateTicket = st.procedure(
    { accountId: t.u64(), subject: t.string(), body: t.string(), departmentId: t.u64(), priority: t.string(), attachments: AttachmentArg },
    CreateResult,
    (ctx, a) =>
      ctx.withTx(tx => {
        const me = requireRole(base(tx), 'support');
        const p = tx.db.account.id.find(a.accountId);
        if (!isPlayerAccount(p)) fail('USER_NOT_FOUND');
        const priority = a.priority || 'normal';
        if (!PRIORITIES.includes(priority)) fail('INVALID_PRIORITY');
        const d = a.departmentId ? department(tx, a.departmentId) : defaultDepartment(tx);
        const tk = createTicket(tx, {
          accountId: a.accountId,
          subject: cleanSubject(a.subject),
          departmentId: d.id,
          priority,
          source: 'staff',
          body: cleanBody(a.body),
          attachments: cleanAttachments(tx, a.attachments),
          authorType: 'staff',
          authorId: me.id,
          status: 'awaiting_player',
          assigneeId: me.id,
          chatId: 0n,
        });
        tellPlayer(tx, tk, 'created');
        audit(base(tx), me.id, 'support_ticket.create', String(tk.id), `${tk.number} player=${a.accountId}`);
        return { ticketId: tk.id, number: tk.number, assigneeId: tk.assigneeId, status: tk.status };
      })
  );

  const adminSupportReply = st.reducer(
    { ticketId: t.u64(), body: t.string(), internal: t.bool(), status: t.string(), attachments: AttachmentArg },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'support');
      let tk = staffTicket(ctx, a.ticketId);
      const body = cleanBody(a.body);
      const attachments = cleanAttachments(ctx, a.attachments);
      if (a.internal) {
        addMessage(ctx, tk, 'note', 'staff', me.id, body, attachments);
        return;
      }
      if (tk.status === 'closed') fail('TICKET_CLOSED');
      const to = a.status || 'awaiting_player';
      if (!['awaiting_player', 'resolved', 'closed'].includes(to)) fail('INVALID_STATUS');
      const now = nowUs(ctx);
      tk = addMessage(ctx, tk, 'message', 'staff', me.id, body, attachments);
      tk = { ...tk, lastStaffMessageAt: now, firstResponseAt: tk.firstResponseAt || now };
      if (!tk.assigneeId) {
        tk = { ...tk, assigneeId: me.id };
        addEvent(ctx, tk.id, 'assigned', String(me.id), 'staff', me.id);
      }
      if (tk.status !== to) tk = setStatus(ctx, tk, to, 'staff', me.id);
      else tk = { ...tk, dueAt: 0n };
      ctx.db.supTicket.id.update(tk);
      tellPlayer(ctx, tk, to === 'awaiting_player' ? 'reply' : (to as 'resolved' | 'closed'));
      if (to !== 'awaiting_player') writeActivity(ctx, tk.accountId, { kind: 'ticket', action: to, refId: String(tk.id), data: JSON.stringify({ number: tk.number }), actor: `admin:${me.id}` });
    }
  );

  const adminSupportStatus = st.reducer({ ticketId: t.u64(), status: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    const tk = staffTicket(ctx, a.ticketId);
    staffMove(tk.status, a.status);
    const next = setStatus(ctx, tk, a.status, 'staff', me.id);
    ctx.db.supTicket.id.update(next);
    if (a.status === 'resolved' || a.status === 'closed') {
      tellPlayer(ctx, next, a.status);
      writeActivity(ctx, tk.accountId, { kind: 'ticket', action: a.status, refId: String(tk.id), data: JSON.stringify({ number: tk.number }), actor: `admin:${me.id}` });
    }
    audit(base(ctx), me.id, 'support_ticket.status', String(tk.id), `${tk.status}->${a.status}`);
  });

  const adminSupportAssign = st.reducer({ ticketId: t.u64(), assigneeId: t.u64(), departmentId: t.u64(), priority: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    const orig = staffTicket(ctx, a.ticketId);
    let tk = orig;
    if (a.assigneeId && !isAgent(ctx, a.assigneeId)) fail('AGENT_NOT_FOUND');
    const priority = a.priority || tk.priority;
    if (!PRIORITIES.includes(priority)) fail('INVALID_PRIORITY');
    const departmentId = a.departmentId || tk.departmentId;
    const d = department(ctx, departmentId);
    const changes: string[] = [];
    if (a.assigneeId !== tk.assigneeId) {
      addEvent(ctx, tk.id, 'assigned', String(a.assigneeId), 'staff', me.id);
      changes.push(`assignee=${a.assigneeId}`);
    }
    if (departmentId !== tk.departmentId) {
      addEvent(ctx, tk.id, 'department_changed', d.key, 'staff', me.id);
      changes.push(`department=${d.key}`);
    }
    if (priority !== tk.priority) {
      addEvent(ctx, tk.id, 'priority_changed', priority, 'staff', me.id);
      changes.push(`priority=${priority}`);
    }
    if (!changes.length) return;
    const now = nowUs(ctx);
    tk = { ...tk, assigneeId: a.assigneeId, departmentId, priority, updatedAt: now };
    if (departmentId !== orig.departmentId && WAITING_STAFF.includes(tk.status)) {
      const from = tk.lastPlayerMessageAt || tk.createdAt;
      tk = { ...tk, dueAt: from + BigInt(d.firstResponseHours) * HOUR_US };
    }
    ctx.db.supTicket.id.update(tk);
    audit(base(ctx), me.id, 'support_ticket.assign', String(tk.id), changes.join(' '));
  });

  const adminSupportTake = st.reducer({ ticketId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    const tk = staffTicket(ctx, a.ticketId);
    if (tk.assigneeId === me.id) return;
    addEvent(ctx, tk.id, 'assigned', String(me.id), 'staff', me.id);
    ctx.db.supTicket.id.update({ ...tk, assigneeId: me.id, updatedAt: nowUs(ctx) });
    audit(base(ctx), me.id, 'support_ticket.take', String(tk.id));
  });

  const adminTickets = st.procedure(
    { query: t.string(), status: t.string(), priority: t.string(), departmentId: t.u64(), assignee: t.string(), accountId: t.u64(), overdue: t.bool(), sort: t.string(), page: t.u32(), pageSize: t.u32() },
    TicketPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        const me = requireRole(base(tx), 'support');
        const now = nowUs(tx);
        const q = toLatinDigits(a.query).trim().toLowerCase();
        let list = [...tx.db.supTicket.iter()].filter(x => {
          if (a.status === 'waiting') {
            if (!WAITING_STAFF.includes(x.status)) return false;
          } else if (a.status === 'active') {
            if (FINISHED.includes(x.status)) return false;
          } else if (a.status && x.status !== a.status) return false;
          if (a.priority && x.priority !== a.priority) return false;
          if (a.departmentId && x.departmentId !== a.departmentId) return false;
          if (a.assignee === 'me' && x.assigneeId !== me.id) return false;
          if (a.assignee === 'none' && x.assigneeId) return false;
          if (/^\d+$/.test(a.assignee) && x.assigneeId !== BigInt(a.assignee)) return false;
          if (a.accountId && x.accountId !== a.accountId) return false;
          if (a.overdue && !overdueOf(x, now)) return false;
          if (q && !(x.number.toLowerCase().includes(q) || x.subject.toLowerCase().includes(q) || String(x.accountId) === q || nameOf(tx, x.accountId).toLowerCase().includes(q))) return false;
          return true;
        });
        if (a.sort === 'due') list = list.sort((x, y) => (x.dueAt || 1n << 62n) < (y.dueAt || 1n << 62n) ? -1 : (x.dueAt || 1n << 62n) > (y.dueAt || 1n << 62n) ? 1 : x.id < y.id ? -1 : 1);
        else if (a.sort === 'priority') list = list.sort((x, y) => priorityRank(y.priority) - priorityRank(x.priority) || (x.id < y.id ? -1 : 1));
        else list = list.sort((x, y) => (x.id < y.id ? 1 : -1));
        const p = page(list, a.page, a.pageSize);
        return {
          total: p.total,
          rows: p.rows.map(x => ({ ticket: x, playerName: nameOf(tx, x.accountId), assigneeName: nameOf(tx, x.assigneeId), departmentKey: tx.db.supDepartment.id.find(x.departmentId)?.key ?? '', overdue: overdueOf(x, now) })),
        };
      })
  );

  const adminTicket = st.procedure({ ticketId: t.u64() }, TicketDetail, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'support');
      const tk = staffTicket(tx, a.ticketId);
      const all = [...tx.db.supTicket.accountId.filter(tk.accountId)];
      return {
        ticket: tk,
        messages: [...tx.db.supTicketMessage.ticketId.filter(tk.id)].sort((x, y) => (x.id < y.id ? -1 : 1)),
        playerName: nameOf(tx, tk.accountId),
        playerTickets: all.length,
        playerOpenTickets: all.filter(x => !FINISHED.includes(x.status)).length,
        assigneeName: nameOf(tx, tk.assigneeId),
        departmentKey: tx.db.supDepartment.id.find(tk.departmentId)?.key ?? '',
        overdue: overdueOf(tk, nowUs(tx)),
      };
    })
  );

  const adminSupportHeartbeat = st.reducer({ away: t.bool() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    const old = ctx.db.supAgent.accountId.find(me.id);
    const row = { accountId: me.id, lastSeenAt: ctx.timestamp.microsSinceUnixEpoch, away: a.away, focusTicketId: old?.focusTicketId ?? 0n, focusChatId: old?.focusChatId ?? 0n };
    if (old) ctx.db.supAgent.accountId.update(row);
    else ctx.db.supAgent.insert(row);
  });

  const adminSupportFocus = st.reducer({ ticketId: t.u64(), chatId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'support');
    if (a.ticketId) staffTicket(ctx, a.ticketId);
    if (a.chatId && !ctx.db.supChat.id.find(a.chatId)) fail('CHAT_NOT_FOUND');
    const old = ctx.db.supAgent.accountId.find(me.id);
    const row = { accountId: me.id, lastSeenAt: ctx.timestamp.microsSinceUnixEpoch, away: old?.away ?? false, focusTicketId: a.ticketId, focusChatId: a.chatId };
    if (old) ctx.db.supAgent.accountId.update(row);
    else ctx.db.supAgent.insert(row);
  });

  const adminSupportAgents = st.view({ name: 'admin_support_agents', public: true }, t.array(AgentLine), ctx => {
    if (!adminOrNull(ctx as any, 'support')) return [];
    const out = [];
    for (const r of ctx.db.admin.iter()) {
      if (!isAgent(ctx as any, r.accountId)) continue;
      const ag = ctx.db.supAgent.accountId.find(r.accountId);
      out.push({
        accountId: r.accountId,
        name: nameOf(ctx as any, r.accountId),
        role: r.role,
        lastSeenAt: ag?.lastSeenAt ?? 0n,
        away: ag?.away ?? false,
        openTickets: openAssigned(ctx as any, r.accountId),
        activeChats: [...ctx.db.supChat.agentId.filter(r.accountId)].filter(c => c.status === 'active').length,
      });
    }
    return out;
  });

  const adminTicketThread = st.view({ name: 'admin_ticket_thread', public: true }, t.array(supRows.ticketMessage), ctx => {
    const me = adminOrNull(ctx as any, 'support');
    if (!me) return [];
    const ag = ctx.db.supAgent.accountId.find(me.id);
    if (!ag || !ag.focusTicketId) return [];
    return [...ctx.db.supTicketMessage.ticketId.filter(ag.focusTicketId)];
  });

  const adminSupportSummary = st.procedure(Summary, ctx =>
    ctx.withTx(tx => {
      const me = requireRole(base(tx), 'support');
      const s = supSettings(tx);
      const now = nowUs(tx);
      let awaitingStaff = 0;
      let overdue = 0;
      let unassigned = 0;
      let mine = 0;
      let frSum = 0;
      let frN = 0;
      let rSum = 0;
      let rated = 0;
      for (const x of tx.db.supTicket.iter()) {
        const open = !FINISHED.includes(x.status);
        if (WAITING_STAFF.includes(x.status)) awaitingStaff++;
        if (overdueOf(x, now)) overdue++;
        if (open && !x.assigneeId) unassigned++;
        if (open && x.assigneeId === me.id) mine++;
        if (x.source !== 'staff' && x.firstResponseAt && x.createdAt > now - 30n * DAY_US) {
          frSum += Number(x.firstResponseAt - x.createdAt) / 60_000_000;
          frN++;
        }
        if (x.rating) {
          rSum += x.rating;
          rated++;
        }
      }
      const chats = [...tx.db.supChat.iter()].filter(c => c.status !== 'closed');
      return {
        awaitingStaff,
        waitingChats: chats.filter(c => c.status === 'waiting').length,
        activeChats: chats.filter(c => c.status === 'active').length,
        overdue,
        unassigned,
        mine,
        myChats: chats.filter(c => c.status === 'active' && c.agentId === me.id).length,
        agentsOnline: agentsOnline(tx),
        avgFirstResponseMinutes: frN ? Math.round((frSum / frN) * 10) / 10 : 0,
        avgRating: rated ? Math.round((rSum / rated) * 100) / 100 : 0,
        rated,
        clockOffsetSec: s.clockOffsetSec,
      };
    })
  );

  const supportTick = st.reducer({ onSchedule: supportTables.supTickTimer }, { timer: supportTables.supTickTimer.rowType }, ctx => {
    if (!ctx.db.supSettings.id.find(0)) return;
    runSupport(ctx);
  });

  const adminSupportRun = st.procedure(RunResult, ctx =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'admin');
      return runSupport(tx);
    })
  );

  return {
    supportTick,
    adminSupportSettings,
    adminSaveSupportSettings,
    adminSetSupportClockOffset,
    supportDepartments,
    adminSupportDepartments,
    adminSaveSupportDepartment,
    adminDeleteSupportDepartment,
    adminSupportCanned,
    adminSaveSupportCanned,
    adminDeleteSupportCanned,
    supportInfo,
    supportTicketCreate,
    supportTicketReply,
    supportTicketResolve,
    supportTicketRate,
    supportTicketSeen,
    myTickets,
    myTicketMessages,
    adminSupportCreateTicket,
    adminSupportReply,
    adminSupportStatus,
    adminSupportAssign,
    adminSupportTake,
    adminTickets,
    adminTicket,
    adminSupportHeartbeat,
    adminSupportFocus,
    adminSupportAgents,
    adminTicketThread,
    adminSupportSummary,
    adminSupportRun,
  };
}
