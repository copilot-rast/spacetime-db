import { useEffect, useState, type ReactNode } from 'react';
import { ArrowCounterClockwise, ChatCircleText, DoorOpen, Eye, Flag, HandHeart, Lightning, MagnifyingGlass, PencilSimple, Plus, Prohibit, TextAa, Trash, UserMinus, UsersFour } from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { date, digits, errorText, latin, num, parseError, t, useLocale, type ErrInfo, type StrKey } from './i18n.ts';
import { pageQuery, run, runToast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession } from './app.ts';
import { Dialog, Empty, ErrBox, Field, NumInput, Notice, Pager, SaveButton, Seg, Skel, SwitchRow, TableSkeleton, TrInputs, confirmAsk } from './ui.tsx';
import { Section, TagList, TagPicker, when } from './widgets.tsx';
import { CatalogTable, Choice, KeyPick, SegChoice, useLoaded } from './kit.tsx';
import { ActiveBadge, AddButton, FormDialog, PageHead, del, needTitle, save } from './economy.tsx';
import { TestClock } from './settings3.tsx';
import { playerIdOf } from './pubnotify.tsx';
import { reportStatusBadge } from './moderation.tsx';
import './socialchat.css';

const PAGE = 20;

type WordRow = RowOf<'adminChatWords'>;
type RoomRow = RowOf<'adminRooms'>;
type RuleRow = RowOf<'adminFriendRules'>;

const ACTIONS: [string, StrKey][] = [
  ['mask', 'scActMask'],
  ['block', 'scActBlock'],
  ['flag', 'scActFlag'],
];

const ACTION_HINTS: Record<string, StrKey> = { mask: 'scActMaskHint', block: 'scActBlockHint', flag: 'scActFlagHint' };

const MATCHES: [string, StrKey][] = [
  ['word', 'scMatchWord'],
  ['contains', 'scMatchContains'],
];

const DM: [string, StrKey][] = [
  ['anyone', 'scDmAnyone'],
  ['friends', 'scDmFriends'],
  ['none', 'scDmNone'],
];

const POLICY: [string, StrKey][] = [
  ['priority', 'scMpPriority'],
  ['generous', 'scMpGenerous'],
];

const OVER: [string, StrKey][] = [
  ['refuse', 'scOverRefuse'],
  ['trim', 'scOverTrim'],
];

const STATUSES: [string, StrKey][] = [
  ['visible', 'scStVisible'],
  ['deleted', 'scStDeleted'],
  ['removed', 'scStRemoved'],
];

function label(list: [string, StrKey][], v: string) {
  const k = list.find(x => x[0] === v)?.[1];
  return k ? t(k) : v;
}

function actionBadge(a: string) {
  const cls = a === 'block' ? 'b-bad' : a === 'flag' ? 'b-warn' : 'b-info';
  return <span className={`badge ${cls}`}>{label(ACTIONS, a)}</span>;
}

function statusBadge(s: string) {
  const cls = s === 'visible' ? 'b-ok' : s === 'removed' ? 'b-bad' : '';
  return <span className={`badge ${cls}`}>{label(STATUSES, s)}</span>;
}

function flaggedBadge() {
  return (
    <span className="badge b-warn">
      <Flag className="ic" />
      {t('scStFlagged')}
    </span>
  );
}

function kindText(k: string) {
  return k === 'room' ? t('scKindRoom') : k === 'group' ? t('scKindGroup') : k === 'direct' ? t('scKindDirect') : k;
}

function idText(id: bigint) {
  return `#${digits(String(id))}`;
}

function PlayerLink(props: { id: bigint; name?: string }) {
  const { can } = useSession();
  const text = props.name || idText(props.id);
  if (!props.id) return <span className="muted">{t('scSystem')}</span>;
  if (!can('operator')) return <bdi>{text}</bdi>;
  return (
    <a className="row-link" href={`#/player?id=${props.id}`}>
      <bdi>{text}</bdi>
    </a>
  );
}

function FormSkel(props: { n: number }) {
  return (
    <div className="form-grid">
      {Array.from({ length: props.n }).map((_, i) => (
        <div className="field" key={i}>
          <Skel w={90} h={10} />
          <Skel h={36} r={6} />
        </div>
      ))}
    </div>
  );
}

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(fn: () => Promise<unknown>) {
    setBusy(true);
    const r = await run(() => fn(), t('saved'));
    setBusy(false);
    setErr(r.ok ? null : errorText(r.err));
  }
  return { busy, err, go };
}

function SaveBar(props: { busy: boolean; err: string | null; testId: string }) {
  return (
    <>
      <ErrBox text={props.err} />
      <div className="form-actions">
        <SaveButton busy={props.busy} testId={props.testId} />
      </div>
    </>
  );
}

type ChatArgs = {
  chatEnabled: boolean;
  messageMaxLength: number;
  messagesPerMinute: number;
  dmPolicy: string;
  groupsEnabled: boolean;
  groupMaxMembers: number;
  groupsPerPlayer: number;
  filterEnabled: boolean;
  filterReportTitle: string;
  historyPageMax: number;
  liveMessages: number;
};

function chatArgs(s: RowOf<'adminChatSettings'>): ChatArgs {
  return {
    chatEnabled: s.chatEnabled,
    messageMaxLength: s.messageMaxLength,
    messagesPerMinute: s.messagesPerMinute,
    dmPolicy: s.dmPolicy,
    groupsEnabled: s.groupsEnabled,
    groupMaxMembers: s.groupMaxMembers,
    groupsPerPlayer: s.groupsPerPlayer,
    filterEnabled: s.filterEnabled,
    filterReportTitle: s.filterReportTitle,
    historyPageMax: s.historyPageMax,
    liveMessages: s.liveMessages,
  };
}

