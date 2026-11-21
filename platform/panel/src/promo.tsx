import { useState } from 'react';
import { ArrowRight, ChartBar, DownloadSimple, Eye, Handshake, Image, MagnifyingGlass, SquaresFour, Ticket } from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { codeText, date, digits, errorText, latin, num, t, useLocale, type StrKey } from './i18n.ts';
import { pageQuery, run, toast, trText, useDebounced, useFetch, useLanguages, useRoute, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, NumInput, Pager, Skel, SwitchRow, TableSkeleton, TrInputs } from './ui.tsx';
import { BigInput, FloatInput, Section, TagPicker, fmtNum, toman, when } from './widgets.tsx';
import { ActiveBadge, AddButton, FormDialog, NameCell, PageHead, del, needTitle, save, useItemNames } from './economy.tsx';
import { CatalogTable, Choice, IdPick, KeyPick, Rows, WindowFields, useLoaded, usePrizeName } from './kit.tsx';

const PAGE = 20;

type PlacementRow = RowOf<'placement'>;

const LAYOUTS: [string, StrKey][] = [
  ['carousel', 'lyCarousel'],
  ['single', 'lySingle'],
  ['grid', 'lyGrid'],
  ['strip', 'lyStrip'],
];

function PlacementDialog(props: { row?: PlacementRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [layout, setLayout] = useState(r?.layout ?? 'carousel');
  const [maxItems, setMax] = useState(r?.maxItems ?? 5);
  const [rotateSeconds, setRotate] = useState(r?.rotateSeconds ?? 5);
  const [sponsorId, setSponsor] = useState<bigint>(r?.sponsorId ?? 0n);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('plcEdit') : t('plcNew')}
      testId="plc-dialog"
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() => getConn().reducers.adminSavePlacement({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, description, layout, maxItems, rotateSeconds, sponsorId, isActive, sort }))
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('plcLayout')}>
        <Choice value={layout} onChange={setLayout} name="layout" options={LAYOUTS} />
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('description')} className="span-2" hint={t('optional')}>
        <TrInputs value={description} onChange={setDescription} name="description" />
      </Field>
      <Field label={t('plcMax')} hint={t('plcMaxHint')}>
        <NumInput value={maxItems} onChange={setMax} name="maxItems" />
      </Field>
      <Field label={t('plcRotate')} hint={t('plcRotateHint')}>
        <NumInput value={rotateSeconds} onChange={setRotate} name="rotateSeconds" />
      </Field>
      <Field label={t('spSponsor')} hint={t('optional')}>
        <IdPick kind="sponsor" value={sponsorId} onChange={setSponsor} none={t('none')} />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

