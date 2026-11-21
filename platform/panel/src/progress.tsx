import { useState } from 'react';
import { ArrowsClockwise, Lightning, ListChecks, MagnifyingGlass, Medal, Receipt, Ruler, Stack, TreeStructure, TrendUp, Fire, ArrowClockwise, Flag } from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { digits, errorText, latin, num, t, useLocale } from './i18n.ts';
import { go, pageQuery, run, runToast, toast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, NumInput, Pager, Skel, SwitchRow, TableSkeleton, TrInputs, confirmAsk } from './ui.tsx';
import { CategoryPicker } from './dialogs.tsx';
import { FloatInput, Section, TagList, TagPicker, fmtNum, when } from './widgets.tsx';
import { ActiveBadge, AddButton, FormDialog, NameCell, PageHead, del, needTitle, save } from './economy.tsx';
import { CatalogTable, Choice, GrantMode, IdPick, KeyPick, Mono, OptNum, Rows, WindowFields, useEventName, useLoaded, useMetaName, usePrizeName } from './kit.tsx';

const PAGE = 20;

function KeyField(props: { value: string; onChange: (v: string) => void; locked: boolean; hint?: string }) {
  return (
    <Field label={t('key')} hint={props.locked ? t('keyLocked') : props.hint ?? t('ktKeyHint')} required>
      <input className="input ltr" name="key" value={props.value} onChange={e => props.onChange(e.target.value)} disabled={props.locked} autoFocus={!props.locked} />
    </Field>
  );
}

function NameFields(props: { name: Tr[]; setName: (v: Tr[]) => void; description?: Tr[]; setDescription?: (v: Tr[]) => void }) {
  return (
    <>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={props.name} onChange={props.setName} required name="name" />
      </Field>
      {props.description && props.setDescription && (
        <Field label={t('description')} className="span-2" hint={t('optional')}>
          <TrInputs value={props.description} onChange={props.setDescription} name="description" />
        </Field>
      )}
    </>
  );
}

function ActiveSort(props: { isActive: boolean; setActive: (v: boolean) => void; sort: number; setSort: (v: number) => void }) {
  return (
    <>
      <Field label={t('sort')}>
        <NumInput value={props.sort} onChange={props.setSort} name="sort" />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={props.isActive} onChange={props.setActive} label={t('active')} testId="active-switch" />
      </div>
    </>
  );
}

function modeLabel(m: string) {
  return m === 'claim' ? t('gmClaim') : t('gmAuto');
}

type EventTypeRow = RowOf<'eventType'>;

function EventTypeDialog(props: { row?: EventTypeRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [clientAllowed, setClient] = useState(r?.clientAllowed ?? true);
  const [valueMin, setMin] = useState(r?.valueMin ?? 0);
  const [valueMax, setMax] = useState(r?.valueMax ?? 1000000);
  const [rateLimit, setRate] = useState(r?.rateLimit ?? 0);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('etEdit') : t('etAdd')}
      testId="et-dialog"
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() => getConn().reducers.adminSaveEventType({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, description, clientAllowed, valueMin, valueMax, rateLimit, isActive, sort }))
      }
    >
      <KeyField value={key} onChange={setKey} locked={!!r} hint={t('etKeyHint')} />
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={clientAllowed} onChange={setClient} disabled={r?.isSystem} label={t('etClient')} testId="et-client" />
        {r?.isSystem && <span className="hint">{t('etSystemHint')}</span>}
      </div>
      <NameFields name={name} setName={setName} description={description} setDescription={setDescription} />
      <Field label={t('etMin')}>
        <FloatInput value={valueMin} onChange={setMin} name="valueMin" />
      </Field>
      <Field label={t('etMax')}>
        <FloatInput value={valueMax} onChange={setMax} name="valueMax" />
      </Field>
      <Field label={t('etRate')} hint={t('etRateHint')}>
        <NumInput value={rateLimit} onChange={setRate} name="rateLimit" />
      </Field>
      <span />
      <ActiveSort isActive={isActive} setActive={setActive} sort={sort} setSort={setSort} />
    </FormDialog>
  );
}

