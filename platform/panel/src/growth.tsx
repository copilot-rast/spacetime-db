import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  CheckCircle,
  ClockCounterClockwise,
  Eye,
  Flag,
  Hourglass,
  MagnifyingGlass,
  Plus,
  ShareNetwork,
  Sliders,
  ToggleRight,
  Trash,
  TreeStructure,
  Trophy,
  UserCircle,
  UsersThree,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { date, digits, errorText, getLocale, latin, num, t, useLocale, type StrKey } from './i18n.ts';
import { go, pageQuery, run, runToast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, Notice, NumInput, Pager, SaveButton, Skel, Spinner, Switch, SwitchRow, TableSkeleton, TrInputs, confirmAsk, trMissingDefault } from './ui.tsx';
import { FloatInput, Section, TagPicker, fmtNum, when } from './widgets.tsx';
import { ActiveBadge, AddButton, FormDialog, PageHead, del, save } from './economy.tsx';
import { CatalogTable, Choice, IdPick, KeyPick, useEventName, useLoaded } from './kit.tsx';
import { CountriesPick } from './promo.tsx';
import { playerIdOf } from './pubnotify.tsx';
import './growth.css';

const PAGE = 20;
const HPAGE = 8;

type Conn = ReturnType<typeof getConn>;
type RefLine = Awaited<ReturnType<Conn['procedures']['adminReferrals']>>['rows'][number];
type RefArgs = Parameters<Conn['reducers']['adminSaveReferralSettings']>[0];
type KeyRow = RowOf<'adminConfigKeys'>;
type Rule = KeyRow['rules'][number];
type HistRow = Awaited<ReturnType<Conn['procedures']['adminConfigHistory']>>['rows'][number];
type PreviewLine = Awaited<ReturnType<Conn['procedures']['adminConfigPreview']>>['values'][number];
type Snap = { type: string; description: string; value: string; text: Tr[]; rules: { name: string; value: string; text: Tr[] }[]; isActive: boolean; version: number };

export const GW_STATUS: [string, StrKey][] = [
  ['pending', 'gwStPending'],
  ['held', 'gwStHeld'],
  ['completed', 'gwStCompleted'],
  ['rejected', 'gwStRejected'],
];

const GW_FLAGS: [string, StrKey][] = [
  ['shared_device', 'gwFlSharedDevice'],
  ['shared_phone', 'gwFlSharedPhone'],
  ['burst', 'gwFlBurst'],
  ['same_device', 'gwFlSameDevice'],
];

const MEASURES: [string, StrKey][] = [
  ['count', 'gwMCount'],
  ['sum', 'gwMSum'],
  ['max', 'gwMMax'],
];

const TYPES: [string, StrKey][] = [
  ['string', 'gwTString'],
  ['number', 'gwTNumber'],
  ['bool', 'gwTBool'],
  ['json', 'gwTJson'],
  ['text', 'gwTText'],
];

const PLATFORMS: [string, StrKey][] = [
  ['android', 'plAndroid'],
  ['ios', 'plIos'],
  ['web', 'plWeb'],
  ['windows', 'plWindows'],
  ['macos', 'plMacos'],
  ['linux', 'plLinux'],
];

const HACTIONS: Record<string, [StrKey, string]> = {
  create: ['gwHCreate', 'b-ok'],
  update: ['gwHUpdate', 'b-info'],
  delete: ['gwHDelete', 'b-bad'],
  rollback: ['gwHRollback', 'b-violet'],
};

const KEY_RE = /^[a-z][a-z0-9_.]{1,63}$/;

function label(list: [string, StrKey][], v: string) {
  const k = list.find(x => x[0] === v)?.[1];
  return k ? t(k) : v;
}

export function refBadge(s: string) {
  const cls = s === 'pending' ? 'b-info' : s === 'held' ? 'b-warn' : s === 'completed' ? 'b-ok' : s === 'rejected' ? 'b-bad' : '';
  return <span className={`badge ${cls}`}>{label(GW_STATUS, s)}</span>;
}

function flagBadge(f: string) {
  return (
    <span className="badge b-warn gw-flag" key={f}>
      <Flag className="ic" />
      {label(GW_FLAGS, f)}
    </span>
  );
}

function us(v: bigint, withTime = true) {
  return v ? date(new Date(Number(v / 1000n)), withTime) : '—';
}

function pn(name: string, id: bigint) {
  if (!name) return `#${digits(String(id))}`;
  return /^#\d+$/.test(name) ? `#${digits(name.slice(1))}` : name;
}

function PlayerLink(props: { id: bigint; name: string; testId?: string }) {
  const { can } = useSession();
  const text = pn(props.name, props.id);
  if (!can('operator')) return <bdi data-testid={props.testId}>{text}</bdi>;
  return (
    <a className="row-link" href={`#/player?id=${props.id}`} data-testid={props.testId}>
      <bdi>{text}</bdi>
    </a>
  );
}

function TreeLink(props: { id: bigint; testId?: string }) {
  return (
    <a className="btn btn-sm btn-icon" href={`#/referral-tree?id=${props.id}`} aria-label={t('navReferralTree')} title={t('navReferralTree')} data-testid={props.testId}>
      <TreeStructure className="ic" />
    </a>
  );
}

function Progress(props: { r: RefLine }) {
  const eventName = useEventName();
  const r = props.r.referral;
  if (!r.goalEventKey) return <span className="small muted nowrap">{t('gwGoalNone')}</span>;
  const pct = r.goalValue > 0 ? Math.min(100, Math.round((props.r.progress / r.goalValue) * 100)) : 0;
  return (
    <span className="stack" style={{ gap: 4, minWidth: 110 }}>
      <span className="meter" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="small nowrap">{t('gwOfGoal', { a: fmtNum(props.r.progress), b: fmtNum(r.goalValue) })}</span>
      <span className="small muted" dir="auto">
        {eventName(r.goalEventKey)}
      </span>
    </span>
  );
}

function refArgs(s: RowOf<'adminReferralSettings'>): RefArgs {
  return {
    isEnabled: s.isEnabled,
    newAccountDays: s.newAccountDays,
    referrerPrizeId: s.referrerPrizeId,
    refereePrizeId: s.refereePrizeId,
    goalEventKey: s.goalEventKey,
    goalMeasure: s.goalMeasure,
    goalValue: s.goalValue,
    maxPerReferrer: s.maxPerReferrer,
    dailyPerReferrer: s.dailyPerReferrer,
    onePerDevice: s.onePerDevice,
    onePerPhone: s.onePerPhone,
    holdFlagged: s.holdFlagged,
    triesPerHour: s.triesPerHour,
  };
}

type RefNum = 'newAccountDays' | 'triesPerHour' | 'maxPerReferrer' | 'dailyPerReferrer';

const ENTRY_FIELDS: [RefNum, StrKey, StrKey][] = [
  ['newAccountDays', 'gwSNewDays', 'gwSNewDaysHint'],
  ['triesPerHour', 'gwSTries', 'gwSTriesHint'],
  ['maxPerReferrer', 'gwSMax', 'gwSMaxHint'],
  ['dailyPerReferrer', 'gwSDaily', 'gwSDailyHint'],
];

