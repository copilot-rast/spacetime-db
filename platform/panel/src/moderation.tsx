import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChatCircleSlash,
  Flag,
  Gift,
  MagnifyingGlass,
  Prohibit,
  Scales,
  SpeakerSlash,
  Tag as TagIcon,
  UserCircleCheck,
  Users,
  Warning,
  Wallet,
} from '@phosphor-icons/react';
import { getConn, useRows } from './conn.ts';
import { digits, errorText, num, phone as fmtPhone, roleLabel, t, useLocale } from './i18n.ts';
import { go, pageQuery, run, runToast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, Pager, Seg, Skel, TableSkeleton, TrInputs, confirmAsk, trMissingDefault } from './ui.tsx';
import {
  DurationPicker,
  FloatInput,
  KindBadge,
  LiftDialog,
  RestrictDialog,
  Section,
  TagList,
  TagPicker,
  fmtNum,
  rStatusBadge,
  useTagsOf,
  when,
  type Dur,
} from './widgets.tsx';

const PAGE = 20;

type Row = Awaited<ReturnType<ReturnType<typeof getConn>['procedures']['adminPlayers']>>['rows'][number];

function nameOf(r: { displayName: string; phone: string }) {
  return r.displayName || fmtPhone(r.phone);
}

function PlayerBadges(props: { r: Row }) {
  const r = props.r;
  return (
    <span className="chips">
      {r.status === 'blocked' && <span className="badge b-bad">{t('ppBlocked')}</span>}
      {r.suspension && <span className="badge b-bad">{t('ppSuspended')}</span>}
      {r.mute && <span className="badge b-warn">{t('ppMuted')}</span>}
      {r.status !== 'blocked' && !r.suspension && !r.mute && <span className="badge b-ok">{t('plStatusActive')}</span>}
    </span>
  );
}

function BulkDialog(props: { ids: bigint[]; op: 'add' | 'remove'; onClose: () => void; onDone: () => void }) {
  const [tags, setTags] = useState<bigint[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog
      title={props.op === 'add' ? t('ppBulkAdd') : t('ppBulkRemove')}
      width={520}
      onClose={props.onClose}
      testId="bulk-dialog"
      foot={
        <>
          <span className="small muted grow">{t('ppSelected', { n: props.ids.length })}</span>
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !tags.length}
            data-testid="bulk-apply"
            onClick={async () => {
              setBusy(true);
              const r = await run(c => c.reducers.adminBulkPlayerTags({ accountIds: props.ids, tagIds: tags, op: props.op }), t('ppBulkDone'));
              setBusy(false);
              if (r.ok) {
                props.onDone();
                props.onClose();
              } else setErr(errorText(r.err));
            }}
          >
            {props.op === 'add' ? t('ppBulkAdd') : t('ppBulkRemove')}
          </button>
        </>
      }
    >
      <Field label={t('ppBulkPick')}>
        <TagPicker keyType="user" value={tags} onChange={setTags} testId="bulk-tags" />
      </Field>
      <ErrBox text={err} />
    </Dialog>
  );
}

