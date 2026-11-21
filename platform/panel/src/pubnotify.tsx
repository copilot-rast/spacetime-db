import { useState, type ReactNode } from 'react';
import { BellRinging, ChartBar, PencilSimple, Trash, Eye, Lightning, MagnifyingGlass, PaperPlaneTilt, Prohibit, Tray, UsersThree, DeviceMobile, Megaphone, Robot, FolderSimple } from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { codeText, date, digits, errorText, latin, num, t, useLocale, type StrKey } from './i18n.ts';
import { go, pageQuery, run, runToast, toast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, NumInput, OkBox, Pager, Seg, Skel, SwitchRow, TableSkeleton, TrInputs, confirmAsk, trMissingDefault } from './ui.tsx';
import { Section, TagPicker } from './widgets.tsx';
import { ActiveBadge, AddButton, FormDialog, NameCell, PageHead, del, needTitle, save } from './economy.tsx';
import { CatalogTable, Choice, IdPick, KeyPick, microsToInput, useLoaded, usePrizeName } from './kit.tsx';
import { CountriesPick } from './promo.tsx';
import { microsFromInput } from './widgets.tsx';

const PAGE = 20;

export const CHANNELS: [string, StrKey][] = [
  ['inbox', 'chInbox'],
  ['push', 'chPush'],
  ['sms', 'chSms'],
];

export const ACTIONS7: [string, StrKey][] = [
  ['none', 'baNone'],
  ['screen', 'baScreen'],
  ['url', 'baUrl'],
  ['product', 'baProduct'],
  ['achievement', 'baAchievement'],
  ['news', 'acNews'],
];

const REASONS: Record<string, StrKey> = {
  opted_out: 'rsnOptedOut',
  cap: 'rsnCap',
  no_device: 'rsnNoDevice',
  no_address: 'rsnNoAddress',
  category_off: 'rsnCategoryOff',
  not_player: 'rsnNotPlayer',
  cooldown: 'rsnCooldown',
};

export function reasonText(r: string) {
  return REASONS[r] ? t(REASONS[r]) : r ? codeText(r) : '—';
}

export function channelText(c: string) {
  const k = CHANNELS.find(x => x[0] === c)?.[1];
  return k ? t(k) : c;
}

function usMicros(v: bigint) {
  return v ? date(new Date(Number(v / 1000n))) : '—';
}

export function minutesToTime(m: number) {
  if (m >= 1440) return '24:00';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function timeToMinutes(v: string) {
  const [h, m] = v.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}

export function useCategoryName() {
  const cats = useRows('notifyCategory');
  const { def } = useLanguages();
  return (key: string) => trText(cats.find(c => c.key === key)?.name, def) || key;
}

export function NotifyCategoryPick(props: { value: string; onChange: (v: string) => void; testId?: string }) {
  const cats = useRows('notifyCategory');
  const { def } = useLanguages();
  const list = [...cats].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <select className="select" value={props.value} onChange={e => props.onChange(e.target.value)} data-testid={props.testId} aria-label={t('ncCategory')} name="categoryKey">
      {list.map(c => (
        <option key={c.key} value={c.key}>
          {trText(c.name, def) || c.key}
          {c.isActive ? '' : ` (${t('inactive')})`}
        </option>
      ))}
    </select>
  );
}

export function ChannelPick(props: { value: string[]; onChange: (v: string[]) => void; testId?: string }) {
  return (
    <div className="chips" data-testid={props.testId}>
      {CHANNELS.map(([c, k]) => (
        <button
          type="button"
          key={c}
          className="chip chip-btn"
          aria-pressed={props.value.includes(c)}
          onClick={() => props.onChange(props.value.includes(c) ? props.value.filter(x => x !== c) : CHANNELS.map(x => x[0]).filter(x => x === c || props.value.includes(x)))}
          data-testid={props.testId ? `${props.testId}-${c}` : undefined}
        >
          {t(k)}
        </button>
      ))}
    </div>
  );
}

export function ChannelChips(props: { list: string[] }) {
  if (!props.list.length) return <span className="muted small">—</span>;
  return (
    <span className="chips">
      {props.list.map(c => (
        <span key={c} className="chip">
          {channelText(c)}
        </span>
      ))}
    </span>
  );
}

export type Msg = {
  categoryKey: string;
  channels: string[];
  title: Tr[];
  body: Tr[];
  imageUrl: string;
  actionType: string;
  actionValue: string;
  actionLabel: Tr[];
  prizeId: bigint;
};

export function emptyMsg(categoryKey = 'offers', channels = ['inbox']): Msg {
  return { categoryKey, channels, title: [], body: [], imageUrl: '', actionType: 'none', actionValue: '', actionLabel: [], prizeId: 0n };
}

export function msgFrom(r: Msg): Msg {
  return {
    categoryKey: r.categoryKey,
    channels: [...r.channels],
    title: r.title,
    body: r.body,
    imageUrl: r.imageUrl,
    actionType: r.actionType,
    actionValue: r.actionValue,
    actionLabel: r.actionLabel,
    prizeId: r.prizeId,
  };
}

export function msgArgs(m: Msg) {
  return { ...m, imageUrl: m.imageUrl.trim(), actionValue: m.actionType === 'none' ? '' : m.actionValue.trim() };
}

export function msgCheck(m: Msg, def: string) {
  if (!m.channels.length) return { ok: false, msg: codeText('CHANNEL_REQUIRED') } as const;
  if (trMissingDefault(m.title, def) || trMissingDefault(m.body, def)) return { ok: false, msg: t('trRequired', { lang: def }) } as const;
  return null;
}

export function MessageFields(props: { value: Msg; onChange: (v: Msg) => void; prefix: string; vars?: string; noPrize?: boolean }) {
  const m = props.value;
  const up = (p: Partial<Msg>) => props.onChange({ ...m, ...p });
  const hint =
    m.actionType === 'url' ? 'https://' : m.actionType === 'product' ? t('bnProductHint') : m.actionType === 'achievement' ? t('bnAchievementHint') : m.actionType === 'news' ? t('acNewsHint') : t('bnScreenHint');
  return (
    <>
      <Field label={t('ncCategory')} required>
        <NotifyCategoryPick value={m.categoryKey} onChange={v => up({ categoryKey: v })} testId={`${props.prefix}-category`} />
      </Field>
      <Field label={t('chChannels')} required>
        <ChannelPick value={m.channels} onChange={v => up({ channels: v })} testId={`${props.prefix}-channels`} />
      </Field>
      <Field label={t('msgTitle')} required className="span-2" hint={props.vars}>
        <TrInputs value={m.title} onChange={v => up({ title: v })} required name="title" />
      </Field>
      <Field label={t('msgBody')} required className="span-2" hint={t('msgBodyHint')}>
        <TrInputs value={m.body} onChange={v => up({ body: v })} required multiline name="body" />
      </Field>
      <Field label={t('msgImage')} hint={t('brUrlHint')}>
        <input className="input ltr" name="imageUrl" value={m.imageUrl} onChange={e => up({ imageUrl: e.target.value })} placeholder="https://" />
      </Field>
      {props.noPrize ? (
        <span />
      ) : (
        <Field label={t('msgPrize')} hint={t('msgPrizeHint')}>
          <IdPick kind="prize" value={m.prizeId} onChange={v => up({ prizeId: v })} none={t('none')} testId={`${props.prefix}-prize`} />
        </Field>
      )}
      <Field label={t('bnAction')}>
        <Choice value={m.actionType} onChange={v => up({ actionType: v, actionValue: '' })} name="actionType" options={ACTIONS7} testId={`${props.prefix}-action`} />
      </Field>
      {m.actionType !== 'none' ? (
        <Field label={t('bnActionValue')} hint={hint}>
          <input className="input ltr" name="actionValue" value={m.actionValue} onChange={e => up({ actionValue: e.target.value })} />
        </Field>
      ) : (
        <span />
      )}
      {m.actionType !== 'none' && (
        <Field label={t('bnActionLabel')} className="span-2" hint={t('optional')}>
          <TrInputs value={m.actionLabel} onChange={v => up({ actionLabel: v })} name="actionLabel" />
        </Field>
      )}
    </>
  );
}