function SettingsSkel() {
  return (
    <div className="stack stack-lg">
      {[4, 2, 3, 3].map((n, j) => (
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

export function ReferralSettingsSection(props: { ro: boolean }) {
  useLocale();
  const s = useRows('adminReferralSettings')[0];
  const offset = useRows('adminSupportSettings')[0]?.clockOffsetSec ?? 0n;
  const [v, setV] = useState<RefArgs | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (s && !v) setV(refArgs(s));
  }, [s, v]);
  if (!v || !s) return <SettingsSkel />;
  const up = (p: Partial<RefArgs>) => setV({ ...v, ...p });
  return (
    <form
      className="stack stack-lg"
      data-testid="gw-settings"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        const r = await run(c => c.reducers.adminSaveReferralSettings(v), t('saved'));
        setBusy(false);
        setErr(r.ok ? null : errorText(r.err));
      }}
    >
      {offset !== 0n && <Notice kind="warn" text={t('gwClockOn')} />}
      <Section title={t('gwSEntry')}>
        <div className="stack">
          <SwitchRow checked={v.isEnabled} onChange={x => up({ isEnabled: x })} disabled={props.ro} label={t('gwSEnabled')} testId="gw-s-enabled" />
          <div className="form-grid">
            {ENTRY_FIELDS.map(([k, l, h]) => (
              <Field key={k} label={t(l)} hint={t(h)}>
                <NumInput value={v[k]} onChange={x => up({ [k]: Math.max(0, x) } as Partial<RefArgs>)} disabled={props.ro} name={k} />
              </Field>
            ))}
          </div>
        </div>
      </Section>
      <Section title={t('gwSPrizes')}>
        <div className="form-grid">
          <Field label={t('gwSReferrerPrize')} hint={t('gwSReferrerPrizeHint')}>
            {props.ro ? <input className="input" disabled value={v.referrerPrizeId ? `#${digits(String(v.referrerPrizeId))}` : t('gwNoPrize')} /> : <IdPick kind="prize" value={v.referrerPrizeId} onChange={x => up({ referrerPrizeId: x })} none={t('gwNoPrize')} testId="gw-s-referrer-prize" label={t('gwSReferrerPrize')} />}
          </Field>
          <Field label={t('gwSRefereePrize')} hint={t('gwSRefereePrizeHint')}>
            {props.ro ? <input className="input" disabled value={v.refereePrizeId ? `#${digits(String(v.refereePrizeId))}` : t('gwNoPrize')} /> : <IdPick kind="prize" value={v.refereePrizeId} onChange={x => up({ refereePrizeId: x })} none={t('gwNoPrize')} testId="gw-s-referee-prize" label={t('gwSRefereePrize')} />}
          </Field>
        </div>
      </Section>
      <Section title={t('gwSGoal')}>
        <div className="stack">
          <span className="small muted">{t('gwSGoalHint')}</span>
          <div className="form-grid gw-three">
            <Field label={t('gwSGoalEvent')}>
              {props.ro ? <input className="input ltr" disabled value={v.goalEventKey || t('gwGoalNone')} /> : <KeyPick kind="event" value={v.goalEventKey} onChange={x => up({ goalEventKey: x })} none={t('gwGoalAtOnce')} testId="gw-s-goal-event" label={t('gwSGoalEvent')} />}
            </Field>
            <Field label={t('gwSGoalMeasure')}>
              <select className="select" value={v.goalMeasure} onChange={e => up({ goalMeasure: e.target.value })} disabled={props.ro || !v.goalEventKey} name="goalMeasure" data-testid="gw-s-goal-measure">
                {MEASURES.map(([m, k]) => (
                  <option key={m} value={m}>
                    {t(k)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('gwSGoalValue')}>
              <FloatInput value={v.goalValue} onChange={x => up({ goalValue: x })} disabled={props.ro || !v.goalEventKey} name="goalValue" />
            </Field>
          </div>
        </div>
      </Section>
      <Section title={t('gwSFraud')}>
        <div className="stack">
          <SwitchRow checked={v.onePerDevice} onChange={x => up({ onePerDevice: x })} disabled={props.ro} label={t('gwSOneDevice')} testId="gw-s-device" />
          <SwitchRow checked={v.onePerPhone} onChange={x => up({ onePerPhone: x })} disabled={props.ro} label={t('gwSOnePhone')} testId="gw-s-phone" />
          <SwitchRow checked={v.holdFlagged} onChange={x => up({ holdFlagged: x })} disabled={props.ro} label={t('gwSHold')} testId="gw-s-hold" />
          <span className="small muted">{t('gwSFraudHint')}</span>
        </div>
      </Section>
      {props.ro ? (
        <Notice kind="plain" text={t('gwSReadOnly')} />
      ) : (
        <>
          <ErrBox text={err} />
          <div className="form-actions">
            <SaveButton busy={busy} testId="gw-s-save" />
          </div>
        </>
      )}
    </form>
  );
}

function DecideDialog(props: { line: RefLine; mode: 'approve' | 'reject'; onClose: () => void }) {
  const r = props.line.referral;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const approve = props.mode === 'approve';
  async function go() {
    setBusy(true);
    const res = approve
      ? await run(c => c.procedures.adminApproveReferral({ id: r.id, note }), t('gwApproved'))
      : await run(c => c.reducers.adminRejectReferral({ id: r.id, note }), t('gwRejected'));
    setBusy(false);
    if (res.ok) props.onClose();
    else setErr(errorText(res.err));
  }
  return (
    <Dialog
      title={approve ? t('gwApproveTitle') : t('gwRejectTitle')}
      onClose={props.onClose}
      width={480}
      testId="gw-decide"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button type="button" className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`} disabled={busy} onClick={go} data-testid="gw-decide-ok">
            {busy && <Spinner />}
            {approve ? t('gwApprove') : t('gwReject')}
          </button>
        </>
      }
    >
      <div className="stack">
        <dl className="kv">
          <dt>{t('gwInvited')}</dt>
          <dd>
            <bdi>{pn(props.line.refereeName, r.refereeId)}</bdi>
          </dd>
          <dt>{t('gwInviter')}</dt>
          <dd>
            <bdi>{pn(props.line.referrerName, r.referrerId)}</bdi>
          </dd>
          <dt>{t('status')}</dt>
          <dd>{refBadge(r.status)}</dd>
          {r.flags.length > 0 && (
            <>
              <dt>{t('gwFlags')}</dt>
              <dd className="chips">{r.flags.map(flagBadge)}</dd>
            </>
          )}
        </dl>
        <span className="small muted">{approve ? t('gwApproveHint') : t('gwRejectHint')}</span>
        <Field label={t('gwNote')} hint={t('optional')}>
          <textarea className="textarea" rows={3} dir="auto" maxLength={500} value={note} onChange={e => setNote(e.target.value)} name="note" data-testid="gw-decide-note" />
        </Field>
        <ErrBox text={err} />
      </div>
    </Dialog>
  );
}

type Tile = { key: string; label: string; value: string; icon: ReactNode; tint: string; on: boolean; go: () => void };

export function Referrals() {
  useLocale();
  const { can } = useSession();
  const q = useRoute().query;
  const f = {
    q: q.get('q') ?? '',
    status: q.get('status') ?? '',
    flag: q.get('flag') ?? '',
    flagged: q.get('flagged') === '1',
    referrer: q.get('referrer') ?? '',
    referee: q.get('referee') ?? '',
  };
  const [page, setPage] = useState(1);
  const [decide, setDecide] = useState<{ line: RefLine; mode: 'approve' | 'reject' } | null>(null);
  const set = (p: Partial<typeof f>) => {
    setPage(1);
    const n = { ...f, ...p };
    pageQuery('referrals', { q: n.q, status: n.status, flag: n.flag, flagged: n.flagged ? '1' : '', referrer: n.referrer, referee: n.referee });
  };
  const dq = useDebounced(f.q, 300);
  const referrerId = playerIdOf(f.referrer);
  const refereeId = playerIdOf(f.referee);
  const sum = useFetch(() => getConn().procedures.adminReferralSummary({}), []);
  const { data, error, loading } = useFetch(
    () => getConn().procedures.adminReferrals({ query: latin(dq), status: f.status, flag: f.flag, flagged: f.flagged, referrerId, refereeId, page, pageSize: PAGE }),
    [dq, f.status, f.flag, f.flagged, String(referrerId), String(refereeId), page]
  );
  const rows = data?.rows ?? [];
  const d = sum.data;
  const tiles: Tile[] = d
    ? [
        { key: 'total', label: t('gwSumTotal'), value: num(d.total), icon: <ShareNetwork className="ic" weight="duotone" />, tint: 'b-info', on: !f.status && !f.flagged, go: () => set({ status: '', flagged: false, flag: '' }) },
        { key: 'held', label: t('gwSumHeld'), value: num(d.held), icon: <Hourglass className="ic" weight="duotone" />, tint: d.held ? 'b-warn' : 'b-ok', on: f.status === 'held', go: () => set({ status: 'held', flagged: false }) },
        { key: 'pending', label: t('gwSumPending'), value: num(d.pending), icon: <ArrowsClockwise className="ic" weight="duotone" />, tint: 'b-violet', on: f.status === 'pending', go: () => set({ status: 'pending', flagged: false }) },
        { key: 'completed', label: t('gwSumCompleted'), value: num(d.completed), icon: <CheckCircle className="ic" weight="duotone" />, tint: 'b-ok', on: f.status === 'completed', go: () => set({ status: 'completed', flagged: false }) },
        { key: 'rejected', label: t('gwSumRejected'), value: num(d.rejected), icon: <XCircle className="ic" weight="duotone" />, tint: 'b-bad', on: f.status === 'rejected', go: () => set({ status: 'rejected', flagged: false }) },
        { key: 'flagged', label: t('gwSumFlagged'), value: num(d.flagged), icon: <Flag className="ic" weight="duotone" />, tint: d.flagged ? 'b-warn' : 'b-ok', on: f.flagged, go: () => set({ flagged: true, status: '' }) },
      ]
    : [];
  const actions = (x: RefLine, p: string) => (
    <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
      {can('admin') && x.referral.status === 'held' && (
        <button type="button" className="btn btn-sm btn-outline" onClick={() => setDecide({ line: x, mode: 'approve' })} data-testid={`${p}-approve-${x.referral.id}`}>
          <CheckCircle className="ic" />
          {t('gwApprove')}
        </button>
      )}
      {can('admin') && (x.referral.status === 'held' || x.referral.status === 'pending') && (
        <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => setDecide({ line: x, mode: 'reject' })} data-testid={`${p}-reject-${x.referral.id}`}>
          <XCircle className="ic" />
          {t('gwReject')}
        </button>
      )}
      <TreeLink id={x.referral.refereeId} testId={`${p}-tree-${x.referral.id}`} />
    </span>
  );
  const chip = (k: 'referrer' | 'referee', id: bigint) =>
    id > 0n && (
      <span className="chip" data-testid={`rf-f-${k}`}>
        {t(k === 'referrer' ? 'gwFReferrer' : 'gwFReferee', { id: digits(String(id)) })}
        <button type="button" className="btn btn-icon btn-sm gw-chip-x" onClick={() => set({ [k]: '' })} aria-label={t('gwClearFilter')}>
          <X className="ic" />
        </button>
      </span>
    );
  return (
    <main className="page" data-testid="page-referrals">
      <PageHead
        title={t('navReferrals')}
        sub={data ? t('gwRefTotal', { n: num(data.total) }) : <Skel w={80} h={10} />}
        action={
          can('admin') && (
            <a className="btn btn-outline" href="#/settings/referral-settings" data-testid="rf-settings">
              <Sliders className="ic" />
              {t('stReferralSettings')}
            </a>
          )
        }
      />
      <div className="stack stack-lg">
        <ErrBox text={sum.error ? errorText(sum.error) : null} />
        <div className="tiles gw-tiles" data-testid="rf-tiles">
          {!d
            ? Array.from({ length: 6 }).map((_, i) => (
                <div className="tile" key={i} style={{ cursor: 'default' }}>
                  <Skel w={40} h={40} r={8} style={{ gridRow: '1 / span 2' }} />
                  <Skel w="55%" h={10} />
                  <Skel w="35%" h={18} style={{ marginTop: 6 }} />
                </div>
              ))
            : tiles.map(x => (
                <button type="button" key={x.key} className="tile" aria-pressed={x.on} onClick={x.go} data-testid={`rf-tile-${x.key}`}>
                  <span className={`tile-ic badge ${x.tint}`} style={{ height: 40, padding: 0, justifyContent: 'center' }}>
                    {x.icon}
                  </span>
                  <span className="tile-label">{x.label}</span>
                  <span className="tile-value">{x.value}</span>
                </button>
              ))}
        </div>
        <div className="stack stack-lg">
          <div className="card">
            <div className="toolbar card-pad gw-toolbar">
              <div className="input-affix search">
                <MagnifyingGlass className="ic" />
                <input className="input" value={f.q} onChange={e => set({ q: e.target.value })} placeholder={t('gwRefSearch')} aria-label={t('gwRefSearch')} data-testid="rf-q" />
              </div>
              <select className="select gw-auto" value={f.status} onChange={e => set({ status: e.target.value })} aria-label={t('status')} data-testid="rf-f-status">
                <option value="">{t('gwAnyStatus')}</option>
                {GW_STATUS.map(([v, k]) => (
                  <option key={v} value={v}>
                    {t(k)}
                  </option>
                ))}
              </select>
              <select className="select gw-auto" value={f.flag} onChange={e => set({ flag: e.target.value })} aria-label={t('gwFlags')} data-testid="rf-f-flag">
                <option value="">{t('gwAnyFlag')}</option>
                {GW_FLAGS.map(([v, k]) => (
                  <option key={v} value={v}>
                    {t(k)}
                  </option>
                ))}
              </select>
              <button type="button" className="chip chip-btn" aria-pressed={f.flagged} onClick={() => set({ flagged: !f.flagged })} data-testid="rf-f-flagged">
                <Flag className="ic" />
                {t('gwFlaggedOnly')}
              </button>
              {chip('referrer', referrerId)}
              {chip('referee', refereeId)}
            </div>
            <ErrBox text={error ? errorText(error) : null} />
            <div className="table-wrap responsive gw-flat">
              <table className="table" data-testid="rf-table">
                <thead>
                  <tr>
                    <th>{t('gwInvited')}</th>
                    <th>{t('gwInviter')}</th>
                    <th>{t('status')}</th>
                    <th>{t('gwGoal')}</th>
                    <th>{t('gwEntered')}</th>
                    <th className="end" aria-label={t('actions')} />
                  </tr>
                </thead>
                <tbody>
                  {loading && !data ? (
                    <TableSkeleton cols={6} />
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <Empty icon={<ShareNetwork className="ic" weight="duotone" />} title={t('gwNoRefs')} text={t('gwNoRefsHint')} />
                      </td>
                    </tr>
                  ) : (
                    rows.map(x => (
                      <tr key={String(x.referral.id)} data-testid={`rf-row-${x.referral.id}`}>
                        <td className="nowrap">
                          <PlayerLink id={x.referral.refereeId} name={x.refereeName} />
                        </td>
                        <td>
                          <PlayerLink id={x.referral.referrerId} name={x.referrerName} />
                          <div className="small muted cell-detail">
                            <span className="mono">{digits(x.referral.code)}</span>
                          </div>
                        </td>
                        <td>
                          <span className="row row-wrap" style={{ gap: 4 }}>
                            {refBadge(x.referral.status)}
                            {x.referral.flags.map(flagBadge)}
                          </span>
                          {x.referral.note && (
                            <div className="small muted cell-detail" dir="auto">
                              {x.referral.note}
                            </div>
                          )}
                        </td>
                        <td>
                          <Progress r={x} />
                        </td>
                        <td className="small nowrap">{us(x.referral.createdAt)}</td>
                        <td className="end">{actions(x, 'rf')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="cards" data-testid="rf-cards">
                {data && rows.length === 0 && <Empty icon={<ShareNetwork className="ic" weight="duotone" />} title={t('gwNoRefs')} />}
                {rows.map(x => (
                  <div className="pcard" key={String(x.referral.id)} data-testid={`rfc-${x.referral.id}`}>
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <span className="grow primary">
                        <bdi>{pn(x.refereeName, x.referral.refereeId)}</bdi>
                      </span>
                      {refBadge(x.referral.status)}
                    </div>
                    {x.referral.flags.length > 0 && <div className="row row-wrap" style={{ gap: 4 }}>{x.referral.flags.map(flagBadge)}</div>}
                    <div className="pcard-meta">
                      <span>{t('gwInviter')}</span>
                      <span>
                        <bdi>{pn(x.referrerName, x.referral.referrerId)}</bdi>
                      </span>
                      <span>{t('gwCode')}</span>
                      <span className="mono">{digits(x.referral.code)}</span>
                      <span>{t('gwGoal')}</span>
                      <span>{x.referral.goalEventKey ? t('gwOfGoal', { a: fmtNum(x.progress), b: fmtNum(x.referral.goalValue) }) : t('gwGoalNone')}</span>
                      <span>{t('gwEntered')}</span>
                      <span>{us(x.referral.createdAt)}</span>
                    </div>
                    {actions(x, 'rfc')}
                  </div>
                ))}
              </div>
              {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
            </div>
          </div>
          <Section title={t('gwTop')} pad={false} testId="rf-top">
            {!d ? (
              <div className="list">
                {[0, 1, 2, 3].map(i => (
                  <div className="list-row" key={i}>
                    <div className="list-main stack stack-sm" style={{ gap: 6 }}>
                      <Skel w="50%" h={11} />
                      <Skel w="30%" h={9} />
                    </div>
                  </div>
                ))}
              </div>
            ) : d.top.length === 0 ? (
              <Empty icon={<Trophy className="ic" weight="duotone" />} title={t('gwTopEmpty')} />
            ) : (
              <div className="list">
                {d.top.map((x, i) => (
                  <div className="list-row" key={String(x.accountId)} data-testid={`rf-top-${x.accountId}`}>
                    <span className="gw-rank">{num(i + 1)}</span>
                    <div className="list-main">
                      <span className="list-title">
                        <PlayerLink id={x.accountId} name={x.name} />
                      </span>
                      <span className="list-sub">{t('gwTopLine', { n: num(x.total), c: num(x.completed) })}</span>
                    </div>
                    <button type="button" className="btn btn-sm btn-icon" onClick={() => set({ referrer: String(x.accountId), referee: '' })} aria-label={t('gwShowInvites')} title={t('gwShowInvites')}>
                      <UsersThree className="ic" />
                    </button>
                    <TreeLink id={x.accountId} />
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
      {decide && <DecideDialog line={decide.line} mode={decide.mode} onClose={() => setDecide(null)} />}
    </main>
  );
}

function usePlayerRefs(accountId: bigint) {
  const base = { query: '', status: '', flag: '', flagged: false, page: 1, pageSize: 1 };
  const tree = useFetch(() => (accountId ? getConn().procedures.adminReferralTree({ accountId }) : Promise.resolve(undefined)), [String(accountId)]);
  const mine = useFetch(() => (accountId ? getConn().procedures.adminReferrals({ ...base, referrerId: 0n, refereeId: accountId }) : Promise.resolve(undefined)), [String(accountId)]);
  const invites = useFetch(() => (accountId ? getConn().procedures.adminReferrals({ ...base, referrerId: accountId, refereeId: 0n }) : Promise.resolve(undefined)), [String(accountId)]);
  const by = mine.data?.rows[0];
  const inv = invites.data?.rows[0];
  const down = tree.data?.down ?? [];
  return {
    ready: !!tree.data && !!mine.data && !!invites.data,
    error: tree.error ?? mine.error ?? invites.error,
    tree: tree.data,
    by,
    code: inv?.referral.code ?? '',
    name: by?.refereeName || inv?.referrerName || '',
    counts: {
      total: down.filter(x => x.status !== 'rejected').length,
      completed: down.filter(x => x.status === 'completed').length,
      pending: down.filter(x => x.status === 'pending').length,
      held: down.filter(x => x.status === 'held').length,
      rejected: down.filter(x => x.status === 'rejected').length,
    },
  };
}

function TreeSkel() {
  return (
    <div className="stack stack-lg">
      <section className="card card-pad stack">
        {[0, 1, 2].map(i => (
          <div className="gw-node" key={i}>
            <Skel w={32} h={32} r={16} />
            <div className="grow stack stack-sm" style={{ gap: 6 }}>
              <Skel w="30%" h={11} />
              <Skel w="20%" h={9} />
            </div>
          </div>
        ))}
      </section>
      <section className="card">
        <table className="table">
          <tbody>
            <TableSkeleton cols={3} rows={3} />
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function ReferralTree() {
  useLocale();
  const raw = useRoute().query.get('id') ?? '';
  const id = playerIdOf(raw);
  const [box, setBox] = useState(raw ? digits(raw) : '');
  const p = usePlayerRefs(id);
  const chain = [...(p.tree?.up ?? [])].reverse();
  const down = p.tree?.down ?? [];
  return (
    <main className="page" data-testid="page-referral-tree">
      <PageHead title={t('navReferralTree')} sub={t('gwTreeSub')} />
      <form
        className="toolbar"
        onSubmit={e => {
          e.preventDefault();
          const v = playerIdOf(box);
          if (v) go(`referral-tree?id=${v}`);
        }}
      >
        <div className="input-affix search">
          <UserCircle className="ic" />
          <input className="input" value={box} onChange={e => setBox(e.target.value)} placeholder={t('gwPlayerIdPh')} aria-label={t('gwPlayerId')} inputMode="numeric" name="playerId" data-testid="rt-id" />
        </div>
        <button type="submit" className="btn btn-primary" data-testid="rt-go">
          <TreeStructure className="ic" />
          {t('gwShowTree')}
        </button>
      </form>
      {!id ? (
        <section className="card">
          <Empty icon={<TreeStructure className="ic" weight="duotone" />} title={t('gwTreePick')} text={t('gwTreePickHint')} />
        </section>
      ) : p.error ? (
        <ErrBox text={errorText(p.error)} />
      ) : !p.ready ? (
        <TreeSkel />
      ) : (
        <div className="stack stack-lg">
          <Section
            title={t('gwChain')}
            testId="rt-chain"
            action={
              <a className="btn btn-sm" href={`#/referrals?referrer=${id}`} data-testid="rt-list">
                <ShareNetwork className="ic" />
                {t('gwShowInvites')}
              </a>
            }
          >
            <div className="gw-chain">
              {chain.length === 0 && <span className="small muted gw-chain-note">{t('gwNoInviter')}</span>}
              {chain.map((x, i) => (
                <div className="gw-node" key={String(x.accountId)} data-testid={`rt-up-${x.accountId}`}>
                  <span className="gw-dot">{num(chain.length - i)}</span>
                  <div className="grow list-main">
                    <span className="list-title">
                      <PlayerLink id={x.accountId} name={x.name} />
                    </span>
                    <span className="list-sub">{t('gwInvitedNext', { d: us(x.createdAt, false) })}</span>
                  </div>
                  {refBadge(x.status)}
                  <TreeLink id={x.accountId} />
                </div>
              ))}
              <div className="gw-node is-me" data-testid="rt-me">
                <span className="gw-dot">
                  <UserCircle className="ic" />
                </span>
                <div className="grow list-main">
                  <span className="list-title">
                    <PlayerLink id={id} name={p.name} />
                  </span>
                  <span className="list-sub">
                    {p.code ? (
                      <>
                        {t('gwCode')}: <span className="mono">{digits(p.code)}</span>
                        {t('gwSep')}
                      </>
                    ) : null}
                    {t('gwTopLine', { n: num(p.counts.total), c: num(p.counts.completed) })}
                  </span>
                </div>
              </div>
            </div>
          </Section>
          <Section title={t('gwInvitedList', { n: num(down.length) })} pad={false} testId="rt-down">
            {down.length === 0 ? (
              <Empty icon={<UsersThree className="ic" weight="duotone" />} title={t('gwNoInvites')} />
            ) : (
              <div className="list">
                {down.map(x => (
                  <div className="list-row" key={String(x.accountId)} data-testid={`rt-down-${x.accountId}`}>
                    <div className="list-main">
                      <span className="list-title">
                        <PlayerLink id={x.accountId} name={x.name} />
                      </span>
                      <span className="list-sub">{us(x.createdAt)}</span>
                    </div>
                    {refBadge(x.status)}
                    <TreeLink id={x.accountId} />
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </main>
  );
}

export function PlayerReferralCard(props: { accountId: bigint }) {
  useLocale();
  const p = usePlayerRefs(props.accountId);
  return (
    <Section
      title={t('gwCard')}
      testId="pd-referral"
      action={
        <span className="row" style={{ gap: 4 }}>
          <a className="btn btn-sm" href={`#/referrals?referrer=${props.accountId}`} data-testid="pr-list">
            <ShareNetwork className="ic" />
            {t('gwShowInvites')}
          </a>
          <a className="btn btn-sm" href={`#/referral-tree?id=${props.accountId}`} data-testid="pr-tree">
            <TreeStructure className="ic" />
            {t('navReferralTree')}
          </a>
        </span>
      }
    >
      {p.error ? (
        <ErrBox text={errorText(p.error)} />
      ) : !p.ready ? (
        <div className="stack">
          <div className="gw-stats">
            {[0, 1, 2, 3].map(i => (
              <Skel key={i} h={52} r={6} />
            ))}
          </div>
          <Skel h={20} w="60%" />
        </div>
      ) : (
        <div className="stack">
          <div className="gw-stats" data-testid="pr-stats">
            <div className="gw-stat">
              <span className="small muted">{t('gwCode')}</span>
              <b className="mono" data-testid="pr-code">
                {p.code ? digits(p.code) : '—'}
              </b>
            </div>
            <div className="gw-stat">
              <span className="small muted">{t('gwInvites')}</span>
              <b data-testid="pr-total">{num(p.counts.total)}</b>
            </div>
            <div className="gw-stat">
              <span className="small muted">{t('gwStCompleted')}</span>
              <b data-testid="pr-completed">{num(p.counts.completed)}</b>
            </div>
            <div className="gw-stat">
              <span className="small muted">{t('gwWaiting')}</span>
              <b data-testid="pr-waiting">{t('gwWaitingN', { p: num(p.counts.pending), h: num(p.counts.held) })}</b>
            </div>
          </div>
          <div className="row row-wrap" style={{ gap: 6 }} data-testid="pr-by">
            {p.by ? (
              <>
                <span className="small muted">{t('gwInvitedBy')}</span>
                <PlayerLink id={p.by.referral.referrerId} name={p.by.referrerName} />
                {refBadge(p.by.referral.status)}
                {p.by.referral.flags.map(flagBadge)}
                <span className="small muted">{us(p.by.referral.createdAt)}</span>
              </>
            ) : (
              <span className="small muted">{t('gwNoInviter')}</span>
            )}
          </div>
          {!p.code && <span className="small muted">{t('gwCodeHidden')}</span>}
        </div>
      )}
    </Section>
  );
}

function emptyValue(type: string) {
  return type === 'number' ? '0' : type === 'bool' ? 'false' : type === 'json' ? '{}' : '';
}

function jsonOk(v: string) {
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}

function valueProblem(type: string, value: string, text: Tr[], def: string) {
  if (type === 'text') return trMissingDefault(text, def) ? t('trRequired', { lang: def }) : null;
  if (type === 'number' && (value.trim() === '' || !Number.isFinite(Number(value)))) return t('gwNumberBad');
  if (type === 'json' && !jsonOk(value)) return t('gwJsonBad');
  return null;
}

function pct(bucket: number) {
  const v = fmtNum(bucket / 100);
  return t('gwBucketPct', { n: getLocale() === 'fa' ? v.replace('.', '٫') : v });
}

function short(s: string, n = 48) {
  const v = s.replace(/\s+/g, ' ').trim();
  return v.length > n ? `${v.slice(0, n)}…` : v;
}

function useValueText() {
  const { def } = useLanguages();
  return (type: string, value: string, text: Tr[]) => {
    if (type === 'text') return short(trText(text, def)) || '—';
    if (type === 'bool') return value === 'true' ? t('gwTrue') : t('gwFalse');
    if (type === 'number') return digits(value);
    return short(value) || '—';
  };
}

function ValueEdit(props: { type: string; value: string; text: Tr[]; onChange: (value: string, text: Tr[]) => void; name: string; testId: string }) {
  if (props.type === 'bool')
    return (
      <label className="check">
        <Switch checked={props.value === 'true'} onChange={x => props.onChange(x ? 'true' : 'false', [])} label={props.value === 'true' ? t('gwTrue') : t('gwFalse')} testId={props.testId} />
        {props.value === 'true' ? t('gwTrue') : t('gwFalse')}
      </label>
    );
  if (props.type === 'text') return <TrInputs value={props.text} onChange={x => props.onChange('', x)} multiline name={props.name} />;
  if (props.type === 'json')
    return <textarea className="textarea ltr mono gw-json" rows={4} spellCheck={false} value={props.value} onChange={e => props.onChange(e.target.value, [])} name={props.name} data-testid={props.testId} />;
  if (props.type === 'number')
    return <input className="input ltr" inputMode="decimal" value={digits(props.value)} onChange={e => props.onChange(latin(e.target.value).replace('٫', '.'), [])} name={props.name} data-testid={props.testId} />;
  return <input className="input" dir="auto" value={props.value} onChange={e => props.onChange(e.target.value, [])} name={props.name} data-testid={props.testId} />;
}

function ValueField(props: { type: string; value: string; text: Tr[]; onChange: (value: string, text: Tr[]) => void; name: string; testId: string; label: string; hint?: string }) {
  const err = props.type === 'json' && !jsonOk(props.value) ? t('gwJsonBad') : props.type === 'number' && props.value.trim() !== '' && !Number.isFinite(Number(props.value)) ? t('gwNumberBad') : undefined;
  return (
    <Field label={props.label} hint={props.hint} error={err} className="span-2">
      <ValueEdit {...props} />
    </Field>
  );
}

function newRule(type: string, i: number): Rule {
  return { name: `rule_${i + 1}`, value: emptyValue(type), text: [], platforms: [], minVersion: '', maxVersion: '', tagIds: [], countries: [], percent: 100 };
}

function RulesEdit(props: { type: string; rules: Rule[]; onChange: (v: Rule[]) => void }) {
  const set = (i: number, p: Partial<Rule>) => props.onChange(props.rules.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const move = (i: number, d: number) => {
    const list = [...props.rules];
    const [x] = list.splice(i, 1);
    list.splice(i + d, 0, x);
    props.onChange(list);
  };
  return (
    <div className="stack" data-testid="rc-rules">
      {props.rules.length === 0 && <Notice kind="plain" text={t('gwNoRules')} />}
      {props.rules.map((r, i) => (
        <div className="gw-rule" key={i} data-testid={`rc-rule-${i}`}>
          <div className="gw-rule-head">
            <span className="gw-dot">{num(i + 1)}</span>
            <input className="input ltr gw-rule-name" value={r.name} onChange={e => set(i, { name: e.target.value })} aria-label={t('gwRuleName')} placeholder={t('gwRuleName')} name={`rule-name-${i}`} />
            <span className="grow" />
            <button type="button" className="btn btn-sm btn-icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('gwMoveUp')} title={t('gwMoveUp')} data-testid={`rc-rule-${i}-up`}>
              <ArrowUp className="ic" />
            </button>
            <button type="button" className="btn btn-sm btn-icon" disabled={i === props.rules.length - 1} onClick={() => move(i, 1)} aria-label={t('gwMoveDown')} title={t('gwMoveDown')} data-testid={`rc-rule-${i}-down`}>
              <ArrowDown className="ic" />
            </button>
            <button type="button" className="btn btn-sm btn-icon btn-danger-ghost" onClick={() => props.onChange(props.rules.filter((_, k) => k !== i))} aria-label={t('delete')} title={t('delete')} data-testid={`rc-rule-${i}-del`}>
              <Trash className="ic" />
            </button>
          </div>
          <div className="form-grid">
            <ValueField type={props.type} value={r.value} text={r.text} onChange={(value, text) => set(i, { value, text })} name={`rule-value-${i}`} testId={`rc-rule-${i}-value`} label={t('gwRuleValue')} />
            <Field label={t('gwPlatforms')} hint={t('gwAnyHint')} className="span-2">
              <div className="chips" data-testid={`rc-rule-${i}-platforms`}>
                {PLATFORMS.map(([p, k]) => (
                  <button
                    type="button"
                    key={p}
                    className="chip chip-btn"
                    aria-pressed={r.platforms.includes(p)}
                    onClick={() => set(i, { platforms: r.platforms.includes(p) ? r.platforms.filter(x => x !== p) : [...r.platforms, p] })}
                    data-testid={`rc-rule-${i}-pf-${p}`}
                  >
                    {t(k)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t('gwMinVersion')} hint={t('optional')}>
              <input className="input ltr" value={r.minVersion} onChange={e => set(i, { minVersion: latin(e.target.value) })} placeholder="1.0.0" name={`rule-min-${i}`} />
            </Field>
            <Field label={t('gwMaxVersion')} hint={t('optional')}>
              <input className="input ltr" value={r.maxVersion} onChange={e => set(i, { maxVersion: latin(e.target.value) })} placeholder="2.0.0" name={`rule-max-${i}`} />
            </Field>
            <Field label={t('gwPercent')} hint={t('gwPercentHint')}>
              <FloatInput value={r.percent} onChange={x => set(i, { percent: x })} name={`rule-percent-${i}`} />
            </Field>
            <Field label={t('gwCountries')} hint={t('gwAnyHint')}>
              <CountriesPick value={r.countries} onChange={x => set(i, { countries: x })} />
            </Field>
            <Field label={t('gwTags')} hint={t('gwTagsHint')} className="span-2">
              <TagPicker keyType="user" value={r.tagIds} onChange={x => set(i, { tagIds: x })} testId={`rc-rule-${i}-tags`} />
            </Field>
          </div>
        </div>
      ))}
      {props.rules.length < 20 && (
        <div className="row">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onChange([...props.rules, newRule(props.type, props.rules.length)])} data-testid="rc-rule-add">
            <Plus className="ic" />
            {t('gwAddRule')}
          </button>
        </div>
      )}
    </div>
  );
}

function ConfigDialog(props: { row?: KeyRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [type, setType] = useState(r?.type ?? 'string');
  const [description, setDescription] = useState(r?.description ?? '');
  const [value, setValue] = useState(r?.value ?? '');
  const [text, setText] = useState<Tr[]>(r?.text ?? []);
  const [rules, setRules] = useState<Rule[]>(r?.rules ?? []);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const version = r?.version ?? 0;
  return (
    <FormDialog
      title={r ? t('gwEditKey', { k: r.key }) : t('gwNewKey')}
      testId="rc-dialog"
      width={760}
      onClose={props.onClose}
      submit={async () => {
        const k = key.trim();
        if (!KEY_RE.test(k)) return { ok: false, msg: t('gwKeyRule') };
        const bad = valueProblem(type, value, text, def);
        if (bad) return { ok: false, msg: bad };
        for (const x of rules) {
          const b = valueProblem(type, x.value, x.text, def);
          if (b) return { ok: false, msg: t('gwRuleProblem', { name: x.name, why: b }) };
        }
        return save(() => getConn().reducers.adminSaveConfigKey({ key: k, version, type, description, value: type === 'text' ? '' : value, text: type === 'text' ? text : [], rules, isActive }));
      }}
    >
      <Field label={t('gwKey')} hint={r ? t('gwKeyLocked') : t('gwKeyHint')}>
        <input className="input ltr mono" value={key} onChange={e => setKey(e.target.value.toLowerCase())} disabled={!!r} name="key" placeholder="shop.banner_text" />
      </Field>
      <Field label={t('gwType')} hint={r ? t('gwTypeLocked') : undefined}>
        {r ? (
          <input className="input" disabled value={label(TYPES, type)} />
        ) : (
          <Choice
            value={type}
            onChange={v => {
              setType(v);
              setValue(emptyValue(v));
              setText([]);
              setRules(rules.map(x => ({ ...x, value: emptyValue(v), text: [] })));
            }}
            options={TYPES}
            name="type"
            testId="rc-type"
            label={t('gwType')}
          />
        )}
      </Field>
      <Field label={t('description')} hint={t('optional')} className="span-2">
        <input className="input" dir="auto" value={description} maxLength={500} onChange={e => setDescription(e.target.value)} name="description" />
      </Field>
      <ValueField type={type} value={value} text={text} onChange={(v, x) => (setValue(v), setText(x))} name="value" testId="rc-value" label={t('gwDefault')} hint={t('gwDefaultHint')} />
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('gwActiveHint')} testId="rc-active" />
      </div>
      <div className="span-2 stack stack-sm">
        <span className="section-label">{t('gwRules')}</span>
        <span className="small muted">{t('gwRulesHint')}</span>
        <RulesEdit type={type} rules={rules} onChange={setRules} />
      </div>
      {r && (
        <div className="span-2">
          <span className="small muted" data-testid="rc-version">
            {t('gwEditingVersion', { v: num(version) })}
          </span>
        </div>
      )}
    </FormDialog>
  );
}

function snapOf(s: string): Snap | null {
  try {
    return JSON.parse(s) as Snap;
  } catch {
    return null;
  }
}

function useAdminName() {
  const admins = useRows('adminAdmins');
  return (id: bigint) => {
    const a = admins.find(x => x.accountId === id);
    return a ? a.displayName || a.username : id ? `#${digits(String(id))}` : '—';
  };
}

function HistoryDialog(props: { k: string; current?: KeyRow; onClose: () => void }) {
  useLocale();
  const { can } = useSession();
  const keys = useRows('adminConfigKeys');
  const valueText = useValueText();
  const adminName = useAdminName();
  const [page, setPage] = useState(1);
  const { data, error, loading } = useFetch(() => getConn().procedures.adminConfigHistory({ key: props.k, page, pageSize: HPAGE }), [props.k, page]);
  const rows = data?.rows ?? [];
  const summary = (h: HistRow, i: number) => {
    const s = snapOf(h.snapshot);
    if (!s) return '';
    const prev = rows.slice(i + 1).find(x => x.key === h.key);
    const p = prev ? snapOf(prev.snapshot) : null;
    if (h.action === 'delete') return t('gwDDeleted');
    if (!p) return t('gwDInitial', { v: valueText(s.type, s.value, s.text), n: num(s.rules.length) });
    const out: string[] = [];
    if (s.value !== p.value || JSON.stringify(s.text) !== JSON.stringify(p.text)) out.push(t('gwDValue', { a: valueText(p.type, p.value, p.text), b: valueText(s.type, s.value, s.text) }));
    if (JSON.stringify(s.rules) !== JSON.stringify(p.rules)) out.push(s.rules.length !== p.rules.length ? t('gwDRulesN', { a: num(p.rules.length), b: num(s.rules.length) }) : t('gwDRules'));
    if (s.isActive !== p.isActive) out.push(s.isActive ? t('gwDOn') : t('gwDOff'));
    if (s.description !== p.description) out.push(t('gwDDesc'));
    return out.length ? out.join(t('gwSep')) : t('gwDSame');
  };
  async function rollback(h: HistRow) {
    if (!(await confirmAsk(t('gwRollbackConfirm', { k: h.key, v: num(h.version) }), { ok: t('gwRollback') }))) return;
    await runToast(c => c.reducers.adminRollbackConfig({ key: h.key, version: h.version }), t('gwRolledBack'));
  }
  return (
    <Dialog title={props.k ? t('gwHistoryOf', { k: props.k }) : t('gwHistoryAll')} onClose={props.onClose} width={680} testId="rc-history">
      <div className="stack">
        <ErrBox text={error ? errorText(error) : null} />
        {loading && !data ? (
          <div className="list">
            {[0, 1, 2].map(i => (
              <div className="list-row" key={i}>
                <Skel w={44} h={22} r={6} />
                <div className="list-main stack stack-sm" style={{ gap: 6 }}>
                  <Skel w="50%" h={11} />
                  <Skel w="30%" h={9} />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty icon={<ClockCounterClockwise className="ic" weight="duotone" />} title={t('gwHistoryEmpty')} />
        ) : (
          <div className="list gw-hist">
            {rows.map((h, i) => {
              const [k, cls] = HACTIONS[h.action] ?? ['gwHUpdate', ''];
              const s = snapOf(h.snapshot);
              const live = keys.find(x => x.key === h.key);
              const canRoll = can('admin') && h.action !== 'delete' && (!live || live.version !== h.version);
              return (
                <div className="list-row" key={String(h.id)} data-testid={`rh-row-${h.key}-${h.version}${h.action === 'delete' ? '-del' : ''}`}>
                  <span className="badge gw-ver">{t('gwV', { v: num(h.version) })}</span>
                  <div className="list-main">
                    <span className="list-title row row-wrap" style={{ gap: 6 }}>
                      <span className={`badge ${cls}`}>{t(k)}</span>
                      {!props.k && <bdi className="mono">{h.key}</bdi>}
                      <span className="small" dir="auto" data-testid={`rh-sum-${h.key}-${h.version}`}>
                        {summary(h, i)}
                      </span>
                    </span>
                    <span className="list-sub">
                      <bdi>{adminName(h.by)}</bdi>
                      {t('gwSep')}
                      {when(h.at)}
                    </span>
                    {s && s.rules.length > 0 && (
                      <span className="chips" style={{ marginTop: 4 }}>
                        {s.rules.map(x => (
                          <span className="chip mono" key={x.name}>
                            {x.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  {canRoll && (
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => rollback(h)} data-testid={`rh-rollback-${h.key}-${h.version}`}>
                      <ClockCounterClockwise className="ic" />
                      {t('gwRollback')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {data && data.total > HPAGE && <Pager page={page} pageSize={HPAGE} total={data.total} onPage={setPage} />}
      </div>
    </Dialog>
  );
}

function PreviewDialog(props: { onClose: () => void }) {
  useLocale();
  const { active } = useLanguages();
  const countries = useRows('country');
  const { def } = useLanguages();
  const valueText = useValueText();
  const [player, setPlayer] = useState('');
  const [platform, setPlatform] = useState('');
  const [version, setVersion] = useState('');
  const [country, setCountry] = useState('');
  const [tagIds, setTagIds] = useState<bigint[]>([]);
  const [lang, setLang] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ lang: string; values: PreviewLine[] } | null>(null);
  async function show() {
    setBusy(true);
    const r = await run(c => c.procedures.adminConfigPreview({ accountId: playerIdOf(player), platform, version: latin(version).trim(), country, tagIds, lang }));
    setBusy(false);
    if (r.ok) {
      setErr(null);
      setRes(r.value);
    } else {
      setErr(errorText(r.err));
      setRes(null);
    }
  }
  return (
    <Dialog title={t('gwPreview')} onClose={props.onClose} width={760} testId="rc-preview">
      <form
        className="stack"
        onSubmit={e => {
          e.preventDefault();
          show();
        }}
      >
        <span className="small muted">{t('gwPreviewHint')}</span>
        <div className="form-grid gw-three">
          <Field label={t('gwPlayerId')}>
            <input className="input ltr" inputMode="numeric" value={player} onChange={e => setPlayer(e.target.value)} placeholder={t('gwPlayerIdPh')} name="accountId" data-testid="pv-player" />
          </Field>
          <Field label={t('gwPlatform')}>
            <select className="select" value={platform} onChange={e => setPlatform(e.target.value)} name="platform" data-testid="pv-platform">
              <option value="">{t('gwTheirs')}</option>
              {PLATFORMS.map(([p, k]) => (
                <option key={p} value={p}>
                  {t(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('gwAppVersion')}>
            <input className="input ltr" value={version} onChange={e => setVersion(e.target.value)} placeholder={t('gwTheirs')} name="version" data-testid="pv-version" />
          </Field>
          <Field label={t('gwCountry')}>
            <select className="select" value={country} onChange={e => setCountry(e.target.value)} name="country" data-testid="pv-country">
              <option value="">{t('gwTheirs')}</option>
              {[...countries]
                .filter(c => c.isActive)
                .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code))
                .map(c => (
                  <option key={c.code} value={c.code}>
                    {trText(c.name, def) || c.code}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t('gwLang')}>
            <select className="select" value={lang} onChange={e => setLang(e.target.value)} name="lang" data-testid="pv-lang">
              <option value="">{t('gwTheirs')}</option>
              {active.map(l => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('gwTags')} hint={t('gwPreviewTagsHint')} className="gw-span-all">
            <TagPicker keyType="user" value={tagIds} onChange={setTagIds} testId="pv-tags" />
          </Field>
        </div>
        <div className="row">
          <span className="grow" />
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="pv-run">
            {busy ? <Spinner /> : <Eye className="ic" />}
            {t('gwPreviewRun')}
          </button>
        </div>
        <ErrBox text={err} />
        {res && (
          <div className="table-wrap responsive" data-testid="pv-result">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('gwKey')}</th>
                  <th>{t('gwValue')}</th>
                  <th>{t('gwVariant')}</th>
                  <th>{t('gwBucket')}</th>
                </tr>
              </thead>
              <tbody>
                {res.values.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <Empty icon={<ToggleRight className="ic" weight="duotone" />} title={t('gwNoActiveKeys')} />
                    </td>
                  </tr>
                ) : (
                  res.values.map(v => (
                    <tr key={v.key} data-testid={`pv-row-${v.key}`}>
                      <td className="mono">{v.key}</td>
                      <td className="gw-val" dir="auto">
                        {valueText(v.type, v.value, [{ lang: res.lang, text: v.value }])}
                      </td>
                      <td>
                        <span className={`badge ${v.variant === 'default' ? '' : 'b-violet'}`} data-testid={`pv-variant-${v.key}`}>
                          {v.variant === 'default' ? t('gwDefaultVariant') : v.variant}
                        </span>
                      </td>
                      <td className="small nowrap">{pct(v.bucket)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="cards">
              {res.values.map(v => (
                <div className="pcard" key={v.key}>
                  <div className="row">
                    <span className="grow mono">{v.key}</span>
                    <span className={`badge ${v.variant === 'default' ? '' : 'b-violet'}`}>{v.variant === 'default' ? t('gwDefaultVariant') : v.variant}</span>
                  </div>
                  <div className="pcard-meta">
                    <span>{t('gwValue')}</span>
                    <span dir="auto">{valueText(v.type, v.value, [{ lang: res.lang, text: v.value }])}</span>
                    <span>{t('gwBucket')}</span>
                    <span>{pct(v.bucket)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}

export function RemoteConfig() {
  useLocale();
  const all = useRows('adminConfigKeys');
  const loaded = useLoaded();
  const valueText = useValueText();
  const q = useRoute().query.get('q') ?? '';
  const [edit, setEdit] = useState<KeyRow | 'new' | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const s = latin(q).trim().toLowerCase();
  const rows = [...all].filter(k => !s || k.key.includes(s) || k.description.toLowerCase().includes(s)).sort((a, b) => a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-remote-config">
      <PageHead
        title={t('navRemoteConfig')}
        sub={loaded ? t('gwKeysTotal', { n: num(all.length), a: num(all.filter(k => k.isActive).length) }) : <Skel w={80} h={10} />}
        action={<AddButton label={t('gwNewKey')} onClick={() => setEdit('new')} testId="rc-add" />}
      />
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input className="input" value={q} onChange={e => pageQuery('remote-config', { q: e.target.value })} placeholder={t('gwKeySearch')} aria-label={t('gwKeySearch')} data-testid="rc-q" />
        </div>
        <button type="button" className="btn btn-outline" onClick={() => setPreview(true)} data-testid="rc-preview-open">
          <Eye className="ic" />
          {t('gwPreview')}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setHist('')} data-testid="rc-history-all">
          <ClockCounterClockwise className="ic" />
          {t('gwHistoryAll')}
        </button>
      </div>
      <CatalogTable
        rows={rows}
        prefix="rc"
        loaded={loaded}
        keyOf={k => k.key}
        empty={{ icon: <ToggleRight className="ic" weight="duotone" />, title: s ? t('gwNoMatch') : t('gwNoKeys') }}
        onEdit={k => setEdit(k)}
        onDelete={k => del(t('gwDelConfirm', { k: k.key }), () => getConn().reducers.adminDeleteConfigKey({ key: k.key }))}
        cardTitle={k => <span className="mono primary">{k.key}</span>}
        extra={(k, card) => (
          <button type="button" className="btn btn-sm btn-icon" onClick={() => setHist(k.key)} aria-label={t('gwHistory')} title={t('gwHistory')} data-testid={`${card ? 'rcc' : 'rc'}-hist-${k.key}`}>
            <ClockCounterClockwise className="ic" />
          </button>
        )}
        cols={[
          {
            label: t('gwKey'),
            render: k => (
              <>
                <span className="mono primary">{k.key}</span>
                {k.description && (
                  <div className="small muted cell-detail" dir="auto">
                    {k.description}
                  </div>
                )}
              </>
            ),
          },
          { label: t('gwType'), render: k => <span className="badge b-teal">{label(TYPES, k.type)}</span> },
          {
            label: t('gwDefault'),
            className: 'gw-val',
            render: k => (
              <span className={k.type === 'json' || k.type === 'number' ? 'mono ltr' : ''} dir="auto" data-testid={`rc-val-${k.key}`}>
                {valueText(k.type, k.value, k.text)}
              </span>
            ),
          },
          { label: t('gwRules'), render: k => <span data-testid={`rc-rules-${k.key}`}>{k.rules.length ? num(k.rules.length) : <span className="muted">{t('gwNone')}</span>}</span> },
          { label: t('status'), render: k => <ActiveBadge on={k.isActive} /> },
          {
            label: t('gwVersion'),
            render: k => (
              <span className="stack" style={{ gap: 2 }} data-testid={`rc-ver-${k.key}`}>
                <span className="nowrap">{t('gwV', { v: num(k.version) })}</span>
                <span className="small muted nowrap">{when(k.updatedAt, false)}</span>
              </span>
            ),
          },
        ]}
      />
      {edit && <ConfigDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {hist !== null && <HistoryDialog k={hist} onClose={() => setHist(null)} />}
      {preview && <PreviewDialog onClose={() => setPreview(false)} />}
    </main>
  );
}