export function PlayersList() {
  const route = useRoute();
  useLocale();
  const status = route.query.get('status') ?? '';
  const tagId = route.query.get('tag') ?? '';
  const [query, setQuery] = useState(route.query.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'add' | 'remove' | null>(null);
  const q = useDebounced(query, 300);
  const tags = useTagsOf('user');
  const { def } = useLanguages();
  const { data, error, loading } = useFetch(
    () => getConn().procedures.adminPlayers({ query: q, tagId: tagId ? BigInt(tagId) : 0n, status, page, pageSize: PAGE }),
    [q, status, tagId, page]
  );
  const rows = data?.rows ?? [];
  const set = (p: Record<string, string>) => {
    setPage(1);
    pageQuery('players', { status, tag: tagId, ...p });
  };
  const toggle = (id: bigint) =>
    setSel(s => {
      const n = new Set(s);
      const k = String(id);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const allOn = rows.length > 0 && rows.every(r => sel.has(String(r.id)));
  return (
    <main className="page" data-testid="page-players">
      <div className="page-head">
        <div className="grow">
          <div className="page-title">{t('plTitle')}</div>
          <div className="page-sub" data-testid="pl-total">
            {data ? t('plTotal', { n: data.total }) : <Skel w={80} h={10} />}
          </div>
        </div>
      </div>
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input
            className="input"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={t('ppSearch')}
            aria-label={t('ppSearch')}
            data-testid="pl-search"
          />
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 170 }} value={tagId} onChange={e => set({ tag: e.target.value })} aria-label={t('ppTagFilter')} data-testid="pl-tag">
          <option value="">{t('ppAllTags')}</option>
          {tags.map(x => (
            <option key={String(x.id)} value={String(x.id)}>
              {trText(x.title, def) || x.key}
            </option>
          ))}
        </select>
        <Seg
          value={status}
          label={t('plStatus')}
          onChange={v => set({ status: v })}
          options={[
            { value: '', label: t('all') },
            { value: 'suspended', label: t('ppSuspended') },
            { value: 'muted', label: t('ppMuted') },
            { value: 'tagged', label: t('ppTagged') },
            { value: 'blocked', label: t('ppBlocked') },
          ]}
        />
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="pl-table">
          <thead>
            <tr>
              <th className="check-cell">
                <input
                  type="checkbox"
                  aria-label={t('ppSelectAll')}
                  checked={allOn}
                  onChange={() =>
                    setSel(s => {
                      const n = new Set(s);
                      rows.forEach(r => (allOn ? n.delete(String(r.id)) : n.add(String(r.id))));
                      return n;
                    })
                  }
                  data-testid="pl-check-all"
                />
              </th>
              <th>{t('plColPlayer')}</th>
              <th>{t('plColPhone')}</th>
              <th>{t('tags')}</th>
              <th>{t('plColStatus')}</th>
              <th>{t('ppCountry')}</th>
              <th>{t('plColLastLogin')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={7} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty icon={<Users className="ic" weight="duotone" />} title={t('plEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={String(r.id)} aria-selected={sel.has(String(r.id))} data-testid={`pl-row-${r.phone}`}>
                  <td className="check-cell">
                    <input type="checkbox" checked={sel.has(String(r.id))} onChange={() => toggle(r.id)} aria-label={t('ppSelectRow', { name: nameOf(r) })} data-testid={`pl-check-${r.phone}`} />
                  </td>
                  <td>
                    <a className="row-link" href={`#/player?id=${r.id}`} data-testid={`pl-open-${r.phone}`}>
                      {r.displayName || t('plNoName')}
                    </a>
                    <div className="small muted">
                      #{digits(String(r.id))}
                      {r.role ? ` · ${roleLabel(r.role)}` : ''}
                    </div>
                  </td>
                  <td className="nowrap">{fmtPhone(r.phone)}</td>
                  <td>
                    <TagList tags={r.tags} />
                  </td>
                  <td>
                    <PlayerBadges r={r} />
                  </td>
                  <td>{r.countryCode ? <span className="badge">{r.countryCode}</span> : '—'}</td>
                  <td className="nowrap">{when(r.lastLoginAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards" data-testid="pl-cards">
          {loading && !data
            ? Array.from({ length: 5 }).map((_, i) => (
                <div className="pcard" key={i}>
                  <Skel w="50%" h={12} />
                  <Skel w="80%" h={10} />
                </div>
              ))
            : rows.map(r => (
                <div className="pcard" key={String(r.id)} data-testid={`pl-card-${r.phone}`}>
                  <div className="row">
                    <input type="checkbox" checked={sel.has(String(r.id))} onChange={() => toggle(r.id)} aria-label={t('ppSelectRow', { name: nameOf(r) })} />
                    <a className="row-link grow ellipsis" href={`#/player?id=${r.id}`}>
                      {r.displayName || t('plNoName')}
                    </a>
                    <PlayerBadges r={r} />
                  </div>
                  <div className="pcard-meta">
                    <span>{t('plColPhone')}</span>
                    <span>{fmtPhone(r.phone)}</span>
                    <span>{t('plColLastLogin')}</span>
                    <span>{when(r.lastLoginAt)}</span>
                  </div>
                  {r.tags.length > 0 && <TagList tags={r.tags} />}
                </div>
              ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {sel.size > 0 && (
        <div className="bulkbar" data-testid="bulkbar">
          <b className="grow">{t('ppSelected', { n: sel.size })}</b>
          <button type="button" className="btn btn-outline" onClick={() => setBulk('add')} data-testid="bulk-add">
            <TagIcon className="ic" />
            {t('ppBulkAdd')}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setBulk('remove')} data-testid="bulk-remove">
            {t('ppBulkRemove')}
          </button>
          <button type="button" className="btn" onClick={() => setSel(new Set())}>
            {t('ppClear')}
          </button>
        </div>
      )}
      {bulk && <BulkDialog ids={[...sel].map(x => BigInt(x))} op={bulk} onClose={() => setBulk(null)} onDone={() => setSel(new Set())} />}
    </main>
  );
}

function GrantDialog(props: { accountId: bigint; onClose: () => void }) {
  const prizes = useRows('prize');
  const { def } = useLanguages();
  const [prizeId, setPrize] = useState<bigint>(0n);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog
      title={t('pdGrant')}
      width={480}
      onClose={props.onClose}
      testId="grant-dialog"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !prizeId}
            data-testid="grant-save"
            onClick={async () => {
              setBusy(true);
              const r = await run(c => c.procedures.adminGrantPrize({ accountId: props.accountId, prizeId, note }), t('pdGranted'));
              setBusy(false);
              if (r.ok) props.onClose();
              else setErr(errorText(r.err));
            }}
          >
            {t('pdGrant')}
          </button>
        </>
      }
    >
      <Field label={t('gfPrize')} required>
        <select className="select" value={String(prizeId)} onChange={e => setPrize(BigInt(e.target.value))} data-testid="grant-prize">
          <option value="0">—</option>
          {prizes.map(p => (
            <option key={String(p.id)} value={String(p.id)}>
              {trText(p.name, def) || p.key} ({p.key})
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('note')} hint={t('optional')}>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} name="grantNote" />
      </Field>
      <ErrBox text={err} />
    </Dialog>
  );
}

function AdjustDialog(props: { accountId: bigint; onClose: () => void }) {
  const currencies = useRows('currency');
  const metas = useRows('meta');
  const { def } = useLanguages();
  const [kind, setKind] = useState<'currency' | 'meta'>('currency');
  const [key, setKey] = useState('');
  const [action, setAction] = useState('add');
  const [value, setValue] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = kind === 'currency' ? currencies.map(c => ({ key: c.key, name: trText(c.name, def) })) : metas.map(m => ({ key: m.key, name: trText(m.name, def) }));
  return (
    <Dialog
      title={t('pdAdjust')}
      width={480}
      onClose={props.onClose}
      testId="adjust-dialog"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !key}
            data-testid="adjust-save"
            onClick={async () => {
              setBusy(true);
              const r = await run(c => c.reducers.adminAdjust({ accountId: props.accountId, kind, key, action, value, note }), t('pdAdjusted'));
              setBusy(false);
              if (r.ok) props.onClose();
              else setErr(errorText(r.err));
            }}
          >
            {t('save')}
          </button>
        </>
      }
    >
      <Seg
        value={kind}
        onChange={v => {
          setKind(v);
          setKey('');
          setAction('add');
        }}
        options={[
          { value: 'currency', label: t('itCurrency') },
          { value: 'meta', label: t('itMeta') },
        ]}
      />
      <div className="form-grid">
        <Field label={t('pzItemKey')} required>
          <select className="select" value={key} onChange={e => setKey(e.target.value)} data-testid="adjust-key">
            <option value="">—</option>
            {list.map(x => (
              <option key={x.key} value={x.key}>
                {x.name || x.key} ({x.key})
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('pzItemAction')}>
          <select className="select" value={action} onChange={e => setAction(e.target.value)} data-testid="adjust-action">
            <option value="add">{t('acAdd')}</option>
            <option value="set">{t('acSet')}</option>
          </select>
        </Field>
        <Field label={t('pzItemValue')} className="span-2" hint={kind === 'currency' && action === 'add' ? '−' : undefined}>
          <FloatInput value={value} onChange={setValue} name="adjustValue" />
        </Field>
        <Field label={t('note')} className="span-2" hint={t('optional')}>
          <input className="input" value={note} onChange={e => setNote(e.target.value)} name="adjustNote" />
        </Field>
      </div>
      <ErrBox text={err} />
    </Dialog>
  );
}

export function PlayerPage() {
  const route = useRoute();
  const { can, me } = useSession();
  useLocale();
  const { def } = useLanguages();
  const id = BigInt(route.query.get('id') || '0');
  const detail = useFetch(() => getConn().procedures.adminPlayer({ accountId: id }), [String(id)]);
  const eco = useFetch(() => getConn().procedures.adminUserEconomy({ accountId: id }), [String(id)]);
  const currencies = useRows('currency');
  const metas = useRows('meta');
  const prizes = useRows('prize');
  const [restrict, setRestrict] = useState<'suspend' | 'mute' | 'warn' | null>(null);
  const [lift, setLift] = useState<bigint | null>(null);
  const [grant, setGrant] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [tags, setTags] = useState<bigint[] | null>(null);
  const p = detail.data?.player;
  useEffect(() => {
    if (p) setTags(p.tags.map(x => x.id));
  }, [p && p.tags.map(x => String(x.id)).join(',')]);
  const back = (
    <a href="#/players" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
      <ArrowRight className="ic" style={{ transform: document.documentElement.dir === 'rtl' ? undefined : 'scaleX(-1)' }} />
      {t('pdBack')}
    </a>
  );
  if (detail.error) {
    return (
      <main className="page" data-testid="page-player">
        {back}
        <Empty icon={<Users className="ic" weight="duotone" />} title={t('pdNotFound')} text={errorText(detail.error)} />
      </main>
    );
  }
  if (!p || !detail.data) {
    return (
      <main className="page" data-testid="page-player" aria-busy="true">
        {back}
        <div className="card card-pad player-head">
          <Skel w={52} h={52} r={26} />
          <div className="stack stack-sm grow">
            <Skel w="30%" h={16} />
            <Skel w="45%" h={10} />
          </div>
        </div>
        <div className="split">
          <div className="stack">
            <div className="card card-pad stack">
              <Skel w="25%" h={12} />
              <Skel h={40} r={6} />
            </div>
            <div className="card card-pad stack">
              <Skel w="30%" h={12} />
              <Skel h={90} r={6} />
            </div>
          </div>
          <div className="stack">
            <div className="card card-pad stack">
              <Skel w="30%" h={12} />
              <Skel h={60} r={6} />
            </div>
          </div>
        </div>
      </main>
    );
  }
  const name = p.displayName || fmtPhone(p.phone);
  const self = me?.id === p.id;
  const canRestrict = can('operator') && !self && p.role !== 'owner' && (!p.role || can('owner'));
  const dirty = tags !== null && tags.map(String).sort().join(',') !== p.tags.map(x => String(x.id)).sort().join(',');
  const curName = (k: string) => trText(currencies.find(c => c.key === k)?.name, def) || k;
  const metaName = (k: string) => trText(metas.find(c => c.key === k)?.name, def) || k;
  const prizeName = (pid: bigint) => {
    const pz = prizes.find(x => x.id === pid);
    return pz ? trText(pz.name, def) || pz.key : `#${digits(String(pid))}`;
  };
  const d = detail.data;
  return (
    <main className="page" data-testid="page-player">
      {back}
      <div className="card card-pad player-head">
        <div className="player-avatar">{p.displayName ? p.displayName.slice(0, 1) : <Users className="ic" weight="duotone" style={{ width: 24, height: 24 }} />}</div>
        <div className="stack grow" style={{ gap: 2, minWidth: 180 }}>
          <div className="row row-wrap">
            <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }} data-testid="pd-name">
              {p.displayName || t('plNoName')}
            </h2>
            {p.role && <span className="badge b-violet">{roleLabel(p.role)}</span>}
            <PlayerBadges r={p} />
          </div>
          <span className="small muted">
            {fmtPhone(p.phone)} · #{digits(String(p.id))}
            {p.countryCode ? ` · ${p.countryCode}` : ''}
          </span>
          <span className="small muted">
            {t('pdJoined', { d: when(p.createdAt, false) })} · {t('pdLastLogin', { d: when(p.lastLoginAt) })}
          </span>
        </div>
        {canRestrict && (
          <div className="row row-wrap">
            <button type="button" className="btn btn-outline" onClick={() => setRestrict('warn')} data-testid="pd-warn">
              <Warning className="ic" />
              {t('pdWarn')}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setRestrict('mute')} data-testid="pd-mute">
              <SpeakerSlash className="ic" />
              {t('pdMute')}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setRestrict('suspend')} data-testid="pd-suspend">
              <Prohibit className="ic" />
              {t('pdSuspend')}
            </button>
          </div>
        )}
      </div>
      <div className="split">
        <div className="stack">
          <Section title={t('pdNow')} testId="pd-now">
            {!p.suspension && !p.mute ? (
              <span className="row muted">
                <UserCircleCheck className="ic" weight="duotone" />
                {t('pdClean')}
              </span>
            ) : (
              <div className="stack stack-sm">
                {[
                  ['suspend', p.suspension] as const,
                  ['mute', p.mute] as const,
                ]
                  .filter(([, r]) => !!r)
                  .map(([k, r]) => (
                    <div className="row row-wrap" key={k} data-testid={`pd-active-${k}`}>
                      <KindBadge kind={k} />
                      <span className="grow">
                        {k === 'suspend' ? t('pdSuspendedUntil', { d: when(r!.endsAt) }) : t('pdMutedUntil', { d: when(r!.endsAt) })}
                        {trText(r!.reason, def) ? <span className="muted"> · {trText(r!.reason, def)}</span> : null}
                      </span>
                      {canRestrict && (
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => setLift(r!.id)} data-testid={`pd-lift-${k}`}>
                          {t('pdLift')}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </Section>
          <Section title={t('pdHistory')} pad={false} testId="pd-history">
            {d.history.length === 0 ? (
              <Empty icon={<Scales className="ic" weight="duotone" />} title={t('pdHistoryEmpty')} />
            ) : (
              <div className="scroll-x">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>{t('rlColKind')}</th>
                      <th>{t('rlColStatus')}</th>
                      <th>{t('rlColStart')}</th>
                      <th>{t('rlColEnd')}</th>
                      <th>{t('rlColReason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.history.map(h => (
                      <tr key={String(h.id)}>
                        <td>
                          <KindBadge kind={h.kind} />
                        </td>
                        <td>{rStatusBadge(h.status)}</td>
                        <td className="nowrap">{when(h.startsAt)}</td>
                        <td className="nowrap">{h.kind === 'warn' ? '—' : when(h.endsAt)}</td>
                        <td>
                          {trText(h.reason, def) || '—'}
                          {h.note && <div className="small muted">{h.note}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section
            title={t('pdReports')}
            action={
              <a className="btn btn-sm" href={`#/reports?target=${p.id}`}>
                <Flag className="ic" />
                {t('navReports')}
              </a>
            }
          >
            <dl className="stat-row" style={{ margin: 0 }}>
              <div className="stat">
                <dt>{t('pdReportsAgainst')}</dt>
                <dd data-testid="pd-reports-against">{num(d.reportsAgainst)}</dd>
              </div>
              <div className="stat">
                <dt>{t('pdReportsOpen')}</dt>
                <dd>{num(d.reportsOpen)}</dd>
              </div>
              <div className="stat">
                <dt>{t('pdReportsBy')}</dt>
                <dd>{num(d.reportsBy)}</dd>
              </div>
            </dl>
          </Section>
        </div>
        <div className="stack">
          <Section
            title={t('pdTags')}
            testId="pd-tags"
            action={
              dirty && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  data-testid="pd-tags-save"
                  onClick={() => runToast(c => c.reducers.adminSetPlayerTags({ accountId: p.id, tagIds: tags ?? [] }), t('pdTagsSaved'))}
                >
                  {t('save')}
                </button>
              )
            }
          >
            <TagPicker keyType="user" value={tags ?? []} onChange={setTags} testId="pd-tag" />
          </Section>
          <Section
            title={t('pdEconomy')}
            pad={false}
            testId="pd-economy"
            action={
              can('admin') && (
                <div className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setGrant(true)} data-testid="pd-grant">
                    <Gift className="ic" />
                    {t('pdGrant')}
                  </button>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setAdjust(true)} data-testid="pd-adjust">
                    <Wallet className="ic" />
                    {t('pdAdjust')}
                  </button>
                </div>
              )
            }
          >
            {!eco.data ? (
              <div className="card-pad stack">
                <Skel h={60} r={6} />
                <Skel h={60} r={6} />
              </div>
            ) : (
              <div className="stack" style={{ gap: 0 }}>
                <div className="card-pad stack stack-sm">
                  <span className="section-label">{t('pdWallet')}</span>
                  <div className="chips" data-testid="pd-wallet">
                    {eco.data.wallet.length === 0 && <span className="muted small">—</span>}
                    {eco.data.wallet.map(w => (
                      <span className="chip" key={w.currencyKey} data-testid={`pd-bal-${w.currencyKey}`}>
                        {curName(w.currencyKey)}: <b>{num(w.balance)}</b>
                      </span>
                    ))}
                  </div>
                  {eco.data.metas.length > 0 && (
                    <>
                      <span className="section-label" style={{ marginTop: 6 }}>
                        {t('pdMetas')}
                      </span>
                      <div className="chips" data-testid="pd-metas">
                        {eco.data.metas.map(m => (
                          <span className="chip" key={m.metaKey}>
                            {metaName(m.metaKey)}: <b>{fmtNum(m.value)}</b>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  {eco.data.prizes.length > 0 && (
                    <>
                      <span className="section-label" style={{ marginTop: 6 }}>
                        {t('pdPrizes')}
                      </span>
                      <div className="stack stack-sm" data-testid="pd-prizes">
                        {eco.data.prizes.slice(0, 8).map(x => (
                          <div className="row small" key={String(x.id)}>
                            <Gift className="ic muted" />
                            <span className="grow">{prizeName(x.prizeId)}</span>
                            <span className="muted">{x.sourceType === 'admin' ? t('srcAdmin') : x.sourceType === 'payment' ? t('srcPayment') : x.sourceType === 'gift' ? t('srcGift') : x.sourceType}</span>
                            <span className="muted">{when(x.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="card-pad" style={{ paddingBottom: 4 }}>
                    <span className="section-label">{t('pdLedger')}</span>
                  </div>
                  {eco.data.ledger.length === 0 ? (
                    <Empty icon={<Wallet className="ic" weight="duotone" />} title={t('pdLedgerEmpty')} />
                  ) : (
                    <div className="scroll-x">
                      <table className="mini-table" data-testid="pd-ledger">
                        <thead>
                          <tr>
                            <th>{t('itCurrency')}</th>
                            <th>{t('pdDelta')}</th>
                            <th>{t('pdBalance')}</th>
                            <th>{t('pdSource')}</th>
                            <th>{t('auColTime')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {eco.data.ledger.slice(0, 20).map(l => (
                            <tr key={String(l.id)}>
                              <td>{curName(l.currencyKey)}</td>
                              <td className={l.delta < 0n ? 'neg' : 'pos'} dir="ltr" style={{ textAlign: 'start' }}>
                                {l.delta > 0n ? '+' : ''}
                                {num(l.delta)}
                              </td>
                              <td>{num(l.balanceAfter)}</td>
                              <td className="small">{l.reason || l.sourceType}</td>
                              <td className="nowrap small">{when(l.at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Section>
          {can('admin') && !self && p.role !== 'owner' && (!p.role || can('owner')) && (
            <Section title={t('pdAccount')}>
              <button
                type="button"
                className={`btn ${p.status === 'blocked' ? 'btn-outline' : 'btn-danger-ghost'}`}
                data-testid="pd-block"
                onClick={async () => {
                  const blocked = p.status === 'blocked';
                  const ok = await confirmAsk(blocked ? t('plUnblockConfirm', { phone: fmtPhone(p.phone) }) : t('plBlockConfirm', { phone: fmtPhone(p.phone) }), {
                    danger: !blocked,
                    ok: blocked ? t('plUnblock') : t('plBlock'),
                  });
                  if (ok) await runToast(c => c.reducers.adminSetAccountStatus({ accountId: p.id, status: blocked ? 'active' : 'blocked' }), blocked ? t('plUnblocked') : t('plBlocked'));
                }}
              >
                {p.status === 'blocked' ? <UserCircleCheck className="ic" /> : <ChatCircleSlash className="ic" />}
                {p.status === 'blocked' ? t('pdUnblockAccount') : t('pdBlockAccount')}
              </button>
            </Section>
          )}
        </div>
      </div>
      {restrict && <RestrictDialog accountId={p.id} name={name} kind={restrict} onClose={() => setRestrict(null)} />}
      {lift !== null && <LiftDialog id={lift} onClose={() => setLift(null)} />}
      {grant && <GrantDialog accountId={p.id} onClose={() => setGrant(false)} />}
      {adjust && <AdjustDialog accountId={p.id} onClose={() => setAdjust(false)} />}
    </main>
  );
}

export function Restrictions() {
  const route = useRoute();
  useLocale();
  const { def } = useLanguages();
  const status = route.query.get('status') ?? 'active';
  const kind = route.query.get('kind') ?? '';
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [lift, setLift] = useState<bigint | null>(null);
  const q = useDebounced(query, 300);
  const { data, error, loading } = useFetch(
    () => getConn().procedures.adminRestrictions({ query: q, kind, status: status === 'all' ? '' : status, accountId: 0n, page, pageSize: PAGE }),
    [q, kind, status, page]
  );
  const rows = data?.rows ?? [];
  const set = (p: Record<string, string>) => {
    setPage(1);
    pageQuery('restrictions', { status, kind, ...p });
  };
  const playerCell = (r: (typeof rows)[number]) => (
    <>
      <a className="row-link" href={`#/player?id=${r.restriction.accountId}`}>
        {r.displayName || fmtPhone(r.phone)}
      </a>
      {r.displayName && <div className="small muted">{fmtPhone(r.phone)}</div>}
    </>
  );
  return (
    <main className="page" data-testid="page-restrictions">
      <div className="page-head">
        <div className="grow">
          <div className="page-title">{t('rlTitle')}</div>
          <div className="page-sub">{data ? t('rlActive', { n: data.activeTotal }) : <Skel w={80} h={10} />}</div>
        </div>
      </div>
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input className="input" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder={t('ppSearch')} aria-label={t('ppSearch')} data-testid="rl-search" />
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 150 }} value={kind} onChange={e => set({ kind: e.target.value })} aria-label={t('rlKind')} data-testid="rl-kind">
          <option value="">{t('rlAllKinds')}</option>
          <option value="suspend">{t('kindSuspend')}</option>
          <option value="mute">{t('kindMute')}</option>
          <option value="warn">{t('kindWarn')}</option>
        </select>
        <Seg
          value={status}
          onChange={v => set({ status: v })}
          options={[
            { value: 'active', label: t('rstActive') },
            { value: 'expired', label: t('rstExpired') },
            { value: 'lifted', label: t('rstLifted') },
            { value: 'all', label: t('all') },
          ]}
        />
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="rl-table">
          <thead>
            <tr>
              <th>{t('rlColPlayer')}</th>
              <th>{t('rlColKind')}</th>
              <th>{t('rlColStatus')}</th>
              <th>{t('rlColStart')}</th>
              <th>{t('rlColEnd')}</th>
              <th>{t('rlColReason')}</th>
              <th>{t('rlColBy')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={8} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <Empty icon={<Scales className="ic" weight="duotone" />} title={t('rlEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={String(r.restriction.id)} data-testid={`rl-row-${r.phone}`}>
                  <td>{playerCell(r)}</td>
                  <td>
                    <KindBadge kind={r.restriction.kind} />
                  </td>
                  <td>{rStatusBadge(r.effectiveStatus)}</td>
                  <td className="nowrap">{when(r.restriction.startsAt)}</td>
                  <td className="nowrap">{r.restriction.kind === 'warn' ? '—' : when(r.restriction.endsAt)}</td>
                  <td className="cell-detail">{trText(r.restriction.reason, def) || '—'}</td>
                  <td className="nowrap">{r.createdByPhone ? fmtPhone(r.createdByPhone) : '—'}</td>
                  <td className="end">
                    {r.effectiveStatus === 'active' && r.restriction.kind !== 'warn' && (
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => setLift(r.restriction.id)} data-testid={`rl-lift-${r.phone}`}>
                        {t('pdLift')}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(r => (
            <div className="pcard" key={String(r.restriction.id)}>
              <div className="row">
                <span className="grow">{playerCell(r)}</span>
                <KindBadge kind={r.restriction.kind} />
                {rStatusBadge(r.effectiveStatus)}
              </div>
              <div className="pcard-meta">
                <span>{t('rlColEnd')}</span>
                <span>{r.restriction.kind === 'warn' ? '—' : when(r.restriction.endsAt)}</span>
                <span>{t('rlColReason')}</span>
                <span>{trText(r.restriction.reason, def) || '—'}</span>
              </div>
              {r.effectiveStatus === 'active' && r.restriction.kind !== 'warn' && (
                <div>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setLift(r.restriction.id)}>
                    {t('pdLift')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {lift !== null && <LiftDialog id={lift} onClose={() => setLift(null)} />}
    </main>
  );
}

export function reportStatusBadge(s: string) {
  const map: Record<string, [string, string]> = {
    open: ['b-warn', t('rpOpen')],
    reviewing: ['b-info', t('rpReviewing')],
    resolved: ['b-ok', t('rpResolved')],
    dismissed: ['', t('rpDismissed')],
  };
  const [cls, label] = map[s] ?? ['', s];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Reports() {
  const route = useRoute();
  useLocale();
  const { def } = useLanguages();
  const titles = useRows('reportTitle');
  const status = route.query.get('status') ?? 'active';
  const titleId = route.query.get('title') ?? '';
  const target = route.query.get('target') ?? '';
  const openId = route.query.get('id');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(query, 300);
  const { data, error, loading } = useFetch(
    () =>
      getConn().procedures.adminReports({
        query: q,
        status: status === 'all' ? '' : status,
        titleId: titleId ? BigInt(titleId) : 0n,
        targetId: target ? BigInt(target) : 0n,
        reporterId: 0n,
        gameKey: '',
        page,
        pageSize: PAGE,
      }),
    [q, status, titleId, target, page]
  );
  const rows = data?.rows ?? [];
  const set = (p: Record<string, string>) => {
    setPage(1);
    pageQuery('reports', { status, title: titleId, target, ...p });
  };
  const openReport = (id: bigint) => pageQuery('reports', { status, title: titleId, target, id: String(id) });
  const closeReport = () => pageQuery('reports', { status, title: titleId, target });
  return (
    <main className="page" data-testid="page-reports">
      <div className="page-head">
        <div className="grow">
          <div className="page-title">{t('rpTitle')}</div>
          <div className="page-sub">{data ? t('rpActive', { n: data.activeTotal }) : <Skel w={80} h={10} />}</div>
        </div>
      </div>
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input className="input" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder={t('ppSearch')} aria-label={t('ppSearch')} data-testid="rp-search" />
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 160 }} value={titleId} onChange={e => set({ title: e.target.value })} aria-label={t('rpReason')} data-testid="rp-title">
          <option value="">{t('rpAllReasons')}</option>
          {titles.map(x => (
            <option key={String(x.id)} value={String(x.id)}>
              {trText(x.name, def) || x.key}
            </option>
          ))}
        </select>
        <Seg
          value={status}
          onChange={v => set({ status: v })}
          options={[
            { value: 'active', label: t('rpStatusActive') },
            { value: 'open', label: t('rpOpen') },
            { value: 'reviewing', label: t('rpReviewing') },
            { value: 'resolved', label: t('rpResolved') },
            { value: 'dismissed', label: t('rpDismissed') },
            { value: 'all', label: t('all') },
          ]}
        />
        {target && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => set({ target: '' })}>
            #{digits(target)} ✕
          </button>
        )}
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="rp-table">
          <thead>
            <tr>
              <th>{t('rpColTarget')}</th>
              <th>{t('rpColReason')}</th>
              <th>{t('rpColReporter')}</th>
              <th>{t('rpColStatus')}</th>
              <th>{t('rpColAt')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty icon={<Flag className="ic" weight="duotone" />} title={t('rpEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={String(r.report.id)} data-testid={`rp-row-${r.targetPhone}`}>
                  <td>
                    <span className="primary">{r.targetName || fmtPhone(r.targetPhone)}</span>
                    <div className="small muted">{t('rpAgainst', { n: r.againstTarget })}</div>
                  </td>
                  <td>{trText(r.report.titleName, def) || r.report.titleKey}</td>
                  <td className="nowrap">{r.reporterName || fmtPhone(r.reporterPhone)}</td>
                  <td>{reportStatusBadge(r.report.status)}</td>
                  <td className="nowrap">{when(r.report.createdAt)}</td>
                  <td className="end">
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => openReport(r.report.id)} data-testid={`rp-open-${r.targetPhone}`}>
                      {t('open')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(r => (
            <button type="button" className="pcard" key={String(r.report.id)} onClick={() => openReport(r.report.id)} style={{ border: 0, background: 'transparent', textAlign: 'start', width: '100%', font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
              <div className="row">
                <b className="grow ellipsis">{r.targetName || fmtPhone(r.targetPhone)}</b>
                {reportStatusBadge(r.report.status)}
              </div>
              <div className="pcard-meta">
                <span>{t('rpColReason')}</span>
                <span>{trText(r.report.titleName, def) || r.report.titleKey}</span>
                <span>{t('rpColAt')}</span>
                <span>{when(r.report.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {openId && <ReportDialog id={BigInt(openId)} onClose={closeReport} />}
    </main>
  );
}

function ReportDialog(props: { id: bigint; onClose: () => void }) {
  const { def } = useLanguages();
  const admins = useRows('adminAdmins');
  const { data, error } = useFetch(() => getConn().procedures.adminReport({ id: props.id }), [String(props.id)]);
  const [note, setNote] = useState('');
  const [action, setAction] = useState<'dismiss' | 'warn' | 'mute' | 'suspend'>('dismiss');
  const [dur, setDur] = useState<Dur>({ minutes: 1440, endsAt: 0n });
  const [reason, setReason] = useState<Tr[]>([]);
  const [resNote, setResNote] = useState('');
  const [closeOthers, setCloseOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const who = (id: bigint) => {
    const a = admins.find(x => x.accountId === id);
    return a ? a.displayName || a.username : `#${digits(String(id))}`;
  };
  const r = data?.row.report;
  const closed = r && (r.status === 'resolved' || r.status === 'dismissed');
  return (
    <Dialog title={t('rpDetail', { id: digits(String(props.id)) })} width={760} onClose={props.onClose} testId="rp-dialog">
      {error && <ErrBox text={errorText(error)} />}
      {!data || !r ? (
        <div className="stack">
          <Skel h={60} r={8} />
          <Skel h={120} r={8} />
        </div>
      ) : (
        <>
          <div className="row row-wrap">
            {reportStatusBadge(r.status)}
            <b>{trText(r.titleName, def) || r.titleKey}</b>
            <span className="grow" />
            <span className="small muted">{when(r.createdAt)}</span>
          </div>
          <div className="review">
            <div className="review-item">
              <dl className="kv grow">
                <dt>{t('rpColTarget')}</dt>
                <dd>
                  <a className="row-link" href={`#/player?id=${r.targetId}`}>
                    {data.row.targetName || fmtPhone(data.row.targetPhone)}
                  </a>
                </dd>
                <dt>{t('plColPhone')}</dt>
                <dd>{fmtPhone(data.row.targetPhone)}</dd>
                <dt>{t('plColStatus')}</dt>
                <dd>
                  <PlayerBadges r={data.target} />
                </dd>
              </dl>
            </div>
            <div className="review-item">
              <dl className="kv grow">
                <dt>{t('rpColReporter')}</dt>
                <dd>{data.row.reporterName || fmtPhone(data.row.reporterPhone)}</dd>
                <dt>{t('pdHistory')}</dt>
                <dd data-testid="rp-history">{t('rpHistory', { w: data.warns, m: data.mutes, s: data.suspends })}</dd>
                <dt>{t('rpOthers')}</dt>
                <dd>{num(data.others.length)}</dd>
              </dl>
            </div>
          </div>
          {(r.note || r.matchId || r.contentId || r.gameKey) && (
            <div className="stack stack-sm">
              {r.note && (
                <div className="note-item">
                  <div className="small muted">{t('rpReporterNote')}</div>
                  {r.note}
                </div>
              )}
              {(r.matchId || r.contentId || r.gameKey) && (
                <dl className="kv">
                  {r.gameKey && (
                    <>
                      <dt>{t('rpGame')}</dt>
                      <dd className="mono">{r.gameKey}</dd>
                    </>
                  )}
                  {r.matchId && (
                    <>
                      <dt>{t('rpMatch')}</dt>
                      <dd className="mono">{r.matchId}</dd>
                    </>
                  )}
                  {r.contentId && (
                    <>
                      <dt>{t('rpContent')}</dt>
                      <dd className="mono">{r.contentId}</dd>
                    </>
                  )}
                </dl>
              )}
            </div>
          )}
          <div className="stack stack-sm">
            <span className="section-label">{t('rpNotes')}</span>
            {r.notes.length === 0 && <span className="small muted">{t('rpNoNotes')}</span>}
            {r.notes.map((n, i) => (
              <div className="note-item" key={i} data-testid="rp-note">
                <div className="small muted">
                  {who(n.by)} · {when(n.at)}
                </div>
                {n.text}
              </div>
            ))}
            {!closed && (
              <div className="input-group">
                <input className="input grow" value={note} onChange={e => setNote(e.target.value)} placeholder={t('rpNotePlaceholder')} name="rpNote" />
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={!note.trim()}
                  data-testid="rp-note-add"
                  onClick={async () => {
                    if (await runToast(c => c.reducers.adminReportNote({ id: r.id, text: note }), t('saved'))) setNote('');
                  }}
                >
                  {t('rpAddNote')}
                </button>
              </div>
            )}
          </div>
          {closed ? (
            <div className="notice notice-plain" data-testid="rp-closed">
              <div className="stack" style={{ gap: 2 }}>
                <b>
                  {t('rpOutcome')}: {r.action ? (r.action === 'dismiss' ? t('rpActDismiss') : r.action === 'warn' ? t('rpActWarn') : r.action === 'mute' ? t('rpActMute') : t('rpActSuspend')) : '—'}
                </b>
                <span className="small muted">{t('rpClosed', { by: who(r.resolvedBy), d: when(r.resolvedAt ?? undefined) })}</span>
                {r.resolutionNote && <span className="small">{r.resolutionNote}</span>}
              </div>
            </div>
          ) : (
            <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <div className="row row-wrap">
                <span className="section-label grow">{t('rpResolve')}</span>
                {r.status === 'open' ? (
                  <button type="button" className="btn btn-sm btn-outline" data-testid="rp-take" onClick={() => runToast(c => c.reducers.adminReportStatus({ id: r.id, status: 'reviewing' }), t('rpTaken'))}>
                    {t('rpTake')}
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm btn-outline" data-testid="rp-putback" onClick={() => runToast(c => c.reducers.adminReportStatus({ id: r.id, status: 'open' }), t('rpBack'))}>
                    {t('rpPutBack')}
                  </button>
                )}
              </div>
              <Seg
                value={action}
                onChange={setAction}
                options={[
                  { value: 'dismiss', label: t('rpActDismiss') },
                  { value: 'warn', label: t('rpActWarn') },
                  { value: 'mute', label: t('rpActMute') },
                  { value: 'suspend', label: t('rpActSuspend') },
                ]}
              />
              {(action === 'mute' || action === 'suspend') && (
                <Field label={t('rsDuration')}>
                  <DurationPicker value={dur} onChange={setDur} testId="rp-dur" />
                </Field>
              )}
              {action !== 'dismiss' && (
                <Field label={t('rsReason')} hint={t('rsReasonHint')} required>
                  <TrInputs value={reason} onChange={setReason} name="rpReason" required />
                </Field>
              )}
              <Field label={t('rsNote')} hint={t('rsNoteHint')}>
                <input className="input" value={resNote} onChange={e => setResNote(e.target.value)} name="rpResNote" />
              </Field>
              <label className="check">
                <input type="checkbox" checked={closeOthers} onChange={e => setCloseOthers(e.target.checked)} data-testid="rp-close-others" />
                <span className="stack" style={{ gap: 0 }}>
                  <span>{t('rpCloseOthers')}</span>
                  <span className="hint">{t('rpCloseOthersHint')}</span>
                </span>
              </label>
              <ErrBox text={err} />
              <div className="row">
                <span className="grow" />
                <button
                  type="button"
                  className={`btn ${action === 'dismiss' || action === 'warn' ? 'btn-primary' : 'btn-danger'}`}
                  disabled={busy}
                  data-testid="rp-resolve"
                  onClick={async () => {
                    if (action !== 'dismiss' && trMissingDefault(reason, def)) {
                      setErr(t('trRequired', { lang: def }));
                      return;
                    }
                    setBusy(true);
                    setErr(null);
                    const res = await run(
                      c =>
                        c.reducers.adminResolveReport({
                          id: r.id,
                          action,
                          minutes: action === 'mute' || action === 'suspend' ? dur.minutes : 0,
                          endsAt: action === 'mute' || action === 'suspend' ? dur.endsAt : 0n,
                          reason: action === 'dismiss' ? [] : reason,
                          note: resNote,
                          closeOthers,
                        }),
                      t('rpResolved2')
                    );
                    setBusy(false);
                    if (!res.ok) setErr(errorText(res.err));
                  }}
                >
                  {t('rpResolve')}
                </button>
              </div>
            </div>
          )}
          {data.others.length > 0 && (
            <div className="stack stack-sm">
              <span className="section-label">{t('rpOthers')}</span>
              {data.others.slice(0, 10).map(o => (
                <div className="row small" key={String(o.id)}>
                  {reportStatusBadge(o.status)}
                  <span className="grow">{trText(o.titleName, def) || o.titleKey}</span>
                  <span className="muted">{when(o.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
