import { useState } from 'react';
import { ArrowClockwise, ArrowLeft, ArrowRight, Coins, Eye, GameController, MagnifyingGlass, PencilSimple, Plus, Prohibit, Ranking, Robot, Sword, Trash, Trophy } from '@phosphor-icons/react';
import { getConn, useRows } from './conn.ts';
import { codeText, date, digits, errorText, getLocale, latin, num, t, useLocale, type StrKey } from './i18n.ts';
import { pageQuery, run, runToast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, NumInput, Pager, Seg, Skel, SwitchRow, TableSkeleton, TrInputs, confirmAsk } from './ui.tsx';
import { ActiveBadge, AddButton, FormDialog, NameCell, PageHead, del, needTitle, save } from './economy.tsx';
import { CatalogTable, IdPick, Rows, usePrizeName } from './kit.tsx';
import { FloatInput, Section, fmtNum, when } from './widgets.tsx';
import { pname } from './support.tsx';
import type { GamesLbPeriod, GamesLeaderboard, GamesMatch, GamesPayout, GamesTicket, LeaderboardReward } from './bindings/types.ts';
import './gamesplay.css';

const PAGE = 20;

function us(v: bigint) {
  return v ? date(new Date(Number(v / 1000n))) : '—';
}

function idOf(s: string) {
  const v = latin(s).replace(/[^0-9]/g, '');
  return v ? BigInt(v) : 0n;
}

function label(map: Record<string, StrKey>, v: string) {
  return map[v] ? t(map[v]) : v;
}

const STATES: Record<string, StrKey> = { waiting: 'gxStWaiting', playing: 'gxStPlaying', finished: 'gxStFinished', cancelled: 'gxStCancelled' };
const PATHS: Record<string, StrKey> = { matchmaking: 'gxPathMatchmaking', bot: 'gxPathBot', friend: 'gxPathFriend' };
const REASONS: Record<string, StrKey> = {
  player_left: 'gxRsPlayerLeft',
  abandoned: 'gxRsAbandoned',
  start_timeout: 'gxRsStartTimeout',
  play_timeout: 'gxRsPlayTimeout',
  admin: 'gxRsAdmin',
  game: 'gxRsGame',
  server: 'gxRsServer',
  module: 'gxRsModule',
};
const OUTCOMES: Record<string, StrKey> = { win: 'gxOcWin', loss: 'gxOcLoss', left: 'gxOcLeft', none: 'gxOcNone' };
const TICKETS: Record<string, StrKey> = { waiting: 'gxTkWaiting', matched: 'gxTkMatched', cancelled: 'gxTkCancelled', expired: 'gxTkExpired', left: 'gxTkLeft', done: 'gxTkDone' };
const PAYOUTS: Record<string, StrKey> = { pending: 'gxPoPending', granted: 'gxPoGranted', failed: 'gxPoFailed' };
const KINDS: Record<string, StrKey> = { match: 'gxKindMatch', leaderboard: 'gxKindBoard' };
const PERIODS: Record<string, StrKey> = { all: 'gxPerAll', daily: 'gxPerDaily', weekly: 'gxPerWeekly', monthly: 'gxPerMonthly' };
const MODES: Record<string, StrKey> = { best: 'gxModeBest', sum: 'gxModeSum', last: 'gxModeLast' };
const ORDERS: Record<string, StrKey> = { desc: 'gxOrderDesc', asc: 'gxOrderAsc' };
const SOURCES: Record<string, StrKey> = { score: 'gxSrcScore', wins: 'gxSrcWins', server: 'gxSrcServer' };
const PREASONS: Record<string, StrKey> = { reset: 'gxPrReset', manual: 'gxPrManual', restart: 'gxPrRestart' };

export function stateBadge(s: string) {
  const cls = s === 'waiting' ? 'b-warn' : s === 'playing' ? 'b-info' : s === 'finished' ? 'b-ok' : '';
  return <span className={`badge ${cls}`}>{label(STATES, s)}</span>;
}

export function reasonText(r: string) {
  if (!r) return '—';
  return REASONS[r] ? t(REASONS[r]) : r;
}

export function outcomeBadge(o: string) {
  const cls = o === 'win' ? 'b-ok' : o === 'loss' ? 'b-bad' : o === 'left' ? 'b-warn' : '';
  return <span className={`badge ${cls}`}>{label(OUTCOMES, o || 'none')}</span>;
}

function ticketBadge(s: string) {
  const cls = s === 'waiting' ? 'b-warn' : s === 'matched' ? 'b-info' : s === 'done' ? 'b-ok' : '';
  return <span className={`badge ${cls}`}>{label(TICKETS, s)}</span>;
}

export function payoutBadge(s: string) {
  if (!s) return <span className="muted">—</span>;
  const cls = s === 'granted' ? 'b-ok' : s === 'failed' ? 'b-bad' : s === 'pending' ? 'b-warn' : '';
  return <span className={`badge ${cls}`}>{label(PAYOUTS, s)}</span>;
}

function periodText(p: string) {
  const [base, n] = p.split('#');
  const kind = base === 'all' ? t('gxPerAll') : base.startsWith('d') ? t('gxPerDaily') : base.startsWith('w') ? t('gxPerWeekly') : t('gxPerMonthly');
  const raw = base === 'all' ? '' : base.slice(1);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? date(new Date(`${raw}T12:00:00Z`), false) : '';
  return (
    <span className="row" style={{ gap: 4, display: 'inline-flex' }}>
      <span>{kind}</span>
      {day ? <span>{day}</span> : raw && <bdi dir="ltr">{digits(raw.replace('-', '/'))}</bdi>}
      {n && <span className="muted small">{t('gxRound', { n: digits(n) })}</span>}
    </span>
  );
}

function Who(props: { id: bigint; name?: string; testId?: string }) {
  const { can } = useSession();
  const text = pname(props.name ?? '', props.id);
  if (!props.id) return <span className="muted">—</span>;
  return can('operator') ? (
    <a className="row-link" href={`#/player?id=${props.id}`} data-testid={props.testId}>
      {text}
    </a>
  ) : (
    <span data-testid={props.testId}>{text}</span>
  );
}

function useGameName() {
  const games = useRows('adminGames');
  const { def } = useLanguages();
  return (id: bigint, key = '') => {
    if (!id) return t('gxStandalone');
    const g = games.find(x => x.id === id);
    return g ? trText(g.name, def) || g.key : key || `#${digits(String(id))}`;
  };
}

function usePrizeText() {
  const prize = usePrizeName();
  const groups = useRows('prizeGroup');
  const { def } = useLanguages();
  return (prizeId: bigint, groupId: bigint) => {
    if (prizeId) return prize(prizeId);
    if (!groupId) return '—';
    const g = groups.find(x => x.id === groupId);
    return t('gxGroupOf', { g: g ? trText(g.name, def) || g.key : `#${digits(String(groupId))}` });
  };
}

function useNames(ids: bigint[]) {
  const { can } = useSession();
  const key = ids.map(String).join(',');
  const op = can('operator');
  const { data } = useFetch(
    () =>
      op
        ? Promise.all(ids.map(id => getConn().procedures.adminPlayer({ accountId: id }).then(d => [String(id), d.player.displayName] as const, () => [String(id), ''] as const)))
        : Promise.resolve([] as (readonly [string, string])[]),
    [key, op]
  );
  const map = new Map(data ?? []);
  return (id: bigint) => map.get(String(id)) ?? '';
}

function Back(props: { href: string; testId: string }) {
  const rtl = getLocale() === 'fa';
  return (
    <a className="btn btn-outline" href={props.href} data-testid={props.testId}>
      {rtl ? <ArrowRight className="ic" /> : <ArrowLeft className="ic" />}
      {t('gxBack')}
    </a>
  );
}

