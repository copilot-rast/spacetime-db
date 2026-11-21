import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowsClockwise,
  ArrowRight,
  ArrowsLeftRight,
  Buildings,
  ChatCircleDots,
  ChatText,
  ChatsTeardrop,
  ClockClockwise,
  HandGrabbing,
  Headset,
  Hourglass,
  Lightning,
  LockSimple,
  MagnifyingGlass,
  PaperPlaneTilt,
  Paperclip,
  Plus,
  Star,
  Ticket as TicketIc,
  Timer,
  Tray,
  UserCircle,
  UsersThree,
  Warning,
  X,
} from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { date, digits, errorText, getLocale, latin, num, roleLabel, t, useLocale, type StrKey } from './i18n.ts';
import { go, pageQuery, run, runToast, toast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, NumInput, Notice, Pager, Pop, SaveButton, Seg, Skel, Spinner, SwitchRow, TableSkeleton, TrInputs, confirmAsk, trMissingDefault } from './ui.tsx';
import { Section, fmtNum, kindLabelR, microsFromInput } from './widgets.tsx';
import { ActiveBadge, AddButton, FormDialog, NameCell, PageHead, del, needTitle, save } from './economy.tsx';
import { CatalogTable, Choice, useLoaded } from './kit.tsx';
import { TestClock } from './settings3.tsx';
import { playerIdOf } from './pubnotify.tsx';
import './support.css';

const PAGE = 20;

type Conn = ReturnType<typeof getConn>;
type TicketLine = Awaited<ReturnType<Conn['procedures']['adminTickets']>>['rows'][number];
type TicketRow = TicketLine['ticket'];
type TicketDetail = Awaited<ReturnType<Conn['procedures']['adminTicket']>>;
type ChatRow = Awaited<ReturnType<Conn['procedures']['adminChats']>>['rows'][number];
type ActRow = Awaited<ReturnType<Conn['procedures']['adminActivity']>>['rows'][number];
type QueueRow = RowOf<'adminChatQueue'>;
type DeptRow = RowOf<'adminSupportDepartments'>;
type CannedRow = RowOf<'adminSupportCanned'>;
type AgentRow = RowOf<'adminSupportAgents'>;
type Attach = { url: string; name: string; type: string; size: number };
type Msg = { id: bigint; kind: string; authorType: string; authorId: bigint; body: string; attachments: Attach[]; event: string; eventData: string; at: bigint };

export const SX_STATUS: [string, StrKey][] = [
  ['open', 'sxStOpen'],
  ['awaiting_staff', 'sxStAwaitingStaff'],
  ['awaiting_player', 'sxStAwaitingPlayer'],
  ['resolved', 'sxStResolved'],
  ['closed', 'sxStClosed'],
];

export const SX_PRIORITY: [string, StrKey][] = [
  ['low', 'sxPrLow'],
  ['normal', 'sxPrNormal'],
  ['high', 'sxPrHigh'],
  ['urgent', 'sxPrUrgent'],
];

const SOURCES: Record<string, StrKey> = { player: 'sxSrcPlayer', chat: 'sxSrcChat', staff: 'sxSrcStaff' };

function quiet(fn: (c: Conn) => Promise<unknown>) {
  try {
    fn(getConn()).catch(() => undefined);
  } catch {
    return;
  }
}

function statusText(s: string) {
  const k = SX_STATUS.find(x => x[0] === s)?.[1];
  return k ? t(k) : s;
}

function priorityText(p: string) {
  const k = SX_PRIORITY.find(x => x[0] === p)?.[1];
  return k ? t(k) : p;
}

export function ticketBadge(s: string) {
  const cls = s === 'open' ? 'b-info' : s === 'awaiting_staff' ? 'b-warn' : s === 'awaiting_player' ? 'b-violet' : s === 'resolved' ? 'b-ok' : '';
  return <span className={`badge ${cls}`}>{statusText(s)}</span>;
}

function priorityBadge(p: string) {
  const cls = p === 'urgent' ? 'b-bad' : p === 'high' ? 'b-warn' : p === 'low' ? 'b-teal' : '';
  return <span className={`badge ${cls}`}>{priorityText(p)}</span>;
}

function movesFrom(s: string) {
  const out: string[] = [];
  if (s === 'open' || s === 'awaiting_staff') out.push('awaiting_player');
  if (s === 'resolved' || s === 'closed') out.push('awaiting_staff');
  if (s !== 'resolved' && s !== 'closed') out.push('resolved');
  if (s !== 'closed') out.push('closed');
  return out;
}

function moveText(to: string) {
  return to === 'awaiting_staff' ? t('sxReopen') : statusText(to);
}

function us(v: bigint, withTime = true) {
  return v ? date(new Date(Number(v / 1000n)), withTime) : '—';
}

function clock(v: bigint) {
  if (!v) return '—';
  const l = getLocale();
  return new Intl.DateTimeFormat(l === 'fa' ? 'fa-IR-u-ca-persian-nu-arabext' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(Number(v / 1000n)));
}

export function pname(name: string, id: bigint) {
  if (!name) return `#${digits(String(id))}`;
  return /^#\d+$/.test(name) ? `#${digits(name.slice(1))}` : name;
}

function span(min: number) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return t('sxMinutes', { n: m });
  if (m < 1440) return t('sxHours', { n: Math.floor(m / 60) });
  return t('sxSpanDays', { n: Math.floor(m / 1440) });
}

function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setN(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}

function useSupNow(ms = 30000) {
  const offset = useRows('adminSupportSettings')[0]?.clockOffsetSec ?? 0n;
  const n = useNow(ms);
  return BigInt(n) * 1000n + offset * 1_000_000n;
}

function sinceMs(v: bigint, nowMs: number) {
  return v ? nowMs - Number(v / 1000n) : Infinity;
}

function useDepts() {
  const list = useRows('adminSupportDepartments');
  const { def } = useLanguages();
  const sorted = [...list].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const label = (d: DeptRow | undefined) => (d ? trText(d.name, def) || d.key : '—');
  return { list: sorted, name: (id: bigint) => label(list.find(x => x.id === id)), byKey: (k: string) => (list.find(x => x.key === k) ? label(list.find(x => x.key === k)) : k || '—') };
}

function useAgents() {
  const list = useRows('adminSupportAgents');
  const secs = useRows('adminSupportSettings')[0]?.agentOnlineSeconds ?? 75;
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return {
    list: sorted,
    name: (id: bigint) => (id ? pname(list.find(a => a.accountId === id)?.name ?? '', id) : ''),
    state: (a: AgentRow, nowMs: number): 'on' | 'away' | 'off' => (sinceMs(a.lastSeenAt, nowMs) > secs * 1000 ? 'off' : a.away ? 'away' : 'on'),
  };
}

function PlayerName(props: { id: bigint; name: string; testId?: string }) {
  const { can } = useSession();
  const label = pname(props.name, props.id);
  return can('operator') ? (
    <a className="row-link" href={`#/player?id=${props.id}`} data-testid={props.testId}>
      {label}
    </a>
  ) : (
    <span data-testid={props.testId}>{label}</span>
  );
}

function attachFrom(s: string): Attach[] {
  return s
    .split(/\s+/)
    .map(x => x.trim())
    .filter(Boolean)
    .map(url => ({ url, name: '', type: '', size: 0 }));
}

function AttachInput(props: { value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <textarea
      className="textarea ltr"
      rows={2}
      name="attachments"
      value={props.value}
      onChange={e => props.onChange(e.target.value)}
      placeholder="https://cdn.example.com/screenshot.png"
      data-testid={props.testId}
      spellCheck={false}
    />
  );
}

function Attachments(props: { list: Attach[] }) {
  if (!props.list.length) return null;
  return (
    <div className="chips sx-files">
      {props.list.map((a, i) => (
        <a key={i} className="chip chip-btn" href={a.url} target="_blank" rel="noreferrer noopener" data-testid="sx-file">
          <Paperclip className="ic" />
          <span className="ltr ellipsis">{a.name || a.url}</span>
          {a.size ? <span className="muted">{t('sxKb', { n: num(Math.max(1, Math.round(a.size / 1024))) })}</span> : null}
        </a>
      ))}
    </div>
  );
}

function Due(props: { dueAt: bigint; overdue: boolean; now: bigint }) {
  if (!props.dueAt) return <span className="muted small">—</span>;
  const diff = Number(props.dueAt - props.now) / 60e6;
  return (
    <span className="stack" style={{ gap: 2, alignItems: 'flex-start' }}>
      {props.overdue || diff < 0 ? (
        <span className="badge b-bad" data-testid="sx-overdue">
          <Warning className="ic" />
          {t('sxOverdueBy', { d: span(-diff) })}
        </span>
      ) : (
        <span className={`badge ${diff < 60 ? 'b-warn' : ''}`}>
          <Timer className="ic" />
          {t('sxDueIn', { d: span(diff) })}
        </span>
      )}
      <span className="small muted nowrap">{us(props.dueAt)}</span>
    </span>
  );
}

function QuickStatus(props: { tk: TicketRow; testId: string; compact?: boolean }) {
  const moves = movesFrom(props.tk.status);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const move = (to: string) => runToast(c => c.reducers.adminSupportStatus({ ticketId: props.tk.id, status: to }), t('sxStatusSaved'));
  if (props.compact)
    return (
      <>
        <button type="button" className="btn btn-sm btn-icon btn-outline" onClick={e => setAnchor(e.currentTarget)} aria-label={t('sxMoveTo')} title={t('sxMoveTo')} aria-haspopup="menu" data-testid={props.testId}>
          <ArrowsClockwise className="ic" />
        </button>
        {anchor && (
          <Pop anchor={anchor} onClose={() => setAnchor(null)} align="end" testId={`${props.testId}-pop`}>
            <div className="pop-label">{t('sxMoveTo')}</div>
            {moves.map(m => (
              <button
                type="button"
                key={m}
                className="pop-item"
                data-testid={`${props.testId}-${m}`}
                onClick={() => {
                  setAnchor(null);
                  move(m);
                }}
              >
                {ticketBadge(m)}
                <span>{moveText(m)}</span>
              </button>
            ))}
          </Pop>
        )}
      </>
    );
  return (
    <select
      className={`select ${props.compact ? 'sx-quick' : 'sx-auto'}`}
      value=""
      onChange={e => {
        const to = e.target.value;
        if (to) runToast(c => c.reducers.adminSupportStatus({ ticketId: props.tk.id, status: to }), t('sxStatusSaved'));
      }}
      aria-label={t('sxMoveTo')}
      data-testid={props.testId}
    >
      <option value="">{t('sxMoveTo')}</option>
      {moves.map(s => (
        <option key={s} value={s}>
          {moveText(s)}
        </option>
      ))}
    </select>
  );
}

function TakeButton(props: { tk: TicketRow; testId: string; icon?: boolean }) {
  const { me } = useSession();
  if (!me || props.tk.assigneeId === me.id) return null;
  return (
    <button
      type="button"
      className={`btn btn-sm btn-outline ${props.icon ? 'btn-icon' : ''}`}
      onClick={() => runToast(c => c.reducers.adminSupportTake({ ticketId: props.tk.id }), t('sxTaken'))}
      aria-label={t('sxTake')}
      title={t('sxTake')}
      data-testid={props.testId}
    >
      <HandGrabbing className="ic" />
      {!props.icon && t('sxTake')}
    </button>
  );
}