export function QuietFields(props: { start: number; end: number; onChange: (s: number, e: number) => void }) {
  const none = props.start === 0 && props.end === 0;
  return (
    <Field label={t('qhTitle')} hint={none ? t('qhNone') : props.end < props.start ? t('qhWraps') : t('qhHint')} className="span-2">
      <div className="input-group">
        <input type="time" className="input ltr" name="quietStart" value={minutesToTime(props.start)} onChange={e => props.onChange(timeToMinutes(e.target.value), props.end)} aria-label={t('from')} />
        <input type="time" className="input ltr" name="quietEnd" value={minutesToTime(props.end)} onChange={e => props.onChange(props.start, timeToMinutes(e.target.value))} aria-label={t('until')} />
        <button type="button" className="btn btn-outline" style={{ height: 36 }} onClick={() => props.onChange(0, 0)} disabled={none}>
          {t('qhClear')}
        </button>
      </div>
    </Field>
  );
}

function quietText(s: number, e: number) {
  return s === 0 && e === 0 ? '' : digits(`${minutesToTime(s)}–${minutesToTime(e)}`);
}

export function playerIdOf(s: string) {
  const v = latin(s).trim().replace(/^#/, '');
  return /^\d+$/.test(v) ? BigInt(v) : 0n;
}

export function sendResultText(v: string) {
  const [kind, rest] = v.split(':');
  if (kind === 'sent') return { ok: true, text: t('sendSent', { ch: (rest ?? '').split(',').filter(Boolean).map(channelText).join('، ') }) };
  return { ok: false, text: t('sendSkipped', { why: reasonText(rest ?? '') }) };
}

export function SendDialog(props: { accountId?: bigint; onClose: () => void; channels?: string[] }) {
  const { def } = useLanguages();
  const [player, setPlayer] = useState(props.accountId ? String(props.accountId) : '');
  const [m, setM] = useState<Msg>(emptyMsg('system', props.channels ?? ['inbox']));
  return (
    <FormDialog
      title={t('sendTitle')}
      testId="send-dialog"
      width={760}
      onClose={props.onClose}
      submit={async () => {
        const id = playerIdOf(player);
        if (!id) return { ok: false, msg: t('sendNeedPlayer') } as const;
        const bad = msgCheck(m, def);
        if (bad) return bad;
        const r = await run(c => c.procedures.adminTestNotification({ accountId: id, ...msgArgs(m) }));
        if (!r.ok) return { ok: false, err: r.err } as const;
        const res = sendResultText(r.value);
        if (!res.ok) return { ok: false, msg: res.text } as const;
        toast('ok', res.text);
        return { ok: true } as const;
      }}
    >
      <Field label={t('elPlayer')} required hint={t('sendPlayerHint')}>
        <input
          className="input ltr"
          name="player"
          value={player}
          onChange={e => setPlayer(e.target.value)}
          inputMode="numeric"
          placeholder="#"
          disabled={!!props.accountId}
          autoFocus={!props.accountId}
          data-testid="send-player"
        />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <span className="small muted">{t('sendTestHint')}</span>
      </div>
      <MessageFields value={m} onChange={setM} prefix="send" />
    </FormDialog>
  );
}

function outboxBadge(s: string) {
  const cls = s === 'sent' ? 'b-ok' : s === 'failed' ? 'b-bad' : s === 'pending' || s === 'sending' ? 'b-warn' : '';
  const k: Record<string, StrKey> = { sent: 'obSent', failed: 'obFailed', pending: 'obPending', sending: 'obSending', skipped: 'obSkipped' };
  return <span className={`badge ${cls}`}>{k[s] ? t(k[s]) : s}</span>;
}

function kindText(k: string) {
  const map: Record<string, StrKey> = { campaign: 'knCampaign', auto: 'knAuto', news: 'knNews', direct: 'knDirect', test: 'knTest' };
  return map[k] ? t(map[k]) : k;
}

export function Messages() {
  useLocale();
  const route = useRoute();
  const campaigns = useRows('adminCampaigns');
  const catName = useCategoryName();
  const campaign = route.query.get('campaign') ?? '';
  const [player, setPlayer] = useState(route.query.get('player') ?? '');
  const [page, setPage] = useState(1);
  const [send, setSend] = useState(false);
  const p = useDebounced(player, 300);
  const accountId = playerIdOf(p);
  const { data, error, loading } = useFetch(() => getConn().procedures.adminOutbox({ accountId, campaignId: campaign ? BigInt(campaign) : 0n, page, pageSize: PAGE }), [String(accountId), campaign, page]);
  const rows = data?.rows ?? [];
  const cName = (id: bigint) => campaigns.find(c => c.id === id)?.name || `#${digits(String(id))}`;
  return (
    <main className="page" data-testid="page-messages">
      <PageHead
        title={t('navMessages')}
        sub={data ? t('obTotal', { n: num(data.total) }) : <Skel w={60} h={10} />}
        action={
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-outline" onClick={() => go('campaigns?new=1')} data-testid="msg-segment">
              <UsersThree className="ic" />
              {t('msgToSegment')}
            </button>
            <SendButton onClick={() => setSend(true)} />
          </div>
        }
      />
      <div className="toolbar">
        <div className="input-affix search" style={{ width: 200 }}>
          <MagnifyingGlass className="ic" />
          <input
            className="input"
            value={player}
            onChange={e => {
              setPlayer(e.target.value);
              setPage(1);
            }}
            placeholder={t('elPlayer')}
            aria-label={t('elPlayer')}
            inputMode="numeric"
            data-testid="msg-player"
          />
        </div>
        <select
          className="select"
          style={{ width: 'auto', minWidth: 200 }}
          value={campaign}
          onChange={e => {
            setPage(1);
            pageQuery('messages', { campaign: e.target.value });
          }}
          aria-label={t('navCampaigns')}
          data-testid="msg-campaign"
        >
          <option value="">{t('obAllCampaigns')}</option>
          {[...campaigns]
            .sort((a, b) => (a.id < b.id ? 1 : -1))
            .map(c => (
              <option key={String(c.id)} value={String(c.id)}>
                {c.name || trText(c.title)}
              </option>
            ))}
        </select>
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="msg-table">
          <thead>
            <tr>
              <th>{t('auColTime')}</th>
              <th>{t('pyColPlayer')}</th>
              <th>{t('obChannel')}</th>
              <th>{t('msgTitle')}</th>
              <th>{t('obSource')}</th>
              <th>{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty icon={<Tray className="ic" weight="duotone" />} title={t('obEmpty')} text={t('obEmptyHint')} />
                </td>
              </tr>
            ) : (
              rows.map(x => (
                <tr key={String(x.id)} data-testid={`msg-row-${x.id}`}>
                  <td className="nowrap">{x.createdAt ? date(x.createdAt.toDate()) : '—'}</td>
                  <td>
                    <a className="row-link" href={`#/player?id=${x.accountId}`}>
                      #{digits(String(x.accountId))}
                    </a>
                  </td>
                  <td>{channelText(x.channel)}</td>
                  <td>
                    <span className="primary">{x.title}</span>
                    <div className="small muted cell-detail">{x.body}</div>
                  </td>
                  <td className="small">
                    {kindText(x.kind)}
                    {x.campaignId ? <div className="muted">{cName(x.campaignId)}</div> : <div className="muted">{catName(x.categoryKey)}</div>}
                  </td>
                  <td>
                    <span className="stack" style={{ gap: 2 }}>
                      {outboxBadge(x.status)}
                      {x.channel === 'push' && x.devices ? <span className="small muted">{t('obDevices', { s: x.sent, n: x.devices })}</span> : null}
                      {x.error && <span className="small neg">{codeText(x.error)}</span>}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards" data-testid="msg-cards">
          {rows.map(x => (
            <div className="pcard" key={String(x.id)}>
              <div className="row">
                <b className="grow">{x.title}</b>
                {outboxBadge(x.status)}
              </div>
              <div className="pcard-meta">
                <span>{t('pyColPlayer')}</span>
                <span>#{digits(String(x.accountId))}</span>
                <span>{t('obChannel')}</span>
                <span>{channelText(x.channel)}</span>
                <span>{t('auColTime')}</span>
                <span>{x.createdAt ? date(x.createdAt.toDate()) : '—'}</span>
              </div>
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {send && <SendDialog onClose={() => setSend(false)} accountId={accountId || undefined} />}
    </main>
  );
}

function SendButton(props: { onClick: () => void; label?: string; testId?: string }) {
  const { can } = useSession();
  if (!can('admin')) return null;
  return (
    <button type="button" className="btn btn-primary" onClick={props.onClick} data-testid={props.testId ?? 'msg-send'}>
      <PaperPlaneTilt className="ic" />
      {props.label ?? t('msgToPlayer')}
    </button>
  );
}

type CatRow = RowOf<'notifyCategory'>;

function CategoryDialog7(props: { row?: CatRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [mandatory, setMandatory] = useState(r?.mandatory ?? false);
  const [defaultOn, setDefaultOn] = useState(r?.defaultOn ?? true);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('ncEdit') : t('ncNew')}
      testId="nc-dialog"
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ?? save(() => getConn().reducers.adminSaveNotifyCategory({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, description, mandatory, defaultOn: mandatory || defaultOn, isActive, sort }))
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
      <Field label={t('description')} className="span-2" hint={t('ncDescHint')}>
        <TrInputs value={description} onChange={setDescription} name="description" />
      </Field>
      <div className="span-2 stack stack-sm">
        <SwitchRow checked={mandatory} onChange={setMandatory} label={t('ncMandatory')} testId="nc-mandatory" />
        <span className="hint">{t('ncMandatoryHint')}</span>
        <SwitchRow checked={mandatory || defaultOn} onChange={setDefaultOn} disabled={mandatory} label={t('ncDefaultOn')} />
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

export function NotifyCategories() {
  useLocale();
  const list = useRows('notifyCategory');
  const ns = useRows('adminNewsSettings')[0];
  const loaded = useLoaded();
  const [edit, setEdit] = useState<CatRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  const locked = (r: CatRow) => r.key === 'system' || r.key === 'news' || r.key === ns?.notifyCategoryKey;
  return (
    <main className="page" data-testid="page-notify-categories">
      <PageHead title={t('navNotifyCategories')} sub={t('ncSub')} action={<AddButton label={t('ncNew')} onClick={() => setEdit('new')} testId="nc-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="nc"
        keyOf={r => r.key}
        empty={{ icon: <FolderSimple className="ic" weight="duotone" />, title: t('emptyList') }}
        locked={locked}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('ncKind'), render: r => (r.mandatory ? <span className="badge b-violet">{t('ncMandatory')}</span> : <span className="badge">{t('ncOptional')}</span>) },
          { label: t('ncDefaultOn'), render: r => (r.defaultOn ? t('yes') : t('no')) },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteNotifyCategory({ id: r.id }))}
      />
      {edit && <CategoryDialog7 row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

const SA_SAMPLE =
  '{\n  "type": "service_account",\n  "project_id": "my-game",\n  "private_key_id": "…",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n…",\n  "client_email": "firebase-adminsdk@my-game.iam.gserviceaccount.com"\n}';

export function PushPage() {
  useLocale();
  const { can } = useSession();
  const cfg = useRows('adminPushConfig')[0];
  const [provider, setProvider] = useState<string | null>(null);
  const [sa, setSa] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testPlayer, setTestPlayer] = useState('');
  const [testTitle, setTestTitle] = useState('');
  const [testBody, setTestBody] = useState('');
  const [testRes, setTestRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [devPlayer, setDevPlayer] = useState('');
  const devId = playerIdOf(useDebounced(devPlayer, 300));
  const [logPage, setLogPage] = useState(1);
  const devices = useFetch(() => (devId ? getConn().procedures.adminPushDevices({ accountId: devId }) : Promise.resolve([])), [String(devId)]);
  const log = useFetch(() => getConn().procedures.adminPushLog({ accountId: devId, page: logPage, pageSize: 10 }), [String(devId), logPage]);
  const prov = provider ?? cfg?.provider ?? 'log';
  const ro = !can('admin');
  async function saveCfg() {
    setBusy(true);
    setErr(null);
    const r = await run(c => c.reducers.adminSavePushConfig({ provider: prov, serviceAccount: sa.trim() }), t('saved'));
    setBusy(false);
    if (r.ok) setSa('');
    else setErr(errorText(r.err));
  }
  async function test() {
    setTestRes(null);
    const id = playerIdOf(testPlayer);
    if (!id) {
      setTestRes({ ok: false, text: t('sendNeedPlayer') });
      return;
    }
    const tr = (s: string) => (s.trim() ? [{ lang: 'fa', text: s.trim() }] : []);
    const r = await run(c =>
      c.procedures.adminTestNotification({
        accountId: id,
        categoryKey: 'system',
        channels: ['push'],
        title: tr(testTitle || t('pushTestDefaultTitle')),
        body: tr(testBody || t('pushTestDefaultBody')),
        imageUrl: '',
        actionType: 'none',
        actionValue: '',
        actionLabel: [],
        prizeId: 0n,
      })
    );
    setTestRes(r.ok ? sendResultText(r.value) : { ok: false, text: errorText(r.err) });
  }
  return (
    <main className="page" data-testid="page-push">
      <PageHead title={t('navPush')} sub={t('pushSub')} />
      <Section
        title={t('pushProvider')}
        testId="push-provider"
        action={
          cfg ? (
            <span className={`badge ${cfg.provider === 'fcm' && cfg.configured ? 'b-ok' : 'b-info'}`} data-testid="push-current">
              {cfg.provider === 'fcm' ? t('pushFcm') : t('pushLog')}
            </span>
          ) : (
            <Skel w={60} h={18} />
          )
        }
      >
        {!cfg ? (
          <Skel h={80} r={6} />
        ) : (
          <div className="stack">
            <Seg
              value={prov}
              onChange={v => setProvider(v)}
              options={[
                { value: 'log', label: t('pushLog') },
                { value: 'fcm', label: t('pushFcm') },
              ]}
              label={t('pushProvider')}
            />
            {prov === 'log' ? (
              <span className="small sub">{t('pushLogHint')}</span>
            ) : (
              <div className="stack">
                <span className="small sub">{t('pushFcmHint')}</span>
                {cfg.configured && (
                  <dl className="kv" data-testid="push-saved">
                    <dt>{t('pushProject')}</dt>
                    <dd className="mono">{cfg.projectId}</dd>
                    <dt>{t('pushEmail')}</dt>
                    <dd className="mono">{cfg.clientEmail}</dd>
                    <dt>{t('pushKey')}</dt>
                    <dd className="mono">{cfg.keyHint}</dd>
                  </dl>
                )}
                <Field label={t('pushSa')} hint={cfg.configured ? t('pushSaKeep') : t('pushSaHint')}>
                  <textarea
                    className="textarea ltr mono"
                    name="serviceAccount"
                    rows={7}
                    value={sa}
                    onChange={e => setSa(e.target.value)}
                    placeholder={SA_SAMPLE}
                    disabled={ro}
                    spellCheck={false}
                    autoComplete="off"
                    data-testid="push-sa"
                  />
                </Field>
              </div>
            )}
            <ErrBox text={err} />
            {!ro && (
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={saveCfg} data-testid="push-save">
                  {t('save')}
                </button>
              </div>
            )}
          </div>
        )}
      </Section>
      {!ro && (
        <Section title={t('pushTest')} testId="push-test">
          <div className="stack">
            <span className="small sub">{prov === 'log' || cfg?.provider === 'log' ? t('pushTestLogHint') : t('pushTestHint')}</span>
            <div className="form-grid">
              <Field label={t('elPlayer')} required>
                <input className="input ltr" value={testPlayer} onChange={e => setTestPlayer(e.target.value)} inputMode="numeric" placeholder="#" name="testPlayer" data-testid="push-test-player" />
              </Field>
              <Field label={t('msgTitle')} hint={t('optional')}>
                <input className="input" value={testTitle} onChange={e => setTestTitle(e.target.value)} placeholder={t('pushTestDefaultTitle')} name="testTitle" />
              </Field>
              <Field label={t('msgBody')} hint={t('optional')} className="span-2">
                <input className="input" value={testBody} onChange={e => setTestBody(e.target.value)} placeholder={t('pushTestDefaultBody')} name="testBody" />
              </Field>
            </div>
            {testRes && (testRes.ok ? <OkBox text={testRes.text} /> : <ErrBox text={testRes.text} />)}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={test} data-testid="push-test-go">
                <PaperPlaneTilt className="ic" />
                {t('pushTestSend')}
              </button>
            </div>
          </div>
        </Section>
      )}
      <Section
        title={t('pushDevices')}
        pad={false}
        testId="push-devices"
        action={
          <div className="input-affix search" style={{ width: 180 }}>
            <MagnifyingGlass className="ic" />
            <input
              className="input"
              value={devPlayer}
              onChange={e => {
                setDevPlayer(e.target.value);
                setLogPage(1);
              }}
              placeholder={t('elPlayer')}
              aria-label={t('elPlayer')}
              inputMode="numeric"
              data-testid="push-dev-player"
            />
          </div>
        }
      >
        {!devId ? (
          <Empty icon={<DeviceMobile className="ic" weight="duotone" />} title={t('pushDevicesPick')} />
        ) : !devices.data ? (
          <div className="card-pad">
            <Skel h={40} r={6} />
          </div>
        ) : devices.data.length === 0 ? (
          <Empty icon={<DeviceMobile className="ic" weight="duotone" />} title={t('pushNoDevices')} />
        ) : (
          <DeviceList list={devices.data} />
        )}
      </Section>
      <Section title={devId ? t('pushLogOf', { id: digits(String(devId)) }) : t('pushLogTitle')} pad={false} testId="push-log">
        {!log.data ? (
          <div className="card-pad">
            <Skel h={60} r={6} />
          </div>
        ) : log.data.rows.length === 0 ? (
          <Empty icon={<BellRinging className="ic" weight="duotone" />} title={t('emptyList')} />
        ) : (
          <>
            <div className="scroll-x">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>{t('auColTime')}</th>
                    <th>{t('pyColPlayer')}</th>
                    <th>{t('pushToken')}</th>
                    <th>{t('msgTitle')}</th>
                    <th>{t('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.data.rows.map(l => (
                    <tr key={String(l.id)} data-testid={`push-log-${l.id}`}>
                      <td className="nowrap">{date(l.at.toDate())}</td>
                      <td>#{digits(String(l.accountId))}</td>
                      <td className="mono">{l.token}</td>
                      <td>{l.title}</td>
                      <td>
                        <span className={`badge ${l.status === 'sent' ? 'b-ok' : 'b-bad'}`}>{l.status === 'sent' ? t('obSent') : l.status === 'dead' ? t('pushDead') : t('obFailed')}</span>
                        {l.error && <div className="small neg">{codeText(l.error)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={logPage} pageSize={10} total={log.data.total} onPage={setLogPage} />
          </>
        )}
      </Section>
    </main>
  );
}

function DeviceList(props: { list: { id: bigint; token: string; platform: string; appVersion: string; isActive: boolean; failCount: number; lastError: string; lastSeenAt: bigint }[] }) {
  return (
    <div className="list" data-testid="device-list">
      {props.list.map(d => (
        <div className="list-row" key={String(d.id)}>
          <DeviceMobile className="ic muted" />
          <div className="list-main">
            <span className="list-title mono">{d.token}</span>
            <span className="list-sub">
              {d.platform}
              {d.appVersion ? ` · ${digits(d.appVersion)}` : ''} · {usMicros(d.lastSeenAt)}
              {d.lastError ? ` · ${codeText(d.lastError)}` : ''}
            </span>
          </div>
          <ActiveBadge on={d.isActive} />
        </div>
      ))}
    </div>
  );
}

type CampaignRow = RowOf<'adminCampaigns'>;

const C_STATUS: [string, StrKey][] = [
  ['draft', 'csDraft'],
  ['scheduled', 'csScheduled'],
  ['sending', 'csSending'],
  ['done', 'csDone'],
  ['cancelled', 'csCancelled'],
];

export function campaignBadge(s: string) {
  const cls = s === 'done' ? 'b-ok' : s === 'sending' ? 'b-info' : s === 'scheduled' ? 'b-warn' : s === 'cancelled' ? 'b-bad' : '';
  const k = C_STATUS.find(x => x[0] === s)?.[1];
  return <span className={`badge ${cls}`}>{k ? t(k) : s}</span>;
}

function idsText(list: bigint[]) {
  return list.map(String).join(', ');
}

function idsFrom(s: string) {
  return [
    ...new Set(
      latin(s)
        .split(/[\s,،]+/)
        .map(x => x.replace(/^#/, ''))
        .filter(x => /^\d+$/.test(x))
    ),
  ].map(x => BigInt(x));
}

function CampaignDialog(props: { row?: CampaignRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [name, setName] = useState(r?.name ?? '');
  const [m, setM] = useState<Msg>(r ? msgFrom(r) : emptyMsg());
  const [target, setTarget] = useState(r?.target ?? 'all');
  const [accounts, setAccounts] = useState(r ? idsText(r.accountIds) : '');
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [excludeTagIds, setExclude] = useState<bigint[]>(r?.excludeTagIds ?? []);
  const [levelTableId, setTable] = useState<bigint>(r?.levelTableId ?? 0n);
  const [minLevel, setMin] = useState(r?.minLevel ?? 0);
  const [maxLevel, setMax] = useState(r?.maxLevel ?? 0);
  const [countries, setCountries] = useState<string[]>(r?.countries ?? []);
  const [inactiveDays, setInactive] = useState(r?.inactiveDays ?? 0);
  const [schedule, setSchedule] = useState(r?.schedule ?? 'now');
  const [at, setAt] = useState(r ? microsToInput(r.scheduledAt) : '');
  const [repeatMinutes, setRepeat] = useState(r?.repeatMinutes || 1440);
  const [until, setUntil] = useState(r ? microsToInput(r.repeatUntil) : '');
  const [quiet, setQuiet] = useState<[number, number]>([r?.quietStart ?? 0, r?.quietEnd ?? 0]);
  return (
    <FormDialog
      title={r ? t('cmEdit') : t('cmNew')}
      testId="cm-dialog"
      width={840}
      onClose={props.onClose}
      submit={async () =>
        msgCheck(m, def) ??
        save(() =>
          getConn().reducers.adminSaveCampaign({
            id: r?.id ?? 0n,
            name: name.trim(),
            ...msgArgs(m),
            target,
            accountIds: target === 'players' ? idsFrom(accounts) : [],
            tagIds: target === 'tags' ? tagIds : [],
            excludeTagIds,
            levelTableId,
            minLevel,
            maxLevel,
            countries,
            inactiveDays,
            schedule,
            scheduledAt: schedule === 'now' ? 0n : microsFromInput(at),
            repeatMinutes: schedule === 'recurring' ? repeatMinutes : 0,
            repeatUntil: schedule === 'recurring' ? microsFromInput(until) : 0n,
            quietStart: quiet[0],
            quietEnd: quiet[1],
          })
        )
      }
    >
      <Field label={t('cmName')} hint={t('cmNameHint')} className="span-2">
        <input className="input" name="name" value={name} onChange={e => setName(e.target.value)} autoFocus={!r} data-testid="cm-name" />
      </Field>
      <MessageFields value={m} onChange={setM} prefix="cm" vars={t('cmVars')} />
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('cmAudience')}
      </div>
      <Field label={t('cmTarget')} className="span-2">
        <Seg
          value={target}
          onChange={setTarget}
          label={t('cmTarget')}
          options={[
            { value: 'all', label: t('cmTargetAll') },
            { value: 'players', label: t('cmTargetPlayers') },
            { value: 'tags', label: t('cmTargetTags') },
          ]}
        />
      </Field>
      {target === 'players' && (
        <Field label={t('cmPlayers')} hint={t('cmPlayersHint')} className="span-2" required>
          <textarea className="textarea ltr" name="accountIds" value={accounts} onChange={e => setAccounts(e.target.value)} placeholder="12, 15, 31" data-testid="cm-players" />
        </Field>
      )}
      {target === 'tags' && (
        <Field label={t('cmTags')} hint={t('cmTagsHint')} className="span-2" required>
          <TagPicker keyType="user" value={tagIds} onChange={setTags} testId="cm-tags" />
        </Field>
      )}
      <Field label={t('ofExclude')} className="span-2">
        <TagPicker keyType="user" value={excludeTagIds} onChange={setExclude} testId="cm-exclude" />
      </Field>
      <Field label={t('tkLevelTable')}>
        <IdPick kind="levelTable" value={levelTableId} onChange={setTable} none={t('imMainTable')} />
      </Field>
      <Field label={t('tkLevelRange')} hint={t('cmLevelHint')}>
        <div className="input-group">
          <NumInput value={minLevel} onChange={setMin} name="minLevel" />
          <NumInput value={maxLevel} onChange={setMax} name="maxLevel" />
        </div>
      </Field>
      <Field label={t('stCountries')}>
        <CountriesPick value={countries} onChange={setCountries} />
      </Field>
      <Field label={t('cmInactive')} hint={t('cmInactiveHint')}>
        <NumInput value={inactiveDays} onChange={setInactive} name="inactiveDays" />
      </Field>
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('cmWhen')}
      </div>
      <Field label={t('cmSchedule')} className="span-2">
        <Seg
          value={schedule}
          onChange={setSchedule}
          label={t('cmSchedule')}
          options={[
            { value: 'now', label: t('cmNow') },
            { value: 'at', label: t('cmAt') },
            { value: 'recurring', label: t('cmRecurring') },
          ]}
        />
      </Field>
      {schedule !== 'now' && (
        <Field label={schedule === 'at' ? t('cmAtTime') : t('cmFirstTime')} hint={schedule === 'recurring' ? t('optional') : undefined} required={schedule === 'at'}>
          <input type="datetime-local" className="input ltr" name="scheduledAt" value={at} onChange={e => setAt(e.target.value)} data-testid="cm-at" />
        </Field>
      )}
      {schedule === 'recurring' && (
        <>
          <Field label={t('cmRepeat')} hint={t('cmRepeatHint')}>
            <NumInput value={repeatMinutes} onChange={setRepeat} name="repeatMinutes" />
          </Field>
          <Field label={t('cmUntil')} hint={t('optional')}>
            <input type="datetime-local" className="input ltr" name="repeatUntil" value={until} onChange={e => setUntil(e.target.value)} />
          </Field>
        </>
      )}
      {schedule === 'at' && <span />}
      <QuietFields start={quiet[0]} end={quiet[1]} onChange={(a, b) => setQuiet([a, b])} />
    </FormDialog>
  );
}

function PreviewTiles(props: { id: bigint }) {
  const { data, error } = useFetch(() => getConn().procedures.adminCampaignPreview({ id: props.id }), [String(props.id)]);
  return (
    <>
      <ErrBox text={error ? errorText(error) : null} />
      <dl className="stat-row" style={{ margin: 0 }} data-testid="cm-preview">
        {[
          ['cmpTargeted', data?.targeted],
          ['cmpOptedOut', data?.optedOut],
          ['cmpWithPush', data?.withPush],
          ['cmpWithPhone', data?.withPhone],
        ].map(([k, v]) => (
          <div className="stat" key={k as string}>
            <dt>{t(k as StrKey)}</dt>
            <dd data-testid={`cm-preview-${k}`}>{data ? num(v as number) : <Skel w={30} h={14} />}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function SendCampaignDialog(props: { row: CampaignRow; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = props.row;
  return (
    <Dialog
      title={t('cmSendOf', { name: r.name || trText(r.title) })}
      width={560}
      onClose={props.onClose}
      testId="cm-send-dialog"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            data-testid="cm-send-go"
            onClick={async () => {
              setBusy(true);
              const res = await run(c => c.reducers.adminSendCampaign({ id: r.id }), r.schedule === 'now' ? t('cmSentNow') : t('cmScheduledOk'));
              setBusy(false);
              if (res.ok) props.onClose();
              else setErr(errorText(res.err));
            }}
          >
            <PaperPlaneTilt className="ic" />
            {r.schedule === 'now' ? t('cmSendNow') : t('cmSchedule2')}
          </button>
        </>
      }
    >
      <div className="stack">
        <span className="small sub">{r.schedule === 'now' ? t('cmSendHintNow') : t('cmSendHintAt', { when: scheduleText(r) })}</span>
        <PreviewTiles id={r.id} />
        <ErrBox text={err} />
      </div>
    </Dialog>
  );
}

function scheduleText(r: CampaignRow) {
  if (r.schedule === 'now') return t('cmNow');
  const first = r.scheduledAt ? usMicros(r.scheduledAt) : t('cmNow');
  if (r.schedule === 'at') return first;
  return t('cmEvery', {
    n:
      r.repeatMinutes >= 1440 && r.repeatMinutes % 1440 === 0
        ? t('cmDays', { n: r.repeatMinutes / 1440 })
        : r.repeatMinutes % 60 === 0
          ? t('cmHours', { n: r.repeatMinutes / 60 })
          : t('cmMinutes', { n: r.repeatMinutes }),
    first,
  });
}

function useTargetText() {
  const tags = useRows('tag');
  const { def } = useLanguages();
  return (r: { target: string; accountIds: bigint[]; tagIds: bigint[]; excludeTagIds: bigint[]; countries: string[]; inactiveDays: number; minLevel: number; maxLevel: number }) => {
    const parts: string[] = [];
    if (r.target === 'all') parts.push(t('cmTargetAll'));
    if (r.target === 'players') parts.push(t('cmPlayersN', { n: r.accountIds.length }));
    if (r.target === 'tags') parts.push(r.tagIds.map(id => trText(tags.find(x => x.id === id)?.title, def) || `#${id}`).join('، '));
    if (r.excludeTagIds.length) parts.push(t('cmExcludeN', { n: r.excludeTagIds.length }));
    if (r.minLevel || r.maxLevel) parts.push(t('cmLevelRange', { a: r.minLevel, b: r.maxLevel || '∞' }));
    if (r.countries.length) parts.push(r.countries.join('، '));
    if (r.inactiveDays) parts.push(t('cmInactiveN', { n: r.inactiveDays }));
    return parts.join(' · ');
  };
}

function Progress(props: { a: number; b: number }) {
  const pct = props.b ? Math.round((props.a / props.b) * 100) : 0;
  return (
    <span className="stack" style={{ gap: 4, minWidth: 110 }}>
      <span className="meter" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="small muted">{t('cmSentOf', { a: num(props.a), b: num(props.b) })}</span>
    </span>
  );
}

function ReportDialog(props: { row: CampaignRow; onClose: () => void }) {
  const rows = useRows('adminCampaigns');
  const r = rows.find(x => x.id === props.row.id) ?? props.row;
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useFetch(() => getConn().procedures.adminCampaignDeliveries({ campaignId: r.id, status, page, pageSize: 10 }), [String(r.id), status, page, r.sent, r.skipped]);
  const tiles: [StrKey, number][] = [
    ['crRecipients', r.recipients],
    ['crSent', r.sent],
    ['crSkipped', r.skipped],
    ['crInbox', r.inboxCount],
    ['crPush', r.pushSent],
    ['crPushFailed', r.pushFailed],
    ['crSms', r.smsSent],
    ['crOpened', r.opened],
  ];
  return (
    <Dialog title={t('crTitle', { name: r.name || trText(r.title) })} width={760} onClose={props.onClose} testId="cm-report">
      <div className="stack">
        <div className="row row-wrap">
          {campaignBadge(r.status)}
          <span className="small muted grow">
            {t('crRun', { n: r.run + 1 })}، {t('crBatches', { n: r.batches })}
            {r.finishedAt ? `، ${t('crFinished', { when: usMicros(r.finishedAt) })}` : ''}
          </span>
          <a className="btn btn-sm" href={`#/messages?campaign=${r.id}`} data-testid="cm-report-outbox">
            <Tray className="ic" />
            {t('crOutbox')}
          </a>
        </div>
        <dl className="stat-row grid-4" style={{ margin: 0 }}>
          {tiles.map(([k, v]) => (
            <div className="stat" key={k}>
              <dt>{t(k)}</dt>
              <dd data-testid={`cr-${k}`}>{num(v)}</dd>
            </div>
          ))}
        </dl>
        <div className="row row-wrap">
          <span className="section-label grow">{t('crDeliveries')}</span>
          <Seg
            value={status}
            onChange={v => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: '', label: t('all') },
              { value: 'sent', label: t('obSent') },
              { value: 'skipped', label: t('obSkipped') },
            ]}
          />
        </div>
        <div className="card">
          {!data ? (
            <div className="card-pad">
              <Skel h={60} r={6} />
            </div>
          ) : data.rows.length === 0 ? (
            <Empty icon={<ChartBar className="ic" weight="duotone" />} title={t('crNoDeliveries')} />
          ) : (
            <>
              <div className="scroll-x">
                <table className="mini-table" data-testid="cr-table">
                  <thead>
                    <tr>
                      <th>{t('auColTime')}</th>
                      <th>{t('pyColPlayer')}</th>
                      <th>{t('status')}</th>
                      <th>{t('chChannels')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(d => (
                      <tr key={d.key}>
                        <td className="nowrap">{usMicros(d.at)}</td>
                        <td>
                          <a className="row-link" href={`#/player?id=${d.accountId}`}>
                            #{digits(String(d.accountId))}
                          </a>
                        </td>
                        <td>
                          <span className={`badge ${d.status === 'sent' ? 'b-ok' : ''}`}>{d.status === 'sent' ? t('obSent') : t('obSkipped')}</span>{' '}
                          {d.reason && <span className="small muted">{reasonText(d.reason)}</span>}
                        </td>
                        <td>
                          <ChannelChips list={d.channels} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={10} total={data.total} onPage={setPage} />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function Campaigns() {
  useLocale();
  const route = useRoute();
  const { can } = useSession();
  const list = useRows('adminCampaigns');
  const loaded = useLoaded();
  const catName = useCategoryName();
  const targetText = useTargetText();
  const status = route.query.get('status') ?? '';
  const [edit, setEdit] = useState<CampaignRow | 'new' | null>(route.query.get('new') ? 'new' : null);
  const [sending, setSending] = useState<CampaignRow | null>(null);
  const [report, setReport] = useState<CampaignRow | null>(null);
  const rows = [...list].filter(c => !status || c.status === status).sort((a, b) => (a.id < b.id ? 1 : -1));
  const count = (s: string) => list.filter(c => c.status === s).length;
  async function cancel(r: CampaignRow) {
    if (!(await confirmAsk(t('cmCancelConfirm', { name: r.name || trText(r.title) }), { danger: true, ok: t('cmCancel') }))) return;
    await runToast(c => c.reducers.adminCancelCampaign({ id: r.id }), t('cmCancelled'));
  }
  return (
    <main className="page" data-testid="page-campaigns">
      <PageHead title={t('navCampaigns')} sub={num(list.length)} action={<AddButton label={t('cmNew')} onClick={() => setEdit('new')} testId="cm-add" />} />
      <div className="toolbar">
        <Seg
          value={status}
          onChange={v => pageQuery('campaigns', { status: v })}
          label={t('status')}
          options={[{ value: '', label: t('all') }, ...C_STATUS.map(([v, k]) => ({ value: v, label: `${t(k)} ${count(v) ? digits(count(v)) : ''}`.trim() }))]}
        />
      </div>
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="cm"
        keyOf={r => String(r.id)}
        empty={{ icon: <Megaphone className="ic" weight="duotone" />, title: t('cmEmpty') }}
        cardTitle={r => <b>{r.name || trText(r.title)}</b>}
        cols={[
          {
            label: t('cmName'),
            render: r => (
              <>
                <span className="primary">{r.name || trText(r.title)}</span>
                <div className="small muted">
                  {r.kind === 'news' ? `${t('knNews')} · ` : ''}
                  {catName(r.categoryKey)}
                </div>
              </>
            ),
          },
          { label: t('status'), render: r => campaignBadge(r.status) },
          { label: t('cmAudience'), render: r => <span className="small">{targetText(r)}</span> },
          {
            label: t('cmWhen'),
            render: r => (
              <span className="small">
                {scheduleText(r)}
                {quietText(r.quietStart, r.quietEnd) ? <div className="muted">{t('qhShort', { t: quietText(r.quietStart, r.quietEnd) })}</div> : null}
              </span>
            ),
          },
          { label: t('chChannels'), render: r => <ChannelChips list={r.channels} /> },
          { label: t('cmProgress'), render: r => (r.status === 'draft' ? <span className="muted small">—</span> : <Progress a={r.sent} b={r.recipients} />) },
        ]}
        extra={(r, card) => {
          const p = card ? 'cmc' : 'cm';
          const k = String(r.id);
          return (
            <>
              {r.status === 'draft' && can('admin') && (
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setSending(r)} data-testid={`${p}-send-${k}`}>
                  <PaperPlaneTilt className="ic" />
                  {t('cmSend')}
                </button>
              )}
              {(r.status === 'scheduled' || r.status === 'sending') && can('admin') && (
                <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => cancel(r)} data-testid={`${p}-cancel-${k}`}>
                  <Prohibit className="ic" />
                  {t('cmCancel')}
                </button>
              )}
              {r.status !== 'draft' && (
                <button type="button" className="btn btn-sm" onClick={() => setReport(r)} data-testid={`${p}-report-${k}`}>
                  <ChartBar className="ic" />
                  {t('cmReport')}
                </button>
              )}
              {r.status === 'draft' && can('admin') && r.kind === 'campaign' && (
                <button type="button" className="btn btn-sm btn-icon" onClick={() => setEdit(r)} aria-label={t('edit')} title={t('edit')} data-testid={`${p}-edit-${k}`}>
                  <EditIcon />
                </button>
              )}
              {r.status !== 'scheduled' && r.status !== 'sending' && can('admin') && (
                <button
                  type="button"
                  className="btn btn-sm btn-icon btn-danger-ghost"
                  onClick={() => del(t('deleteConfirmName', { name: r.name || trText(r.title) }), () => getConn().reducers.adminDeleteCampaign({ id: r.id }))}
                  aria-label={t('delete')}
                  title={t('delete')}
                  data-testid={`${p}-del-${k}`}
                >
                  <TrashIcon />
                </button>
              )}
            </>
          );
        }}
      />
      {edit && (
        <CampaignDialog
          row={edit === 'new' ? undefined : edit}
          onClose={() => {
            setEdit(null);
            if (route.query.get('new')) pageQuery('campaigns', { status });
          }}
        />
      )}
      {sending && <SendCampaignDialog row={sending} onClose={() => setSending(null)} />}
      {report && <ReportDialog row={report} onClose={() => setReport(null)} />}
    </main>
  );
}

function EditIcon() {
  return <PencilSimple className="ic" />;
}

function TrashIcon() {
  return <Trash className="ic" />;
}

type RuleRow = RowOf<'adminAutoRules'>;

const TRIGGERS: [string, StrKey][] = [
  ['event', 'trEvent'],
  ['first_login', 'trFirstLogin'],
  ['inactive', 'trInactive'],
  ['payment_success', 'trPayment'],
];

const TRIGGER_VARS: Record<string, string> = {
  event: '{player} {value}',
  first_login: '{player}',
  inactive: '{player} {days}',
  payment_success: '{player} {amount} {paymentId}',
};

function RuleDialog(props: { row?: RuleRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState(r?.name ?? '');
  const [trigger, setTrigger] = useState(r?.trigger ?? 'first_login');
  const [eventKey, setEventKey] = useState(r?.eventKey ?? '');
  const [matchField, setMatchField] = useState(r?.matchField ?? '');
  const [matchValue, setMatchValue] = useState(r?.matchValue ?? '');
  const [inactiveDays, setInactive] = useState(r?.inactiveDays || 7);
  const [m, setM] = useState<Msg>(r ? msgFrom(r) : emptyMsg('reminders'));
  const [cooldownMinutes, setCooldown] = useState(r?.cooldownMinutes ?? 0);
  const [quiet, setQuiet] = useState<[number, number]>([r?.quietStart ?? 0, r?.quietEnd ?? 0]);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  return (
    <FormDialog
      title={r ? t('arEdit') : t('arNew')}
      testId="ar-dialog"
      width={820}
      onClose={props.onClose}
      submit={async () =>
        msgCheck(m, def) ??
        save(() =>
          getConn().reducers.adminSaveAutoRule({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name: name.trim(),
            trigger,
            eventKey: trigger === 'event' ? eventKey : '',
            matchField: trigger === 'event' ? matchField.trim() : '',
            matchValue: trigger === 'event' ? matchValue.trim() : '',
            inactiveDays: trigger === 'inactive' ? inactiveDays : 0,
            ...msgArgs(m),
            cooldownMinutes,
            quietStart: quiet[0],
            quietEnd: quiet[1],
            isActive,
          })
        )
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('arName')} hint={t('cmNameHint')}>
        <input className="input" name="name" value={name} onChange={e => setName(e.target.value)} />
      </Field>
      <Field label={t('arTrigger')} className="span-2">
        <Seg value={trigger} onChange={setTrigger} label={t('arTrigger')} options={TRIGGERS.map(([v, k]) => ({ value: v, label: t(k) }))} />
      </Field>
      {trigger === 'event' && (
        <>
          <Field label={t('arEvent')} required>
            <KeyPick kind="event" value={eventKey} onChange={setEventKey} none="—" testId="ar-event" />
          </Field>
          <Field label={t('arMatch')} hint={t('arMatchHint')}>
            <div className="input-group">
              <input className="input ltr" name="matchField" value={matchField} onChange={e => setMatchField(e.target.value)} placeholder={t('arMatchField')} aria-label={t('arMatchField')} />
              <input className="input ltr" name="matchValue" value={matchValue} onChange={e => setMatchValue(e.target.value)} placeholder={t('arMatchValue')} aria-label={t('arMatchValue')} />
            </div>
          </Field>
        </>
      )}
      {trigger === 'inactive' && (
        <Field label={t('arInactiveDays')} hint={t('arInactiveHint')} className="span-2">
          <NumInput value={inactiveDays} onChange={setInactive} name="inactiveDays" />
        </Field>
      )}
      <MessageFields value={m} onChange={setM} prefix="ar" vars={t('arVars', { v: TRIGGER_VARS[trigger] ?? '{player}' })} />
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('arLimits')}
      </div>
      <Field label={t('arCooldown')} hint={t('arCooldownHint')}>
        <NumInput value={cooldownMinutes} onChange={setCooldown} name="cooldownMinutes" />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
      <QuietFields start={quiet[0]} end={quiet[1]} onChange={(a, b) => setQuiet([a, b])} />
    </FormDialog>
  );
}

function FiresDialog(props: { row: RuleRow; onClose: () => void }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useFetch(() => getConn().procedures.adminAutoFires({ ruleId: props.row.id, status, page, pageSize: 10 }), [String(props.row.id), status, page]);
  const badge = (s: string) => <span className={`badge ${s === 'sent' ? 'b-ok' : s === 'pending' ? 'b-warn' : ''}`}>{s === 'sent' ? t('obSent') : s === 'pending' ? t('obPending') : t('obSkipped')}</span>;
  return (
    <Dialog title={t('arFiresOf', { name: props.row.name || props.row.key })} width={720} onClose={props.onClose} testId="ar-fires">
      <div className="stack">
        <Seg
          value={status}
          onChange={v => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: '', label: t('all') },
            { value: 'pending', label: t('obPending') },
            { value: 'sent', label: t('obSent') },
            { value: 'skipped', label: t('obSkipped') },
          ]}
        />
        <ErrBox text={error ? errorText(error) : null} />
        <div className="card">
          {!data ? (
            <div className="card-pad">
              <Skel h={60} r={6} />
            </div>
          ) : data.rows.length === 0 ? (
            <Empty icon={<Lightning className="ic" weight="duotone" />} title={t('arNoFires')} />
          ) : (
            <>
              <div className="scroll-x">
                <table className="mini-table" data-testid="ar-fires-table">
                  <thead>
                    <tr>
                      <th>{t('auColTime')}</th>
                      <th>{t('pyColPlayer')}</th>
                      <th>{t('arOccurrence')}</th>
                      <th>{t('status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(f => (
                      <tr key={f.key}>
                        <td className="nowrap">{usMicros(f.at)}</td>
                        <td>
                          <a className="row-link" href={`#/player?id=${f.accountId}`}>
                            #{digits(String(f.accountId))}
                          </a>
                        </td>
                        <td className="mono">{f.occurrence}</td>
                        <td>
                          {badge(f.status)} {f.reason && <span className="small muted">{reasonText(f.reason)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={10} total={data.total} onPage={setPage} />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function AutoRules() {
  useLocale();
  const list = useRows('adminAutoRules');
  const loaded = useLoaded();
  const catName = useCategoryName();
  const events = useRows('eventType');
  const { def } = useLanguages();
  const [edit, setEdit] = useState<RuleRow | 'new' | null>(null);
  const [fires, setFires] = useState<RuleRow | null>(null);
  const rows = [...list].sort((a, b) => a.key.localeCompare(b.key));
  const triggerText = (r: RuleRow) => {
    const base = t(TRIGGERS.find(x => x[0] === r.trigger)?.[1] ?? 'trEvent');
    if (r.trigger === 'event') return `${base}: ${trText(events.find(e => e.key === r.eventKey)?.name, def) || r.eventKey}${r.matchField ? ` (${r.matchField} = ${r.matchValue})` : ''}`;
    if (r.trigger === 'inactive') return `${base}: ${t('cmDays', { n: r.inactiveDays })}`;
    return base;
  };
  return (
    <main className="page" data-testid="page-auto-rules">
      <PageHead title={t('navAutoRules')} sub={t('arSub')} action={<AddButton label={t('arNew')} onClick={() => setEdit('new')} testId="ar-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="ar"
        keyOf={r => r.key}
        empty={{ icon: <Robot className="ic" weight="duotone" />, title: t('arEmpty') }}
        cardTitle={r => <b>{r.name || r.key}</b>}
        cols={[
          {
            label: t('arName'),
            render: r => (
              <>
                <span className="primary">{r.name || trText(r.title, def)}</span>
                <div className="mono muted">{r.key}</div>
              </>
            ),
          },
          { label: t('arTrigger'), render: r => <span className="small">{triggerText(r)}</span> },
          { label: t('ncCategory'), render: r => catName(r.categoryKey) },
          { label: t('chChannels'), render: r => <ChannelChips list={r.channels} /> },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        extra={(r, card) => (
          <button type="button" className="btn btn-sm" onClick={() => setFires(r)} data-testid={card ? undefined : `ar-fires-${r.key}`}>
            <Lightning className="ic" />
            {t('arFires')}
          </button>
        )}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteAutoRule({ id: r.id }))}
      />
      {edit && <RuleDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {fires && <FiresDialog row={fires} onClose={() => setFires(null)} />}
    </main>
  );
}

export function PlayerMessagesCard(props: { accountId: bigint }) {
  const { can } = useSession();
  const [send, setSend] = useState(false);
  const devices = useFetch(() => getConn().procedures.adminPushDevices({ accountId: props.accountId }), [String(props.accountId)]);
  const out = useFetch(() => getConn().procedures.adminOutbox({ accountId: props.accountId, campaignId: 0n, page: 1, pageSize: 5 }), [String(props.accountId)]);
  return (
    <Section
      title={t('pmTitle')}
      pad={false}
      testId="pd-messages"
      action={
        <div className="row" style={{ gap: 4 }}>
          <a className="btn btn-sm" href={`#/messages?player=${props.accountId}`} data-testid="pm-all">
            <Tray className="ic" />
            {t('pmAll')}
          </a>
          {can('admin') && (
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setSend(true)} data-testid="pm-send">
              <PaperPlaneTilt className="ic" />
              {t('pmSend')}
            </button>
          )}
        </div>
      }
    >
      {!devices.data || !out.data ? (
        <div className="card-pad stack">
          <Skel h={40} r={6} />
          <Skel h={40} r={6} />
        </div>
      ) : (
        <div className="card-pad stack">
          <div className="stack stack-sm">
            <span className="section-label">{t('pushDevices')}</span>
            {devices.data.length === 0 ? <span className="small muted">{t('pushNoDevices')}</span> : <DeviceList list={devices.data} />}
          </div>
          <div className="stack stack-sm">
            <span className="section-label">{t('pmRecent')}</span>
            {out.data.rows.length === 0 ? (
              <span className="small muted">{t('obEmpty')}</span>
            ) : (
              <div className="list" data-testid="pm-list">
                {out.data.rows.map(x => (
                  <div className="list-row" key={String(x.id)}>
                    <div className="list-main">
                      <span className="list-title">{x.title}</span>
                      <span className="list-sub">
                        {channelText(x.channel)} · {kindText(x.kind)} · {x.createdAt ? date(x.createdAt.toDate()) : ''}
                      </span>
                    </div>
                    {outboxBadge(x.status)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {send && <SendDialog accountId={props.accountId} onClose={() => setSend(false)} />}
    </Section>
  );
}