export function Placements() {
  useLocale();
  const list = useRows('placement');
  const banners = useRows('adminBanners');
  const loaded = useLoaded();
  const [edit, setEdit] = useState<PlacementRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-placements">
      <PageHead title={t('navPlacements')} sub={num(rows.length)} action={<AddButton label={t('plcNew')} onClick={() => setEdit('new')} testId="plc-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="plc"
        keyOf={r => r.key}
        empty={{ icon: <SquaresFour className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('plcLayout'), render: r => t(LAYOUTS.find(x => x[0] === r.layout)?.[1] ?? 'lyCarousel') },
          { label: t('navBanners'), render: r => num(banners.filter(b => b.placementId === r.id).length) },
          { label: t('plcMax'), render: r => `${digits(r.maxItems)} · ${r.rotateSeconds ? t('plcEverySec', { n: r.rotateSeconds }) : t('plcNoRotate')}` },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        extra={(r, card) => (
          <a className="btn btn-sm" href={`#/banners?placement=${r.id}`}>
            <Image className="ic" />
            {t('navBanners')}
          </a>
        )}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeletePlacement({ id: r.id }))}
      />
      {edit && <PlacementDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

const DAYS: [number, StrKey][] = [
  [6, 'dSat'],
  [0, 'dSun'],
  [1, 'dMon'],
  [2, 'dTue'],
  [3, 'dWed'],
  [4, 'dThu'],
  [5, 'dFri'],
];

function minutesToTime(m: number) {
  if (m >= 1440) return '24:00';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function timeToMinutes(v: string) {
  const [h, m] = v.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}

const ACTIONS: [string, StrKey][] = [
  ['none', 'baNone'],
  ['screen', 'baScreen'],
  ['product', 'baProduct'],
  ['achievement', 'baAchievement'],
  ['url', 'baUrl'],
  ['sponsor', 'baSponsor'],
];

type BannerRow = RowOf<'adminBanners'>;

export function CountriesPick(props: { value: string[]; onChange: (v: string[]) => void }) {
  const all = useRows('country');
  const { def } = useLanguages();
  const [add, setAdd] = useState('');
  const name = (c: string) => trText(all.find(x => x.code === c)?.name, def) || c;
  return (
    <div className="stack stack-sm">
      <div className="chips">
        {props.value.length === 0 && <span className="small muted">{t('bnAllCountries')}</span>}
        {props.value.map(c => (
          <button type="button" key={c} className="chip chip-btn" aria-pressed onClick={() => props.onChange(props.value.filter(x => x !== c))} title={t('delete')}>
            {name(c)} ✕
          </button>
        ))}
      </div>
      <select
        className="select"
        value={add}
        aria-label={t('stCountries')}
        data-testid="bn-country-add"
        onChange={e => {
          const v = e.target.value;
          setAdd('');
          if (v && !props.value.includes(v)) props.onChange([...props.value, v]);
        }}
      >
        <option value="">{t('bnAddCountry')}</option>
        {[...all]
          .filter(c => c.isActive && !props.value.includes(c.code))
          .sort((a, b) => a.sort - b.sort || trText(a.name, def).localeCompare(trText(b.name, def)))
          .map(c => (
            <option key={c.code} value={c.code}>
              {trText(c.name, def)} ({c.code})
            </option>
          ))}
      </select>
    </div>
  );
}

function BannerDialog(props: { row?: BannerRow; placementId?: bigint; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [placementId, setPlacement] = useState<bigint>(r?.placementId ?? props.placementId ?? 0n);
  const [name, setName] = useState(r?.name ?? '');
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [title, setTitle] = useState<Tr[]>(r?.title ?? []);
  const [subtitle, setSubtitle] = useState<Tr[]>(r?.subtitle ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [imageUrl, setImage] = useState(r?.imageUrl ?? '');
  const [bgColor, setBg] = useState(r?.bgColor ?? '');
  const [actionType, setActionType] = useState(r?.actionType ?? 'none');
  const [actionValue, setActionValue] = useState(r?.actionValue ?? '');
  const [actionLabel, setActionLabel] = useState<Tr[]>(r?.actionLabel ?? []);
  const [priority, setPriority] = useState(r?.priority ?? 0);
  const [win, setWin] = useState<[bigint, bigint]>([r?.startsAt ?? 0n, r?.endsAt ?? 0n]);
  const [days, setDays] = useState<number[]>(r?.days ?? []);
  const [dayStart, setDayStart] = useState(r?.dayStart ?? 0);
  const [dayEnd, setDayEnd] = useState(r?.dayEnd ?? 0);
  const [audienceTagIds, setAudience] = useState<bigint[]>(r?.audienceTagIds ?? []);
  const [excludeTagIds, setExclude] = useState<bigint[]>(r?.excludeTagIds ?? []);
  const [levelTableId, setTable] = useState<bigint>(r?.levelTableId ?? 0n);
  const [minLevel, setMinLevel] = useState(r?.minLevel ?? 0);
  const [maxLevel, setMaxLevel] = useState(r?.maxLevel ?? 0);
  const [playerAge, setAge] = useState(r?.playerAge ?? 'all');
  const [countries, setCountries] = useState<string[]>(r?.countries ?? []);
  const [sponsorId, setSponsor] = useState<bigint>(r?.sponsorId ?? 0n);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const allDay = dayStart === 0 && dayEnd === 0;
  return (
    <FormDialog
      title={r ? t('bnEdit') : t('bnNew')}
      testId="bn-dialog"
      width={820}
      onClose={props.onClose}
      submit={async () =>
        (trMissing(title, def) ? ({ ok: false, msg: t('trRequired', { lang: def }) } as const) : null) ??
        save(() =>
          getConn().reducers.adminSaveBanner({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            placementId,
            name: name.trim(),
            tagIds,
            title,
            subtitle,
            description,
            imageUrl: imageUrl.trim(),
            bgColor: bgColor.trim(),
            actionType,
            actionValue: actionType === 'none' || actionType === 'sponsor' ? '' : actionValue.trim(),
            actionLabel,
            priority,
            startsAt: win[0],
            endsAt: win[1],
            days,
            dayStart,
            dayEnd,
            audienceTagIds,
            excludeTagIds,
            levelTableId,
            minLevel,
            maxLevel,
            playerAge,
            countries,
            sponsorId,
            isActive,
          })
        )
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('bnPlacement')} required>
        <IdPick kind="placement" value={placementId} onChange={setPlacement} testId="bn-placement" />
      </Field>
      <Field label={t('bnInternalName')} required className="span-2">
        <input className="input" name="internalName" value={name} onChange={e => setName(e.target.value)} />
      </Field>
      <Field label={t('bnTitle')} required className="span-2">
        <TrInputs value={title} onChange={setTitle} required name="title" />
      </Field>
      <Field label={t('bnSubtitle')} className="span-2" hint={t('optional')}>
        <TrInputs value={subtitle} onChange={setSubtitle} name="subtitle" />
      </Field>
      <Field label={t('bnImage')} hint={t('brUrlHint')}>
        <input className="input ltr" name="imageUrl" value={imageUrl} onChange={e => setImage(e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t('bnBg')}>
        <div className="input-group">
          <input type="color" className="color-input" value={/^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor : '#ffffff'} onChange={e => setBg(e.target.value)} aria-label={t('bnBg')} />
          <input className="input ltr grow" name="bgColor" value={bgColor} onChange={e => setBg(e.target.value)} placeholder="#rrggbb" />
        </div>
      </Field>
      <Field label={t('bnAction')}>
        <Choice value={actionType} onChange={setActionType} name="actionType" options={ACTIONS} testId="bn-action" />
      </Field>
      {actionType !== 'none' && actionType !== 'sponsor' ? (
        <Field label={t('bnActionValue')} hint={actionType === 'url' ? 'https://' : actionType === 'product' ? t('bnProductHint') : actionType === 'achievement' ? t('bnAchievementHint') : t('bnScreenHint')}>
          <input className="input ltr" name="actionValue" value={actionValue} onChange={e => setActionValue(e.target.value)} />
        </Field>
      ) : (
        <span />
      )}
      {actionType !== 'none' && (
        <Field label={t('bnActionLabel')} className="span-2" hint={t('optional')}>
          <TrInputs value={actionLabel} onChange={setActionLabel} name="actionLabel" />
        </Field>
      )}
      <Field label={t('bnPriority')} hint={t('bnPriorityHint')}>
        <NumInput value={priority} onChange={setPriority} name="priority" />
      </Field>
      <Field label={t('spSponsor')} hint={t('optional')}>
        <IdPick kind="sponsor" value={sponsorId} onChange={setSponsor} none={t('none')} testId="bn-sponsor" />
      </Field>
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('bnSchedule')}
      </div>
      <WindowFields startsAt={win[0]} endsAt={win[1]} onChange={(a, b) => setWin([a, b])} />
      <Field label={t('bnDays')} hint={t('bnDaysHint')} className="span-2">
        <div className="chips" data-testid="bn-days">
          {DAYS.map(([d, k]) => (
            <button type="button" key={d} className="chip chip-btn" aria-pressed={days.includes(d)} onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort())} data-testid={`bn-day-${d}`}>
              {t(k)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('bnHours')} hint={allDay ? t('bnAllDay') : dayEnd < dayStart ? t('bnWraps') : undefined} className="span-2">
        <div className="input-group">
          <input type="time" className="input ltr" name="dayStart" value={minutesToTime(dayStart)} onChange={e => setDayStart(timeToMinutes(e.target.value))} aria-label={t('from')} />
          <input type="time" className="input ltr" name="dayEnd" value={minutesToTime(dayEnd)} onChange={e => setDayEnd(timeToMinutes(e.target.value))} aria-label={t('until')} />
        </div>
      </Field>
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('bnTargeting')}
      </div>
      <Field label={t('audience')} hint={t('prAudienceHint')}>
        <TagPicker keyType="user" value={audienceTagIds} onChange={setAudience} />
      </Field>
      <Field label={t('ofExclude')}>
        <TagPicker keyType="user" value={excludeTagIds} onChange={setExclude} />
      </Field>
      <Field label={t('tkLevelTable')}>
        <IdPick kind="levelTable" value={levelTableId} onChange={setTable} none={t('imMainTable')} />
      </Field>
      <Field label={t('tkLevelRange')}>
        <div className="input-group">
          <NumInput value={minLevel} onChange={setMinLevel} name="minLevel" />
          <NumInput value={maxLevel} onChange={setMaxLevel} name="maxLevel" />
        </div>
      </Field>
      <Field label={t('bnAge')}>
        <Choice value={playerAge} onChange={setAge} name="playerAge" options={[['all', 'bnAgeAll'], ['new', 'bnAgeNew'], ['returning', 'bnAgeReturning']]} />
      </Field>
      <Field label={t('stCountries')}>
        <CountriesPick value={countries} onChange={setCountries} />
      </Field>
      <Field label={t('description')} className="span-2" hint={t('optional')}>
        <TrInputs value={description} onChange={setDescription} name="description" />
      </Field>
      <Field label={t('tags')} className="span-2">
        <TagPicker keyType="banner" value={tagIds} onChange={setTags} />
      </Field>
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

function trMissing(v: Tr[], def: string) {
  return !v.find(x => x.lang === def && x.text.trim());
}

function scheduleText(b: BannerRow) {
  const parts: string[] = [];
  if (b.startsAt || b.endsAt) parts.push(`${b.startsAt ? date(new Date(Number(b.startsAt / 1000n)), false) : '…'} – ${b.endsAt ? date(new Date(Number(b.endsAt / 1000n)), false) : '…'}`);
  if (b.days.length) parts.push(DAYS.filter(([d]) => b.days.includes(d)).map(([, k]) => t(k)).join('، '));
  if (b.dayStart || b.dayEnd) parts.push(digits(`${minutesToTime(b.dayStart)}–${minutesToTime(b.dayEnd)}`));
  return parts.join(' · ') || t('bnAlways');
}

function StatsDialog(props: { banner: BannerRow; onClose: () => void }) {
  const { data, error } = useFetch(() => getConn().procedures.adminBannerStats({ bannerId: props.banner.id, days: 14 }), [String(props.banner.id)]);
  const max = Math.max(1, ...(data?.days.map(d => d.views) ?? [1]));
  return (
    <Dialog title={t('bnStatsOf', { name: props.banner.name || props.banner.key })} width={600} onClose={props.onClose} testId="bn-stats">
      <ErrBox text={error ? errorText(error) : null} />
      {!data ? (
        <Skel h={160} r={8} />
      ) : (
        <>
          <dl className="stat-row" style={{ margin: 0 }}>
            <div className="stat">
              <dt>{t('spViews')}</dt>
              <dd data-testid="bn-stats-views">{num(data.views)}</dd>
            </div>
            <div className="stat">
              <dt>{t('spClicks')}</dt>
              <dd>{num(data.clicks)}</dd>
            </div>
            <div className="stat">
              <dt>{t('spCtr')}</dt>
              <dd>{data.views ? `${digits((Math.round((data.clicks / data.views) * 1000) / 10).toString())}٪` : '—'}</dd>
            </div>
          </dl>
          <div className="chart" role="img" aria-label={t('bnStats')}>
            {data.days.map(d => (
              <span key={d.day} className={`bar ${d.views ? '' : 'zero'}`} style={{ height: `${Math.max(d.views ? 3 : 1, (d.views / max) * 100)}%` }} title={`${dayLabel(d.day)}: ${num(d.views)} / ${num(d.clicks)}`} />
            ))}
          </div>
          <div className="chart-axis">
            <span>{data.days[0] ? dayLabel(data.days[0].day) : ''}</span>
            <span>{data.days.length ? dayLabel(data.days[data.days.length - 1].day) : ''}</span>
          </div>
        </>
      )}
    </Dialog>
  );
}

function dayLabel(s: string) {
  return date(new Date(`${s}T12:00:00`), false);
}

const REASONS: Record<string, StrKey> = {
  off: 'whyOff',
  scheduled: 'whyScheduled',
  ended: 'whyEnded',
  day: 'whyDay',
  hour: 'whyHour',
  excluded: 'whyExcluded',
  audience: 'whyAudience',
  level_low: 'whyLevelLow',
  level_high: 'whyLevelHigh',
  not_new: 'whyNotNew',
  not_returning: 'whyNotReturning',
  country: 'whyCountry',
  sponsor_off: 'whySponsorOff',
  product_off: 'whyProductOff',
  product_audience: 'whyProductAudience',
  max_items: 'whyMaxItems',
};

function PreviewDialog(props: { onClose: () => void; placementId?: bigint }) {
  const placements = useRows('placement');
  const banners = useRows('adminBanners');
  const [placementKey, setPlacement] = useState(placements.find(p => p.id === props.placementId)?.key ?? placements[0]?.key ?? '');
  const [player, setPlayer] = useState('');
  const [rows, setRows] = useState<{ bannerId: bigint; key: string; shown: boolean; reason: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { def } = useLanguages();
  async function check() {
    setErr(null);
    const id = /^\d+$/.test(latin(player).trim()) ? BigInt(latin(player).trim()) : 0n;
    const r = await run(c => c.procedures.adminBannerPreview({ placementKey, accountId: id }));
    if (r.ok) setRows(r.value);
    else setErr(errorText(r.err));
  }
  return (
    <Dialog title={t('bnPreview')} width={640} onClose={props.onClose} testId="bn-preview">
      <p className="small muted">{t('bnPreviewHint')}</p>
      <div className="row row-wrap" style={{ alignItems: 'flex-end' }}>
        <Field label={t('bnPlacement')} className="grow">
          <select className="select" value={placementKey} onChange={e => setPlacement(e.target.value)} data-testid="bn-preview-placement">
            {placements.map(p => (
              <option key={p.key} value={p.key}>
                {trText(p.name, def) || p.key}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('elPlayer')}>
          <input className="input ltr" value={player} onChange={e => setPlayer(e.target.value)} inputMode="numeric" placeholder="#" name="previewPlayer" style={{ width: 120 }} data-testid="bn-preview-player" />
        </Field>
        <button type="button" className="btn btn-primary" onClick={check} disabled={!placementKey || !/^\d+$/.test(latin(player).trim())} data-testid="bn-preview-go">
          <Eye className="ic" />
          {t('bnCheck')}
        </button>
      </div>
      <ErrBox text={err} />
      {rows && (
        <div className="card">
          {rows.length === 0 ? (
            <Empty icon={<Image className="ic" weight="duotone" />} title={t('emptyList')} />
          ) : (
            <div className="list" data-testid="bn-preview-list">
              {rows.map((x, i) => (
                <div className="list-row" key={String(x.bannerId)} data-testid={`bn-preview-${x.key}`}>
                  <span className="badge">{digits(i + 1)}</span>
                  <div className="list-main">
                    <span className="list-title">{banners.find(b => b.id === x.bannerId)?.name || x.key}</span>
                    <span className="list-sub mono">{x.key}</span>
                  </div>
                  {x.shown ? <span className="badge b-ok">{t('bnShown')}</span> : <span className="badge b-bad">{REASONS[x.reason] ? t(REASONS[x.reason]) : x.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function Banners() {
  const route = useRoute();
  useLocale();
  const list = useRows('adminBanners');
  const placements = useRows('placement');
  const sponsors = useRows('adminSponsors');
  const loaded = useLoaded();
  const { def } = useLanguages();
  const placement = route.query.get('placement') ?? '';
  const [edit, setEdit] = useState<BannerRow | 'new' | null>(null);
  const [stats, setStats] = useState<BannerRow | null>(null);
  const [preview, setPreview] = useState(false);
  const rows = [...list].filter(b => !placement || String(b.placementId) === placement).sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const plName = (id: bigint) => {
    const p = placements.find(x => x.id === id);
    return p ? trText(p.name, def) || p.key : '—';
  };
  return (
    <main className="page" data-testid="page-banners">
      <PageHead
        title={t('navBanners')}
        sub={num(rows.length)}
        action={
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-outline" onClick={() => setPreview(true)} data-testid="bn-preview-open">
              <Eye className="ic" />
              {t('bnPreview')}
            </button>
            <AddButton label={t('bnNew')} onClick={() => setEdit('new')} testId="bn-add" />
          </div>
        }
      />
      <div className="toolbar">
        <div style={{ width: 240 }}>
          <IdPick kind="placement" value={placement ? BigInt(placement) : 0n} onChange={v => pageQuery('banners', { placement: v ? String(v) : '' })} none={t('bnAllPlacements')} testId="bn-filter" label={t('bnPlacement')} />
        </div>
      </div>
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="bn"
        keyOf={r => r.key}
        empty={{ icon: <Image className="ic" weight="duotone" />, title: t('emptyList') }}
        cardTitle={r => <b>{r.name || r.key}</b>}
        cols={[
          {
            label: t('name'),
            render: r => (
              <span className="row" style={{ gap: 10 }}>
                <span className="swatch" style={{ width: 28, height: 28, borderRadius: 6, background: r.imageUrl ? `center / cover url(${r.imageUrl})` : r.bgColor || 'var(--well-2)' }} />
                <span>
                  <span className="primary">{r.name || trText(r.title, def)}</span>
                  <div className="small muted">{trText(r.title, def)}</div>
                </span>
              </span>
            ),
          },
          { label: t('bnPlacement'), render: r => plName(r.placementId) },
          { label: t('bnSchedule'), render: r => <span className="small">{scheduleText(r)}</span> },
          { label: t('bnPriority'), render: r => digits(r.priority) },
          {
            label: t('status'),
            render: r => (
              <span className="chips">
                <ActiveBadge on={r.isActive} />
                {r.sponsorId ? <span className="badge b-violet">{trText(sponsors.find(s => s.id === r.sponsorId)?.name, def) || t('spSponsor')}</span> : null}
              </span>
            ),
          },
        ]}
        extra={(r, card) => (
          <button type="button" className="btn btn-sm" onClick={() => setStats(r)} data-testid={card ? undefined : `bn-stats-${r.key}`}>
            <ChartBar className="ic" />
            {t('bnStats')}
          </button>
        )}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteBanner({ id: r.id }))}
      />
      {edit && <BannerDialog row={edit === 'new' ? undefined : edit} placementId={placement ? BigInt(placement) : undefined} onClose={() => setEdit(null)} />}
      {stats && <StatsDialog banner={stats} onClose={() => setStats(null)} />}
      {preview && <PreviewDialog onClose={() => setPreview(false)} placementId={placement ? BigInt(placement) : undefined} />}
    </main>
  );
}

type SponsorRow = RowOf<'adminSponsors'>;

function SponsorDialog(props: { row?: SponsorRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [logoUrl, setLogo] = useState(r?.logoUrl ?? '');
  const [color, setColor] = useState(r?.color ?? '');
  const [websiteUrl, setWebsite] = useState(r?.websiteUrl ?? '');
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [contactName, setContactName] = useState(r?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(r?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(r?.contactPhone ?? '');
  const [notes, setNotes] = useState(r?.notes ?? '');
  const [win, setWin] = useState<[bigint, bigint]>([r?.startsAt ?? 0n, r?.endsAt ?? 0n]);
  const [budgetToman, setBudget] = useState<bigint>(r?.budgetToman ?? 0n);
  const [targetViews, setTargetViews] = useState(r?.targetViews ?? 0);
  const [targetClicks, setTargetClicks] = useState(r?.targetClicks ?? 0);
  const [stopAtTarget, setStop] = useState(r?.stopAtTarget ?? false);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('spEdit') : t('spNew')}
      testId="sp-dialog"
      width={720}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() =>
          getConn().reducers.adminSaveSponsor({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name,
            description,
            logoUrl: logoUrl.trim(),
            color: color.trim(),
            websiteUrl: websiteUrl.trim(),
            tagIds,
            contactName: contactName.trim(),
            contactEmail: contactEmail.trim(),
            contactPhone: latin(contactPhone).trim(),
            notes,
            startsAt: win[0],
            endsAt: win[1],
            budgetToman,
            targetViews,
            targetClicks,
            stopAtTarget,
            isActive,
            sort,
          })
        )
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('spWebsite')} hint="https://">
        <input className="input ltr" name="websiteUrl" value={websiteUrl} onChange={e => setWebsite(e.target.value)} />
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('description')} className="span-2" hint={t('optional')}>
        <TrInputs value={description} onChange={setDescription} name="description" />
      </Field>
      <Field label={t('spLogo')} hint={t('brUrlHint')}>
        <input className="input ltr" name="logoUrl" value={logoUrl} onChange={e => setLogo(e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t('tgColor')}>
        <div className="input-group">
          <input type="color" className="color-input" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#3f76ff'} onChange={e => setColor(e.target.value)} aria-label={t('tgColor')} />
          <input className="input ltr grow" name="color" value={color} onChange={e => setColor(e.target.value)} placeholder="#rrggbb" />
        </div>
      </Field>
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('spContract')}
      </div>
      <WindowFields startsAt={win[0]} endsAt={win[1]} onChange={(a, b) => setWin([a, b])} />
      <Field label={t('spBudget')}>
        <BigInput value={budgetToman} onChange={setBudget} name="budgetToman" />
      </Field>
      <span />
      <Field label={t('spTargetViews')} hint={t('zeroNoLimit')}>
        <NumInput value={targetViews} onChange={setTargetViews} name="targetViews" />
      </Field>
      <Field label={t('spTargetClicks')} hint={t('zeroNoLimit')}>
        <NumInput value={targetClicks} onChange={setTargetClicks} name="targetClicks" />
      </Field>
      <div className="span-2">
        <SwitchRow checked={stopAtTarget} onChange={setStop} label={t('spStop')} />
      </div>
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('spContact')}
      </div>
      <Field label={t('spContactName')}>
        <input className="input" name="contactName" value={contactName} onChange={e => setContactName(e.target.value)} />
      </Field>
      <Field label={t('spContactPhone')}>
        <input className="input ltr" name="contactPhone" value={contactPhone} onChange={e => setContactPhone(e.target.value)} inputMode="tel" />
      </Field>
      <Field label={t('spContactEmail')}>
        <input className="input ltr" name="contactEmail" value={contactEmail} onChange={e => setContactEmail(e.target.value)} inputMode="email" />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <Field label={t('spNotes')} className="span-2" hint={t('spNotesHint')}>
        <textarea className="textarea" name="notes" value={notes} onChange={e => setNotes(e.target.value)} />
      </Field>
      <Field label={t('tags')} className="span-2">
        <TagPicker keyType="sponsor" value={tagIds} onChange={setTags} />
      </Field>
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

export function Sponsors() {
  useLocale();
  const list = useRows('adminSponsors');
  const loaded = useLoaded();
  const [edit, setEdit] = useState<SponsorRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-sponsors">
      <PageHead title={t('navSponsors')} sub={num(rows.length)} action={<AddButton label={t('spNew')} onClick={() => setEdit('new')} testId="sp-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="sp"
        keyOf={r => r.key}
        empty={{ icon: <Handshake className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          {
            label: t('name'),
            render: r => (
              <span className="row" style={{ gap: 10 }}>
                <span className="swatch" style={{ width: 24, height: 24, borderRadius: 6, background: r.logoUrl ? `center / cover url(${r.logoUrl})` : r.color || 'var(--well-2)' }} />
                <NameCell name={r.name} k={r.key} />
              </span>
            ),
          },
          { label: t('spContract'), render: r => <span className="small">{r.startsAt || r.endsAt ? `${r.startsAt ? date(new Date(Number(r.startsAt / 1000n)), false) : '…'} – ${r.endsAt ? date(new Date(Number(r.endsAt / 1000n)), false) : '…'}` : t('bnAlways')}</span> },
          { label: t('spBudget'), render: r => (r.budgetToman ? toman(r.budgetToman) : '—') },
          { label: t('spTargets'), render: r => (r.targetViews || r.targetClicks ? t('spTargetsN', { v: r.targetViews, c: r.targetClicks }) : '—') },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        extra={(r, card) => (
          <a className="btn btn-sm" href={`#/sponsor-report?id=${r.id}`} data-testid={card ? undefined : `sp-report-${r.key}`}>
            <ChartBar className="ic" />
            {t('spReport')}
          </a>
        )}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteSponsor({ id: r.id }))}
      />
      {edit && <SponsorDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

export function SponsorReport() {
  const route = useRoute();
  useLocale();
  const { def } = useLanguages();
  const sponsors = useRows('adminSponsors');
  const id = BigInt(route.query.get('id') || '0');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, error } = useFetch(() => getConn().procedures.adminSponsorReport({ sponsorId: id, from, to }), [String(id), from, to]);
  const sponsor = sponsors.find(s => s.id === id);
  const max = Math.max(1, ...(data?.days.map(d => d.views) ?? [1]));
  const pct = (v: number) => `${digits((Math.round(v * 10) / 10).toString())}٪`;
  async function download() {
    const r = await run(c => c.procedures.adminSponsorReportCsv({ sponsorId: id, from, to }));
    if (!r.ok) {
      toast('bad', errorText(r.err));
      return;
    }
    const blob = new Blob(['﻿' + r.value.csv], { type: r.value.contentType || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.value.filename || 'sponsor-report.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="page" data-testid="page-sponsor-report">
      <a href="#/sponsors" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
        <ArrowRight className="ic" style={{ transform: document.documentElement.dir === 'rtl' ? undefined : 'scaleX(-1)' }} />
        {t('navSponsors')}
      </a>
      <PageHead
        title={t('spReportOf', { name: trText(sponsor?.name, def) || data?.key || '' })}
        sub={data ? `${dayLabel(data.from)} – ${dayLabel(data.to)}` : <Skel w={120} h={10} />}
        action={
          <button type="button" className="btn btn-primary" onClick={download} disabled={!data} data-testid="sp-csv">
            <DownloadSimple className="ic" />
            {t('spCsv')}
          </button>
        }
      />
      <div className="toolbar">
        <Field label={t('from')}>
          <input type="date" className="input ltr" value={from} onChange={e => setFrom(e.target.value)} data-testid="sp-from" />
        </Field>
        <Field label={t('until')}>
          <input type="date" className="input ltr" value={to} onChange={e => setTo(e.target.value)} data-testid="sp-to" />
        </Field>
        {data && <span className={`badge ${data.live ? 'b-ok' : ''}`} data-testid="sp-live">{data.live ? t('spLive') : t('spNotLive')}</span>}
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="tiles">
        {!data
          ? Array.from({ length: 4 }).map((_, i) => (
              <div className="tile" key={i} style={{ cursor: 'default' }}>
                <Skel w={40} h={40} r={8} style={{ gridRow: '1 / span 2' }} />
                <Skel w="55%" h={10} />
                <Skel w="35%" h={18} style={{ marginTop: 6 }} />
              </div>
            ))
          : [
              [t('spViews'), num(data.totals.views), t('spAllTime', { n: num(data.allTimeViews) })],
              [t('spClicks'), num(data.totals.clicks), t('spAllTime', { n: num(data.allTimeClicks) })],
              [t('spPlayers'), num(data.totals.players), t('spAllTime', { n: num(data.allTimePlayers) })],
              [t('spCtr'), pct(data.totals.ctrPercent), data.budgetToman ? toman(data.budgetToman) : ''],
            ].map(([label, value, sub], i) => (
              <div className="tile" key={i} style={{ cursor: 'default', gridTemplateColumns: 'minmax(0, 1fr)' }} data-testid={`sp-tile-${i}`}>
                <span className="tile-label">{label}</span>
                <span className="tile-value">{value}</span>
                <span className="small muted">{sub}</span>
              </div>
            ))}
      </div>
      <Section title={t('spDaily')} testId="sp-chart">
        {!data ? (
          <Skel h={160} r={6} />
        ) : data.days.every(d => !d.views) ? (
          <Empty icon={<ChartBar className="ic" weight="duotone" />} title={t('spNoViews')} />
        ) : (
          <>
            <div className="chart" role="img" aria-label={t('spDaily')}>
              {data.days.map(d => (
                <span key={d.day} className={`bar ${d.views ? '' : 'zero'}`} style={{ height: `${Math.max(d.views ? 3 : 1, (d.views / max) * 100)}%` }} title={`${dayLabel(d.day)}: ${num(d.views)} / ${num(d.clicks)} · ${pct(d.ctrPercent)}`} />
              ))}
            </div>
            <div className="chart-axis">
              <span>{data.days[0] ? dayLabel(data.days[0].day) : ''}</span>
              <span>{data.days.length ? dayLabel(data.days[data.days.length - 1].day) : ''}</span>
            </div>
          </>
        )}
      </Section>
      <Section title={t('spByBanner')} pad={false} testId="sp-banners">
        {!data ? (
          <div className="card-pad">
            <Skel h={60} r={6} />
          </div>
        ) : data.banners.length === 0 ? (
          <Empty icon={<Image className="ic" weight="duotone" />} title={t('emptyList')} />
        ) : (
          <div className="scroll-x">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>{t('navBanners')}</th>
                  <th>{t('bnPlacement')}</th>
                  <th>{t('spViews')}</th>
                  <th>{t('spClicks')}</th>
                  <th>{t('spCtr')}</th>
                </tr>
              </thead>
              <tbody>
                {data.banners.map(b => (
                  <tr key={String(b.bannerId)}>
                    <td>
                      {b.name || b.key} <span className="mono muted">{b.key}</span>
                    </td>
                    <td className="mono">{b.placementKey}</td>
                    <td>{num(b.views)}</td>
                    <td>{num(b.clicks)}</td>
                    <td>{pct(b.ctrPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </main>
  );
}

type GameRow = RowOf<'chanceGame'>;
type Slot = { chance: number; prizeId: bigint; prizeGroupId: bigint };
type TicketType = 'none' | 'currency' | 'meta' | 'item';

function GameDialog(props: { row?: GameRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [kind, setKind] = useState(r?.kind ?? 'wheel');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [metadata, setMetadata] = useState(r?.metadata ?? '');
  const [prizeType, setPrizeType] = useState(r?.prizeType ?? 'prize');
  const [prize, setPrize] = useState<Slot[]>(r?.prize.map(x => ({ ...x })) ?? [{ chance: 100, prizeId: 0n, prizeGroupId: 0n }]);
  const [intervalTime, setInterval] = useState(r?.intervalTime ?? 1440);
  const [freePlays, setFreePlays] = useState(r?.freePlays ?? 0);
  const [freePeriod, setFreePeriod] = useState(r?.freePeriod || 'day');
  const [ticket, setTicket] = useState<TicketType>((r?.price?.type as TicketType) ?? 'none');
  const [ticketKey, setTicketKey] = useState(r?.price?.key ?? '');
  const [ticketAmount, setTicketAmount] = useState<bigint>(r?.price?.amount ?? 1n);
  const [dailyLimit, setDaily] = useState(r?.dailyLimit ?? 0);
  const [totalLimit, setTotal] = useState(r?.totalLimit ?? 0);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  const total = Math.round(prize.reduce((s, x) => s + (Number.isFinite(x.chance) ? x.chance : 0), 0) * 10000) / 10000;
  const ok = Math.abs(total - 100) < 0.00005;
  return (
    <FormDialog
      title={r ? t('cgEdit') : t('cgNew')}
      testId="cg-dialog"
      width={760}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        (!ok ? ({ ok: false, msg: codeText('TOTAL_CHANCE_MUST_BE_100') + ' ' + t('cgTotalNow', { n: fmtNum(total) }) } as const) : null) ??
        save(() =>
          getConn().reducers.adminSaveChanceGame({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            kind,
            name,
            description,
            metadata: metadata.trim(),
            prizeType,
            prize: prize.map(x => ({ chance: x.chance, prizeId: prizeType === 'prize' ? x.prizeId : 0n, prizeGroupId: prizeType === 'prizeGroup' ? x.prizeGroupId : 0n })),
            intervalTime,
            freePlays: intervalTime ? freePlays : 0,
            freePeriod,
            price: ticket === 'none' ? undefined : { type: ticket, key: ticketKey, amount: ticketAmount },
            dailyLimit,
            totalLimit,
            isActive,
            sort,
          })
        )
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('cgKind')}>
        <Choice value={kind} onChange={setKind} name="kind" options={[['wheel', 'cgWheel'], ['loot_box', 'cgLootBox'], ['slot', 'cgSlot']]} />
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('cgPrizeType')}>
        <Choice value={prizeType} onChange={setPrizeType} name="prizeType" testId="cg-prize-type" options={[['prize', 'cgByPrize'], ['prizeGroup', 'cgByGroup']]} />
      </Field>
      <span />
      <Field label={t('cgSlots')} hint={t('cgSlotsHint')} className="span-2">
        <Rows
          rows={prize}
          onChange={setPrize}
          testId="cg-slots"
          addLabel={t('cgAddSlot')}
          max={50}
          make={() => ({ chance: Math.max(0, Math.round((100 - total) * 10000) / 10000), prizeId: 0n, prizeGroupId: 0n })}
          cols={[
            { label: t('cgChance'), width: '110px', render: (x, set, i) => <FloatInput value={x.chance} onChange={v => set({ chance: v })} name={`cg-slot-${i}-chance`} /> },
            {
              label: prizeType === 'prize' ? t('gfPrize') : t('itPrizeGroup'),
              width: 'minmax(0, 1fr)',
              render: (x, set, i) =>
                prizeType === 'prize' ? (
                  <IdPick kind="prize" value={x.prizeId} onChange={v => set({ prizeId: v })} none={t('cgNothing')} testId={`cg-slot-${i}-prize`} />
                ) : (
                  <IdPick kind="prizeGroup" value={x.prizeGroupId} onChange={v => set({ prizeGroupId: v })} none={t('cgNothing')} testId={`cg-slot-${i}-group`} />
                ),
            },
          ]}
          footer={
            <span className={`badge ${ok ? 'b-ok' : 'b-bad'}`} data-testid="cg-total">
              {t('cgTotal', { n: fmtNum(total) })}
            </span>
          }
        />
      </Field>
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('cgFree')}
      </div>
      <Field label={t('cgInterval')} hint={t('cgIntervalHint')}>
        <NumInput value={intervalTime} onChange={setInterval} name="intervalTime" />
      </Field>
      <Field label={t('cgFreePlays')} hint={t('zeroNoLimit')}>
        <div className="input-group">
          <NumInput value={freePlays} onChange={setFreePlays} name="freePlays" />
          <div style={{ width: 120 }}>
            <Choice value={freePeriod} onChange={setFreePeriod} name="freePeriod" options={[['day', 'perDay'], ['week', 'perWeek']]} />
          </div>
        </div>
      </Field>
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('cgTicket')}
      </div>
      <Field label={t('cgTicketType')}>
        <Choice
          value={ticket}
          onChange={v => {
            setTicket(v);
            setTicketKey('');
          }}
          name="ticketType"
          testId="cg-ticket"
          options={[
            ['none', 'cgNoTicket'],
            ['currency', 'itCurrency'],
            ['meta', 'itMeta'],
            ['item', 'itItem'],
          ]}
        />
      </Field>
      {ticket !== 'none' ? (
        <Field label={t('cgTicketCost')}>
          <div className="input-group">
            <div className="grow">
              <KeyPick kind={ticket === 'currency' ? 'currency' : ticket === 'meta' ? 'meta' : 'item'} value={ticketKey} onChange={setTicketKey} none="—" testId="cg-ticket-key" />
            </div>
            <div style={{ width: 110 }}>
              <BigInput value={ticketAmount} onChange={setTicketAmount} name="ticketAmount" />
            </div>
          </div>
        </Field>
      ) : (
        <span />
      )}
      <Field label={t('cgDaily')} hint={t('zeroNoLimit')}>
        <NumInput value={dailyLimit} onChange={setDaily} name="dailyLimit" />
      </Field>
      <Field label={t('cgTotalLimit')} hint={t('zeroNoLimit')}>
        <NumInput value={totalLimit} onChange={setTotal} name="totalLimit" />
      </Field>
      <Field label={t('description')} className="span-2" hint={t('optional')}>
        <TrInputs value={description} onChange={setDescription} name="description" />
      </Field>
      <Field label={t('imMetadata')} hint={t('imMetadataHint')} className="span-2">
        <textarea className="textarea ltr" name="metadata" value={metadata} onChange={e => setMetadata(e.target.value)} placeholder="{}" />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

function kindLabelC(k: string) {
  return k === 'loot_box' ? t('cgLootBox') : k === 'slot' ? t('cgSlot') : t('cgWheel');
}

export function ChanceGames() {
  useLocale();
  const list = useRows('chanceGame');
  const loaded = useLoaded();
  const names = useItemNames();
  const [edit, setEdit] = useState<GameRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-chance-games">
      <PageHead title={t('navChanceGames')} sub={num(rows.length)} action={<AddButton label={t('cgNew')} onClick={() => setEdit('new')} testId="cg-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="cg"
        keyOf={r => r.key}
        empty={{ icon: <Ticket className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('cgKind'), render: r => <span className="badge b-info">{kindLabelC(r.kind)}</span> },
          { label: t('cgSlots'), render: r => t('cgSlotsN', { n: r.prize.length }) },
          {
            label: t('cgHowToPlay'),
            render: r => (
              <span className="stack small" style={{ gap: 0 }}>
                {r.intervalTime ? <span>{t('cgFreeEvery', { n: r.intervalTime })}</span> : null}
                {r.price ? <span>{t('cgTicketN', { n: num(r.price.amount), k: names(r.price.type, r.price.key) })}</span> : null}
              </span>
            ),
          },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        extra={(r, card) => (
          <a className="btn btn-sm" href={`#/chance-plays?game=${r.id}`}>
            {t('navChancePlays')}
          </a>
        )}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteChanceGame({ id: r.id }))}
      />
      {edit && <GameDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

export function ChancePlays() {
  const route = useRoute();
  useLocale();
  const { def } = useLanguages();
  const games = useRows('chanceGame');
  const prizeName = usePrizeName();
  const game = route.query.get('game') ?? '';
  const status = route.query.get('status') ?? '';
  const [player, setPlayer] = useState('');
  const [page, setPage] = useState(1);
  const p = useDebounced(player, 300);
  const accountId = /^\d+$/.test(latin(p).trim()) ? BigInt(latin(p).trim()) : 0n;
  const { data, error, loading } = useFetch(
    () => getConn().procedures.adminChancePlays({ gameId: game ? BigInt(game) : 0n, accountId, status, page, pageSize: PAGE }),
    [game, status, String(accountId), page]
  );
  const rows = data?.rows ?? [];
  const set = (q: Record<string, string>) => {
    setPage(1);
    pageQuery('chance-plays', { game, status, ...q });
  };
  const gameName = (id: bigint, k: string) => trText(games.find(g => g.id === id)?.name, def) || k;
  return (
    <main className="page" data-testid="page-chance-plays">
      <PageHead title={t('navChancePlays')} sub={data ? num(data.total) : <Skel w={40} h={10} />} />
      <div className="toolbar">
        <div className="input-affix search" style={{ width: 200 }}>
          <MagnifyingGlass className="ic" />
          <input className="input" value={player} onChange={e => { setPlayer(e.target.value); setPage(1); }} placeholder={t('elPlayer')} aria-label={t('elPlayer')} inputMode="numeric" data-testid="cp-player" />
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 180 }} value={game} onChange={e => set({ game: e.target.value })} aria-label={t('navChanceGames')} data-testid="cp-game">
          <option value="">{t('cpAllGames')}</option>
          {games.map(g => (
            <option key={String(g.id)} value={String(g.id)}>
              {trText(g.name, def) || g.key}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 140 }} value={status} onChange={e => set({ status: e.target.value })} aria-label={t('status')}>
          <option value="">{t('pyAllStatus')}</option>
          <option value="done">{t('cpDone')}</option>
          <option value="failed">{t('cpFailed')}</option>
        </select>
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="cp-table">
          <thead>
            <tr>
              <th>{t('auColTime')}</th>
              <th>{t('pyColPlayer')}</th>
              <th>{t('navChanceGames')}</th>
              <th>{t('cpMode')}</th>
              <th>{t('cpResult')}</th>
              <th>{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty icon={<Ticket className="ic" weight="duotone" />} title={t('emptyList')} />
                </td>
              </tr>
            ) : (
              rows.map(x => (
                <tr key={String(x.id)} data-testid={`cp-row-${x.id}`}>
                  <td className="nowrap">{when(x.at)}</td>
                  <td>
                    <a className="row-link" href={`#/player?id=${x.accountId}`}>
                      #{digits(String(x.accountId))}
                    </a>
                  </td>
                  <td>{gameName(x.gameId, x.gameKey)}</td>
                  <td>{x.mode === 'ticket' ? t('cpTicket') : t('cpFree')}</td>
                  <td>
                    <span className="stack small" style={{ gap: 0 }}>
                      <span>{x.prizeId ? prizeName(x.prizeId) : x.prizeGroupId ? t('itPrizeGroup') : t('cgNothing')}</span>
                      <span className="muted">
                        {t('cpRoll', { n: fmtNum(x.roll / 10000) })} · {t('cpSlot', { n: x.slot + 1 })}
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="stack" style={{ gap: 2 }}>
                      <span className={`badge ${x.status === 'done' ? 'b-ok' : 'b-bad'}`}>{x.status === 'done' ? t('cpDone') : t('cpFailed')}</span>
                      {x.error && <span className="small neg">{errorText({ code: x.error, raw: x.error })}</span>}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(x => (
            <div className="pcard" key={String(x.id)}>
              <div className="row">
                <b className="grow">{gameName(x.gameId, x.gameKey)}</b>
                <span className={`badge ${x.status === 'done' ? 'b-ok' : 'b-bad'}`}>{x.status === 'done' ? t('cpDone') : t('cpFailed')}</span>
              </div>
              <div className="pcard-meta">
                <span>{t('cpResult')}</span>
                <span>{x.prizeId ? prizeName(x.prizeId) : t('cgNothing')}</span>
                <span>{t('auColTime')}</span>
                <span>{when(x.at)}</span>
              </div>
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}