function NewTicketDialog(props: { onClose: () => void }) {
  const depts = useDepts();
  const active = depts.list.filter(d => d.isActive);
  const [player, setPlayer] = useState('');
  const [dept, setDept] = useState(active[0] ? String(active[0].id) : '0');
  const [priority, setPriority] = useState('normal');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState('');
  return (
    <FormDialog
      title={t('sxNewTicket')}
      testId="tk-new-dialog"
      width={640}
      onClose={props.onClose}
      submit={async () => {
        const id = playerIdOf(player);
        if (!id) return { ok: false, msg: t('sxNeedPlayer') } as const;
        const r = await run(
          c => c.procedures.adminSupportCreateTicket({ accountId: id, subject: subject.trim(), body: body.trim(), departmentId: BigInt(dept || '0'), priority, attachments: attachFrom(files) }),
          t('sxCreated')
        );
        if (!r.ok) return { ok: false, err: r.err } as const;
        go(`ticket?id=${r.value.ticketId}`);
        return { ok: true } as const;
      }}
    >
      <Field label={t('elPlayer')} required hint={t('sxPlayerIdHint')}>
        <input className="input ltr" name="player" value={player} onChange={e => setPlayer(e.target.value)} inputMode="numeric" placeholder="#" autoFocus data-testid="tk-new-player" />
      </Field>
      <Field label={t('sxDepartment')}>
        <select className="select" value={dept} onChange={e => setDept(e.target.value)} name="department" data-testid="tk-new-dept">
          {active.map(d => (
            <option key={String(d.id)} value={String(d.id)}>
              {depts.name(d.id)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('sxSubject')} required className="span-2" hint={t('sxSubjectHint')}>
        <input className="input" name="subject" value={subject} onChange={e => setSubject(e.target.value)} data-testid="tk-new-subject" />
      </Field>
      <Field label={t('sxPriority')}>
        <Choice value={priority} onChange={setPriority} options={SX_PRIORITY} name="priority" testId="tk-new-priority" label={t('sxPriority')} />
      </Field>
      <span />
      <Field label={t('sxFirstMessage')} required className="span-2" hint={t('sxFirstMessageHint')}>
        <textarea className="textarea" rows={5} name="body" value={body} onChange={e => setBody(e.target.value)} data-testid="tk-new-body" />
      </Field>
      <Field label={t('sxFiles')} className="span-2" hint={t('sxFilesHint')}>
        <AttachInput value={files} onChange={setFiles} testId="tk-new-files" />
      </Field>
    </FormDialog>
  );
}

export function Tickets() {
  useLocale();
  const route = useRoute();
  const q = route.query;
  const depts = useDepts();
  const agents = useAgents();
  const now = useSupNow(15000);
  const f = {
    q: q.get('q') ?? '',
    status: q.get('status') ?? 'active',
    priority: q.get('priority') ?? '',
    dept: q.get('dept') ?? '',
    assignee: q.get('assignee') ?? '',
    overdue: q.get('overdue') === '1',
    sort: q.get('sort') ?? '',
    player: q.get('player') ?? '',
  };
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const set = (p: Partial<typeof f>) => {
    setPage(1);
    const n = { ...f, ...p };
    pageQuery('tickets', { q: n.q, status: n.status === 'active' ? '' : n.status, priority: n.priority, dept: n.dept, assignee: n.assignee, overdue: n.overdue ? '1' : '', sort: n.sort, player: n.player });
  };
  const dq = useDebounced(f.q, 300);
  const accountId = playerIdOf(f.player);
  const { data, error, loading } = useFetch(
    () =>
      getConn().procedures.adminTickets({
        query: latin(dq),
        status: f.status === 'all' ? '' : f.status,
        priority: f.priority,
        departmentId: /^\d+$/.test(f.dept) ? BigInt(f.dept) : 0n,
        assignee: f.assignee,
        accountId,
        overdue: f.overdue,
        sort: f.sort,
        page,
        pageSize: PAGE,
      }),
    [dq, f.status, f.priority, f.dept, f.assignee, f.overdue, f.sort, String(accountId), page, String(now / 15_000_000n)]
  );
  const rows = data?.rows ?? [];
  const actions = (x: TicketLine, p: string) => (
    <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
      <TakeButton tk={x.ticket} testId={`${p}-take-${x.ticket.id}`} icon={p === 'tk'} />
      <QuickStatus tk={x.ticket} testId={`${p}-status-${x.ticket.id}`} compact={p === 'tk'} />
    </span>
  );
  return (
    <main className="page" data-testid="page-tickets">
      <PageHead
        title={t('navTickets')}
        sub={data ? t('sxTicketsTotal', { n: num(data.total) }) : <Skel w={80} h={10} />}
        action={
          <button type="button" className="btn btn-primary" onClick={() => setCreate(true)} data-testid="tk-add">
            <Plus className="ic" />
            {t('sxNewTicket')}
          </button>
        }
      />
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input className="input" value={f.q} onChange={e => set({ q: e.target.value })} placeholder={t('sxSearch')} aria-label={t('sxSearch')} data-testid="tk-q" />
        </div>
        <select className="select sx-auto" value={f.status} onChange={e => set({ status: e.target.value })} aria-label={t('status')} data-testid="tk-f-status">
          <option value="active">{t('sxFActive')}</option>
          <option value="waiting">{t('sxFWaiting')}</option>
          {SX_STATUS.map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
          <option value="all">{t('sxFAll')}</option>
        </select>
        <select className="select sx-auto" value={f.priority} onChange={e => set({ priority: e.target.value })} aria-label={t('sxPriority')} data-testid="tk-f-priority">
          <option value="">{t('sxAnyPriority')}</option>
          {SX_PRIORITY.map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
        </select>
        <select className="select sx-auto" value={f.dept} onChange={e => set({ dept: e.target.value })} aria-label={t('sxDepartment')} data-testid="tk-f-dept">
          <option value="">{t('sxAnyDept')}</option>
          {depts.list.map(d => (
            <option key={String(d.id)} value={String(d.id)}>
              {depts.name(d.id)}
            </option>
          ))}
        </select>
        <select className="select sx-auto" value={f.assignee} onChange={e => set({ assignee: e.target.value })} aria-label={t('sxAssignee')} data-testid="tk-f-assignee">
          <option value="">{t('sxAnyone')}</option>
          <option value="me">{t('sxMine')}</option>
          <option value="none">{t('sxUnassigned')}</option>
          {agents.list.map(a => (
            <option key={String(a.accountId)} value={String(a.accountId)}>
              {pname(a.name, a.accountId)}
            </option>
          ))}
        </select>
        <select className="select sx-auto" value={f.sort} onChange={e => set({ sort: e.target.value })} aria-label={t('sxSort')} data-testid="tk-f-sort">
          <option value="">{t('sxSortNewest')}</option>
          <option value="due">{t('sxSortDue')}</option>
          <option value="priority">{t('sxSortPriority')}</option>
        </select>
        <button type="button" className="chip chip-btn" aria-pressed={f.overdue} onClick={() => set({ overdue: !f.overdue })} data-testid="tk-f-overdue">
          <Warning className="ic" />
          {t('sxOverdueOnly')}
        </button>
        {accountId > 0n && (
          <span className="chip" data-testid="tk-f-player">
            {t('sxPlayerFilter', { id: digits(String(accountId)) })}
            <button type="button" className="btn btn-icon btn-sm sx-chip-x" onClick={() => set({ player: '' })} aria-label={t('sxClearFilter')}>
              <X className="ic" />
            </button>
          </span>
        )}
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="tk-table">
          <thead>
            <tr>
              <th>{t('sxTicket')}</th>
              <th>{t('pyColPlayer')}</th>
              <th>{t('status')}</th>
              <th>{t('sxDepartment')}</th>
              <th>{t('sxAssignee')}</th>
              <th>{t('sxDueOrUpdated')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={7} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty icon={<Tray className="ic" weight="duotone" />} title={t('sxNoTickets')} text={t('sxNoTicketsHint')} />
                </td>
              </tr>
            ) : (
              rows.map(x => (
                <tr key={String(x.ticket.id)} data-testid={`tk-row-${x.ticket.id}`}>
                  <td>
                    <a className="row-link primary" dir="auto" href={`#/ticket?id=${x.ticket.id}`} data-testid={`tk-open-${x.ticket.id}`}>
                      {x.ticket.subject}
                    </a>
                    <div className="small muted cell-detail">
                      <span className="mono">{digits(x.ticket.number)}</span> · {x.ticket.lastMessage}
                    </div>
                  </td>
                  <td className="nowrap">
                    <PlayerName id={x.ticket.accountId} name={x.playerName} />
                  </td>
                  <td>
                    <span className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
                      {ticketBadge(x.ticket.status)}
                      {priorityBadge(x.ticket.priority)}
                    </span>
                  </td>
                  <td className="small">{depts.byKey(x.departmentKey)}</td>
                  <td className="small nowrap">{x.ticket.assigneeId ? pname(x.assigneeName, x.ticket.assigneeId) : <span className="muted">{t('sxNobody')}</span>}</td>
                  <td>{x.ticket.dueAt ? <Due dueAt={x.ticket.dueAt} overdue={x.overdue} now={now} /> : <span className="small muted nowrap">{us(x.ticket.updatedAt)}</span>}</td>
                  <td className="end">{actions(x, 'tk')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards" data-testid="tk-cards">
          {data && rows.length === 0 && <Empty icon={<Tray className="ic" weight="duotone" />} title={t('sxNoTickets')} />}
          {rows.map(x => (
            <div className="pcard" key={String(x.ticket.id)} data-testid={`tkc-${x.ticket.id}`}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <a className="row-link grow primary" href={`#/ticket?id=${x.ticket.id}`}>
                  {x.ticket.subject}
                </a>
                {ticketBadge(x.ticket.status)}
              </div>
              <div className="row row-wrap" style={{ gap: 6 }}>
                {priorityBadge(x.ticket.priority)}
                {x.overdue && (
                  <span className="badge b-bad">
                    <Warning className="ic" />
                    {t('sxOverdue')}
                  </span>
                )}
              </div>
              <div className="pcard-meta">
                <span>{t('sxNumber')}</span>
                <span className="mono">{digits(x.ticket.number)}</span>
                <span>{t('pyColPlayer')}</span>
                <span>{pname(x.playerName, x.ticket.accountId)}</span>
                <span>{t('sxDepartment')}</span>
                <span>{depts.byKey(x.departmentKey)}</span>
                <span>{t('sxAssignee')}</span>
                <span>{x.ticket.assigneeId ? pname(x.assigneeName, x.ticket.assigneeId) : t('sxNobody')}</span>
                <span>{x.ticket.dueAt ? t('sxDue') : t('sxUpdated')}</span>
                <span>{us(x.ticket.dueAt || x.ticket.updatedAt)}</span>
              </div>
              {actions(x, 'tkc')}
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {create && <NewTicketDialog onClose={() => setCreate(false)} />}
    </main>
  );
}

function eventText(m: Msg, agentName: (id: bigint) => string, deptByKey: (k: string) => string) {
  const d = m.eventData;
  switch (m.event) {
    case 'status_changed':
      return t('sxEvStatus', { s: statusText(d) });
    case 'assigned':
      return /^\d+$/.test(d) && d !== '0' ? t('sxEvAssigned', { a: agentName(BigInt(d)) }) : t('sxEvUnassigned');
    case 'department_changed':
      return t('sxEvDept', { d: deptByKey(d) });
    case 'priority_changed':
      return t('sxEvPriority', { p: priorityText(d) });
    case 'rated':
      return t('sxEvRated', { n: Number(d) || 0 });
    case 'created_from_chat':
      return t('sxEvFromChat', { id: digits(d) });
    case 'created_by_staff':
      return t('sxEvByStaff');
    case 'auto_closed':
      return t('sxEvAutoClosed');
    default:
      return m.event;
  }
}

function Thread(props: { msgs: Msg[]; playerName: string; accountId: bigint }) {
  const agents = useAgents();
  const depts = useDepts();
  const player = pname(props.playerName, props.accountId);
  if (!props.msgs.length) return <Empty icon={<ChatText className="ic" weight="duotone" />} title={t('sxNoMessages')} />;
  return (
    <div className="sx-thread" data-testid="tk-messages">
      {props.msgs.map(m =>
        m.kind === 'event' ? (
          <div className="sx-event" key={String(m.id)} data-testid={`tk-ev-${m.id}`}>
            <ClockClockwise className="ic" />
            <span>{eventText(m, agents.name, depts.byKey)}</span>
            {m.authorType === 'staff' && m.authorId ? <span>{t('sxEvBy', { who: agents.name(m.authorId) })}</span> : null}
            <span aria-hidden="true">·</span>
            <span className="nowrap">{us(m.at)}</span>
          </div>
        ) : (
          <div className={`sx-msg ${m.authorType === 'player' ? 'from-player' : 'from-staff'} ${m.kind === 'note' ? 'is-note' : ''}`} key={String(m.id)} data-testid={`tk-msg-${m.id}`} data-kind={m.kind}>
            <div className="sx-msg-head">
              {m.kind === 'note' && (
                <span className="badge b-warn">
                  <LockSimple className="ic" />
                  {t('sxNote')}
                </span>
              )}
              <b>{m.authorType === 'player' ? player : m.authorType === 'staff' ? agents.name(m.authorId) || t('sxStaff') : t('sxSystem')}</b>
              <span className="grow" />
              <span className="nowrap">{us(m.at)}</span>
            </div>
            <div className="sx-msg-body" dir="auto">
              {m.body}
            </div>
            <Attachments list={m.attachments} />
          </div>
        )
      )}
    </div>
  );
}

function CannedPick(props: { departmentId: bigint; onPick: (text: string) => void; testId: string }) {
  const list = useRows('adminSupportCanned');
  const { def } = useLanguages();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const rows = list.filter(c => c.isActive && (!c.departmentId || c.departmentId === props.departmentId)).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <>
      <button type="button" className="btn btn-sm btn-outline" onClick={e => setAnchor(e.currentTarget)} data-testid={props.testId} aria-haspopup="menu">
        <ChatText className="ic" />
        {t('sxCanned')}
      </button>
      {anchor && (
        <Pop anchor={anchor} onClose={() => setAnchor(null)} align="end" width={340} testId={`${props.testId}-pop`}>
          {rows.length === 0 ? (
            <div className="pop-pad small muted">{t('sxNoCanned')}</div>
          ) : (
            rows.map(c => (
              <button
                type="button"
                className="pop-item sx-canned-item"
                key={String(c.id)}
                data-testid={`${props.testId}-${c.key}`}
                onClick={() => {
                  props.onPick(trText(c.body, def));
                  setAnchor(null);
                }}
              >
                <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                  <span>{trText(c.title, def) || c.key}</span>
                  <span className="small muted ellipsis">{trText(c.body, def)}</span>
                </span>
              </button>
            ))
          )}
        </Pop>
      )}
    </>
  );
}

function ReplyBox(props: { tk: TicketRow }) {
  const tk = props.tk;
  const [body, setBody] = useState('');
  const [note, setNote] = useState(false);
  const [status, setStatus] = useState('awaiting_player');
  const [files, setFiles] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const closed = tk.status === 'closed';
  const blocked = closed && !note;
  async function send() {
    setBusy(true);
    setErr(null);
    const r = await run(c => c.reducers.adminSupportReply({ ticketId: tk.id, body: body.trim(), internal: note, status: note ? '' : status, attachments: attachFrom(files) }), note ? t('sxNoteAdded') : t('sxReplySent'));
    setBusy(false);
    if (r.ok) {
      setBody('');
      setFiles('');
      setShowFiles(false);
      setStatus('awaiting_player');
    } else setErr(errorText(r.err));
  }
  return (
    <section className={`card sx-reply ${note ? 'is-note' : ''}`} data-testid="tk-reply">
      <div className="card-head">
        <Seg
          value={note ? 'note' : 'reply'}
          onChange={v => setNote(v === 'note')}
          label={t('sxReplyKind')}
          options={[
            { value: 'reply', label: t('sxReplyTab') },
            { value: 'note', label: t('sxNoteTab') },
          ]}
        />
        <span className="grow" />
        <CannedPick departmentId={tk.departmentId} onPick={txt => setBody(b => (b.trim() ? `${b.trimEnd()}\n${txt}` : txt))} testId="tk-canned" />
      </div>
      <div className="card-pad stack">
        {blocked && <Notice kind="warn" text={t('sxClosedHint')} />}
        {note && (
          <span className="small sub row" style={{ gap: 6 }}>
            <LockSimple className="ic" />
            {t('sxNoteHint')}
          </span>
        )}
        <textarea className="textarea" rows={5} name="reply" value={body} onChange={e => setBody(e.target.value)} placeholder={note ? t('sxNotePh') : t('sxReplyPh')} disabled={blocked} data-testid="tk-reply-body" />
        {showFiles && (
          <Field label={t('sxFiles')} hint={t('sxFilesHint')}>
            <AttachInput value={files} onChange={setFiles} testId="tk-reply-files" />
          </Field>
        )}
        <ErrBox text={err} />
        <div className="row row-wrap">
          <button type="button" className="btn btn-sm" onClick={() => setShowFiles(!showFiles)} aria-pressed={showFiles} data-testid="tk-reply-attach">
            <Paperclip className="ic" />
            {t('sxAddFiles')}
          </button>
          <span className="grow" />
          {!note && (
            <label className="row small sub" style={{ gap: 6 }}>
              {t('sxAfterReply')}
              <select className="select sx-auto" value={status} onChange={e => setStatus(e.target.value)} disabled={blocked} data-testid="tk-reply-status">
                <option value="awaiting_player">{t('sxAfterWait')}</option>
                <option value="resolved">{t('sxAfterResolve')}</option>
                <option value="closed">{t('sxAfterClose')}</option>
              </select>
            </label>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !body.trim() || blocked} onClick={send} data-testid="tk-reply-send">
            {busy ? <Spinner /> : note ? <LockSimple className="ic" /> : <PaperPlaneTilt className="ic" />}
            {note ? t('sxAddNote') : t('sxSendReply')}
          </button>
        </div>
      </div>
    </section>
  );
}

function TicketDetails(props: { d: TicketDetail }) {
  const tk = props.d.ticket;
  const agents = useAgents();
  const depts = useDepts();
  const now = useSupNow();
  const assign = (p: { assigneeId?: bigint; departmentId?: bigint; priority?: string }) =>
    runToast(c => c.reducers.adminSupportAssign({ ticketId: tk.id, assigneeId: p.assigneeId ?? tk.assigneeId, departmentId: p.departmentId ?? 0n, priority: p.priority ?? '' }), t('saved'));
  return (
    <div className="stack">
      <Field label={t('sxAssignee')}>
        <select className="select" value={String(tk.assigneeId)} onChange={e => assign({ assigneeId: BigInt(e.target.value) })} data-testid="tk-assignee">
          <option value="0">{t('sxNobody')}</option>
          {tk.assigneeId > 0n && !agents.list.some(a => a.accountId === tk.assigneeId) && <option value={String(tk.assigneeId)}>{pname(props.d.assigneeName, tk.assigneeId)}</option>}
          {agents.list.map(a => (
            <option key={String(a.accountId)} value={String(a.accountId)}>
              {pname(a.name, a.accountId)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('sxDepartment')}>
        <select className="select" value={String(tk.departmentId)} onChange={e => assign({ departmentId: BigInt(e.target.value) })} data-testid="tk-dept">
          {depts.list.map(d => (
            <option key={String(d.id)} value={String(d.id)}>
              {depts.name(d.id)}
              {d.isActive ? '' : ` (${t('inactive')})`}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('sxPriority')}>
        <Choice value={tk.priority} onChange={v => assign({ priority: v })} options={SX_PRIORITY} testId="tk-priority" label={t('sxPriority')} />
      </Field>
      <dl className="kv">
        <dt>{t('sxDue')}</dt>
        <dd>{tk.dueAt ? <Due dueAt={tk.dueAt} overdue={props.d.overdue} now={now} /> : '—'}</dd>
        <dt>{t('sxFirstResponse')}</dt>
        <dd>{tk.firstResponseAt ? us(tk.firstResponseAt) : <span className="muted">{t('sxNoResponse')}</span>}</dd>
        <dt>{t('sxSource')}</dt>
        <dd>{SOURCES[tk.source] ? t(SOURCES[tk.source]) : tk.source}</dd>
        <dt>{t('sxCreatedAt')}</dt>
        <dd>{us(tk.createdAt)}</dd>
        <dt>{t('sxUpdated')}</dt>
        <dd>{us(tk.updatedAt)}</dd>
        {tk.resolvedAt > 0n && (
          <>
            <dt>{t('sxResolvedAt')}</dt>
            <dd>{us(tk.resolvedAt)}</dd>
          </>
        )}
        {tk.closedAt > 0n && (
          <>
            <dt>{t('sxClosedAt')}</dt>
            <dd>{us(tk.closedAt)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function Stars(props: { n: number; testId?: string }) {
  return (
    <span className="row sx-stars" style={{ gap: 2 }} data-testid={props.testId} aria-label={t('sxRatingOf', { n: props.n })}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className="ic" weight={i <= props.n ? 'fill' : 'regular'} data-on={i <= props.n} />
      ))}
    </span>
  );
}

function PlayerPanel(props: { d: TicketDetail }) {
  const { can } = useSession();
  const tk = props.d.ticket;
  return (
    <div className="stack">
      <div className="player-head">
        <span className="player-avatar">
          <UserCircle className="ic" />
        </span>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <b data-testid="tk-player-name" dir="auto">
            {pname(props.d.playerName, tk.accountId)}
          </b>
          <span className="small muted">#{digits(String(tk.accountId))}</span>
        </div>
      </div>
      <dl className="stat-row sx-two" style={{ margin: 0 }}>
        <div className="stat">
          <dt>{t('sxPlayerTickets')}</dt>
          <dd data-testid="tk-player-total">{num(props.d.playerTickets)}</dd>
        </div>
        <div className="stat">
          <dt>{t('sxPlayerOpen')}</dt>
          <dd data-testid="tk-player-open">{num(props.d.playerOpenTickets)}</dd>
        </div>
      </dl>
      <div className="row row-wrap" style={{ gap: 6 }}>
        <a className="btn btn-sm" href={`#/tickets?status=all&player=${tk.accountId}`} data-testid="tk-player-tickets">
          <TicketIc className="ic" />
          {t('sxAllTickets')}
        </a>
        <a className="btn btn-sm" href={`#/activity?player=${tk.accountId}`} data-testid="tk-player-activity">
          <ClockClockwise className="ic" />
          {t('sxActivityLink')}
        </a>
        {can('operator') && (
          <a className="btn btn-sm" href={`#/player?id=${tk.accountId}`}>
            <UserCircle className="ic" />
            {t('sxPlayerPage')}
          </a>
        )}
      </div>
    </div>
  );
}

function TicketSkeleton() {
  return (
    <main className="page" data-testid="page-ticket">
      <div className="page-head">
        <div className="grow stack stack-sm">
          <Skel w={260} h={18} />
          <Skel w={200} h={10} />
        </div>
        <Skel w={120} h={32} r={6} />
      </div>
      <div className="split">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <Skel w={90} h={12} />
            </div>
            <div className="card-pad sx-thread">
              {[0, 1, 2].map(i => (
                <div key={i} className={`sx-msg ${i % 2 ? 'from-staff' : 'from-player'}`} style={{ width: '60%' }}>
                  <Skel w="40%" h={10} />
                  <Skel h={10} style={{ marginTop: 8 }} />
                  <Skel w="70%" h={10} style={{ marginTop: 6 }} />
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card-pad stack">
              <Skel h={110} r={6} />
              <Skel w={120} h={32} r={6} style={{ alignSelf: 'flex-end' }} />
            </div>
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-pad stack">
              {[0, 1, 2].map(i => (
                <div className="field" key={i}>
                  <Skel w={80} h={10} />
                  <Skel h={36} r={6} />
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card-pad stack">
              <Skel w={160} h={14} />
              <Skel h={56} r={6} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export function TicketPage() {
  useLocale();
  const route = useRoute();
  const raw = latin(route.query.get('id') ?? '');
  const id = /^\d+$/.test(raw) ? BigInt(raw) : 0n;
  const thread = useRows('adminTicketThread')
    .filter(m => m.ticketId === id)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const { data, error } = useFetch(() => getConn().procedures.adminTicket({ ticketId: id }), [String(id), thread.length]);
  useEffect(() => {
    if (!id) return;
    quiet(c => c.reducers.adminSupportFocus({ ticketId: id, chatId: 0n }));
    return () => quiet(c => c.reducers.adminSupportFocus({ ticketId: 0n, chatId: 0n }));
  }, [String(id)]);
  if (error)
    return (
      <main className="page" data-testid="page-ticket">
        <PageHead title={t('navTicket')} />
        <ErrBox text={errorText(error)} />
        <a className="btn btn-outline" style={{ alignSelf: 'flex-start' }} href="#/tickets">
          {t('sxBack')}
        </a>
      </main>
    );
  if (!data || data.ticket.id !== id) return <TicketSkeleton />;
  const tk = data.ticket;
  const msgs: Msg[] = thread.length ? thread : data.messages;
  const rtl = getLocale() === 'fa';
  return (
    <main className="page" data-testid="page-ticket">
      <div className="page-head sx-ticket-head">
        <div className="grow">
          <div className="page-title" dir="auto">
            {tk.subject}
          </div>
          <div className="page-sub row row-wrap" style={{ gap: 6 }}>
            <span className="mono" data-testid="tk-number">
              {digits(tk.number)}
            </span>
            <span data-testid="tk-status">{ticketBadge(tk.status)}</span>
            {priorityBadge(tk.priority)}
            {data.overdue && (
              <span className="badge b-bad">
                <Warning className="ic" />
                {t('sxOverdue')}
              </span>
            )}
            <span>{t('sxOpenedAt', { when: us(tk.createdAt) })}</span>
          </div>
        </div>
        <div className="row row-wrap" style={{ gap: 6 }}>
          <a className="btn btn-outline" href="#/tickets" data-testid="tk-back">
            {rtl ? <ArrowRight className="ic" /> : <ArrowLeft className="ic" />}
            {t('sxBack')}
          </a>
          <TakeButton tk={tk} testId="tk-take" />
          <QuickStatus tk={tk} testId="tk-move" />
        </div>
      </div>
      <div className="split">
        <div className="stack">
          <Section title={t('sxConversation')} testId="tk-thread" action={<span className="small muted">{t('sxMessagesN', { n: num(tk.messageCount) })}</span>}>
            <Thread msgs={msgs} playerName={data.playerName} accountId={tk.accountId} />
          </Section>
          <ReplyBox tk={tk} />
        </div>
        <div className="stack">
          <Section title={t('sxDetails')} testId="tk-details">
            <TicketDetails d={data} />
          </Section>
          <Section title={t('sxPlayer')} testId="tk-player">
            <PlayerPanel d={data} />
          </Section>
          {tk.rating > 0 && (
            <Section title={t('sxRating')} testId="tk-rating">
              <div className="stack stack-sm">
                <div className="row" style={{ gap: 8 }}>
                  <Stars n={tk.rating} />
                  <span className="small">{t('sxRatingOf', { n: tk.rating })}</span>
                </div>
                {tk.ratingComment && (
                  <div className="note-item" dir="auto">
                    {tk.ratingComment}
                  </div>
                )}
                <span className="small muted">{us(tk.ratedAt)}</span>
              </div>
            </Section>
          )}
        </div>
      </div>
    </main>
  );
}

type ChatView = {
  id: bigint;
  accountId: bigint;
  playerName: string;
  status: string;
  topic: string;
  departmentId: bigint;
  agentId: bigint;
  agentName: string;
  lastSeq: number;
  agentReadSeq: number;
  playerReadSeq: number;
  playerTypingAt: bigint;
  playerSeenAt: bigint;
  lastMessageAt: bigint;
  createdAt: bigint;
  ticketId: bigint;
  rating: number;
  ratingComment: string;
  closedBy: string;
  closedAt: bigint;
};

function fromQueue(q: QueueRow): ChatView {
  return { ...q, ticketId: 0n, rating: 0, ratingComment: '', closedBy: '', closedAt: 0n };
}

function fromChat(c: ChatRow, playerName: string, agentName: string): ChatView {
  return { ...c, playerName, agentName };
}

const AWAY_KEY = 'stg.supportAway';

function useHeartbeat() {
  const [away, setAwayS] = useState(localStorage.getItem(AWAY_KEY) === '1');
  useEffect(() => {
    const beat = () => quiet(c => c.reducers.adminSupportHeartbeat({ away }));
    beat();
    const id = window.setInterval(beat, 30000);
    return () => window.clearInterval(id);
  }, [away]);
  return {
    away,
    setAway: (v: boolean) => {
      localStorage.setItem(AWAY_KEY, v ? '1' : '0');
      setAwayS(v);
    },
  };
}

function chatEventText(m: RowOf<'adminChatMessages'>, agentName: (id: bigint) => string) {
  if (m.event === 'accepted') return m.authorId ? t('sxCeAcceptedBy', { a: agentName(m.authorId) }) : t('sxCeAccepted');
  if (m.event === 'transferred') return m.body ? t('sxCeTransferredTo', { a: pname(m.body, 0n) }) : t('sxCeQueued');
  if (m.event === 'closed') return t('sxCeClosed');
  if (m.event === 'greeting') return t('sxCeGreeting');
  if (m.event === 'offline') return t('sxCeOffline');
  return m.event;
}

function TransferDialog(props: { chat: ChatView; onClose: () => void; nowMs: number }) {
  const { me } = useSession();
  const agents = useAgents();
  const list = agents.list.filter(a => a.accountId !== me?.id && agents.state(a, props.nowMs) === 'on');
  const move = async (to: bigint) => {
    if (await runToast(c => c.reducers.adminChatTransfer({ chatId: props.chat.id, toAgentId: to }), to ? t('sxTransferred') : t('sxReturned'))) props.onClose();
  };
  return (
    <Dialog title={t('sxTransferTitle')} width={460} onClose={props.onClose} testId="lc-transfer-dialog">
      <div className="stack">
        <span className="small sub">{t('sxTransferHint')}</span>
        <div className="card">
          {list.length === 0 ? (
            <Empty icon={<UsersThree className="ic" weight="duotone" />} title={t('sxNoAgentsOnline')} />
          ) : (
            <div className="list">
              {list.map(a => (
                <button type="button" className="list-row sx-pick" key={String(a.accountId)} onClick={() => move(a.accountId)} data-testid={`lc-transfer-${a.accountId}`}>
                  <span className="live-dot" />
                  <span className="list-main">
                    <span className="list-title">{pname(a.name, a.accountId)}</span>
                    <span className="list-sub">
                      {roleLabel(a.role)} · {t('sxLoad', { c: num(a.activeChats), t: num(a.openTickets) })}
                    </span>
                  </span>
                  <ArrowsLeftRight className="ic muted" />
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn btn-outline" onClick={() => move(0n)} data-testid="lc-transfer-queue">
          <Tray className="ic" />
          {t('sxBackToQueue')}
        </button>
      </div>
    </Dialog>
  );
}

function ChatPick(props: { c: ChatView; on: boolean; nowMs: number; meId: bigint; onClick: () => void; showAgent?: boolean }) {
  const c = props.c;
  const typing = c.status !== 'closed' && sinceMs(c.playerTypingAt, props.nowMs) < 5000;
  const online = c.status !== 'closed' && sinceMs(c.playerSeenAt, props.nowMs) < 30000;
  const unread = c.status === 'active' && c.agentId === props.meId ? c.lastSeq - c.agentReadSeq : 0;
  return (
    <button type="button" className="list-row sx-pick" aria-pressed={props.on} onClick={props.onClick} data-testid={`lc-chat-${c.id}`}>
      <span className={`live-dot ${online ? '' : 'sx-dot-off'}`} title={online ? t('sxPlayerOnline') : t('sxPlayerOffline')} />
      <span className="list-main">
        <span className="list-title" dir="auto">
          {pname(c.playerName, c.accountId)}
        </span>
        <span className="list-sub" dir="auto">
          {typing ? <span className="sx-typing-sub">{t('sxTypingShort')}</span> : c.topic || t('sxNoTopic')}
        </span>
      </span>
      <span className="stack" style={{ alignItems: 'flex-end', gap: 4, flex: 'none' }}>
        <span className="small muted nowrap">{clock(c.lastMessageAt || c.createdAt)}</span>
        {unread > 0 ? (
          <span className="badge b-info" data-testid={`lc-unread-${c.id}`}>
            {num(unread)}
          </span>
        ) : props.showAgent && c.agentId ? (
          <span className="small muted ellipsis" style={{ maxWidth: 90 }}>
            {pname(c.agentName, c.agentId)}
          </span>
        ) : c.status === 'closed' && c.rating ? (
          <Stars n={c.rating} />
        ) : null}
      </span>
    </button>
  );
}

function ChatPanel(props: { c: ChatView | undefined; meId: bigint; nowMs: number; onClosed: (c: ChatView, ticketId: bigint) => void }) {
  const c = props.c;
  const agents = useAgents();
  const all = useRows('adminChatMessages');
  const msgs = c ? all.filter(m => m.chatId === c.id).sort((a, b) => a.seq - b.seq) : [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const typed = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const read = useRef('');
  const mine = !!c && c.status === 'active' && c.agentId === props.meId;
  useEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [c?.id, msgs.length]);
  useEffect(() => {
    if (!c || !mine || c.lastSeq <= c.agentReadSeq) return;
    const k = `${c.id}:${c.lastSeq}`;
    if (read.current === k) return;
    read.current = k;
    quiet(x => x.reducers.adminChatRead({ chatId: c.id, seq: c.lastSeq }));
  }, [c?.id, c?.lastSeq, c?.agentReadSeq, mine]);
  useEffect(() => setText(''), [c?.id]);
  if (!c)
    return (
      <section className="card sx-chat-panel" data-testid="lc-panel">
        <Empty icon={<ChatsTeardrop className="ic" weight="duotone" />} title={t('sxPickChat')} text={t('sxPickChatHint')} />
      </section>
    );
  const chat = c;
  const typing = chat.status !== 'closed' && sinceMs(chat.playerTypingAt, props.nowMs) < 5000;
  const seen = sinceMs(chat.playerSeenAt, props.nowMs);
  const online = chat.status !== 'closed' && seen < 30000;
  async function take() {
    await runToast(x => x.reducers.adminChatTake({ chatId: chat.id }), t('sxChatTaken'));
  }
  async function close(toTicket: boolean) {
    if (!(await confirmAsk(toTicket ? t('sxCloseTicketConfirm') : t('sxCloseConfirm'), { ok: toTicket ? t('sxCloseToTicket') : t('sxCloseChat'), danger: !toTicket }))) return;
    const r = await run(x => x.procedures.adminChatClose({ chatId: chat.id, toTicket }));
    if (!r.ok) {
      toast('bad', errorText(r.err));
      return;
    }
    toast('ok', r.value.ticketId ? t('sxTicketMade', { n: digits(r.value.ticketNumber) }) : t('sxChatClosed'));
    props.onClosed(chat, r.value.ticketId);
  }
  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const ok = await runToast(x => x.reducers.adminChatSend({ chatId: chat.id, body }));
    setBusy(false);
    if (ok) setText('');
  }
  function onType(v: string) {
    setText(v);
    if (v && Date.now() - typed.current > 2000) {
      typed.current = Date.now();
      quiet(x => x.reducers.adminChatTyping({ chatId: chat.id }));
    }
  }
  const statusBadge =
    chat.status === 'waiting' ? (
      <span className="badge b-warn">{t('sxChWaiting')}</span>
    ) : chat.status === 'active' ? (
      <span className="badge b-ok">{mine ? t('sxChMine') : t('sxChWith', { a: pname(chat.agentName, chat.agentId) })}</span>
    ) : (
      <span className="badge">{t('sxChClosed')}</span>
    );
  return (
    <section className="card sx-chat-panel" data-testid="lc-panel" data-chat={String(chat.id)}>
      <div className="card-head sx-chat-head">
        <span className={`live-dot ${online ? '' : 'sx-dot-off'}`} />
        <div className="grow stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="row row-wrap" style={{ gap: 8 }}>
            <b data-testid="lc-player" dir="auto">
              {pname(chat.playerName, chat.accountId)}
            </b>
            <span data-testid="lc-status">{statusBadge}</span>
          </span>
          <span className="small muted ellipsis">
            {online ? t('sxPlayerOnline') : chat.playerSeenAt ? t('sxSeenAgo', { d: span(seen / 60000) }) : t('sxPlayerOffline')}
            {chat.topic ? ` · ${chat.topic}` : ''}
          </span>
        </div>
        <div className="row row-wrap" style={{ gap: 4 }}>
          {chat.status === 'waiting' && (
            <button type="button" className="btn btn-sm btn-primary" onClick={take} data-testid="lc-take">
              <HandGrabbing className="ic" />
              {t('sxTakeChat')}
            </button>
          )}
          {mine && (
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setTransfer(true)} data-testid="lc-transfer">
              <ArrowsLeftRight className="ic" />
              {t('sxTransfer')}
            </button>
          )}
          {(mine || chat.status === 'waiting') && (
            <>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => close(true)} data-testid="lc-close-ticket">
                <TicketIc className="ic" />
                {t('sxCloseToTicket')}
              </button>
              <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => close(false)} data-testid="lc-close">
                <X className="ic" />
                {t('sxCloseChat')}
              </button>
            </>
          )}
          {chat.ticketId > 0n && (
            <a className="btn btn-sm" href={`#/ticket?id=${chat.ticketId}`} data-testid="lc-ticket-link">
              <TicketIc className="ic" />
              {t('sxOpenTicket')}
            </a>
          )}
        </div>
      </div>
      <div className="sx-chat-scroll" ref={scroll} data-testid="lc-messages">
        <div className="sx-thread">
          {msgs.map(m =>
            m.authorType === 'system' ? (
              <div className="sx-event sx-event-col" key={String(m.id)} data-testid={`lc-ev-${m.seq}`}>
                <span className="row" style={{ gap: 6 }}>
                  <ChatCircleDots className="ic" />
                  {chatEventText(m, agents.name)}
                  <span aria-hidden="true">·</span>
                  <span className="nowrap">{clock(m.at)}</span>
                </span>
                {m.body && (m.event === 'greeting' || m.event === 'offline' || !m.event) && (
                  <span className="sx-event-body" dir="auto">
                    {m.body}
                  </span>
                )}
              </div>
            ) : (
              <div className={`sx-msg ${m.authorType === 'player' ? 'from-player' : 'from-staff'}`} key={String(m.id)} data-testid={`lc-msg-${m.seq}`}>
                <div className="sx-msg-head">
                  <b>{m.authorType === 'player' ? pname(chat.playerName, chat.accountId) : agents.name(m.authorId) || t('sxStaff')}</b>
                  <span className="grow" />
                  {m.authorType !== 'player' && m.seq <= chat.playerReadSeq && (
                    <span className="small muted nowrap" data-testid={`lc-read-${m.seq}`}>
                      {t('sxReadByPlayer')}
                    </span>
                  )}
                  <span className="nowrap">{clock(m.at)}</span>
                </div>
                <div className="sx-msg-body" dir="auto">
                  {m.body}
                </div>
              </div>
            )
          )}
          {msgs.length === 0 && <span className="small muted">{chat.status === 'closed' ? t('sxNoHistory') : t('loading')}</span>}
        </div>
      </div>
      <div className="sx-typing" aria-live="polite" data-testid="lc-typing">
        {typing ? (
          <>
            <span className="sx-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {t('sxPlayerTyping', { name: pname(chat.playerName, chat.accountId) })}
          </>
        ) : null}
      </div>
      {mine ? (
        <div className="sx-composer">
          <textarea
            className="textarea"
            rows={2}
            value={text}
            onChange={e => onType(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t('sxChatPh')}
            aria-label={t('sxChatPh')}
            data-testid="lc-input"
          />
          <div className="stack stack-sm">
            <CannedPick departmentId={chat.departmentId} onPick={v => onType(text.trim() ? `${text.trimEnd()} ${v}` : v)} testId="lc-canned" />
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={send} data-testid="lc-send">
              {busy ? <Spinner /> : <PaperPlaneTilt className="ic" />}
              {t('sxSend')}
            </button>
          </div>
        </div>
      ) : chat.status === 'waiting' ? (
        <div className="sx-composer">
          <Notice kind="plain" icon={<Hourglass className="ic" />} text={t('sxTakeHint')} />
        </div>
      ) : chat.status === 'closed' ? (
        <div className="sx-composer">
          <div className="stack stack-sm grow">
            <span className="small muted">
              {t('sxClosedBy', { by: chat.closedBy === 'player' ? t('sxByPlayer') : chat.closedBy === 'idle' ? t('sxByIdle') : t('sxByAgent') })}
              {chat.closedAt ? ` · ${us(chat.closedAt)}` : ''}
            </span>
            {chat.rating > 0 && (
              <span className="row" style={{ gap: 8 }} data-testid="lc-rating">
                <Stars n={chat.rating} />
                {chat.ratingComment && <span className="small">{chat.ratingComment}</span>}
              </span>
            )}
          </div>
        </div>
      ) : null}
      {transfer && <TransferDialog chat={chat} nowMs={props.nowMs} onClose={() => setTransfer(false)} />}
    </section>
  );
}

function AgentsCard(props: { nowMs: number }) {
  const agents = useAgents();
  const { me } = useSession();
  const rank = { on: 0, away: 1, off: 2 };
  const list = [...agents.list].sort((a, b) => rank[agents.state(a, props.nowMs)] - rank[agents.state(b, props.nowMs)]);
  const online = list.filter(a => agents.state(a, props.nowMs) === 'on').length;
  const label = { on: t('sxOnline'), away: t('sxAway'), off: t('sxOffline') };
  return (
    <Section
      title={t('sxAgents')}
      pad={false}
      testId="lc-agents"
      action={
        <span className="badge b-ok" data-testid="lc-agents-online">
          {t('sxOnlineN', { n: num(online) })}
        </span>
      }
    >
      {list.length === 0 ? (
        <Empty icon={<UsersThree className="ic" weight="duotone" />} title={t('sxNoAgents')} />
      ) : (
        <div className="list sx-agents">
          {list.map(a => {
            const s = agents.state(a, props.nowMs);
            return (
              <div className="list-row" key={String(a.accountId)} data-testid={`lc-agent-${a.accountId}`} data-state={s}>
                <span className={`live-dot ${s === 'away' ? 'off' : s === 'off' ? 'sx-dot-off' : ''}`} />
                <div className="list-main">
                  <span className="list-title">
                    {pname(a.name, a.accountId)}
                    {a.accountId === me?.id ? ` (${t('sxYou')})` : ''}
                  </span>
                  <span className="list-sub">
                    {label[s]} · {t('sxLoad', { c: num(a.activeChats), t: num(a.openTickets) })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export function LiveChat() {
  useLocale();
  const route = useRoute();
  const { me } = useSession();
  const meId = me?.id ?? 0n;
  const hb = useHeartbeat();
  const queue = useRows('adminChatQueue');
  const nowMs = useNow(1000);
  const tab = route.query.get('tab') ?? 'queue';
  const rawChat = latin(route.query.get('chat') ?? '');
  const chatId = /^\d+$/.test(rawChat) ? BigInt(rawChat) : 0n;
  const [closedPage, setClosedPage] = useState(1);
  const [snap, setSnap] = useState<ChatView | null>(null);
  const nav = (p: { tab?: string; chat?: bigint }) => pageQuery('live-chat', { tab: p.tab ?? tab, chat: p.chat === undefined ? (chatId ? String(chatId) : '') : p.chat ? String(p.chat) : '' });
  const closed = useFetch(() => (tab === 'closed' ? getConn().procedures.adminChats({ view: 'closed', accountId: 0n, page: closedPage, pageSize: 15 }) : Promise.resolve(undefined)), [tab, closedPage]);
  const views = queue.map(fromQueue);
  const byLast = (a: ChatView, b: ChatView) => (a.lastMessageAt > b.lastMessageAt ? -1 : 1);
  const waiting = views.filter(c => c.status === 'waiting').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const mine = views.filter(c => c.status === 'active' && c.agentId === meId).sort(byLast);
  const active = views.filter(c => c.status === 'active').sort(byLast);
  const live = views.find(c => c.id === chatId);
  const hist = closed.data?.rows.find(c => c.id === chatId);
  const snapFor = snap && snap.id === chatId ? snap : null;
  const sel: ChatView | undefined = live ?? (hist ? fromChat(hist, snapFor?.playerName ?? '', snapFor?.agentName ?? '') : snapFor ? { ...snapFor, status: 'closed' } : undefined);
  useEffect(() => {
    if (live && (!snap || snap.id !== live.id || snap.lastSeq !== live.lastSeq || snap.status !== live.status || snap.agentId !== live.agentId)) setSnap(live);
  }, [live, snap]);
  useEffect(() => {
    if (!chatId) return;
    quiet(c => c.reducers.adminSupportFocus({ ticketId: 0n, chatId }));
  }, [String(chatId)]);
  useEffect(() => () => quiet(c => c.reducers.adminSupportFocus({ ticketId: 0n, chatId: 0n })), []);
  const list = tab === 'mine' ? mine : tab === 'active' ? active : tab === 'closed' ? (closed.data?.rows ?? []).map(c => fromChat(c, c.id === snapFor?.id ? snapFor.playerName : '', '')) : waiting;
  const emptyText: Record<string, StrKey> = { queue: 'sxEmptyQueue', mine: 'sxEmptyMine', active: 'sxEmptyActive', closed: 'sxEmptyClosed' };
  return (
    <main className="page" data-testid="page-live-chat">
      <PageHead
        title={t('navLiveChat')}
        sub={t('sxChatSub', { w: num(waiting.length), a: num(mine.length) })}
        action={
          <div className="row sx-presence" data-testid="lc-presence">
            <span className={`live-dot ${hb.away ? 'off' : ''}`} />
            <SwitchRow checked={!hb.away} onChange={v => hb.setAway(!v)} label={hb.away ? t('sxAwayNow') : t('sxAvailable')} testId="lc-available" />
          </div>
        }
      />
      <div className={`sx-chat ${sel ? 'has-chat' : ''}`}>
        <div className="stack">
          <section className="card" data-testid="lc-list">
            <div className="card-head sx-tabs">
              <Seg
                value={tab}
                onChange={v => {
                  setClosedPage(1);
                  nav({ tab: v });
                }}
                label={t('navLiveChat')}
                options={[
                  { value: 'queue', label: `${t('sxTabQueue')} ${waiting.length ? digits(waiting.length) : ''}`.trim() },
                  { value: 'mine', label: `${t('sxTabMine')} ${mine.length ? digits(mine.length) : ''}`.trim() },
                  { value: 'active', label: t('sxTabActive') },
                  { value: 'closed', label: t('sxTabClosed') },
                ]}
              />
            </div>
            {tab === 'closed' && !closed.data ? (
              <div className="list">
                {[0, 1, 2].map(i => (
                  <div className="list-row" key={i}>
                    <Skel w={8} h={8} r={4} />
                    <div className="list-main stack stack-sm" style={{ gap: 6 }}>
                      <Skel w="50%" h={11} />
                      <Skel w="30%" h={9} />
                    </div>
                  </div>
                ))}
              </div>
            ) : list.length === 0 ? (
              <Empty icon={<ChatsTeardrop className="ic" weight="duotone" />} title={t(emptyText[tab] ?? 'sxEmptyQueue')} />
            ) : (
              <div className="list sx-chat-list">
                {list.map(c => (
                  <ChatPick key={String(c.id)} c={c} on={c.id === chatId} nowMs={nowMs} meId={meId} showAgent={tab === 'active'} onClick={() => nav({ chat: c.id })} />
                ))}
              </div>
            )}
            {tab === 'closed' && closed.data && closed.data.total > 15 && <Pager page={closedPage} pageSize={15} total={closed.data.total} onPage={setClosedPage} />}
          </section>
          <AgentsCard nowMs={nowMs} />
        </div>
        <ChatPanel
          c={sel}
          meId={meId}
          nowMs={nowMs}
          onClosed={(c, ticketId) => {
            setSnap({ ...c, status: 'closed', ticketId, closedBy: 'agent', closedAt: BigInt(Date.now()) * 1000n });
            setClosedPage(1);
            nav({ tab: 'closed', chat: c.id });
          }}
        />
      </div>
    </main>
  );
}

function AgentPicker(props: { value: bigint[]; onChange: (v: bigint[]) => void }) {
  const agents = useAgents();
  if (!agents.list.length) return <span className="small muted">{t('sxNoAgents')}</span>;
  return (
    <div className="chips" data-testid="dp-agents">
      {agents.list.map(a => (
        <button
          type="button"
          key={String(a.accountId)}
          className="chip chip-btn"
          aria-pressed={props.value.includes(a.accountId)}
          onClick={() => props.onChange(props.value.includes(a.accountId) ? props.value.filter(x => x !== a.accountId) : [...props.value, a.accountId])}
          data-testid={`dp-agent-${a.accountId}`}
        >
          <Headset className="ic" />
          {pname(a.name, a.accountId)}
          <span className="muted">{roleLabel(a.role)}</span>
        </button>
      ))}
    </div>
  );
}

function DeptDialog(props: { row?: DeptRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [hours, setHours] = useState(r?.firstResponseHours ?? 24);
  const [agentIds, setAgents] = useState<bigint[]>(r?.agentIds ?? []);
  const [autoAssign, setAuto] = useState(r?.autoAssign ?? false);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('sxDeptEdit') : t('sxDeptNew')}
      testId="dp-dialog"
      width={620}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() => getConn().reducers.adminSaveSupportDepartment({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, description, firstResponseHours: hours, agentIds, autoAssign, isActive, sort }))
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('description')} className="span-2" hint={t('sxDeptDescHint')}>
        <TrInputs value={description} onChange={setDescription} name="description" />
      </Field>
      <Field label={t('sxFirstResponseHours')} hint={t('sxFirstResponseHoursHint')}>
        <NumInput value={hours} onChange={setHours} name="firstResponseHours" />
      </Field>
      <span />
      <Field label={t('sxDeptAgents')} className="span-2" hint={t('sxDeptAgentsHint')}>
        <AgentPicker value={agentIds} onChange={setAgents} />
      </Field>
      <div className="span-2 stack stack-sm">
        <SwitchRow checked={autoAssign} onChange={setAuto} label={t('sxAutoAssign')} testId="dp-auto" />
        <span className="hint">{t('sxAutoAssignHint')}</span>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} testId="dp-active" />
      </div>
    </FormDialog>
  );
}

export function SupportDepartments() {
  useLocale();
  const depts = useDepts();
  const agents = useAgents();
  const loaded = useLoaded();
  const [edit, setEdit] = useState<DeptRow | 'new' | null>(null);
  return (
    <main className="page" data-testid="page-support-departments">
      <PageHead title={t('navSupportDepartments')} sub={t('sxDeptSub')} action={<AddButton label={t('sxDeptNew')} onClick={() => setEdit('new')} testId="dp-add" />} />
      <CatalogTable
        rows={depts.list}
        loaded={loaded}
        prefix="dp"
        keyOf={r => r.key}
        empty={{ icon: <Buildings className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('sxFirstResponse'), render: r => <span className="nowrap">{t('sxHoursN', { n: r.firstResponseHours })}</span> },
          {
            label: t('sxDeptAgents'),
            render: r =>
              r.agentIds.length ? (
                <span className="chips">
                  {r.agentIds.map(id => (
                    <span className="chip" key={String(id)}>
                      {agents.name(id)}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="small muted">{t('sxAllAgents')}</span>
              ),
          },
          { label: t('sxAutoAssign'), render: r => (r.autoAssign ? <span className="badge b-info">{t('sxAuto')}</span> : <span className="badge">{t('sxManual')}</span>) },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteSupportDepartment({ id: r.id }))}
      />
      {edit && <DeptDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

function CannedDialog(props: { row?: CannedRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const depts = useDepts();
  const [key, setKey] = useState(r?.key ?? '');
  const [title, setTitle] = useState<Tr[]>(r?.title ?? []);
  const [body, setBody] = useState<Tr[]>(r?.body ?? []);
  const [dept, setDept] = useState(String(r?.departmentId ?? 0n));
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('sxCannedEdit') : t('sxCannedNew')}
      testId="cr-dialog"
      width={640}
      onClose={props.onClose}
      submit={async () =>
        needTitle(title, def) ??
        (trMissingDefault(body, def) ? ({ ok: false, msg: t('trRequired', { lang: def }) } as const) : null) ??
        save(() => getConn().reducers.adminSaveSupportCanned({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), title, body, departmentId: BigInt(dept), isActive, sort }))
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('sxDepartment')} hint={t('sxCannedDeptHint')}>
        <select className="select" value={dept} onChange={e => setDept(e.target.value)} name="department" data-testid="cr-dept">
          <option value="0">{t('sxEveryDept')}</option>
          {depts.list.map(d => (
            <option key={String(d.id)} value={String(d.id)}>
              {depts.name(d.id)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('sxCannedTitle')} required className="span-2">
        <TrInputs value={title} onChange={setTitle} required name="title" />
      </Field>
      <Field label={t('sxCannedBody')} required className="span-2" hint={t('sxCannedBodyHint')}>
        <TrInputs value={body} onChange={setBody} required multiline name="body" />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} testId="cr-active" />
      </div>
    </FormDialog>
  );
}

export function CannedReplies() {
  useLocale();
  const list = useRows('adminSupportCanned');
  const depts = useDepts();
  const { def } = useLanguages();
  const loaded = useLoaded();
  const [dept, setDept] = useState('');
  const [edit, setEdit] = useState<CannedRow | 'new' | null>(null);
  const rows = [...list].filter(c => dept === '' || String(c.departmentId) === dept).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-canned-replies">
      <PageHead title={t('navCannedReplies')} sub={t('sxCannedSub')} action={<AddButton label={t('sxCannedNew')} onClick={() => setEdit('new')} testId="cr-add" />} />
      <div className="toolbar">
        <select className="select sx-auto" value={dept} onChange={e => setDept(e.target.value)} aria-label={t('sxDepartment')} data-testid="cr-f-dept">
          <option value="">{t('sxAnyDept')}</option>
          <option value="0">{t('sxEveryDept')}</option>
          {depts.list.map(d => (
            <option key={String(d.id)} value={String(d.id)}>
              {depts.name(d.id)}
            </option>
          ))}
        </select>
      </div>
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="cr"
        keyOf={r => r.key}
        empty={{ icon: <ChatText className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('sxCannedTitle'), render: r => <NameCell name={r.title} k={r.key} /> },
          { label: t('sxDepartment'), render: r => (r.departmentId ? depts.name(r.departmentId) : <span className="muted">{t('sxEveryDept')}</span>) },
          { label: t('sxCannedBody'), render: r => <span className="small sub cell-detail sx-clip">{trText(r.body, def)}</span> },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteSupportCanned({ id: r.id }))}
      />
      {edit && <CannedDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type SettingsArgs = Parameters<Conn['reducers']['adminSaveSupportSettings']>[0];
type NumKey =
  | 'maxOpenTickets'
  | 'ticketsPerHour'
  | 'messagesPerHour'
  | 'maxAttachments'
  | 'maxAttachmentKb'
  | 'autoCloseDays'
  | 'chatIdleMinutes'
  | 'chatMessagesPerMinute'
  | 'chatsPerHour'
  | 'agentOnlineSeconds'
  | 'activityRetentionDays';

const TICKET_FIELDS: [NumKey, StrKey, StrKey][] = [
  ['maxOpenTickets', 'sxSMaxOpen', 'sxSMaxOpenHint'],
  ['ticketsPerHour', 'sxSTicketsHour', 'sxSZeroOff'],
  ['messagesPerHour', 'sxSMessagesHour', 'sxSMessagesHourHint'],
  ['autoCloseDays', 'sxSAutoClose', 'sxSAutoCloseHint'],
  ['maxAttachments', 'sxSMaxFiles', 'sxSMaxFilesHint'],
  ['maxAttachmentKb', 'sxSMaxFileKb', 'sxSMaxFileKbHint'],
];

const CHAT_FIELDS: [NumKey, StrKey, StrKey][] = [
  ['chatIdleMinutes', 'sxSChatIdle', 'sxSChatIdleHint'],
  ['chatMessagesPerMinute', 'sxSChatRate', 'sxSZeroOff'],
  ['chatsPerHour', 'sxSChatsHour', 'sxSZeroOff'],
  ['agentOnlineSeconds', 'sxSAgentOnline', 'sxSAgentOnlineHint'],
];

function settingsArgs(s: RowOf<'adminSupportSettings'>): SettingsArgs {
  return {
    maxOpenTickets: s.maxOpenTickets,
    ticketsPerHour: s.ticketsPerHour,
    messagesPerHour: s.messagesPerHour,
    maxAttachments: s.maxAttachments,
    maxAttachmentKb: s.maxAttachmentKb,
    autoCloseDays: s.autoCloseDays,
    chatEnabled: s.chatEnabled,
    chatGreeting: s.chatGreeting,
    chatOffline: s.chatOffline,
    chatIdleMinutes: s.chatIdleMinutes,
    chatMessagesPerMinute: s.chatMessagesPerMinute,
    chatsPerHour: s.chatsPerHour,
    agentOnlineSeconds: s.agentOnlineSeconds,
    activityRetentionDays: s.activityRetentionDays,
    notifyCategoryKey: s.notifyCategoryKey,
  };
}

function SettingsSkel() {
  return (
    <div className="stack stack-lg">
      {[4, 4].map((n, j) => (
        <section className="card" key={j}>
          <div className="card-head">
            <Skel w={120} h={12} />
          </div>
          <div className="card-pad form-grid">
            {Array.from({ length: n }).map((_, i) => (
              <div className="field" key={i}>
                <Skel w={90} h={10} />
                <Skel h={36} r={6} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function SupportSettingsSection(props: { ro: boolean }) {
  useLocale();
  const s = useRows('adminSupportSettings')[0];
  const cats = useRows('notifyCategory');
  const { def } = useLanguages();
  const [v, setV] = useState<SettingsArgs | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (s && !v) setV(settingsArgs(s));
  }, [s, v]);
  if (!v || !s) return <SettingsSkel />;
  const up = (p: Partial<SettingsArgs>) => setV({ ...v, ...p });
  const nums = (list: [NumKey, StrKey, StrKey][]) =>
    list.map(([k, l, h]) => (
      <Field key={k} label={t(l)} hint={t(h)}>
        <NumInput value={v[k]} onChange={x => up({ [k]: Math.max(0, x) } as Partial<SettingsArgs>)} disabled={props.ro} name={k} />
      </Field>
    ));
  return (
    <div className="stack stack-lg" data-testid="sx-settings">
      <form
        className="stack stack-lg"
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          const r = await run(c => c.reducers.adminSaveSupportSettings(v), t('saved'));
          setBusy(false);
          setErr(r.ok ? null : errorText(r.err));
        }}
      >
        <Section title={t('sxSTickets')}>
          <div className="form-grid">
            {nums(TICKET_FIELDS)}
            <Field label={t('sxSNotify')} hint={t('sxSNotifyHint')}>
              <select className="select" value={v.notifyCategoryKey} onChange={e => up({ notifyCategoryKey: e.target.value })} disabled={props.ro} name="notifyCategoryKey" data-testid="sx-s-category">
                <option value="">{t('sxSNoNotify')}</option>
                {[...cats]
                  .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
                  .map(c => (
                    <option key={c.key} value={c.key}>
                      {trText(c.name, def) || c.key}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        </Section>
        <Section title={t('sxSChat')}>
          <div className="stack">
            <SwitchRow checked={v.chatEnabled} onChange={x => up({ chatEnabled: x })} disabled={props.ro} label={t('sxSChatOn')} testId="sx-s-chat" />
            <div className="form-grid">
              {nums(CHAT_FIELDS)}
              <Field label={t('sxSGreeting')} className="span-2" hint={t('sxSGreetingHint')}>
                <TrInputs value={v.chatGreeting} onChange={x => up({ chatGreeting: x })} disabled={props.ro} multiline name="chatGreeting" />
              </Field>
              <Field label={t('sxSOffline')} className="span-2" hint={t('sxSOfflineHint')}>
                <TrInputs value={v.chatOffline} onChange={x => up({ chatOffline: x })} disabled={props.ro} multiline name="chatOffline" />
              </Field>
            </div>
          </div>
        </Section>
        <Section title={t('sxSActivity')}>
          <div className="form-grid">
            <Field label={t('sxSRetention')} hint={t('sxSRetentionHint')}>
              <NumInput value={v.activityRetentionDays} onChange={x => up({ activityRetentionDays: Math.max(0, x) })} disabled={props.ro} name="activityRetentionDays" />
            </Field>
          </div>
        </Section>
        {props.ro ? (
          <Notice kind="plain" text={t('sxSReadOnly')} />
        ) : (
          <>
            <ErrBox text={err} />
            <div className="form-actions">
              <SaveButton busy={busy} testId="sx-s-save" />
            </div>
          </>
        )}
      </form>
      {!props.ro && (
        <Notice
          icon={<Lightning className="ic" />}
          title={t('sxSRunTitle')}
          text={t('sxSRunHint')}
          action={
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={running}
              data-testid="sx-s-run"
              onClick={async () => {
                setRunning(true);
                const r = await run(c => c.procedures.adminSupportRun({}));
                setRunning(false);
                if (r.ok) toast('ok', t('sxSRunDone', { t: r.value.ticketsClosed, c: r.value.chatsClosed, a: r.value.activityRemoved }));
                else toast('bad', errorText(r.err));
              }}
            >
              {running && <Spinner />}
              {t('sxSRun')}
            </button>
          }
        />
      )}
      {!props.ro && <TestClock value={s.clockOffsetSec} testId="sx-s-clock" save={sec => Promise.resolve().then(() => getConn().reducers.adminSetSupportClockOffset({ seconds: sec }))} />}
    </div>
  );
}

const KINDS: [string, StrKey, string][] = [
  ['login', 'sxKLogin', 'b-info'],
  ['purchase', 'sxKPurchase', 'b-ok'],
  ['level', 'sxKLevel', 'b-violet'],
  ['achievement', 'sxKAchievement', 'b-violet'],
  ['task', 'sxKTask', 'b-violet'],
  ['restriction', 'sxKRestriction', 'b-bad'],
  ['gift', 'sxKGift', 'b-teal'],
  ['ticket', 'sxKTicket', 'b-warn'],
  ['chat', 'sxKChat', 'b-warn'],
  ['referral', 'sxKReferral', 'b-teal'],
  ['config', 'sxKConfig', ''],
  ['friend', 'sxKFriend', 'b-info'],
  ['prize', 'sxKPrize', 'b-ok'],
];

const ACTS: [string, StrKey][] = [
  ['login', 'sxALogin'],
  ['signup', 'sxASignup'],
  ['completed', 'sxACompleted'],
  ['level_up', 'sxALevelUp'],
  ['achievement_unlocked', 'sxAAchievement'],
  ['task_completed', 'sxATask'],
  ['warn', 'kindWarn'],
  ['mute', 'kindMute'],
  ['suspend', 'kindSuspend'],
  ['lifted', 'sxALifted'],
  ['redeemed', 'sxARedeemed'],
  ['created', 'sxACreated'],
  ['resolved', 'sxAResolved'],
  ['closed', 'sxAClosed'],
  ['auto_closed', 'sxAAutoClosed'],
  ['opened', 'sxAOpened'],
  ['entered', 'sxAEntered'],
  ['joined', 'sxAJoined'],
  ['approved', 'sxAApproved'],
  ['rejected', 'sxARejected'],
  ['changed', 'sxAChanged'],
  ['requested', 'sxARequested'],
  ['accepted', 'sxAAccepted'],
  ['removed', 'sxARemoved'],
  ['blocked', 'sxABlocked'],
  ['gift_sent', 'sxAGiftSent'],
  ['gift_received', 'sxAGiftReceived'],
  ['gift_returned', 'sxAGiftReturned'],
  ['gift_reversed', 'sxAGiftReversed'],
];

const PLATFORMS: [string, StrKey][] = [
  ['android', 'sxPAndroid'],
  ['ios', 'sxPIos'],
  ['web', 'sxPWeb'],
  ['windows', 'sxPWindows'],
  ['macos', 'sxPMacos'],
  ['linux', 'sxPLinux'],
];

const DATA_KEYS: Record<string, StrKey> = {
  number: 'sxDNumber',
  source: 'sxDSource',
  value: 'sxDValue',
  productId: 'sxDProduct',
  method: 'sxDMethod',
  toman: 'sxDToman',
  until: 'sxDUntil',
  kind: 'sxDKind',
  code: 'sxDCode',
  topic: 'sxDTopic',
  by: 'sxDBy',
  changed: 'sxDChanged',
  prizeId: 'sxDPrize',
  from: 'sxDFrom',
  to: 'sxDTo',
  returnTo: 'sxDReturnTo',
};

function kindText(k: string) {
  const x = KINDS.find(y => y[0] === k);
  return x ? t(x[1]) : k;
}

function KindTag(props: { kind: string }) {
  const x = KINDS.find(y => y[0] === props.kind);
  return <span className={`badge ${x?.[2] ?? ''}`}>{x ? t(x[1]) : props.kind}</span>;
}

function actText(kind: string, action: string) {
  if (kind === 'restriction' && action !== 'lifted') return kindLabelR(action);
  const k = ACTS.find(x => x[0] === action)?.[1];
  return k ? t(k) : action;
}

function platformText(p: string) {
  const k = PLATFORMS.find(x => x[0] === p)?.[1];
  return k ? t(k) : p;
}

function useActorText() {
  const agents = useAgents();
  return (a: string) => {
    if (a === 'player') return t('sxActorPlayer');
    if (a === 'system') return t('sxActorSystem');
    if (a === 'admin') return t('sxActorAdmin');
    const m = a.match(/^admin:(\d+)$/);
    if (m) return agents.list.some(x => String(x.accountId) === m[1]) ? agents.name(BigInt(m[1])) : t('sxActorStaff', { id: digits(m[1]) });
    return a;
  };
}

function dataValue(k: string, v: unknown): string {
  if (Array.isArray(v)) return v.map(x => String(x)).join('، ');
  const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  if (k === 'until' && /^\d{13,}$/.test(s)) return us(BigInt(s));
  if (k === 'kind') return kindLabelR(s);
  if (k === 'source') return SOURCES[s] ? t(SOURCES[s]) : s;
  if (k === 'by') return s === 'player' ? t('sxByPlayer') : s === 'idle' ? t('sxByIdle') : s === 'agent' ? t('sxByAgent') : s;
  if (/^\d+$/.test(s)) return num(BigInt(s));
  return digits(s);
}

function DataCell(props: { data: string }) {
  let obj: Record<string, unknown> | null = null;
  try {
    const p = JSON.parse(props.data);
    if (p && typeof p === 'object' && !Array.isArray(p)) obj = p as Record<string, unknown>;
  } catch {
    obj = null;
  }
  if (!obj) return props.data ? <span className="small mono">{props.data}</span> : <span className="muted small">—</span>;
  const entries = Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined);
  if (!entries.length) return <span className="muted small">—</span>;
  return (
    <span className="chips">
      {entries.map(([k, v]) => (
        <span className="chip sx-data" key={k}>
          <span className="muted">{DATA_KEYS[k] ? t(DATA_KEYS[k]) : k}</span>
          <span>{dataValue(k, v)}</span>
        </span>
      ))}
    </span>
  );
}

function useCountryName() {
  const list = useRows('country');
  const { def } = useLanguages();
  return (code: string) => (code ? trText(list.find(c => c.code === code)?.name, def) || code : '');
}

export function Activity() {
  useLocale();
  const route = useRoute();
  const q = route.query;
  const actor = useActorText();
  const country = useCountryName();
  const { can } = useSession();
  const f = {
    player: q.get('player') ?? '',
    kinds: (q.get('kinds') ?? '').split(',').filter(Boolean),
    action: q.get('action') ?? '',
    country: q.get('country') ?? '',
    platform: q.get('platform') ?? '',
    from: q.get('from') ?? '',
    to: q.get('to') ?? '',
    q: q.get('q') ?? '',
  };
  const [page, setPage] = useState(1);
  const set = (p: Partial<typeof f>) => {
    setPage(1);
    const n = { ...f, ...p };
    pageQuery('activity', { player: n.player, kinds: n.kinds.join(','), action: n.action, country: n.country, platform: n.platform, from: n.from, to: n.to, q: n.q });
  };
  const dPlayer = useDebounced(f.player, 300);
  const dq = useDebounced(f.q, 300);
  const dCountry = useDebounced(f.country, 300);
  const accountId = playerIdOf(dPlayer);
  const summary = useFetch(() => getConn().procedures.adminActivitySummary({}), []);
  const { data, error, loading } = useFetch(
    () =>
      getConn().procedures.adminActivity({
        accountId,
        kinds: f.kinds,
        action: f.action,
        country: latin(dCountry).trim().toUpperCase(),
        platform: f.platform,
        from: microsFromInput(f.from),
        to: microsFromInput(f.to),
        q: latin(dq).trim(),
        page,
        pageSize: PAGE,
      }),
    [String(accountId), f.kinds.join(','), f.action, dCountry, f.platform, f.from, f.to, dq, page]
  );
  const rows = data?.rows ?? [];
  const s = summary.data;
  const kindCounts = new Map((s?.kinds ?? []).map(k => [k.kind, k]));
  const kindList = [...KINDS.map(k => k[0]), ...(s?.kinds ?? []).map(k => k.kind).filter(k => !KINDS.some(x => x[0] === k))];
  const toggleKind = (k: string) => set({ kinds: f.kinds.includes(k) ? f.kinds.filter(x => x !== k) : [...f.kinds, k] });
  const filtered = !!(f.player || f.kinds.length || f.action || f.country || f.platform || f.from || f.to || f.q);
  const playerCell = (r: ActRow) =>
    can('operator') ? (
      <a className="row-link" href={`#/player?id=${r.accountId}`}>
        #{digits(String(r.accountId))}
      </a>
    ) : (
      <button type="button" className="btn btn-sm sx-link" onClick={() => set({ player: String(r.accountId) })} title={t('sxOnlyThisPlayer')}>
        #{digits(String(r.accountId))}
      </button>
    );
  return (
    <main className="page" data-testid="page-activity">
      <PageHead title={t('navActivity')} sub={t('sxActSub')} />
      <dl className="stat-row grid-4" style={{ margin: 0 }} data-testid="act-summary">
        {(
          [
            ['sxActTotal', s ? num(s.total) : null],
            ['sxActToday', s ? num(s.today) : null],
            ['sxActPlayers', s ? num(s.players) : null],
            ['sxActRetention', s ? (s.retentionDays ? t('sxDays', { n: s.retentionDays }) : t('sxKeepForever')) : null],
          ] as [StrKey, string | null][]
        ).map(([k, v]) => (
          <div className="stat" key={k}>
            <dt>{t(k)}</dt>
            <dd data-testid={`act-${k}`}>{v ?? <Skel w={40} h={16} />}</dd>
          </div>
        ))}
      </dl>
      <div className="chips" data-testid="act-kinds">
        {kindList.map(k => {
          const c = kindCounts.get(k);
          return (
            <button type="button" key={k} className="chip chip-btn" aria-pressed={f.kinds.includes(k)} onClick={() => toggleKind(k)} data-testid={`act-kind-${k}`}>
              {kindText(k)}
              <span className="muted">{num(c?.total ?? 0)}</span>
            </button>
          );
        })}
      </div>
      <div className="toolbar">
        <div className="input-affix search" style={{ width: 150 }}>
          <UserCircle className="ic" />
          <input className="input" value={digits(f.player)} onChange={e => set({ player: latin(e.target.value) })} placeholder={t('elPlayer')} aria-label={t('elPlayer')} inputMode="numeric" data-testid="act-player" />
        </div>
        <select className="select sx-auto" value={f.action} onChange={e => set({ action: e.target.value })} aria-label={t('sxAction')} data-testid="act-action">
          <option value="">{t('sxAnyAction')}</option>
          {ACTS.map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
        </select>
        <select className="select sx-auto" value={f.platform} onChange={e => set({ platform: e.target.value })} aria-label={t('sxPlatform')} data-testid="act-platform">
          <option value="">{t('sxAnyPlatform')}</option>
          {PLATFORMS.map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
        </select>
        <input
          className="input ltr sx-country"
          value={f.country}
          onChange={e => set({ country: e.target.value })}
          placeholder="IR"
          aria-label={t('sxCountry')}
          title={t('sxCountry')}
          maxLength={2}
          data-testid="act-country"
        />
        <label className="row small sub" style={{ gap: 6 }}>
          {t('from')}
          <input type="datetime-local" className="input ltr sx-auto" value={f.from} onChange={e => set({ from: e.target.value })} data-testid="act-from" />
        </label>
        <label className="row small sub" style={{ gap: 6 }}>
          {t('until')}
          <input type="datetime-local" className="input ltr sx-auto" value={f.to} onChange={e => set({ to: e.target.value })} data-testid="act-to" />
        </label>
        <div className="input-affix search" style={{ width: 200 }}>
          <MagnifyingGlass className="ic" />
          <input className="input" value={f.q} onChange={e => set({ q: e.target.value })} placeholder={t('sxActSearch')} aria-label={t('sxActSearch')} data-testid="act-q" />
        </div>
        {filtered && (
          <button type="button" className="btn btn-sm" onClick={() => pageQuery('activity', {})} data-testid="act-clear">
            <X className="ic" />
            {t('sxClearFilters')}
          </button>
        )}
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="act-table">
          <thead>
            <tr>
              <th>{t('auColTime')}</th>
              <th>{t('pyColPlayer')}</th>
              <th>{t('sxEvent')}</th>
              <th>{t('sxDetailsCol')}</th>
              <th>{t('sxActor')}</th>
              <th>{t('sxWhere')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty icon={<ClockClockwise className="ic" weight="duotone" />} title={t('sxActEmpty')} text={filtered ? t('sxActEmptyHint') : undefined} />
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={String(r.id)} data-testid={`act-row-${r.id}`}>
                  <td className="nowrap small">{us(r.at)}</td>
                  <td>{playerCell(r)}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <KindTag kind={r.kind} />
                      <span>{actText(r.kind, r.action)}</span>
                    </span>
                  </td>
                  <td>
                    <DataCell data={r.data} />
                  </td>
                  <td className="small">{actor(r.actor)}</td>
                  <td className="small">{[platformText(r.platform), country(r.country)].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards" data-testid="act-cards">
          {data && rows.length === 0 && <Empty icon={<ClockClockwise className="ic" weight="duotone" />} title={t('sxActEmpty')} />}
          {rows.map(r => (
            <div className="pcard" key={String(r.id)}>
              <div className="row">
                <KindTag kind={r.kind} />
                <b className="grow">{actText(r.kind, r.action)}</b>
              </div>
              <DataCell data={r.data} />
              <div className="pcard-meta">
                <span>{t('pyColPlayer')}</span>
                <span>#{digits(String(r.accountId))}</span>
                <span>{t('auColTime')}</span>
                <span>{us(r.at)}</span>
                <span>{t('sxActor')}</span>
                <span>{actor(r.actor)}</span>
              </div>
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}

export function PlayerActivityCard(props: { accountId: bigint }) {
  useLocale();
  const actor = useActorText();
  const { data } = useFetch(
    () => getConn().procedures.adminActivity({ accountId: props.accountId, kinds: [], action: '', country: '', platform: '', from: 0n, to: 0n, q: '', page: 1, pageSize: 6 }),
    [String(props.accountId)]
  );
  return (
    <Section
      title={t('sxActCard')}
      pad={false}
      testId="pd-activity"
      action={
        <a className="btn btn-sm" href={`#/activity?player=${props.accountId}`} data-testid="pa-all">
          <ClockClockwise className="ic" />
          {data ? t('sxActAllN', { n: num(data.total) }) : t('sxActAll')}
        </a>
      }
    >
      {!data ? (
        <div className="list">
          {[0, 1, 2].map(i => (
            <div className="list-row" key={i}>
              <Skel w={56} h={22} r={6} />
              <div className="list-main stack stack-sm" style={{ gap: 6 }}>
                <Skel w="40%" h={11} />
                <Skel w="25%" h={9} />
              </div>
            </div>
          ))}
        </div>
      ) : data.rows.length === 0 ? (
        <Empty icon={<ClockClockwise className="ic" weight="duotone" />} title={t('sxActEmpty')} />
      ) : (
        <div className="list" data-testid="pa-list">
          {data.rows.map(r => (
            <div className="list-row" key={String(r.id)} data-testid={`pa-row-${r.id}`}>
              <KindTag kind={r.kind} />
              <div className="list-main">
                <span className="list-title">{actText(r.kind, r.action)}</span>
                <span className="list-sub">
                  {us(r.at)} · {actor(r.actor)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

type Tile = { key: string; label: string; value: string; icon: ReactNode; tint: string; go: () => void };

export function SupportSummary() {
  useLocale();
  const tick = useNow(30000);
  const { data, error } = useFetch(() => getConn().procedures.adminSupportSummary({}), [tick]);
  const d = data;
  const tiles: Tile[] = d
    ? [
        { key: 'awaiting', label: t('sxSumAwaiting'), value: num(d.awaitingStaff), icon: <Headset className="ic" weight="duotone" />, tint: d.awaitingStaff ? 'b-warn' : 'b-ok', go: () => go('tickets?status=waiting') },
        {
          key: 'overdue',
          label: t('sxSumOverdue'),
          value: num(d.overdue),
          icon: <Warning className="ic" weight="duotone" />,
          tint: d.overdue ? 'b-bad' : 'b-ok',
          go: () => go('tickets?status=waiting&overdue=1&sort=due'),
        },
        { key: 'unassigned', label: t('sxSumUnassigned'), value: num(d.unassigned), icon: <Tray className="ic" weight="duotone" />, tint: 'b-info', go: () => go('tickets?assignee=none') },
        { key: 'mine', label: t('sxSumMine'), value: num(d.mine), icon: <TicketIc className="ic" weight="duotone" />, tint: 'b-violet', go: () => go('tickets?assignee=me') },
        {
          key: 'waitingChats',
          label: t('sxSumWaitingChats'),
          value: num(d.waitingChats),
          icon: <Hourglass className="ic" weight="duotone" />,
          tint: d.waitingChats ? 'b-warn' : 'b-ok',
          go: () => go('live-chat?tab=queue'),
        },
        { key: 'myChats', label: t('sxSumMyChats'), value: num(d.myChats), icon: <ChatsTeardrop className="ic" weight="duotone" />, tint: 'b-teal', go: () => go('live-chat?tab=mine') },
        { key: 'activeChats', label: t('sxSumActiveChats'), value: num(d.activeChats), icon: <ChatCircleDots className="ic" weight="duotone" />, tint: 'b-info', go: () => go('live-chat?tab=active') },
        { key: 'agents', label: t('sxSumAgents'), value: num(d.agentsOnline), icon: <UsersThree className="ic" weight="duotone" />, tint: 'b-ok', go: () => go('live-chat') },
        {
          key: 'firstResponse',
          label: t('sxSumFirstResponse'),
          value: d.avgFirstResponseMinutes > 0 ? span(d.avgFirstResponseMinutes) : '—',
          icon: <Timer className="ic" weight="duotone" />,
          tint: '',
          go: () => go('tickets?status=all'),
        },
        {
          key: 'rating',
          label: d.rated ? t('sxSumRatingN', { n: num(d.rated) }) : t('sxSumRating'),
          value: d.rated ? t('sxOutOf5', { r: fmtNum(Math.round(d.avgRating * 10) / 10).replace('.', getLocale() === 'fa' ? '٫' : '.') }) : '—',
          icon: <Star className="ic" weight="duotone" />,
          tint: 'b-warn',
          go: () => go('tickets?status=resolved'),
        },
      ]
    : [];
  return (
    <div className="stack" data-testid="support-summary">
      <ErrBox text={error ? errorText(error) : null} />
      {d && d.clockOffsetSec !== 0n && <Notice kind="warn" text={t('sxClockOn')} />}
      <div className="tiles" data-testid="sx-tiles">
        {!d
          ? Array.from({ length: 10 }).map((_, i) => (
              <div className="tile" key={i} style={{ cursor: 'default' }}>
                <Skel w={40} h={40} r={8} style={{ gridRow: '1 / span 2' }} />
                <Skel w="55%" h={10} />
                <Skel w="35%" h={18} style={{ marginTop: 6 }} />
              </div>
            ))
          : tiles.map(x => (
              <button type="button" key={x.key} className="tile" onClick={x.go} data-testid={`sx-tile-${x.key}`}>
                <span className={`tile-ic badge ${x.tint}`} style={{ height: 40, padding: 0, justifyContent: 'center' }}>
                  {x.icon}
                </span>
                <span className="tile-label">{x.label}</span>
                <span className="tile-value">{x.value}</span>
              </button>
            ))}
      </div>
    </div>
  );
}
