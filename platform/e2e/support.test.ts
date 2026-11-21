import { ECONOMY_QUERIES, GAMIFICATION_QUERIES, PLAYER_QUERIES, PUBLICATION_QUERIES, SUPPORT_QUERIES, check, connect, done, errorOf, login, loginOwner, panelUser, tr, uniquePhone, waitFor, type Client } from './src/lib.ts';

const R = String(Date.now() % 10_000_000);
const k = (s: string) => `${s}_${R}`;
const QUERIES = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMIFICATION_QUERIES, ...PUBLICATION_QUERIES, ...SUPPORT_QUERIES];
const c = (token?: string) => connect(token, QUERIES);
const rows = <T>(it: Iterable<T>) => [...it];
const HOUR = 3600;
const DAY = 86400;

let o: Client;
let off = 0;
type SettingsArgs = Parameters<Client['conn']['reducers']['adminSaveSupportSettings']>[0];
type RefArgs = Parameters<Client['conn']['reducers']['adminSaveReferralSettings']>[0];
type ConfigArgs = Parameters<Client['conn']['reducers']['adminSaveConfigKey']>[0];
type RuleArg = ConfigArgs['rules'][number];

const DEFAULTS: SettingsArgs = {
  maxOpenTickets: 10,
  ticketsPerHour: 6,
  messagesPerHour: 40,
  maxAttachments: 5,
  maxAttachmentKb: 2048,
  autoCloseDays: 7,
  chatEnabled: true,
  chatGreeting: tr('سلام! یکی از همکاران ما به‌زودی جواب می‌دهد.', 'Hi! One of our agents will answer soon.'),
  chatOffline: tr('الان همکاری آنلاین نیست. پیامتان را بگذارید، جواب می‌دهیم.', 'No agent is online right now. Leave your message and we will answer.'),
  chatIdleMinutes: 30,
  chatMessagesPerMinute: 12,
  chatsPerHour: 6,
  agentOnlineSeconds: 75,
  activityRetentionDays: 180,
  notifyCategoryKey: 'support',
};
const REF_DEFAULTS: RefArgs = {
  isEnabled: true,
  newAccountDays: 7,
  referrerPrizeId: 0n,
  refereePrizeId: 0n,
  goalEventKey: '',
  goalMeasure: 'count',
  goalValue: 0,
  maxPerReferrer: 100,
  dailyPerReferrer: 10,
  onePerDevice: true,
  onePerPhone: true,
  holdFlagged: true,
  triesPerHour: 10,
};

async function clock(sec: number) {
  off = sec;
  await o.conn.reducers.adminSetSupportClockOffset({ seconds: BigInt(sec) });
  await waitFor(() => rows(o.conn.db.adminSupportSettings.iter())[0]?.clockOffsetSec === BigInt(sec));
}
async function settings(p: Partial<SettingsArgs>) {
  const want = { ...DEFAULTS, ...p };
  await o.conn.reducers.adminSaveSupportSettings(want);
  await waitFor(() => {
    const s = rows(o.conn.db.adminSupportSettings.iter())[0];
    return !!s && s.maxOpenTickets === want.maxOpenTickets && s.chatEnabled === want.chatEnabled && s.ticketsPerHour === want.ticketsPerHour && s.activityRetentionDays === want.activityRetentionDays && s.maxAttachments === want.maxAttachments;
  });
}
async function refSettings(p: Partial<RefArgs>) {
  const want = { ...REF_DEFAULTS, ...p };
  await o.conn.reducers.adminSaveReferralSettings(want);
  await waitFor(() => {
    const s = rows(o.conn.db.adminReferralSettings.iter())[0];
    return !!s && s.goalEventKey === want.goalEventKey && s.holdFlagged === want.holdFlagged && s.maxPerReferrer === want.maxPerReferrer && s.dailyPerReferrer === want.dailyPerReferrer && s.onePerDevice === want.onePerDevice && s.triesPerHour === want.triesPerHour && s.newAccountDays === want.newAccountDays && s.referrerPrizeId === want.referrerPrizeId;
  });
}
async function player() {
  const p = await c();
  const r = await login(p, uniquePhone('0939'));
  return { p, id: r.accountId };
}
async function switchAccount(cl: Client) {
  await cl.conn.reducers.logout({});
  await waitFor(() => rows(cl.conn.db.me.iter()).length === 0);
  const r = await login(cl, uniquePhone('0939'));
  await waitFor(() => rows(cl.conn.db.me.iter())[0]?.id === r.accountId);
  return r.accountId;
}
const myTicket = (cl: Client, id: bigint) => rows(cl.conn.db.myTickets.iter()).find(x => x.id === id);
const msgs = (cl: Client, id: bigint) => rows(cl.conn.db.myTicketMessages.iter()).filter(m => m.ticketId === id);
const myChat = (cl: Client, id: bigint) => rows(cl.conn.db.myChats.iter()).find(x => x.id === id);
const chatLines = (cl: Client, id: bigint) => rows(cl.conn.db.myChatMessages.iter()).filter(m => m.chatId === id).sort((a, b) => a.seq - b.seq);
const queue = (cl: Client, id: bigint) => rows(cl.conn.db.adminChatQueue.iter()).find(x => x.id === id);
const att = (url: string, size = 1000, type = '') => ({ url, name: '', type, size });
const detail = (id: bigint) => o.conn.procedures.adminTicket({ ticketId: id });
const tickets = (p: Partial<Parameters<Client['conn']['procedures']['adminTickets']>[0]>) =>
  o.conn.procedures.adminTickets({ query: '', status: '', priority: '', departmentId: 0n, assignee: '', accountId: 0n, overdue: false, sort: '', page: 1, pageSize: 100, ...p });
const cfgRule = (p: Partial<RuleArg>): RuleArg => ({ name: 'r', value: '', text: [], platforms: [], minVersion: '', maxVersion: '', tagIds: [], countries: [], percent: 100, ...p });
const cfgKey = (key: string) => rows(o.conn.db.adminConfigKeys.iter()).find(x => x.key === key);
const myCfg = (cl: Client, key: string) => rows(cl.conn.db.myRemoteConfig.iter()).find(x => x.key === key);
const audits = async (a: string) => (await o.conn.procedures.adminAudit({ action: a, page: 1, pageSize: 200 })).rows.map(r => r.action);