export function ChatSettingsSection(props: { ro: boolean }) {
  useLocale();
  const s = useRows('adminChatSettings')[0];
  const titles = useRows('reportTitle');
  const { def } = useLanguages();
  const [v, setV] = useState<ChatArgs | null>(null);
  const [running, setRunning] = useState(false);
  const f = useSaver();
  useEffect(() => {
    if (s && !v) setV(chatArgs(s));
  }, [s, v]);
  if (!v || !s) return <FormSkel n={8} />;
  const up = (p: Partial<ChatArgs>) => setV({ ...v, ...p });
  const n = (k: keyof ChatArgs, l: StrKey, h: StrKey) => (
    <Field label={t(l)} hint={t(h)}>
      <NumInput value={Number(v[k])} onChange={x => up({ [k]: x } as Partial<ChatArgs>)} disabled={props.ro} name={k} />
    </Field>
  );
  return (
    <div className="stack stack-lg" data-testid="scs">
      <form
        className="stack stack-lg"
        onSubmit={e => {
          e.preventDefault();
          f.go(() => Promise.resolve().then(() => getConn().reducers.adminSaveChatSettings(v)));
        }}
      >
        <Section title={t('scSecChat')}>
          <div className="stack">
            <SwitchRow checked={v.chatEnabled} onChange={x => up({ chatEnabled: x })} disabled={props.ro} label={t('scChatEnabled')} testId="scs-enabled" />
            <div className="form-grid">
              {n('messageMaxLength', 'scMaxLength', 'scMaxLengthHint')}
              {n('messagesPerMinute', 'scPerMinute', 'scZeroNoLimit')}
              <Field label={t('scDmPolicy')} hint={t('scDmPolicyHint')}>
                <fieldset className="sc-fs" disabled={props.ro}>
                  <Choice value={v.dmPolicy} onChange={x => up({ dmPolicy: x })} options={DM} name="dmPolicy" testId="scs-dm" label={t('scDmPolicy')} />
                </fieldset>
              </Field>
              {n('historyPageMax', 'scHistoryMax', 'scHistoryMaxHint')}
              {n('liveMessages', 'scLive', 'scLiveHint')}
            </div>
          </div>
        </Section>
        <Section title={t('scSecGroups')}>
          <div className="stack">
            <SwitchRow checked={v.groupsEnabled} onChange={x => up({ groupsEnabled: x })} disabled={props.ro} label={t('scGroupsEnabled')} testId="scs-groups" />
            <div className="form-grid">
              {n('groupMaxMembers', 'scGroupMax', 'scGroupMaxHint')}
              {n('groupsPerPlayer', 'scGroupsPer', 'scZeroNoLimit')}
            </div>
          </div>
        </Section>
        <Section title={t('scSecFilter')} action={<a className="btn btn-sm" href="#/chat-words">{t('navChatWords')}</a>}>
          <div className="stack">
            <SwitchRow checked={v.filterEnabled} onChange={x => up({ filterEnabled: x })} disabled={props.ro} label={t('scFilterEnabled')} testId="scs-filter" />
            <div className="form-grid">
              <Field label={t('scReportTitle')} hint={t('scReportTitleHint')}>
                <select className="select" value={v.filterReportTitle} onChange={e => up({ filterReportTitle: e.target.value })} disabled={props.ro} name="filterReportTitle" data-testid="scs-title">
                  {!titles.some(x => x.key === v.filterReportTitle) && <option value={v.filterReportTitle}>{v.filterReportTitle}</option>}
                  {[...titles]
                    .sort((a, b) => a.sort - b.sort)
                    .map(x => (
                      <option key={x.key} value={x.key}>
                        {trText(x.name, def) || x.key}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
          </div>
        </Section>
        {!props.ro && <SaveBar busy={f.busy} err={f.err} testId="scs-save" />}
      </form>
      {!props.ro && (
        <Notice
          icon={<Lightning className="ic" />}
          title={t('scRunTitle')}
          text={t('scRunHint')}
          action={
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={running}
              data-testid="scs-run"
              onClick={async () => {
                setRunning(true);
                await runToast(c => c.reducers.adminSocialRun({}), t('scRunDone'));
                setRunning(false);
              }}
            >
              {t('scRun')}
            </button>
          }
        />
      )}
      {!props.ro && <TestClock value={s.clockOffsetSec} testId="scs-clock" save={sec => Promise.resolve().then(() => getConn().reducers.adminSetSocialClockOffset({ seconds: sec }))} />}
    </div>
  );
}

type FriendArgs = {
  dailyRequests: number;
  maxFriends: number;
  expiryDays: number;
  rejectCooldownHours: number;
  matchPolicy: string;
  requestsBonusMeta: string;
  friendsBonusMeta: string;
  overLimit: string;
};

export function FriendSettingsSection(props: { ro: boolean }) {
  useLocale();
  const s = useRows('adminFriendSettings')[0];
  const [v, setV] = useState<FriendArgs | null>(null);
  const f = useSaver();
  useEffect(() => {
    if (s && !v)
      setV({
        dailyRequests: s.dailyRequests,
        maxFriends: s.maxFriends,
        expiryDays: s.expiryDays,
        rejectCooldownHours: s.rejectCooldownHours,
        matchPolicy: s.matchPolicy,
        requestsBonusMeta: s.requestsBonusMeta,
        friendsBonusMeta: s.friendsBonusMeta,
        overLimit: s.overLimit,
      });
  }, [s, v]);
  if (!v || !s) return <FormSkel n={6} />;
  const up = (p: Partial<FriendArgs>) => setV({ ...v, ...p });
  const n = (k: keyof FriendArgs, l: StrKey, h: StrKey) => (
    <Field label={t(l)} hint={t(h)}>
      <NumInput value={Number(v[k])} onChange={x => up({ [k]: x } as Partial<FriendArgs>)} disabled={props.ro} name={k} />
    </Field>
  );
  return (
    <form
      className="stack stack-lg"
      data-testid="sfs"
      onSubmit={e => {
        e.preventDefault();
        f.go(() => Promise.resolve().then(() => getConn().reducers.adminSaveFriendSettings(v)));
      }}
    >
      <fieldset className="sc-fs stack stack-lg" disabled={props.ro}>
        <Section title={t('scSecLimits')}>
          <div className="form-grid">
            {n('dailyRequests', 'scDailyRequests', 'scZeroNoLimit')}
            {n('maxFriends', 'scMaxFriends', 'scZeroNoLimit')}
            {n('expiryDays', 'scExpiryDays', 'scExpiryHint')}
            {n('rejectCooldownHours', 'scCooldown', 'scCooldownHint')}
          </div>
        </Section>
        <Section title={t('scSecRules')} action={<a className="btn btn-sm" href="#/friend-rules">{t('navFriendRules')}</a>}>
          <div className="form-grid">
            <Field label={t('scMatchPolicy')} hint={t(v.matchPolicy === 'generous' ? 'scMpGenerousHint' : 'scMpPriorityHint')}>
              <Choice value={v.matchPolicy} onChange={x => up({ matchPolicy: x })} options={POLICY} name="matchPolicy" testId="sfs-policy" label={t('scMatchPolicy')} />
            </Field>
            <Field label={t('scOverLimit')} hint={t(v.overLimit === 'trim' ? 'scOverTrimHint' : 'scOverRefuseHint')}>
              <Choice value={v.overLimit} onChange={x => up({ overLimit: x })} options={OVER} name="overLimit" testId="sfs-over" label={t('scOverLimit')} />
            </Field>
          </div>
        </Section>
        <Section title={t('scSecBonus')}>
          <div className="form-grid">
            <Field label={t('scRequestsBonus')} hint={t('scBonusHint')}>
              <KeyPick kind="meta" value={v.requestsBonusMeta} onChange={x => up({ requestsBonusMeta: x })} none={t('none')} testId="sfs-rbonus" label={t('scRequestsBonus')} name="requestsBonusMeta" />
            </Field>
            <Field label={t('scFriendsBonus')} hint={t('scBonusHint')}>
              <KeyPick kind="meta" value={v.friendsBonusMeta} onChange={x => up({ friendsBonusMeta: x })} none={t('none')} testId="sfs-fbonus" label={t('scFriendsBonus')} name="friendsBonusMeta" />
            </Field>
          </div>
        </Section>
      </fieldset>
      {!props.ro && <SaveBar busy={f.busy} err={f.err} testId="sfs-save" />}
    </form>
  );
}

type FilterTest = { text: string; normalized: string; changed: boolean; blocked: boolean; flagged: boolean; hits: { id: bigint; word: string; action: string }[] };

function FilterTester() {
  const words = useRows('adminChatWords');
  const [text, setText] = useState('');
  const d = useDebounced(text, 300);
  const [res, setRes] = useState<FilterTest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sig = words.map(w => `${w.id}:${w.normalized}:${w.action}:${w.match}:${w.isActive}`).join('|');
  useEffect(() => {
    if (!d.trim()) {
      setRes(null);
      setErr(null);
      return;
    }
    let live = true;
    getConn()
      .procedures.adminTestChatFilter({ text: d })
      .then(r => {
        if (!live) return;
        setRes(r);
        setErr(null);
      })
      .catch(e => {
        if (live) setErr(errorText(parseError(e)));
      });
    return () => {
      live = false;
    };
  }, [d, sig]);
  const pending = text.trim() !== d.trim();
  return (
    <Section title={t('scTestTitle')} testId="scw-tester">
      <div className="form-grid">
        <Field label={t('scTestInput')} hint={t('scTestHint')}>
          <textarea className="textarea" dir="auto" value={text} onChange={e => setText(e.target.value)} placeholder={t('scTestPlaceholder')} name="filterTest" data-testid="scw-test-input" rows={3} />
        </Field>
        <div className="field">
          <span className="label">{t('scTestResult')}</span>
          <div className="sc-out" dir="auto" data-testid="scw-test-out" aria-live="polite">
            {res && !pending ? res.text : <span className="muted small">{text.trim() ? t('scTestChecking') : t('scTestEmpty')}</span>}
          </div>
          <ErrBox text={err} />
        </div>
      </div>
      {res && !pending && (
        <div className="stack stack-sm" style={{ marginTop: 12 }} data-testid="scw-test-info">
          <div className="row row-wrap" style={{ gap: 6 }}>
            {res.blocked && <span className="badge b-bad">{t('scTestBlocked')}</span>}
            {res.flagged && flaggedBadge()}
            {res.changed && <span className="badge b-info">{t('scTestMasked')}</span>}
            {!res.blocked && !res.flagged && !res.changed && <span className="badge b-ok">{t('scTestClean')}</span>}
          </div>
          <dl className="kv">
            <dt>{t('scNormalized')}</dt>
            <dd>
              <bdi className="mono" data-testid="scw-test-norm">
                {res.normalized || '—'}
              </bdi>
            </dd>
            <dt>{t('scHits')}</dt>
            <dd>
              {res.hits.length === 0 ? (
                <span className="muted">—</span>
              ) : (
                <span className="chips">
                  {res.hits.map((h, i) => (
                    <span className="chip" key={i}>
                      <bdi>{h.word}</bdi> · {label(ACTIONS, h.action)}
                    </span>
                  ))}
                </span>
              )}
            </dd>
          </dl>
        </div>
      )}
    </Section>
  );
}

function WordDialog(props: { row?: WordRow; onClose: () => void }) {
  const r = props.row;
  const [word, setWord] = useState(r?.word ?? '');
  const [action, setAction] = useState(r?.action ?? 'mask');
  const [match, setMatch] = useState(r?.match ?? 'word');
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [note, setNote] = useState(r?.note ?? '');
  return (
    <FormDialog
      title={r ? t('scWordEdit') : t('scWordNew')}
      testId="scw-dialog"
      width={560}
      onClose={props.onClose}
      submit={async () => {
        if (!word.trim()) return { ok: false, msg: t('scWordRequired') } as const;
        return save(() => getConn().reducers.adminSaveChatWord({ id: r?.id ?? 0n, word, action, match, isActive, note }));
      }}
    >
      <Field label={t('scWord')} required className="span-2" hint={t('scWordHint')}>
        <input className="input" dir="auto" name="word" value={word} onChange={e => setWord(e.target.value)} autoFocus maxLength={64} />
      </Field>
      <Field label={t('scAction')} hint={t(ACTION_HINTS[action] ?? 'scActMaskHint')}>
        <SegChoice value={action} onChange={setAction} options={ACTIONS} />
      </Field>
      <Field label={t('scMatch')} hint={t(match === 'contains' ? 'scMatchContainsHint' : 'scMatchWordHint')}>
        <SegChoice value={match} onChange={setMatch} options={MATCHES} />
      </Field>
      <Field label={t('scNote')} hint={t('optional')} className="span-2">
        <input className="input" name="note" value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
      </Field>
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} testId="scw-active" />
      </div>
    </FormDialog>
  );
}

export function ChatWords() {
  useLocale();
  const route = useRoute();
  const { can } = useSession();
  const list = useRows('adminChatWords');
  const loaded = useLoaded();
  const action = route.query.get('action') ?? '';
  const [query, setQuery] = useState(route.query.get('q') ?? '');
  const [edit, setEdit] = useState<WordRow | 'new' | null>(null);
  const q = latin(query).trim().toLowerCase();
  const rows = list
    .filter(w => (!action || w.action === action) && (!q || w.word.toLowerCase().includes(q) || w.normalized.includes(q) || w.note.toLowerCase().includes(q)))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  const count = (a: string) => list.filter(w => w.action === a).length;
  return (
    <main className="page" data-testid="page-chat-words">
      <PageHead
        title={t('navChatWords')}
        sub={t('scWordsSub', { n: num(list.length) })}
        action={
          can('operator') && (
            <button type="button" className="btn btn-primary" onClick={() => setEdit('new')} data-testid="scw-add">
              <Plus className="ic" />
              {t('scWordNew')}
            </button>
          )
        }
      />
      <div className="stack stack-lg">
        <FilterTester />
        <div className="stack">
          <div className="toolbar">
            <div className="input-affix search" style={{ width: 240 }}>
              <MagnifyingGlass className="ic" />
              <input
                className="input"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  pageQuery('chat-words', { action, q: e.target.value });
                }}
                placeholder={t('scWordSearch')}
                aria-label={t('search')}
                data-testid="scw-search"
              />
            </div>
            <Seg
              value={action}
              onChange={v => pageQuery('chat-words', { action: v, q: query })}
              label={t('scAction')}
              options={[{ value: '', label: t('all') }, ...ACTIONS.map(([v, k]) => ({ value: v, label: `${t(k)} ${count(v) ? digits(count(v)) : ''}`.trim() }))]}
            />
          </div>
          <CatalogTable
            rows={rows}
            loaded={loaded}
            prefix="scw"
            keyOf={r => String(r.id)}
            empty={{ icon: <TextAa className="ic" weight="duotone" />, title: q || action ? t('scWordsNoMatch') : t('scWordsEmpty') }}
            cardTitle={r => (
              <b>
                <bdi>{r.word}</bdi>
              </b>
            )}
            cols={[
              {
                label: t('scWord'),
                render: r => (
                  <>
                    <span className="primary">
                      <bdi>{r.word}</bdi>
                    </span>
                    {r.normalized !== r.word && (
                      <div className="mono muted small">
                        <bdi>{r.normalized}</bdi>
                      </div>
                    )}
                  </>
                ),
              },
              { label: t('scAction'), render: r => actionBadge(r.action) },
              { label: t('scMatch'), render: r => <span className="small">{label(MATCHES, r.match)}</span> },
              { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
              { label: t('scNote'), render: r => <span className="small muted cell-detail">{r.note || '—'}</span> },
              { label: t('scCreated'), render: r => <span className="small nowrap">{when(r.createdAt, false)}</span> },
            ]}
            extra={(r, card) => {
              if (!can('operator')) return null;
              const p = card ? 'scwc' : 'scw';
              return (
                <>
                  <button type="button" className="btn btn-sm btn-icon" onClick={() => setEdit(r)} aria-label={t('edit')} title={t('edit')} data-testid={`${p}-edit-${r.id}`}>
                    <PencilSimple className="ic" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-icon btn-danger-ghost"
                    onClick={() => del(t('deleteConfirmName', { name: r.word }), () => getConn().reducers.adminDeleteChatWord({ id: r.id }))}
                    aria-label={t('delete')}
                    title={t('delete')}
                    data-testid={`${p}-del-${r.id}`}
                  >
                    <Trash className="ic" />
                  </button>
                </>
              );
            }}
          />
        </div>
      </div>
      {edit && <WordDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

function RoomDialog(props: { row?: RoomRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r ? r.key.replace(/^room:/, '') : '');
  const [title, setTitle] = useState(r?.title ?? []);
  const [description, setDescription] = useState(r?.description ?? []);
  const [sort, setSort] = useState(r?.sort ?? 0);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  return (
    <FormDialog
      title={r ? t('scRoomEdit') : t('scRoomNew')}
      testId="scr-dialog"
      width={600}
      onClose={props.onClose}
      submit={async () => {
        if (!key.trim()) return { ok: false, msg: t('scKeyRequired') } as const;
        const bad = needTitle(title, def);
        if (bad) return bad;
        return save(() => getConn().reducers.adminSaveRoom({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), title, description, isActive, sort }));
      }}
    >
      <Field label={t('scRoomKey')} required hint={t('scRoomKeyHint')}>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} autoFocus={!r} />
      </Field>
      <Field label={t('scSort')} hint={t('scSortHint')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <Field label={t('scRoomTitle')} required className="span-2">
        <TrInputs value={title} onChange={setTitle} required name="title" />
      </Field>
      <Field label={t('scRoomDesc')} hint={t('optional')} className="span-2">
        <TrInputs value={description} onChange={setDescription} multiline name="description" />
      </Field>
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('scRoomActive')} testId="scr-active" />
      </div>
    </FormDialog>
  );
}

export function ChatRooms() {
  useLocale();
  const list = useRows('adminRooms');
  const loaded = useLoaded();
  const { def } = useLanguages();
  const [edit, setEdit] = useState<RoomRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const name = (r: RoomRow) => trText(r.title, def) || r.key.slice(5);
  return (
    <main className="page" data-testid="page-chat-rooms">
      <PageHead title={t('navChatRooms')} sub={t('scRoomsSub', { n: num(list.length) })} action={<AddButton label={t('scRoomNew')} onClick={() => setEdit('new')} testId="scr-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="scr"
        keyOf={r => r.key.slice(5)}
        empty={{ icon: <DoorOpen className="ic" weight="duotone" />, title: t('scRoomsEmpty') }}
        cardTitle={r => <b>{name(r)}</b>}
        cols={[
          {
            label: t('scRoomTitle'),
            render: r => (
              <>
                <span className="primary">{name(r)}</span>
                <div className="mono muted">{r.key.slice(5)}</div>
              </>
            ),
          },
          { label: t('scMembers'), render: r => num(r.members) },
          { label: t('scMessages'), render: r => num(r.messageCount) },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
          { label: t('scRoomDesc'), render: r => <span className="small muted cell-detail">{trText(r.description, def) || '—'}</span> },
          { label: t('scSort'), render: r => num(r.sort) },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('scRoomDelConfirm', { name: name(r) }), () => getConn().reducers.adminDeleteRoom({ id: r.id }))}
        extra={(r, card) => (
          <a className="btn btn-sm btn-icon" href={`#/chat-messages?channel=${r.id}`} aria-label={t('scSeeMessages')} title={t('scSeeMessages')} data-testid={`${card ? 'scrc' : 'scr'}-msgs-${r.key.slice(5)}`}>
            <ChatCircleText className="ic" />
          </a>
        )}
      />
      {edit && <RoomDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type MsgRow = { message: MessageRow; channelKind: string; channelName: string; senderName: string; reports: number };
type MessageRow = { id: bigint; channelId: bigint; senderId: bigint; text: string; original: string; replyToId: bigint; status: string; flagged: boolean; hits: string[]; deletedBy: bigint; createdAt: { toDate(): Date; microsSinceUnixEpoch: bigint } };

function useChannelName() {
  const rooms = useRows('adminRooms');
  const { def } = useLanguages();
  return (r: MsgRow) => {
    const room = r.channelKind === 'room' ? rooms.find(x => x.id === r.message.channelId) : undefined;
    return (room && trText(room.title, def)) || r.channelName || idText(r.message.channelId);
  };
}

function ChannelCell(props: { r: MsgRow }) {
  const name = useChannelName();
  return (
    <>
      <span>
        <bdi>{name(props.r)}</bdi>
      </span>
      <div className="small muted">{kindText(props.r.channelKind)}</div>
    </>
  );
}

function MessageText(props: { m: MessageRow; full?: boolean }) {
  const m = props.m;
  return (
    <>
      <span className={`sc-text ${props.full ? '' : 'cell-detail'}`} dir="auto" style={m.status !== 'visible' ? { color: 'var(--ink-3)' } : undefined}>
        {m.text || <span className="muted">—</span>}
      </span>
      {m.original && (
        <div className="small muted">
          {t('scOriginal')}:{' '}
          <bdi className={props.full ? 'sc-text' : ''} dir="auto">
            {m.original}
          </bdi>
        </div>
      )}
    </>
  );
}

function MsgBadges(props: { r: MsgRow }) {
  const m = props.r.message;
  return (
    <span className="row row-wrap" style={{ gap: 4 }}>
      {statusBadge(m.status)}
      {m.flagged && flaggedBadge()}
      {props.r.reports > 0 && <span className="badge b-violet">{t('scReportsN', { n: num(props.r.reports) })}</span>}
    </span>
  );
}

export function ChatMessages() {
  useLocale();
  const route = useRoute();
  const rooms = useRows('adminRooms');
  const { def } = useLanguages();
  const channel = route.query.get('channel') ?? '';
  const status = route.query.get('status') ?? '';
  const flagged = route.query.get('flagged') === '1';
  const [sender, setSender] = useState(route.query.get('sender') ?? '');
  const [query, setQuery] = useState(route.query.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<bigint | null>(null);
  const s = useDebounced(sender, 300);
  const q = useDebounced(query, 300);
  const senderId = playerIdOf(s);
  const channelId = /^\d+$/.test(channel) ? BigInt(channel) : 0n;
  const filters = { channel, status, flagged: flagged ? '1' : '', sender: s, q };
  const setF = (p: Partial<typeof filters>) => {
    setPage(1);
    pageQuery('chat-messages', { ...filters, ...p });
  };
  useEffect(() => {
    if ((route.query.get('sender') ?? '') !== s || (route.query.get('q') ?? '') !== q) setF({});
  }, [s, q]);
  const { data, error, loading } = useFetch(
    () => getConn().procedures.adminSocialMessages({ channelId, senderId, query: q, flagged, status, page, pageSize: PAGE }),
    [String(channelId), String(senderId), q, flagged, status, page]
  );
  const rows = (data?.rows ?? []) as MsgRow[];
  const chName = useChannelName();
  const roomList = [...rooms].sort((a, b) => a.sort - b.sort);
  const any = !!(channel || status || flagged || s || q);
  return (
    <main className="page" data-testid="page-chat-messages">
      <PageHead title={t('navChatMessages')} sub={data ? t('scMsgsSub', { n: num(data.total) }) : <Skel w={60} h={10} />} />
      <div className="toolbar">
        <div className="input-affix search" style={{ width: 220 }}>
          <MagnifyingGlass className="ic" />
          <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('scMsgSearch')} aria-label={t('search')} data-testid="scm-q" />
        </div>
        <input className="input" style={{ width: 150 }} value={sender} onChange={e => setSender(e.target.value)} placeholder={t('scSenderId')} aria-label={t('scSenderId')} inputMode="numeric" data-testid="scm-sender" />
        <select className="select" style={{ width: 'auto', minWidth: 170 }} value={channel} onChange={e => setF({ channel: e.target.value })} aria-label={t('scChannel')} data-testid="scm-channel">
          <option value="">{t('scAllChannels')}</option>
          {channel && !rooms.some(r => String(r.id) === channel) && <option value={channel}>{t('scChannelN', { n: digits(channel) })}</option>}
          {roomList.map(r => (
            <option key={String(r.id)} value={String(r.id)}>
              {trText(r.title, def) || r.key.slice(5)}
            </option>
          ))}
        </select>
        <Seg value={status} onChange={v => setF({ status: v })} label={t('status')} options={[{ value: '', label: t('all') }, ...STATUSES.map(([v, k]) => ({ value: v, label: t(k) }))]} />
        <SwitchRow checked={flagged} onChange={x => setF({ flagged: x ? '1' : '' })} label={t('scOnlyFlagged')} testId="scm-flagged" />
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="scm-table">
          <thead>
            <tr>
              <th>{t('auColTime')}</th>
              <th>{t('scSender')}</th>
              <th>{t('scChannel')}</th>
              <th>{t('scMessage')}</th>
              <th>{t('status')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty icon={<ChatCircleText className="ic" weight="duotone" />} title={any ? t('scMsgsNoMatch') : t('scMsgsEmpty')} text={any ? undefined : t('scMsgsEmptyHint')} />
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={String(r.message.id)} data-testid={`scm-row-${r.message.id}`}>
                  <td className="nowrap small">{when(r.message.createdAt)}</td>
                  <td>
                    <PlayerLink id={r.message.senderId} name={r.senderName} />
                  </td>
                  <td>
                    <ChannelCell r={r} />
                  </td>
                  <td style={{ maxWidth: 360 }}>
                    <MessageText m={r.message} />
                  </td>
                  <td>
                    <MsgBadges r={r} />
                  </td>
                  <td className="end">
                    <button type="button" className="btn btn-sm btn-icon" onClick={() => setOpen(r.message.id)} aria-label={t('scView')} title={t('scView')} data-testid={`scm-open-${r.message.id}`}>
                      <Eye className="ic" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards" data-testid="scm-cards">
          {data && rows.length === 0 && <Empty icon={<ChatCircleText className="ic" weight="duotone" />} title={any ? t('scMsgsNoMatch') : t('scMsgsEmpty')} />}
          {rows.map(r => (
            <div className="pcard" key={String(r.message.id)}>
              <div className="row">
                <span className="grow">
                  <PlayerLink id={r.message.senderId} name={r.senderName} />
                </span>
                <MsgBadges r={r} />
              </div>
              <MessageText m={r.message} />
              <div className="pcard-meta">
                <span>{t('scChannel')}</span>
                <span>
                  <bdi>{chName(r)}</bdi> · {kindText(r.channelKind)}
                </span>
                <span>{t('auColTime')}</span>
                <span>{when(r.message.createdAt)}</span>
              </div>
              <span className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-sm" onClick={() => setOpen(r.message.id)} data-testid={`scmc-open-${r.message.id}`}>
                  <Eye className="ic" />
                  {t('scView')}
                </button>
              </span>
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {open !== null && <MessageDialog id={open} onClose={() => setOpen(null)} />}
    </main>
  );
}

function MessageDialog(props: { id: bigint; onClose: () => void }) {
  const { can } = useSession();
  const { def } = useLanguages();
  const titles = useRows('reportTitle');
  const { data, error } = useFetch(() => getConn().procedures.adminSocialMessage({ id: props.id }), [String(props.id)]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const row = data?.row as MsgRow | undefined;
  const m = row?.message;
  const chName = useChannelName();
  const peers = useFetch(
    () => (m ? getConn().procedures.adminSocialMessages({ channelId: m.channelId, senderId: 0n, query: '', flagged: false, status: '', page: 1, pageSize: 100 }) : Promise.resolve(undefined)),
    [String(m?.channelId ?? 0n)]
  );
  const names = new Map<bigint, string>((peers.data?.rows ?? []).map(x => [x.message.senderId, x.senderName]));
  if (row) names.set(row.message.senderId, row.senderName);
  const titleName = (k: string) => {
    const x = titles.find(r => r.key === k);
    return x ? trText(x.name, def) || k : k;
  };
  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    const r = await run(() => fn(), ok);
    setBusy(false);
    if (r.ok) {
      setErr(null);
      setNote('');
    } else setErr(errorText(r.err as ErrInfo));
  }
  return (
    <Dialog
      title={t('scMsgTitle', { n: digits(String(props.id)) })}
      width={680}
      onClose={props.onClose}
      testId="scm-dialog"
      foot={
        m && can('operator') ? (
          m.status === 'removed' ? (
            <>
              <span className="grow" />
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => act(() => getConn().reducers.adminRestoreChatMessage({ id: m.id }), t('scRestored'))} data-testid="scm-restore">
                <ArrowCounterClockwise className="ic" />
                {t('scRestore')}
              </button>
            </>
          ) : (
            <div className="input-group grow">
              <input className="input grow" value={note} onChange={e => setNote(e.target.value)} placeholder={t('scRemoveNote')} name="removeNote" maxLength={300} aria-label={t('scRemoveNote')} />
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => act(() => getConn().reducers.adminDeleteChatMessage({ id: m.id, note }), t('scRemoved'))} data-testid="scm-remove">
                <Prohibit className="ic" />
                {t('scRemove')}
              </button>
            </div>
          )
        ) : undefined
      }
    >
      {error ? (
        <ErrBox text={errorText(error)} />
      ) : !row || !m || !data ? (
        <div className="stack">
          <Skel w="40%" h={14} />
          <Skel h={60} r={6} />
          <Skel h={120} r={6} />
        </div>
      ) : (
        <div className="stack" data-testid="scm-detail">
          <div className="row row-wrap">
            <MsgBadges r={row} />
            <span className="grow" />
            <span className="small muted">{when(m.createdAt)}</span>
          </div>
          <dl className="kv">
            <dt>{t('scSender')}</dt>
            <dd>
              <PlayerLink id={m.senderId} name={row.senderName} />
            </dd>
            <dt>{t('scChannel')}</dt>
            <dd>
              <a className="row-link" href={`#/chat-messages?channel=${m.channelId}`} onClick={props.onClose}>
                <bdi>{chName(row)}</bdi>
              </a>{' '}
              <span className="muted">· {kindText(row.channelKind)}</span>
            </dd>
            {m.hits.length > 0 && (
              <>
                <dt>{t('scHits')}</dt>
                <dd>
                  <span className="chips">
                    {m.hits.map((h, i) => (
                      <span className="chip" key={i}>
                        <bdi>{h}</bdi>
                      </span>
                    ))}
                  </span>
                </dd>
              </>
            )}
            {m.status === 'removed' && m.deletedBy !== 0n && (
              <>
                <dt>{t('scRemovedBy')}</dt>
                <dd>{idText(m.deletedBy)}</dd>
              </>
            )}
          </dl>
          <div className="note-item" data-testid="scm-text">
            <div className="small muted">{t('scShown')}</div>
            <span className="sc-text" dir="auto">
              {m.text || '—'}
            </span>
          </div>
          {m.original && (
            <div className="note-item" data-testid="scm-original">
              <div className="small muted">{t('scOriginal')}</div>
              <span className="sc-text" dir="auto">
                {m.original}
              </span>
            </div>
          )}
          <div className="stack stack-sm">
            <span className="section-label">{t('scContext')}</span>
            <div className="sc-ctx" data-testid="scm-context">
              {data.context.map(c => (
                <div key={String(c.id)} className={`sc-ctx-row ${c.id === m.id ? 'on' : ''} ${c.status === 'visible' ? '' : 'gone'}`}>
                  <div className="row small" style={{ gap: 6 }}>
                    <span className="grow">
                      <PlayerLink id={c.senderId} name={names.get(c.senderId)} />
                    </span>
                    {c.status !== 'visible' && statusBadge(c.status)}
                    {c.flagged && flaggedBadge()}
                    <span className="muted">{when(c.createdAt)}</span>
                  </div>
                  <span className="sc-text" dir="auto">
                    {c.text || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="stack stack-sm">
            <span className="section-label">{t('scReports')}</span>
            {data.reports.length === 0 ? (
              <span className="small muted">{t('scNoReports')}</span>
            ) : (
              <div className="list" data-testid="scm-reports">
                {data.reports.map(r => (
                  <div className="list-row" key={String(r.id)}>
                    <div className="list-main">
                      <span className="list-title">
                        {can('operator') ? (
                          <a className="row-link" href={`#/reports?id=${r.id}`} data-testid={`scm-report-${r.id}`}>
                            {titleName(r.titleKey)}
                          </a>
                        ) : (
                          titleName(r.titleKey)
                        )}
                      </span>
                      <span className="list-sub">
                        {r.reporterId ? <PlayerLink id={r.reporterId} /> : t('scFilterReporter')}
                        {t('scSep')}
                        {when(r.createdAt)}
                        {r.note ? `${t('scSep')}${r.note}` : ''}
                      </span>
                    </div>
                    {reportStatusBadge(r.status)}
                  </div>
                ))}
              </div>
            )}
          </div>
          <ErrBox text={err} />
        </div>
      )}
    </Dialog>
  );
}

export function ChatGroups() {
  useLocale();
  const route = useRoute();
  const { can } = useSession();
  const [query, setQuery] = useState(route.query.get('q') ?? '');
  const [page, setPage] = useState(1);
  const q = useDebounced(query, 300);
  useEffect(() => {
    if ((route.query.get('q') ?? '') !== q) pageQuery('chat-groups', { q });
    setPage(1);
  }, [q]);
  const { data, error, loading } = useFetch(() => getConn().procedures.adminChatGroups({ query: latin(q), page, pageSize: PAGE }), [q, page]);
  const rows = data?.rows ?? [];
  async function close(id: bigint, name: string) {
    if (!(await confirmAsk(t('scGroupCloseConfirm', { name }), { danger: true, ok: t('scGroupClose') }))) return;
    await runToast(c => c.reducers.adminCloseGroup({ id }), t('scGroupClosed'));
  }
  const actions = (c: (typeof rows)[number]['channel'], card: boolean) => (
    <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
      <a className="btn btn-sm btn-icon" href={`#/chat-messages?channel=${c.id}`} aria-label={t('scSeeMessages')} title={t('scSeeMessages')} data-testid={`${card ? 'scgc' : 'scg'}-msgs-${c.id}`}>
        <ChatCircleText className="ic" />
      </a>
      {c.isActive && can('operator') && (
        <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => close(c.id, c.name)} data-testid={`${card ? 'scgc' : 'scg'}-close-${c.id}`}>
          <Prohibit className="ic" />
          {t('scGroupClose')}
        </button>
      )}
    </span>
  );
  const groupBadge = (on: boolean) => <span className={`badge ${on ? 'b-ok' : 'b-bad'}`}>{on ? t('active') : t('scClosed')}</span>;
  return (
    <main className="page" data-testid="page-chat-groups">
      <PageHead title={t('navChatGroups')} sub={data ? t('scGroupsSub', { n: num(data.total) }) : <Skel w={60} h={10} />} />
      <div className="toolbar">
        <div className="input-affix search" style={{ width: 260 }}>
          <MagnifyingGlass className="ic" />
          <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('scGroupSearch')} aria-label={t('search')} data-testid="scg-q" />
        </div>
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="scg-table">
          <thead>
            <tr>
              <th>{t('scGroupName')}</th>
              <th>{t('scOwner')}</th>
              <th>{t('scMembers')}</th>
              <th>{t('scMessages')}</th>
              <th>{t('scLastMessage')}</th>
              <th>{t('status')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={7} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty icon={<UsersFour className="ic" weight="duotone" />} title={q ? t('scGroupsNoMatch') : t('scGroupsEmpty')} text={q ? undefined : t('scGroupsEmptyHint')} />
                </td>
              </tr>
            ) : (
              rows.map(({ channel: c, ownerName }) => (
                <tr key={String(c.id)} data-testid={`scg-row-${c.id}`}>
                  <td>
                    <span className="primary">
                      <bdi>{c.name}</bdi>
                    </span>
                    <div className="small muted">
                      {t('scGroupMeta', { id: digits(String(c.id)), d: when(c.createdAt, false) })}
                    </div>
                  </td>
                  <td>
                    <PlayerLink id={c.ownerId} name={ownerName} />
                  </td>
                  <td>{num(c.members)}</td>
                  <td>{num(c.messageCount)}</td>
                  <td className="small nowrap">{when(c.lastMessageAt)}</td>
                  <td>{groupBadge(c.isActive)}</td>
                  <td className="end">{actions(c, false)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {data && rows.length === 0 && <Empty icon={<UsersFour className="ic" weight="duotone" />} title={q ? t('scGroupsNoMatch') : t('scGroupsEmpty')} />}
          {rows.map(({ channel: c, ownerName }) => (
            <div className="pcard" key={String(c.id)}>
              <div className="row">
                <b className="grow">
                  <bdi>{c.name}</bdi>
                </b>
                {groupBadge(c.isActive)}
              </div>
              <div className="pcard-meta">
                <span>{t('scOwner')}</span>
                <span>
                  <PlayerLink id={c.ownerId} name={ownerName} />
                </span>
                <span>{t('scMembers')}</span>
                <span>{num(c.members)}</span>
                <span>{t('scMessages')}</span>
                <span>{num(c.messageCount)}</span>
              </div>
              {actions(c, true)}
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}

function OptLimit(props: { label: string; hint: string; value: number | undefined; onChange: (v: number | undefined) => void; name: string }) {
  const [last, setLast] = useState(props.value ?? 0);
  const keep = props.value === undefined;
  return (
    <Field label={props.label} hint={props.hint}>
      <div className="sc-limit">
        <SwitchRow checked={keep} onChange={x => props.onChange(x ? undefined : last)} label={t('scKeepDefault')} testId={`sfr-${props.name}-keep`} />
        {!keep && (
          <NumInput
            value={props.value ?? 0}
            onChange={x => {
              setLast(x);
              props.onChange(x);
            }}
            name={props.name}
          />
        )}
      </div>
    </Field>
  );
}

const RULE_MAX: [keyof Pick<RuleRow, 'dailyRequests' | 'maxFriends' | 'rejectCooldownHours'>, number][] = [
  ['dailyRequests', 1000],
  ['maxFriends', 10000],
  ['rejectCooldownHours', 8760],
];

function FriendRuleDialog(props: { row?: RuleRow; onClose: () => void }) {
  const r = props.row;
  const [name, setName] = useState(r?.name ?? '');
  const [priority, setPriority] = useState(r?.priority ?? 0);
  const [tagIds, setTagIds] = useState<bigint[]>(r?.tagIds ?? []);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [lim, setLim] = useState<{ dailyRequests: number | undefined; maxFriends: number | undefined; rejectCooldownHours: number | undefined }>({
    dailyRequests: r?.dailyRequests,
    maxFriends: r?.maxFriends,
    rejectCooldownHours: r?.rejectCooldownHours,
  });
  return (
    <FormDialog
      title={r ? t('scRuleEdit') : t('scRuleNew')}
      testId="sfr-dialog"
      width={640}
      onClose={props.onClose}
      submit={async () => {
        if (!name.trim()) return { ok: false, msg: t('scNameRequired') } as const;
        if (lim.dailyRequests === undefined && lim.maxFriends === undefined && lim.rejectCooldownHours === undefined) return { ok: false, msg: t('scLimitRequired') } as const;
        for (const [k, max] of RULE_MAX) {
          const v = lim[k];
          if (v !== undefined && (v < 0 || v > max)) return { ok: false, msg: errorText({ code: 'INVALID_RULE', field: k, raw: '' }) } as const;
        }
        return save(() => getConn().reducers.adminSaveFriendRule({ id: r?.id ?? 0n, name, tagIds, priority, isActive, ...lim }));
      }}
    >
      <Field label={t('scRuleName')} required>
        <input className="input" name="name" value={name} onChange={e => setName(e.target.value)} autoFocus={!r} maxLength={80} />
      </Field>
      <Field label={t('scPriority')} hint={t('scPriorityHint')}>
        <NumInput value={priority} onChange={setPriority} name="priority" />
      </Field>
      <Field label={t('scRuleTags')} required hint={t('scRuleTagsHint')} className="span-2">
        <TagPicker keyType="user" value={tagIds} onChange={setTagIds} testId="sfr-tags" />
      </Field>
      <div className="span-2">
        <Notice kind="plain" text={t('scKeepDefaultHint')} />
      </div>
      <OptLimit label={t('scDailyRequests')} hint={t('scZeroNoLimit')} value={lim.dailyRequests} onChange={v => setLim({ ...lim, dailyRequests: v })} name="dailyRequests" />
      <OptLimit label={t('scMaxFriends')} hint={t('scZeroNoLimit')} value={lim.maxFriends} onChange={v => setLim({ ...lim, maxFriends: v })} name="maxFriends" />
      <OptLimit label={t('scCooldown')} hint={t('scCooldownHint')} value={lim.rejectCooldownHours} onChange={v => setLim({ ...lim, rejectCooldownHours: v })} name="rejectCooldownHours" />
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} testId="sfr-active" />
      </div>
    </FormDialog>
  );
}

function limitText(v: number | undefined, zero: StrKey): ReactNode {
  if (v === undefined) return <span className="muted small">{t('scDefault')}</span>;
  if (v === 0) return t(zero);
  return num(v);
}

export function FriendRules() {
  useLocale();
  const list = useRows('adminFriendRules');
  const tags = useRows('tag');
  const s = useRows('adminFriendSettings')[0];
  const loaded = useLoaded();
  const [edit, setEdit] = useState<RuleRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const tagsOf = (ids: bigint[]) => tags.filter(x => ids.includes(x.id)).map(x => ({ id: x.id, key: x.key, title: x.title }));
  return (
    <main className="page" data-testid="page-friend-rules">
      <PageHead title={t('navFriendRules')} sub={t('scRulesSub', { n: num(list.length) })} action={<AddButton label={t('scRuleNew')} onClick={() => setEdit('new')} testId="sfr-add" />} />
      <div className="stack stack-lg">
        {s && (
          <Notice
            icon={<HandHeart className="ic" />}
            text={t(s.matchPolicy === 'generous' ? 'scRulesGenerous' : 'scRulesPriority')}
            action={
              <a className="btn btn-sm btn-outline" href="#/settings/friend-settings">
                {t('stFriendSettings')}
              </a>
            }
          />
        )}
        <CatalogTable
          rows={rows}
          loaded={loaded}
          prefix="sfr"
          keyOf={r => String(r.id)}
          empty={{ icon: <HandHeart className="ic" weight="duotone" />, title: t('scRulesEmpty') }}
          cardTitle={r => <b>{r.name}</b>}
          cols={[
            {
              label: t('scRuleName'),
              render: r => (
                <>
                  <span className="primary">{r.name}</span>
                  <div className="small muted">{t('scPriorityN', { n: num(r.priority) })}</div>
                </>
              ),
            },
            { label: t('scDailyRequests'), render: r => limitText(r.dailyRequests, 'scUnlimited') },
            { label: t('scMaxFriends'), render: r => limitText(r.maxFriends, 'scUnlimited') },
            { label: t('scCooldown'), render: r => limitText(r.rejectCooldownHours, 'scNoWait') },
            { label: t('scRuleTags'), render: r => <TagList tags={tagsOf(r.tagIds)} /> },
            { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
          ]}
          onEdit={r => setEdit(r)}
          onDelete={r => del(t('deleteConfirmName', { name: r.name }), () => getConn().reducers.adminDeleteFriendRule({ id: r.id }))}
        />
      </div>
      {edit && <FriendRuleDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type Edge = { accountId: bigint; displayName: string; state: string; since: { toDate(): Date; microsSinceUnixEpoch: bigint }; expiresAt: bigint };

const EDGE_GROUPS: [string, StrKey][] = [
  ['friend', 'scPfFriends'],
  ['received', 'scPfReceived'],
  ['sent', 'scPfSent'],
  ['blocked', 'scPfBlocked'],
];

export function PlayerFriendsCard(props: { accountId: bigint }) {
  useLocale();
  const { can } = useSession();
  const res = useFetch(() => getConn().procedures.adminPlayerFriends({ accountId: props.accountId }), [String(props.accountId)]);
  const data = res.data;
  async function remove(e: Edge) {
    const name = e.displayName || idText(e.accountId);
    if (!(await confirmAsk(t(e.state === 'friend' ? 'scPfRemoveConfirm' : 'scPfCancelConfirm', { name }), { danger: true, ok: t('scPfRemove') }))) return;
    await runToast(c => c.reducers.adminRemoveFriendship({ accountId: props.accountId, otherId: e.accountId }), t('scPfRemoved'));
  }
  const limit = (used: number, max: number) => (max ? t('scOfN', { a: num(used), b: num(max) }) : t('scOfUnlimited', { a: num(used) }));
  return (
    <Section
      title={t('scPfTitle')}
      pad={false}
      testId="pd-friends"
      action={
        <a className="btn btn-sm" href="#/friend-rules" data-testid="pf-rules">
          <HandHeart className="ic" />
          {t('navFriendRules')}
        </a>
      }
    >
      {res.error ? (
        <div className="card-pad">
          <ErrBox text={errorText(res.error)} />
        </div>
      ) : !data ? (
        <div className="card-pad stack">
          <div className="sc-stats">
            {[0, 1, 2, 3].map(i => (
              <Skel key={i} h={52} r={6} />
            ))}
          </div>
          <Skel h={40} r={6} />
        </div>
      ) : (
        <div className="card-pad stack">
          <div className="sc-stats" data-testid="pf-rules-box">
            <div className="sc-stat">
              <span className="small muted">{t('scPfFriendsCount')}</span>
              <b>{limit(data.rules.friends, data.rules.maxFriends)}</b>
            </div>
            <div className="sc-stat">
              <span className="small muted">{t('scPfToday')}</span>
              <b>{limit(data.rules.sentToday, data.rules.dailyRequests)}</b>
            </div>
            <div className="sc-stat">
              <span className="small muted">{t('scExpiryDays')}</span>
              <b>{data.rules.expiryDays ? t('scDaysN', { n: num(data.rules.expiryDays) }) : t('scNever')}</b>
            </div>
            <div className="sc-stat">
              <span className="small muted">{t('scCooldown')}</span>
              <b>{data.rules.rejectCooldownHours ? t('scHoursN', { n: num(data.rules.rejectCooldownHours) }) : t('scNoWait')}</b>
            </div>
          </div>
          <span className="small muted" data-testid="pf-tier">
            {data.rules.tier ? t('scPfTier', { name: data.rules.tier.name }) : t('scPfNoTier')}
            {data.rules.bonus.dailyRequests || data.rules.bonus.maxFriends ? `${t('scSep')}${t('scPfBonus', { r: num(data.rules.bonus.dailyRequests), f: num(data.rules.bonus.maxFriends) })}` : ''}
          </span>
          {data.edges.length === 0 ? (
            <span className="small muted">{t('scPfEmpty')}</span>
          ) : (
            EDGE_GROUPS.map(([state, k]) => {
              const list = (data.edges as Edge[]).filter(e => e.state === state);
              if (!list.length) return null;
              return (
                <div className="stack stack-sm" key={state}>
                  <span className="section-label">
                    {t(k)} ({num(list.length)})
                  </span>
                  <div className="list" data-testid={`pf-${state}`}>
                    {list.map(e => (
                      <div className="list-row" key={String(e.accountId)} data-testid={`pf-edge-${e.accountId}`}>
                        <div className="list-main">
                          <span className="list-title">
                            <PlayerLink id={e.accountId} name={e.displayName} />
                          </span>
                          <span className="list-sub">
                            {t('scPfSince', { d: when(e.since) })}
                            {e.expiresAt ? `${t('scSep')}${t('scPfExpires', { d: date(new Date(Number(e.expiresAt / 1000n))) })}` : ''}
                          </span>
                        </div>
                        {can('admin') && state !== 'blocked' && (
                          <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => remove(e)} data-testid={`pf-remove-${e.accountId}`}>
                            <UserMinus className="ic" />
                            {t('scPfRemove')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </Section>
  );
}