function PlayerSearch(props: { value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="input-affix search" style={{ width: 180 }}>
      <MagnifyingGlass className="ic" />
      <input className="input" value={props.value} onChange={e => props.onChange(e.target.value)} placeholder={t('gxPlayerId')} aria-label={t('gxPlayerId')} inputMode="numeric" data-testid={props.testId} />
    </div>
  );
}

function GameCell(props: { m: GamesMatch }) {
  const game = useGameName();
  return (
    <>
      <span className="primary">{game(props.m.gameId, props.m.gameKey)}</span>
      <div className="mono muted small">{props.m.roomKey}</div>
    </>
  );
}

function SeatsText(props: { m: GamesMatch }) {
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <span>{t('gxPlayersN', { n: num(props.m.players.length) })}</span>
      {props.m.bots > 0 && (
        <span className="badge b-violet">
          <Robot className="ic" />
          {num(props.m.bots)}
        </span>
      )}
    </span>
  );
}

export function Matches() {
  useLocale();
  const route = useRoute();
  const games = useRows('adminGames');
  const { def } = useLanguages();
  const game = route.query.get('game') ?? '';
  const state = route.query.get('state') ?? '';
  const [player, setPlayer] = useState(route.query.get('player') ?? '');
  const [page, setPage] = useState(1);
  const p = useDebounced(player, 300);
  const accountId = idOf(p);
  const q = (x: Record<string, string>) => pageQuery('matches', { game, state, player: accountId ? String(accountId) : '', ...x });
  const { data, error, loading } = useFetch(() => getConn().procedures.adminMatches({ gameId: game ? BigInt(game) : 0n, state, accountId, page, pageSize: PAGE }), [game, state, String(accountId), page]);
  const rows = data?.rows ?? [];
  return (
    <main className="page" data-testid="page-matches">
      <PageHead title={t('navMatches')} sub={data ? t('gxMatchesTotal', { n: num(data.total) }) : <Skel w={60} h={10} />} />
      <div className="toolbar">
        <PlayerSearch
          value={player}
          onChange={v => {
            setPlayer(v);
            setPage(1);
            pageQuery('matches', { game, state, player: idOf(v) ? String(idOf(v)) : '' });
          }}
          testId="gx-m-player"
        />
        {games.length > 0 && (
          <select
            className="select"
            style={{ width: 'auto', minWidth: 160 }}
            value={game}
            onChange={e => {
              setPage(1);
              q({ game: e.target.value });
            }}
            aria-label={t('gxGame')}
            data-testid="gx-m-game"
          >
            <option value="">{t('gxAllGames')}</option>
            {[...games]
              .sort((a, b) => a.sort - b.sort)
              .map(g => (
                <option key={String(g.id)} value={String(g.id)}>
                  {trText(g.name, def) || g.key}
                </option>
              ))}
          </select>
        )}
        <select
          className="select"
          style={{ width: 'auto', minWidth: 140 }}
          value={state}
          onChange={e => {
            setPage(1);
            q({ state: e.target.value });
          }}
          aria-label={t('status')}
          data-testid="gx-m-state"
        >
          <option value="">{t('gxAllStates')}</option>
          {Object.entries(STATES).map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
        </select>
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="gx-m-table">
          <thead>
            <tr>
              <th>{t('gxMatch')}</th>
              <th>{t('gxGame')}</th>
              <th>{t('gxPath')}</th>
              <th>{t('status')}</th>
              <th>{t('gxSeats')}</th>
              <th>{t('gxReason')}</th>
              <th>{t('gxCreated')}</th>
              <th>{t('gxEnded')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={8} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <Empty icon={<Sword className="ic" weight="duotone" />} title={t('gxMatchesEmpty')} text={t('gxMatchesEmptyHint')} />
                </td>
              </tr>
            ) : (
              rows.map(m => (
                <tr key={String(m.id)} data-testid={`gx-m-row-${m.id}`}>
                  <td>
                    <a className="row-link mono" href={`#/match?id=${m.id}`} data-testid={`gx-m-open-${m.id}`}>
                      #{digits(String(m.id))}
                    </a>
                  </td>
                  <td>
                    <GameCell m={m} />
                  </td>
                  <td className="small">{label(PATHS, m.path)}</td>
                  <td>{stateBadge(m.state)}</td>
                  <td className="nowrap small">
                    <SeatsText m={m} />
                  </td>
                  <td className="small">{reasonText(m.reason)}</td>
                  <td className="nowrap small">{us(m.createdAt)}</td>
                  <td className="nowrap small">{us(m.endedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards" data-testid="gx-m-cards">
          {loading && !data && <Skel h={80} r={8} />}
          {data && rows.length === 0 && <Empty icon={<Sword className="ic" weight="duotone" />} title={t('gxMatchesEmpty')} />}
          {rows.map(m => (
            <a className="pcard gx-pcard" key={String(m.id)} href={`#/match?id=${m.id}`} data-testid={`gx-mc-${m.id}`}>
              <div className="row">
                <span className="grow">
                  <GameCell m={m} />
                </span>
                {stateBadge(m.state)}
              </div>
              <div className="pcard-meta">
                <span>{t('gxMatch')}</span>
                <span className="mono">#{digits(String(m.id))}</span>
                <span>{t('gxSeats')}</span>
                <span>
                  <SeatsText m={m} />
                </span>
                <span>{t('gxPath')}</span>
                <span>{label(PATHS, m.path)}</span>
                <span>{t('gxReason')}</span>
                <span>{reasonText(m.reason)}</span>
                <span>{t('gxCreated')}</span>
                <span>{us(m.createdAt)}</span>
              </div>
            </a>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}

function consumedText(raw: string) {
  try {
    const c = JSON.parse(raw || '{}') as { items?: { key: string; qty: number }[]; metas?: { key: string; amount: number }[] };
    const parts = [...(c.items ?? []).map(i => `${i.key} ×${digits(i.qty)}`), ...(c.metas ?? []).map(m => `${m.key} ×${fmtNum(m.amount)}`)];
    return parts.length ? parts.join('، ') : '';
  } catch {
    return '';
  }
}

function CancelDialog(props: { m: GamesMatch; onClose: () => void; onDone: () => void }) {
  const [refund, setRefund] = useState(true);
  const [reason, setReason] = useState('');
  return (
    <FormDialog
      title={t('gxCancelTitle', { n: digits(String(props.m.id)) })}
      testId="gx-cancel-dialog"
      width={460}
      onClose={props.onClose}
      submit={async () => {
        const r = await run(c => c.reducers.adminCancelMatch({ matchId: props.m.id, refund, reason: reason.trim() }), t('gxCancelled'));
        if (r.ok) props.onDone();
        return r.ok ? { ok: true } : { ok: false, err: r.err };
      }}
    >
      <div className="span-2 stack stack-sm">
        <SwitchRow checked={refund} onChange={setRefund} label={t('gxRefund')} testId="gx-cancel-refund" />
        <span className="hint">{refund ? t('gxRefundHint') : t('gxNoRefundHint')}</span>
      </div>
      <Field label={t('gxReason')} hint={t('gxReasonHint')} className="span-2">
        <input className="input" name="reason" value={reason} maxLength={100} onChange={e => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

function MatchSkeleton() {
  return (
    <main className="page" data-testid="page-match">
      <div className="page-head">
        <div className="grow stack stack-sm">
          <Skel w={180} h={18} />
          <Skel w={260} h={10} />
        </div>
      </div>
      <div className="split">
        <div className="stack">
          <Skel h={160} r={8} />
          <Skel h={120} r={8} />
        </div>
        <div className="stack">
          <Skel h={180} r={8} />
        </div>
      </div>
    </main>
  );
}

function Yes(props: { on: boolean; yes: string; no?: string }) {
  return props.on ? <span className="badge b-ok">{props.yes}</span> : <span className="muted">{props.no ?? '—'}</span>;
}

export function MatchPage() {
  useLocale();
  const route = useRoute();
  const { can } = useSession();
  const id = idOf(route.query.get('id') ?? '');
  const [tick, setTick] = useState(0);
  const [cancel, setCancel] = useState(false);
  const { data, error } = useFetch(() => getConn().procedures.adminMatch({ matchId: id }), [String(id), tick]);
  const ids = data ? [...new Set([...data.match.players, ...data.tickets.map(x => x.accountId)].map(String))].map(BigInt) : [];
  const nameOf = useNames(ids);
  const prizeText = usePrizeText();
  const curs = useRows('currency');
  const { def } = useLanguages();
  if (error)
    return (
      <main className="page" data-testid="page-match">
        <PageHead title={t('navMatch')} />
        <ErrBox text={errorText(error)} />
        <div>
          <Back href="#/matches" testId="gx-back" />
        </div>
      </main>
    );
  if (!data || data.match.id !== id) return <MatchSkeleton />;
  const m = data.match;
  const open = m.state === 'waiting' || m.state === 'playing';
  const tickets = [...data.tickets].sort((a, b) => (a.rank || 999) - (b.rank || 999) || (a.id < b.id ? -1 : 1));
  const cur = (k: string) => {
    const c = curs.find(x => x.key === k);
    return c ? trText(c.name, def) || k : k;
  };
  return (
    <main className="page" data-testid="page-match">
      <div className="page-head">
        <div className="grow">
          <div className="page-title" data-testid="gx-match-title">
            {t('gxMatchN', { n: digits(String(m.id)) })}
          </div>
          <div className="page-sub row row-wrap" style={{ gap: 6 }}>
            <span data-testid="gx-match-state">{stateBadge(m.state)}</span>
            <span className="badge">{label(PATHS, m.path)}</span>
            <span>
              <GameName m={m} />
            </span>
            <span>· {t('gxCreatedAt', { d: us(m.createdAt) })}</span>
          </div>
        </div>
        <div className="row row-wrap" style={{ gap: 6 }}>
          <Back href="#/matches" testId="gx-back" />
          {can('admin') && open && (
            <button type="button" className="btn btn-danger" onClick={() => setCancel(true)} data-testid="gx-cancel">
              <Prohibit className="ic" />
              {t('gxCancelMatch')}
            </button>
          )}
        </div>
      </div>
      <div className="split">
        <div className="stack">
          <Section title={t('gxPlayers')} pad={false} testId="gx-players">
            <div className="table-wrap responsive gx-flat">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('gxRank')}</th>
                    <th>{t('gxPlayer')}</th>
                    <th>{t('gxScore')}</th>
                    <th>{t('gxOutcome')}</th>
                    <th>{t('gxReady')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(x => (
                    <tr key={String(x.id)} data-testid={`gx-pl-${x.accountId}`}>
                      <td className="nowrap">{x.rank ? <RankBadge rank={x.rank} /> : <span className="muted">—</span>}</td>
                      <td>
                        <Who id={x.accountId} name={nameOf(x.accountId)} />
                      </td>
                      <td>{m.state === 'finished' ? fmtNum(x.score) : <span className="muted">—</span>}</td>
                      <td>{m.state === 'finished' || x.status === 'left' ? outcomeBadge(x.status === 'left' && !x.outcome ? 'left' : x.outcome) : <span className="muted">—</span>}</td>
                      <td>{x.status === 'left' ? outcomeBadge('left') : <Yes on={x.ready} yes={t('gxIsReady')} no={t('gxNotReady')} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="cards">
                {tickets.map(x => (
                  <div className="pcard" key={String(x.id)}>
                    <div className="row">
                      <span className="grow">
                        <Who id={x.accountId} name={nameOf(x.accountId)} />
                      </span>
                      {m.state === 'finished' && outcomeBadge(x.outcome)}
                    </div>
                    <div className="pcard-meta">
                      <span>{t('gxRank')}</span>
                      <span>{x.rank ? num(x.rank) : '—'}</span>
                      <span>{t('gxScore')}</span>
                      <span>{m.state === 'finished' ? fmtNum(x.score) : '—'}</span>
                      <span>{t('gxReady')}</span>
                      <span>{x.ready ? t('gxIsReady') : t('gxNotReady')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {m.bots > 0 && (
              <div className="card-pad small muted row" style={{ gap: 6 }}>
                <Robot className="ic" />
                {t('gxBotsN', { n: num(m.bots) })}
              </div>
            )}
          </Section>
          <Section title={t('gxTickets')} pad={false} testId="gx-tickets">
            <div className="table-wrap responsive gx-flat">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('gxTicket')}</th>
                    <th>{t('gxPlayer')}</th>
                    <th>{t('status')}</th>
                    <th>{t('gxFee')}</th>
                    <th>{t('gxConsumed')}</th>
                    <th>{t('gxRefundCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(x => (
                    <TicketRow key={String(x.id)} x={x} name={nameOf(x.accountId)} cur={cur} />
                  ))}
                </tbody>
              </table>
              <div className="cards">
                {tickets.map(x => (
                  <div className="pcard" key={String(x.id)}>
                    <div className="row">
                      <span className="grow">
                        <Who id={x.accountId} name={nameOf(x.accountId)} />
                      </span>
                      {ticketBadge(x.status)}
                    </div>
                    <div className="pcard-meta">
                      <span>{t('gxFee')}</span>
                      <span>{x.fee > 0n ? `${num(x.fee)} ${cur(x.feeCurrency)}` : t('gxFree')}</span>
                      <span>{t('gxRefundCol')}</span>
                      <span>{x.feeRefunded ? t('gxFeeBack') : '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </div>
        <div className="stack">
          <Section title={t('gxDetails')} testId="gx-details">
            <dl className="kv" style={{ margin: 0 }}>
              <dt>{t('gxGame')}</dt>
              <dd>
                <GameName m={m} />
              </dd>
              <dt>{t('gxRoom')}</dt>
              <dd className="mono">{m.roomKey}</dd>
              <dt>{t('gxSeats')}</dt>
              <dd>
                <SeatsText m={m} />
              </dd>
              <dt>{t('gxSkill')}</dt>
              <dd>{m.skillMin || m.skillMax ? t('gxSkillRange', { a: fmtNum(m.skillMin), b: fmtNum(m.skillMax) }) : '—'}</dd>
              <dt>{t('gxCreated')}</dt>
              <dd>{us(m.createdAt)}</dd>
              <dt>{t('gxStarted')}</dt>
              <dd>{us(m.startedAt)}</dd>
              <dt>{t('gxEnded')}</dt>
              <dd>{us(m.endedAt)}</dd>
              <dt>{t('gxReason')}</dt>
              <dd data-testid="gx-match-reason">{reasonText(m.reason)}</dd>
            </dl>
          </Section>
          <Section title={t('gxPayouts')} pad={false} testId="gx-payouts">
            {data.payouts.length === 0 ? (
              <div className="card-pad small muted">{m.state === 'finished' ? t('gxNoPayouts') : t('gxPayoutsLater')}</div>
            ) : (
              <div className="list">
                {data.payouts.map(p => (
                  <div className="list-row" key={String(p.id)} data-testid={`gx-po-${p.accountId}`}>
                    <div className="list-main">
                      <span className="list-title">
                        <Who id={p.accountId} name={nameOf(p.accountId)} />
                      </span>
                      <span className="list-sub">
                        {prizeText(p.prizeId, p.prizeGroupId)} · {t('gxAttemptsN', { n: num(p.attempts) })}
                        {p.grantedAt ? ` · ${when(p.grantedAt)}` : ''}
                      </span>
                      {p.error && <span className="small neg">{codeText(p.error)}</span>}
                    </div>
                    {payoutBadge(p.status)}
                    {p.status === 'failed' && <RetryButton id={p.id} onDone={() => setTick(x => x + 1)} />}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
      {cancel && <CancelDialog m={m} onClose={() => setCancel(false)} onDone={() => setTick(x => x + 1)} />}
    </main>
  );
}

function GameName(props: { m: GamesMatch }) {
  const game = useGameName();
  return <>{game(props.m.gameId, props.m.gameKey)}</>;
}

function RankBadge(props: { rank: number }) {
  return (
    <span className={`gx-rank ${props.rank <= 3 ? `gx-rank-${props.rank}` : ''}`}>
      {props.rank === 1 && <Trophy className="ic" weight="fill" />}
      {num(props.rank)}
    </span>
  );
}

function TicketRow(props: { x: GamesTicket; name: string; cur: (k: string) => string }) {
  const x = props.x;
  const used = consumedText(x.consumed);
  const live = x.status === 'waiting' || x.status === 'matched';
  return (
    <tr data-testid={`gx-tk-${x.accountId}`}>
      <td className="mono small">#{digits(String(x.id))}</td>
      <td>
        <Who id={x.accountId} name={props.name} />
      </td>
      <td>{ticketBadge(x.status)}</td>
      <td className="nowrap">{x.fee > 0n ? `${num(x.fee)} ${props.cur(x.feeCurrency)}` : <span className="muted">{t('gxFree')}</span>}</td>
      <td className="small">{used ? <bdi className="mono">{used}</bdi> : <span className="muted">—</span>}</td>
      <td className="small">
        <span className="stack" style={{ gap: 2 }}>
          {!live && x.fee > 0n && <Yes on={x.feeRefunded} yes={t('gxFeeBack')} no={t('gxFeeKept')} />}
          {!live && used && <Yes on={x.ticketsReturned} yes={t('gxTicketsBack')} no={x.refund === 'keep' ? t('gxTicketsKeep') : t('gxTicketsKept')} />}
          {(live || (x.fee === 0n && !used)) && <span className="muted">{live && x.refund === 'keep' && used ? t('gxTicketsKeep') : '—'}</span>}
        </span>
      </td>
    </tr>
  );
}

function RetryButton(props: { id: bigint; onDone?: () => void }) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  if (!can('admin')) return null;
  return (
    <button
      type="button"
      className="btn btn-sm btn-outline"
      disabled={busy}
      data-testid={`gx-retry-${props.id}`}
      onClick={async () => {
        setBusy(true);
        const r = await run(c => c.procedures.adminRetryGamePayout({ payoutId: props.id }));
        setBusy(false);
        if (!r.ok) {
          await runToast(() => Promise.reject(r.err.raw));
          return;
        }
        await runToast(async () => r.value, r.value.status === 'granted' ? t('gxRetryOk') : t('gxRetryFailed'));
        props.onDone?.();
      }}
    >
      <ArrowClockwise className="ic" />
      {t('gxRetry')}
    </button>
  );
}

export function GamePayouts() {
  useLocale();
  const route = useRoute();
  const kind = route.query.get('kind') ?? '';
  const status = route.query.get('status') ?? '';
  const [player, setPlayer] = useState(route.query.get('player') ?? '');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const prizeText = usePrizeText();
  const p = useDebounced(player, 300);
  const accountId = idOf(p);
  const q = (x: Record<string, string>) => pageQuery('game-payouts', { kind, status, player: accountId ? String(accountId) : '', ...x });
  const { data, error, loading } = useFetch(() => getConn().procedures.adminGamePayouts({ kind, status, accountId, page, pageSize: PAGE }), [kind, status, String(accountId), page, tick]);
  const rows = data?.rows ?? [];
  const nameOf = useNames([...new Set(rows.map(x => String(x.accountId)))].map(BigInt));
  const ref = (x: GamesPayout) =>
    x.kind === 'match' ? (
      <a className="row-link" href={`#/match?id=${x.refId}`}>
        {t('gxMatchN', { n: digits(String(x.refId)) })}
      </a>
    ) : (
      <span className="muted">{t('gxPeriodN', { n: digits(String(x.refId)) })}</span>
    );
  return (
    <main className="page" data-testid="page-game-payouts">
      <PageHead title={t('navGamePayouts')} sub={data ? t('gxPayoutsTotal', { n: num(data.total) }) : <Skel w={60} h={10} />} />
      <div className="toolbar">
        <PlayerSearch
          value={player}
          onChange={v => {
            setPlayer(v);
            setPage(1);
            pageQuery('game-payouts', { kind, status, player: idOf(v) ? String(idOf(v)) : '' });
          }}
          testId="gx-p-player"
        />
        <select className="select" style={{ width: 'auto', minWidth: 140 }} value={kind} onChange={e => (setPage(1), q({ kind: e.target.value }))} aria-label={t('gxKind')} data-testid="gx-p-kind">
          <option value="">{t('gxAllKinds')}</option>
          {Object.entries(KINDS).map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 140 }} value={status} onChange={e => (setPage(1), q({ status: e.target.value }))} aria-label={t('status')} data-testid="gx-p-status">
          <option value="">{t('gxAllStates')}</option>
          {Object.entries(PAYOUTS).map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
        </select>
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="gx-p-table">
          <thead>
            <tr>
              <th>{t('gxCreated')}</th>
              <th>{t('gxPlayer')}</th>
              <th>{t('gxKind')}</th>
              <th>{t('gxPrize')}</th>
              <th>{t('status')}</th>
              <th>{t('gxGranted')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={7} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty icon={<Coins className="ic" weight="duotone" />} title={t('gxPayoutsEmpty')} text={t('gxPayoutsEmptyHint')} />
                </td>
              </tr>
            ) : (
              rows.map(x => (
                <tr key={String(x.id)} data-testid={`gx-p-row-${x.id}`}>
                  <td className="nowrap small">{when(x.createdAt)}</td>
                  <td>
                    <Who id={x.accountId} name={nameOf(x.accountId)} />
                  </td>
                  <td className="small">
                    {label(KINDS, x.kind)}
                    <div>{ref(x)}</div>
                  </td>
                  <td>{prizeText(x.prizeId, x.prizeGroupId)}</td>
                  <td>
                    <span className="stack" style={{ gap: 2 }}>
                      <span data-testid={`gx-p-status-${x.id}`}>{payoutBadge(x.status)}</span>
                      <span className="small muted">{t('gxAttemptsN', { n: num(x.attempts) })}</span>
                      {x.error && <span className="small neg">{codeText(x.error)}</span>}
                    </span>
                  </td>
                  <td className="nowrap small">{x.grantedAt ? when(x.grantedAt) : '—'}</td>
                  <td className="end">{x.status === 'failed' && <RetryButton id={x.id} onDone={() => setTick(v => v + 1)} />}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {data && rows.length === 0 && <Empty icon={<Coins className="ic" weight="duotone" />} title={t('gxPayoutsEmpty')} />}
          {rows.map(x => (
            <div className="pcard" key={String(x.id)}>
              <div className="row">
                <span className="grow">{prizeText(x.prizeId, x.prizeGroupId)}</span>
                {payoutBadge(x.status)}
              </div>
              <div className="pcard-meta">
                <span>{t('gxPlayer')}</span>
                <span>
                  <Who id={x.accountId} name={nameOf(x.accountId)} />
                </span>
                <span>{t('gxKind')}</span>
                <span>{ref(x)}</span>
                <span>{t('gxCreated')}</span>
                <span>{when(x.createdAt)}</span>
              </div>
              {x.error && <span className="small neg">{codeText(x.error)}</span>}
              {x.status === 'failed' && <RetryButton id={x.id} onDone={() => setTick(v => v + 1)} />}
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}

type Reward = LeaderboardReward;

function opts(map: Record<string, StrKey>) {
  return Object.entries(map).map(([value, k]) => ({ value, label: t(k) }));
}

function BoardDialog(props: { row?: GamesLeaderboard; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const games = useRows('adminGames');
  const [key, setKey] = useState(r?.key ?? '');
  const [gameId, setGameId] = useState(r?.gameId ?? 0n);
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [iconUrl, setIcon] = useState(r?.iconUrl ?? '');
  const [period, setPeriod] = useState(r?.period ?? 'weekly');
  const [scoreMode, setMode] = useState(r?.scoreMode ?? 'sum');
  const [order, setOrder] = useState(r?.order ?? 'desc');
  const [source, setSource] = useState(r?.source ?? (r ? 'server' : 'wins'));
  const [topN, setTopN] = useState(r?.topN ?? 50);
  const [rewards, setRewards] = useState<Reward[]>(r?.rewards ?? []);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('gxBoardEdit') : t('gxBoardAdd')}
      testId="gx-board-dialog"
      width={720}
      onClose={props.onClose}
      submit={async () => {
        const bad = needTitle(name, def);
        if (bad) return bad;
        if (source !== 'server' && !gameId) return { ok: false, msg: codeText('SOURCE_NEEDS_GAME') };
        return save(() =>
          getConn().reducers.adminSaveLeaderboard({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), gameId, name, description, iconUrl: iconUrl.trim(), period, scoreMode, order, source, topN, rewards, isActive, sort })
        );
      }}
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('gxGame')} hint={t('gxGameHint')}>
        <select className="select" name="gameId" value={String(gameId)} onChange={e => setGameId(BigInt(e.target.value))} data-testid="gx-b-game">
          <option value="0">{t('gxStandalone')}</option>
          {games.map(g => (
            <option key={String(g.id)} value={String(g.id)}>
              {trText(g.name, def) || g.key}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('description')} hint={t('optional')} className="span-2">
        <TrInputs value={description} onChange={setDescription} name="description" />
      </Field>
      <Field label={t('icon')} hint={t('optional')} className="span-2">
        <input className="input ltr" name="iconUrl" value={iconUrl} onChange={e => setIcon(e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t('gxPeriod')} hint={r && r.period !== period ? t('gxPeriodChange') : t('gxPeriodHint')}>
        <Seg value={period} onChange={setPeriod} options={opts(PERIODS)} label={t('gxPeriod')} />
      </Field>
      <Field label={t('gxSource')} hint={source === 'server' ? t('gxSrcServerHint') : t('gxSrcGameHint')}>
        <Seg value={source} onChange={setSource} options={opts(SOURCES)} label={t('gxSource')} />
      </Field>
      <Field label={t('gxMode')} hint={t('gxModeHint')}>
        <Seg value={scoreMode} onChange={setMode} options={opts(MODES)} label={t('gxMode')} />
      </Field>
      <Field label={t('gxOrder')}>
        <Seg value={order} onChange={setOrder} options={opts(ORDERS)} label={t('gxOrder')} />
      </Field>
      <Field label={t('gxTopN')} hint={t('gxTopNHint')}>
        <NumInput value={topN} onChange={setTopN} name="topN" min={1} max={200} />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <Field label={t('gxRewards')} hint={t('gxRewardsHint')} className="span-2">
        <Rows<Reward>
          rows={rewards}
          onChange={setRewards}
          testId="gx-b-rewards"
          addLabel={t('gxAddReward')}
          max={20}
          make={() => {
            const last = rewards[rewards.length - 1];
            const from = last ? (last.toRank || last.fromRank) + 1 : 1;
            return { fromRank: from, toRank: from, prizeId: 0n, prizeGroupId: 0n };
          }}
          cols={[
            { label: t('gxFromRank'), width: '80px', render: (x, set, i) => <NumInput value={x.fromRank} onChange={v => set({ fromRank: v })} name={`rw-${i}-from`} /> },
            { label: t('gxToRank'), width: '80px', render: (x, set, i) => <NumInput value={x.toRank} onChange={v => set({ toRank: v })} name={`rw-${i}-to`} /> },
            { label: t('gxPrize'), width: 'minmax(0, 1fr)', render: (x, set, i) => <IdPick kind="prize" value={x.prizeId} onChange={v => set({ prizeId: v, prizeGroupId: v ? 0n : x.prizeGroupId })} none="—" testId={`gx-rw-${i}-prize`} label={t('gxPrize')} /> },
            { label: t('gxPrizeGroup'), width: 'minmax(0, 1fr)', render: (x, set, i) => <IdPick kind="prizeGroup" value={x.prizeGroupId} onChange={v => set({ prizeGroupId: v, prizeId: v ? 0n : x.prizeId })} none="—" testId={`gx-rw-${i}-group`} label={t('gxPrizeGroup')} /> },
          ]}
          footer={<span className="small muted">{t('gxToRankHint')}</span>}
        />
      </Field>
      <div className="field span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} testId="gx-b-active" />
      </div>
    </FormDialog>
  );
}

function rewardsText(list: Reward[], prizeText: (p: bigint, g: bigint) => string) {
  return list.map(r => `${r.toRank === r.fromRank ? digits(r.fromRank) : r.toRank ? `${digits(r.fromRank)}–${digits(r.toRank)}` : `${digits(r.fromRank)}+`}: ${prizeText(r.prizeId, r.prizeGroupId)}`).join('، ');
}

export function Leaderboards() {
  useLocale();
  const list = useRows('adminLeaderboards');
  const loaded = useRows('language').length > 0;
  const game = useGameName();
  const prizeText = usePrizeText();
  const [edit, setEdit] = useState<GamesLeaderboard | null | undefined>(undefined);
  const rows = [...list].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  return (
    <main className="page" data-testid="page-leaderboards">
      <PageHead title={t('navLeaderboards')} sub={t('gxBoardsSub')} action={<AddButton label={t('gxBoardAdd')} onClick={() => setEdit(null)} testId="gx-b-add" />} />
      <CatalogTable
        rows={rows}
        prefix="gx-b"
        keyOf={r => r.key}
        loaded={loaded}
        empty={{ icon: <Ranking className="ic" weight="duotone" />, title: t('gxBoardsEmpty') }}
        cardTitle={r => (
          <a className="row-link" href={`#/leaderboard?id=${r.id}`}>
            <NameCell name={r.name} k={r.key} />
          </a>
        )}
        cols={[
          {
            label: t('name'),
            render: r => (
              <a className="row-link gx-name-link" href={`#/leaderboard?id=${r.id}`} data-testid={`gx-b-open-${r.key}`}>
                <NameCell name={r.name} k={r.key} />
              </a>
            ),
          },
          { label: t('gxGame'), render: r => game(r.gameId) },
          { label: t('gxPeriod'), render: r => <span className="badge b-teal">{label(PERIODS, r.period)}</span> },
          { label: t('gxSource'), render: r => label(SOURCES, r.source) },
          {
            label: t('gxRule'),
            render: r => (
              <span className="small">
                {label(MODES, r.scoreMode)} · {label(ORDERS, r.order)}
                <div className="muted">{t('gxTopNShort', { n: num(r.topN) })}</div>
              </span>
            ),
          },
          { label: t('gxCurrent'), render: r => periodText(r.currentPeriod) },
          { label: t('gxRewards'), render: r => (r.rewards.length ? <span title={rewardsText(r.rewards, prizeText)}>{t('gxRewardsN', { n: num(r.rewards.length) })}</span> : <span className="muted">—</span>) },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('gxBoardDelete', { name: trText(r.name) || r.key }), () => getConn().reducers.adminDeleteLeaderboard({ id: r.id }))}
      />
      {edit !== undefined && <BoardDialog row={edit ?? undefined} onClose={() => setEdit(undefined)} />}
    </main>
  );
}

function ScoreDialog(props: { board: GamesLeaderboard; accountId?: bigint; score?: number; onClose: () => void; onDone: () => void }) {
  const [who, setWho] = useState(props.accountId ? digits(String(props.accountId)) : '');
  const [mode, setMode] = useState<'set' | 'add' | 'remove'>(props.accountId ? 'set' : 'add');
  const [score, setScore] = useState(props.score ?? 0);
  return (
    <FormDialog
      title={t('gxScoreTitle')}
      testId="gx-score-dialog"
      width={460}
      onClose={props.onClose}
      submit={async () => {
        const accountId = idOf(who);
        if (!accountId) return { ok: false, msg: t('gxNeedPlayer') };
        const r = await run(c => c.reducers.adminSetLeaderboardScore({ boardId: props.board.id, accountId, score, mode }), mode === 'remove' ? t('gxScoreRemoved') : t('saved'));
        if (r.ok) props.onDone();
        return r.ok ? { ok: true } : { ok: false, err: r.err };
      }}
    >
      <Field label={t('gxPlayerId')} required>
        <input className="input ltr" name="accountId" inputMode="numeric" value={who} onChange={e => setWho(e.target.value)} disabled={!!props.accountId} autoFocus={!props.accountId} />
      </Field>
      <Field label={t('gxScoreMode')}>
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: 'set', label: t('gxScSet') },
            { value: 'add', label: t('gxScAdd') },
            { value: 'remove', label: t('gxScRemove') },
          ]}
          label={t('gxScoreMode')}
        />
      </Field>
      {mode !== 'remove' && (
        <Field label={mode === 'add' ? t('gxScoreAddLabel') : t('gxScore')} hint={mode === 'add' ? t('gxScoreAddHint') : t('gxScoreSetHint')} className="span-2">
          <FloatInput value={score} onChange={setScore} name="score" />
        </Field>
      )}
      {mode === 'remove' && (
        <div className="span-2 small muted">{t('gxScoreRemoveHint')}</div>
      )}
    </FormDialog>
  );
}

function Standings(props: { board: GamesLeaderboard; tick: number; bump: () => void }) {
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const [score, setScore] = useState<{ accountId?: bigint; score?: number } | null>(null);
  const { data, error, loading } = useFetch(() => getConn().procedures.adminLeaderboardStandings({ boardId: props.board.id, page, pageSize: PAGE }), [String(props.board.id), page, props.tick, props.board.currentPeriod]);
  const rows = data?.rows ?? [];
  return (
    <Section
      title={
        <span className="row" style={{ gap: 6 }}>
          {t('gxStandings')}
          {data && <span className="muted small">{periodText(data.period)}</span>}
        </span>
      }
      pad={false}
      testId="gx-standings"
      action={
        can('admin') && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setScore({})} data-testid="gx-score-add">
            <Plus className="ic" />
            {t('gxScoreBtn')}
          </button>
        )
      }
    >
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive gx-flat">
        <table className="table" data-testid="gx-st-table">
          <thead>
            <tr>
              <th>{t('gxRank')}</th>
              <th>{t('gxPlayer')}</th>
              <th>{t('gxScore')}</th>
              <th>{t('gxWrites')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={5} rows={5} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <Empty icon={<Ranking className="ic" weight="duotone" />} title={t('gxStEmpty')} text={t('gxStEmptyHint')} />
                </td>
              </tr>
            ) : (
              rows.map(x => (
                <tr key={String(x.accountId)} data-testid={`gx-st-${x.accountId}`} className={x.rank > props.board.topN ? 'gx-below' : ''}>
                  <td className="nowrap">
                    <RankBadge rank={x.rank} />
                  </td>
                  <td>
                    <Who id={x.accountId} name={x.displayName} />
                  </td>
                  <td data-testid={`gx-st-score-${x.accountId}`}>{fmtNum(x.score)}</td>
                  <td className="small muted">{num(x.writes)}</td>
                  <td className="end">
                    {can('admin') && (
                      <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-sm btn-icon" aria-label={t('edit')} title={t('edit')} onClick={() => setScore({ accountId: x.accountId, score: x.score })} data-testid={`gx-st-edit-${x.accountId}`}>
                          <PencilSimple className="ic" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-icon btn-danger-ghost"
                          aria-label={t('delete')}
                          title={t('delete')}
                          data-testid={`gx-st-del-${x.accountId}`}
                          onClick={async () => {
                            if (!(await confirmAsk(t('gxScoreRemoveAsk', { name: pname(x.displayName, x.accountId) }), { danger: true, ok: t('gxScRemove') }))) return;
                            if (await runToast(c => c.reducers.adminSetLeaderboardScore({ boardId: props.board.id, accountId: x.accountId, score: 0, mode: 'remove' }), t('gxScoreRemoved'))) props.bump();
                          }}
                        >
                          <Trash className="ic" />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(x => (
            <div className="pcard" key={String(x.accountId)}>
              <div className="row">
                <RankBadge rank={x.rank} />
                <span className="grow">
                  <Who id={x.accountId} name={x.displayName} />
                </span>
                <b>{fmtNum(x.score)}</b>
              </div>
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {score && <ScoreDialog board={props.board} accountId={score.accountId} score={score.score} onClose={() => setScore(null)} onDone={props.bump} />}
    </Section>
  );
}

function ResultsDialog(props: { period: GamesLbPeriod; onClose: () => void }) {
  const { can } = useSession();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const prizeText = usePrizeText();
  const { data, error } = useFetch(() => getConn().procedures.adminLeaderboardResults({ periodId: props.period.id }), [String(props.period.id), tick]);
  const pending = (data ?? []).some(x => x.payoutStatus === 'pending');
  return (
    <Dialog
      title={
        <span className="row" style={{ gap: 6 }}>
          {t('gxResults')}
          <span className="muted small">{periodText(props.period.period)}</span>
        </span>
      }
      width={640}
      onClose={props.onClose}
      testId="gx-results"
      foot={
        <>
          <span className="small muted grow">{t('gxResultsSum', { p: num(props.period.players), r: num(props.period.rewarded) })}</span>
          {can('admin') && pending && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              data-testid="gx-pay"
              onClick={async () => {
                setBusy(true);
                const r = await run(c => c.procedures.adminLeaderboardPay({ periodId: props.period.id }));
                setBusy(false);
                if (r.ok) await runToast(async () => r.value, t('gxPaidN', { n: num(r.value) }));
                else await runToast(() => Promise.reject(r.err.raw));
                setTick(x => x + 1);
              }}
            >
              <Coins className="ic" />
              {t('gxPay')}
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('close')}
          </button>
        </>
      }
    >
      <ErrBox text={error ? errorText(error) : null} />
      {!data ? (
        <div className="stack">
          <Skel h={14} />
          <Skel h={14} />
          <Skel h={14} />
        </div>
      ) : data.length === 0 ? (
        <Empty icon={<Trophy className="ic" weight="duotone" />} title={t('gxStEmpty')} />
      ) : (
        <div className="table-wrap gx-flat">
          <table className="table" data-testid="gx-res-table">
            <thead>
              <tr>
                <th>{t('gxRank')}</th>
                <th>{t('gxPlayer')}</th>
                <th>{t('gxScore')}</th>
                <th>{t('gxPrize')}</th>
                <th>{t('gxPayout')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map(x => (
                <tr key={String(x.result.id)} data-testid={`gx-res-${x.result.accountId}`}>
                  <td>
                    <RankBadge rank={x.result.rank} />
                  </td>
                  <td>
                    <Who id={x.result.accountId} name={x.displayName} />
                  </td>
                  <td>{fmtNum(x.result.score)}</td>
                  <td className="small">{x.result.prizeId || x.result.prizeGroupId ? prizeText(x.result.prizeId, x.result.prizeGroupId) : <span className="muted">—</span>}</td>
                  <td data-testid={`gx-res-pay-${x.result.accountId}`}>{payoutBadge(x.payoutStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

function Periods(props: { board: GamesLeaderboard; tick: number }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<GamesLbPeriod | null>(null);
  const { data, error, loading } = useFetch(() => getConn().procedures.adminLeaderboardPeriods({ boardId: props.board.id, page, pageSize: PAGE }), [String(props.board.id), page, props.tick, props.board.currentPeriod]);
  const rows = data?.rows ?? [];
  const btn = (x: GamesLbPeriod) => (
    <button type="button" className="btn btn-sm btn-outline" onClick={() => setOpen(x)} data-testid={`gx-per-open-${x.id}`}>
      <Eye className="ic" />
      {t('gxResults')}
    </button>
  );
  return (
    <Section title={t('gxPeriods')} pad={false} testId="gx-periods">
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive gx-flat">
        <table className="table" data-testid="gx-per-table">
          <thead>
            <tr>
              <th>{t('gxPeriod')}</th>
              <th>{t('gxReason')}</th>
              <th>{t('gxSeats')}</th>
              <th>{t('gxRewarded')}</th>
              <th>{t('gxStarted')}</th>
              <th>{t('gxEnded')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={7} rows={3} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty icon={<Trophy className="ic" weight="duotone" />} title={t('gxPerEmpty')} text={t('gxPerEmptyHint')} />
                </td>
              </tr>
            ) : (
              rows.map(x => (
                <tr key={String(x.id)} data-testid={`gx-per-${x.id}`}>
                  <td>{periodText(x.period)}</td>
                  <td>
                    <span className="stack" style={{ gap: 2 }}>
                      <span>{label(PREASONS, x.reason)}</span>
                      {!x.paid && <span className="small muted">{t('gxUnpaid')}</span>}
                    </span>
                  </td>
                  <td>{num(x.players)}</td>
                  <td>{num(x.rewarded)}</td>
                  <td className="nowrap small">{us(x.startedAt)}</td>
                  <td className="nowrap small">{us(x.endedAt)}</td>
                  <td className="end">{btn(x)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(x => (
            <div className="pcard" key={String(x.id)}>
              <div className="row">
                <span className="grow">{periodText(x.period)}</span>
                {btn(x)}
              </div>
              <div className="pcard-meta">
                <span>{t('gxReason')}</span>
                <span>{label(PREASONS, x.reason)}</span>
                <span>{t('gxSeats')}</span>
                <span>{num(x.players)}</span>
                <span>{t('gxEnded')}</span>
                <span>{us(x.endedAt)}</span>
              </div>
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {open && <ResultsDialog period={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}

function ResetPanel(props: { board: GamesLeaderboard; done: () => void }) {
  const { can } = useSession();
  const [pay, setPay] = useState(true);
  const [busy, setBusy] = useState(false);
  const ro = !can('admin');
  return (
    <Section title={t('gxReset')} testId="gx-reset">
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('gxResetText')}
        </p>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>{t('gxCurrent')}</dt>
          <dd>{periodText(props.board.currentPeriod)}</dd>
          <dt>{t('gxStartedAt')}</dt>
          <dd>{us(props.board.periodStartedAt)}</dd>
          <dt>{t('gxResets')}</dt>
          <dd>{num(props.board.resets)}</dd>
        </dl>
        <SwitchRow checked={pay} onChange={setPay} disabled={ro} label={t('gxResetPay')} testId="gx-reset-pay" />
        <span className="hint">{pay ? (props.board.rewards.length ? t('gxResetPayHint') : t('gxResetNoRewards')) : t('gxResetNoPayHint')}</span>
        {!ro && (
          <div>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              data-testid="gx-reset-go"
              onClick={async () => {
                if (!(await confirmAsk(pay ? t('gxResetAskPay') : t('gxResetAsk'), { danger: true, ok: t('gxResetBtn') }))) return;
                setBusy(true);
                const ok = await runToast(c => c.reducers.adminResetLeaderboard({ id: props.board.id, pay }), t('gxResetDone'));
                setBusy(false);
                if (ok) props.done();
              }}
            >
              <ArrowClockwise className="ic" />
              {t('gxResetBtn')}
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

export function LeaderboardPage() {
  useLocale();
  const route = useRoute();
  const id = idOf(route.query.get('id') ?? '');
  const boards = useRows('adminLeaderboards');
  const loaded = useRows('language').length > 0;
  const game = useGameName();
  const { def } = useLanguages();
  const [tab, setTab] = useState<'standings' | 'periods' | 'reset'>((route.query.get('tab') as 'periods') || 'standings');
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState(false);
  const { can } = useSession();
  const b = boards.find(x => x.id === id);
  if (!b)
    return (
      <main className="page" data-testid="page-leaderboard">
        {!loaded || boards.length === 0 ? (
          <div className="stack">
            <Skel w={220} h={18} />
            <Skel h={200} r={8} />
          </div>
        ) : (
          <>
            <PageHead title={t('navLeaderboard')} />
            <ErrBox text={codeText('LEADERBOARD_NOT_FOUND')} />
            <div>
              <Back href="#/leaderboards" testId="gx-back" />
            </div>
          </>
        )}
      </main>
    );
  const bump = () => setTick(x => x + 1);
  return (
    <main className="page" data-testid="page-leaderboard">
      <div className="page-head">
        <div className="grow">
          <div className="page-title row" style={{ gap: 8 }} data-testid="gx-board-title">
            {b.iconUrl ? <img src={b.iconUrl} alt="" className="gx-icon" /> : <Ranking className="ic" weight="duotone" />}
            {trText(b.name, def) || b.key}
          </div>
          <div className="page-sub row row-wrap" style={{ gap: 6 }}>
            <span className="mono">{b.key}</span>
            <ActiveBadge on={b.isActive} />
            <span className="badge b-teal">{label(PERIODS, b.period)}</span>
            <span>
              <GameController className="ic" /> {game(b.gameId)}
            </span>
            <span>
              · {label(SOURCES, b.source)} · {label(MODES, b.scoreMode)} · {label(ORDERS, b.order)} · {t('gxTopNShort', { n: num(b.topN) })}
            </span>
          </div>
        </div>
        <div className="row row-wrap" style={{ gap: 6 }}>
          <Back href="#/leaderboards" testId="gx-back" />
          {can('admin') && (
            <button type="button" className="btn btn-outline" onClick={() => setEdit(true)} data-testid="gx-board-edit">
              <PencilSimple className="ic" />
              {t('edit')}
            </button>
          )}
        </div>
      </div>
      <div className="row row-wrap">
        <Seg
          value={tab}
          onChange={v => {
            setTab(v);
            pageQuery('leaderboard', { id: String(b.id), tab: v === 'standings' ? '' : v });
          }}
          options={[
            { value: 'standings', label: t('gxStandings') },
            { value: 'periods', label: t('gxPeriods') },
            { value: 'reset', label: t('gxReset') },
          ]}
          label={t('navLeaderboard')}
        />
        <span className="grow" />
        {b.rewards.length > 0 && <RewardsLine rewards={b.rewards} />}
      </div>
      {tab === 'standings' && <Standings board={b} tick={tick} bump={bump} />}
      {tab === 'periods' && <Periods board={b} tick={tick} />}
      {tab === 'reset' && (
        <ResetPanel
          board={b}
          done={() => {
            bump();
            setTab('periods');
            pageQuery('leaderboard', { id: String(b.id), tab: 'periods' });
          }}
        />
      )}
      {edit && <BoardDialog row={b} onClose={() => setEdit(false)} />}
    </main>
  );
}

function RewardsLine(props: { rewards: Reward[] }) {
  const prizeText = usePrizeText();
  return (
    <span className="row row-wrap small" style={{ gap: 6 }} data-testid="gx-rewards-line">
      <Trophy className="ic" />
      {props.rewards.map((r, i) => (
        <span className="badge" key={i}>
          {r.toRank === r.fromRank ? t('gxRankN', { n: num(r.fromRank) }) : r.toRank ? t('gxRankAB', { a: num(r.fromRank), b: num(r.toRank) }) : t('gxRankFrom', { a: num(r.fromRank) })}: {prizeText(r.prizeId, r.prizeGroupId)}
        </span>
      ))}
    </span>
  );
}

export function PlayerGamesCard(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const accountId = props.accountId ?? 0n;
  const boards = useRows('adminLeaderboards');
  const game = useGameName();
  const prizeText = usePrizeText();
  const { def } = useLanguages();
  const hist = useFetch(() => getConn().procedures.adminPlayerGames({ accountId }), [String(accountId)]);
  const active = boards.filter(b => b.isActive);
  const boardKey = active.map(b => `${b.id}:${b.currentPeriod}`).join(',');
  const pos = useFetch(async () => {
    const out: { board: GamesLeaderboard; rank: number; score: number; players: number }[] = [];
    for (const b of active) {
      let page = 1;
      for (;;) {
        const r = await getConn().procedures.adminLeaderboardStandings({ boardId: b.id, page, pageSize: 100 });
        const mine = r.rows.find(x => x.accountId === accountId);
        if (mine) {
          out.push({ board: b, rank: mine.rank, score: mine.score, players: r.total });
          break;
        }
        if (page * 100 >= r.total || page >= 5) break;
        page++;
      }
    }
    return out;
  }, [String(accountId), boardKey]);
  const tickets = hist.data?.tickets ?? [];
  const played = tickets.filter(x => x.matchId > 0n && x.status !== 'waiting').slice(0, 8);
  const waiting = tickets.filter(x => x.status === 'waiting' || (x.status === 'matched' && x.matchId > 0n));
  const wins = tickets.filter(x => x.outcome === 'win').length;
  const done = tickets.filter(x => x.outcome === 'win' || x.outcome === 'loss').length;
  const payouts = hist.data?.payouts ?? [];
  return (
    <Section
      title={t('gxCard')}
      testId="pd-games"
      action={
        <span className="row" style={{ gap: 4 }}>
          <a className="btn btn-sm" href={`#/matches?player=${accountId}`} data-testid="pg-matches">
            <Sword className="ic" />
            {t('gxAllMatches')}
          </a>
          <a className="btn btn-sm" href={`#/game-payouts?player=${accountId}`} data-testid="pg-payouts">
            <Coins className="ic" />
            {t('navGamePayouts')}
          </a>
        </span>
      }
    >
      {hist.error ? (
        <ErrBox text={errorText(hist.error)} />
      ) : !hist.data ? (
        <div className="stack">
          <dl className="stat-row" style={{ margin: 0 }}>
            {[0, 1, 2].map(i => (
              <Skel key={i} h={52} r={6} />
            ))}
          </dl>
          <Skel h={40} r={6} />
          <Skel h={40} r={6} />
        </div>
      ) : (
        <div className="stack">
          <dl className="stat-row" style={{ margin: 0 }} data-testid="pg-stats">
            <div className="stat">
              <dt>{t('gxPlayed')}</dt>
              <dd data-testid="pg-played">{num(done)}</dd>
            </div>
            <div className="stat">
              <dt>{t('gxWins')}</dt>
              <dd data-testid="pg-wins">{num(wins)}</dd>
            </div>
            <div className="stat">
              <dt>{t('gxPrizesWon')}</dt>
              <dd>{num(payouts.filter(p => p.status === 'granted').length)}</dd>
            </div>
          </dl>
          <div className="stack stack-sm">
            <span className="section-label">{t('gxRecent')}</span>
            {played.length === 0 ? (
              <span className="small muted">{t('gxNoMatches')}</span>
            ) : (
              <div className="list" data-testid="pg-list">
                {played.map(x => (
                  <a className="list-row gx-list-link" key={String(x.id)} href={`#/match?id=${x.matchId}`} data-testid={`pg-m-${x.matchId}`}>
                    <div className="list-main">
                      <span className="list-title">
                        {game(x.gameId)} · <span className="mono">#{digits(String(x.matchId))}</span>
                      </span>
                      <span className="list-sub">
                        {x.rank ? `${t('gxRankN', { n: num(x.rank) })} · ` : ''}
                        {x.outcome === 'win' || x.outcome === 'loss' ? `${t('gxScore')} ${fmtNum(x.score)} · ` : ''}
                        {us(x.updatedAt)}
                      </span>
                    </div>
                    {x.outcome ? outcomeBadge(x.outcome) : ticketBadge(x.status)}
                  </a>
                ))}
              </div>
            )}
          </div>
          {waiting.length > 0 && (
            <div className="stack stack-sm" data-testid="pg-waiting">
              <span className="section-label">{t('gxWaitingTickets')}</span>
              <div className="list">
                {waiting.map(x => (
                  <div className="list-row" key={String(x.id)}>
                    <div className="list-main">
                      <span className="list-title">{game(x.gameId)}</span>
                      <span className="list-sub">
                        {label(PATHS, x.path)} · {us(x.createdAt)}
                      </span>
                    </div>
                    {ticketBadge(x.status)}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="stack stack-sm" data-testid="pg-boards">
            <span className="section-label">{t('gxBoardPos')}</span>
            {!pos.data ? (
              <Skel h={32} r={6} />
            ) : pos.data.length === 0 ? (
              <span className="small muted">{t('gxNoBoards')}</span>
            ) : (
              <div className="list">
                {pos.data.map(x => (
                  <a className="list-row gx-list-link" key={String(x.board.id)} href={`#/leaderboard?id=${x.board.id}`} data-testid={`pg-b-${x.board.key}`}>
                    <div className="list-main">
                      <span className="list-title">{trText(x.board.name, def) || x.board.key}</span>
                      <span className="list-sub">
                        {t('gxScore')} {fmtNum(x.score)} · {t('gxOfN', { n: num(x.players) })}
                      </span>
                    </div>
                    <RankBadge rank={x.rank} />
                  </a>
                ))}
              </div>
            )}
          </div>
          {payouts.length > 0 && (
            <div className="stack stack-sm">
              <span className="section-label">{t('gxRecentPayouts')}</span>
              <div className="list" data-testid="pg-payouts-list">
                {payouts.slice(0, 5).map(p => (
                  <div className="list-row" key={String(p.id)}>
                    <div className="list-main">
                      <span className="list-title">{prizeText(p.prizeId, p.prizeGroupId)}</span>
                      <span className="list-sub">
                        {label(KINDS, p.kind)} · {when(p.createdAt)}
                      </span>
                    </div>
                    {payoutBadge(p.status)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