async function main() {
  o = await c();
  await loginOwner(o);
  await clock(0);
  await settings({});
  await refSettings({});

  const s1 = await panelUser(o, 'support', QUERIES);
  const s2 = await panelUser(o, 'support', QUERIES);
  const op = await panelUser(o, 'operator', QUERIES);
  const a1 = s1.client;
  const a2 = s2.client;

  check('support role exists and logs in', rows(a1.conn.db.myRole.iter())[0]?.role === 'support');
  check('support role refused for economy views', rows(a1.conn.db.adminEconomySettings.iter()).length === 0 && rows(a1.conn.db.adminPaymentMethods.iter()).length === 0);
  check('support role refused for economy calls', (await errorOf(a1.conn.procedures.adminUserEconomy({ accountId: s1.accountId }))).includes('FORBIDDEN'));
  check('support role refused for account list', (await errorOf(a1.conn.procedures.adminAccounts({ query: '', status: '', page: 1, pageSize: 10 }))).includes('FORBIDDEN'));
  check('support role cannot see base settings', rows(a1.conn.db.adminSettings.iter()).length === 0);
  check('support role reads support settings', rows(a1.conn.db.adminSupportSettings.iter()).length === 1);
  check('support role cannot change support settings', (await errorOf(a1.conn.reducers.adminSaveSupportSettings(DEFAULTS))).includes('FORBIDDEN'));
  check('support role cannot move the clock', (await errorOf(a1.conn.reducers.adminSetSupportClockOffset({ seconds: 10n }))).includes('FORBIDDEN'));
  check('support user changes own password', !(await errorOf(a1.conn.reducers.adminChangeMyPassword({ oldPassword: s1.password, newPassword: `${s1.password}Z1` }))));
  check('operator reads support settings', rows(op.client.conn.db.adminSupportSettings.iter()).length === 1);

  check('departments seeded', ['general', 'payments'].every(key => rows(o.conn.db.adminSupportDepartments.iter()).some(d => d.key === key)));
  check('canned replies seeded', ['thanks', 'need_info', 'solved'].every(key => rows(o.conn.db.adminSupportCanned.iter()).some(d => d.key === key)));
  check('support notify category seeded', rows(o.conn.db.notifyCategory.iter()).some(x => x.key === 'support'));
  check('settings validated', (await errorOf(o.conn.reducers.adminSaveSupportSettings({ ...DEFAULTS, maxOpenTickets: 0 }))).includes('INVALID_SETTING:maxOpenTickets'));
  check('notify category checked', (await errorOf(o.conn.reducers.adminSaveSupportSettings({ ...DEFAULTS, notifyCategoryKey: 'nope' }))).includes('CATEGORY_NOT_FOUND'));
  check('clock offset bounded', (await errorOf(o.conn.reducers.adminSetSupportClockOffset({ seconds: 4000n * 86400n }))).includes('INVALID_CLOCK_OFFSET'));

  const dep = k('dep');
  const depArgs = { id: 0n, key: dep, name: tr('بخش تست', 'Test desk'), description: tr('توضیح'), firstResponseHours: 2, agentIds: [s1.accountId, s2.accountId], autoAssign: true, isActive: true, sort: 5 };
  await o.conn.reducers.adminSaveSupportDepartment(depArgs);
  check('department saved', await waitFor(() => rows(o.conn.db.adminSupportDepartments.iter()).some(d => d.key === dep)));
  const depRow = rows(o.conn.db.adminSupportDepartments.iter()).find(d => d.key === dep)!;
  check('department key unique', (await errorOf(o.conn.reducers.adminSaveSupportDepartment(depArgs))).includes('KEY_TAKEN'));
  check('department key locked', (await errorOf(o.conn.reducers.adminSaveSupportDepartment({ ...depArgs, id: depRow.id, key: k('other') }))).includes('KEY_LOCKED'));
  check('department agents must be support users', (await errorOf(o.conn.reducers.adminSaveSupportDepartment({ ...depArgs, key: k('bad'), agentIds: [999999n] }))).includes('AGENT_NOT_FOUND'));
  check('department hours checked', (await errorOf(o.conn.reducers.adminSaveSupportDepartment({ ...depArgs, key: k('bad2'), firstResponseHours: 0 }))).includes('INVALID_RESPONSE_HOURS'));
  check('support role cannot save departments', (await errorOf(a1.conn.reducers.adminSaveSupportDepartment({ ...depArgs, key: k('x') }))).includes('FORBIDDEN'));
  await o.conn.reducers.adminSaveSupportCanned({ id: 0n, key: k('canned'), title: tr('عنوان', 'Title'), body: tr('متن آماده', 'Ready text'), departmentId: depRow.id, isActive: true, sort: 0 });
  check('canned reply saved for a department', await waitFor(() => rows(a1.conn.db.adminSupportCanned.iter()).some(x => x.key === k('canned') && x.departmentId === depRow.id && x.body.some(b => b.lang === 'en'))));
  check('canned reply needs a body', (await errorOf(o.conn.reducers.adminSaveSupportCanned({ id: 0n, key: k('c2'), title: tr('x'), body: [], departmentId: 0n, isActive: true, sort: 0 }))).includes('BODY_REQUIRED'));

  const { p: p1, id: id1 } = await player();
  const { p: p2, id: id2 } = await player();
  check('player sees active departments', rows(p1.conn.db.supportDepartments.iter()).some(d => d.key === dep && d.firstResponseHours === 2));
  check('player cannot see admin support views', rows(p1.conn.db.adminSupportDepartments.iter()).length === 0 && rows(p1.conn.db.adminSupportCanned.iter()).length === 0 && rows(p1.conn.db.adminSupportAgents.iter()).length === 0);
  check('player cannot reply as staff', (await errorOf(p1.conn.reducers.adminSupportReply({ ticketId: 1n, body: 'x', internal: false, status: '', attachments: [] }))).includes('FORBIDDEN'));

  check('subject checked', (await errorOf(p1.conn.procedures.supportTicketCreate({ subject: 'ab', departmentKey: dep, body: 'x', attachments: [] }))).includes('INVALID_SUBJECT'));
  check('body required', (await errorOf(p1.conn.procedures.supportTicketCreate({ subject: 'Hello there', departmentKey: dep, body: '  ', attachments: [] }))).includes('BODY_REQUIRED'));
  check('unknown department refused', (await errorOf(p1.conn.procedures.supportTicketCreate({ subject: 'Hello there', departmentKey: 'nope', body: 'x', attachments: [] }))).includes('DEPARTMENT_NOT_FOUND'));
  check('attachment type checked', (await errorOf(p1.conn.procedures.supportTicketCreate({ subject: 'Hello there', departmentKey: dep, body: 'x', attachments: [att('https://cdn.example.com/a.exe')] }))).includes('ATTACHMENT_TYPE'));
  check('attachment needs https', (await errorOf(p1.conn.procedures.supportTicketCreate({ subject: 'Hello there', departmentKey: dep, body: 'x', attachments: [att('http://cdn.example.com/a.png')] }))).includes('INVALID_URL'));
  check('attachment size checked', (await errorOf(p1.conn.procedures.supportTicketCreate({ subject: 'Hello there', departmentKey: dep, body: 'x', attachments: [att('https://cdn.example.com/a.png', 3 * 1024 * 1024)] }))).includes('ATTACHMENT_TOO_LARGE'));
  check('attachment count checked', (await errorOf(p1.conn.procedures.supportTicketCreate({ subject: 'Hello there', departmentKey: dep, body: 'x', attachments: Array.from({ length: 6 }, (_, i) => att(`https://cdn.example.com/${i}.png`)) }))).includes('TOO_MANY_ATTACHMENTS'));
  check('declared type must match the file', (await errorOf(p1.conn.procedures.supportTicketCreate({ subject: 'Hello there', departmentKey: dep, body: 'x', attachments: [att('https://cdn.example.com/a.png', 10, 'application/pdf')] }))).includes('ATTACHMENT_TYPE'));

  const t1 = await p1.conn.procedures.supportTicketCreate({ subject: `Lost coins ${R}`, departmentKey: dep, body: 'My coins are gone', attachments: [att('https://cdn.example.com/shot.png?x=1', 2048), att('https://cdn.example.com/receipt.pdf', 4096)] });
  check('ticket number format', /^T-[A-Z2-9]{6}$/.test(t1.number), t1);
  check('ticket auto-assigned to the first free agent', t1.assigneeId === s1.accountId && t1.status === 'open', t1);
  const t2 = await p2.conn.procedures.supportTicketCreate({ subject: `Payment ${R}`, departmentKey: dep, body: 'Paid twice', attachments: [] });
  check('second ticket goes to the least busy agent', t2.assigneeId === s2.accountId, t2);
  check('player sees own ticket', await waitFor(() => myTicket(p1, t1.ticketId)?.status === 'open'));
  check('player does not see other tickets', !myTicket(p1, t2.ticketId) && !myTicket(p2, t1.ticketId));
  check('attachments kept with types', msgs(p1, t1.ticketId)[0]?.attachments.map(a => a.type).join() === 'image/png,application/pdf' && msgs(p1, t1.ticketId)[0]?.attachments[0].name === 'shot.png');
  check('assignment event hidden from player', !msgs(p1, t1.ticketId).some(m => m.event === 'assigned'));
  check('other player cannot reply', (await errorOf(p2.conn.reducers.supportTicketReply({ ticketId: t1.ticketId, body: 'hi', attachments: [] }))).includes('TICKET_NOT_FOUND'));
  check('other player cannot rate', (await errorOf(p2.conn.reducers.supportTicketRate({ ticketId: t1.ticketId, rating: 5, comment: '' }))).includes('TICKET_NOT_FOUND'));
  check('other player cannot resolve', (await errorOf(p2.conn.reducers.supportTicketResolve({ ticketId: t1.ticketId }))).includes('TICKET_NOT_FOUND'));

  const d1 = await detail(t1.ticketId);
  check('due time = department hours', d1.ticket.dueAt > 0n && Math.abs(Number(d1.ticket.dueAt - d1.ticket.createdAt) / 1e6 - 2 * HOUR) < 2, d1.ticket);
  check('agent sees the ticket in his list', (await a1.conn.procedures.adminTickets({ query: '', status: 'waiting', priority: '', departmentId: 0n, assignee: 'me', accountId: 0n, overdue: false, sort: '', page: 1, pageSize: 50 })).rows.some(r => r.ticket.id === t1.ticketId));
  check('ticket search by number', (await tickets({ query: t1.number })).rows.length === 1);

  await a1.conn.reducers.adminSupportReply({ ticketId: t1.ticketId, body: 'internal: check ledger', internal: true, status: '', attachments: [] });
  await a1.conn.reducers.adminSupportFocus({ ticketId: t1.ticketId, chatId: 0n });
  check('focused thread shows the note to the agent', await waitFor(() => rows(a1.conn.db.adminTicketThread.iter()).some(m => m.kind === 'note' && m.ticketId === t1.ticketId)));
  check('note never reaches the player', !msgs(p1, t1.ticketId).some(m => m.body.includes('internal')));
  check('note keeps the status', (await detail(t1.ticketId)).ticket.status === 'open');
  check('staff status must be valid', (await errorOf(a1.conn.reducers.adminSupportReply({ ticketId: t1.ticketId, body: 'x', internal: false, status: 'open', attachments: [] }))).includes('INVALID_STATUS'));

  await a1.conn.reducers.adminSupportReply({ ticketId: t1.ticketId, body: 'We are checking', internal: false, status: '', attachments: [] });
  check('staff reply waits for the player', await waitFor(() => myTicket(p1, t1.ticketId)?.status === 'awaiting_player'));
  check('staff reply is unread for the player', myTicket(p1, t1.ticketId)?.unread === true && myTicket(p1, t1.ticketId)?.agentName !== '');
  const d1b = await detail(t1.ticketId);
  check('first response and due cleared', d1b.ticket.firstResponseAt > 0n && d1b.ticket.dueAt === 0n);
  check('staff reply sends a support inbox message', await waitFor(() => rows(p1.conn.db.myInbox.iter()).some(i => i.categoryKey === 'support' && i.actionValue === `support/ticket/${t1.ticketId}`)));
  await p1.conn.reducers.supportTicketSeen({ ticketId: t1.ticketId });
  check('seen clears unread', await waitFor(() => myTicket(p1, t1.ticketId)?.unread === false));
  check('awaiting player cannot go to awaiting player', (await errorOf(a1.conn.reducers.adminSupportStatus({ ticketId: t1.ticketId, status: 'awaiting_player' }))).includes('INVALID_TRANSITION'));
  check('reopen needs a finished ticket', (await errorOf(a1.conn.reducers.adminSupportStatus({ ticketId: t1.ticketId, status: 'awaiting_staff' }))).includes('INVALID_TRANSITION'));
  check('rating before finish refused', (await errorOf(p1.conn.reducers.supportTicketRate({ ticketId: t1.ticketId, rating: 5, comment: '' }))).includes('TICKET_NOT_FINISHED'));

  await p1.conn.reducers.supportTicketReply({ ticketId: t1.ticketId, body: 'Any news?', attachments: [] });
  check('player reply moves to awaiting staff', await waitFor(() => myTicket(p1, t1.ticketId)?.status === 'awaiting_staff'));
  check('due set again when waiting for staff', (await detail(t1.ticketId)).ticket.dueAt > 0n);
  await a1.conn.reducers.adminSupportStatus({ ticketId: t1.ticketId, status: 'resolved' });
  check('agent resolves', await waitFor(() => myTicket(p1, t1.ticketId)?.status === 'resolved' && myTicket(p1, t1.ticketId)?.canRate === true));
  check('status change visible to player', msgs(p1, t1.ticketId).some(m => m.event === 'status_changed' && m.eventData === 'resolved'));
  await p1.conn.reducers.supportTicketReply({ ticketId: t1.ticketId, body: 'Still broken', attachments: [] });
  check('player reply reopens a solved ticket', await waitFor(() => myTicket(p1, t1.ticketId)?.status === 'awaiting_staff'));
  await p1.conn.reducers.supportTicketResolve({ ticketId: t1.ticketId });
  check('player resolves own ticket', await waitFor(() => myTicket(p1, t1.ticketId)?.status === 'resolved'));
  check('resolve twice refused', (await errorOf(p1.conn.reducers.supportTicketResolve({ ticketId: t1.ticketId }))).includes('INVALID_TRANSITION'));
  check('rating range checked', (await errorOf(p1.conn.reducers.supportTicketRate({ ticketId: t1.ticketId, rating: 6, comment: '' }))).includes('INVALID_RATING'));
  await p1.conn.reducers.supportTicketRate({ ticketId: t1.ticketId, rating: 4, comment: 'ok' });
  check('rating saved', await waitFor(() => myTicket(p1, t1.ticketId)?.rating === 4 && myTicket(p1, t1.ticketId)?.canRate === false));
  check('rating once', (await errorOf(p1.conn.reducers.supportTicketRate({ ticketId: t1.ticketId, rating: 5, comment: '' }))).includes('ALREADY_RATED'));
  await a1.conn.reducers.adminSupportStatus({ ticketId: t1.ticketId, status: 'closed' });
  check('agent closes', await waitFor(() => myTicket(p1, t1.ticketId)?.status === 'closed'));
  check('closed ticket refuses player replies', (await errorOf(p1.conn.reducers.supportTicketReply({ ticketId: t1.ticketId, body: 'x', attachments: [] }))).includes('TICKET_CLOSED'));
  check('closed ticket refuses staff replies', (await errorOf(a1.conn.reducers.adminSupportReply({ ticketId: t1.ticketId, body: 'x', internal: false, status: '', attachments: [] }))).includes('TICKET_CLOSED'));
  check('closed cannot be closed again', (await errorOf(a1.conn.reducers.adminSupportStatus({ ticketId: t1.ticketId, status: 'resolved' }))).includes('INVALID_TRANSITION'));
  await a1.conn.reducers.adminSupportStatus({ ticketId: t1.ticketId, status: 'awaiting_staff' });
  check('staff reopens a closed ticket', await waitFor(() => myTicket(p1, t1.ticketId)?.status === 'awaiting_staff'));

  await a2.conn.reducers.adminSupportAssign({ ticketId: t2.ticketId, assigneeId: s1.accountId, departmentId: 0n, priority: 'urgent' });
  const d2 = await detail(t2.ticketId);
  check('assign and priority change', d2.ticket.assigneeId === s1.accountId && d2.ticket.priority === 'urgent' && d2.messages.some(m => m.event === 'priority_changed'));
  check('priority validated', (await errorOf(a2.conn.reducers.adminSupportAssign({ ticketId: t2.ticketId, assigneeId: 0n, departmentId: 0n, priority: 'asap' }))).includes('INVALID_PRIORITY'));
  check('assignee must be an agent', (await errorOf(a2.conn.reducers.adminSupportAssign({ ticketId: t2.ticketId, assigneeId: id1, departmentId: 0n, priority: '' }))).includes('AGENT_NOT_FOUND'));
  const general = rows(o.conn.db.adminSupportDepartments.iter()).find(d => d.key === 'general')!;
  await a2.conn.reducers.adminSupportAssign({ ticketId: t2.ticketId, assigneeId: s1.accountId, departmentId: general.id, priority: 'urgent' });
  const d2b = await detail(t2.ticketId);
  check('department change moves the due time', d2b.ticket.departmentId === general.id && Math.abs(Number(d2b.ticket.dueAt - d2b.ticket.createdAt) / 1e6 - 24 * HOUR) < 2, d2b.ticket);
  await a2.conn.reducers.adminSupportTake({ ticketId: t2.ticketId });
  check('agent takes a ticket', (await detail(t2.ticketId)).ticket.assigneeId === s2.accountId);
  check('priority sort puts urgent first', (await tickets({ status: 'active', sort: 'priority' })).rows[0]?.ticket.priority === 'urgent');

  const staffT = await a1.conn.procedures.adminSupportCreateTicket({ accountId: id2, subject: `We noticed ${R}`, body: 'Please update the app', departmentId: 0n, priority: 'low', attachments: [] });
  check('staff ticket waits for the player', staffT.status === 'awaiting_player' && staffT.assigneeId === s1.accountId);
  check('player sees the staff ticket', await waitFor(() => myTicket(p2, staffT.ticketId)?.source === 'staff'));
  check('staff ticket for an agent refused', (await errorOf(a1.conn.procedures.adminSupportCreateTicket({ accountId: s2.accountId, subject: 'Hello there', body: 'x', departmentId: 0n, priority: '', attachments: [] }))).includes('USER_NOT_FOUND'));
  check('agents view counts open work', await waitFor(() => (rows(a1.conn.db.adminSupportAgents.iter()).find(x => x.accountId === s1.accountId)?.openTickets ?? 0) >= 2));
  check('department in use cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteSupportDepartment({ id: depRow.id }))).includes('IN_USE'));

  await settings({ maxOpenTickets: 2 });
  const { p: p3, id: id3 } = await player();
  await p3.conn.procedures.supportTicketCreate({ subject: 'First one', departmentKey: '', body: 'a', attachments: [] });
  await p3.conn.procedures.supportTicketCreate({ subject: 'Second one', departmentKey: '', body: 'b', attachments: [] });
  check('open ticket cap', (await errorOf(p3.conn.procedures.supportTicketCreate({ subject: 'Third one', departmentKey: '', body: 'c', attachments: [] }))).includes('TOO_MANY_OPEN_TICKETS'));
  await settings({ ticketsPerHour: 1 });
  const { p: p4 } = await player();
  await p4.conn.procedures.supportTicketCreate({ subject: 'Only one', departmentKey: '', body: 'a', attachments: [] });
  check('hourly ticket limit', (await errorOf(p4.conn.procedures.supportTicketCreate({ subject: 'Second try', departmentKey: '', body: 'b', attachments: [] }))).includes('TOO_MANY_TICKETS'));
  await settings({ messagesPerHour: 2 });
  const { p: p5 } = await player();
  const t5 = await p5.conn.procedures.supportTicketCreate({ subject: 'Chatty one', departmentKey: '', body: 'a', attachments: [] });
  await p5.conn.reducers.supportTicketReply({ ticketId: t5.ticketId, body: 'b', attachments: [] });
  check('hourly message limit', (await errorOf(p5.conn.reducers.supportTicketReply({ ticketId: t5.ticketId, body: 'c', attachments: [] }))).includes('TOO_MANY_MESSAGES'));
  await settings({});
  const info = await p3.conn.procedures.supportInfo({ lang: 'en' });
  check('support info for the player', info.openTickets === 2 && info.chatEnabled && info.attachmentTypes.includes('pdf') && info.greeting.startsWith('Hi'), info);

  await settings({ maxOpenTickets: 2 });
  const tOver = await p3.conn.procedures.supportTicketCreate({ subject: 'Will be late', departmentKey: dep, body: 'x', attachments: [] }).catch(() => undefined);
  check('cap counts only open tickets', tOver === undefined);
  await a1.conn.reducers.adminSupportStatus({ ticketId: (await tickets({ accountId: id3 })).rows[0].ticket.id, status: 'closed' });
  const tLate = await p3.conn.procedures.supportTicketCreate({ subject: 'Will be late', departmentKey: dep, body: 'x', attachments: [] });
  check('closing frees a place', tLate.ticketId > 0n);
  await settings({});
  check('not overdue yet', !(await tickets({ overdue: true })).rows.some(r => r.ticket.id === tLate.ticketId));
  await clock(3 * HOUR);
  check('overdue after the department hours', (await tickets({ overdue: true })).rows.some(r => r.ticket.id === tLate.ticketId && r.overdue));
  const sum = await a1.conn.procedures.adminSupportSummary();
  check('summary counts overdue and waiting', sum.overdue >= 1 && sum.awaitingStaff >= 2 && sum.clockOffsetSec === BigInt(3 * HOUR) && sum.rated >= 1 && sum.avgRating > 0, sum);
  check('due sort puts the late ticket first among waiting', (await tickets({ status: 'waiting', sort: 'due' })).rows[0]?.overdue === true);

  await a1.conn.reducers.adminSupportReply({ ticketId: tLate.ticketId, body: 'answer', internal: false, status: '', attachments: [] });
  await clock(3 * HOUR + 6 * DAY);
  let run = await o.conn.procedures.adminSupportRun();
  check('no auto-close before the days pass', myTicket(p3, tLate.ticketId)?.status === 'awaiting_player');
  await clock(3 * HOUR + 8 * DAY);
  run = await o.conn.procedures.adminSupportRun();
  check('auto-close closes tickets waiting for the player', await waitFor(() => myTicket(p3, tLate.ticketId)?.status === 'closed'), run);
  check('auto-close event visible to the player', msgs(p3, tLate.ticketId).some(m => m.event === 'auto_closed'));
  check('auto-close is in the player activity', await waitFor(() => rows(p3.conn.db.myActivity.iter()).some(a => a.kind === 'ticket' && a.action === 'auto_closed')));
  check('player cannot run the sweep', (await errorOf(p3.conn.procedures.adminSupportRun())).includes('FORBIDDEN'));
  check('support role cannot run the sweep', (await errorOf(a1.conn.procedures.adminSupportRun())).includes('FORBIDDEN'));
  await clock(0);

  await settings({ chatEnabled: false });
  const { p: c1, id: cid1 } = await player();
  check('chat can be switched off', (await errorOf(c1.conn.procedures.supportChatOpen({ topic: 'Help', body: 'hi', departmentKey: '' }))).includes('CHAT_DISABLED'));
  await settings({});
  const ch1 = await c1.conn.procedures.supportChatOpen({ topic: `Need help ${R}`, body: 'Hello?', departmentKey: dep });
  check('chat waits in the queue', ch1.status === 'waiting' && !ch1.existing);
  check('player sees greeting, offline note when nobody is online, and message', await waitFor(() => chatLines(c1, ch1.chatId).map(m => m.event || 'msg').join() === (ch1.agentsOnline ? 'greeting,msg' : 'greeting,offline,msg')), chatLines(c1, ch1.chatId));
  const again = await c1.conn.procedures.supportChatOpen({ topic: 'x', body: '', departmentKey: '' });
  check('one open chat per player', again.existing && again.chatId === ch1.chatId);
  check('queue shows the chat to agents', await waitFor(() => queue(a1, ch1.chatId)?.status === 'waiting'));
  check('players cannot see the queue', rows(c1.conn.db.adminChatQueue.iter()).length === 0 && rows(c1.conn.db.adminChatMessages.iter()).length === 0);
  check('agents read waiting chat messages', await waitFor(() => rows(a1.conn.db.adminChatMessages.iter()).some(m => m.chatId === ch1.chatId && m.body === 'Hello?')));
  check('agent cannot send before taking', (await errorOf(a1.conn.reducers.adminChatSend({ chatId: ch1.chatId, body: 'x' }))).includes('NOT_YOUR_CHAT'));

  await a1.conn.reducers.adminSupportHeartbeat({ away: false });
  await a2.conn.reducers.adminSupportHeartbeat({ away: false });
  check('heartbeat marks the agent online', await waitFor(() => (rows(a1.conn.db.adminSupportAgents.iter()).find(x => x.accountId === s1.accountId)?.lastSeenAt ?? 0n) > 0n));
  check('agents online counted', (await a1.conn.procedures.adminSupportSummary()).agentsOnline >= 2);
  const { p: c2, id: cid2 } = await player();
  const ch2 = await c2.conn.procedures.supportChatOpen({ topic: 'Online now', body: '', departmentKey: '' });
  check('no offline note while agents are online', ch2.agentsOnline >= 2 && (await waitFor(() => chatLines(c2, ch2.chatId).length === 1)) && chatLines(c2, ch2.chatId)[0].event === 'greeting');
  await a2.conn.reducers.adminSupportHeartbeat({ away: true });

  await a1.conn.reducers.adminChatTake({ chatId: ch1.chatId });
  check('take makes the chat active', await waitFor(() => myChat(c1, ch1.chatId)?.status === 'active' && myChat(c1, ch1.chatId)?.agentName === s1.username));
  check('second take loses', (await errorOf(a2.conn.reducers.adminChatTake({ chatId: ch1.chatId }))).includes('ALREADY_TAKEN'));
  check('other agent cannot write', (await errorOf(a2.conn.reducers.adminChatSend({ chatId: ch1.chatId, body: 'x' }))).includes('NOT_YOUR_CHAT'));
  await a1.conn.reducers.adminChatTyping({ chatId: ch1.chatId });
  check('player sees agent typing', await waitFor(() => (myChat(c1, ch1.chatId)?.agentTypingAt ?? 0n) > 0n));
  await a1.conn.reducers.adminChatSend({ chatId: ch1.chatId, body: 'How can I help?' });
  check('player gets the agent message live', await waitFor(() => chatLines(c1, ch1.chatId).some(m => m.authorType === 'agent' && m.body === 'How can I help?' && m.authorName === s1.username)));
  check('typing cleared by the message', myChat(c1, ch1.chatId)?.agentTypingAt === 0n);
  await c1.conn.reducers.supportChatTyping({ chatId: ch1.chatId });
  check('agent sees player typing and online', await waitFor(() => (queue(a1, ch1.chatId)?.playerTypingAt ?? 0n) > 0n && (queue(a1, ch1.chatId)?.playerSeenAt ?? 0n) > 0n));
  await c1.conn.reducers.supportChatSend({ chatId: ch1.chatId, body: 'My coins vanished' });
  check('agent gets the player message live', await waitFor(() => rows(a1.conn.db.adminChatMessages.iter()).some(m => m.chatId === ch1.chatId && m.body === 'My coins vanished')));
  const lastSeq = queue(a1, ch1.chatId)!.lastSeq;
  await a1.conn.reducers.adminChatRead({ chatId: ch1.chatId, seq: lastSeq });
  check('player sees the read mark', await waitFor(() => myChat(c1, ch1.chatId)?.agentReadSeq === lastSeq));
  check('other player cannot write into the chat', (await errorOf(c2.conn.reducers.supportChatSend({ chatId: ch1.chatId, body: 'x' }))).includes('CHAT_NOT_FOUND'));
  check('other player does not see the chat', !myChat(c2, ch1.chatId) && !rows(c2.conn.db.myChatMessages.iter()).some(m => m.chatId === ch1.chatId));
  check('transfer to self refused', (await errorOf(a1.conn.reducers.adminChatTransfer({ chatId: ch1.chatId, toAgentId: s1.accountId }))).includes('SAME_AGENT'));
  check('transfer to a player refused', (await errorOf(a1.conn.reducers.adminChatTransfer({ chatId: ch1.chatId, toAgentId: cid1 }))).includes('AGENT_NOT_FOUND'));
  await a1.conn.reducers.adminChatTransfer({ chatId: ch1.chatId, toAgentId: s2.accountId });
  check('transfer moves ownership', await waitFor(() => queue(a1, ch1.chatId)?.agentId === s2.accountId));
  check('old owner cannot write after transfer', (await errorOf(a1.conn.reducers.adminChatSend({ chatId: ch1.chatId, body: 'x' }))).includes('NOT_YOUR_CHAT'));
  await a2.conn.reducers.adminChatSend({ chatId: ch1.chatId, body: 'I will take over' });
  check('new owner writes', await waitFor(() => chatLines(c1, ch1.chatId).some(m => m.body === 'I will take over')));
  check('player sees the transfer event', chatLines(c1, ch1.chatId).some(m => m.event === 'transferred'));
  await a2.conn.reducers.adminChatTransfer({ chatId: ch1.chatId, toAgentId: 0n });
  check('transfer back to the queue', await waitFor(() => queue(a1, ch1.chatId)?.status === 'waiting' && queue(a1, ch1.chatId)?.agentId === 0n));
  await a1.conn.reducers.adminChatTake({ chatId: ch1.chatId });
  check('rating before close refused', (await errorOf(c1.conn.reducers.supportChatRate({ chatId: ch1.chatId, rating: 5, comment: '' }))).includes('CANNOT_RATE'));
  check('only the owner closes an active chat', (await errorOf(a2.conn.procedures.adminChatClose({ chatId: ch1.chatId, toTicket: false }))).includes('NOT_YOUR_CHAT'));
  const closed = await a1.conn.procedures.adminChatClose({ chatId: ch1.chatId, toTicket: true });
  check('close turns the chat into a ticket', closed.ticketId > 0n && /^T-/.test(closed.ticketNumber));
  check('chat closed for the player', await waitFor(() => myChat(c1, ch1.chatId)?.status === 'closed' && myChat(c1, ch1.chatId)?.ticketNumber === closed.ticketNumber));
  const ct = await detail(closed.ticketId);
  check('chat ticket holds the transcript and owner', ct.ticket.source === 'chat' && ct.ticket.assigneeId === s1.accountId && ct.ticket.chatId === ch1.chatId && ct.messages[0].body.includes('My coins vanished') && ct.messages[0].body.includes('How can I help?'));
  check('player sees the chat ticket', await waitFor(() => myTicket(c1, closed.ticketId)?.source === 'chat' && msgs(c1, closed.ticketId).some(m => m.event === 'created_from_chat')));
  check('closed chat refuses messages', (await errorOf(c1.conn.reducers.supportChatSend({ chatId: ch1.chatId, body: 'x' }))).includes('CHAT_CLOSED'));
  check('closed chat cannot be taken', (await errorOf(a2.conn.reducers.adminChatTake({ chatId: ch1.chatId }))).includes('CHAT_CLOSED'));
  await c1.conn.reducers.supportChatRate({ chatId: ch1.chatId, rating: 5, comment: 'great' });
  check('chat rated', await waitFor(() => myChat(c1, ch1.chatId)?.rating === 5 && myChat(c1, ch1.chatId)?.canRate === false));
  check('chat rating once', (await errorOf(c1.conn.reducers.supportChatRate({ chatId: ch1.chatId, rating: 4, comment: '' }))).includes('ALREADY_RATED'));
  const ch1b = await c1.conn.procedures.supportChatOpen({ topic: 'Again', body: 'one more', departmentKey: '' });
  check('a new chat after close', !ch1b.existing && ch1b.chatId !== ch1.chatId);
  await c1.conn.reducers.supportChatClose({ chatId: ch1b.chatId });
  check('player closes own chat', await waitFor(() => myChat(c1, ch1b.chatId)?.status === 'closed'));
  check('untaken chat cannot be rated', (await errorOf(c1.conn.reducers.supportChatRate({ chatId: ch1b.chatId, rating: 3, comment: '' }))).includes('CANNOT_RATE'));
  check('chat history for agents', (await a1.conn.procedures.adminChats({ view: 'closed', accountId: cid1, page: 1, pageSize: 10 })).total === 2);

  await settings({ chatMessagesPerMinute: 2 });
  await c2.conn.reducers.supportChatSend({ chatId: ch2.chatId, body: '1' });
  await c2.conn.reducers.supportChatSend({ chatId: ch2.chatId, body: '2' });
  check('chat message rate limit', (await errorOf(c2.conn.reducers.supportChatSend({ chatId: ch2.chatId, body: '3' }))).includes('TOO_MANY_MESSAGES'));
  await settings({ chatsPerHour: 1 });
  const { p: c3 } = await player();
  const ch3 = await c3.conn.procedures.supportChatOpen({ topic: 'One', body: '', departmentKey: '' });
  await c3.conn.reducers.supportChatClose({ chatId: ch3.chatId });
  check('hourly chat limit', (await errorOf(c3.conn.procedures.supportChatOpen({ topic: 'Two', body: '', departmentKey: '' }))).includes('TOO_MANY_CHATS'));
  await settings({});
  await clock(31 * 60);
  run = await o.conn.procedures.adminSupportRun();
  check('idle chats close', await waitFor(() => myChat(c2, ch2.chatId)?.status === 'closed'), run);
  check('idle close event', chatLines(c2, ch2.chatId).some(m => m.event === 'closed'));
  await clock(0);
  check('chat activity recorded', await waitFor(() => rows(c1.conn.db.myActivity.iter()).filter(a => a.kind === 'chat').length >= 3));
  check('chat audit', (await audits('support_chat.')).includes('support_chat.take') && (await audits('support_chat.')).includes('support_chat.transfer') && (await audits('support_chat.')).includes('support_chat.close'));
  void cid2;

  const gold = k('gold');
  await o.conn.reducers.adminSaveCurrency({ id: 0n, key: gold, name: tr('طلا'), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await o.conn.reducers.adminSavePrize({ id: 0n, key: k('inviter'), name: tr('معرف'), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items: [{ type: 'currency', key: gold, action: 'add', value: 100 }] });
  await o.conn.reducers.adminSavePrize({ id: 0n, key: k('invited'), name: tr('دعوت‌شده'), message: [], categoryId: 0n, tagIds: [], isRepeatable: false, items: [{ type: 'currency', key: gold, action: 'add', value: 50 }] });
  await waitFor(() => rows(o.conn.db.prize.iter()).filter(p => p.key === k('inviter') || p.key === k('invited')).length === 2);
  const inviterPrize = rows(o.conn.db.prize.iter()).find(p => p.key === k('inviter'))!.id;
  const invitedPrize = rows(o.conn.db.prize.iter()).find(p => p.key === k('invited'))!.id;
  const round = k('round');
  await o.conn.reducers.adminSaveEventType({ id: 0n, key: round, name: tr('دور'), description: [], clientAllowed: true, valueMin: 0, valueMax: 100, rateLimit: 0, isActive: true, sort: 0 });
  await waitFor(() => rows(o.conn.db.eventType.iter()).some(e => e.key === round));
  check('referrer prize must repeat', (await errorOf(o.conn.reducers.adminSaveReferralSettings({ ...REF_DEFAULTS, referrerPrizeId: invitedPrize }))).includes('PRIZE_NOT_REPEATABLE'));
  check('goal event must exist', (await errorOf(o.conn.reducers.adminSaveReferralSettings({ ...REF_DEFAULTS, goalEventKey: 'nope', goalValue: 1 }))).includes('EVENT_TYPE_NOT_FOUND'));
  check('goal value checked', (await errorOf(o.conn.reducers.adminSaveReferralSettings({ ...REF_DEFAULTS, goalEventKey: round, goalValue: 0 }))).includes('INVALID_GOAL'));
  check('goal measure checked', (await errorOf(o.conn.reducers.adminSaveReferralSettings({ ...REF_DEFAULTS, goalMeasure: 'avg' }))).includes('INVALID_MEASURE'));
  check('operator cannot change referral rules', (await errorOf(op.client.conn.reducers.adminSaveReferralSettings(REF_DEFAULTS))).includes('FORBIDDEN'));
  check('support role cannot read referral rules', rows(a1.conn.db.adminReferralSettings.iter()).length === 0);
  await refSettings({ referrerPrizeId: inviterPrize, refereePrizeId: invitedPrize, goalEventKey: round, goalValue: 2 });
  check('prize used by referral rules cannot be deleted', (await errorOf(o.conn.reducers.adminDeletePrize({ id: inviterPrize }))).includes('IN_USE'));

  const { p: rA, id: idA } = await player();
  check('code made at sign-in', await waitFor(() => /^[A-HJ-NP-Z2-9]{8}$/.test(rows(rA.conn.db.myReferral.iter())[0]?.code ?? '')), rows(rA.conn.db.myReferral.iter()));
  const codeA = rows(rA.conn.db.myReferral.iter())[0].code;
  const meA = await rA.conn.procedures.referralMe({ lang: 'en' });
  check('referral me shows code, rules and goal', meA.code === codeA && meA.canEnter && meA.goalEventKey === round && meA.goalValue === 2 && meA.referrerPrizeId === inviterPrize && meA.newAccountDays === 7, meA);
  check('own code refused', (await errorOf(rA.conn.procedures.referralEnter({ code: codeA }))).includes('SELF_REFERRAL'));
  check('unknown code refused', (await errorOf(rA.conn.procedures.referralEnter({ code: 'ZZZZZZZZ' }))).includes('CODE_NOT_FOUND'));
  check('empty code refused', (await errorOf(rA.conn.procedures.referralEnter({ code: ' - ' }))).includes('INVALID_CODE'));
  check('agents cannot enter codes', (await errorOf(a1.conn.procedures.referralEnter({ code: codeA }))).includes('PLAYERS_ONLY'));

  const { p: rB, id: idB } = await player();
  const loose = `${codeA.slice(0, 4).toLowerCase()} - ${codeA.slice(4)}`;
  const eB = await rB.conn.procedures.referralEnter({ code: loose });
  check('code normalised and accepted, waiting for the goal', eB.status === 'pending' && eB.claims.length === 0, eB);
  check('player sees who invited', await waitFor(() => rows(rB.conn.db.myReferral.iter())[0]?.referredStatus === 'pending' && rows(rB.conn.db.myReferral.iter())[0]?.referredByName !== ''));
  check('inviter sees the invite', await waitFor(() => rows(rA.conn.db.myReferrals.iter()).some(r => r.status === 'pending')));
  check('enter twice refused', (await errorOf(rB.conn.procedures.referralEnter({ code: codeA }))).includes('ALREADY_REFERRED'));
  await rB.conn.procedures.recordEvent({ key: round, value: 1, metadata: '' });
  check('goal not reached after one round', (await o.conn.procedures.adminReferrals({ query: '', status: '', flag: '', flagged: false, referrerId: 0n, refereeId: idB, page: 1, pageSize: 10 })).rows[0]?.referral.status === 'pending');
  await rB.conn.procedures.recordEvent({ key: round, value: 1, metadata: '' });
  const refB = (await o.conn.procedures.adminReferrals({ query: '', status: '', flag: '', flagged: false, referrerId: 0n, refereeId: idB, page: 1, pageSize: 10 })).rows[0];
  check('goal reached completes the referral', refB?.referral.status === 'completed' && refB.progress === 2 && refB.referral.referrerClaimId > 0n && refB.referral.refereeClaimId > 0n, refB);
  const goldOf = (cl: Client) => rows(cl.conn.db.myWallet.iter()).find(w => w.currencyKey === gold)?.balance ?? 0n;
  check('invited player paid', await waitFor(() => goldOf(rB) === 50n, 5000), goldOf(rB));
  check('inviter paid', await waitFor(() => goldOf(rA) === 100n, 5000), goldOf(rA));
  check('rewards are referral claims', await waitFor(() => rows(rA.conn.db.myRewards.iter()).some(r => r.kind === 'referral' && r.scope === 'referrer' && r.status === 'granted')));
  check('referral activity for both sides', await waitFor(() => rows(rA.conn.db.myActivity.iter()).some(a => a.kind === 'referral' && a.action === 'completed') && rows(rB.conn.db.myActivity.iter()).some(a => a.kind === 'referral' && a.action === 'entered')));
  check('inviter cannot see referee flags or device', rows(rA.conn.db.myReferrals.iter()).every(r => !('device' in r) && !('flags' in r)));

  check('cycle refused', (await errorOf(rA.conn.procedures.referralEnter({ code: rows(rB.conn.db.myReferral.iter())[0].code }))).includes('REFERRAL_CYCLE'));
  const { p: rC, id: idC } = await player();
  await rC.conn.procedures.referralEnter({ code: rows(rB.conn.db.myReferral.iter())[0].code });
  const codeC = rows(rC.conn.db.myReferral.iter())[0]?.code ?? '';
  check('deeper cycle refused', (await errorOf(rA.conn.procedures.referralEnter({ code: codeC }))).includes('REFERRAL_CYCLE'));

  await refSettings({ referrerPrizeId: inviterPrize, refereePrizeId: invitedPrize });
  const idD = await switchAccount(rB);
  check('same device refused for a second code', (await errorOf(rB.conn.procedures.referralEnter({ code: codeA }))).includes('DEVICE_ALREADY_USED'));
  await refSettings({ referrerPrizeId: inviterPrize, refereePrizeId: invitedPrize, onePerDevice: false });
  const eD = await rB.conn.procedures.referralEnter({ code: codeA });
  check('shared device is held when rules allow it', eD.status === 'pending' && eD.claims.length === 0);
  const refD = (await o.conn.procedures.adminReferrals({ query: '', status: 'held', flag: '', flagged: false, referrerId: idA, refereeId: idD, page: 1, pageSize: 10 })).rows[0];
  check('held referral has the shared device flag', refD?.referral.flags.includes('shared_device') === true && refD.flagged, refD);
  check('player sees held as pending', await waitFor(() => rows(rB.conn.db.myReferral.iter())[0]?.referredStatus === 'pending'));
  check('operator cannot approve', (await errorOf(op.client.conn.procedures.adminApproveReferral({ id: refD.referral.id, note: '' }))).includes('FORBIDDEN'));
  const ap = await o.conn.procedures.adminApproveReferral({ id: refD.referral.id, note: 'checked' });
  check('approve without goal completes and pays', ap.status === 'completed' && ap.claims.length === 2, ap);
  check('approved referee paid', await waitFor(() => goldOf(rB) === 50n, 5000));
  check('approve twice refused', (await errorOf(o.conn.procedures.adminApproveReferral({ id: refD.referral.id, note: '' }))).includes('NOT_HELD'));
  check('reject after completion refused', (await errorOf(o.conn.reducers.adminRejectReferral({ id: refD.referral.id, note: '' }))).includes('REFERRAL_DECIDED'));

  await refSettings({ referrerPrizeId: inviterPrize, refereePrizeId: invitedPrize, onePerDevice: false });
  const { p: rE, id: idE } = await player();
  const codeE = rows(rE.conn.db.myReferral.iter())[0]?.code ?? '';
  const idF = await switchAccount(rE);
  const eF = await rE.conn.procedures.referralEnter({ code: codeE });
  const refF = (await o.conn.procedures.adminReferrals({ query: '', status: '', flag: 'same_device', flagged: true, referrerId: idE, refereeId: 0n, page: 1, pageSize: 10 })).rows[0];
  check('inviter on the same device is flagged and held', eF.status === 'pending' && refF?.referral.refereeId === idF && refF.referral.status === 'held', refF);
  await o.conn.reducers.adminRejectReferral({ id: refF.referral.id, note: 'same phone owner' });
  check('reject a held referral', (await o.conn.procedures.adminReferrals({ query: '', status: 'rejected', flag: '', flagged: false, referrerId: idE, refereeId: 0n, page: 1, pageSize: 10 })).total === 1);
  check('rejected pays nothing', goldOf(rE) === 0n);

  await refSettings({ referrerPrizeId: inviterPrize, refereePrizeId: invitedPrize, dailyPerReferrer: 1, holdFlagged: false });
  const { p: rG, id: idG } = await player();
  const codeG = rows(rG.conn.db.myReferral.iter())[0]?.code ?? '';
  const { p: rH } = await player();
  const eH = await rH.conn.procedures.referralEnter({ code: codeG });
  check('first invite of the day clean', eH.status === 'completed' && eH.claims.length === 2, eH);
  const { p: rI } = await player();
  const eI = await rI.conn.procedures.referralEnter({ code: codeG });
  const refI = (await o.conn.procedures.adminReferrals({ query: '', status: '', flag: 'burst', flagged: false, referrerId: idG, refereeId: 0n, page: 1, pageSize: 10 })).rows[0];
  check('burst flagged but not held when hold is off', eI.status === 'completed' && refI?.referral.flags.includes('burst') === true, refI);
  await refSettings({ referrerPrizeId: inviterPrize, refereePrizeId: invitedPrize, maxPerReferrer: 2 });
  const { p: rJ } = await player();
  check('inviter limit', (await errorOf(rJ.conn.procedures.referralEnter({ code: codeG }))).includes('REFERRER_LIMIT'));
  await refSettings({ triesPerHour: 2 });
  await errorOf(rJ.conn.procedures.referralEnter({ code: 'AAAAAAAA' }));
  await errorOf(rJ.conn.procedures.referralEnter({ code: 'AAAAAAAB' }));
  check('tries per hour counted even for failures', (await errorOf(rJ.conn.procedures.referralEnter({ code: codeA }))).includes('TOO_MANY_TRIES'));
  await refSettings({});
  const { p: rK } = await player();
  await clock(8 * DAY);
  check('new-account window', (await errorOf(rK.conn.procedures.referralEnter({ code: codeA }))).includes('ACCOUNT_TOO_OLD'));
  check('referral me says the window closed', (await rK.conn.procedures.referralMe({ lang: '' })).canEnter === false);
  await clock(0);
  await refSettings({ isEnabled: false });
  check('referrals can be switched off', (await errorOf(rK.conn.procedures.referralEnter({ code: codeA }))).includes('REFERRAL_DISABLED'));
  await refSettings({});
  const rs = await o.conn.procedures.adminReferralSummary();
  check('referral summary', rs.completed >= 4 && rs.rejected >= 1 && rs.flagged >= 3 && rs.top.some(t => t.accountId === idA && t.total >= 2), rs);
  const tree = await o.conn.procedures.adminReferralTree({ accountId: idB });
  check('referral tree up and down', tree.up[0]?.accountId === idA && tree.down.length === 1 && tree.down[0].accountId === idC);
  const treeA = await o.conn.procedures.adminReferralTree({ accountId: idA });
  check('referral tree lists invited players', treeA.down.some(d => d.accountId === idB) && treeA.down.some(d => d.accountId === idD));
  check('players cannot list referrals', (await errorOf(rA.conn.procedures.adminReferrals({ query: '', status: '', flag: '', flagged: false, referrerId: 0n, refereeId: 0n, page: 1, pageSize: 10 }))).includes('FORBIDDEN'));
  check('referral audit', (await audits('referral')).includes('referral.approve') && (await audits('referral')).includes('referral.reject') && (await audits('referral')).includes('referral_settings.save'));

  const ck = (s: string) => `cfg.${s}_${R}`;
  const base: ConfigArgs = { key: ck('speed'), version: 0, type: 'number', description: 'speed', value: '1', text: [], rules: [], isActive: true };
  check('config value typed', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, value: 'fast' }))).includes('INVALID_VALUE'));
  check('config bool typed', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, key: ck('flag'), type: 'bool', value: 'yes' }))).includes('INVALID_VALUE'));
  check('config json typed', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, key: ck('json'), type: 'json', value: '{bad' }))).includes('INVALID_VALUE'));
  check('config key format', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, key: 'Bad Key' }))).includes('INVALID_KEY'));
  check('config type known', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, type: 'date' }))).includes('INVALID_TYPE'));
  check('config rule platform checked', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, rules: [cfgRule({ name: 'x', value: '2', platforms: ['tv'] })] }))).includes('INVALID_PLATFORM'));
  check('config rule percent checked', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, rules: [cfgRule({ name: 'x', value: '2', percent: 120 })] }))).includes('INVALID_PERCENT'));
  check('config rule value typed', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, rules: [cfgRule({ name: 'x', value: 'nope' })] }))).includes('INVALID_VALUE'));
  check('config rule names unique', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, rules: [cfgRule({ name: 'x', value: '2' }), cfgRule({ name: 'x', value: '3' })] }))).includes('DUPLICATE_RULE'));
  check('config version range checked', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, rules: [cfgRule({ name: 'x', value: '2', minVersion: '3.0', maxVersion: '2.0' })] }))).includes('INVALID_VERSION_RANGE'));
  check('config country checked', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, rules: [cfgRule({ name: 'x', value: '2', countries: ['QQ'] })] }))).includes('COUNTRY_NOT_FOUND'));
  check('operator cannot write config', (await errorOf(op.client.conn.reducers.adminSaveConfigKey(base))).includes('FORBIDDEN'));

  await o.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key: k('vip'), title: tr('vip'), color: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.tag.iter()).some(x => x.key === k('vip')));
  const vip = rows(o.conn.db.tag.iter()).find(x => x.key === k('vip'))!.id;
  await o.conn.reducers.adminSaveConfigKey({
    ...base,
    rules: [
      cfgRule({ name: 'vip', value: '5', tagIds: [vip] }),
      cfgRule({ name: 'ios_new', value: '3', platforms: ['ios'], minVersion: '2.0.0' }),
      cfgRule({ name: 'iran', value: '4', countries: ['IR'] }),
    ],
  });
  check('config key saved at version 1', await waitFor(() => cfgKey(ck('speed'))?.version === 1));
  const { p: q1, id: qid1 } = await player();
  check('player gets the default', await waitFor(() => myCfg(q1, ck('speed'))?.value === '1' && myCfg(q1, ck('speed'))?.variant === 'default'));
  await q1.conn.reducers.setMyClient({ platform: 'ios', appVersion: '1.5.0' });
  check('old ios version stays default', await waitFor(() => myCfg(q1, ck('speed'))?.variant === 'default'));
  await q1.conn.reducers.setMyClient({ platform: 'ios', appVersion: '2.1.0' });
  check('platform and version rule applies live', await waitFor(() => myCfg(q1, ck('speed'))?.variant === 'ios_new' && myCfg(q1, ck('speed'))?.value === '3'));
  await q1.conn.reducers.setMyCountry({ code: 'IR' });
  check('first fitting rule wins', myCfg(q1, ck('speed'))?.variant === 'ios_new');
  await q1.conn.reducers.setMyClient({ platform: 'android', appVersion: '2.1.0' });
  check('country rule applies', await waitFor(() => myCfg(q1, ck('speed'))?.variant === 'iran'));
  await o.conn.reducers.adminSetPlayerTags({ accountId: qid1, tagIds: [vip] });
  check('player tag rule applies', await waitFor(() => myCfg(q1, ck('speed'))?.variant === 'vip' && myCfg(q1, ck('speed'))?.value === '5'));
  check('bad client platform refused', (await errorOf(q1.conn.reducers.setMyClient({ platform: 'tv', appVersion: '' }))).includes('INVALID_PLATFORM'));
  check('bad client version refused', (await errorOf(q1.conn.reducers.setMyClient({ platform: 'ios', appVersion: 'x.y' }))).includes('INVALID_VERSION'));

  await o.conn.reducers.adminSaveConfigKey({ key: ck('banner'), version: 0, type: 'text', description: '', value: '', text: tr('سلام', 'Hello'), rules: [cfgRule({ name: 'half', text: tr('نیمه', 'Half'), percent: 50 })], isActive: true });
  await waitFor(() => !!cfgKey(ck('banner')));
  const fa = await q1.conn.procedures.remoteConfig({ platform: '', version: '', keys: [ck('banner')], lang: 'fa' });
  const en = await q1.conn.procedures.remoteConfig({ platform: '', version: '', keys: [ck('banner')], lang: 'en' });
  check('text values translated', fa.values.length === 1 && en.values.length === 1 && fa.values[0].variant === en.values[0].variant && (fa.values[0].value === 'سلام' || fa.values[0].value === 'نیمه') && (en.values[0].value === 'Hello' || en.values[0].value === 'Half'), { fa, en });
  const ids: bigint[] = [qid1, id1, id2, id3, idA, idB, idD, idE, idF, idG, cid1];
  let inHalf = 0;
  let stable = true;
  for (const id of ids) {
    const a = await o.conn.procedures.adminConfigPreview({ accountId: id, platform: 'web', version: '', country: '', tagIds: [], lang: 'en' });
    const b = await o.conn.procedures.adminConfigPreview({ accountId: id, platform: 'web', version: '', country: '', tagIds: [], lang: 'en' });
    const va = a.values.find(v => v.key === ck('banner'))!;
    const vb = b.values.find(v => v.key === ck('banner'))!;
    if (va.variant !== vb.variant || va.bucket !== vb.bucket) stable = false;
    if ((va.variant === 'half') !== va.bucket < 5000) stable = false;
    if (va.variant === 'half') inHalf++;
  }
  check('percent buckets are stable and match the rule', stable);
  check('percent split is not all or nothing', inHalf > 0 && inHalf < ids.length, inHalf);
  const preview = await o.conn.procedures.adminConfigPreview({ accountId: 0n, platform: 'ios', version: '2.5', country: '', tagIds: [], lang: 'en' });
  check('preview for made-up facts', preview.values.find(v => v.key === ck('speed'))?.variant === 'ios_new');

  const full1 = await q1.conn.procedures.remoteConfig({ platform: '', version: '', keys: [], lang: '' });
  check('first full fetch is not a change', full1.changed.length === 0 && full1.values.some(v => v.key === ck('speed')) && /^[0-9a-f]{16}$/.test(full1.hash));
  const v1 = cfgKey(ck('speed'))!;
  check('stale version refused', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, version: 7 }))).includes('VERSION_CONFLICT'));
  check('create over an existing key refused', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, version: 0 }))).includes('KEY_TAKEN'));
  check('type locked', (await errorOf(o.conn.reducers.adminSaveConfigKey({ ...base, version: v1.version, type: 'string' }))).includes('TYPE_LOCKED'));
  await o.conn.reducers.adminSaveConfigKey({ ...base, version: v1.version, value: '2', rules: v1.rules.map(r => (r.name === 'vip' ? { ...r, value: '9' } : r)) });
  check('edit makes version 2', await waitFor(() => cfgKey(ck('speed'))?.version === 2 && myCfg(q1, ck('speed'))?.value === '9'));
  const full2 = await q1.conn.procedures.remoteConfig({ platform: '', version: '', keys: [], lang: '' });
  check('changed values reported', full2.hash !== full1.hash && full2.changed.includes(`${ck('speed')}:vip`), full2.changed);
  check('config change written to the activity', await waitFor(() => rows(q1.conn.db.myActivity.iter()).some(a => a.kind === 'config' && a.action === 'changed')));
  await o.conn.reducers.adminRollbackConfig({ key: ck('speed'), version: 1 });
  check('rollback restores as a new version', await waitFor(() => cfgKey(ck('speed'))?.version === 3 && cfgKey(ck('speed'))?.value === '1' && myCfg(q1, ck('speed'))?.value === '5'));
  await o.conn.reducers.adminDeleteConfigKey({ key: ck('speed') });
  check('deleted key leaves the player view', await waitFor(() => !myCfg(q1, ck('speed'))));
  await o.conn.reducers.adminRollbackConfig({ key: ck('speed'), version: 2 });
  check('rollback brings a deleted key back', await waitFor(() => cfgKey(ck('speed'))?.version === 4 && myCfg(q1, ck('speed'))?.value === '9'));
  check('unknown version refused', (await errorOf(o.conn.reducers.adminRollbackConfig({ key: ck('speed'), version: 99 }))).includes('VERSION_NOT_FOUND'));
  const hist = await o.conn.procedures.adminConfigHistory({ key: ck('speed'), page: 1, pageSize: 20 });
  check('history keeps every change', hist.rows.map(h => h.action).join() === 'rollback,delete,rollback,update,create', hist.rows.map(h => h.action));
  await o.conn.reducers.adminSaveConfigKey({ key: ck('off'), version: 0, type: 'string', description: '', value: 'x', text: [], rules: [], isActive: false });
  await waitFor(() => !!cfgKey(ck('off')));
  check('inactive keys are not served', !myCfg(q1, ck('off')));
  check('players cannot read config admin', rows(q1.conn.db.adminConfigKeys.iter()).length === 0);
  check('config audit', (await audits('config.')).includes('config.rollback') && (await audits('config.')).includes('config.delete'));

  check('sign-in written to the activity', rows(q1.conn.db.myActivity.iter()).some(a => a.kind === 'login' && a.action === 'signup'));
  check('player sees only own activity', rows(q1.conn.db.myActivity.iter()).every(a => !rows(p1.conn.db.myActivity.iter()).some(b => b.id === a.id)));
  await o.conn.reducers.adminRestrict({ accountId: qid1, kind: 'warn', minutes: 0, endsAt: 0n, reason: tr('هشدار'), note: '' });
  check('restrictions written by players package', await waitFor(() => rows(q1.conn.db.myActivity.iter()).some(a => a.kind === 'restriction' && a.action === 'warn' && a.actor === 'admin')));
  check('admin ids hidden from the player', rows(q1.conn.db.myActivity.iter()).every(a => !a.actor.startsWith('admin:')));
  const mine = await q1.conn.procedures.activityMine({ kind: 'login', before: 0n, limit: 10 });
  check('activity mine filters by kind', mine.rows.length >= 1 && mine.rows.every(r => r.kind === 'login' && r.device === ''));
  const adm = await a1.conn.procedures.adminActivity({ accountId: qid1, kinds: ['restriction', 'config'], action: '', country: '', platform: '', from: 0n, to: 0n, q: '', page: 1, pageSize: 50 });
  check('support agent reads any activity', adm.total >= 2 && adm.rows.every(r => r.accountId === qid1) && adm.rows.some(r => r.actor.startsWith('admin:')));
  const byCountry = await o.conn.procedures.adminActivity({ accountId: qid1, kinds: [], action: '', country: 'ir', platform: 'android', from: 0n, to: 0n, q: '', page: 1, pageSize: 50 });
  check('activity carries country and platform', byCountry.total >= 1);
  check('players cannot read admin activity', (await errorOf(q1.conn.procedures.adminActivity({ accountId: id1, kinds: [], action: '', country: '', platform: '', from: 0n, to: 0n, q: '', page: 1, pageSize: 10 }))).includes('FORBIDDEN'));
  check('activity range checked', (await errorOf(o.conn.procedures.adminActivity({ accountId: 0n, kinds: [], action: '', country: '', platform: '', from: 5n, to: 1n, q: '', page: 1, pageSize: 10 }))).includes('INVALID_RANGE'));
  const asum = await o.conn.procedures.adminActivitySummary();
  check('activity summary', asum.total > 0 && asum.kinds.some(x => x.kind === 'login') && asum.retentionDays === 180);

  await settings({ activityRetentionDays: 1 });
  const before = rows(q1.conn.db.myActivity.iter()).length;
  await clock(2 * DAY);
  run = await o.conn.procedures.adminSupportRun();
  check('retention sweep removes old activity', await waitFor(() => rows(q1.conn.db.myActivity.iter()).length < before), run);
  await clock(0);
  await settings({});

  check('ticket audit', (await audits('support_ticket.')).includes('support_ticket.status') && (await audits('support_ticket.')).includes('support_ticket.assign') && (await audits('support_ticket.')).includes('support_ticket.create'));
  check('settings audit', (await audits('support_settings.')).includes('support_settings.clock') && (await audits('support_department.')).includes('support_department.create'));
  await o.conn.reducers.adminDeleteSupportCanned({ id: rows(o.conn.db.adminSupportCanned.iter()).find(x => x.key === k('canned'))!.id });
  check('canned reply deleted', await waitFor(() => !rows(o.conn.db.adminSupportCanned.iter()).some(x => x.key === k('canned'))));

  await a1.conn.reducers.adminSupportHeartbeat({ away: true });
  await a2.conn.reducers.adminSupportHeartbeat({ away: true });
  await clock(0);
  check('support clock back at zero', rows(o.conn.db.adminSupportSettings.iter())[0]?.clockOffsetSec === 0n);
  done('support');
}

main().catch(async e => {
  console.error('ERROR', e);
  try {
    await clock(0);
    await settings({});
    await refSettings({});
  } catch {}
  process.exit(1);
});
