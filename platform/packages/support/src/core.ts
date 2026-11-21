import { fail, type Tr } from '@stg/base';
import { FINISHED, HOUR_US, WAITING_STAFF, isAgent, notifyPlayer, nowUs, randomCode, supSettings, writeActivity, type AttachmentIn, type SDb, type STx, type TicketRow } from './engine';

export function department(ctx: SDb, id: bigint) {
  const d = ctx.db.supDepartment.id.find(id);
  if (!d) fail('DEPARTMENT_NOT_FOUND');
  return d;
}

export function defaultDepartment(ctx: SDb) {
  const list = [...ctx.db.supDepartment.iter()].filter(d => d.isActive).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  if (!list.length) fail('DEPARTMENT_NOT_FOUND');
  return list[0];
}

export function openAssigned(ctx: SDb, agentId: bigint) {
  return [...ctx.db.supTicket.assigneeId.filter(agentId)].filter(x => !FINISHED.includes(x.status)).length;
}

export function leastBusy(ctx: SDb, d: { agentIds: bigint[]; autoAssign: boolean }) {
  if (!d.autoAssign) return 0n;
  let best = 0n;
  let load = Infinity;
  for (const id of d.agentIds) {
    if (!isAgent(ctx, id)) continue;
    const n = openAssigned(ctx, id);
    if (n < load) {
      load = n;
      best = id;
    }
  }
  return best;
}

export function newNumber(ctx: STx) {
  for (let i = 0; i < 50; i++) {
    const n = `T-${randomCode(ctx.env.OTP_SECRET, `ticket|${ctx.timestamp.microsSinceUnixEpoch}|${ctx.db.supTicket.count()}|${i}`, 6)}`;
    if (!ctx.db.supTicket.number.find(n)) return n;
  }
  fail('NUMBER_EXHAUSTED');
}

export function addEvent(ctx: STx, ticketId: bigint, event: string, data: string, authorType: string, authorId: bigint) {
  ctx.db.supTicketMessage.insert({ id: 0n, ticketId, kind: 'event', authorType, authorId, body: '', attachments: [], event, eventData: data.slice(0, 200), at: nowUs(ctx) });
}

export function addMessage(ctx: STx, tk: TicketRow, kind: string, authorType: string, authorId: bigint, body: string, attachments: AttachmentIn[]) {
  const at = nowUs(ctx);
  ctx.db.supTicketMessage.insert({ id: 0n, ticketId: tk.id, kind, authorType, authorId, body, attachments, event: '', eventData: '', at });
  if (kind === 'note') return tk;
  return { ...tk, messageCount: tk.messageCount + 1, lastMessage: body.slice(0, 200), updatedAt: at };
}

export const tr = (fa: string, en: string): Tr[] => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];

export function tellPlayer(ctx: STx, tk: TicketRow, what: 'reply' | 'resolved' | 'closed' | 'created') {
  const texts = {
    reply: [tr(`پاسخ تازه برای تیکت ${tk.number}`, `New reply on ticket ${tk.number}`), tr(`پشتیبانی به «${tk.subject}» پاسخ داد.`, `Support answered "${tk.subject}".`)],
    resolved: [tr(`تیکت ${tk.number} حل شد`, `Ticket ${tk.number} resolved`), tr(`«${tk.subject}» حل شد.`, `"${tk.subject}" was resolved.`)],
    closed: [tr(`تیکت ${tk.number} بسته شد`, `Ticket ${tk.number} closed`), tr(`«${tk.subject}» بسته شد.`, `"${tk.subject}" was closed.`)],
    created: [tr(`پیام تازه از پشتیبانی`, `New message from support`), tr(`«${tk.subject}»`, `"${tk.subject}"`)],
  }[what];
  notifyPlayer(ctx, tk.accountId, texts[0], texts[1], `support/ticket/${tk.id}`);
}

export type NewTicket = {
  accountId: bigint;
  subject: string;
  departmentId: bigint;
  priority: string;
  source: string;
  body: string;
  attachments: AttachmentIn[];
  authorType: string;
  authorId: bigint;
  status: string;
  assigneeId: bigint;
  chatId: bigint;
};

export function cleanSubject(raw: string) {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s.length < 3 || s.length > 150) fail('INVALID_SUBJECT');
  return s;
}

export function createTicket(ctx: STx, n: NewTicket) {
  const d = department(ctx, n.departmentId);
  const now = nowUs(ctx);
  const staff = n.authorType === 'staff';
  const assigneeId = n.assigneeId || (staff ? n.authorId : leastBusy(ctx, d));
  const waiting = WAITING_STAFF.includes(n.status);
  let tk = ctx.db.supTicket.insert({
    id: 0n,
    number: newNumber(ctx),
    accountId: n.accountId,
    subject: n.subject,
    departmentId: d.id,
    priority: n.priority,
    status: n.status,
    assigneeId,
    source: n.source,
    chatId: n.chatId,
    messageCount: 0,
    lastMessage: '',
    lastPlayerMessageAt: staff ? 0n : now,
    lastStaffMessageAt: staff ? now : 0n,
    playerSeenAt: staff ? 0n : now,
    dueAt: waiting ? now + BigInt(d.firstResponseHours) * HOUR_US : 0n,
    firstResponseAt: staff ? now : 0n,
    statusAt: now,
    resolvedAt: 0n,
    closedAt: 0n,
    rating: 0,
    ratingComment: '',
    ratedAt: 0n,
    createdAt: now,
    updatedAt: now,
  });
  tk = addMessage(ctx, tk, 'message', n.authorType, n.authorId, n.body, n.attachments);
  if (n.source === 'chat') addEvent(ctx, tk.id, 'created_from_chat', String(n.chatId), 'system', 0n);
  if (staff) addEvent(ctx, tk.id, 'created_by_staff', '', 'staff', n.authorId);
  if (assigneeId) addEvent(ctx, tk.id, 'assigned', String(assigneeId), 'system', 0n);
  ctx.db.supTicket.id.update(tk);
  writeActivity(ctx, n.accountId, { kind: 'ticket', action: 'created', refId: String(tk.id), data: JSON.stringify({ number: tk.number, source: n.source }), actor: staff ? `admin:${n.authorId}` : 'player' });
  return tk;
}


export function agentsOnline(ctx: STx) {
  const s = supSettings(ctx);
  const cutoff = ctx.timestamp.microsSinceUnixEpoch - BigInt(s.agentOnlineSeconds) * 1_000_000n;
  return [...ctx.db.supAgent.iter()].filter(a => !a.away && a.lastSeenAt >= cutoff && isAgent(ctx, a.accountId)).length;
}