export function EventTypes() {
  useLocale();
  const list = useRows('eventType');
  const loaded = useLoaded();
  const [edit, setEdit] = useState<EventTypeRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-event-types">
      <PageHead title={t('navEventTypes')} sub={num(rows.length)} action={<AddButton label={t('etAdd')} onClick={() => setEdit('new')} testId="et-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="et"
        keyOf={r => r.key}
        empty={{ icon: <Lightning className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          {
            label: t('etSender'),
            render: r => (
              <span className="chips">
                {r.isSystem && <span className="badge">{t('etSystem')}</span>}
                <span className={`badge ${r.clientAllowed ? 'b-info' : ''}`}>{r.clientAllowed ? t('etClientYes') : t('etServerOnly')}</span>
              </span>
            ),
          },
          { label: t('etRange'), render: r => (r.valueMin <= -1e12 && r.valueMax >= 1e12 ? t('etAnyValue') : <span className="nowrap">{`${fmtNum(r.valueMin)} – ${fmtNum(r.valueMax)}`}</span>) },
          { label: t('etRate'), render: r => (r.rateLimit ? num(r.rateLimit) : '—') },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        extra={(r, card) => (
          <button type="button" className="btn btn-sm" onClick={() => go(`event-log?type=${r.key}`)} data-testid={card ? undefined : `et-log-${r.key}`}>
            <Receipt className="ic" />
            {t('etLog')}
          </button>
        )}
        onEdit={r => setEdit(r)}
        locked={r => r.isSystem}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteEventType({ id: r.id }))}
      />
      {edit && <EventTypeDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

export function EventLog() {
  const route = useRoute();
  useLocale();
  const type = route.query.get('type') ?? '';
  const source = route.query.get('source') ?? '';
  const [player, setPlayer] = useState(route.query.get('player') ?? '');
  const [page, setPage] = useState(1);
  const p = useDebounced(player, 300);
  const accountId = /^\d+$/.test(latin(p).trim()) ? BigInt(latin(p).trim()) : 0n;
  const eventName = useEventName();
  const { data, error, loading } = useFetch(() => getConn().procedures.adminEventLog({ accountId, typeKey: type, source, page, pageSize: PAGE }), [String(accountId), type, source, page]);
  const rows = data?.rows ?? [];
  const set = (q: Record<string, string>) => {
    setPage(1);
    pageQuery('event-log', { type, source, ...q });
  };
  return (
    <main className="page" data-testid="page-event-log">
      <PageHead title={t('navEventLog')} sub={data ? num(data.total) : <Skel w={40} h={10} />} />
      <div className="toolbar">
        <div className="input-affix search" style={{ width: 200 }}>
          <MagnifyingGlass className="ic" />
          <input className="input" value={player} onChange={e => { setPlayer(e.target.value); setPage(1); }} placeholder={t('elPlayer')} aria-label={t('elPlayer')} inputMode="numeric" data-testid="el-player" />
        </div>
        <div style={{ width: 220 }}>
          <KeyPick kind="event" value={type} onChange={v => set({ type: v })} none={t('elAllTypes')} testId="el-type" label={t('navEventTypes')} />
        </div>
        <div style={{ width: 160 }}>
          <Choice
            value={source}
            onChange={v => set({ source: v })}
            label={t('elSource')}
            options={[
              ['', 'elAllSources'],
              ['client', 'elClient'],
              ['server', 'elServer'],
              ['admin', 'elAdmin'],
            ]}
          />
        </div>
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="el-table">
          <thead>
            <tr>
              <th>{t('auColTime')}</th>
              <th>{t('pyColPlayer')}</th>
              <th>{t('elType')}</th>
              <th>{t('pzItemValue')}</th>
              <th>{t('elSource')}</th>
              <th>{t('elMetadata')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty icon={<Receipt className="ic" weight="duotone" />} title={t('emptyList')} />
                </td>
              </tr>
            ) : (
              rows.map(e => (
                <tr key={String(e.id)}>
                  <td className="nowrap">{when(e.at)}</td>
                  <td>
                    <a className="row-link" href={`#/player?id=${e.accountId}`}>
                      #{digits(String(e.accountId))}
                    </a>
                  </td>
                  <td>
                    {eventName(e.typeKey)} <span className="mono muted">{e.typeKey}</span>
                  </td>
                  <td>{fmtNum(e.value)}</td>
                  <td>
                    <span className="badge">{e.source === 'client' ? t('elClient') : e.source === 'admin' ? t('elAdmin') : t('elServer')}</span>
                  </td>
                  <td className="cell-detail mono" title={e.metadata}>
                    {e.metadata || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(e => (
            <div className="pcard" key={String(e.id)}>
              <div className="row">
                <b className="grow">{eventName(e.typeKey)}</b>
                <span className="small muted">{when(e.at)}</span>
              </div>
              <div className="pcard-meta">
                <span>{t('pyColPlayer')}</span>
                <span>#{digits(String(e.accountId))}</span>
                <span>{t('pzItemValue')}</span>
                <span>{fmtNum(e.value)}</span>
              </div>
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}

type RuleRow = RowOf<'adminEventRules'>;

function RuleDialog(props: { row?: RuleRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [eventKey, setEvent] = useState(r?.eventKey ?? '');
  const [measure, setMeasure] = useState(r?.measure ?? 'count');
  const [period, setPeriod] = useState(r?.period ?? 'total');
  const [threshold, setThreshold] = useState(r?.threshold ?? 1);
  const [repeat, setRepeat] = useState(r?.repeat ?? 'once');
  const [maxClaims, setMaxClaims] = useState(r?.maxClaims ?? 0);
  const [prizeId, setPrize] = useState<bigint>(r?.prizeId ?? 0n);
  const [grantMode, setMode] = useState(r?.grantMode ?? 'auto');
  const [audienceTagIds, setAudience] = useState<bigint[]>(r?.audienceTagIds ?? []);
  const [win, setWin] = useState<[bigint, bigint]>([r?.startsAt ?? 0n, r?.endsAt ?? 0n]);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('erEdit') : t('erAdd')}
      testId="er-dialog"
      width={680}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() =>
          getConn().reducers.adminSaveEventRule({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name,
            description,
            eventKey,
            measure,
            period,
            threshold,
            repeat,
            maxClaims,
            prizeId,
            grantMode,
            audienceTagIds,
            startsAt: win[0],
            endsAt: win[1],
            isActive,
            sort,
          })
        )
      }
    >
      <KeyField value={key} onChange={setKey} locked={!!r} />
      <Field label={t('elType')} required>
        <KeyPick kind="event" value={eventKey} onChange={setEvent} none="—" testId="er-event" />
      </Field>
      <NameFields name={name} setName={setName} description={description} setDescription={setDescription} />
      <Field label={t('erMeasure')}>
        <Choice value={measure} onChange={setMeasure} name="measure" options={[['count', 'msCount'], ['sum', 'msSum'], ['max', 'msMax']]} />
      </Field>
      <Field label={t('erPeriod')}>
        <Choice value={period} onChange={setPeriod} name="period" options={[['total', 'perTotal'], ['day', 'perDay'], ['week', 'perWeek']]} />
      </Field>
      <Field label={t('erThreshold')} required>
        <FloatInput value={threshold} onChange={setThreshold} name="threshold" />
      </Field>
      <Field label={t('erRepeat')} hint={repeat === 'every' ? t('erEveryHint') : repeat === 'period' ? t('erPeriodHint') : undefined}>
        <Choice value={repeat} onChange={setRepeat} name="repeat" options={[['once', 'repOnce'], ['period', 'repPeriod'], ['every', 'repEvery']]} />
      </Field>
      <Field label={t('erMaxClaims')} hint={t('zeroNoLimit')}>
        <NumInput value={maxClaims} onChange={setMaxClaims} name="maxClaims" />
      </Field>
      <span />
      <Field label={t('gfPrize')} required>
        <IdPick kind="prize" value={prizeId} onChange={setPrize} testId="er-prize" />
      </Field>
      <Field label={t('gmMode')}>
        <GrantMode value={grantMode} onChange={setMode} />
      </Field>
      <Field label={t('audience')} hint={t('prAudienceHint')} className="span-2">
        <TagPicker keyType="user" value={audienceTagIds} onChange={setAudience} />
      </Field>
      <WindowFields startsAt={win[0]} endsAt={win[1]} onChange={(a, b) => setWin([a, b])} />
      <ActiveSort isActive={isActive} setActive={setActive} sort={sort} setSort={setSort} />
    </FormDialog>
  );
}

function ruleText(r: RuleRow, eventName: (k: string) => string) {
  const m = r.measure === 'sum' ? t('msSum') : r.measure === 'max' ? t('msMax') : t('msCount');
  const p = r.period === 'day' ? t('perDay') : r.period === 'week' ? t('perWeek') : t('perTotal');
  return `${eventName(r.eventKey)} · ${m} ≥ ${fmtNum(r.threshold)} · ${p}`;
}

export function EventRules() {
  useLocale();
  const list = useRows('adminEventRules');
  const loaded = useLoaded();
  const prizeName = usePrizeName();
  const eventName = useEventName();
  const [edit, setEdit] = useState<RuleRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-event-rules">
      <PageHead title={t('navEventRules')} sub={num(rows.length)} action={<AddButton label={t('erAdd')} onClick={() => setEdit('new')} testId="er-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="er"
        keyOf={r => r.key}
        empty={{ icon: <Flag className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('erCondition'), render: r => ruleText(r, eventName) },
          { label: t('erRepeat'), render: r => (r.repeat === 'every' ? t('repEvery') : r.repeat === 'period' ? t('repPeriod') : t('repOnce')) },
          { label: t('gfPrize'), render: r => `${prizeName(r.prizeId)} · ${modeLabel(r.grantMode)}` },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteEventRule({ id: r.id }))}
      />
      {edit && <RuleDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type LevelRow = RowOf<'adminLevelTables'>;
type Step = { level: number; threshold: number; title: Tr[]; prizeId: bigint; grantMode: string };

function LevelDialog(props: { row?: LevelRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [metaKey, setMeta] = useState(r?.metaKey ?? '');
  const [levelMetaKey, setLevelMeta] = useState(r?.levelMetaKey ?? '');
  const [steps, setSteps] = useState<Step[]>(r?.steps.map(x => ({ ...x })) ?? [{ level: 1, threshold: 0, title: [], prizeId: 0n, grantMode: 'auto' }]);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('ltEdit') : t('ltAdd')}
      testId="lt-dialog"
      width={820}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() => getConn().reducers.adminSaveLevelTable({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, description, metaKey, levelMetaKey, steps, isActive, sort }))
      }
    >
      <KeyField value={key} onChange={setKey} locked={!!r} />
      <span />
      <NameFields name={name} setName={setName} description={description} setDescription={setDescription} />
      <Field label={t('ltSource')} hint={t('ltSourceHint')} required>
        <KeyPick kind="meta" value={metaKey} onChange={setMeta} none="—" testId="lt-meta" />
      </Field>
      <Field label={t('ltLevelMeta')} hint={t('ltLevelMetaHint')}>
        <KeyPick kind="meta" value={levelMetaKey} onChange={setLevelMeta} none={t('none')} testId="lt-level-meta" />
      </Field>
      <Field label={t('ltSteps')} required className="span-2">
        <Rows
          rows={steps}
          onChange={setSteps}
          testId="lt-steps"
          addLabel={t('ltAddStep')}
          max={500}
          make={() => {
            const last = steps[steps.length - 1];
            return { level: (last?.level ?? 0) + 1, threshold: last?.threshold ?? 0, title: [], prizeId: 0n, grantMode: 'auto' };
          }}
          cols={[
            { label: t('ltLevel'), width: '70px', render: (s, set, i) => <NumInput value={s.level} onChange={v => set({ level: v })} name={`step-${i}-level`} /> },
            { label: t('ltThreshold'), width: '100px', render: (s, set, i) => <FloatInput value={s.threshold} onChange={v => set({ threshold: v })} name={`step-${i}-threshold`} /> },
            { label: t('ltTitle'), width: 'minmax(0, 1.3fr)', render: (s, set, i) => <TrInputs value={s.title} onChange={v => set({ title: v })} name={`step-${i}-title`} /> },
            { label: t('gfPrize'), width: 'minmax(0, 1fr)', render: (s, set, i) => <IdPick kind="prize" value={s.prizeId} onChange={v => set({ prizeId: v })} none={t('none')} testId={`step-${i}-prize`} /> },
            { label: t('gmMode'), width: '110px', render: (s, set) => <GrantMode value={s.grantMode} onChange={v => set({ grantMode: v })} /> },
          ]}
        />
      </Field>
      <ActiveSort isActive={isActive} setActive={setActive} sort={sort} setSort={setSort} />
    </FormDialog>
  );
}

export function LevelTables() {
  useLocale();
  const list = useRows('adminLevelTables');
  const loaded = useLoaded();
  const metaName = useMetaName();
  const [edit, setEdit] = useState<LevelRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-level-tables">
      <PageHead title={t('navLevelTables')} sub={num(rows.length)} action={<AddButton label={t('ltAdd')} onClick={() => setEdit('new')} testId="lt-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="lt"
        keyOf={r => r.key}
        empty={{ icon: <TrendUp className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('ltSource'), render: r => metaName(r.metaKey) },
          { label: t('ltSteps'), render: r => t('ltStepsCount', { n: r.steps.length, max: r.steps.length ? Math.max(...r.steps.map(s => s.level)) : 0 }) },
          { label: t('ltLevelMeta'), render: r => (r.levelMetaKey ? metaName(r.levelMetaKey) : '—') },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteLevelTable({ id: r.id }))}
      />
      {edit && <LevelDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type RelRow = RowOf<'adminMetaRelations'>;
type Target = { metaKey: string; action: string; amount: number };

const OPS: [string, import('./i18n.ts').StrKey][] = [
  ['gte', 'opGte'],
  ['gt', 'opGt'],
  ['lte', 'opLte'],
  ['lt', 'opLt'],
  ['eq', 'opEq'],
];

function opSign(o: string) {
  return o === 'gt' ? '>' : o === 'gte' ? '≥' : o === 'lt' ? '<' : o === 'lte' ? '≤' : '=';
}

function RelationDialog(props: { row?: RelRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [metaKey, setMeta] = useState(r?.metaKey ?? '');
  const [operator, setOp] = useState(r?.operator ?? 'gte');
  const [value, setValue] = useState(r?.value ?? 0);
  const [targets, setTargets] = useState<Target[]>(r?.targets.map(x => ({ ...x })) ?? []);
  const [prizeId, setPrize] = useState<bigint>(r?.prizeId ?? 0n);
  const [grantMode, setMode] = useState(r?.grantMode ?? 'auto');
  const [repeat, setRepeat] = useState(r?.repeat ?? 'once');
  const [maxFires, setMaxFires] = useState(r?.maxFires ?? 0);
  const [audienceTagIds, setAudience] = useState<bigint[]>(r?.audienceTagIds ?? []);
  const [clientVisible, setVisible] = useState(r?.clientVisible ?? true);
  const [win, setWin] = useState<[bigint, bigint]>([r?.startsAt ?? 0n, r?.endsAt ?? 0n]);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('mrEdit') : t('mrAdd')}
      testId="mr-dialog"
      width={720}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() =>
          getConn().reducers.adminSaveMetaRelation({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name,
            description,
            metaKey,
            operator,
            value,
            targets,
            prizeId,
            grantMode,
            repeat,
            maxFires,
            audienceTagIds,
            clientVisible,
            startsAt: win[0],
            endsAt: win[1],
            isActive,
            sort,
          })
        )
      }
    >
      <KeyField value={key} onChange={setKey} locked={!!r} />
      <span />
      <NameFields name={name} setName={setName} description={description} setDescription={setDescription} />
      <Field label={t('mrCondition')} required className="span-2">
        <div className="input-group">
          <div className="grow">
            <KeyPick kind="meta" value={metaKey} onChange={setMeta} none="—" testId="mr-meta" />
          </div>
          <div style={{ width: 120 }}>
            <Choice value={operator} onChange={setOp} name="operator" options={OPS} />
          </div>
          <div style={{ width: 120 }}>
            <FloatInput value={value} onChange={setValue} name="conditionValue" />
          </div>
        </div>
      </Field>
      <Field label={t('mrTargets')} hint={t('mrTargetsHint')} className="span-2">
        <Rows
          rows={targets}
          onChange={setTargets}
          testId="mr-targets"
          addLabel={t('mrAddTarget')}
          max={20}
          make={() => ({ metaKey: '', action: 'add', amount: 1 })}
          cols={[
            { label: t('itMeta'), width: 'minmax(0, 1fr)', render: (x, set, i) => <KeyPick kind="meta" value={x.metaKey} onChange={v => set({ metaKey: v })} none="—" testId={`mr-target-${i}-meta`} /> },
            { label: t('pzItemAction'), width: '110px', render: (x, set) => <Choice value={x.action} onChange={v => set({ action: v })} options={[['add', 'acAdd'], ['set', 'acSet']]} /> },
            { label: t('pzItemValue'), width: '110px', render: (x, set, i) => <FloatInput value={x.amount} onChange={v => set({ amount: v })} name={`mr-target-${i}-amount`} /> },
          ]}
        />
      </Field>
      <Field label={t('gfPrize')} hint={t('optional')}>
        <IdPick kind="prize" value={prizeId} onChange={setPrize} none={t('none')} testId="mr-prize" />
      </Field>
      <Field label={t('gmMode')}>
        <GrantMode value={grantMode} onChange={setMode} />
      </Field>
      <Field label={t('erRepeat')} hint={repeat === 'rearm' ? t('mrRearmHint') : repeat === 'every' ? t('mrEveryHint') : undefined}>
        <Choice value={repeat} onChange={setRepeat} name="repeat" options={[['once', 'repOnce'], ['rearm', 'repRearm'], ['every', 'repEveryChange']]} />
      </Field>
      <Field label={t('mrMaxFires')} hint={t('zeroNoLimit')}>
        <NumInput value={maxFires} onChange={setMaxFires} name="maxFires" />
      </Field>
      <Field label={t('audience')} hint={t('prAudienceHint')} className="span-2">
        <TagPicker keyType="user" value={audienceTagIds} onChange={setAudience} />
      </Field>
      <WindowFields startsAt={win[0]} endsAt={win[1]} onChange={(a, b) => setWin([a, b])} />
      <div className="span-2">
        <SwitchRow checked={clientVisible} onChange={setVisible} label={t('mrVisible')} />
      </div>
      <ActiveSort isActive={isActive} setActive={setActive} sort={sort} setSort={setSort} />
    </FormDialog>
  );
}

export function MetaRelations() {
  useLocale();
  const list = useRows('adminMetaRelations');
  const loaded = useLoaded();
  const metaName = useMetaName();
  const prizeName = usePrizeName();
  const [edit, setEdit] = useState<RelRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-meta-relations">
      <PageHead title={t('navMetaRelations')} sub={num(rows.length)} action={<AddButton label={t('mrAdd')} onClick={() => setEdit('new')} testId="mr-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="mr"
        keyOf={r => r.key}
        empty={{ icon: <TreeStructure className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('mrCondition'), render: r => <span className="nowrap">{`${metaName(r.metaKey)} ${opSign(r.operator)} ${fmtNum(r.value)}`}</span> },
          {
            label: t('mrResult'),
            render: r => (
              <span className="stack" style={{ gap: 0 }}>
                {r.targets.map((x, i) => (
                  <span key={i} className="small">
                    {metaName(x.metaKey)} {x.action === 'set' ? '=' : x.amount < 0 ? '' : '+'}
                    {fmtNum(x.amount)}
                  </span>
                ))}
                {r.prizeId ? <span className="small">{prizeName(r.prizeId)}</span> : null}
              </span>
            ),
          },
          { label: t('erRepeat'), render: r => (r.repeat === 'rearm' ? t('repRearm') : r.repeat === 'every' ? t('repEveryChange') : t('repOnce')) },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteMetaRelation({ id: r.id }))}
      />
      {edit && <RelationDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type StreakRow = RowOf<'adminStreaks'>;
type Day = { day: number; prizeId: bigint; grantMode: string };

function dayCols(prefix: string, allowNone: boolean) {
  return [
    { label: t('skDay'), width: '90px', render: (x: Day, set: (p: Partial<Day>) => void, i: number) => <NumInput value={x.day} onChange={v => set({ day: v })} name={`${prefix}-${i}-day`} /> },
    {
      label: t('gfPrize'),
      width: 'minmax(0, 1fr)',
      render: (x: Day, set: (p: Partial<Day>) => void, i: number) => <IdPick kind="prize" value={x.prizeId} onChange={v => set({ prizeId: v })} none={allowNone ? t('none') : '—'} testId={`${prefix}-${i}-prize`} />,
    },
    { label: t('gmMode'), width: '120px', render: (x: Day, set: (p: Partial<Day>) => void) => <GrantMode value={x.grantMode} onChange={v => set({ grantMode: v })} /> },
  ];
}

function StreakDialog(props: { row?: StreakRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [eventKey, setEvent] = useState(r?.eventKey ?? 'login');
  const [periodDays, setPeriodDays] = useState(r?.periodDays ?? 1);
  const [gracePeriods, setGrace] = useState(r?.gracePeriods ?? 0);
  const [missAction, setMiss] = useState(r?.missAction ?? 'reset');
  const [cycleLength, setCycle] = useState(r?.cycleLength ?? 0);
  const [repayAfterFall, setRepay] = useState(r?.repayAfterFall ?? false);
  const [rewards, setRewards] = useState<Day[]>(r?.rewards.map(x => ({ ...x })) ?? []);
  const [milestones, setMilestones] = useState<Day[]>(r?.milestones.map(x => ({ ...x })) ?? []);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  const safe = [...milestones].map(m => m.day).filter(d => d > 0).sort((a, b) => a - b);
  return (
    <FormDialog
      title={r ? t('skEdit') : t('skAdd')}
      testId="sk-dialog"
      width={720}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() =>
          getConn().reducers.adminSaveStreak({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name,
            description,
            eventKey,
            periodDays,
            gracePeriods,
            missAction,
            cycleLength,
            repayAfterFall,
            rewards,
            milestones,
            isActive,
            sort,
          })
        )
      }
    >
      <KeyField value={key} onChange={setKey} locked={!!r} />
      <Field label={t('elType')} required>
        <KeyPick kind="event" value={eventKey} onChange={setEvent} testId="sk-event" />
      </Field>
      <NameFields name={name} setName={setName} description={description} setDescription={setDescription} />
      <Field label={t('skPeriod')} hint={t('skPeriodHint')}>
        <NumInput value={periodDays} onChange={setPeriodDays} name="periodDays" />
      </Field>
      <Field label={t('skGrace')} hint={t('skGraceHint')}>
        <NumInput value={gracePeriods} onChange={setGrace} name="gracePeriods" />
      </Field>
      <Field label={t('skMiss')}>
        <Choice value={missAction} onChange={setMiss} name="missAction" options={[['reset', 'skReset'], ['step_back', 'skStepBack']]} />
      </Field>
      <Field label={t('skCycle')} hint={t('skCycleHint')}>
        <NumInput value={cycleLength} onChange={setCycle} name="cycleLength" />
      </Field>
      <div className="span-2 stack" style={{ gap: 0 }}>
        <SwitchRow checked={repayAfterFall} onChange={setRepay} label={t('skRepay')} testId="sk-repay" />
        <span className="hint">{t('skRepayHint')}</span>
      </div>
      <Field label={t('skRewards')} className="span-2">
        <Rows rows={rewards} onChange={setRewards} testId="sk-rewards" addLabel={t('skAddReward')} max={366} make={() => ({ day: (rewards[rewards.length - 1]?.day ?? 0) + 1, prizeId: 0n, grantMode: 'auto' })} cols={dayCols('sk-reward', false)} />
      </Field>
      <Field label={t('skMilestones')} hint={t('skMilestonesHint')} className="span-2">
        <Rows
          rows={milestones}
          onChange={setMilestones}
          testId="sk-milestones"
          addLabel={t('skAddMilestone')}
          max={50}
          make={() => ({ day: (milestones[milestones.length - 1]?.day ?? 0) + 7, prizeId: 0n, grantMode: 'auto' })}
          cols={dayCols('sk-milestone', true)}
          footer={
            safe.length > 0 && (
              <span className="small muted" data-testid="sk-safe">
                {t('skSafeDays', { days: safe.map(d => digits(d)).join('، ') })}
              </span>
            )
          }
        />
      </Field>
      <ActiveSort isActive={isActive} setActive={setActive} sort={sort} setSort={setSort} />
    </FormDialog>
  );
}

export function Streaks() {
  useLocale();
  const list = useRows('adminStreaks');
  const loaded = useLoaded();
  const eventName = useEventName();
  const [edit, setEdit] = useState<StreakRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-streaks">
      <PageHead title={t('navStreaks')} sub={num(rows.length)} action={<AddButton label={t('skAdd')} onClick={() => setEdit('new')} testId="sk-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="sk"
        keyOf={r => r.key}
        empty={{ icon: <Fire className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('elType'), render: r => eventName(r.eventKey) },
          { label: t('skPeriod'), render: r => t('skEvery', { n: r.periodDays }) },
          { label: t('skRewards'), render: r => t('skCounts', { r: r.rewards.length, m: r.milestones.length }) },
          { label: t('skMilestones'), render: r => (r.milestones.length ? r.milestones.map(m => digits(m.day)).join('، ') : '—') },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteStreak({ id: r.id }))}
      />
      {edit && <StreakDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type TaskRow = RowOf<'adminTasks'>;

function TaskDialog(props: { row?: TaskRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const tasks = useRows('adminTasks');
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [iconUrl, setIcon] = useState(r?.iconUrl ?? '');
  const [categoryId, setCat] = useState<bigint>(r?.categoryId ?? 0n);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [condition, setCondition] = useState(r?.condition ?? 'event');
  const [eventKey, setEvent] = useState(r?.eventKey ?? '');
  const [metric, setMetric] = useState(r?.metric ?? 'count');
  const [target, setTarget] = useState(r?.target ?? 1);
  const [valueMin, setVMin] = useState<number | undefined>(r?.valueMin ?? undefined);
  const [valueMax, setVMax] = useState<number | undefined>(r?.valueMax ?? undefined);
  const [repeat, setRepeat] = useState(r?.repeat ?? 'once');
  const [repeatMinutes, setRepeatMinutes] = useState(r?.repeatMinutes ?? 0);
  const [maxCompletions, setMaxCompletions] = useState(r?.maxCompletions ?? 0);
  const [parentId, setParent] = useState<bigint>(r?.parentId ?? 0n);
  const [dependsOn, setDepends] = useState<bigint[]>(r?.dependsOn ?? []);
  const [groupId, setGroup] = useState<bigint>(r?.groupId ?? 0n);
  const [prizeId, setPrize] = useState<bigint>(r?.prizeId ?? 0n);
  const [grantMode, setMode] = useState(r?.grantMode ?? 'claim');
  const [audienceTagIds, setAudience] = useState<bigint[]>(r?.audienceTagIds ?? []);
  const [levelTableId, setTable] = useState<bigint>(r?.levelTableId ?? 0n);
  const [minLevel, setMinLevel] = useState(r?.minLevel ?? 0);
  const [maxLevel, setMaxLevel] = useState(r?.maxLevel ?? 0);
  const [win, setWin] = useState<[bigint, bigint]>([r?.startsAt ?? 0n, r?.endsAt ?? 0n]);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  const others = tasks.filter(x => x.id !== r?.id);
  return (
    <FormDialog
      title={r ? t('tkEdit') : t('tkAdd')}
      testId="tk-dialog"
      width={760}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() =>
          getConn().reducers.adminSaveTask({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name,
            description,
            iconUrl: iconUrl.trim(),
            categoryId,
            tagIds,
            condition,
            eventKey: condition === 'event' ? eventKey : '',
            metric,
            target,
            valueMin,
            valueMax,
            repeat,
            repeatMinutes: repeat === 'interval' ? repeatMinutes : 0,
            maxCompletions,
            parentId,
            dependsOn,
            groupId,
            prizeId,
            grantMode,
            audienceTagIds,
            levelTableId,
            minLevel,
            maxLevel,
            startsAt: win[0],
            endsAt: win[1],
            isActive,
            sort,
          })
        )
      }
    >
      <KeyField value={key} onChange={setKey} locked={!!r} />
      <Field label={t('tkCondition')}>
        <Choice value={condition} onChange={setCondition} name="condition" testId="tk-condition" options={[['event', 'tkByEvent'], ['children', 'tkByChildren']]} />
      </Field>
      <NameFields name={name} setName={setName} description={description} setDescription={setDescription} />
      {condition === 'event' && (
        <>
          <Field label={t('elType')} required>
            <KeyPick kind="event" value={eventKey} onChange={setEvent} none="—" testId="tk-event" />
          </Field>
          <Field label={t('erMeasure')}>
            <Choice value={metric} onChange={setMetric} name="metric" options={[['count', 'msCount'], ['sum', 'msSum'], ['max', 'msMax']]} />
          </Field>
          <Field label={t('tkTarget')} required>
            <FloatInput value={target} onChange={setTarget} name="target" />
          </Field>
          <Field label={t('tkValueRange')} hint={t('tkValueRangeHint')}>
            <div className="input-group">
              <OptNum value={valueMin} onChange={setVMin} name="valueMin" placeholder={t('from')} />
              <OptNum value={valueMax} onChange={setVMax} name="valueMax" placeholder={t('until')} />
            </div>
          </Field>
        </>
      )}
      <Field label={t('erRepeat')}>
        <Choice value={repeat} onChange={setRepeat} name="repeat" options={[['once', 'repOnce'], ['daily', 'repDaily'], ['weekly', 'repWeekly'], ['interval', 'repInterval']]} />
      </Field>
      {repeat === 'interval' ? (
        <Field label={t('tkRepeatMinutes')}>
          <NumInput value={repeatMinutes} onChange={setRepeatMinutes} name="repeatMinutes" />
        </Field>
      ) : (
        <Field label={t('tkMaxCompletions')} hint={t('zeroNoLimit')}>
          <NumInput value={maxCompletions} onChange={setMaxCompletions} name="maxCompletions" />
        </Field>
      )}
      <Field label={t('tkParent')} hint={t('tkParentHint')}>
        <IdPick kind="task" value={parentId} onChange={setParent} exclude={r?.id} none={t('none')} testId="tk-parent" filter={id => others.find(x => x.id === id)?.parentId === 0n} />
      </Field>
      <Field label={t('tkGroup')}>
        <IdPick kind="group" value={groupId} onChange={setGroup} none={t('none')} testId="tk-group" />
      </Field>
      <Field label={t('tkDepends')} hint={t('tkDependsHint')} className="span-2">
        <div className="chips" data-testid="tk-depends">
          {others.length === 0 && <span className="small muted">—</span>}
          {others.map(x => (
            <button
              type="button"
              key={String(x.id)}
              className="chip chip-btn"
              aria-pressed={dependsOn.includes(x.id)}
              onClick={() => setDepends(dependsOn.includes(x.id) ? dependsOn.filter(d => d !== x.id) : [...dependsOn, x.id])}
              data-testid={`tk-dep-${x.key}`}
            >
              {trText(x.name, def) || x.key}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('gfPrize')}>
        <IdPick kind="prize" value={prizeId} onChange={setPrize} none={t('none')} testId="tk-prize" />
      </Field>
      <Field label={t('gmMode')}>
        <GrantMode value={grantMode} onChange={setMode} />
      </Field>
      <Field label={t('audience')} hint={t('prAudienceHint')} className="span-2">
        <TagPicker keyType="user" value={audienceTagIds} onChange={setAudience} />
      </Field>
      <Field label={t('tkLevelTable')} hint={t('tkLevelTableHint')}>
        <IdPick kind="levelTable" value={levelTableId} onChange={setTable} none={t('none')} testId="tk-level-table" />
      </Field>
      <Field label={t('tkLevelRange')}>
        <div className="input-group">
          <NumInput value={minLevel} onChange={setMinLevel} name="minLevel" />
          <NumInput value={maxLevel} onChange={setMaxLevel} name="maxLevel" />
        </div>
      </Field>
      <WindowFields startsAt={win[0]} endsAt={win[1]} onChange={(a, b) => setWin([a, b])} />
      <Field label={t('category')}>
        <CategoryPicker keyType="task" value={categoryId} onChange={setCat} none={t('noCategory')} label={t('category')} />
      </Field>
      <Field label={t('icon')} hint={t('brUrlHint')}>
        <input className="input ltr" value={iconUrl} onChange={e => setIcon(e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t('tags')} className="span-2">
        <TagPicker keyType="task" value={tagIds} onChange={setTags} />
      </Field>
      <ActiveSort isActive={isActive} setActive={setActive} sort={sort} setSort={setSort} />
    </FormDialog>
  );
}

function repeatText(r: { repeat: string; repeatMinutes: number }) {
  return r.repeat === 'daily' ? t('repDaily') : r.repeat === 'weekly' ? t('repWeekly') : r.repeat === 'interval' ? t('tkEveryMinutes', { n: r.repeatMinutes }) : t('repOnce');
}

export function Tasks() {
  useLocale();
  const list = useRows('adminTasks');
  const groups = useRows('adminTaskGroups');
  const loaded = useLoaded();
  const { def } = useLanguages();
  const eventName = useEventName();
  const prizeName = usePrizeName();
  const [edit, setEdit] = useState<TaskRow | 'new' | null>(null);
  const roots = [...list].filter(x => !x.parentId).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  const rows = roots.flatMap(p => [p, ...list.filter(c => c.parentId === p.id).sort((a, b) => a.sort - b.sort)]);
  const orphans = list.filter(x => x.parentId && !list.some(p => p.id === x.parentId));
  const all = [...rows, ...orphans];
  const nameOf = (id: bigint) => {
    const x = list.find(y => y.id === id);
    return x ? trText(x.name, def) || x.key : '?';
  };
  return (
    <main className="page" data-testid="page-tasks">
      <PageHead title={t('navTasks')} sub={num(all.length)} action={<AddButton label={t('tkAdd')} onClick={() => setEdit('new')} testId="tk-add" />} />
      <CatalogTable
        rows={all}
        loaded={loaded}
        prefix="tk"
        keyOf={r => r.key}
        empty={{ icon: <ListChecks className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          {
            label: t('name'),
            render: r => (
              <span className="row" style={{ gap: 6 }}>
                {r.parentId ? <span className="tree-indent" style={{ width: 16 }} /> : null}
                <span>
                  <NameCell name={r.name} k={r.key} />
                </span>
              </span>
            ),
          },
          {
            label: t('tkCondition'),
            render: r =>
              r.condition === 'children' ? (
                <span className="badge b-violet">{t('tkByChildren')}</span>
              ) : (
                `${eventName(r.eventKey)} · ${fmtNum(r.target)}`
              ),
          },
          { label: t('erRepeat'), render: r => repeatText(r) },
          {
            label: t('tkLinks'),
            render: r => (
              <span className="stack small" style={{ gap: 0 }}>
                {r.groupId ? <span>{t('tkInGroup', { g: trText(groups.find(g => g.id === r.groupId)?.name, def) || '?' })}</span> : null}
                {r.dependsOn.length ? <span>{t('tkAfter', { list: r.dependsOn.map(nameOf).join('، ') })}</span> : null}
                {!r.groupId && !r.dependsOn.length ? '—' : null}
              </span>
            ),
          },
          { label: t('gfPrize'), render: r => (r.prizeId ? `${prizeName(r.prizeId)} · ${modeLabel(r.grantMode)}` : '—') },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteTask({ id: r.id }))}
      />
      {edit && <TaskDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type GroupRow = RowOf<'adminTaskGroups'>;

function TaskGroupDialog(props: { row?: GroupRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [iconUrl, setIcon] = useState(r?.iconUrl ?? '');
  const [categoryId, setCat] = useState<bigint>(r?.categoryId ?? 0n);
  const [activeCount, setActiveCount] = useState(r?.activeCount ?? 1);
  const [orderMode, setOrder] = useState(r?.orderMode ?? 'ordered');
  const [handout, setHandout] = useState(r?.handout ?? 'auto');
  const [handoutMinutes, setHandoutMinutes] = useState(r?.handoutMinutes ?? 0);
  const [isRepeatable, setRepeatable] = useState(r?.isRepeatable ?? false);
  const [members, setMembers] = useState<{ id: bigint }[]>(r?.taskIds.map(id => ({ id })) ?? []);
  const [audienceTagIds, setAudience] = useState<bigint[]>(r?.audienceTagIds ?? []);
  const [win, setWin] = useState<[bigint, bigint]>([r?.startsAt ?? 0n, r?.endsAt ?? 0n]);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('tgrEdit') : t('tgrAdd')}
      testId="tgr-dialog"
      width={700}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() =>
          getConn().reducers.adminSaveTaskGroup({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name,
            description,
            iconUrl: iconUrl.trim(),
            categoryId,
            activeCount,
            orderMode,
            handout,
            handoutMinutes: handout === 'timer' ? handoutMinutes : 0,
            isRepeatable,
            taskIds: members.map(m => m.id).filter(Boolean),
            audienceTagIds,
            startsAt: win[0],
            endsAt: win[1],
            isActive,
            sort,
          })
        )
      }
    >
      <KeyField value={key} onChange={setKey} locked={!!r} />
      <Field label={t('tgrActiveCount')} hint={t('tgrActiveCountHint')}>
        <NumInput value={activeCount} onChange={setActiveCount} name="activeCount" />
      </Field>
      <NameFields name={name} setName={setName} description={description} setDescription={setDescription} />
      <Field label={t('tgrOrder')}>
        <Choice value={orderMode} onChange={setOrder} name="orderMode" options={[['ordered', 'tgrOrdered'], ['random', 'tgrRandom']]} />
      </Field>
      <Field label={t('tgrHandout')}>
        <Choice value={handout} onChange={setHandout} name="handout" options={[['auto', 'tgrAuto'], ['request', 'tgrRequest'], ['timer', 'tgrTimer']]} />
      </Field>
      {handout === 'timer' && (
        <Field label={t('tgrHandoutMinutes')}>
          <NumInput value={handoutMinutes} onChange={setHandoutMinutes} name="handoutMinutes" />
        </Field>
      )}
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isRepeatable} onChange={setRepeatable} label={t('tgrRepeatable')} />
      </div>
      <Field label={t('tgrTasks')} hint={t('tgrTasksHint')} className="span-2">
        <Rows
          rows={members}
          onChange={setMembers}
          testId="tgr-tasks"
          addLabel={t('tgrAddTask')}
          max={50}
          make={() => ({ id: 0n })}
          cols={[
            { label: t('tgrOrderCol'), width: '40px', render: (_x, _s, i) => <span className="badge">{digits(i + 1)}</span> },
            { label: t('navTasks'), width: 'minmax(0, 1fr)', render: (x, set, i) => <IdPick kind="task" value={x.id} onChange={v => set({ id: v })} testId={`tgr-task-${i}`} /> },
          ]}
        />
      </Field>
      <Field label={t('audience')} hint={t('prAudienceHint')} className="span-2">
        <TagPicker keyType="user" value={audienceTagIds} onChange={setAudience} />
      </Field>
      <WindowFields startsAt={win[0]} endsAt={win[1]} onChange={(a, b) => setWin([a, b])} />
      <Field label={t('category')}>
        <CategoryPicker keyType="task" value={categoryId} onChange={setCat} none={t('noCategory')} label={t('category')} />
      </Field>
      <Field label={t('icon')} hint={t('brUrlHint')}>
        <input className="input ltr" value={iconUrl} onChange={e => setIcon(e.target.value)} placeholder="https://" />
      </Field>
      <ActiveSort isActive={isActive} setActive={setActive} sort={sort} setSort={setSort} />
    </FormDialog>
  );
}

export function TaskGroups() {
  useLocale();
  const list = useRows('adminTaskGroups');
  const loaded = useLoaded();
  const [edit, setEdit] = useState<GroupRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-task-groups">
      <PageHead title={t('navTaskGroups')} sub={num(rows.length)} action={<AddButton label={t('tgrAdd')} onClick={() => setEdit('new')} testId="tgr-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="tgr"
        keyOf={r => r.key}
        empty={{ icon: <Stack className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('tgrTasks'), render: r => num(r.taskIds.length) },
          { label: t('tgrHandout'), render: r => (r.handout === 'request' ? t('tgrRequest') : r.handout === 'timer' ? t('tgrTimerN', { n: r.handoutMinutes }) : t('tgrAuto')) },
          { label: t('tgrOrder'), render: r => `${r.orderMode === 'random' ? t('tgrRandom') : t('tgrOrdered')} · ${t('tgrAtOnce', { n: r.activeCount })}` },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteTaskGroup({ id: r.id }))}
      />
      {edit && <TaskGroupDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type AchRow = RowOf<'adminAchievements'>;
type Tier = { tier: number; threshold: number; name: Tr[]; iconUrl: string; prizeId: bigint; grantMode: string };

const RARITIES: [string, import('./i18n.ts').StrKey][] = [
  ['common', 'rrCommon'],
  ['uncommon', 'rrUncommon'],
  ['rare', 'rrRare'],
  ['epic', 'rrEpic'],
  ['legendary', 'rrLegendary'],
];

export function rarityLabel(r: string) {
  const k = RARITIES.find(x => x[0] === r);
  return k ? t(k[1]) : r;
}

export function rarityClass(r: string) {
  return r === 'legendary' ? 'b-warn' : r === 'epic' ? 'b-violet' : r === 'rare' ? 'b-info' : r === 'uncommon' ? 'b-teal' : '';
}

function AchievementDialog(props: { row?: AchRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [hint, setHint] = useState<Tr[]>(r?.hint ?? []);
  const [iconUrl, setIcon] = useState(r?.iconUrl ?? '');
  const [lockedIconUrl, setLockedIcon] = useState(r?.lockedIconUrl ?? '');
  const [categoryId, setCat] = useState<bigint>(r?.categoryId ?? 0n);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [rarity, setRarity] = useState(r?.rarity ?? 'common');
  const [points, setPoints] = useState(r?.points ?? 10);
  const [isHidden, setHidden] = useState(r?.isHidden ?? false);
  const [source, setSource] = useState(r?.source ?? 'event');
  const [eventKey, setEvent] = useState(r?.eventKey ?? '');
  const [metric, setMetric] = useState(r?.metric ?? 'count');
  const [valueMin, setVMin] = useState<number | undefined>(r?.valueMin ?? undefined);
  const [valueMax, setVMax] = useState<number | undefined>(r?.valueMax ?? undefined);
  const [taskId, setTask] = useState<bigint>(r?.taskId ?? 0n);
  const [taskGroupId, setTaskGroup] = useState<bigint>(r?.taskGroupId ?? 0n);
  const [tiers, setTiers] = useState<Tier[]>(r?.tiers.map(x => ({ ...x })) ?? [{ tier: 1, threshold: 1, name: [], iconUrl: '', prizeId: 0n, grantMode: 'claim' }]);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  const many = source === 'event';
  const shown = many ? tiers : tiers.slice(0, 1);
  return (
    <FormDialog
      title={r ? t('acEdit') : t('acNew')}
      testId="ach-dialog"
      width={800}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() =>
          getConn().reducers.adminSaveAchievement({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name,
            description,
            hint,
            iconUrl: iconUrl.trim(),
            lockedIconUrl: lockedIconUrl.trim(),
            categoryId,
            tagIds,
            rarity,
            points,
            isHidden,
            source,
            eventKey: source === 'event' ? eventKey : '',
            metric,
            valueMin,
            valueMax,
            taskId: source === 'task' ? taskId : 0n,
            taskGroupId: source === 'task' ? taskGroupId : 0n,
            tiers: shown.map((x, i) => ({ ...x, tier: i + 1 })),
            isActive,
            sort,
          })
        )
      }
    >
      <KeyField value={key} onChange={setKey} locked={!!r} />
      <Field label={t('acSource')}>
        <Choice value={source} onChange={setSource} name="source" testId="ach-source" options={[['event', 'acByEvent'], ['task', 'acByTask'], ['manual', 'acManual']]} />
      </Field>
      <NameFields name={name} setName={setName} description={description} setDescription={setDescription} />
      {source === 'event' && (
        <>
          <Field label={t('elType')} required>
            <KeyPick kind="event" value={eventKey} onChange={setEvent} none="—" testId="ach-event" />
          </Field>
          <Field label={t('erMeasure')}>
            <Choice value={metric} onChange={setMetric} name="metric" options={[['count', 'msCount'], ['sum', 'msSum'], ['max', 'msMax']]} />
          </Field>
          <Field label={t('tkValueRange')} hint={t('tkValueRangeHint')} className="span-2">
            <div className="input-group">
              <OptNum value={valueMin} onChange={setVMin} name="valueMin" placeholder={t('from')} />
              <OptNum value={valueMax} onChange={setVMax} name="valueMax" placeholder={t('until')} />
            </div>
          </Field>
        </>
      )}
      {source === 'task' && (
        <>
          <Field label={t('acTask')} hint={t('acTaskHint')}>
            <IdPick kind="task" value={taskId} onChange={v => { setTask(v); if (v) setTaskGroup(0n); }} none={t('none')} testId="ach-task" />
          </Field>
          <Field label={t('tkGroup')}>
            <IdPick kind="group" value={taskGroupId} onChange={v => { setTaskGroup(v); if (v) setTask(0n); }} none={t('none')} testId="ach-group" />
          </Field>
        </>
      )}
      <Field label={many ? t('acTiers') : t('acTierOne')} className="span-2">
        <Rows
          rows={shown}
          onChange={setTiers}
          testId="ach-tiers"
          addLabel={t('acAddTier')}
          max={many ? 10 : 1}
          make={() => ({ tier: shown.length + 1, threshold: (shown[shown.length - 1]?.threshold ?? 0) + 1, name: [], iconUrl: '', prizeId: 0n, grantMode: 'claim' })}
          cols={[
            { label: t('acTier'), width: '44px', render: (_x, _s, i) => <span className="badge">{digits(i + 1)}</span> },
            ...(many ? [{ label: t('ltThreshold'), width: '100px', render: (x: Tier, set: (p: Partial<Tier>) => void, i: number) => <FloatInput value={x.threshold} onChange={v => set({ threshold: v })} name={`tier-${i}-threshold`} /> }] : []),
            { label: t('acTierName'), width: 'minmax(0, 1.2fr)', render: (x, set, i) => <TrInputs value={x.name} onChange={v => set({ name: v })} name={`tier-${i}-name`} /> },
            { label: t('gfPrize'), width: 'minmax(0, 1fr)', render: (x, set, i) => <IdPick kind="prize" value={x.prizeId} onChange={v => set({ prizeId: v })} none={t('none')} testId={`tier-${i}-prize`} /> },
            { label: t('gmMode'), width: '110px', render: (x, set) => <GrantMode value={x.grantMode} onChange={v => set({ grantMode: v })} /> },
          ]}
        />
      </Field>
      <Field label={t('acRarity')}>
        <Choice value={rarity} onChange={setRarity} name="rarity" options={RARITIES} />
      </Field>
      <Field label={t('acPoints')}>
        <NumInput value={points} onChange={setPoints} name="points" />
      </Field>
      <div className="span-2 stack" style={{ gap: 0 }}>
        <SwitchRow checked={isHidden} onChange={setHidden} label={t('acHidden')} testId="ach-hidden" />
        <span className="hint">{t('acHiddenHint')}</span>
      </div>
      {isHidden && (
        <Field label={t('acHint')} className="span-2">
          <TrInputs value={hint} onChange={setHint} name="hint" />
        </Field>
      )}
      <Field label={t('icon')} hint={t('brUrlHint')}>
        <input className="input ltr" value={iconUrl} onChange={e => setIcon(e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t('acLockedIcon')} hint={t('brUrlHint')}>
        <input className="input ltr" value={lockedIconUrl} onChange={e => setLockedIcon(e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t('category')}>
        <CategoryPicker keyType="achievement" value={categoryId} onChange={setCat} none={t('noCategory')} label={t('category')} />
      </Field>
      <span />
      <Field label={t('tags')} className="span-2">
        <TagPicker keyType="achievement" value={tagIds} onChange={setTags} />
      </Field>
      <ActiveSort isActive={isActive} setActive={setActive} sort={sort} setSort={setSort} />
    </FormDialog>
  );
}

export function Achievements() {
  useLocale();
  const list = useRows('adminAchievements');
  const loaded = useLoaded();
  const eventName = useEventName();
  const [edit, setEdit] = useState<AchRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-achievements">
      <PageHead title={t('navAchievements')} sub={num(rows.length)} action={<AddButton label={t('acNew')} onClick={() => setEdit('new')} testId="ach-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="ach"
        keyOf={r => r.key}
        empty={{ icon: <Medal className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('acSource'), render: r => (r.source === 'event' ? eventName(r.eventKey) : r.source === 'task' ? t('acByTask') : t('acManual')) },
          { label: t('acTiers'), render: r => num(r.tiers.length) },
          {
            label: t('acRarity'),
            render: r => (
              <span className="chips">
                <span className={`badge ${rarityClass(r.rarity)}`}>{rarityLabel(r.rarity)}</span>
                <span className="small muted">{t('acPointsN', { n: r.points })}</span>
                {r.isHidden && <span className="badge">{t('acHidden')}</span>}
              </span>
            ),
          },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteAchievement({ id: r.id }))}
      />
      {edit && <AchievementDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

const KINDS = ['event', 'level', 'streak', 'milestone', 'relation', 'task', 'achievement'] as const;

export function kindLabelG(k: string) {
  const map: Record<string, import('./i18n.ts').StrKey> = {
    event: 'ckEvent',
    level: 'ckLevel',
    streak: 'ckStreak',
    milestone: 'ckMilestone',
    relation: 'ckRelation',
    task: 'ckTask',
    achievement: 'ckAchievement',
  };
  return map[k] ? t(map[k]) : k;
}

export function claimStatus(s: string) {
  const cls = s === 'granted' ? 'b-ok' : s === 'failed' ? 'b-bad' : 'b-warn';
  return <span className={`badge ${cls}`}>{s === 'granted' ? t('clGranted') : s === 'failed' ? t('clFailed') : t('clReady')}</span>;
}

export function Claims() {
  const route = useRoute();
  useLocale();
  const { can } = useSession();
  const kind = route.query.get('kind') ?? '';
  const status = route.query.get('status') ?? '';
  const [player, setPlayer] = useState('');
  const [page, setPage] = useState(1);
  const p = useDebounced(player, 300);
  const accountId = /^\d+$/.test(latin(p).trim()) ? BigInt(latin(p).trim()) : 0n;
  const prizeName = usePrizeName();
  const { data, error, loading } = useFetch(() => getConn().procedures.adminClaims({ accountId, kind, status, page, pageSize: PAGE }), [String(accountId), kind, status, page]);
  const rows = data?.rows ?? [];
  const set = (q: Record<string, string>) => {
    setPage(1);
    pageQuery('claims', { kind, status, ...q });
  };
  async function retry(id: bigint) {
    const r = await run(c => c.procedures.adminRetryClaim({ claimId: id }));
    if (!r.ok) toast('bad', errorText(r.err));
    else if (r.value.status === 'granted') toast('ok', t('clRetried'));
    else toast('bad', errorText({ code: r.value.error || 'UNKNOWN', raw: r.value.error }));
  }
  return (
    <main className="page" data-testid="page-claims">
      <PageHead title={t('navClaims')} sub={data ? num(data.total) : <Skel w={40} h={10} />} />
      <div className="toolbar">
        <div className="input-affix search" style={{ width: 200 }}>
          <MagnifyingGlass className="ic" />
          <input className="input" value={player} onChange={e => { setPlayer(e.target.value); setPage(1); }} placeholder={t('elPlayer')} aria-label={t('elPlayer')} inputMode="numeric" data-testid="cl-player" />
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 150 }} value={kind} onChange={e => set({ kind: e.target.value })} aria-label={t('clKind')} data-testid="cl-kind">
          <option value="">{t('clAllKinds')}</option>
          {KINDS.map(k => (
            <option key={k} value={k}>
              {kindLabelG(k)}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 150 }} value={status} onChange={e => set({ status: e.target.value })} aria-label={t('status')} data-testid="cl-status">
          <option value="">{t('pyAllStatus')}</option>
          <option value="ready">{t('clReady')}</option>
          <option value="granted">{t('clGranted')}</option>
          <option value="failed">{t('clFailed')}</option>
        </select>
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="cl-table">
          <thead>
            <tr>
              <th>{t('pyColId')}</th>
              <th>{t('pyColPlayer')}</th>
              <th>{t('clKind')}</th>
              <th>{t('gfPrize')}</th>
              <th>{t('status')}</th>
              <th>{t('auColTime')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={7} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty icon={<Receipt className="ic" weight="duotone" />} title={t('emptyList')} />
                </td>
              </tr>
            ) : (
              rows.map(c => (
                <tr key={String(c.id)} data-testid={`cl-row-${c.id}`}>
                  <td className="primary">#{digits(String(c.id))}</td>
                  <td>
                    <a className="row-link" href={`#/player?id=${c.accountId}`}>
                      #{digits(String(c.accountId))}
                    </a>
                  </td>
                  <td>
                    {kindLabelG(c.kind)} <span className="mono muted">{c.scope}</span>
                  </td>
                  <td>
                    {prizeName(c.prizeId)} · {modeLabel(c.grantMode)}
                  </td>
                  <td>
                    <span className="stack" style={{ gap: 2 }}>
                      {claimStatus(c.status)}
                      {c.error && <span className="small neg">{errorText({ code: c.error, raw: c.error })}</span>}
                    </span>
                  </td>
                  <td className="nowrap">{when(c.createdAt)}</td>
                  <td className="end">
                    {can('admin') && c.status !== 'granted' && (
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => retry(c.id)} data-testid={`cl-retry-${c.id}`}>
                        <ArrowClockwise className="ic" />
                        {t('clRetry')}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(c => (
            <div className="pcard" key={String(c.id)}>
              <div className="row">
                <b className="grow">{kindLabelG(c.kind)}</b>
                {claimStatus(c.status)}
              </div>
              <div className="pcard-meta">
                <span>{t('gfPrize')}</span>
                <span>{prizeName(c.prizeId)}</span>
                <span>{t('pyColPlayer')}</span>
                <span>#{digits(String(c.accountId))}</span>
              </div>
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}

function RecordEventDialog(props: { accountId: bigint; onClose: () => void }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState(1);
  const [metadata, setMetadata] = useState('');
  return (
    <FormDialog
      title={t('ppRecordEvent')}
      testId="rec-dialog"
      width={480}
      onClose={props.onClose}
      submit={() => save(() => getConn().procedures.adminRecordEvent({ accountId: props.accountId, key, value, metadata: metadata.trim() }))}
    >
      <Field label={t('elType')} required className="span-2">
        <KeyPick kind="event" value={key} onChange={setKey} none="—" testId="rec-type" />
      </Field>
      <Field label={t('pzItemValue')}>
        <FloatInput value={value} onChange={setValue} name="recValue" />
      </Field>
      <Field label={t('elMetadata')} hint={t('optional')}>
        <input className="input ltr" value={metadata} onChange={e => setMetadata(e.target.value)} placeholder="{}" name="recMetadata" />
      </Field>
    </FormDialog>
  );
}

function GiveAchievementDialog(props: { accountId: bigint; onClose: () => void }) {
  const [achievementId, setAch] = useState<bigint>(0n);
  const [tier, setTier] = useState(1);
  return (
    <FormDialog
      title={t('ppGiveAchievement')}
      testId="give-ach-dialog"
      width={480}
      onClose={props.onClose}
      submit={() => save(() => getConn().reducers.adminGiveAchievement({ accountId: props.accountId, achievementId, tier }))}
    >
      <Field label={t('navAchievements')} required>
        <IdPick kind="achievement" value={achievementId} onChange={setAch} testId="give-ach" />
      </Field>
      <Field label={t('acTier')}>
        <NumInput value={tier} onChange={setTier} name="giveTier" />
      </Field>
    </FormDialog>
  );
}

function TaskActionDialog(props: { accountId: bigint; onClose: () => void }) {
  const [taskId, setTask] = useState<bigint>(0n);
  const [err, setErr] = useState<string | null>(null);
  async function act(kind: 'complete' | 'reset') {
    const r = await run(c => (kind === 'complete' ? c.reducers.adminCompleteTask({ accountId: props.accountId, taskId }) : c.reducers.adminResetTask({ accountId: props.accountId, taskId })), t('done'));
    if (r.ok) props.onClose();
    else setErr(errorText(r.err));
  }
  return (
    <Dialog
      title={t('ppTaskActions')}
      width={460}
      onClose={props.onClose}
      testId="task-act-dialog"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" disabled={!taskId} onClick={() => act('reset')} data-testid="task-act-reset">
            {t('ppResetTask')}
          </button>
          <button type="button" className="btn btn-primary" disabled={!taskId} onClick={() => act('complete')} data-testid="task-act-complete">
            {t('ppCompleteTask')}
          </button>
        </>
      }
    >
      <Field label={t('navTasks')}>
        <IdPick kind="task" value={taskId} onChange={setTask} testId="task-act-task" />
      </Field>
      <ErrBox text={err} />
    </Dialog>
  );
}

export function PlayerProgressCard(props: { accountId: bigint }) {
  const { can } = useSession();
  const { def } = useLanguages();
  const { data } = useFetch(() => getConn().procedures.adminPlayerProgress({ accountId: props.accountId }), [String(props.accountId)]);
  const tables = useRows('adminLevelTables');
  const streaks = useRows('adminStreaks');
  const tasks = useRows('adminTasks');
  const achievements = useRows('adminAchievements');
  const relations = useRows('adminMetaRelations');
  const [dlg, setDlg] = useState<'event' | 'ach' | 'task' | null>(null);
  const nameBy = <T extends { id: bigint; key: string; name: Tr[] }>(list: T[], id: bigint) => {
    const x = list.find(y => y.id === id);
    return x ? trText(x.name, def) || x.key : `#${digits(String(id))}`;
  };
  return (
    <Section
      title={t('ppProgress')}
      pad={false}
      testId="pd-progress"
      action={
        can('admin') && (
          <div className="row row-wrap" style={{ gap: 4 }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setDlg('event')} data-testid="pp-record">
              <Lightning className="ic" />
              {t('ppRecordEvent')}
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setDlg('task')} data-testid="pp-task">
              <ListChecks className="ic" />
              {t('ppTaskActions')}
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setDlg('ach')} data-testid="pp-give-ach">
              <Medal className="ic" />
              {t('ppGiveAchievement')}
            </button>
          </div>
        )
      }
    >
      {!data ? (
        <div className="card-pad stack">
          <Skel h={50} r={6} />
          <Skel h={50} r={6} />
        </div>
      ) : (
        <div className="card-pad stack">
          <div className="stack stack-sm">
            <span className="section-label">{t('ppLevels')}</span>
            <div className="chips" data-testid="pp-levels">
              {data.levels.length === 0 && <span className="small muted">—</span>}
              {data.levels.map(l => (
                <span className="chip" key={String(l.id)}>
                  <Ruler className="ic" />
                  {nameBy(tables, l.tableId)}: <b>{t('ppLevelN', { n: l.level })}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="stack stack-sm">
            <span className="section-label">{t('navStreaks')}</span>
            {data.streaks.length === 0 && <span className="small muted">—</span>}
            {data.streaks.map(s => (
              <div className="row small" key={String(s.id)} data-testid={`pp-streak-${s.streakId}`}>
                <Fire className="ic muted" />
                <span className="grow">
                  {nameBy(streaks, s.streakId)}: <b>{t('ppStreakCount', { n: s.count })}</b> <span className="muted">{t('ppStreakMeta', { best: s.best, peak: s.peak, falls: s.falls })}</span>
                </span>
                {can('admin') && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid={`pp-streak-reset-${s.streakId}`}
                    onClick={async () => {
                      if (await confirmAsk(t('ppResetStreakConfirm'), { danger: true, ok: t('ppReset') }))
                        await runToast(c => c.reducers.adminResetStreak({ accountId: props.accountId, streakId: s.streakId }), t('done'));
                    }}
                  >
                    {t('ppReset')}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="stack stack-sm">
            <span className="section-label">{t('navTasks')}</span>
            {data.tasks.length === 0 && <span className="small muted">—</span>}
            <div className="chips" data-testid="pp-tasks">
              {data.tasks.slice(0, 30).map(x => (
                <span className={`chip ${x.status === 'claimed' ? '' : x.status === 'completed' ? 'b-ok' : ''}`} key={String(x.id)}>
                  {nameBy(tasks, x.taskId)} · {x.status === 'active' ? t('ppTaskActive') : x.status === 'completed' ? t('ppTaskDone') : t('ppTaskClaimed')}
                </span>
              ))}
            </div>
          </div>
          <div className="stack stack-sm">
            <span className="section-label">{t('navAchievements')}</span>
            {data.achievements.filter(a => a.tier > 0).length === 0 && <span className="small muted">—</span>}
            {data.achievements
              .filter(a => a.tier > 0)
              .map(a => (
                <div className="row small" key={String(a.id)} data-testid={`pp-ach-${a.achievementId}`}>
                  <Medal className="ic muted" />
                  <span className="grow">
                    {nameBy(achievements, a.achievementId)} · {t('acTierN', { n: a.tier })} <span className="muted">{a.source}</span>
                  </span>
                  {can('admin') && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-ghost"
                      data-testid={`pp-revoke-${a.achievementId}`}
                      onClick={async () => {
                        if (await confirmAsk(t('ppRevokeConfirm'), { danger: true, ok: t('ppRevoke') }))
                          await runToast(c => c.reducers.adminRevokeAchievement({ accountId: props.accountId, achievementId: a.achievementId }), t('done'));
                      }}
                    >
                      {t('ppRevoke')}
                    </button>
                  )}
                </div>
              ))}
          </div>
          {data.relations.length > 0 && (
            <div className="stack stack-sm">
              <span className="section-label">{t('navMetaRelations')}</span>
              {data.relations.map(x => (
                <div className="row small" key={String(x.id)}>
                  <TreeStructure className="ic muted" />
                  <span className="grow">
                    {nameBy(relations, x.relationId)} · {t('ppFires', { n: x.fires })}
                  </span>
                  {can('admin') && (
                    <button type="button" className="btn btn-sm" onClick={() => runToast(c => c.reducers.adminForgetRelation({ accountId: props.accountId, relationId: x.relationId }), t('done'))}>
                      {t('ppForget')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.claims.length > 0 && (
            <div className="stack stack-sm">
              <span className="row">
                <span className="section-label grow">{t('navClaims')}</span>
                <a className="btn btn-sm" href={`#/claims`}>
                  <ArrowsClockwise className="ic" />
                  {t('navClaims')}
                </a>
              </span>
              {data.claims.slice(0, 8).map(c => (
                <div className="row small" key={String(c.id)}>
                  <span className="grow">
                    {kindLabelG(c.kind)} <span className="mono muted">{c.scope}</span>
                  </span>
                  {claimStatus(c.status)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {dlg === 'event' && <RecordEventDialog accountId={props.accountId} onClose={() => setDlg(null)} />}
      {dlg === 'ach' && <GiveAchievementDialog accountId={props.accountId} onClose={() => setDlg(null)} />}
      {dlg === 'task' && <TaskActionDialog accountId={props.accountId} onClose={() => setDlg(null)} />}
    </Section>
  );
}

export { TagList };
